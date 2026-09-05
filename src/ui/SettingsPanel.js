/**
 * Provides the persistent Pixi settings overlay.
 * It is attached to the application stage instead of a disposable scene.
 * Handling values and control bindings are edited live and saved to a cookie.
 * Settings are entered from the separate pause overlay and retain pause state.
 */

import {
  KEYBINDS,
  GAMEPAD_BINDS,
  applyControlSnapshot,
  controlSnapshot,
  GAMEPAD_BUTTON,
  gamepadBindingLabel,
} from "../config/controls.js";
import { savePersistentSettings } from "../game/Settings.js";
import { COLORS } from "../config/colors.js";
import { AdvancedLineRenderer } from "../render/AdvancedLineRenderer.js";
import { UIMenu } from "./UIMenu.js";
import { UIMenuItem } from "./UIMenuItem.js";
import { UIMenuStack } from "./UIMenuStack.js";
import {
  SETTINGS_BIND_BUTTON_WIDTH,
  SETTINGS_BIND_PAD_BUTTON_WIDTH,
  SETTINGS_BIND_ROW_HEIGHT,
  SETTINGS_CONTENT_PADDING_X,
  SETTINGS_PANEL_HEIGHT,
  SETTINGS_PANEL_WIDTH,
  SETTINGS_PANEL_X,
  SETTINGS_PANEL_Y,
  SETTINGS_SLIDER_ROW_HEIGHT,
  SETTINGS_SLIDER_LABEL_X,
  SETTINGS_SLIDER_TRACK_WIDTH,
  SETTINGS_SLIDER_TRACK_X,
  SETTINGS_SLIDER_VALUE_X,
} from "../config/uiConstants.js";

const HANDLING_SLIDERS = [
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
];
const labelFor = (action) =>
  ({
    cw: "ROTATE CW",
    ccw: "ROTATE CCW",
    rotate180: "ROTATE 180",
    softDrop: "SOFT DROP",
    hardDrop: "HARD DROP",
    hold: "POCKET",
  })[action] || action.toUpperCase();
const HANDLING_KEYS = new Set(HANDLING_SLIDERS.map(([, key]) => key));

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
    this.gamepadTick = () => {
      if (!this.destroyed) this.captureGamepad();
    };
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
  button(label, x, y, width, onTap, { navigable = true, height = 30 } = {}) {
    const node = new PIXI.Container();
    node.position.set(x, y);
    node.eventMode = "static";
    node.cursor = "pointer";
    const box = new PIXI.Graphics()
      .roundRect(0, 0, width, height, 6)
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
    text.position.set(width / 2, height / 2);
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
      .roundRect(SETTINGS_PANEL_X, SETTINGS_PANEL_Y, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT, 14)
      .fill({ color: COLORS.PANEL_BG, alpha: 0.86 });
    glass.filterArea = new PIXI.Rectangle(SETTINGS_PANEL_X, SETTINGS_PANEL_Y, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT);
    glass.filters = [new PIXI.filters.BackdropBlurFilter({ strength: 32, quality: 8 })];
    this.root.addChild(glass);
    this.frame(SETTINGS_PANEL_X, SETTINGS_PANEL_Y, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT);
    this.button("X", 266, 36, 34, () => this.cancel(), { navigable: false });
    this.text("SETTINGS", 314, 38, 25, COLORS.FIELD_TEXT);
    this.text("HANDLING", 270, 86, 15, COLORS.FIELD_TEXT);
    HANDLING_SLIDERS.forEach(([name, key, min, max], index) =>
      this.slider(name, key, min, max, 116 + index * SETTINGS_SLIDER_ROW_HEIGHT),
    );
    this.touchToggle(270, 280);
    this.text("KEYBOARD / GAMEPAD BINDS", 270, 322, 15, COLORS.FIELD_TEXT);
    ACTIONS.forEach((action, index) => this.bindRow(action, 344 + index * SETTINGS_BIND_ROW_HEIGHT));
    this.status = this.text(
      "Click KEY or PAD, then press an input.",
      270,
      602,
      12,
      COLORS.HUD_LABEL,
    );
    this.button("SAVE", 390, 625, 110, () => this.save());
    this.button("CANCEL", 512, 625, 110, () => this.cancel());
    // Navigation controls render last, above the opaque settings card.
    this.root.addChild(this.menuStack);
  }
  touchToggle(x, y) {
    const width = SETTINGS_PANEL_WIDTH - 20;
    const view = new PIXI.Container();
    view.position.set(x, y - 4);
    const enabled = this.settings.touchAlwaysCw;
    const switchWidth = 46;
    const switchHeight = 22;
    const switchColor = enabled ? 0x13bd00 : 0xa60013;
    const capsule = new PIXI.Graphics()
      .roundRect(0, 0, switchWidth, switchHeight, switchHeight / 2)
      .fill(switchColor);
    const knob = new PIXI.Graphics()
      .circle(enabled ? switchWidth - 11 : 11, switchHeight / 2, 8)
      .fill(COLORS.HUD_VALUE);
    const label = new PIXI.Text({
      text: "TAP ALWAYS CW",
      style: {
        fontFamily: "Quantico",
        fontSize: 14,
        fontWeight: "bold",
        fill: COLORS.HUD_VALUE,
      },
    });
    label.position.set(switchWidth + 12, 2);
    view.addChild(capsule, knob, label);
    view.eventMode = "static";
    view.cursor = "pointer";
    const outline = new PIXI.Graphics()
      .roundRect(x - 8, y - 11, width, 31, 6)
      .stroke({ width: 3, color: 0xff9d22, alpha: 0.66 });
    outline.visible = false;
    this.root.addChild(outline, view);
    this.menu.addItem(new UIMenuItem({
      id: "touchAlwaysCw",
      view,
      onTrigger: () => {
        this.settings.touchAlwaysCw = !this.settings.touchAlwaysCw;
        this.redrawKeepingFocus();
      },
      render: ({ selected }) => { outline.visible = selected; },
    }));
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
    this.text(name, SETTINGS_SLIDER_LABEL_X, y, 14);
    const value = this.text(
      String(this.settings[key]),
      SETTINGS_SLIDER_VALUE_X,
      y,
      14,
      COLORS.FIELD_TEXT,
    );
    value.anchor.set(1, 0);
    const focusOutline = new PIXI.Graphics()
      .roundRect(
        SETTINGS_PANEL_X + SETTINGS_CONTENT_PADDING_X - 8,
        y - 7,
        SETTINGS_PANEL_WIDTH - (SETTINGS_CONTENT_PADDING_X - 8) * 2,
        27,
        6,
      )
      .stroke({ width: 3, color: 0xff9d22, alpha: 0.66 });
    focusOutline.visible = false;
    focusOutline.eventMode = "none";
    this.root.addChild(focusOutline);
    const track = new PIXI.Graphics()
      .moveTo(SETTINGS_SLIDER_TRACK_X, y + 8)
      .lineTo(SETTINGS_SLIDER_TRACK_X + SETTINGS_SLIDER_TRACK_WIDTH, y + 8)
      .stroke({ width: 6, color: COLORS.PANEL_BORDER })
      .moveTo(SETTINGS_SLIDER_TRACK_X, y + 8)
      .lineTo(SETTINGS_SLIDER_TRACK_X + ((this.settings[key] - min) / (max - min)) * SETTINGS_SLIDER_TRACK_WIDTH, y + 8)
      .stroke({ width: 6, color: COLORS.PANEL_ACCENT });
    track.eventMode = "static";
    track.cursor = "pointer";
    const set = (event) => {
      const p = event.data.getLocalPosition(this.root);
      this.settings[key] = Math.round(
        Math.max(min, Math.min(max, min + ((p.x - SETTINGS_SLIDER_TRACK_X) / SETTINGS_SLIDER_TRACK_WIDTH) * (max - min))),
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
        // Timing sliders are direct controls: when selected, Left/Right
        // changes them immediately. They intentionally do not enter held mode.
        onTrigger: () => {},
        onNavigate: (direction) => {
          const step = Math.max(1, Math.round((max - min) / 100));
          this.settings[key] = Math.max(
            min,
            Math.min(
              max,
              this.settings[key] + (direction === "right" ? step : -step),
            ),
          );
          this.redrawKeepingFocus();
        },
        render: ({ selected, held }) => {
          focusOutline.visible = selected;
          track.alpha = selected ? 1 : 0.68;
        },
      }),
    );
  }
  redrawKeepingFocus() {
    const focusedIndex = this.menu?.focusedIndex ?? 0;
    this.draw();
    this.menuStack.activate(this.menu, focusedIndex);
  }
  adjustFocusedTiming(direction, source) {
    const item = this.menuStack.activeMenu?.focusedItem;
    if (!item || !HANDLING_KEYS.has(item.id)) return false;
    item.navigate(direction, { source });
    return true;
  }
  bindRow(action, y) {
    this.text(labelFor(action), 270, y + 5, 11);
    const key = KEYBINDS[action].join(" / ");
    const pad = gamepadBindingLabel(GAMEPAD_BINDS[action]);
    this.button(`KEY: ${key}`, 390, y, SETTINGS_BIND_BUTTON_WIDTH, () =>
      this.beginCapture(action, "key"), { height: 26 },
    );
    this.button(`PAD: ${pad}`, 510, y, SETTINGS_BIND_PAD_BUTTON_WIDTH, () =>
      this.beginCapture(action, "pad"), { height: 26 },
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
      if (!this.adjustFocusedTiming("left", "keyboard")) this.menuStack.navigate("left", "keyboard");
    } else if (event.key === "ArrowRight") {
      if (!this.adjustFocusedTiming("right", "keyboard")) this.menuStack.navigate("right", "keyboard");
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
    if (edge(GAMEPAD_BUTTON.DPAD_UP)) this.menuStack.navigate("up", "gamepad");
    else if (edge(GAMEPAD_BUTTON.DPAD_DOWN)) this.menuStack.navigate("down", "gamepad");
    else if (edge(GAMEPAD_BUTTON.DPAD_LEFT)) {
      if (!this.adjustFocusedTiming("left", "gamepad")) this.menuStack.navigate("left", "gamepad");
    } else if (edge(GAMEPAD_BUTTON.DPAD_RIGHT)) {
      if (!this.adjustFocusedTiming("right", "gamepad")) this.menuStack.navigate("right", "gamepad");
    } else if (edge(GAMEPAD_BUTTON.A)) this.menuStack.trigger("gamepad");
  }
  open() {
    console.log("[PhysTrix] Settings menu opened");
    this.root.position.set(
      (this.app.screen.width - 900) / 2,
      (this.app.screen.height - 720) / 2,
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
    this.destroyed = true;
    removeEventListener("keydown", this.onKeyDown);
    this.app.ticker.remove(this.gamepadTick);
    this.root.destroy({ children: true });
  }
}
