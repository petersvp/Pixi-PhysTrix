/**
 * Tracks the shared delay before marked minos are removed.
 *
 * This module is part of the physics layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class VanishSystem {
  constructor(duration = 1000) {
    this.duration = duration;
    this.deadline = 0;
    this.pendingLines = new Map();
  }
  mark(rows, now) {
    const tiles = rows.flatMap((row) => row.tiles);
    const fresh = tiles.filter((t) => !t.marked);
    fresh.forEach((t) => (t.marked = true));
    if (fresh.length) {
      const freshSet = new Set(fresh);
      rows
        .filter((row) => row.tiles.some((tile) => freshSet.has(tile)))
        .forEach((row) => this.pendingLines.set(row.y, row));
      this.deadline = now + this.duration;
    }
    return fresh;
  }
  due(now) {
    return this.deadline > 0 && now >= this.deadline;
  }
  pending() {
    return this.deadline > 0;
  }
  consumeLines() {
    return [...this.pendingLines.values()];
  }
  reset() {
    this.deadline = 0;
    this.pendingLines.clear();
  }
}
