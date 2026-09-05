/**
 * Provides the persistent Pixi pause menu.
 * This is intentionally separate from SettingsPanel.
 * It owns pause-only actions: resume, settings, and exit to the main menu.
 * The panel remains attached to the application stage across scene changes.
 * Gameplay state is controlled by the Application callbacks.
 */

import { COLORS } from "../config/colors.js";
import { AdvancedLineRenderer } from "../render/AdvancedLineRenderer.js";
import { UIMenu } from "./UIMenu.js";
import { UIMenuItem } from "./UIMenuItem.js";
import { UIMenuStack } from "./UIMenuStack.js";
import { GAMEPAD_BUTTON } from "../config/controls.js";

export class PausePanel {
  constructor({ app, onResume, onSettings, onExit, consumeGameplayInput }) {
    Object.assign(this, {
      app,
      onResume,
      onSettings,
      onExit,
      consumeGameplayInput,
    });
    this.root = new PIXI.Container();
    this.root.label = "persistentPausePanel";
    this.root.visible = false;
    this.root.zIndex = 1000;
    app.stage.addChild(this.root);
    this.draw();
    this.tick = () => {
      if (!this.destroyed) this.pollController();
    };
    app.ticker.add(this.tick);
    this.onKeyDown = (event) => this.handleKeyboard(event);
    addEventListener("keydown", this.onKeyDown);
  }
  button(label, x, y, width, onTap) {
    const node = new PIXI.Container();
    node.position.set(x, y);
    node.eventMode = "static";
    node.cursor = "pointer";
    const box = new PIXI.Graphics()
      .roundRect(0, 0, width, 46, 7)
      .fill(COLORS.PANEL_BG)
      .stroke({ width: 2, color: COLORS.PANEL_ACCENT });
    const text = new PIXI.Text({
      text: label,
      style: {
        fontFamily: "Quantico",
        fontSize: 18,
        fontWeight: "bold",
        fill: COLORS.HUD_VALUE,
      },
    });
    text.anchor.set(0.5);
    text.position.set(width / 2, 23);
    node.addChild(box, text);
    return new UIMenuItem({
      id: label,
      view: node,
      onTrigger: () => onTap(),
      render: ({ selected }) => {
        box.tint = selected ? 0xffd34d : 0xffffff;
      },
    });
  }
  frame(x, y, width, height) {
    const radius = 14;
    const points = [
      new PIXI.Point(x + radius, y),
      new PIXI.Point(x + width - radius, y),
    ];
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(x + width, y),
      new PIXI.Point(x + width, y + radius),
    );
    points.push(new PIXI.Point(x + width, y + height - radius));
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(x + width, y + height),
      new PIXI.Point(x + width - radius, y + height),
    );
    points.push(new PIXI.Point(x + radius, y + height));
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(x, y + height),
      new PIXI.Point(x, y + height - radius),
    );
    points.push(new PIXI.Point(x, y + radius));
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(x, y),
      new PIXI.Point(x + radius, y),
    );
    // Reverse the baseline so the left-side half-particle extrusion is outside.
    new AdvancedLineRenderer({
      texture: AdvancedLineRenderer.getHalfParticleTexture(14),
      tint: COLORS.PANEL_ACCENT,
      leftWidth: 12,
      alpha: 0.75,
      closed: true,
      name: "pausePanelGlow",
    }).draw(this.root, points.reverse());
  }
  draw() {
    this.root
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    this.menuStack = new UIMenuStack();
    this.menu = new UIMenu({
      id: "pauseActions",
      direction: "vertical",
      inactiveAlpha: 1,
    });
    this.menuStack.addMenu(this.menu);
    const glass = new PIXI.Graphics()
      .roundRect(325, 245, 250, 300, 14)
      .fill({ color: COLORS.PANEL_BG, alpha: 0.86 });
    glass.filterArea = new PIXI.Rectangle(325, 245, 250, 300);
    glass.filters = [new PIXI.filters.BackdropBlurFilter()];
    this.root.addChild(glass);
    this.frame(325, 245, 250, 300);
    const title = new PIXI.Text({
      text: "PAUSED",
      style: {
        fontFamily: "Quantico",
        fontSize: 32,
        fontWeight: "bold",
        fill: COLORS.FIELD_TEXT,
      },
    });
    title.anchor.set(0.5);
    title.position.set(450, 280);
    this.root.addChild(title);
    this.menu.addItem(
      this.button("RESUME", 345, 325, 210, () => this.resume()),
    );
    this.menu.addItem(
      this.button("SETTINGS", 345, 385, 210, () => this.onSettings?.()),
    );
    this.menu.addItem(
      this.button("EXIT TO MAIN MENU", 345, 445, 210, () => this.onExit?.()),
    );
    // Put focusable controls above the frosted panel background.
    this.root.addChild(this.menuStack);
  }
  activateSelection(consumedActions = [], source = "keyboard") {
    this.consumeGameplayInput?.(consumedActions);
    this.menuStack.trigger(source);
  }
  resume(consumedActions = []) {
    // Close before notifying gameplay. This makes P/Escape a single, direct
    // unpause operation instead of leaving a live panel for another tick.
    this.consumeGameplayInput?.(consumedActions);
    this.close();
    this.onResume?.();
  }
  handleKeyboard(event) {
    if (!this.root.visible) return;
    // Pause is a modal owner of keyboard input. preventDefault alone does
    // not stop InputManager's listener on window, so it would receive the
    // same Escape/P/Space press after this panel closed and re-pause or act.
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = event.key.toLowerCase();
    if (key === "escape" || key === "p") {
      if (!event.repeat) this.resume(["pause"]);
      return;
    }
    if (event.repeat) return;
    if (key === "arrowup") {
      this.consumeGameplayInput?.(["cw"]);
      this.menuStack.navigate("up", "keyboard");
    } else if (key === "arrowdown") {
      this.consumeGameplayInput?.(["softDrop"]);
      this.menuStack.navigate("down", "keyboard");
    } else if (key === "enter") {
      this.activateSelection(["start"]);
    } else if (key === " ") {
      this.activateSelection(["hardDrop"]);
    }
  }
  pollController() {
    if (!this.root.visible) return;
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!pad) return;
    const prior = this.previous ?? [];
    const edge = (index) => !!pad.buttons[index]?.pressed && !prior[index];
    if (edge(GAMEPAD_BUTTON.DPAD_UP)) {
      this.consumeGameplayInput?.(["hardDrop"]);
      this.menuStack.navigate("up", "gamepad");
    } else if (edge(GAMEPAD_BUTTON.DPAD_DOWN)) {
      this.consumeGameplayInput?.(["softDrop"]);
      this.menuStack.navigate("down", "gamepad");
    } else if (edge(GAMEPAD_BUTTON.A)) this.activateSelection(["ccw"], "gamepad");
    else if (edge(GAMEPAD_BUTTON.B)) this.resume(["cw"]);
    else if (edge(GAMEPAD_BUTTON.START)) this.resume(["pause"]);
    this.previous = pad.buttons.map((button) => !!button.pressed);
  }
  open() {
    console.log("[PhysTrix] Pause menu opened");
    this.root.position.set(
      (this.app.screen.width - 900) / 2,
      (this.app.screen.height - 900) / 2,
    );
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    // Ignore the Start press which opened pause until it is released.
    this.previous = pad ? pad.buttons.map((button) => !!button.pressed) : [];
    this.root.visible = true;
    this.menuStack.activate(this.menu, this.menu.focusedIndex);
  }
  close() {
    if (!this.root.visible) return;
    console.log("[PhysTrix] Pause menu closed");
    this.previous = null;
    this.root.visible = false;
  }
  destroy() {
    this.destroyed = true;
    removeEventListener("keydown", this.onKeyDown);
    this.app.ticker.remove(this.tick);
    this.root.destroy({ children: true });
  }
}
