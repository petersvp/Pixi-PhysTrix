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

export class AppShell {
  constructor(root) {
    this.root = root;
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
    this.app.canvas.style.position = "fixed";
    this.app.canvas.style.inset = "0";
    this.app.canvas.style.width = "100vw";
    this.app.canvas.style.height = "100vh";
    this.root.replaceChildren(this.app.canvas);
    this.resize = () => this.app.renderer.resize(innerWidth, innerHeight);
    addEventListener("resize", this.resize);
    this.resize();
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
