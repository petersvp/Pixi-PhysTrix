/**
 * Provides the persistent in-engine actions at the top of gameplay scenes.
 *
 * Pause and Settings stay attached to the one shared Pixi stage.
 * The bar follows the renderer size without recreating the application canvas.
 * Buttons intentionally use screen coordinates so they remain touchable in
 * portrait play, regardless of the playfield's camera fit or visible bleed.
 */

import { COLORS } from "../config/colors.js";
import {
  TOP_BAR_BUTTON_SIZE,
  TOP_BAR_MARGIN,
} from "../config/uiConstants.js";

export class TopBar {
  constructor({ app, onPause, onSettings, isEnabled }) {
    Object.assign(this, { app, onPause, onSettings, isEnabled });
    this.root = new PIXI.Container();
    this.root.label = "gameplayTopBar";
    this.root.zIndex = 800;
    this.root.visible = false;
    app.stage.addChild(this.root);
    this.pauseButton = this.createButton("pause", () => this.onPause?.());
    this.settingsButton = this.createButton("settings", () => this.onSettings?.());
    this.root.addChild(this.pauseButton, this.settingsButton);
    this.tick = () => {
      if (!this.destroyed) this.update();
    };
    app.ticker.add(this.tick);
    this.update(true);
  }

  createButton(kind, onPress) {
    const node = new PIXI.Container();
    node.label = `topBar${kind[0].toUpperCase()}${kind.slice(1)}Button`;
    node.eventMode = "static";
    node.cursor = "pointer";
    const plate = new PIXI.Graphics()
      .roundRect(0, 0, TOP_BAR_BUTTON_SIZE, TOP_BAR_BUTTON_SIZE, 12)
      .fill({ color: COLORS.PANEL_BG, alpha: 0.72 });
    const icon = new PIXI.Graphics();
    const center = TOP_BAR_BUTTON_SIZE / 2;
    if (kind === "pause") {
      icon
        .roundRect(center - 10, center - 11, 7, 22, 3)
        .fill(COLORS.PANEL_ACCENT)
        .roundRect(center + 3, center - 11, 7, 22, 3)
        .fill(COLORS.PANEL_ACCENT);
    } else {
      const points = [];
      for (let index = 0; index < 16; index += 1) {
        const angle = -Math.PI / 2 + (index * Math.PI) / 8;
        const radius = index % 2 ? 10 : 14;
        points.push(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
      }
      icon
        .poly(points)
        .fill(COLORS.PANEL_ACCENT)
        .circle(center, center, 5)
        .fill(COLORS.PANEL_BG);
    }
    node.hitArea = new PIXI.Rectangle(0, 0, TOP_BAR_BUTTON_SIZE, TOP_BAR_BUTTON_SIZE);
    node.addChild(plate, icon);
    node.on("pointertap", (event) => {
      event.stopPropagation?.();
      if (this.isEnabled?.()) onPress();
    });
    return node;
  }

  setVisible(visible) {
    this.root.visible = visible;
    this.update(true);
  }

  update(force = false) {
    const { width, height } = this.app.screen;
    if (force || width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.pauseButton.position.set(TOP_BAR_MARGIN, TOP_BAR_MARGIN);
      this.settingsButton.position.set(
        width - TOP_BAR_MARGIN - TOP_BAR_BUTTON_SIZE,
        TOP_BAR_MARGIN,
      );
    }
    const enabled = !!this.isEnabled?.();
    this.pauseButton.alpha = enabled ? 1 : 0.38;
    this.settingsButton.alpha = enabled ? 1 : 0.38;
  }

  destroy() {
    this.destroyed = true;
    this.app.ticker.remove(this.tick);
    this.root.destroy({ children: true });
  }
}
