/**
 * Owns the one persistent Pixi Application used by every application scene.
 * Scenes only create and destroy child containers; the renderer and canvas
 * remain alive for the entire browser session.
 * It also provides the shared viewport resize behavior.
 * This keeps routing and transitions independent from DOM replacement.
 * Future settings and replay scenes use this same shell.
 */

import { COLORS } from "../config/colors.js";
import {
  GAME_VIEWPORT_HEIGHT,
  GAME_VIEWPORT_WIDTH,
} from "../config/uiConstants.js";
import { AmbientBackground } from "./AmbientBackground.js";

export class AppShell {
  constructor(root) {
    this.root = root;
    this.hiddenTickTimer = null;
    this.visibleTickerMinFPS = null;
  }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({
      width: GAME_VIEWPORT_WIDTH,
      height: GAME_VIEWPORT_HEIGHT,
      backgroundColor: COLORS.APP_BACKGROUND,
      antialias: true,
      useBackBuffer: true,
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
    });
    this.app.stage.sortableChildren = true;
    // Register the long-lived shell application before any routed scene is
    // created, allowing PixiJS DevTools to inspect both menu and game nodes.
    window.__PIXI_DEVTOOLS__ = { app: this.app };
    this.ambientBackground = new AmbientBackground(this.app);
    this.app.stage.addChild(this.ambientBackground.root);
    this.app.canvas.style.position = "fixed";
    this.app.canvas.style.inset = "0";
    this.app.canvas.style.width = "100vw";
    this.app.canvas.style.height = "100vh";
    this.root.replaceChildren(this.app.canvas);
    this.resize = () => {
      this.app.renderer.resize(innerWidth, innerHeight);
      this.ambientBackground.resize();
    };
    addEventListener("resize", this.resize);
    this.resize();
    this.onVisibilityChange = () => {
      if (!document.hidden) {
        if (this.hiddenTickTimer !== null) {
          clearInterval(this.hiddenTickTimer);
          this.hiddenTickTimer = null;
        }
        if (this.visibleTickerMinFPS !== null) {
          this.app.ticker.minFPS = this.visibleTickerMinFPS;
          this.visibleTickerMinFPS = null;
        }
        this.app.ticker.start();
        return;
      }

      // requestAnimationFrame is throttled while a tab is hidden. Keep the
      // logical Pixi ticker alive for gameplay/network listeners, then render
      // the current stage explicitly instead of leaving the match frozen.
      if (this.hiddenTickTimer !== null) return;
      this.visibleTickerMinFPS = this.app.ticker.minFPS;
      // Pixi ordinarily caps a delayed frame to its minFPS. Background tabs
      // are deliberately timer-throttled, so that cap would make gameplay
      // advance only a small fraction of real elapsed time.
      this.app.ticker.minFPS = 0;
      this.app.ticker.stop();
      this.hiddenTickTimer = setInterval(() => {
        if (!document.hidden || this.app.renderer.destroyed) return;
        this.app.ticker.update(performance.now());
        this.app.renderer.render(this.app.stage);
      }, 1000 / 60);
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.onVisibilityChange();
    return this;
  }

  createScene(name) {
    const scene = new PIXI.Container();
    scene.label = name;
    scene.zIndex = 0;
    this.app.stage.addChild(scene);
    return scene;
  }

  destroyScene(scene) {
    if (scene?.parent) scene.parent.removeChild(scene);
    scene?.destroy({ children: true });
  }
}
