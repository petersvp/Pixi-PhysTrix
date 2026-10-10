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
      const key = e.code || e.key;
      // Gameplay keys must stay inside the embedded game. In particular,
      // arrows and Space would otherwise scroll the Itch.io parent frame.
      // Resolve the bindings at event time because controls can be remapped.
      const isGameplayKey = Object.values(KEYBINDS).some((keys) => keys.includes(key));
      if (isGameplayKey && e.cancelable) e.preventDefault();
      if (!this.down.has(key)) this.pressed.add(key);
      this.down.add(key);
    };
    this.keyup = (e) => {
      this.down.delete(e.code || e.key);
    };
    // A keyup is not delivered to this window when the browser, an iframe, or
    // another DOM control takes focus mid-press. Do not leave movement/actions
    // latched when the game becomes active again. Gamepad state deliberately
    // remains independent: it is polled by the game rather than tied to DOM
    // keyboard focus.
    this.clearKeyboardState = () => {
      this.down.clear();
      this.pressed.clear();
    };
    this.blur = () => this.clearKeyboardState();
    this.visibilityChange = () => {
      if (document.hidden) this.clearKeyboardState();
    };
    target.addEventListener("keydown", this.keydown);
    target.addEventListener("keyup", this.keyup);
    target.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibilityChange);
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
    hold("left", GAMEPAD_BINDS.left);
    hold("right", GAMEPAD_BINDS.right);
    hold("softDrop", GAMEPAD_BINDS.softDrop);
    // Start is pause-only. A remains the confirm/start button, including for
    // the visible game-over action; combining them made Start both open the
    // menu and accidentally activate/restart the game underneath it.
    if (edge(GAMEPAD_BUTTON.A)) this.gamepadPressed.add("start");
    if (GAMEPAD_BINDS.hold.some(edge)) this.gamepadPressed.add("hold");
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
    this.target.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibilityChange);
  }
}
