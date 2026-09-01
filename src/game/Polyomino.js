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
export class Polyomino {
  constructor(source = TYPES[(Math.random() * TYPES.length) | 0]) {
    this.definition = resolvePolyominoDefinition(source);
    this.type = this.definition.id;
    this.order = this.definition.order;
    this.color = this.definition.color;
    this.matrix = clone(this.definition.matrix);
    const matrixWidth = Math.max(...this.matrix.map((row) => row.length));
    this.x = (COLS - matrixWidth) >> 1;
    this.y = -2;
    this.facing = 0;
    this.lastAction = "spawn";
    this.lastKick = 0;
  }
  cells(matrix = this.matrix, x = this.x, y = this.y) {
    const cells = [];
    matrix.forEach((r, py) =>
      r.forEach((v, px) => v && cells.push({ x: x + px, y: y + py })),
    );
    return cells;
  }
  static rotateMatrix(m, cw = true) {
    const t = m[0].map((_, x) => m.map((r) => r[x]));
    return cw ? t.map((r) => r.reverse()) : t.reverse();
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
    if (!board.isValid(cells) || !board.raycastClear(this.cells(), cells))
      return false;
    this.x += dx;
    this.y += dy;
    this.lastAction = "move";
    return true;
  }
  rotate(board, d = 1) {
    if (this.type === "O") return true;
    if (Math.abs(d) === 2) {
      const s = {
        matrix: this.matrix,
        x: this.x,
        y: this.y,
        facing: this.facing,
      };
      if (this.rotate(board, 1) && this.rotate(board, 1)) return true;
      Object.assign(this, s);
      return false;
    }
    const to = (this.facing + (d > 0 ? 1 : 3)) % 4,
      next = Polyomino.rotateMatrix(this.matrix, d > 0),
      kicks = rotationKicksFor(this.definition, this.facing, to);
    const anchor =
      this.order === 4
        ? { x: this.x, y: this.y }
        : Polyomino.boundingBoxAnchor(this.matrix, next, this.x, this.y);
    for (let i = 0; i < kicks.length; i++) {
      const [dx, dy] = kicks[i],
        cells = this.cells(next, anchor.x + dx, anchor.y + dy);
      if (board.isValid(cells)) {
        this.matrix = next;
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
