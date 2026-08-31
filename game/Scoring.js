/**
 * Calculates Guideline line-clear score values.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

const score = [0, 100, 300, 500, 800];
const allClearScore = [0, 800, 1200, 1800, 2000];

// Spin power grows by two for each order above four: tetrominoes are 1x,
// pentominoes 3x, hexominoes 5x, heptominoes 7x, and so on.
export function polyominoSpinPower(order) {
  return Math.max(1, Number(order) * 2 - 7);
}
export function guidelineScore(lines, level) {
  return (score[lines] || 0) * level;
}
export function guidelineAllClearScore(lines, level) {
  return (allClearScore[Math.min(4, lines)] || 0) * level;
}

// Guideline combo scoring starts with the second consecutive successful clear.
export function guidelineComboScore(combo, level) {
  return combo > 1 ? 50 * (combo - 1) * level : 0;
}

export function guidelineSpinScore(spin, lines, level, order = 4) {
  const tables = {
    "T-SPIN MINI": [100, 200, 400, 0],
    "T-SPIN": [400, 800, 1200, 1600],
  };
  // Non-T rotations are a PhysTrix extension. They use the full-spin table
  // while preserving the conventional T-spin and mini-spin values above.
  const values = tables[spin] || (spin ? [400, 800, 1200, 1600] : null);
  return values
    ? (values[Math.min(3, lines)] || 0) * level * polyominoSpinPower(order)
    : 0;
}
