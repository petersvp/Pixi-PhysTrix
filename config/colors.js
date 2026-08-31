/**
 * Defines the display palette used across the game UI and render passes.
 *
 * This module is part of the config layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export const POLYOMINO_COLORS = Object.freeze({
  I: 0x27d9f5,
  J: 0x3877ff,
  L: 0xff9d2e,
  O: 0xffdf38,
  S: 0x44dc67,
  T: 0xb75cff,
  Z: 0xff4d68,
});

// Hexominoes and larger generated pieces deliberately share one neutral color
// so the high-order room rules remain readable instead of rainbow-noisy.
export const HIGH_ORDER_POLYOMINO_COLOR = 0xaeb7c5;

export const COLORS = Object.freeze({
  WHITE: 0xffffff,
  BLACK: 0x000000,
  APP_BACKGROUND: 0x07101f,
  MAIN_MENU_BG: 0x0a1830,
  FIELD_BG: 0x0b1830,
  FIELD_GRID: 0x46617e,
  FIELD_FRAME_OUTER: 0x1e8dff,
  FIELD_FRAME_MAIN: 0x31c9ff,
  FIELD_FRAME_HIGHLIGHT: 0xd5f7ff,
  FIELD_SHADOW: 0x001b35,
  FIELD_TEXT: 0x74d6ff,
  CALLOUT_TEXT: 0xffffff,
  CALLOUT_STROKE: 0x06101f,
  CALLOUT_CHAIN: 0xffe54f,
  SPIN_TEXT: 0xff83df,
  MAJOR_CLEAR_TEXT: 0xffd34d,
  PERFECT_CLEAR_GOLD: 0xffd34d,
  PERFECT_CLEAR_GREEN: 0x8dff62,
  CLEAR_TEXT: 0x9eeaff,
  SCORE_TEXT: 0x62f59a,
  PANEL_BG_DEEP: 0x0b1c35,
  PANEL_BG: 0x102644,
  PANEL_BORDER: 0x3c78b8,
  PANEL_ACCENT: 0x4bc9ff,
  HUD_LABEL: 0xaed4ff,
  HUD_VALUE: 0xf2f8ff,
  HUD_BUTTON_LABEL: 0x94bee8,
  HUD_BUTTON_TEXT: 0xe9f5ff,
  MENU_LOGO: 0x69ccff,
  MENU_LOGO_TEXT: 0xf1f7ff,
  PHYSICS_HIGHLIGHT: 0xffffb0,
});
