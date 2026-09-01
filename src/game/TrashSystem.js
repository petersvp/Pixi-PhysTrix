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

export class TrashSystem {
  constructor(level = 0, random = Math.random) {
    this.random = random;
    this.level = Math.max(0, Math.min(MAX_TRASH_LEVEL, Number(level) || 0));
  }

  get enabled() {
    return this.level > 0;
  }

  cells() {
    const cells = [];
    for (let y = ROWS - this.level; y < ROWS; y += 1)
      for (let x = 0; x < COLS; x += 1)
        if (this.random() < TRASH_CELL_FILL_CHANCE)
          cells.push({ x, y, trash: true, color: TRASH_MINO_COLOR });
    if (!cells.length && this.level > 0)
      cells.push({
        x: Math.floor(this.random() * COLS),
        y: ROWS - 1,
        trash: true,
        color: TRASH_MINO_COLOR,
      });
    return cells;
  }

  populateBoard(board) {
    this.cells().forEach(({ x, y, color }) =>
      board.set(x, y, {
        color,
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

  advance() {
    this.level = Math.min(MAX_TRASH_LEVEL, this.level + 1);
  }
}
