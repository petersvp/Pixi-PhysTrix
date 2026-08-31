/**
 * Renders the application mode selector entirely through Pixi Graphics and Text.
 * It owns a compact canvas above the gameplay canvas, not an HTML navigation bar.
 * Buttons cycle through player and gameplay mode choices on pointer activation.
 * The application receives each changed selection through the supplied callback.
 * Layout and colors are local constants so the menu is easy to adjust.
 */

import { COLORS } from "../config/colors.js";

const PLAYER_MODES = ["1p", "2p-vs", "2p-coop"];
const GAMEPLAY_MODES = ["classic", "physics"];
const PLAYER_LABELS = {
  "1p": "1 PLAYER",
  "2p-vs": "2P VERSUS",
  "2p-coop": "2P CO-OP",
};
const GAMEPLAY_LABELS = { classic: "CLASSIC", physics: "PHYSICS" };

const nextValue = (values, current) =>
  values[(values.indexOf(current) + 1) % values.length];

export class MainMenu {
  constructor({
    root,
    session,
    onChange,
    onSkinEditorToggle,
    skinEditorVisible = false,
  }) {
    this.root = root;
    this.session = session;
    this.onChange = onChange;
    this.onSkinEditorToggle = onSkinEditorToggle;
    this.skinEditorVisible = skinEditorVisible;
    this.app = new PIXI.Application({
      width: 900,
      height: 64,
      backgroundColor: COLORS.MAIN_MENU_BG,
      antialias: true,
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
    });
  }

  render() {
    const mount = document.createElement("div");
    mount.id = "game";
    mount.style.position = "fixed";
    mount.style.inset = "0";
    mount.style.overflow = "hidden";
    this.app.view.style.position = "fixed";
    this.app.view.style.top = "0";
    this.app.view.style.left = "0";
    this.app.view.style.zIndex = "10";
    this.root.replaceChildren(this.app.view, mount);
    this.draw();
  }

  draw() {
    const root = this.app.stage;
    root.removeChildren();
    const phys = new PIXI.Text({
      text: "PHYS",
      style: {
        fontFamily: "Quantico",
        fontWeight: "bold",
        fontSize: 22,
        fill: COLORS.MENU_LOGO,
        letterSpacing: 1,
      },
    });
    const trix = new PIXI.Text({
      text: "TRIX",
      style: {
        fontFamily: "Quantico",
        fontWeight: "bold",
        fontSize: 22,
        fill: COLORS.MENU_LOGO_TEXT,
        letterSpacing: 1,
      },
    });
    phys.position.set(28, 19);
    trix.position.set(28 + phys.width + 6, 19);
    root.addChild(phys, trix);
    this.addButton(
      root,
      270,
      "PLAYER",
      PLAYER_LABELS[this.session.playerMode],
      () =>
        this.onChange({
          playerMode: nextValue(PLAYER_MODES, this.session.playerMode),
        }),
    );
    this.addButton(
      root,
      500,
      "GAMEPLAY",
      GAMEPLAY_LABELS[this.session.gameplayMode],
      () =>
        this.onChange({
          gameplayMode: nextValue(GAMEPLAY_MODES, this.session.gameplayMode),
        }),
    );
    this.addButton(
      root,
      730,
      "SKIN",
      this.skinEditorVisible ? "CLOSE" : "EDITOR",
      () => this.onSkinEditorToggle?.(),
      145,
    );
  }

  // The top bar remains mounted for development and future pause menus, but
  // normal play begins with the full-screen Pixi start menu instead.
  setVisible(visible) {
    this.app.view.style.display = visible ? "block" : "none";
  }

  addButton(root, x, label, value, action, width = 220) {
    const group = new PIXI.Container();
    group.position.set(x, 10);
    group.eventMode = "static";
    group.cursor = "pointer";
    const panel = new PIXI.Graphics()
      .roundRect(0, 0, width, 44, 6)
      .fill(COLORS.PANEL_BG)
      .stroke({ width: 1, color: COLORS.PANEL_BORDER });
    const caption = new PIXI.Text({
      text: label,
      style: {
        fontFamily: "Quantico",
        fontWeight: "bold",
        fontSize: 10,
        fill: COLORS.HUD_BUTTON_LABEL,
      },
    });
    const selection = new PIXI.Text({
      text: `${value}  >`,
      style: {
        fontFamily: "Quantico",
        fontWeight: "bold",
        fontSize: 14,
        fill: COLORS.HUD_BUTTON_TEXT,
      },
    });
    caption.position.set(11, 7);
    selection.position.set(11, 21);
    group.addChild(panel, caption, selection);
    group.on("pointertap", action);
    root.addChild(group);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.app.ticker.stop();
    this.app.stage.destroy({ children: true });
    this.app.renderer.destroy();
    this.app.view.remove();
  }
}
