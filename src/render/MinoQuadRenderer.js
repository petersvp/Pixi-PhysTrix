/**
 * Builds minos as individual sprite quads with adjacency-aware SDF filters.
 * One display sprite is created for each cell in a polyomino cell set.
 * Links include the four cardinal and four diagonal neighboring cells.
 * The renderer supports any cell count, including future pentominoes.
 * Containers may be transformed by callers for physics body rotation.
 */

import { CELL } from "../config/gameplayConstants.js";
import { createMinoShader } from "./MinoShader.js";

const NOISE_SCENE_WIDTH = 900;
const NOISE_SCENE_HEIGHT = 700;

export class MinoQuadRenderer {
  static geometries = new Map();

  static geometryFor(cellSize) {
    let geometry = this.geometries.get(cellSize);
    if (!geometry) {
      geometry = new PIXI.MeshGeometry({
        positions: new Float32Array([
          0,
          0,
          cellSize,
          0,
          cellSize,
          cellSize,
          0,
          cellSize,
        ]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        topology: "triangle-list",
      });
      this.geometries.set(cellSize, geometry);
    }
    return geometry;
  }

  constructor(material, { cellSize = CELL } = {}) {
    this.material = material;
    this.cellSize = cellSize;
    this.geometry = MinoQuadRenderer.geometryFor(cellSize);
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
      const cellColor = cell.color ?? color;
      const renderX = (cell.renderX ?? cell.x) + offsetX;
      const renderY = (cell.renderY ?? cell.y) + offsetY;
      // Keep fracture noise in the mino's authored board/body space. Do not
      // use the Pixi world transform here: a parent filter may substitute a
      // render-texture transform for that matrix.
      const noiseSceneUv = [
        (renderX * this.cellSize) / NOISE_SCENE_WIDTH,
        (renderY * this.cellSize) / NOISE_SCENE_HEIGHT,
        this.cellSize / NOISE_SCENE_WIDTH,
        this.cellSize / NOISE_SCENE_HEIGHT,
      ];
      const quad = new PIXI.Mesh({
        geometry: this.geometry,
        shader: createMinoShader(cellColor, links, material, noiseSceneUv),
      });
      // Use source-alpha compositing for translucent shader faces and bevels.
      quad.blendMode = "normal";
      quad.position.set(
        renderX * this.cellSize,
        renderY * this.cellSize,
      );
      quad.alpha = alpha;
      container.addChild(quad);
    });
  }
}
