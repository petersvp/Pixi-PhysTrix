/**
 * Draws live Box2D compound bodies using one adjacency-aware shader quad per mino.
 * Each body container inherits the Box2D position and rotation after its quads are built.
 * Stored visual links preserve original rounded-edge masks after a fracture.
 * Marked minos receive a separate light overlay while retaining the shader material.
 * Rendering never reads a cached grid; body data is the source of visual state.
 */

import {
  MARKED_MINO_GLOW_DISTANCE,
  MARKED_MINO_GLOW_QUALITY,
  MARKED_MINO_GLOW_STRENGTH,
  MARKED_MINO_OUTLINE_LIGHTNESS,
} from "../config/effectsConstants.js";
import { MinoQuadRenderer } from "./MinoQuadRenderer.js";
import { polyominoCentroid } from "../game/Polyomino.js";

const halfDesaturate = (color) => {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  const grey = Math.round((red + green + blue) / 3);
  return (Math.round((red + grey) / 2) << 16) |
    (Math.round((green + grey) / 2) << 8) |
    Math.round((blue + grey) / 2);
};

const darken = (color, amount) =>
  (Math.round(((color >> 16) & 0xff) * amount) << 16) |
  (Math.round(((color >> 8) & 0xff) * amount) << 8) |
  Math.round((color & 0xff) * amount);

const lightenColor = (color, amount) => {
  const lift = (channel) => Math.round(channel + (255 - channel) * amount);
  return (
    (lift((color >> 16) & 0xff) << 16) |
    (lift((color >> 8) & 0xff) << 8) |
    lift(color & 0xff)
  );
};

export class PhysicsRenderer {
  constructor(layer, material, trashMaterial = material, specialMaterials = {}) {
    this.layer = layer;
    this.quads = new MinoQuadRenderer(material, { cellSize: 1 });
    this.trashQuads = new MinoQuadRenderer(trashMaterial, { cellSize: 1 });
    this.specialQuads = new Map(Object.entries(specialMaterials).map(([name, settings]) => [name, new MinoQuadRenderer(settings, { cellSize: 1 })]));
    this.bodyLayer = new PIXI.Container();
    this.bodyLayer.label = "physicsBodyLayer";
    this.markedLayer = new PIXI.Container();
    this.markedLayer.label = "markedMinoGlowLayer";
    this.markedColorLayers = new Map();
    // Box2D bodies are stable simulation objects. Keep their Pixi nodes alive
    // as well; recreating meshes, shaders, and filters every ticker frame was
    // an unbounded allocation churn source during long physics sessions.
    this.bodyNodes = new Map();
    this.bodyData = new Map();
    this.markedNodes = new Map();
    this.palette = [];
    this.layer.addChild(this.bodyLayer, this.markedLayer);
  }

  setPalette(colors = []) {
    this.palette = colors.map((color) => Number.isFinite(color)
      ? color
      : Number.parseInt(String(color).replace("#", ""), 16));
    this.invalidateMaterial();
  }

  colorFor(cell, fallback) {
    const color = Number.isInteger(cell.colorIndex) && cell.colorIndex >= 0
      ? this.palette[cell.colorIndex] ?? fallback
      : cell.baseColor ?? fallback;
    if (cell.material !== "metal") return color;
    const metalColor = halfDesaturate(color);
    return cell.metalLives === 2 ? darken(metalColor, 0.55) : metalColor;
  }

  render(field) {
    const aliveBodies = new Set();
    field.bodies.forEach((body) => {
      aliveBodies.add(body);
      const data = body.GetUserData();
      this.bodyData.set(body, data);
      const position = body.GetPosition();
      const signature = this.visualSignature(data);
      let node = this.bodyNodes.get(body);
      if (!node) {
        node = new PIXI.Container();
        node.label = `physicsPolyomino:${data.polyominoId ?? "untracked"}`;
        this.bodyNodes.set(body, node);
        this.bodyLayer.addChild(node);
      }
      if (node.visualSignature !== signature) {
        const centroid = polyominoCentroid(data.cells);
        node.removeChildren().forEach((child) => child.destroy({ children: true }));
        const cells = data.cells.map((cell) => ({ ...cell, color: this.colorFor(cell, data.color) }));
        const groups = new Map();
        cells.forEach((cell) => {
          const key = data.trash ? "trash" : cell.material || "default";
          const group = groups.get(key) || [];
          group.push(cell);
          groups.set(key, group);
        });
        groups.forEach((group, materialName) => {
          const layer = new PIXI.Container();
          node.addChild(layer);
          (materialName === "trash" ? this.trashQuads : this.specialQuads.get(materialName) || this.quads).draw(
            layer, group, data.color, (cell) => this.linksForCell(data, cell), 1, -centroid.x, -centroid.y,
          );
        });
        node.visualSignature = signature;
      }
      // // Ensure mass label exists as a child
      // let massLabel = node.children.find(child => child.label === "massLabel");
      // if (!massLabel) {
      //   massLabel = new PIXI.Text({
      //     text: "1",
      //     style: {
      //       fontFamily: "Quantico, sans-serif",
      //       fontSize: 12,
      //       fontWeight: "bold",
      //       fill: 0xffff00,
      //       align: "center",
      //     },
      //   });
      //   massLabel.anchor.set(0.5, 0);
      //   //massLabel.position.set(0, -36); // Offset above the piece
      //   massLabel.label = "massLabel";
      //   node.addChild(massLabel);
      // }
      // // Update mass label text
      // massLabel.text = body.GetMass?.().toFixed(1) ?? "1";

      // `physicsLayer` is a normalized playfield grid. The body container is
      // therefore directly usable by a replay/network presentation layer.
      node.position.set(position.x, position.y);
      node.rotation = body.GetAngle();
      this.renderMarkedBody(body, data, node, signature);
    });
    this.releaseRemovedBodies(aliveBodies);
  }

  invalidateMaterial() {
    this.bodyNodes.forEach((node) => {
      node.visualSignature = null;
    });
  }

  linksForCell(data, cell) {
    return {
      ...(cell.visualLinks || {
        top: data.cells.some(
          (other) => other.x === cell.x && other.y === cell.y - 1,
        ),
        right: data.cells.some(
          (other) => other.x === cell.x + 1 && other.y === cell.y,
        ),
        bottom: data.cells.some(
          (other) => other.x === cell.x && other.y === cell.y + 1,
        ),
        left: data.cells.some(
          (other) => other.x === cell.x - 1 && other.y === cell.y,
        ),
        topLeft: data.cells.some(
          (other) => other.x === cell.x - 1 && other.y === cell.y - 1,
        ),
        topRight: data.cells.some(
          (other) => other.x === cell.x + 1 && other.y === cell.y - 1,
        ),
        bottomRight: data.cells.some(
          (other) => other.x === cell.x + 1 && other.y === cell.y + 1,
        ),
        bottomLeft: data.cells.some(
          (other) => other.x === cell.x - 1 && other.y === cell.y + 1,
        ),
      }),
      broken: cell.broken,
    };
  }

  visualSignature(data) {
    return JSON.stringify([
      data.color,
      data.trash,
      data.origin,
      data.cells.map((cell) => [
        cell.x,
        cell.y,
        cell.marked,
        cell.colorIndex,
        cell.material,
        cell.metalLives,
        cell.broken,
        cell.visualLinks,
      ]),
    ]);
  }

  renderMarkedBody(body, data, bodyNode, bodySignature) {
    const markedCells = data.cells.filter((cell) => cell.marked);
    let markedNode = this.markedNodes.get(body);
    if (!markedCells.length) {
      if (markedNode) {
        markedNode.destroy({ children: true });
        this.markedNodes.delete(body);
      }
      return;
    }
    const markedColor = lightenColor(
      this.colorFor(markedCells[0], data.color),
      MARKED_MINO_OUTLINE_LIGHTNESS,
    );
    const markedSignature = `${bodySignature}:${markedCells.map((cell) => this.colorFor(cell, data.color)).join(",")}`;
    if (!markedNode) {
      markedNode = new PIXI.Container();
      markedNode.label = "markedMinoOverlay";
      markedNode.filters = [
        new PIXI.filters.GlowFilter({
          distance: MARKED_MINO_GLOW_DISTANCE,
          outerStrength: MARKED_MINO_GLOW_STRENGTH,
          innerStrength: 0.2,
          color: markedColor,
          quality: MARKED_MINO_GLOW_QUALITY,
          knockout: false,
        }),
      ];
      this.markedNodes.set(body, markedNode);
      this.markedLayer.addChild(markedNode);
    }
    if (markedNode.visualSignature !== markedSignature) {
      markedNode.removeChildren().forEach((child) => child.destroy());
      const centroid = polyominoCentroid(data.cells);
      markedCells.forEach((cell) => {
        const x = cell.x - centroid.x;
        const y = cell.y - centroid.y;
        const cellColor = lightenColor(
          this.colorFor(cell, data.color),
          MARKED_MINO_OUTLINE_LIGHTNESS,
        );
        markedNode.addChild(
          new PIXI.Graphics()
            .roundRect(x + 0.06, y + 0.06, 0.88, 0.88, 0.14)
            .stroke({ width: 0.08, color: cellColor, alpha: 1 }),
        );
      });
      markedNode.visualSignature = markedSignature;
    }
    markedNode.position.copyFrom(bodyNode.position);
    markedNode.rotation = bodyNode.rotation;
  }

  releaseRemovedBodies(aliveBodies) {
    this.bodyNodes.forEach((node, body) => {
      if (aliveBodies.has(body)) return;
      node.destroy({ children: true });
      this.bodyNodes.delete(body);
      this.bodyData.delete(body);
    });
    this.markedNodes.forEach((node, body) => {
      if (aliveBodies.has(body)) return;
      node.destroy({ children: true });
      this.markedNodes.delete(body);
    });
  }
}
