/**
 * Owns the discrete classic board cells and line clearing operations.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import {
  CLASSIC_STICKY_FALL_CELLS_PER_SECOND,
  CLASSIC_STICKY_GRAVITY,
  COLS,
  ROWS,
} from "../config/gameplayConstants.js";

export class Board {
  constructor() {
    this.reset();
  }
  reset() {
    this.cells = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.above = new Map();
    this.lastClearedTiles = [];
  }
  get(x, y) {
    return (y < 0 ? this.above.get(y) : this.cells[y])?.[x] || null;
  }
  set(x, y, tile) {
    if (y >= 0) this.cells[y][x] = tile;
    else {
      const row = this.above.get(y) || Array(COLS).fill(null);
      row[x] = tile;
      this.above.set(y, row);
    }
  }
  forEachCell(callback) {
    [...this.above.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([y, row]) =>
        row.forEach((tile, x) => tile && callback(tile, x, y)),
      );
    this.cells.forEach((row, y) =>
      row.forEach((tile, x) => tile && callback(tile, x, y)),
    );
  }
  isEmpty() {
    let occupied = false;
    this.forEachCell(() => {
      occupied = true;
    });
    return !occupied;
  }
  isValid(cells) {
    return cells.every(
      ({ x, y }) => x >= 0 && x < COLS && y < ROWS && !this.get(x, y),
    );
  }
  raycastClear(_from, to) {
    return this.isValid(to);
  }
  // A normal grid edge connects when both minos agree. An intentional one-
  // sided mismatch also sticks: an exposed, unbroken side meeting a neighbor
  // that claims the opposite edge becomes a glue point for future content.
  // A broken side always wins and prevents either form of connection.
  static areConnected(a, b, side, opposite) {
    if (!a || !b || a.broken?.[side] || b.broken?.[opposite]) return false;
    const aClaims = Boolean(a.visualLinks?.[side]);
    const bClaims = Boolean(b.visualLinks?.[opposite]);
    return (aClaims && bClaims) || aClaims !== bClaims;
  }
  lock(piece) {
    const cells = piece.cells();
    if (cells.length > ROWS * COLS) {
      console.error("[Board] Refusing oversized locked polyomino.", {
        cells: cells.length,
        maximum: ROWS * COLS,
      });
      return false;
    }
    const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const has = (x, y) => occupied.has(`${x},${y}`);
    cells.forEach(({ x, y }) => {
      if (y < ROWS)
        this.set(x, y, {
          color: cell.color ?? piece.color,
          pieceId: piece.id,
          // These source links are immutable. Rendering must not infer new
          // connectivity merely because a line clear moves the cells around.
          visualLinks: {
            top: has(x, y - 1),
            right: has(x + 1, y),
            bottom: has(x, y + 1),
            left: has(x - 1, y),
            topLeft: has(x - 1, y - 1),
            topRight: has(x + 1, y - 1),
            bottomRight: has(x + 1, y + 1),
            bottomLeft: has(x - 1, y + 1),
          },
          broken: { top: false, right: false, bottom: false, left: false },
        });
    });
    return false;
  }
  findFullLines() {
    return this.cells
      .map((row, y) => (row.every(Boolean) ? y : -1))
      .filter((y) => y >= 0);
  }
  markLines(rows = this.findFullLines()) {
    rows.forEach((y) =>
      this.cells[y].forEach((tile) => {
        if (tile) tile.marked = true;
      }),
    );
    return rows;
  }
  markCells(cells) {
    cells.forEach(({ x, y }) => {
      const tile = this.get(x, y);
      if (tile) tile.marked = true;
    });
    return cells;
  }
  resolveMarkedCells() {
    const clearedTiles = [];
    const survivors = [];
    this.forEachCell((tile, x, y) => {
      const entry = { tile, x, y };
      if (tile.marked) clearedTiles.push({ ...tile, x, y });
      else survivors.push(entry);
    });
    this.reset();
    this.lastClearedTiles = clearedTiles;
    if (!clearedTiles.length) return 0;
    this.applyStickyGravity(survivors, true);
    return clearedTiles.length;
  }
  clearLines(stickyGravity = CLASSIC_STICKY_GRAVITY) {
    return this.clearRows(this.findFullLines(), stickyGravity, false);
  }
  resolveMarkedLines(stickyGravity = CLASSIC_STICKY_GRAVITY) {
    const rows = this.cells
      .map((row, y) => (row.every((tile) => tile?.marked) ? y : -1))
      .filter((y) => y >= 0);
    return this.clearRows(rows, stickyGravity, true);
  }
  clearRows(rows, stickyGravity, animateFall) {
    const clearedTiles = rows.flatMap((y) =>
      this.cells[y].map((tile, x) => tile && { ...tile, x, y }).filter(Boolean),
    );
    this.lastClearedTiles = clearedTiles;
    if (!rows.length) return 0;
    const removed = new Set(rows);
    const sides = [
      [0, -1, "top", "bottom"],
      [1, 0, "right", "left"],
      [0, 1, "bottom", "top"],
      [-1, 0, "left", "right"],
    ];
    rows.forEach((rowY) =>
      this.cells[rowY].forEach((tile, x) => {
        if (!tile) return;
        sides.forEach(([dx, dy, side, opposite]) => {
          const neighborY = rowY + dy;
          const neighbor = this.get(x + dx, neighborY);
          if (removed.has(neighborY)) return;
          if (Board.areConnected(tile, neighbor, side, opposite))
            neighbor.broken[opposite] = true;
        });
      }),
    );
    const survivors = [];
    this.forEachCell((tile, x, y) => {
      if (!removed.has(y)) survivors.push({ tile, x, y });
    });
    this.reset();
    this.lastClearedTiles = clearedTiles;
    // Even when ordinary row compaction is configured, a Trash board needs
    // graph gravity so its static cells can remain in place as true blockers.
    if (stickyGravity || survivors.some(({ tile }) => tile.trash)) {
      this.applyStickyGravity(survivors, animateFall);
      return rows.length;
    }
    survivors.forEach(({ tile, x, y }) => {
      const shift = rows.filter((rowY) => rowY > y).length;
      const finalY = y + shift;
      if (animateFall && finalY !== y) tile.renderY = y;
      else delete tile.renderY;
      delete tile.marked;
      this.set(x, finalY, tile);
    });
    return rows.length;
  }
  // First discover the complete connectivity graph from top to bottom. Then
  // settle the discovered groups from bottom to top against an occupancy map
  // that contains both already-settled and still-unresolved groups. Keeping
  // unresolved cells solid prevents a group from falling through them.
  applyStickyGravity(survivors, animateFall = false) {
    // Trash is part of the board occupancy, but never part of Classic's
    // gravity graph. It therefore supports falling groups without joining or
    // moving with them, even when authored links would otherwise touch.
    const stationary = survivors.filter(({ tile }) => tile.trash);
    const fallable = survivors.filter(({ tile }) => !tile.trash);
    const cells = new Map(
      fallable.map((entry) => [`${entry.x},${entry.y}`, entry]),
    );
    const visited = new Set();
    const groups = [];
    const directions = [
      [0, -1, "top", "bottom"],
      [1, 0, "right", "left"],
      [0, 1, "bottom", "top"],
      [-1, 0, "left", "right"],
    ];
    const topFirst = [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    const maxResolveCells = ROWS * COLS;
    let visitedCells = 0;
    topFirst.forEach((first) => {
      const firstKey = `${first.x},${first.y}`;
      if (visited.has(firstKey)) return;
      const group = [];
      const pending = [first];
      visited.add(firstKey);
      while (pending.length) {
        if (++visitedCells > maxResolveCells) {
          console.error("[Board] Sticky-gravity flood-fill safety limit reached.", {
            visitedCells,
            pendingCells: pending.length,
          });
          pending.length = 0;
          break;
        }
        const entry = pending.pop();
        group.push(entry);
        directions.forEach(([dx, dy, side, opposite]) => {
          const key = `${entry.x + dx},${entry.y + dy}`;
          const neighbor = cells.get(key);
          if (
            visited.has(key) ||
            !Board.areConnected(entry.tile, neighbor?.tile, side, opposite)
          )
            return;
          visited.add(key);
          pending.push(neighbor);
        });
      }
      groups.push(group);
    });

    const fallingGroups = groups.map((group) =>
      group.map((entry) => ({
        ...entry,
        sourceY: entry.y,
      })),
    );
    const bottomFirst = (a, b) => {
      const aBottom = Math.max(...a.map(({ y }) => y));
      const bBottom = Math.max(...b.map(({ y }) => y));
      const aLeft = Math.min(...a.map(({ x }) => x));
      const bLeft = Math.min(...b.map(({ x }) => x));
      return bBottom - aBottom || aLeft - bLeft;
    };

    // A floating island is a cycle of vertical support dependencies. Side
    // contact is deliberately ignored: it must not make a free fragment rigid
    // just because it brushes a grounded stack. This does not alter authored
    // links or make an island permanent.
    const floatingIslands = () => {
      const groupAt = new Map();
      fallingGroups.forEach((group, index) =>
        group.forEach(({ x, y }) => groupAt.set(`${x},${y}`, index)),
      );
      const blockedBy = fallingGroups.map(() => new Set());
      fallingGroups.forEach((group, index) =>
        group.forEach(({ x, y }) => {
          const other = groupAt.get(`${x},${y + 1}`);
          if (other !== undefined && other !== index)
            blockedBy[index].add(other);
        }),
      );
      // Tarjan components merge only mutually dependent groups. An ordinary
      // stack remains separate, while interlocking C shapes fall together.
      const indexAt = Array(fallingGroups.length).fill(-1);
      const lowAt = Array(fallingGroups.length).fill(0);
      const stack = [];
      const stacked = new Set();
      const islands = [];
      let nextIndex = 0;
      let visitCount = 0;
      let graphLimitReached = false;
      const visit = (index) => {
        if (graphLimitReached) return;
        if (++visitCount > maxResolveCells) {
          console.error("[Board] Sticky-gravity graph safety limit reached.", {
            visitCount,
            groupCount: fallingGroups.length,
          });
          graphLimitReached = true;
          return;
        }
        indexAt[index] = lowAt[index] = nextIndex++;
        stack.push(index);
        stacked.add(index);
        blockedBy[index].forEach((neighbor) => {
          if (indexAt[neighbor] < 0) {
            visit(neighbor);
            lowAt[index] = Math.min(lowAt[index], lowAt[neighbor]);
          } else if (stacked.has(neighbor)) {
            lowAt[index] = Math.min(lowAt[index], indexAt[neighbor]);
          }
        });
        if (lowAt[index] !== indexAt[index]) return;
        const component = [];
        let member;
        let memberCount = 0;
        do {
          if (++memberCount > maxResolveCells) {
            console.error("[Board] Sticky-gravity Tarjan stack safety limit reached.", {
              memberCount,
              stackSize: stack.length,
            });
            graphLimitReached = true;
            break;
          }
          member = stack.pop();
          if (member === undefined) {
            console.error("[Board] Sticky-gravity Tarjan stack underflow.");
            graphLimitReached = true;
            break;
          }
          stacked.delete(member);
          component.push(member);
        } while (member !== index);
        islands.push(
          component.flatMap((groupIndex) => fallingGroups[groupIndex]),
        );
      };
      fallingGroups.forEach((_group, index) => {
        if (indexAt[index] < 0) visit(index);
      });
      return islands;
    };

    // Rebuild floating islands after every sweep. Newly touching fragments can
    // then descend together instead of falsely supporting one another midair.
    let movedInSweep = true;
    let sweepCount = 0;
    const maxSweepCount = ROWS * COLS + 1;
    while (movedInSweep) {
      if (++sweepCount > maxSweepCount) {
        console.error("[Board] Sticky-gravity safety limit reached.", {
          sweepCount,
          fallingGroupCount: fallingGroups.length,
        });
        break;
      }
      movedInSweep = false;
      const islands = floatingIslands();
      const occupied = new Set(
        [
          ...stationary.map(({ x, y }) => `${x},${y}`),
          ...fallingGroups.flatMap((group) =>
            group.map(({ x, y }) => `${x},${y}`),
          ),
        ],
      );
      islands.sort(bottomFirst).forEach((island) => {
        island.forEach(({ x, y }) => occupied.delete(`${x},${y}`));
        let fall = 0;
        while (
          island.every(({ x, y }) => {
            const nextY = y + fall + 1;
            return nextY < ROWS && !occupied.has(`${x},${nextY}`);
          })
        ) {
          if (fall >= ROWS) {
            console.error("[Board] Sticky-gravity fall safety limit reached.", { fall, islandSize: island.length });
            break;
          }
          fall += 1;
        }
        if (fall) {
          island.forEach((cell) => {
            cell.y += fall;
          });
          movedInSweep = true;
        }
        island.forEach(({ x, y }) => occupied.add(`${x},${y}`));
      });
    }

    stationary.forEach(({ tile, x, y }) => {
      delete tile.marked;
      delete tile.renderY;
      this.set(x, y, tile);
    });
    fallingGroups.forEach((group) =>
      group.forEach(({ tile, x, y, sourceY }) => {
        if (animateFall && y !== sourceY) tile.renderY = sourceY;
        else delete tile.renderY;
        delete tile.marked;
        this.set(x, y, tile);
      }),
    );
  }
  updateFallAnimation(ms) {
    const step = (CLASSIC_STICKY_FALL_CELLS_PER_SECOND * ms) / 1000;
    let moving = false;
    this.forEachCell((tile, _x, y) => {
      if (!Number.isFinite(tile.renderY)) return;
      tile.renderY = Math.min(y, tile.renderY + step);
      if (tile.renderY < y) moving = true;
      else delete tile.renderY;
    });
    return moving;
  }
}
