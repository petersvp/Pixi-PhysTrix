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
import { planMinoDrops } from "./MinoDropPlanner.js";

export class Board {
  constructor(cols = COLS, rows = ROWS) {
    this.cols = Math.max(4, Math.floor(Number(cols) || COLS));
    this.rows = Math.max(4, Math.floor(Number(rows) || ROWS));
    this.reset();
  }
  reset() {
    this.cells = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    this.above = new Map();
    this.lastClearedTiles = [];
  }
  get(x, y) {
    return (y < 0 ? this.above.get(y) : this.cells[y])?.[x] || null;
  }
  set(x, y, tile) {
    // `-1` is deliberate: ordinary skin-coloured minos are not part of a
    // colour-chain palette. Never let old callers create an unindexed tile.
    if (!Number.isInteger(tile?.colorIndex)) tile.colorIndex = -1;
    if (y >= 0) this.cells[y][x] = tile;
    else {
      const row = this.above.get(y) || Array(this.cols).fill(null);
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
      ({ x, y }) => x >= 0 && x < this.cols && y < this.rows && !this.get(x, y),
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
  static gravityType(value = CLASSIC_STICKY_GRAVITY) {
    if (value === "classic") return "classic";
    if (value === "clustered") return "clustered";
    // Keep the old boolean Board API valid for standalone callers.
    return value ? "clustered" : "classic";
  }
  lock(piece) {
    const cells = piece.cells();
    if (cells.length > this.rows * this.cols) {
      console.error("[Board] Refusing oversized locked polyomino.", {
        cells: cells.length,
        maximum: this.rows * this.cols,
      });
      return false;
    }
    const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const has = (x, y) => occupied.has(`${x},${y}`);
    const cellsByPosition = new Map(
      cells.map((cell) => [`${cell.x},${cell.y}`, cell]),
    );
    const componentByPosition = new Map();
    let componentCount = 0;
    cells.forEach((first) => {
      const firstKey = `${first.x},${first.y}`;
      if (componentByPosition.has(firstKey)) return;
      const pending = [first];
      componentByPosition.set(firstKey, componentCount);
      for (let index = 0; index < pending.length; index += 1) {
        const cell = pending[index];
        [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
          const neighbor = cellsByPosition.get(`${cell.x + dx},${cell.y + dy}`);
          const key = neighbor && `${neighbor.x},${neighbor.y}`;
          if (!neighbor || componentByPosition.has(key)) return;
          componentByPosition.set(key, componentCount);
          pending.push(neighbor);
        });
      }
      componentCount += 1;
    });
    cells.forEach((cell) => {
      const { x, y } = cell;
      if (y < this.rows)
        this.set(x, y, {
          colorIndex: Number.isInteger(cell.colorIndex) ? cell.colorIndex : -1,
          material: cell.material || "default",
          baseColor: cell.baseColor ?? piece.color,
          pieceId:
            componentCount > 1
              ? `${piece.id}:${componentByPosition.get(`${x},${y}`)}`
              : piece.id,
          // Custom/broken polyomino topology is part of the mino data. Only
          // ordinary generated pieces need inferred links at their first lock.
          visualLinks: cell.visualLinks
            ? { ...cell.visualLinks }
            : {
                top: has(x, y - 1),
                right: has(x + 1, y),
                bottom: has(x, y + 1),
                left: has(x - 1, y),
                topLeft: has(x - 1, y - 1),
                topRight: has(x + 1, y - 1),
                bottomRight: has(x + 1, y + 1),
                bottomLeft: has(x - 1, y + 1),
              },
          broken: {
            top: Boolean(cell.broken?.top),
            right: Boolean(cell.broken?.right),
            bottom: Boolean(cell.broken?.bottom),
            left: Boolean(cell.broken?.left),
          },
        });
    });
    return componentCount;
  }

  // Disconnected authored components only need this in Clustered gravity.
  // `animateFall` retains their source row so the renderer shows the fall.
  settle(animateFall = false) {
    const survivors = [];
    this.forEachCell((tile, x, y) => survivors.push({ tile, x, y }));
    this.reset();
    this.applyStickyGravity(survivors, animateFall);
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
  spawnMetalDrops(count = 0, random = Math.random, {
    colorMode = false,
    colorCount = 0,
    settleImmediately = false,
    animateFall = false,
  } = {}) {
    const drops = planMinoDrops(count, this.cols, random);
    const paletteSize = Math.max(0, Math.floor(Number(colorCount) || 0));
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index];
      const x = drop.x;
      // Grid/Classic must not invoke sticky/clustered gravity for a drop.
      // Resolve this independent mono-mino directly to the lowest open cell,
      // without replacing an occupied tile.
      let y = -1;
      let sourceY = -1;
      if (settleImmediately) {
        // Find a free spawn row above any pending drop, then walk downward
        // until the first occupied cell. Choosing the *lowest* empty row was
        // wrong for uneven stacks: it made the animation visibly pass through
        // a mino and land in a hole below it.
        while (this.get(x, sourceY)) sourceY -= 1;
        y = sourceY;
        while (y + 1 < this.rows && !this.get(x, y + 1)) y += 1;
      }
      const tile = {
        colorIndex: colorMode && paletteSize ? Math.floor(random() * paletteSize) : -1,
        baseColor: 0x88909c,
        material: drop.material,
        ...(drop.metalLives ? { metalLives: drop.metalLives } : {}),
        pieceId: `metal-drop-${Date.now()}-${index}`,
        visualLinks: { top: false, right: false, bottom: false, left: false },
        broken: { top: drop.broken, right: drop.broken, bottom: drop.broken, left: drop.broken },
      };
      // `renderY` is the same renderer animation channel used by settled
      // clusters, but this drop never enters the sticky-gravity solver.
      if (animateFall && y !== sourceY) tile.renderY = sourceY;
      this.set(x, y, tile);
    }
    return drops.length;
  }
  protectMetalCells(cells) {
    const protectedCells = new Set();
    cells.forEach(({ x, y }) => {
      const tile = this.get(x, y);
      if (tile?.material !== "metal") return;
      protectedCells.add(`${x},${y}`);
      const lives = Math.max(1, Math.floor(Number(tile.metalLives) || 3));
      if (lives > 2) {
        tile.metalLives = 2;
        tile.broken = { top: true, right: true, bottom: true, left: true };
      } else {
        delete tile.metalLives;
        // The final vulnerable state uses the attachment skin until a later
        // clear removes this mino altogether.
        tile.material = "attachment";
        tile.broken = { top: false, right: false, bottom: false, left: false };
      }
    });
    return cells.filter(({ x, y }) => !protectedCells.has(`${x},${y}`));
  }
  // A cleared mino exposes the face of every surviving mino from the same
  // locked polyomino.  Keep this separate from gravity: once the board has
  // been rebuilt, the removed mino no longer exists to tell us which edge was
  // torn.  `pieceId` is deliberately included alongside visual links because
  // imported/repaired minos can legitimately have incomplete link metadata.
  markTornEdges(removedEntries) {
    if (!removedEntries.length) return;
    const removed = new Map(
      removedEntries.map((entry) => [`${entry.x},${entry.y}`, entry]),
    );
    const sides = [
      [0, -1, "top", "bottom"],
      [1, 0, "right", "left"],
      [0, 1, "bottom", "top"],
      [-1, 0, "left", "right"],
    ];
    removedEntries.forEach(({ tile, x, y }) => {
      sides.forEach(([dx, dy, side, opposite]) => {
        const neighborX = x + dx;
        const neighborY = y + dy;
        if (removed.has(`${neighborX},${neighborY}`)) return;
        const neighbor = this.get(neighborX, neighborY);
        if (!neighbor) return;
        const samePolyomino =
          tile.pieceId !== undefined && tile.pieceId === neighbor.pieceId;
        if (!samePolyomino && !Board.areConnected(tile, neighbor, side, opposite))
          return;
        neighbor.broken ??= { top: false, right: false, bottom: false, left: false };
        neighbor.broken[opposite] = true;
      });
    });
  }
  resolveMarkedCells(gravity = CLASSIC_STICKY_GRAVITY) {
    const removedEntries = [];
    const survivors = [];
    this.forEachCell((tile, x, y) => {
      const entry = { tile, x, y };
      if (tile.marked) removedEntries.push(entry);
      else survivors.push(entry);
    });
    const clearedTiles = removedEntries.map(({ tile, x, y }) => ({ ...tile, x, y }));
    this.markTornEdges(removedEntries);
    this.reset();
    this.lastClearedTiles = clearedTiles;
    if (!clearedTiles.length) return 0;
    if (Board.gravityType(gravity) === "classic")
      this.applyClassicCellGravity(survivors, removedEntries, true);
    else this.applyStickyGravity(survivors, true);
    return clearedTiles.length;
  }
  clearLines(stickyGravity = CLASSIC_STICKY_GRAVITY) {
    return this.clearRows(this.findFullLines(), stickyGravity, false);
  }
  resolveMarkedLines(gravity = CLASSIC_STICKY_GRAVITY) {
    const rows = this.cells
      .map((row, y) => (row.every((tile) => tile?.marked) ? y : -1))
      .filter((y) => y >= 0);
    return this.clearRows(rows, gravity, true);
  }
  clearRows(rows, gravity, animateFall) {
    const removedEntries = rows.flatMap((y) =>
      this.cells[y].map((tile, x) => tile && { tile, x, y }).filter(Boolean),
    );
    const clearedTiles = removedEntries.map(({ tile, x, y }) => ({ ...tile, x, y }));
    this.lastClearedTiles = clearedTiles;
    if (!rows.length) return 0;
    const removed = new Set(rows);
    this.markTornEdges(removedEntries);
    const survivors = [];
    this.forEachCell((tile, x, y) => {
      if (!removed.has(y)) survivors.push({ tile, x, y });
    });
    this.reset();
    this.lastClearedTiles = clearedTiles;
    if (Board.gravityType(gravity) === "clustered") {
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
  // Classic gravity resolves a cell clear independently in every column.
  // Unlike clustered gravity, a bridge cannot hold a fragment over a hole:
  // every cell above that hole drops exactly with its own column.  Connections
  // whose endpoints acquire different destinations are torn on both faces.
  applyClassicCellGravity(survivors, removedEntries, animateFall = false) {
    const original = new Map(
      survivors.map((entry) => [`${entry.x},${entry.y}`, entry]),
    );
    const removedByColumn = new Map();
    removedEntries.forEach(({ x, y }) => {
      const rows = removedByColumn.get(x) || [];
      rows.push(y);
      removedByColumn.set(x, rows);
    });
    const destinations = new Map();
    survivors.forEach((entry) => {
      const fall = (removedByColumn.get(entry.x) || []).filter(
        (removedY) => removedY > entry.y,
      ).length;
      destinations.set(entry, { x: entry.x, y: entry.y + fall });
    });
    const sides = [
      [0, -1, "top", "bottom"],
      [1, 0, "right", "left"],
      [0, 1, "bottom", "top"],
      [-1, 0, "left", "right"],
    ];
    survivors.forEach((entry) => {
      const destination = destinations.get(entry);
      sides.forEach(([dx, dy, side, opposite]) => {
        const neighbor = original.get(`${entry.x + dx},${entry.y + dy}`);
        if (!neighbor || !Board.areConnected(entry.tile, neighbor.tile, side, opposite))
          return;
        const neighborDestination = destinations.get(neighbor);
        if (
          neighborDestination.x === destination.x + dx &&
          neighborDestination.y === destination.y + dy
        )
          return;
        entry.tile.broken ??= { top: false, right: false, bottom: false, left: false };
        neighbor.tile.broken ??= { top: false, right: false, bottom: false, left: false };
        entry.tile.broken[side] = true;
        neighbor.tile.broken[opposite] = true;
      });
    });
    survivors.forEach((entry) => {
      const destination = destinations.get(entry);
      if (animateFall && entry.y !== destination.y) entry.tile.renderY = entry.y;
      else delete entry.tile.renderY;
      delete entry.tile.marked;
      this.set(destination.x, destination.y, entry.tile);
    });
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
    const maxResolveCells = this.rows * this.cols;
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
    const maxSweepCount = this.rows * this.cols + 1;
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
            return nextY < this.rows && !occupied.has(`${x},${nextY}`);
          })
        ) {
          if (fall >= this.rows) {
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
