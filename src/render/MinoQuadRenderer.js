/**
 * Builds minos as individual sprite quads with adjacency-aware SDF filters.
 * One display sprite is created for each cell in a polyomino cell set.
 * Links include the four cardinal and four diagonal neighboring cells.
 * The renderer supports any cell count, including future pentominoes.
 * Containers may be transformed by callers for physics body rotation.
 */

import { CELL } from "../config/gameplayConstants.js";
import { createMinoShader } from "./MinoShader.js";

export class MinoQuadRenderer {
  static geometry = new PIXI.MeshGeometry({
    positions: new Float32Array([0, 0, CELL, 0, CELL, CELL, 0, CELL]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    topology: "triangle-list",
  });

  constructor(material) {
    this.material = material;
  }

  draw(
    container,
    cells,
    color,
    linksForCell,
    alpha = 1,
    offsetX = 0,
    offsetY = 0,
    material = this.material,
  ) {
    container.removeChildren().forEach((child) => child.destroy());
    cells.forEach((cell) => {
      const links = linksForCell(cell);
      const quad = new PIXI.Mesh({
        geometry: MinoQuadRenderer.geometry,
        shader: createMinoShader(color, links, material),
      });
      // Use source-alpha compositing for translucent shader faces and bevels.
      quad.blendMode = "normal";
      quad.position.set(
        ((cell.renderX ?? cell.x) + offsetX) * CELL,
        ((cell.renderY ?? cell.y) + offsetY) * CELL,
      );
      quad.alpha = alpha;
      container.addChild(quad);
    });
  }
}
