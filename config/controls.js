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
  cw: ["ArrowUp", "x"],
  ccw: ["z"],
  rotate180: ["a"],
  softDrop: ["ArrowDown"],
  hardDrop: [" "],
  release: ["c", "v"],
  hold: ["c", "Shift"],
  pause: ["p", "Escape"],
};
export const GAMEPAD_BINDS = {
  hardDrop: 12,
  release: 2,
  softDrop: 13,
  left: 14,
  right: 15,
  ccw: 0,
  cw: 1,
  rotate180: 3,
  hold: [5, 7],
  pause: 9,
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
  Object.entries(snapshot.keys || {}).forEach(([action, keys]) => {
    if (KEYBINDS[action] && Array.isArray(keys) && keys.length)
      KEYBINDS[action] = keys.map(String);
  });
  Object.entries(snapshot.gamepad || {}).forEach(([action, buttons]) => {
    if (
      GAMEPAD_BINDS[action] &&
      (Number.isInteger(buttons) || Array.isArray(buttons))
    )
      GAMEPAD_BINDS[action] = Array.isArray(buttons)
        ? buttons.map(Number)
        : Number(buttons);
  });
}
