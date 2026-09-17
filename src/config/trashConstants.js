/**
 * Defines the optional Trash progression mode shared by Classic and Physics.
 *
 * Trash is intentionally random rather than versus-style garbage with holes.
 * Its material, grey color, density, and maximum depth are configurable here.
 * The maximum preserves two clear rows above a full-height board.
 */

import { ROWS } from "./gameplayConstants.js";

export const TRASH_SKIN_FILE = "skin-trash.json";
export const TRASH_MINO_COLOR = 0xa7b2c0;
export const TRASH_CELL_FILL_CHANCE = 0.6;
export const TRASH_UP_TRANSITION_MS = 1000;
export const TRASH_UP_CALLOUT_COLOR = 0xffd34d;

// Trash has its own durability: it remains stationary and counts toward trash
// objectives in every state. This is intentionally separate from PvP metal
// drops, whose final state becomes an attachment mino.
export const damageTrashMino = (tile) => {
  if (!tile?.trash) return false;
  const hp = Math.max(1, Math.floor(Number(tile.trashHp) || 1));
  if (hp <= 1) return false;
  tile.trashHp = hp - 1;
  if (tile.trashHp === 1) {
    tile.material = "trash";
    tile.broken = { top: false, right: false, bottom: false, left: false };
  } else {
    tile.material = "metal";
    tile.broken = { top: true, right: true, bottom: true, left: true };
  }
  return true;
};
export const MAX_TRASH_LEVEL = ROWS - 2;
