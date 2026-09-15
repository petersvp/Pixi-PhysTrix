/**
 * Owns random Trash progression independently of either gameplay backend.
 *
 * A non-zero starting level enables progression and fills that many bottom rows.
 * Trash cells are monominoes with an independent material marker and grey tint.
 * When the final trash cell disappears, the current locked field is discarded.
 * Gameplay owns the brief Trash Up pause before the next level is generated.
 */

import { COLS, ROWS } from "../config/gameplayConstants.js";
import {
  MAX_TRASH_LEVEL,
  TRASH_CELL_FILL_CHANCE,
  TRASH_MINO_COLOR,
} from "../config/trashConstants.js";

const emptyLinks = () => ({
  top: false, right: false, bottom: false, left: false,
  topLeft: false, topRight: false, bottomRight: false, bottomLeft: false,
});

const hash = (x, y, seed) => {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
};

const interpolate = (from, to, amount) => from + (to - from) * amount;
const smooth = (value) => value * value * (3 - 2 * value);
const colorNumber = (color) =>
  Number.isFinite(color)
    ? color
    : Number.parseInt(String(color).replace("#", ""), 16) || TRASH_MINO_COLOR;

// Interpolate neighbouring deterministic values rather than quantizing x/y
// before hashing. The previous floor(x / 2), floor(y / 2) form made literal
// 2×2 stamp blocks; these two octaves make connected but irregular shapes.
const valueNoise = (x, y, seed) => {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const tx = smooth(x - left);
  const ty = smooth(y - top);
  const topRow = interpolate(
    hash(left, top, seed),
    hash(left + 1, top, seed),
    tx,
  );
  const bottomRow = interpolate(
    hash(left, top + 1, seed),
    hash(left + 1, top + 1, seed),
    tx,
  );
  return interpolate(topRow, bottomRow, ty);
};

const organicNoise = (x, y, seed) =>
  valueNoise(x * 0.62, y * 0.62, seed) * 0.72 +
  valueNoise(x * 1.17, y * 1.17, seed + 31) * 0.28;

export class TrashSystem {
  constructor(level = 0, random = Math.random, roomRules = null) {
    this.random = random;
    this.rules = roomRules?.mutators || {};
    this.cols = Math.max(4, Math.floor(Number(roomRules?.grid?.width) || COLS));
    this.rows = Math.max(4, Math.floor(Number(roomRules?.grid?.height) || ROWS));
    this.level = Math.max(
      0,
      Math.min(MAX_TRASH_LEVEL, this.rows - 2, Number(level) || 0),
    );
    // This is the objective's target row for the currently spawned trash
    // field. It is deliberately captured at generation time: recalculating
    // from remaining trash would make "clear bottom line" impossible until
    // every trash mino had vanished.
    this.bottomRow = null;
    // Settings use HTML colour strings. Gameplay stores only a palette index
    // on every mino; this resolved palette exists solely at the render edge.
    const chain = roomRules?.chain || {};
    const colorCount = Math.max(1, Math.floor(Number(chain.colorCount) || 1));
    this.colors = (chain.colors || []).slice(0, colorCount).map(colorNumber);
    this.colorMode = ["color-lines", "color-clusters"].includes(chain.mode);
  }

  get enabled() {
    return this.level > 0;
  }

  cells() {
    const mode = this.rules.trashPatternMode || (this.rules.trashDensityMode === "perlin" ? "perlin" : "random");
    if (mode === "fixed" || mode === "levels") return this.rememberBottomRow(this.patternCells(mode));
    if (mode === "scattered") return this.rememberBottomRow(this.scatteredCells());
    const cells = [];
    const level = Math.min(
      Math.min(MAX_TRASH_LEVEL, this.rows - 2),
      Math.max(0, Math.floor(Number(this.level) || 0)),
    );
    if (level !== this.level)
      console.error("[Trash] Invalid level was capped before generation.", {
        level: this.level,
        cappedLevel: level,
      });
    const density = Math.max(0, Math.min(1, Number(this.rules.trashDensity ?? TRASH_CELL_FILL_CHANCE * 100) / 100));
    for (let y = this.rows - level; y < this.rows; y += 1) {
      const row = [];
      for (let x = 0; x < this.cols; x += 1)
        if (mode === "perlin"
          ? organicNoise(x, y, level) < density
          : this.random() < density)
          {
            const colorIndex = this.colorMode && this.colors.length
              ? Math.floor(this.random() * this.colors.length)
              : -1;
            row.push({
              x,
              y,
              trash: true,
              colorIndex,
              baseColor: TRASH_MINO_COLOR,
            });
          }
      if (row.length === this.cols)
        row.splice(Math.floor(this.random() * this.cols), 1);
      cells.push(...row);
    }
    if (!cells.length && level > 0) {
      const colorIndex = this.colorMode && this.colors.length
        ? Math.floor(this.random() * this.colors.length)
        : -1;
      cells.push({
        x: Math.floor(this.random() * this.cols),
        y: this.rows - 1,
        trash: true,
        colorIndex,
        baseColor: TRASH_MINO_COLOR,
      });
    }
    return this.rememberBottomRow(cells);
  }

  rememberBottomRow(cells) {
    this.bottomRow = cells.length
      ? Math.max(...cells.map((cell) => cell.y))
      : null;
    return cells;
  }

  // Virus-style trash is deliberately sparse and spread through the usable
  // playfield rather than stacked at its bottom.  Very short fields retain a
  // two-row spawn buffer; normal fields retain four rows at the top.
  scatteredCells() {
    const level = Math.min(
      Math.min(MAX_TRASH_LEVEL, this.rows - 2),
      Math.max(0, Math.floor(Number(this.level) || 0)),
    );
    const spawnHeight = Math.max(1, this.rows - (this.rows <= 8 ? 2 : 4));
    const top = this.rows - spawnHeight;
    const candidates = [];
    for (let y = top; y < this.rows; y += 1)
      for (let x = 0; x < this.cols; x += 1) candidates.push({ x, y });
    const tilesPerLevel = Math.max(
      1,
      Math.floor(Number(this.rules.trashTiles) || 4),
    );
    // Never author a full row during setup: as with the other trash modes,
    // progression must not immediately self-clear before the player acts.
    const count = Math.min(
      Math.max(0, (this.cols - 1) * spawnHeight),
      level * tilesPerLevel,
    );
    // A partial Fisher-Yates shuffle selects unique locations without a retry
    // loop as the field becomes full.
    for (let index = 0; index < count; index += 1) {
      const swapIndex = index + Math.floor(this.random() * (candidates.length - index));
      [candidates[index], candidates[swapIndex]] = [
        candidates[swapIndex],
        candidates[index],
      ];
    }
    const rowCounts = Array(this.rows).fill(0);
    const selected = [];
    candidates.forEach((candidate) => {
      if (selected.length >= count || rowCounts[candidate.y] >= this.cols - 1)
        return;
      rowCounts[candidate.y] += 1;
      selected.push(candidate);
    });
    return selected.map(({ x, y }) => ({
      x,
      y,
      trash: true,
      colorIndex: this.colorMode && this.colors.length
        ? Math.floor(this.random() * this.colors.length)
        : -1,
      baseColor: TRASH_MINO_COLOR,
    }));
  }

  patternCells(mode) {
    const patterns = this.rules.trashPatterns || [];
    if (!patterns.length) return [];
    const selected = mode === "fixed"
      ? patterns[Math.floor(this.random() * patterns.length)]
      : patterns[(Math.max(1, this.level) - 1) % patterns.length];
    const cells = [];
    const level = Math.min(
      Math.min(MAX_TRASH_LEVEL, this.rows - 2),
      Math.max(0, Math.floor(Number(this.level) || 0)),
    );
    if (level !== this.level)
      console.error("[Trash] Invalid level was capped before pattern generation.", {
        level: this.level,
        cappedLevel: level,
      });
    // Fixed patterns are a repeating stack whose height is the current trash
    // level. Levels choose one authored pattern instead; its own height is
    // the spawn height, so level 5 does not accidentally mean five rows.
    const spawnRows = mode === "levels"
      ? Math.min(this.rows, Math.max(1, selected?.rows?.length || 1))
      : level;
    for (let rowFromBottom = 0; rowFromBottom < spawnRows; rowFromBottom += 1) {
      const pattern = selected;
      const rows = pattern?.rows || [];
      const row = String(rows[(rows.length - 1 - (rowFromBottom % Math.max(1, rows.length)) + rows.length) % Math.max(1, rows.length)] || "");
      const patternWidth = Math.max(1, row.length);
      // Tile a narrow pattern from its centre; crop a wider one around its
      // centre. This keeps visual symmetry on any board/pattern mismatch.
      const start = Math.floor((this.cols - patternWidth) / 2);
      const occupied = [];
      for (let x = 0; x < this.cols; x += 1) {
        const sourceX = ((x - start) % patternWidth + patternWidth) % patternWidth;
        const token = row[sourceX] || "0";
        if (token === "0") continue;
        const index = Math.max(0, Number(token) - 1);
        const colorIndex = this.colorMode && this.colors.length
          ? index % this.colors.length
          : -1;
        occupied.push({
          x,
          y: this.rows - 1 - rowFromBottom,
          trash: true,
          colorIndex,
          baseColor: TRASH_MINO_COLOR,
        });
      }
      // A fully filled authored row would create an unavoidable immediate
      // clear. Preserve the level pattern but punch one random fallback hole.
      if (occupied.length === this.cols) occupied.splice(Math.floor(this.random() * this.cols), 1);
      cells.push(...occupied);
    }
    return cells;
  }

  populateBoard(board) {
    this.cells().forEach(({ x, y, colorIndex, baseColor }) =>
      board.set(x, y, {
        colorIndex,
        baseColor,
        trash: true,
        pieceId: `trash-${x}-${y}-${this.level}`,
        visualLinks: emptyLinks(),
        broken: { top: false, right: false, bottom: false, left: false },
      }),
    );
  }

  boardHasTrash(board) {
    let found = false;
    board.forEachCell((tile) => { if (tile.trash) found = true; });
    return found;
  }

  bottomLineCleared(board, physics = null) {
    if (!Number.isInteger(this.bottomRow)) return false;
    if (physics) return !physics.hasTrashOnRow(this.bottomRow);
    return !board.cells[this.bottomRow]?.some((tile) => tile?.trash);
  }

  advance() {
    this.level = Math.min(MAX_TRASH_LEVEL, this.level + 1);
  }
}
