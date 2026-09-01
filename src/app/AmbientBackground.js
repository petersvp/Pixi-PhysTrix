/**
 * Renders the persistent decorative polyomino field behind application scenes.
 * This layer is owned by AppShell, rather than a routed menu or game scene.
 * It is built once and moves independently of scene transitions and overlays.
 * The graphics are intentionally low-opacity and never accept interaction.
 * Layout uses renderer pixels so it covers desktop and Activity canvases alike.
 */

import { definitionsForOrder } from "../game/PolyominoDefinitions.js";
import {
  AMBIENT_POLYOMINO_ALPHA,
  AMBIENT_POLYOMINO_CELL_SIZE,
  AMBIENT_POLYOMINO_COUNT,
  AMBIENT_POLYOMINO_MAX_SPEED,
  AMBIENT_POLYOMINO_MIN_SPEED,
} from "../config/uiConstants.js";

export class AmbientBackground {
  constructor(app) {
    this.app = app;
    this.root = new PIXI.Container();
    this.root.label = "persistentAmbientPolyominoBackground";
    this.root.eventMode = "none";
    this.root.zIndex = -100;
    this.entries = [];
    this.create();
    this.update = () => this.tick(app.ticker.deltaMS);
    app.ticker.add(this.update);
  }

  random(seed) {
    const value = Math.sin(seed * 999) * 43758.5453;
    return value - Math.floor(value);
  }

  create() {
    for (let index = 0; index < AMBIENT_POLYOMINO_COUNT; index++) {
      const node = new PIXI.Container();
      // Cycle deterministic decorative samples through triominoes to
      // octominoes. They use the actual game definition catalog, not a
      // separate tetromino-only background template.
      const order = 3 + (index % 6);
      const catalog = definitionsForOrder(order);
      const definition = catalog[Math.floor(this.random(index + 71) * catalog.length)];
      node.label = `ambientPolyomino${index}_${definition.id}`;
      definition.matrix.forEach((row, y) => row.forEach((filled, x) => {
        if (!filled) return;
        node.addChild(
          new PIXI.Graphics()
            .roundRect(
              x * AMBIENT_POLYOMINO_CELL_SIZE,
              y * AMBIENT_POLYOMINO_CELL_SIZE,
              AMBIENT_POLYOMINO_CELL_SIZE - 2,
              AMBIENT_POLYOMINO_CELL_SIZE - 2,
              5,
            )
            .fill({
              color: definition.color,
              alpha: AMBIENT_POLYOMINO_ALPHA,
            }),
        );
      }));
      // Individual mino coordinates start at (0, 0). Pivot around their
      // measured bounds so every background polyomino rotates and spawns
      // from its visual centre rather than its top-left mino.
      const bounds = node.getLocalBounds();
      node.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      const spawnX = this.random(index + 1);
      const spawnY = this.random(index + 11);
      node.position.set(
        spawnX * this.app.screen.width,
        spawnY * this.app.screen.height,
      );
      node.rotation = (this.random(index + 21) - 0.5) * 0.7;
      this.root.addChild(node);
      const speed =
        AMBIENT_POLYOMINO_MIN_SPEED +
        this.random(index + 31) *
          (AMBIENT_POLYOMINO_MAX_SPEED - AMBIENT_POLYOMINO_MIN_SPEED);
      this.entries.push({
        node,
        spawnX,
        spawnY,
        vx: (this.random(index + 41) < 0.5 ? -1 : 1) * speed,
        vy: (this.random(index + 51) < 0.5 ? -1 : 1) * speed * 0.55,
        spin: (this.random(index + 61) - 0.5) * 0.22,
      });
    }
  }

  // AppShell constructs this layer before its initial browser-size resize.
  // Retain a normalized spawn coordinate so background entries use the full
  // actual viewport on startup and proportionally follow later resizes.
  resize() {
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    this.entries.forEach((entry) => {
      entry.node.position.set(entry.spawnX * width, entry.spawnY * height);
    });
  }

  tick(deltaMS) {
    const seconds = deltaMS / 1000;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    this.entries.forEach((entry) => {
      const { node } = entry;
      node.x += entry.vx * seconds;
      node.y += entry.vy * seconds;
      node.rotation += entry.spin * seconds;
      if (node.x < -90 || node.x > width + 40) {
        node.x = Math.max(-90, Math.min(width + 40, node.x));
        entry.vx *= -1;
      }
      if (node.y < -90 || node.y > height + 40) {
        node.y = Math.max(-90, Math.min(height + 40, node.y));
        entry.vy *= -1;
      }
    });
  }

  destroy() {
    this.app.ticker.remove(this.update);
    this.root.destroy({ children: true });
  }
}
