/**
 * Owns the Pixi Graphics target reserved for polyomino rendering.
 *
 * This module is part of the render layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class PolyominoRenderer {
  constructor(graphics) {
    this.graphics = graphics;
  }
}
