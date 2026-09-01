/**
 * Defines reusable polyomino bag construction for room presets.
 * Each function returns an unshuffled array of immutable definitions.
 * PieceQueue owns the final shuffle and consumes the selected bag.
 * Special challenge bags are available through hash-routed presets only.
 * The active bagGenerator setting remains in gameplayConstants.js.
 */

import {
  definitionsForOrder,
  SPECIAL_POLYOMINO_DEFINITIONS,
} from "../game/PolyominoDefinitions.js";

const uniquePolyominos = (order, count, random) => {
  const pool = [...definitionsForOrder(order)];
  const result = [];
  for (let index = 0; index < count && pool.length; index++) {
    const picked = Math.floor(random() * pool.length);
    result.push(pool.splice(picked, 1)[0]);
  }
  return result;
};

export function createHardModeBag(
  random = Math.random,
  forceCPentominoes = false,
) {
  const bag = [...definitionsForOrder(4), ...uniquePolyominos(5, 1, random)];
  // The standard PU pentomino is the C/U family shape. Keep three forced
  // copies in the Hard preset temporarily to exercise sticky interlocks.
  if (forceCPentominoes) {
    const cPentomino = definitionsForOrder(5).find(({ id }) => id === "PU");
    bag.push(...Array.from({ length: 3 }, () => cPentomino));
  }
  if (random() < 0.1) {
    const order = 6 + Math.floor(random() * 3);
    bag.push(...uniquePolyominos(order, 1, random));
  }
  return bag;
}

// The tetra-penta room keeps the tetromino pool dominant and adds a single
// pentomino set for the extra geometry pressure.
export function createTetrominoPentominoBag() {
  const tetrominoes = definitionsForOrder(4);
  const pentominoes = definitionsForOrder(5);
  return [
    ...tetrominoes,
    ...tetrominoes,
    ...tetrominoes,
    ...tetrominoes,
    ...pentominoes,
  ];
}

export function createLine10Bag() {
  return [SPECIAL_POLYOMINO_DEFINITIONS.LINE_10];
}

export function createCube4Bag() {
  return [
    SPECIAL_POLYOMINO_DEFINITIONS.CUBE_4,
    SPECIAL_POLYOMINO_DEFINITIONS.RECTANGLE_2X4,
  ];
}

export function createCubesBag() {
  return [
    SPECIAL_POLYOMINO_DEFINITIONS.CUBE_4,
    SPECIAL_POLYOMINO_DEFINITIONS.RECTANGLE_2X4,
    SPECIAL_POLYOMINO_DEFINITIONS.OUTLINE_CUBE_4,
    definitionsForOrder(4).find(({ id }) => id === "O"),
  ];
}

export const POLYOMINO_ORDER_DISTRIBUTION = { 5: 1 };

// This bag intentionally prefers the weighted order entries defined above.
export function createTrueRandomBag(random = Math.random) {
  const entries = Object.entries(POLYOMINO_ORDER_DISTRIBUTION).filter(
    ([, weight]) => Number(weight) > 0,
  );
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  let roll = random() * total;
  const order = Number(
    entries.find(([, weight]) => (roll -= Number(weight)) <= 0)?.[0] || 4,
  );
  const catalog = definitionsForOrder(order);
  return [catalog[Math.floor(random() * catalog.length)]];
}

// These presets map directly to the room preset names exposed in the menu.
export function bagGeneratorForPreset(preset, random = Math.random, fallback) {
  if (preset === "tetrominoes") return definitionsForOrder(4);
  if (preset === "pentominoes") return definitionsForOrder(5);
  if (preset === "tetra-penta") return createTetrominoPentominoBag();
  if (preset === "hard") return createHardModeBag(random);
  if (preset === "1x10") return createLine10Bag();
  if (preset === "4x4") return createCube4Bag();
  if (preset === "cubes") return createCubesBag();
  return typeof fallback === "function" ? fallback(random) : fallback;
}
