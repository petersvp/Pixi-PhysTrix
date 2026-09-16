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
  constructor(width, material, materials = {}) {
    this.width = width;
    // Preview minos use their owning Playfield material, not the editor's
    // global default, so future versus players may preview different skins.
    this.quads = new MinoQuadRenderer(material);
    this.specialQuads = new Map(Object.entries(materials).map(([name, settings]) => [name, new MinoQuadRenderer(settings)]));
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
      const palette = Array.isArray(source.palette)
        ? source.palette.map((color) => Number.isFinite(color)
          ? color
          : Number.parseInt(String(color).replace("#", ""), 16))
        : [];
      // A queued item is already a complete set of minos. Reconstructing it
      // from its matrix silently loses Color Per Mino assignments.
      const cells = Array.isArray(source.minos)
        ? source.minos.map((mino) => ({
            ...mino,
            color: mino.colorIndex < 0
              ? source.color ?? definition.color
              : palette[mino.colorIndex] ?? source.color ?? definition.color,
          }))
        : definition.matrix.flatMap((row, y) =>
            row.flatMap((filled, x) => (filled ? [{ x, y, colorIndex: -1 }] : [])),
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
      const linksFor = (cell) => ({
        top: occupied.has(`${cell.x},${cell.y - 1}`),
        right: occupied.has(`${cell.x + 1},${cell.y}`),
        bottom: occupied.has(`${cell.x},${cell.y + 1}`),
        left: occupied.has(`${cell.x - 1},${cell.y}`),
        topLeft: occupied.has(`${cell.x - 1},${cell.y - 1}`),
        topRight: occupied.has(`${cell.x + 1},${cell.y - 1}`),
        bottomRight: occupied.has(`${cell.x + 1},${cell.y + 1}`),
        bottomLeft: occupied.has(`${cell.x - 1},${cell.y + 1}`),
      });
      const byMaterial = new Map();
      cells.forEach((cell) => {
        const key = cell.material || "default";
        const group = byMaterial.get(key) || [];
        group.push(cell);
        byMaterial.set(key, group);
      });
      byMaterial.forEach((group, materialName) => {
        // MinoQuadRenderer clears its own target before drawing. Each material
        // therefore needs a dedicated child, otherwise the final material
        // group erases every ordinary mino in this preview.
        const materialLayer = new PIXI.Container();
        materialLayer.label = `previewMaterial:${materialName}`;
        node.addChild(materialLayer);
        (this.specialQuads.get(materialName) || this.quads).draw(
          materialLayer, group, source.color ?? definition.color, linksFor,
        );
      });
      target.addChild(node);
    });
  }
}
