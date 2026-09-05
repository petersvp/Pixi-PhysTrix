/**
 * Defines Super Rotation System wall-kick data for all 90-degree turns.
 * JLSTZ pieces share one table while the I piece uses its special table.
 * Coordinates use screen space, where positive Y is downward.
 * The polyomino controller reads these tables without mutating them.
 * Modern 180-degree rotation is implemented as two atomic SRS turns.
 */

import { COLS } from "../config/gameplayConstants.js";

export const JLSTZ_KICKS = Object.freeze({
  "0>1": [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  "1>0": [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  "1>2": [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  "2>1": [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  "2>3": [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  "3>2": [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  "3>0": [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  "0>3": [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
});
export const I_KICKS = Object.freeze({
  "0>1": [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  "1>0": [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  "1>2": [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
  "2>1": [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
  "2>3": [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  "3>2": [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  "3>0": [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
  "0>3": [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
});

// Guideline tables above remain exact for tetrominoes. Higher orders have no
// official SRS data, so build a deterministic kick search from piece order.
export const generatedPolyominoKicks = (order) => {
  const reach = Math.min(COLS, Math.max(1, Math.ceil((order - 3) / 2)));
  const kicks = [[0, 0]];
  for (let distance = 1; distance <= reach; distance++) {
    kicks.push([-distance, 0], [distance, 0], [-distance, -1], [distance, -1]);
  }
  for (let lift = 2; lift <= reach + 1; lift++)
    kicks.push([0, -lift], [-1, -lift], [1, -lift]);
  return kicks;
};
export const rotationKicksFor = (definition, from, to) => {
  if (definition.order === 4)
    return (definition.id === "I" ? I_KICKS : JLSTZ_KICKS)[`${from}>${to}`];
  return generatedPolyominoKicks(definition.order);
};
