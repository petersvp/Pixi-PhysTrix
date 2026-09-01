/**
 * Provides configurable bag or true-random polyomino generation for sessions.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { bagGenerator } from "../config/gameplayConstants.js";
import { bagGeneratorForPreset } from "../config/bags.js";

const shuffle = (items, random) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
export class PieceQueue {
  constructor(random = Math.random, preset = null) {
    this.random = random;
    this.preset = preset;
    this.bag = [];
    this.items = [];
  }
  next() {
    while (this.items.length < 5) this.items.push(this.draw());
    const next = this.items.shift();
    while (this.items.length < 5) this.items.push(this.draw());
    return next;
  }
  // Inspect the next queued type without consuming it. Physics release uses
  // this to wait for a safe spawn position while the pile keeps simulating.
  peek() {
    while (this.items.length < 5) this.items.push(this.draw());
    return this.items[0];
  }
  draw() {
    if (!this.bag.length) {
      const source = this.preset
        ? bagGeneratorForPreset(this.preset, this.random, bagGenerator)
        : typeof bagGenerator === "function"
          ? bagGenerator(this.random)
          : bagGenerator;
      this.bag = shuffle(source, this.random);
    }
    return this.bag.pop();
  }
}
