/**
 * Defines keyboard and standard gamepad bindings for gameplay actions.
 *
 * This module is part of the config layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export const KEYBINDS = {
  start: ["Enter"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  cw: ["ArrowUp", "KeyX"],
  ccw: ["KeyZ"],
  rotate180: ["KeyA"],
  softDrop: ["ArrowDown"],
  hardDrop: ["Space"],
  release: ["KeyC", "KeyV"],
  hold: ["KeyC", "ShiftLeft", "ShiftRight"],
  // Pause is deliberately fixed: Escape on keyboard and Start on gamepad.
  pause: ["Escape"],
};
// W3C standard gamepad mapping. Keep browser button indices in one place.
export const GAMEPAD_BUTTON = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LEFT_BUMPER: 4,
  RIGHT_BUMPER: 5,
  LEFT_TRIGGER: 6,
  RIGHT_TRIGGER: 7,
  BACK: 8,
  START: 9,
  LEFT_STICK: 10,
  RIGHT_STICK: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  HOME: 16,
});

export const GAMEPAD_BINDS = {
  hardDrop: GAMEPAD_BUTTON.DPAD_UP,
  release: GAMEPAD_BUTTON.X,
  softDrop: GAMEPAD_BUTTON.DPAD_DOWN,
  left: GAMEPAD_BUTTON.DPAD_LEFT,
  right: GAMEPAD_BUTTON.DPAD_RIGHT,
  ccw: GAMEPAD_BUTTON.A,
  cw: GAMEPAD_BUTTON.B,
  rotate180: GAMEPAD_BUTTON.Y,
  hold: [GAMEPAD_BUTTON.RIGHT_BUMPER, GAMEPAD_BUTTON.RIGHT_TRIGGER],
  pause: GAMEPAD_BUTTON.START,
};

// Standard Gamepad API button labels used by the controls screen. Bindings
// remain numeric internally because those indices are what browsers provide.
export const GAMEPAD_BUTTON_LABELS = Object.freeze([
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
  "Back", "Start", "L3", "R3", "D-pad Up", "D-pad Down",
  "D-pad Left", "D-pad Right", "Home",
]);

export function gamepadButtonLabel(button) {
  const index = Number(button);
  return GAMEPAD_BUTTON_LABELS[index] || `Button ${index}`;
}

export function gamepadBindingLabel(buttons) {
  return (Array.isArray(buttons) ? buttons : [buttons])
    .map(gamepadButtonLabel)
    .join(" / ");
}

export const controlSnapshot = () => ({
  keys: Object.fromEntries(
    Object.entries(KEYBINDS).map(([action, keys]) => [action, [...keys]]),
  ),
  gamepad: Object.fromEntries(
    Object.entries(GAMEPAD_BINDS).map(([action, buttons]) => [
      action,
      Array.isArray(buttons) ? [...buttons] : buttons,
    ]),
  ),
});

export function applyControlSnapshot(snapshot = {}) {
  const legacyToCode = {
    " ": "Space", x: "KeyX", z: "KeyZ", a: "KeyA", c: "KeyC", v: "KeyV",
    Shift: "ShiftLeft",
  };
  Object.entries(snapshot.keys || {}).forEach(([action, keys]) => {
    if (action === "pause") return;
    if (KEYBINDS[action] && Array.isArray(keys) && keys.length)
      KEYBINDS[action] = keys.map((key) => legacyToCode[String(key)] || String(key));
  });
  Object.entries(snapshot.gamepad || {}).forEach(([action, buttons]) => {
    if (action === "pause") return;
    if (
      GAMEPAD_BINDS[action] &&
      (Number.isInteger(buttons) || Array.isArray(buttons))
    )
      GAMEPAD_BINDS[action] = Array.isArray(buttons)
        ? buttons.map(Number)
        : Number(buttons);
  });
}
