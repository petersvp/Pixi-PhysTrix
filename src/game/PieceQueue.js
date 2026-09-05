/**
 * Provides configurable bag or true-random polyomino generation for sessions.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { bagGenerator } from "../config/gameplayConstants.js";
import { bagGeneratorForPreset, roomBagGenerator } from "../config/bags.js";

const DEFAULT_QUEUE_SIZE = 5;
const MAX_QUEUE_SIZE = 6;
const colorNumber = (color) =>
  Number.parseInt(String(color).replace("#", ""), 16) || 0xffffff;

const shuffle = (items, random) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
export class PieceQueue {
  constructor(random = Math.random, preset = null, roomRules = null) {
    this.random = random;
    this.preset = preset;
    this.roomRules = roomRules;
    this.targetSize = Math.max(
      0,
      Math.min(
        MAX_QUEUE_SIZE,
        Math.floor(Number(roomRules?.mutators?.queueSize ?? DEFAULT_QUEUE_SIZE)),
      ),
    );
    this.bag = [];
    this.items = [];
  }
  next() {
    if (!this.targetSize) return this.items.shift() || this.draw();
    this.fill();
    const next = this.items.shift();
    this.fill();
    return next;
  }
  // Inspect the next queued type without consuming it. Physics release uses
  // this to wait for a safe spawn position while the pile keeps simulating.
  peek() {
    if (!this.targetSize) {
      if (!this.items.length) this.items.push(this.draw());
      return this.items[0];
    }
    this.fill();
    return this.items[0];
  }
  fill() {
    let steps = 0;
    while (this.items.length < this.targetSize) {
      if (++steps > this.targetSize + 1) {
        console.error("[PieceQueue] Refill safety limit reached.", {
          items: this.items.length,
          steps,
        });
        break;
      }
      this.items.push(this.draw());
    }
  }
  draw() {
    if (!this.bag.length) {
      const source = this.roomRules?.bag
        ? roomBagGenerator(this.roomRules.bag, this.roomRules.physics?.materials, this.random)
        : this.preset
        ? bagGeneratorForPreset(this.preset, this.random, bagGenerator)
        : typeof bagGenerator === "function"
          ? bagGenerator(this.random)
          : bagGenerator;
      this.bag = shuffle(source, this.random);
    }
    const definition = this.bag.pop();
    const chain = this.roomRules?.chain;
    if (!chain || !["color-lines", "color-clusters"].includes(chain.mode))
      return definition;
    const palette = (chain.colors || [])
      .slice(0, Math.max(1, Number(chain.colorCount) || 1))
      .map(colorNumber);
    if (!palette.length) return definition;
    const pick = () => palette[Math.floor(this.random() * palette.length)];
    const color = pick();
    return {
      ...definition,
      color,
      cellColors: chain.colorPerMino
        ? definition.matrix.map((row) => row.map((filled) => (filled ? pick() : null)))
        : null,
    };
  }
}
