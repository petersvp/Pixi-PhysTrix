/**
 * Draws shader-rendered polyomino previews inside a supplied Pixi container.
 *
 * This module is part of the ui layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { CELL } from "../config/gameplayConstants.js";
import { resolvePolyominoDefinition } from "../game/PolyominoDefinitions.js";
import { MinoQuadRenderer } from "../render/MinoQuadRenderer.js";

export class PreviewPanel {
  constructor(width, material) {
    this.width = width;
    // Preview minos use their owning Playfield material, not the editor's
    // global default, so future versus players may preview different skins.
    this.quads = new MinoQuadRenderer(material);
    this.targetSignatures = new WeakMap();
  }

  draw(target, types, slots, scale) {
    const signature = JSON.stringify([types, slots, scale]);
    if (this.targetSignatures.get(target) === signature) return;
    this.targetSignatures.set(target, signature);
    target
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    types.filter(Boolean).forEach((source, index) => {
      const slot = slots[index];
      if (!slot) return;
      const definition = resolvePolyominoDefinition(source);
      const cells = [];
      definition.matrix.forEach((row, y) =>
        row.forEach((filled, x) => {
          if (filled) cells.push({ x, y });
        }),
      );
      const minX = Math.min(...cells.map((cell) => cell.x));
      const maxX = Math.max(...cells.map((cell) => cell.x));
      const minY = Math.min(...cells.map((cell) => cell.y));
      const maxY = Math.max(...cells.map((cell) => cell.y));
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      // Keep the configured presentation scale unless a non-standard piece
      // would exceed the slot's drawn bounds.
      const previewScale = Math.min(
        scale,
        (slot.width - slot.padding * 2) / (width * CELL),
        (slot.height - slot.padding * 2) / (height * CELL),
      );
      const node = new PIXI.Container();
      node.label = `previewPolyomino${index}`;
      node.scale.set(previewScale);
      node.position.set(
        slot.x + slot.width / 2 - ((minX + maxX + 1) * CELL * previewScale) / 2,
        slot.y +
          slot.height / 2 -
          ((minY + maxY + 1) * CELL * previewScale) / 2,
      );
      const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
      this.quads.draw(node, cells, definition.color, (cell) => ({
        top: occupied.has(`${cell.x},${cell.y - 1}`),
        right: occupied.has(`${cell.x + 1},${cell.y}`),
        bottom: occupied.has(`${cell.x},${cell.y + 1}`),
        left: occupied.has(`${cell.x - 1},${cell.y}`),
        topLeft: occupied.has(`${cell.x - 1},${cell.y - 1}`),
        topRight: occupied.has(`${cell.x + 1},${cell.y - 1}`),
        bottomRight: occupied.has(`${cell.x + 1},${cell.y + 1}`),
        bottomLeft: occupied.has(`${cell.x - 1},${cell.y + 1}`),
      }));
      target.addChild(node);
    });
  }
}
