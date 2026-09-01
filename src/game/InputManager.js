/**
 * Normalizes keyboard and standard gamepad input into gameplay actions.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { GAMEPAD_BUTTON, KEYBINDS, GAMEPAD_BINDS } from "../config/controls.js";
export class InputManager {
  constructor(target = window) {
    this.target = target;
    this.down = new Set();
    this.gamepadDown = new Set();
    this.pressed = new Set();
    // Gamepad actions must not be translated through keyboard key names:
    // both Hold and physics Release intentionally use C on keyboard, which
    // previously made an RB/RT press look like a Release press.
    this.gamepadPressed = new Set();
    this.keydown = (e) => {
      if (!this.down.has(e.key)) this.pressed.add(e.key);
      this.down.add(e.key);
    };
    this.keyup = (e) => this.down.delete(e.key);
    target.addEventListener("keydown", this.keydown);
    target.addEventListener("keyup", this.keyup);
  }
  held(action) {
    return (
      KEYBINDS[action].some((key) => this.down.has(key)) ||
      this.gamepadDown.has(action)
    );
  }
  take(action) {
    if (this.gamepadPressed.delete(action)) return true;
    const key = KEYBINDS[action].find((candidate) =>
      this.pressed.has(candidate),
    );
    if (!key) return false;
    this.pressed.delete(key);
    return true;
  }
  pollGamepad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!pad) return;
    const previous = this.previous || [];
    const edge = (i) => !!pad.buttons[i]?.pressed && !previous[i];
    const press = (action, index) =>
      edge(index) && this.gamepadPressed.add(action);
    const hold = (action, index) => {
      if (pad.buttons[index]?.pressed) this.gamepadDown.add(action);
      else this.gamepadDown.delete(action);
    };
    press("hardDrop", GAMEPAD_BINDS.hardDrop);
    press("release", GAMEPAD_BINDS.release);
    press("softDrop", GAMEPAD_BINDS.softDrop);
    press("ccw", GAMEPAD_BINDS.ccw);
    press("cw", GAMEPAD_BINDS.cw);
    press("rotate180", GAMEPAD_BINDS.rotate180);
    press("pause", GAMEPAD_BINDS.pause);
    hold("ccw", GAMEPAD_BINDS.ccw);
    hold("cw", GAMEPAD_BINDS.cw);
    hold("rotate180", GAMEPAD_BINDS.rotate180);
    if (edge(GAMEPAD_BUTTON.A) || edge(GAMEPAD_BINDS.pause)) this.gamepadPressed.add("start");
    if (GAMEPAD_BINDS.hold.some(edge)) this.gamepadPressed.add("hold");
    if (pad.buttons[GAMEPAD_BINDS.left]?.pressed) this.down.add("ArrowLeft");
    else this.down.delete("ArrowLeft");
    if (pad.buttons[GAMEPAD_BINDS.right]?.pressed) this.down.add("ArrowRight");
    else this.down.delete("ArrowRight");
    if (pad.buttons[GAMEPAD_BINDS.softDrop]?.pressed)
      this.down.add("ArrowDown");
    else this.down.delete("ArrowDown");
    this.previous = pad.buttons.map((button) => button.pressed);
  }
  endFrame() {
    this.pressed.clear();
    this.gamepadPressed.clear();
  }
  consume(action) {
    KEYBINDS[action].forEach((key) => this.pressed.delete(key));
    this.gamepadPressed.delete(action);
    // A modal may consume a gamepad action before this manager's next poll.
    // Snapshot held buttons now so that very same press cannot become a new
    // edge one ticker later (for example Start closing Pause then reopening it).
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (pad) this.previous = pad.buttons.map((button) => !!button.pressed);
  }
  destroy() {
    this.target.removeEventListener("keydown", this.keydown);
    this.target.removeEventListener("keyup", this.keyup);
  }
}
