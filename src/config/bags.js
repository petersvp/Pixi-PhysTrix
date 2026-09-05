/**
 * Defines reusable polyomino bag construction for room presets.
 * Each function returns an unshuffled array of immutable definitions.
 * PieceQueue owns the final shuffle and consumes the selected bag.
 * Special challenge bags are available through hash-routed presets only.
 * The active bagGenerator setting remains in gameplayConstants.js.
 */

import {
  definitionsForOrder,
  randomDefinitionForOrder,
  SPECIAL_POLYOMINO_DEFINITIONS,
} from "../game/PolyominoDefinitions.js";
import { COLS } from "./gameplayConstants.js";

const MAX_BAG_ENTRIES = 64;
const MAX_BAG_SET_SHAPES = 128;
const MAX_BAG_COUNT = 128;
const MAX_BAG_REPEATS = 128;
const MAX_BAG_DEFINITIONS = 4096;

const boundedBagInteger = (value, fallback, maximum, label) => {
  const numeric = Number(value);
  const safeValue = Math.min(
    maximum,
    Math.max(1, Math.floor(Number.isFinite(numeric) ? numeric : fallback)),
  );
  if (numeric !== safeValue)
    console.error("[Bag] Value was capped before generation.", {
      label,
      value,
      safeValue,
    });
  return safeValue;
};

const definitionFromRows = (shape, index) => {
  const rows = Array.isArray(shape?.rows) ? shape.rows.map(String) : ["1"];
  if (rows.length > COLS || rows.some((row) => row.length > COLS)) {
    console.warn("[Bag] Refused custom polyomino larger than the board width.", {
      index,
      width: Math.max(...rows.map((row) => row.length)),
      height: rows.length,
      boardWidth: COLS,
    });
    return null;
  }
  const matrix = rows.map((row) => [...row].map((cell) => Number(cell !== "0")));
  const order = matrix.flat().filter(Boolean).length || 1;
  return {
    id: `CUSTOM-${index}`,
    order,
    matrix: order ? matrix : [[1]],
    color: shape?.color || 0xff4d68,
    spinLabel: order > 5 ? "MEGASPIN" : `${order}-SPIN`,
  };
};

const withMaterial = (definition, materials, random) => {
  const source = Array.isArray(materials) && materials.length ? materials : [{}];
  const choices = source.slice(0, MAX_BAG_ENTRIES);
  if (choices.length !== source.length)
    console.error("[Bag] Material list was capped.", {
      count: source.length,
      safeCount: choices.length,
    });
  const total = choices.reduce((sum, material) => sum + Math.max(0, Number(material.weight) || 0), 0);
  let roll = random() * (total || choices.length);
  let index = 0;
  for (; index < choices.length - 1; index += 1) {
    roll -= total ? Math.max(0, Number(choices[index].weight) || 0) : 1;
    if (roll <= 0) break;
  }
  return { ...definition, materialIndex: index };
};

/** Builds one authored bag cycle. Empty recipes deliberately fall back to monominoes. */
export function roomBagGenerator(bag, materials, random = Math.random) {
  if (!bag || bag.preset !== "custom")
    return (bagGeneratorForPreset(bag?.preset, random, definitionsForOrder(1)) || definitionsForOrder(1))
      .map((definition) => withMaterial(definition, materials, random));
  const result = [];
  const entries = (bag.custom || []).slice(0, MAX_BAG_ENTRIES);
  if (entries.length !== (bag.custom || []).length)
    console.error("[Bag] Entry list was capped.", {
      count: (bag.custom || []).length,
      safeCount: entries.length,
    });
  entries.forEach((entry, entryIndex) => {
    const repeats = boundedBagInteger(
      entry.times,
      1,
      MAX_BAG_REPEATS,
      "times",
    );
    let source = [];
    if (entry.kind === "polyomino-set") {
      const allShapes = entry.shapes || [];
      const shapes = allShapes
        .slice(0, MAX_BAG_SET_SHAPES)
        .map((shape, index) => definitionFromRows(shape, `${entryIndex}-${index}`))
        .filter(Boolean);
      if (shapes.length !== allShapes.length)
        console.error("[Bag] Polyomino set was capped or contained invalid shapes.", {
          count: allShapes.length,
          safeCount: shapes.length,
        });
      source = entry.all === false
        ? Array.from(
            {
              length: boundedBagInteger(
                entry.count,
                1,
                MAX_BAG_COUNT,
                "polyomino-set count",
              ),
            },
            () => shapes[Math.floor(random() * shapes.length)],
          ).filter(Boolean)
        : shapes;
    } else {
      const order = Math.max(1, Math.floor(Number(entry.order) || 1));
      source = entry.all === false || order >= 7
        ? Array.from(
            {
              length: boundedBagInteger(
                entry.count,
                1,
                MAX_BAG_COUNT,
                "order count",
              ),
            },
            () => randomDefinitionForOrder(order, random),
          ).filter(Boolean)
        : [...definitionsForOrder(order)];
    }
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      if (result.length >= MAX_BAG_DEFINITIONS) {
        console.error("[Bag] Definition safety limit reached.", {
          entryIndex,
          definitions: result.length,
        });
        return result;
      }
      result.push(...source.map((definition) => withMaterial(definition, materials, random)));
      if (result.length > MAX_BAG_DEFINITIONS)
        result.length = MAX_BAG_DEFINITIONS;
    }
  });
  return result.length ? result : [withMaterial(definitionsForOrder(1)[0], materials, random)];
}

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
  if (preset === "monominoes") return definitionsForOrder(1);
  if (preset === "tetrominoes") return definitionsForOrder(4);
  if (preset === "pentominoes") return definitionsForOrder(5);
  if (preset === "tetra-penta") return createTetrominoPentominoBag();
  if (preset === "hard") return createHardModeBag(random);
  if (preset === "1x10") return createLine10Bag();
  if (preset === "4x4") return createCube4Bag();
  if (preset === "cubes") return createCubesBag();
  return typeof fallback === "function" ? fallback(random) : fallback;
}
