/**
 * Provides the persistent Pixi settings overlay.
 * It is attached to the application stage instead of a disposable scene.
 * Timing values and control bindings are edited live and saved to a cookie.
 * Settings are entered from the separate pause overlay and retain pause state.
 */

import {
  KEYBINDS,
  GAMEPAD_BINDS,
  applyControlSnapshot,
  controlSnapshot,
  gamepadBindingLabel,
} from "../config/controls.js";
import { savePersistentSettings } from "../game/Settings.js";
import { COLORS } from "../config/colors.js";
import { AdvancedLineRenderer } from "../render/AdvancedLineRenderer.js";
import { UIMenu } from "./UIMenu.js";
import { UIMenuItem } from "./UIMenuItem.js";
import { UIMenuStack } from "./UIMenuStack.js";

const TIMINGS = [
  ["DAS", "das", 0, 500],
  ["ARR", "arr", 0, 100],
  ["DCD", "dcd", 0, 500],
  ["SDF", "sdf", 1, 60],
];
const ACTIONS = [
  "left",
  "right",
  "cw",
  "ccw",
  "rotate180",
  "softDrop",
  "hardDrop",
  "hold",
  "release",
  "pause",
];
const labelFor = (action) =>
  ({
    cw: "ROTATE CW",
    ccw: "ROTATE CCW",
    rotate180: "ROTATE 180",
    softDrop: "SOFT DROP",
    hardDrop: "HARD DROP",
  })[action] || action.toUpperCase();

export class SettingsPanel {
  constructor({ app, settings, onBack }) {
    Object.assign(this, { app, settings, onBack, capture: null });
    this.root = new PIXI.Container();
    this.root.label = "persistentSettingsPanel";
    this.root.visible = false;
    this.root.zIndex = 1000;
    app.stage.addChild(this.root);
    this.draw();
    this.onKeyDown = (event) => this.handleKey(event);
    addEventListener("keydown", this.onKeyDown);
    this.gamepadTick = () => this.captureGamepad();
    app.ticker.add(this.gamepadTick);
  }
  text(value, x, y, size = 16, color = COLORS.HUD_VALUE) {
    const node = new PIXI.Text({
      text: value,
      style: {
        fontFamily: "Quantico",
        fontSize: size,
        fontWeight: "bold",
        fill: color,
      },
    });
    node.position.set(x, y);
    this.root.addChild(node);
    return node;
  }
  button(label, x, y, width, onTap, { navigable = true } = {}) {
    const node = new PIXI.Container();
    node.position.set(x, y);
    node.eventMode = "static";
    node.cursor = "pointer";
    const box = new PIXI.Graphics()
      .roundRect(0, 0, width, 30, 6)
      .fill(COLORS.PANEL_BG)
      .stroke({ width: 2, color: COLORS.PANEL_ACCENT });
    const text = new PIXI.Text({
      text: label,
      style: {
        fontFamily: "Quantico",
        fontSize: 13,
        fontWeight: "bold",
        fill: COLORS.HUD_VALUE,
      },
    });
    text.anchor.set(0.5);
    text.position.set(width / 2, 15);
    node.addChild(box, text);
    if (!navigable) {
      // Pointer-only controls such as the window close X are deliberately
      // outside the navigation tree. Keyboard and gamepad focus never land
      // here, while pointer users can still tap it.
      node.on("pointertap", () => onTap());
      this.root.addChild(node);
      return node;
    }
    this.menu.addItem(
      new UIMenuItem({
        id: label,
        view: node,
        onTrigger: () => onTap(),
        render: ({ selected }) => {
          box.tint = selected ? 0xffd34d : 0xffffff;
        },
      }),
    );
    return node;
  }
  draw() {
    this.root
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    this.menuStack = new UIMenuStack();
    this.menu = new UIMenu({
      id: "settingsControls",
      direction: "vertical",
      inactiveAlpha: 1,
    });
    this.menuStack.addMenu(this.menu);
    const glass = new PIXI.Graphics()
      .roundRect(230, 30, 440, 820, 14)
      .fill({ color: COLORS.PANEL_BG, alpha: 0.86 });
    glass.filterArea = new PIXI.Rectangle(230, 30, 440, 820);
    glass.filters = [new PIXI.filters.BackdropBlurFilter({ strength: 32 })];
    this.root.addChild(glass);
    this.frame(230, 30, 440, 820);
    this.button("X", 246, 48, 34, () => this.cancel(), { navigable: false });
    this.text("SETTINGS", 294, 50, 28, COLORS.FIELD_TEXT);
    this.text("TIMING", 250, 145, 16, COLORS.FIELD_TEXT);
    TIMINGS.forEach(([name, key, min, max], index) =>
      this.slider(name, key, min, max, 180 + index * 48),
    );
    this.text("KEYBOARD / GAMEPAD BINDS", 250, 387, 16, COLORS.FIELD_TEXT);
    ACTIONS.forEach((action, index) => this.bindRow(action, 418 + index * 34));
    this.status = this.text(
      "Click KEY or PAD, then press an input.",
      250,
      770,
      12,
      COLORS.HUD_LABEL,
    );
    this.button("SAVE", 390, 805, 120, () => this.save());
    this.button("CANCEL", 530, 805, 120, () => this.cancel());
    // Navigation controls render last, above the opaque settings card.
    this.root.addChild(this.menuStack);
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
    new AdvancedLineRenderer({
      texture: AdvancedLineRenderer.getHalfParticleTexture(14),
      tint: COLORS.PANEL_ACCENT,
      leftWidth: 12,
      alpha: 0.78,
      closed: true,
      name: "settingsPanelGlow",
    }).draw(this.root, points.reverse());
  }
  slider(name, key, min, max, y) {
    this.text(name, 250, y, 14);
    const value = this.text(
      String(this.settings[key]),
      650,
      y,
      14,
      COLORS.FIELD_TEXT,
    );
    value.anchor.set(1, 0);
    const focusOutline = new PIXI.Graphics()
      .roundRect(242, y - 7, 388, 31, 6)
      .stroke({ width: 2, color: 0xff9d22, alpha: 0.96 });
    focusOutline.visible = false;
    focusOutline.eventMode = "none";
    this.root.addChild(focusOutline);
    const track = new PIXI.Graphics()
      .moveTo(350, y + 9)
      .lineTo(600, y + 9)
      .stroke({ width: 6, color: COLORS.PANEL_BORDER })
      .moveTo(350, y + 9)
      .lineTo(350 + ((this.settings[key] - min) / (max - min)) * 250, y + 9)
      .stroke({ width: 6, color: COLORS.PANEL_ACCENT });
    track.eventMode = "static";
    track.cursor = "pointer";
    const set = (event) => {
      const p = event.data.getLocalPosition(this.root);
      this.settings[key] = Math.round(
        Math.max(min, Math.min(max, min + ((p.x - 350) / 250) * (max - min))),
      );
      this.draw();
    };
    track.on("pointerdown", set).on("pointermove", (event) => {
      if (event.data.buttons) set(event);
    });
    this.menu.addItem(
      new UIMenuItem({
        id: key,
        view: track,
        onTrigger: (item) => item.setHeld(!item.held),
        onNavigate: (direction) => {
          const step = Math.max(1, Math.round((max - min) / 100));
          this.settings[key] = Math.max(
            min,
            Math.min(
              max,
              this.settings[key] + (direction === "right" ? step : -step),
            ),
          );
          this.draw();
        },
        render: ({ selected, held }) => {
          focusOutline.visible = selected || held;
          track.alpha = held ? 1 : selected ? 0.9 : 0.68;
        },
      }),
    );
  }
  bindRow(action, y) {
    this.text(labelFor(action), 250, y + 6, 12);
    const key = KEYBINDS[action].join(" / ");
    const pad = gamepadBindingLabel(GAMEPAD_BINDS[action]);
    this.button(`KEY: ${key}`, 390, y, 130, () =>
      this.beginCapture(action, "key"),
    );
    this.button(`PAD: ${pad}`, 530, y, 120, () =>
      this.beginCapture(action, "pad"),
    );
  }
  beginCapture(action, type) {
    this.capture = { action, type };
    this.status.text = `Press a ${type === "key" ? "key" : "gamepad button"} for ${labelFor(action)}...`;
  }
  handleKey(event) {
    if (!this.root.visible) return;
    // Settings is modal too. Keep its inputs out of the live game and avoid
    // the opening/closing key reaching another persistent overlay listener.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.capture?.type === "key") {
      event.preventDefault();
      KEYBINDS[this.capture.action] = [event.key];
      this.capture = null;
      this.draw();
      return;
    }
    if (event.key === "Escape") {
      this.cancel();
    } else if (event.key === "ArrowUp") {
      this.menuStack.navigate("up", "keyboard");
    } else if (event.key === "ArrowDown") {
      this.menuStack.navigate("down", "keyboard");
    } else if (event.key === "ArrowLeft") {
      this.menuStack.navigate("left", "keyboard");
    } else if (event.key === "ArrowRight") {
      this.menuStack.navigate("right", "keyboard");
    } else if (event.key === "Enter" || event.key === " ") {
      this.menuStack.trigger("keyboard");
    }
  }
  save() {
    savePersistentSettings(this.settings);
    this.original = null;
    this.close();
    this.onBack?.();
  }
  cancel() {
    if (this.original) {
      Object.assign(this.settings, this.original.settings);
      applyControlSnapshot(this.original.controls);
    }
    this.close();
    this.onBack?.();
  }
  captureGamepad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!pad || !this.root.visible) return;
    const previous = this.previousButtons || [];
    const edge = (index) => pad.buttons[index]?.pressed && !previous[index];
    const index = pad.buttons.findIndex(
      (button, i) => button.pressed && !previous[i],
    );
    this.previousButtons = pad.buttons.map((button) => button.pressed);
    if (this.capture?.type === "pad") {
      if (index < 0) return;
      GAMEPAD_BINDS[this.capture.action] =
        this.capture.action === "hold" ? [index] : index;
      this.capture = null;
      this.draw();
      return;
    }
    if (edge(12)) this.menuStack.navigate("up", "gamepad");
    else if (edge(13)) this.menuStack.navigate("down", "gamepad");
    else if (edge(14)) this.menuStack.navigate("left", "gamepad");
    else if (edge(15)) this.menuStack.navigate("right", "gamepad");
    else if (edge(0)) this.menuStack.trigger("gamepad");
  }
  open() {
    console.log("[PhysTrix] Settings menu opened");
    this.root.position.set(
      (this.app.screen.width - 900) / 2,
      (this.app.screen.height - 900) / 2,
    );
    this.original = {
      settings: { ...this.settings },
      controls: controlSnapshot(),
    };
    // Opening Settings is often triggered by gamepad A from Pause. Seed the
    // edge detector with the current held state so that same press cannot
    // immediately trigger the top-left X button in this new menu.
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    this.previousButtons = pad
      ? pad.buttons.map((button) => button.pressed)
      : [];
    this.root.visible = true;
    this.draw();
    this.menuStack.activate(this.menu, this.menu.focusedIndex);
  }
  close() {
    if (!this.root.visible) return;
    console.log("[PhysTrix] Settings menu closed");
    this.capture = null;
    this.previousButtons = null;
    this.root.visible = false;
  }
  destroy() {
    removeEventListener("keydown", this.onKeyDown);
    this.app.ticker.remove(this.gamepadTick);
    this.root.destroy({ children: true });
  }
}
