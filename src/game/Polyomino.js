/**
 * Implements the active falling polyomino in Guideline-style gameplay.
 * It owns the current matrix, position, facing direction, and action history.
 * Movement is validated by the supplied board, allowing classic and physics
 * modes to provide different collision implementations.
 * Rotation preserves Guideline SRS at order four and uses generated kicks for
 * higher-order polyominoes, including the two-step modern 180 turn.
 */

import { COLS } from "../config/gameplayConstants.js";
import { TYPES, resolvePolyominoDefinition } from "./PolyominoDefinitions.js";
import { rotationKicksFor } from "./SRS.js";
const clone = (m) => m.map((r) => r.slice());

// Every renderer and network consumer derives a polyomino's local origin from
// its ordered integer cells.  Keeping this calculation here avoids serializing
// fractional mesh offsets and makes a shape's local geometry reproducible.
export const polyominoCentroid = (cells) => ({
  x: cells.reduce((sum, cell) => sum + cell.x + 0.5, 0) / cells.length,
  y: cells.reduce((sum, cell) => sum + cell.y + 0.5, 0) / cells.length,
});

export class Mino {
  constructor({ x, y, colorIndex = -1, material = "default", ...data }) {
    this.x = x;
    this.y = y;
    this.colorIndex = colorIndex;
    this.material = material || "default";
    Object.assign(this, data);
  }
  clone() {
    return new Mino({ ...this });
  }
}

export class Polyomino {
  constructor(source = TYPES[(Math.random() * TYPES.length) | 0]) {
    this.definition = resolvePolyominoDefinition(source);
    this.type = this.definition.id;
    this.order = this.definition.order;
    this.color = source.color ?? this.definition.color;
    this.palette = Array.isArray(source.palette) ? source.palette : null;
    this.matrix = clone(this.definition.matrix);
    this.minos = Array.isArray(source.minos)
      ? source.minos.map((mino) => new Mino(mino))
      : this.matrix.flatMap((row, y) =>
          row.flatMap((filled, x) => (filled ? [new Mino({ x, y })] : [])),
        );
    this.extraMinos = this.minos.filter((mino) => !this.matrix[mino.y]?.[mino.x]);
    const fallbackColorIndex = Number.isInteger(source.colorIndex)
      ? source.colorIndex
      : this.minos[0]?.colorIndex ?? -1;
    // A queued definition may cross a network/UI boundary with authored mino
    // data. Its matrix remains the geometry authority: never let a missing
    // mino turn the next controlled-body spawn into an uncaught exception.
    const minosAt = new Set(this.minos.map((mino) => `${mino.x},${mino.y}`));
    const repaired = [];
    this.matrix.forEach((row, y) =>
      row.forEach((filled, x) => {
        if (!filled || minosAt.has(`${x},${y}`)) return;
        const mino = new Mino({ x, y, colorIndex: fallbackColorIndex });
        this.minos.push(mino);
        repaired.push({ x, y });
      }),
    );
    if (repaired.length)
      console.error("[Polyomino] Repaired missing queued minos.", {
        type: this.type,
        repaired,
        source,
      });
    this.colorIndex = fallbackColorIndex;
    const matrixWidth = Math.max(...this.matrix.map((row) => row.length));
    this.x = (COLS - matrixWidth) >> 1;
    this.y = -2;
    this.facing = 0;
    this.lastAction = "spawn";
    this.lastKick = 0;
  }
  cells(matrix = this.matrix, x = this.x, y = this.y, minos = this.minos) {
    const cells = [];
    const minosAt = new Map(minos.map((mino) => [`${mino.x},${mino.y}`, mino]));
    matrix.forEach((r, py) =>
      r.forEach((v, px) =>
        v && (() => {
          const mino = minosAt.get(`${px},${py}`);
          if (!mino) {
            // Construction repairs this already, but retain a last-resort
            // recovery here for externally mutated active pieces.
            console.error("[Polyomino] Recovered missing active mino.", {
              type: this.type,
              x: px,
              y: py,
            });
            const recovered = new Mino({
              x: px,
              y: py,
              colorIndex: this.colorIndex,
            });
            minos.push(recovered);
            minosAt.set(`${px},${py}`, recovered);
            cells.push({
              ...recovered,
              x: x + px,
              y: y + py,
              color:
                recovered.colorIndex < 0
                  ? this.color
                  : this.palette?.[recovered.colorIndex],
            });
            return;
          }
          cells.push({
            ...mino,
            x: x + px,
            y: y + py,
            color: mino.colorIndex < 0 ? this.color : this.palette?.[mino.colorIndex],
          });
        })(),
      ),
    );
    if (matrix === this.matrix && this.extraMinos?.length)
      this.extraMinos.forEach((mino) => cells.push({ ...mino, x: x + mino.x, y: y + mino.y, color: mino.colorIndex < 0 ? this.color : this.palette?.[mino.colorIndex] }));
    return cells;
  }
  discardSpawnOutOfBounds(columns) {
    const width = Math.max(1, Math.floor(Number(columns) || 0));
    const originalMinos = new Set(this.minos.map((mino) => `${mino.x},${mino.y}`));
    const removed = new Set(
      this.minos
        .filter((mino) => this.x + mino.x < 0 || this.x + mino.x >= width)
        .map((mino) => `${mino.x},${mino.y}`),
    );
    if (!removed.size) return 0;
    // Clipping removes geometry, not the PM's original topology. The exposed
    // survivor must still claim its former neighbour and mark that link as
    // broken, so Grid can render and resolve a torn connection correctly.
    const sides = [
      [-1, 0, "left"], [1, 0, "right"], [0, -1, "top"], [0, 1, "bottom"],
    ];
    this.minos = this.minos
      .filter((mino) => !removed.has(`${mino.x},${mino.y}`))
      .map((mino) => {
        const broken = { ...(mino.broken || {}) };
        const visualLinks = { ...(mino.visualLinks || {}) };
        sides.forEach(([dx, dy, side]) => {
          const neighbor = `${mino.x + dx},${mino.y + dy}`;
          visualLinks[side] ??= originalMinos.has(neighbor);
          if (removed.has(neighbor)) broken[side] = true;
        });
        return new Mino({ ...mino, visualLinks, broken });
      });
    this.matrix = this.matrix.map((row, y) =>
      row.map((filled, x) => (removed.has(`${x},${y}`) ? 0 : filled)),
    );
    this.extraMinos = this.minos.filter((mino) => !this.matrix[mino.y]?.[mino.x]);
    return removed.size;
  }
  visualCenter() {
    return polyominoCentroid(this.cells());
  }
  averageColor() {
    const colors = this.cells().map((cell) => cell.color ?? this.color);
    const channels = colors.reduce(
      (sum, color) => [sum[0] + ((color >> 16) & 0xff), sum[1] + ((color >> 8) & 0xff), sum[2] + (color & 0xff)],
      [0, 0, 0],
    );
    const count = Math.max(1, colors.length);
    return (Math.round(channels[0] / count) << 16) |
      (Math.round(channels[1] / count) << 8) |
      Math.round(channels[2] / count);
  }
  static rotateMatrix(m, cw = true) {
    const t = m[0].map((_, x) => m.map((r) => r[x]));
    return cw ? t.map((r) => r.reverse()) : t.reverse();
  }
  static rotateMinos(minos, matrix, cw = true) {
    const height = matrix.length;
    const width = Math.max(...matrix.map((row) => row.length));
    const rotateBroken = (broken) => {
      if (!broken) return undefined;
      return cw
        ? {
            top: Boolean(broken.left),
            right: Boolean(broken.top),
            bottom: Boolean(broken.right),
            left: Boolean(broken.bottom),
          }
        : {
            top: Boolean(broken.right),
            right: Boolean(broken.bottom),
            bottom: Boolean(broken.left),
            left: Boolean(broken.top),
          };
    };
    const rotateVisualLinks = (links) => {
      if (!links) return undefined;
      return cw
        ? {
            top: Boolean(links.left),
            right: Boolean(links.top),
            bottom: Boolean(links.right),
            left: Boolean(links.bottom),
            topLeft: Boolean(links.bottomLeft),
            topRight: Boolean(links.topLeft),
            bottomRight: Boolean(links.topRight),
            bottomLeft: Boolean(links.bottomRight),
          }
        : {
            top: Boolean(links.right),
            right: Boolean(links.bottom),
            bottom: Boolean(links.left),
            left: Boolean(links.top),
            topLeft: Boolean(links.topRight),
            topRight: Boolean(links.bottomRight),
            bottomRight: Boolean(links.bottomLeft),
            bottomLeft: Boolean(links.topLeft),
          };
    };
    return minos.map((mino) => new Mino({
      ...mino,
      ...(mino.broken ? { broken: rotateBroken(mino.broken) } : {}),
      ...(mino.visualLinks ? { visualLinks: rotateVisualLinks(mino.visualLinks) } : {}),
      x: cw ? height - 1 - mino.y : mino.y,
      y: cw ? mino.x : width - 1 - mino.x,
    }));
  }
  // Higher orders rotate around their bounding-box centre rather than their
  // mino centre of mass. This keeps asymmetric 3x3 shapes, especially L-like
  // pentominoes, visually centred across every 90-degree turn.
  static boundingBoxCenter(matrix) {
    return { x: matrix[0].length / 2, y: matrix.length / 2 };
  }
  static boundingBoxAnchor(matrix, next, x, y) {
    const before = Polyomino.boundingBoxCenter(matrix);
    const after = Polyomino.boundingBoxCenter(next);
    return {
      x: Math.round(x + before.x - after.x),
      y: Math.round(y + before.y - after.y),
    };
  }
  static normalizedMatrix(matrix) {
    const filledRows = matrix.filter((row) => row.some(Boolean));
    const columns = filledRows[0].map((_value, x) =>
      filledRows.some((row) => row[x]),
    );
    return filledRows.map((row) => row.filter((_value, x) => columns[x]));
  }
  static isFullyRotationallySymmetric(matrix) {
    const key = (shape) => JSON.stringify(Polyomino.normalizedMatrix(shape));
    const original = key(matrix);
    let rotated = matrix;
    for (let turn = 0; turn < 3; turn++) {
      rotated = Polyomino.rotateMatrix(rotated);
      if (key(rotated) !== original) return false;
    }
    return true;
  }
  move(board, dx, dy) {
    const cells = this.cells(this.matrix, this.x + dx, this.y + dy);
    if (!board.isValid(cells) || !board.raycastClear(this.cells(), cells)) return false;
    this.x += dx;
    this.y += dy;
    this.lastAction = "move";
    return true;
  }
  rotate(board, d = 1) {
    if (Math.abs(d) === 2) {
      const s = {
        matrix: this.matrix,
        x: this.x,
        y: this.y,
        facing: this.facing,
        minos: this.minos.map((mino) => mino.clone()),
      };
      if (this.rotate(board, 1) && this.rotate(board, 1)) return true;
      Object.assign(this, s);
      return false;
    }
    const to = (this.facing + (d > 0 ? 1 : 3)) % 4,
      next = Polyomino.rotateMatrix(this.matrix, d > 0),
      nextMinos = Polyomino.rotateMinos(this.minos, this.matrix, d > 0),
      kicks = rotationKicksFor(this.definition, this.facing, to);
    const anchor =
      this.order === 4
        ? { x: this.x, y: this.y }
        : Polyomino.boundingBoxAnchor(this.matrix, next, this.x, this.y);
    for (let i = 0; i < kicks.length; i++) {
      const [dx, dy] = kicks[i],
        cells = this.cells(next, anchor.x + dx, anchor.y + dy, nextMinos);
      if (board.isValid(cells)) {
        this.matrix = next;
        this.minos = nextMinos;
        this.x = anchor.x + dx;
        this.y = anchor.y + dy;
        this.facing = to;
        this.lastKick = i + 1;
        this.lastAction = "rotate";
        return true;
      }
    }
    return false;
  }
}
