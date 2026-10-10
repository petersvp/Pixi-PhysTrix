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
import { colorNumber } from "../config/colors.js";
import { MinoQuadRenderer } from "./MinoQuadRenderer.js";
import { polyominoCentroid } from "../game/Polyomino.js";
import { metalTint, normalTrashTint } from "./MetalTint.js";

const lightenColor = (color, amount) => {
  const lift = (channel) => Math.round(channel + (255 - channel) * amount);
  return (
    (lift((color >> 16) & 0xff) << 16) |
    (lift((color >> 8) & 0xff) << 8) |
    lift(color & 0xff)
  );
};

const blindSeed = (value) => {
  let hash = 2166136261;
  for (const char of String(value || "blind")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const blindAlpha = (seed, timeMs) => {
  const phase = (Math.max(0, timeMs) + blindSeed(seed) % 1000) % 5000;
  return phase < 360 ? Math.sin((phase / 360) * Math.PI) * 0.25 : 0;
};

const mixColor = (from, to, amount) => {
  const mix = (shift) => Math.round(
    ((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * amount,
  );
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};

const setBlindAlpha = (node, alpha, active) => {
  let filter = node.blindAlphaFilter;
  if (active && !filter) {
    filter = new PIXI.AlphaFilter({ alpha });
    node.blindAlphaFilter = filter;
    node.filters = [...(node.filters || []), filter];
  }
  if (filter) filter.alpha = alpha;
  if (!active && filter) {
    node.filters = (node.filters || []).filter((entry) => entry !== filter);
    filter.destroy();
    delete node.blindAlphaFilter;
  }
  node.alpha = 1;
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
    this.trashAppearance = { desaturation: 0.5, damagedBrightness: 0.55 };
    this.layer.addChild(this.bodyLayer, this.markedLayer);
  }

  setPalette(colors = []) {
    this.palette = colors.map((color) => Number.isFinite(color)
      ? color
      : Number.parseInt(String(color).replace("#", ""), 16));
    this.invalidateMaterial();
  }

  setTrashAppearance({ desaturation, damagedBrightness } = {}) {
    if (Number.isFinite(desaturation)) this.trashAppearance.desaturation = Math.max(0, Math.min(1, desaturation));
    if (Number.isFinite(damagedBrightness)) this.trashAppearance.damagedBrightness = Math.max(0, Math.min(1, damagedBrightness));
    this.invalidateMaterial();
  }

  setGodEssencePresentation({ blind = false, blindBlend = 0, desaturated = false, desaturationAmount = 0, neutralMinoColor = "#777777", timeMs = 0 } = {}) {
    const nextDesaturationAmount = Math.max(0, Math.min(1, Number(desaturationAmount) || 0));
    if (this.desaturated !== Boolean(desaturated) || this.desaturationAmount !== nextDesaturationAmount) {
      this.desaturated = Boolean(desaturated);
      this.desaturationAmount = nextDesaturationAmount;
      this.neutralMinoColor = colorNumber(neutralMinoColor, 0x777777);
      this.invalidateMaterial();
    }
    this.blindPresentation = Boolean(blind);
    this.blindBlend = Math.max(0, Math.min(1, Number(blindBlend) || 0));
    this.presentationTimeMs = timeMs;
    this.applyBlindPresentation();
  }

  applyBlindPresentation() {
    const active = this.blindPresentation || this.blindBlend > 0;
    this.bodyNodes.forEach((node, body) => {
      const id = this.bodyData.get(body)?.polyominoId ?? body?.m_userData?.polyominoId;
      const pulse = blindAlpha(id, this.presentationTimeMs);
      setBlindAlpha(node, 1 + (pulse - 1) * this.blindBlend, active);
    });
    this.markedNodes.forEach((node, body) => {
      const id = this.bodyData.get(body)?.polyominoId ?? body?.m_userData?.polyominoId;
      const pulse = blindAlpha(id, this.presentationTimeMs);
      setBlindAlpha(node, 1 + (pulse - 1) * this.blindBlend, active);
    });
  }

  setGodEssenceAtlas(texture, atlas) {
    this.godEssenceTexture = texture;
    this.godEssenceAtlas = atlas;
    this.invalidateMaterial();
  }

  addGodEssenceOverlay(target, cells, itemIndex, polarity, foreign, centroid) {
    if (!this.godEssenceTexture || !Number.isInteger(itemIndex) || !cells.length) return;
    const atlas = this.godEssenceAtlas;
    const cell = atlas.itemCells?.[itemIndex];
    const column = Number.isInteger(cell?.column) ? cell.column - 1 : itemIndex % atlas.columns;
    const row = Number.isInteger(cell?.row) ? cell.row - 1 : Math.floor(itemIndex / atlas.columns);
    const texture = new PIXI.Texture({
      source: this.godEssenceTexture.source,
      frame: new PIXI.Rectangle(
        column * atlas.cellSize,
        row * atlas.cellSize,
        atlas.cellSize,
        atlas.cellSize,
      ),
    });
    const icon = new PIXI.Sprite(texture);
    icon.label = "godEssenceItemIcon";
    const tintIcons = this.palette?.length > 0;
    icon.anchor.set(0.5);
    icon.width = 1.72;
    icon.height = 1.72;
    const tints = atlas.tints || {};
    icon.blendMode = tintIcons
      ? atlas.colorModeItemIconBlendMode ?? atlas.itemIconBlendMode ?? "normal"
      : atlas.itemIconBlendMode ?? "normal";
    icon.tint = foreign || polarity === "foreign" ? colorNumber(tints.foreignIcon, 0xffffff)
      : !tintIcons ? 0xffffff
      : polarity === "others" ? colorNumber(tints.colorModeOthersIcon ?? tints.othersIcon, 0xffd9df) : colorNumber(tints.colorModeSelfIcon ?? tints.selfIcon, 0xd9ffe6);
    icon.position.set(0, 0);
    target.addChild(icon);
  }

  colorFor(cell, fallback) {
    const color = Number.isInteger(cell.colorIndex) && cell.colorIndex >= 0
      ? this.palette[cell.colorIndex] ?? fallback
      : cell.baseColor ?? fallback;
    if (this.desaturationAmount) return mixColor(color, this.neutralMinoColor ?? 0x777777, this.desaturationAmount);
    if (cell.trash && cell.material === "trash" && cell.trashHp === 1)
      return normalTrashTint(color, this.trashAppearance.desaturation);
    if (cell.material !== "metal") return color;
    return metalTint(color, cell.trash ? cell.trashHp : cell.metalLives, this.trashAppearance.desaturation, this.trashAppearance.damagedBrightness);
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
          const key = cell.material || (data.trash ? "trash" : "default");
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
        this.addGodEssenceOverlay(
          node,
          data.cells,
          data.cells[0]?.godEssenceItemIndex,
          data.cells[0]?.godEssencePolarity,
          data.cells[0]?.godEssenceForeign,
          centroid,
        );
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
    this.applyBlindPresentation();
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
        cell.baseColor,
        cell.material,
        cell.metalLives,
        cell.trashHp,
        cell.trash,
        cell.broken,
        cell.godEssenceItemIndex,
        cell.godEssencePolarity,
        cell.godEssenceForeign,
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
