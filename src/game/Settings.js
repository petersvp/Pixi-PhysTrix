/**
 * Provides the default gameplay and audio settings.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { applyControlSnapshot, controlSnapshot } from "../config/controls.js";

const SETTINGS_COOKIE = "phystrix-settings";

export const defaultSettings = () => ({
  das: 300,
  arr: 25,
  dcd: 300,
  lockDelay: 500,
  lockResetLimit: 15,
  sdf: 40,
  ghost: true,
  // When enabled, both halves of a playfield tap clockwise. This is useful
  // for one-handed touch play and remains off by default.
  touchAlwaysCw: false,
  master: 0.65,
  effects: 0.8,
});

let sharedSettings = null;

function readCookie() {
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${SETTINGS_COOKIE}=`))
    ?.split("=")[1];
  try {
    return value ? JSON.parse(decodeURIComponent(value)) : {};
  } catch {
    return {};
  }
}

export function loadPersistentSettings() {
  if (sharedSettings) return sharedSettings;
  const saved = readCookie();
  sharedSettings = { ...defaultSettings(), ...(saved.settings || {}) };
  applyControlSnapshot(saved.controls);
  return sharedSettings;
}

export function savePersistentSettings(settings = sharedSettings) {
  const payload = encodeURIComponent(
    JSON.stringify({ settings, controls: controlSnapshot() }),
  );
  document.cookie = `${SETTINGS_COOKIE}=${payload}; max-age=31536000; path=/; samesite=lax`;
}
