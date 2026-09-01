/**
 * Collects one game's drop, clear, chain, and spin summary data.
 * Both gameplay backends report outcomes here instead of maintaining UI state.
 * Long clear labels are deduplicated while retaining their largest line count.
 * The HUD consumes the immutable snapshot returned at game over.
 * No rendering or scoring decisions live in this class.
 */

import { chainName } from "./ChainSystem.js";

const BASE_CLEAR_LABELS = Object.freeze([
  "SINGLES",
  "DOUBLES",
  "TRIPLES",
  "PHYSTRIXES",
]);

export class GameStatistics {
  reset() {
    this.figuresDropped = 0;
    this.clearCounts = [0, 0, 0, 0];
    this.longChains = new Map();
    this.allClears = 0;
    this.spins = {
      all: 0,
      t: 0,
      tTriple: 0,
      penta: 0,
      mega: 0,
    };
    this.spawnedTypes = new Set();
  }

  constructor() {
    this.reset();
  }

  recordSpawn(type) {
    if (type) this.spawnedTypes.add(type);
  }

  recordDrop() {
    this.figuresDropped += 1;
  }

  recordClear(lines, allClear = false) {
    if (lines >= 1 && lines <= BASE_CLEAR_LABELS.length)
      this.clearCounts[lines - 1] += 1;
    else if (lines > BASE_CLEAR_LABELS.length) {
      const label = chainName(lines);
      const entry = this.longChains.get(label) || { count: 0, biggest: 0 };
      entry.count += 1;
      entry.biggest = Math.max(entry.biggest, lines);
      this.longChains.set(label, entry);
    }
    if (allClear) this.allClears += 1;
  }

  recordSpin(spin, lines, order) {
    if (!spin || lines <= 0) return;
    this.spins.all += 1;
    if (spin.startsWith("T-SPIN")) {
      this.spins.t += 1;
      if (lines >= 3) this.spins.tTriple += 1;
    }
    if (order === 5) this.spins.penta += 1;
    if (spin === "MEGASPIN") this.spins.mega += 1;
  }

  snapshot(elapsedMs = 0) {
    const longestChains = [...this.longChains.entries()]
      .map(([label, entry]) => ({ label, ...entry }))
      .sort((a, b) => b.biggest - a.biggest || b.count - a.count);
    const extras = [];
    if (this.allClears) extras.push({ label: "ALL CLEARS", count: this.allClears });
    extras.push(...longestChains);
    return {
      figuresDropped: this.figuresDropped,
      dropsPerSecond: elapsedMs > 0 ? this.figuresDropped / (elapsedMs / 1000) : 0,
      baseClears: BASE_CLEAR_LABELS.map((label, index) => ({
        label,
        count: this.clearCounts[index],
      })),
      extras: extras.slice(0, 3),
      spins: { ...this.spins },
      spawnedTypes: new Set(this.spawnedTypes),
    };
  }
}
