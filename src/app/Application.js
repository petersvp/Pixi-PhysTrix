/**
 * Coordinates persistent Pixi scenes, hash routing, session state, and modes.
 * The AppShell owns one canvas for the application's entire lifetime.
 * Menu, gameplay, and future settings scenes are disposable child containers.
 * Hash transitions never request or reload the browser document.
 * Gameplay launch uses a short scene entrance transition and automatic countdown.
 * The old top-bar implementation remains available but intentionally unmounted.
 */

import {
  readLaunchParameters,
  readScene,
  writeLaunchParameters,
} from "./Router.js";
import { Session } from "./Session.js";
import { ModeRegistry } from "./ModeRegistry.js";
import { AppShell } from "./AppShell.js";
import { ClassicGameplay } from "../gameplay/ClassicGameplay.js";
import { PhysicsGameplay } from "../gameplay/PhysicsGameplay.js";
import { StartMenu } from "../menus/StartMenu.js";
import { playerModeDescriptors } from "../player/PlayerModeRegistry.js";
import { DebugPanel } from "../ui/DebugPanel.js";
import { SettingsPanel } from "../ui/SettingsPanel.js";
import { PausePanel } from "../ui/PausePanel.js";
import { TopBar } from "../ui/TopBar.js";
import { loadPersistentSettings } from "../game/Settings.js";
import { loadMinoShaderSources } from "../render/ShaderSources.js";
import { loadSkin, shaderSettings } from "../render/ShaderSettings.js";
import {
  GAME_VIEWPORT_HEIGHT,
  GAME_VIEWPORT_WIDTH,
} from "../config/uiConstants.js";

export class Application {
  constructor(root) {
    this.root = root;
    this.registry = new ModeRegistry();
    this.registry.register("classic", ClassicGameplay);
    this.registry.register("physics", PhysicsGameplay);
    this.session = new Session(readLaunchParameters());
  }

  async launch() {
    // Pixi rasterizes text to textures, so wait for Quantico before any scene
    // creates its labels. A failed external font request still falls back.
    await document.fonts.load("400 16px Quantico").catch(() => {});
    await document.fonts.load("700 16px Quantico").catch(() => {});
    await loadMinoShaderSources();
    await this.applySkin(this.session.skin);
    this.shell = await new AppShell(this.root).init();
    this.settings = loadPersistentSettings();
    this.pausePanel = new PausePanel({
      app: this.shell.app,
      onResume: () => this.mode?.game?.setPaused(false),
      consumeGameplayInput: (actions) =>
        actions.forEach((action) => this.mode?.game?.input.consume(action)),
      onSettings: () => {
        this.pausePanel.close();
        this.settingsPanel.open();
      },
      onExit: () => {
        this.pausePanel.close();
        this.settingsPanel.close();
        history.replaceState(null, "", "#menu");
        this.showStartMenu();
      },
    });
    this.settingsPanel = new SettingsPanel({
      app: this.shell.app,
      settings: this.settings,
      onBack: () => {
        this.settingsPanel.close();
        if (this.sceneKind === "game") this.pausePanel.open();
      },
    });
    this.topBar = new TopBar({
      app: this.shell.app,
      isEnabled: () => this.mode?.game?.state === "playing",
      onPause: () => this.mode?.game?.setPaused(true),
      onSettings: () => {
        const game = this.mode?.game;
        if (!game || game.state !== "playing") return;
        game.setPaused(true);
        this.pausePanel.close();
        this.settingsPanel.open();
      },
    });
    this.debugPanel = new DebugPanel();
    this.debugPanel.setVisible(false);
    // Deliberate browser-console entry point for skin authoring. It reuses
    // the persistent inspector and never routes, reloads, or rebuilds Pixi.
    window.openSkinEditor = () => {
      this.debugPanel.setVisible(true);
      return this.debugPanel;
    };
    this.onHashChange = () => this.route();
    addEventListener("hashchange", this.onHashChange);
    this.route();
  }

  route() {
    Object.assign(this.session, readLaunchParameters());
    if (readScene() === "game") this.showGame();
    else this.showStartMenu();
  }

  clearScene() {
    if (this.sceneTransitionUpdate) {
      this.shell.app.ticker.remove(this.sceneTransitionUpdate);
      this.sceneTransitionUpdate = null;
    }
    this.startMenu?.destroy();
    this.startMenu = null;
    this.mode?.destroy();
    this.mode = null;
    this.shell.destroyScene(this.scene);
    this.scene = null;
  }

  showStartMenu() {
    if (this.sceneKind === "menu") return;
    this.clearScene();
    this.sceneKind = "menu";
    this.topBar?.setVisible(false);
    this.debugPanel?.setMaterial(shaderSettings);
    this.scene = this.shell.createScene("mainMenuScene");
    this.startMenu = new StartMenu({
      scene: this.scene,
      app: this.shell.app,
      session: this.session,
      onSkinSelect: (skin) => this.applySkin(skin),
      onSettings: () => this.settingsPanel.open(),
      onStart: async (update) => {
        Object.assign(this.session, update);
        await this.applySkin(this.session.skin);
        writeLaunchParameters(this.session);
        this.showGame();
      },
    });
  }

  showGame() {
    if (this.sceneKind === "game") return;
    this.clearScene();
    this.sceneKind = "game";
    this.topBar?.setVisible(true);
    this.scene = this.shell.createScene("gameplayScene");
    const player = playerModeDescriptors[this.session.playerMode];
    this.mode = this.registry.create(this.session.gameplayMode, {
      mount: this.root,
      app: this.shell.app,
      sceneRoot: this.scene,
      player,
      session: this.session,
    });
    this.mode.start();
    const game = this.mode.game;
    // The inspector follows the active Playfield. It never owns a material,
    // so leaving this scene cannot retain its shader curves or textures.
    this.debugPanel?.setMaterial(game.playfield.material);
    game.onPauseChange = (paused) => {
      if (paused) this.pausePanel.open();
      else {
        this.pausePanel.close();
        this.settingsPanel.close();
      }
    };
    // Standalone Core retains its existing pause-panel behavior. Integrations
    // must explicitly approve a pause request for their own mode rules.
    game.onPauseRequest = () => true;
    // The renderer completes its own first screen-size update on the next
    // ticker pass. Resolve the gameplay layout there before capturing the
    // scale-in target; this mirrors a browser resize without recreating UI.
    this.shell.app.ticker.addOnce(() => {
      if (this.mode?.game !== game) return;
      game.resize();
      this.animateSceneIn(game.root);
    });
  }

  animateSceneIn(root) {
    let elapsed = 0;
    const target = { x: root.x, y: root.y, scale: root.scale.x };
    const pivot = { x: GAME_VIEWPORT_WIDTH / 2, y: GAME_VIEWPORT_HEIGHT / 2 };
    root.alpha = 0;
    const applyTransform = (factor) => {
      // Animate the already-laid-out gameplay root, rather than its scene
      // parent. This keeps all HUD coordinates and later window resizes in
      // their normal scene space.
      root.pivot.set(pivot.x, pivot.y);
      root.position.set(
        target.x + target.scale * pivot.x,
        target.y + target.scale * pivot.y,
      );
      root.scale.set(target.scale * factor);
    };
    applyTransform(0.92);
    const update = () => {
      elapsed += this.shell.app.ticker.deltaMS;
      const amount = Math.min(1, elapsed / 420);
      const eased = 1 - Math.pow(1 - amount, 3);
      root.alpha = eased;
      applyTransform(0.92 + 0.08 * eased);
      if (amount >= 1) {
        root.alpha = 1;
        root.position.set(target.x, target.y);
        root.pivot.set(0, 0);
        root.scale.set(target.scale);
        this.shell.app.ticker.remove(update);
        if (this.sceneTransitionUpdate === update)
          this.sceneTransitionUpdate = null;
      }
    };
    this.sceneTransitionUpdate = update;
    this.shell.app.ticker.add(update);
  }

  async applySkin(filename) {
    try {
      const response = await fetch(
        `./minoskins/${encodeURIComponent(filename)}`,
      );
      if (!response.ok) return;
      loadSkin(await response.json());
    } catch {
      // A menu skin preview must never prevent the player from launching.
    }
  }
}
