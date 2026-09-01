/**
 * Defines the Guideline tetrominoes and generates higher-order polyomino sets.
 * Matrices are immutable source data; active pieces clone them before play.
 * Order four retains the seven Guideline types and their canonical colors.
 * Other orders enumerate connected rotation-distinct shapes on demand.
 * PieceQueue and Polyomino are the primary consumers of this module.
 */

import {
  HIGH_ORDER_POLYOMINO_COLOR,
  PENTOMINO_COLORS,
  POLYOMINO_COLORS,
} from "../config/colors.js";
export const SHAPES = Object.freeze({
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
});
export const TYPES = Object.freeze(Object.keys(SHAPES));
export { POLYOMINO_COLORS };

const GENERATED_COLORS = Object.freeze([
  0x27d9f5, 0x3877ff, 0xff9d2e, 0xffdf38, 0x44dc67, 0xb75cff, 0xff4d68,
  0x4ce7bd, 0xff79ba, 0x91a8ff, 0xffbc5e, 0x7ce98d,
]);

const normalize = (cells) => {
  const minX = Math.min(...cells.map(({ x }) => x));
  const minY = Math.min(...cells.map(({ y }) => y));
  return cells.map(({ x, y }) => ({ x: x - minX, y: y - minY }));
};
const rotate = (cells) => normalize(cells.map(({ x, y }) => ({ x: -y, y: x })));
const key = (cells) =>
  normalize(cells)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ x, y }) => `${x}:${y}`)
    .join(";");

// Canonicalize through rotation, but not reflection: both chiral variants
// remain playable, which matters because gameplay cannot mirror a piece.
const canonicalKey = (cells) => {
  const keys = [];
  let rotated = cells;
  for (let index = 0; index < 4; index++) {
    keys.push(key(rotated));
    rotated = rotate(rotated);
  }
  return keys.sort()[0];
};
const toMatrix = (cells) => {
  const normalized = normalize(cells);
  const width = Math.max(...normalized.map(({ x }) => x)) + 1;
  const height = Math.max(...normalized.map(({ y }) => y)) + 1;
  const size = Math.max(width, height);
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  normalized.forEach(({ x, y }) => {
    matrix[y][x] = 1;
  });
  return matrix;
};

const rotateMatrixClockwise = (matrix) => {
  const transposed = matrix[0].map((_, x) => matrix.map((row) => row[x]));
  return transposed.map((row) => row.reverse());
};

const matrixBounds = (matrix) => {
  const cells = [];
  matrix.forEach((row, y) =>
    row.forEach((filled, x) => {
      if (filled) cells.push({ x, y });
    }),
  );
  return {
    width:
      Math.max(...cells.map((cell) => cell.x)) -
      Math.min(...cells.map((cell) => cell.x)) +
      1,
    height:
      Math.max(...cells.map((cell) => cell.y)) -
      Math.min(...cells.map((cell) => cell.y)) +
      1,
  };
};

// Spawn all generated n-ominoes in their widest valid rotation. This is data
// normalization, not a preview-only transform, so play and HUD always agree.
const horizontalSpawnMatrix = (matrix) => {
  let best = matrix;
  let candidate = matrix;
  for (let turn = 0; turn < 4; turn++) {
    const bounds = matrixBounds(candidate);
    const bestBounds = matrixBounds(best);
    if (
      bounds.width > bestBounds.width ||
      (bounds.width === bestBounds.width && bounds.height < bestBounds.height)
    )
      best = candidate;
    candidate = rotateMatrixClockwise(candidate);
  }
  return best;
};
const catalogCache = new Map();

// Enumerate fixed (rotation-distinct, reflection-preserving) connected
// polyominoes once. The room-rule orders are deliberately small (3-6).
const generateCatalog = (order) => {
  if (catalogCache.has(order)) return catalogCache.get(order);
  let shapes = [[{ x: 0, y: 0 }]];
  for (let size = 1; size < order; size++) {
    const next = new Map();
    shapes.forEach((shape) => {
      const occupied = new Set(shape.map(({ x, y }) => `${x},${y}`));
      shape.forEach(({ x, y }) => {
        [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ].forEach(([dx, dy]) => {
          const candidate = { x: x + dx, y: y + dy };
          if (occupied.has(`${candidate.x},${candidate.y}`)) return;
          const expanded = normalize([...shape, candidate]);
          next.set(canonicalKey(expanded), expanded);
        });
      });
    });
    shapes = [...next.values()];
  }
  const catalog = shapes
    .sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b)))
    .map((cells, index) =>
      Object.freeze({
        id: `P${order}-${index + 1}`,
        order,
        matrix: horizontalSpawnMatrix(toMatrix(cells)),
        color:
          order >= 6
            ? HIGH_ORDER_POLYOMINO_COLOR
            : GENERATED_COLORS[index % GENERATED_COLORS.length],
        spinLabel: order === 5 ? "P-SPIN" : `${order}-SPIN`,
      }),
    );
  catalogCache.set(order, Object.freeze(catalog));
  return catalogCache.get(order);
};
const GUIDELINE_DEFINITIONS = Object.freeze(
  TYPES.map((id) =>
    Object.freeze({
      id,
      order: 4,
      matrix: SHAPES[id],
      color: POLYOMINO_COLORS[id],
      spinLabel: `${id}-SPIN`,
    }),
  ),
);

// Conventional free pentomino names are prefixed with P so they remain
// distinct from four-mino IDs. Their palette lives in config/colors.js.
const PENTOMINO_DEFINITIONS = Object.freeze(
  [
    {
      id: "PF",
      color: PENTOMINO_COLORS.PF,
      matrix: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 1, 0],
      ],
    },
    {
      id: "PI",
      color: PENTOMINO_COLORS.PI,
      matrix: [[1], [1], [1], [1], [1]],
    },
    {
      id: "PL",
      color: PENTOMINO_COLORS.PL,
      matrix: [
        [1, 0],
        [1, 0],
        [1, 0],
        [1, 1],
      ],
    },
    {
      id: "PN",
      color: PENTOMINO_COLORS.PN,
      matrix: [
        [0, 1],
        [1, 1],
        [1, 0],
        [1, 0],
      ],
    },
    {
      id: "PP",
      color: PENTOMINO_COLORS.PP,
      matrix: [
        [1, 1],
        [1, 1],
        [1, 0],
      ],
    },
    {
      id: "PT",
      color: PENTOMINO_COLORS.PT,
      matrix: [
        [1, 1, 1],
        [0, 1, 0],
        [0, 1, 0],
      ],
    },
    {
      id: "PU",
      color: PENTOMINO_COLORS.PU,
      matrix: [
        [1, 0, 1],
        [1, 1, 1],
      ],
    },
    {
      id: "PV",
      color: PENTOMINO_COLORS.PV,
      matrix: [
        [1, 0, 0],
        [1, 0, 0],
        [1, 1, 1],
      ],
    },
    {
      id: "PW",
      color: PENTOMINO_COLORS.PW,
      matrix: [
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 1],
      ],
    },
    {
      id: "PX",
      color: PENTOMINO_COLORS.PX,
      matrix: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 1, 0],
      ],
    },
    {
      id: "PY",
      color: PENTOMINO_COLORS.PY,
      matrix: [
        [0, 1],
        [1, 1],
        [0, 1],
        [0, 1],
      ],
    },
    {
      id: "PZ",
      color: PENTOMINO_COLORS.PZ,
      matrix: [
        [1, 1, 0],
        [0, 1, 0],
        [0, 1, 1],
      ],
    },
  ].map(({ id, color, matrix }) =>
    Object.freeze({
      id,
      order: 5,
      matrix: horizontalSpawnMatrix(matrix),
      color,
      spinLabel: "P-SPIN",
    }),
  ),
);

const filledSquare = (size) =>
  Array.from({ length: size }, () => Array(size).fill(1));
const outlinedSquare = (size) =>
  Array.from({ length: size }, (_row, y) =>
    Array.from({ length: size }, (_cell, x) =>
      Number(x === 0 || y === 0 || x === size - 1 || y === size - 1),
    ),
  );

// Fixed experimental definitions used only by hash-routed room presets.
// They are not part of the regular polyomino catalogs or main-menu choices.
export const SPECIAL_POLYOMINO_DEFINITIONS = Object.freeze({
  LINE_10: Object.freeze({
    id: "P10-LINE",
    order: 10,
    matrix: [Array(10).fill(1)],
    color: HIGH_ORDER_POLYOMINO_COLOR,
    spinLabel: "MEGASPIN",
  }),
  CUBE_4: Object.freeze({
    id: "P16-CUBE",
    order: 16,
    matrix: filledSquare(4),
    color: HIGH_ORDER_POLYOMINO_COLOR,
    spinLabel: "MEGASPIN",
  }),
  RECTANGLE_2X4: Object.freeze({
    id: "P8-RECTANGLE-2X4",
    order: 8,
    matrix: Array.from({ length: 2 }, () => Array(4).fill(1)),
    color: HIGH_ORDER_POLYOMINO_COLOR,
    spinLabel: "MEGASPIN",
  }),
  OUTLINE_CUBE_4: Object.freeze({
    id: "P12-OUTLINE-CUBE",
    order: 12,
    matrix: outlinedSquare(4),
    color: HIGH_ORDER_POLYOMINO_COLOR,
    spinLabel: "MEGASPIN",
  }),
});

const KNOWN_DEFINITIONS = Object.freeze([
  ...GUIDELINE_DEFINITIONS,
  ...PENTOMINO_DEFINITIONS,
]);
export const definitionsForOrder = (order) =>
  Number(order) === 4
    ? GUIDELINE_DEFINITIONS
    : Number(order) === 5
      ? PENTOMINO_DEFINITIONS
      : generateCatalog(Number(order));
export const resolvePolyominoDefinition = (source) => {
  if (source && typeof source === "object" && source.matrix) return source;
  return (
    KNOWN_DEFINITIONS.find(({ id }) => id === source) ||
    GUIDELINE_DEFINITIONS[0]
  );
};
