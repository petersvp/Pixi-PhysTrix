/**
 * Provides a Pixi Graphics layer for optional gameplay debug drawing.
 *
 * This module is part of the render layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class DebugRenderer {
  constructor(graphics) {
    this.graphics = graphics;
  }
  clear() {
    this.graphics.clear();
  }
}
