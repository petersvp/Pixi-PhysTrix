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
import { damageTrashMino } from "../config/trashConstants.js";

// A Metal PM's mandatory one-cell post-lock drop needs to read as an impact,
// not a single-frame position correction. Other board falls keep their
// existing shared speed.
const METAL_CRUSH_FALL_CELLS_PER_SECOND = 6;

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
    this.lastMaterialDestroyedTiles = [];
    this.lastSlipperyDestroyedTiles = [];
    this.pendingMetalCrush = null;
    this.pendingFillerFall = false;
    this.lastMetalCrushImpact = null;
    // Discrete clustered-gravity settlement records. Physics mode never
    // reads or writes these; it reports Box2D contacts directly instead.
    this.lastStickyImpacts = [];
    this.pendingStickyImpacts = [];
  }
  get(x, y) {
    return (y < 0 ? this.above.get(y) : this.cells[y])?.[x] || null;
  }
  set(x, y, tile) {
    // `-1` is deliberate: ordinary skin-coloured minos are not part of a
    // colour-chain palette. Never let old callers create an unindexed tile.
    if (tile && !Number.isInteger(tile.colorIndex)) tile.colorIndex = -1;
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
    const cells = this.applyQueuedMaterialLockBehavior(piece.cells());
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
          godEssenceItemIndex: cell.godEssenceItemIndex,
          godEssencePolarity: cell.godEssencePolarity,
          godEssenceForeign: cell.godEssenceForeign,
          godEssenceItemName: cell.godEssenceItemName,
          ...(Number.isFinite(cell.renderY) ? { renderY: cell.renderY } : {}),
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
  takeMaterialDestroyedTiles() {
    const destroyed = this.lastMaterialDestroyedTiles;
    this.lastMaterialDestroyedTiles = [];
    return destroyed;
  }
  resolveSlipperyBreakGravity(gravity = CLASSIC_STICKY_GRAVITY) {
    if (!this.lastSlipperyDestroyedTiles.length) return false;
    const removedEntries = this.lastSlipperyDestroyedTiles.map((tile) => ({
      tile,
      x: tile.x,
      y: tile.y,
    }));
    this.lastSlipperyDestroyedTiles = [];
    const survivors = [];
    this.forEachCell((tile, x, y) => survivors.push({ tile, x, y }));
    // reset() correctly rebuilds both board coordinate stores. Preserve only
    // the material-break report, which ClassicGameplay may still consume for
    // score, gems and God Essence after this gravity pass.
    const materialDestroyed = this.lastMaterialDestroyedTiles;
    this.reset();
    this.lastMaterialDestroyedTiles = materialDestroyed;
    if (Board.gravityType(gravity) === "classic")
      this.applyClassicCellGravity(survivors, removedEntries, true);
    else this.applyStickyGravity(survivors, true);
    return true;
  }
  applyQueuedMaterialLockBehavior(sourceCells) {
    const cells = sourceCells.map((cell) => ({ ...cell }));
    this.lastMaterialDestroyedTiles = [];

    // Filler PM minos do not retain their polyomino geometry. Each mino keeps
    // its own column and falls into the lowest available cell at or below its
    // lock position. This intentionally fills vertical holes only; Filler
    // never slides a mino sideways into another column.
    // Filler is a PM-level conversion. If the PM also contains an attachment
    // or God Essence mino, every one of its minos still separates and fills
    // vertically; their own material metadata is retained after placement.
    const fillerPiece = cells.some((cell) => cell.material === "filler");
    const fillerCells = fillerPiece
      ? cells
      : cells.filter((cell) => cell.material === "filler" && !cell.attachment);
    const stationary = new Set(
      cells
        .filter((cell) => !fillerCells.includes(cell))
        .filter((cell) => cell.y >= 0 && cell.y < this.rows)
        .map((cell) => `${cell.x},${cell.y}`),
    );
    const reserved = new Set(stationary);
    const fillersByColumn = new Map();
    fillerCells
      .filter((cell) => cell.x >= 0 && cell.x < this.cols && cell.y >= 0 && cell.y < this.rows)
      .forEach((cell) => {
        const column = fillersByColumn.get(cell.x) || [];
        column.push(cell);
        fillersByColumn.set(cell.x, column);
      });
    this.pendingFillerFall = false;
    fillersByColumn.forEach((fillers, x) => {
      // Lower source minos claim the lowest slots first. A later mino may
      // only use a cell at or below its own source row, so nothing rises.
      fillers.sort((a, b) => b.y - a.y).forEach((cell) => {
        const sourceY = cell.y;
        for (let y = this.rows - 1; y >= sourceY; y -= 1) {
          const key = `${x},${y}`;
          if (this.get(x, y) || reserved.has(key)) continue;
          reserved.add(key);
          cell.y = y;
          if (y !== sourceY) {
            cell.renderY = sourceY;
            this.pendingFillerFall = true;
          }
          break;
        }
      });
    });

    // Metal first locks at its ordinary landing position. ClassicGameplay
    // gives that position one visible beat, then asks this Board to resolve
    // the simultaneous one-row crush and animate the result downward.
    const metalCells = cells.filter(
      (cell) => cell.material === "metal" && !cell.attachment,
    );
    // One Metal mino makes the complete locked PM a Metal compound. Gems and
    // attachments retain their own material/behaviour, but must travel with
    // the same one-row crush rather than being left behind.
    const metalSources = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    const canAdvanceMetal = metalCells.length > 0 && cells.every((cell) => {
      const targetX = cell.x;
      const targetY = cell.y + 1;
      return targetX >= 0 && targetX < this.cols && targetY >= 0 &&
        targetY < this.rows;
    });
    const metalMoves = canAdvanceMetal
      ? cells.map((cell) => ({ cell, x: cell.x, y: cell.y + 1 }))
      : [];
    this.pendingMetalCrush = metalMoves.length
      ? {
          moves: metalMoves.map(({ cell, x, y }) => ({
            from: { x: cell.x, y: cell.y },
            to: { x, y },
          })),
          sourcePositions: metalSources,
        }
      : null;

    // A Metal compound waits for its delayed crush; all of its minos check
    // below their final positions together. Ordinary PMs shatter Slippery at
    // their immediate lock positions.
    if (!metalCells.length) this.shatterSlipperyUnder(cells);
    return cells;
  }
  shatterSlipperyUnder(cells) {
    const shattered = new Set();
    cells.forEach((cell) => {
      const { x, y } = cell;
      const belowY = y + 1;
      const key = `${x},${belowY}`;
      const below = this.get(x, belowY);
      if (
        belowY < this.rows &&
        below?.material === "slippery" &&
        !shattered.has(key)
      ) {
        shattered.add(key);
        const destroyed = { tile: below, x, y: belowY };
        this.markTornEdges([destroyed]);
        // The new mino has just torn through the supporting Slippery mino.
        // It is not in Board yet, so mark its exposed lower edge directly.
        cell.broken = { ...cell.broken, bottom: true };
        this.lastMaterialDestroyedTiles.push({ ...below, x, y: belowY });
        this.lastSlipperyDestroyedTiles.push({ ...below, x, y: belowY });
        this.set(x, belowY, null);
      }
    });
  }
  hasPendingMetalCrush() {
    return Boolean(this.pendingMetalCrush?.moves?.length);
  }
  hasPendingFillerFall() {
    return this.pendingFillerFall;
  }
  takeMetalCrushImpact() {
    const impact = this.lastMetalCrushImpact;
    this.lastMetalCrushImpact = null;
    return impact;
  }
  resolvePendingMetalCrush() {
    const pending = this.pendingMetalCrush;
    this.pendingMetalCrush = null;
    this.lastMetalCrushImpact = null;
    if (!pending?.moves?.length) return false;
    const targetEntries = pending.moves
      .filter(({ to }) => !pending.sourcePositions.has(`${to.x},${to.y}`))
      .map(({ to }) => ({ tile: this.get(to.x, to.y), x: to.x, y: to.y }))
      .filter(({ tile }) => Boolean(tile));
    // Reinforced trash owns durability through trashHp, even while Metalize
    // gives it the metal material/skin. Check it before ordinary Metal so a
    // Metal PM crush properly damages 3 -> 2 -> 1 trash instead of adding an
    // unrelated metalLives field that the renderer never reads.
    const reinforced = targetEntries.filter(({ tile }) =>
      tile.trash
        ? Math.max(1, Number(tile.trashHp) || 1) > 1
        : tile.material === "metal" && Math.max(1, Number(tile.metalLives) || 3) > 1,
    );
    if (reinforced.length) {
      reinforced.forEach(({ tile }) => {
        if (tile.trash) {
          damageTrashMino(tile);
          return;
        }
        // Queue-created Metal starts at three HP. Older/ordinary Metal that
        // has no explicit counter still receives that same first impact.
        tile.metalLives = Math.max(1, Number(tile.metalLives) || 3) - 1;
        tile.broken = { top: true, right: true, bottom: true, left: true };
      });
      const impact = reinforced[0];
      this.lastMetalCrushImpact = {
        position: { x: impact.x + 0.5, y: impact.y + 0.5 },
        health: impact.tile.trash
          ? Math.max(1, Number(impact.tile.trashHp) || 1)
          : Math.max(1, Number(impact.tile.metalLives) || 1),
      };
      return false;
    }
    // Preserve every moving tile before vacating sources. This permits a
    // vertical Metal PM to shift as a single body instead of self-blocking.
    const moving = pending.moves
      .map(({ from, to }) => ({ tile: this.get(from.x, from.y), from, to }))
      .filter(({ tile }) => Boolean(tile));
    if (moving.length !== pending.moves.length) return false;
    const destroyed = targetEntries;
    if (destroyed.length) this.markTornEdges(destroyed);
    destroyed.forEach(({ tile, x, y }) => {
      this.lastMaterialDestroyedTiles.push({ ...tile, x, y });
      this.set(x, y, null);
    });
    moving.forEach(({ from }) => this.set(from.x, from.y, null));
    moving.forEach(({ tile, from, to }) => {
      tile.renderY = from.y;
      tile.fallSpeed = METAL_CRUSH_FALL_CELLS_PER_SECOND;
      this.set(to.x, to.y, tile);
    });
    this.shatterSlipperyUnder(moving.map(({ to }) => to));
    const metal = moving.find(({ tile }) => tile.material === "metal")?.tile;
    const position = moving.reduce(
      (center, { to }) => ({ x: center.x + to.x, y: center.y + to.y }),
      { x: 0, y: 0 },
    );
    this.lastMetalCrushImpact = {
      position: { x: position.x / moving.length + 0.5, y: position.y / moving.length + 0.5 },
      health: Math.max(1, Number(metal?.metalLives) || 3),
    };
    return true;
  }

  // Live Clustered resolution calculates each island's destination once, then
  // leaves renderY at its source so updateFallAnimation owns every visible
  // frame of the fall. This is the gameplay entry point; settle() is reserved
  // for future replay seeking/rewinding.
  beginClusteredFall() {
    const survivors = [];
    this.forEachCell((tile, x, y) => survivors.push({ tile, x, y }));
    this.reset();
    this.applyStickyGravity(survivors, true);
    return survivors.some(({ tile }) => Number.isFinite(tile.renderY));
  }
  settle(animateFall = false) {
    const survivors = [];
    this.forEachCell((tile, x, y) => survivors.push({ tile, x, y }));
    this.reset();
    this.applyStickyGravity(survivors, animateFall);
  }
  findFullLines(allowedMissing = 0) {
    const minimumOccupied = Math.max(1, this.cols - Math.max(0, Math.floor(Number(allowedMissing) || 0)));
    return this.cells
      .map((row, y) => (row.filter(Boolean).length >= minimumOccupied ? y : -1))
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
  cellsInRadius(x, y, radius) {
    const r = Math.max(0, Number(radius) || 0);
    const r2 = r * r;
    const cells = [];
    this.forEachCell((tile, cellX, cellY) => {
      const dx = cellX - x;
      const dy = cellY - y;
      if (dx * dx + dy * dy <= r2) cells.push({ tile, x: cellX, y: cellY });
    });
    return cells;
  }
  destroyCells(cells, gravity = CLASSIC_STICKY_GRAVITY, { applyGravity = true } = {}) {
    const targets = cells.filter(({ x, y }) => this.get(x, y));
    if (!targets.length) return [];
    if (!applyGravity) {
      // A bomb may be resolving while an ordinary match is already marked.
      // Remove only its own targets; those matched cells must remain marked
      // so the caller can still perform the already-detected line/chain clear.
      const targetKeys = new Set(targets.map(({ x, y }) => `${x},${y}`));
      const removedEntries = [];
      const survivors = [];
      this.forEachCell((tile, x, y) => {
        const entry = { tile, x, y };
        if (targetKeys.has(`${x},${y}`)) removedEntries.push(entry);
        else survivors.push(entry);
      });
      const clearedTiles = removedEntries.map(({ tile, x, y }) => ({ ...tile, x, y }));
      this.markTornEdges(removedEntries);
      this.reset();
      this.lastClearedTiles = clearedTiles;
      // Bomb removal itself neither compacts columns nor starts clustered
      // gravity. Existing marked cells deliberately keep their pending state.
      survivors.forEach(({ tile, x, y }) => {
        delete tile.renderY;
        this.set(x, y, tile);
      });
      return clearedTiles;
    }
    this.markCells(targets);
    this.resolveMarkedCells(gravity);
    return this.lastClearedTiles;
  }
  disconnectCells(cells, gravity = CLASSIC_STICKY_GRAVITY) {
    const targets = cells.filter(({ x, y }) => this.get(x, y));
    const sides = [[0, -1, "top", "bottom"], [1, 0, "right", "left"], [0, 1, "bottom", "top"], [-1, 0, "left", "right"]];
    targets.forEach(({ tile, x, y }) => sides.forEach(([dx, dy, side, opposite]) => {
      tile.broken ??= { top: false, right: false, bottom: false, left: false };
      tile.broken[side] = true;
      const neighbor = this.get(x + dx, y + dy);
      if (!neighbor) return;
      neighbor.broken ??= { top: false, right: false, bottom: false, left: false };
      neighbor.broken[opposite] = true;
    }));
    if (Board.gravityType(gravity) === "clustered") this.beginClusteredFall();
    return targets;
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
      if (tile?.material !== "metal" || tile.trash) return;
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
  protectTrashCells(cells) {
    const protectedCells = new Set();
    cells.forEach(({ x, y }) => {
      const tile = this.get(x, y);
      if (!damageTrashMino(tile)) return;
      protectedCells.add(`${x},${y}`);
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
    // A protected Metal/Trash match can reach this method with every target
    // unmarked after taking durability damage. There is no board mutation to
    // resolve in that case. In particular, do not reset before this check:
    // reset() clears cells and would discard every survivor.
    if (!clearedTiles.length) {
      this.lastClearedTiles = [];
      return 0;
    }
    this.markTornEdges(removedEntries);
    this.reset();
    this.lastClearedTiles = clearedTiles;
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
    this.lastStickyImpacts = [];
    this.pendingStickyImpacts = [];
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

    const fallingGroups = groups.map((group, groupIndex) =>
      group.map((entry) => ({
        ...entry,
        groupIndex,
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
    const stationaryPositions = new Set(
      stationary.map(({ x, y }) => `${x},${y}`),
    );
    const movedGroupIndexes = new Set();
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
      const groupAt = new Map(
        fallingGroups.flatMap((group, groupIndex) =>
          group.map(({ x, y }) => [`${x},${y}`, groupIndex]),
        ),
      );
      islands.sort(bottomFirst).forEach((island) => {
        island.forEach(({ x, y }) => {
          const key = `${x},${y}`;
          occupied.delete(key);
          groupAt.delete(key);
        });
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
          // An impact belongs only to a group that reaches the floor or a
          // group that was already settled. A fragment that merely lands on
          // another fragment which fell this sweep is deliberately silent.
          const reachesSettledSupport = ({ x, y }) => {
            const supportY = y + fall + 1;
            if (supportY >= this.rows) return true;
            const supportKey = `${x},${supportY}`;
            if (stationaryPositions.has(supportKey)) return true;
            const supportGroup = groupAt.get(supportKey);
            return supportGroup !== undefined && !movedGroupIndexes.has(supportGroup);
          };
          const reachedSettledSupport = island.some(reachesSettledSupport);
          const metalImpactCell = island.find(
            (cell) => cell.tile.material === "metal" && reachesSettledSupport(cell),
          );
          island.forEach((cell) => {
            cell.y += fall;
          });
          island.forEach(({ groupIndex }) => movedGroupIndexes.add(groupIndex));
          if (reachedSettledSupport) {
            const position = island.reduce(
              (center, { x, y }) => ({ x: center.x + x, y: center.y + y }),
              { x: 0, y: 0 },
            );
            position.x /= island.length;
            position.y /= island.length;
            const impact = {
              // This is the clustered/discrete counterpart to a physics
              // contact. It is emitted only when this group's visual fall
              // reaches its final board row, not when the solver finds it.
              fallDistance: fall,
              position,
              material: metalImpactCell ? "metal" : "plastic",
              health: metalImpactCell?.tile.metalLives,
            };
            if (animateFall)
              this.pendingStickyImpacts.push({
                ...impact,
                tiles: island.map(({ tile }) => tile),
              });
            else this.lastStickyImpacts.push(impact);
          }
          movedInSweep = true;
        }
        island.forEach(({ x, y, groupIndex }) => {
          const key = `${x},${y}`;
          occupied.add(key);
          groupAt.set(key, groupIndex);
        });
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
      const tileStep = Number.isFinite(tile.fallSpeed)
        ? (tile.fallSpeed * ms) / 1000
        : step;
      tile.renderY = Math.min(y, tile.renderY + tileStep);
      if (tile.renderY < y) moving = true;
      else {
        delete tile.renderY;
        delete tile.fallSpeed;
      }
    });
    // A solve can create several independently falling groups. Complete each
    // sound when its own visual fall lands; do not wait for other groups whose
    // longer paths are still animating.
    this.pendingStickyImpacts = this.pendingStickyImpacts.filter((impact) => {
      if (impact.tiles.some((tile) => Number.isFinite(tile.renderY))) return true;
      const { tiles, ...completedImpact } = impact;
      this.lastStickyImpacts.push(completedImpact);
      return false;
    });
    if (!moving) this.pendingFillerFall = false;
    return moving;
  }
}
