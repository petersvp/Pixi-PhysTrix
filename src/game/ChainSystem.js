/**
 * Converts a chain length into its display label.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

const lineClearNames = [
  "",
  "SINGLE",
  "DOUBLE",
  "TRIPLE",
  "PHYSTRIX",
  "PENTATRIX",
  "HEXATRIX",
  "HEPTATRIX",
  "OCTATRIX",
  "NONATRIX",
  "MEGATRIX", // 10
  "MEGATRIX", // 11
  "MEGATRIX", // 12
  "FATALIX", // 13
  "LEGENDTRIX", // 14
  "LEGENDTRIX", // 15
  "LEGENDTRIX", // 16
  "LEGENDTRIX", // 17
  "IMPOSTRIX", // 18
  "IMPOSTRIX", // 19
  "IMPOSTRIX", // 20
];
export const chainName = (count) =>
  lineClearNames[Math.min(20, count)] || `IMPOSTRIX`;

/** Find removable same-colour minos without changing a polyomino's topology. */
export function findColorChainCells(board, rules = {}) {
  const mode = rules.mode;
  if (mode === "color-lines") {
    const minimum = Math.max(2, Number(rules.colorLineLength) || 2);
    const directions = [
      ...(rules.horizontal ? [[1, 0]] : []),
      ...(rules.vertical ? [[0, 1]] : []),
      ...(rules.diagonal ? [[1, 1], [1, -1]] : []),
    ];
    const result = new Map();
    board.forEachCell((tile, x, y) => {
      directions.forEach(([dx, dy]) => {
        const previous = board.get(x - dx, y - dy);
        if (!Number.isInteger(tile.colorIndex) || tile.colorIndex < 0 || previous?.colorIndex === tile.colorIndex) return;
        const run = [];
        for (let px = x, py = y; board.get(px, py)?.colorIndex === tile.colorIndex; px += dx, py += dy)
          run.push({ x: px, y: py });
        if (run.length >= minimum)
          run.forEach((cell) => result.set(`${cell.x},${cell.y}`, cell));
      });
    });
    return [...result.values()];
  }
  if (mode !== "color-clusters") return [];
  const minimum = Math.max(2, Number(rules.clusterSize) || 2);
  const visited = new Set();
  const result = [];
  board.forEachCell((tile, x, y) => {
    if (!Number.isInteger(tile.colorIndex) || tile.colorIndex < 0) return;
    const key = `${x},${y}`;
    if (visited.has(key)) return;
    visited.add(key);
    const group = [{ x, y }];
    for (let index = 0; index < group.length; index += 1) {
      const cell = group[index];
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
        const nx = cell.x + dx, ny = cell.y + dy, nextKey = `${nx},${ny}`;
        const next = board.get(nx, ny);
        if (!next || next.colorIndex !== tile.colorIndex || visited.has(nextKey)) return;
        visited.add(nextKey);
        group.push({ x: nx, y: ny });
      });
    }
    if (group.length >= minimum) result.push(...group);
  });
  return result;
}
