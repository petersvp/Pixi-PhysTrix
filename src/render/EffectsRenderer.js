/**
 * Renders short-lived procedural particles for impacts, clears, and fractures.
 * Particles and trails reuse Sprite instances backed by Pixi's built-in white
 * texture. Reusing them avoids creating GraphicsContext objects per effect.
 * Each burst receives board-space coordinates and a mino color from gameplay.
 * Velocity, size, and fade are deterministic enough to keep effects readable.
 * The owning game updates this renderer once per ticker frame.
 */

import { CELL } from "../config/gameplayConstants.js";

export class EffectsRenderer {
  constructor(root) {
    this.root = root;
    this.particles = [];
    this.trails = [];
    this.particlePool = [];
    this.trailPool = [];
  }

  spawn(x, y, color, velocityX, velocityY, force = 1) {
    const sprite =
      this.particlePool.pop() ?? new PIXI.Sprite(PIXI.Texture.WHITE);
    const size = 4 + Math.random() * 4;
    sprite.anchor.set(0.5);
    sprite.tint = color;
    sprite.width = size;
    sprite.height = size;
    sprite.alpha = 0.9;
    sprite.position.set(x * CELL, y * CELL);
    this.root.addChild(sprite);
    this.particles.push({
      sprite,
      vx: velocityX,
      vy: velocityY,
      life: 260 + Math.random() * 260,
      age: 0,
      force,
    });
  }

  burst(
    cellX,
    cellY,
    color,
    count = 10,
    horizontalForce = 1,
    verticalForce = 1,
    angle = 0,
  ) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < count; index++) {
      // Force is emitted along local horizontal/vertical mino sides. The
      // angle is zero for line clears and the body rotation for fractures.
      const localX =
        (index & 1 ? 1 : -1) * (35 + Math.random() * 70) * horizontalForce;
      const localY =
        (index & 2 ? 1 : -1) * (35 + Math.random() * 70) * verticalForce;
      this.spawn(
        cellX + 0.5,
        cellY + 0.5,
        color,
        localX * cosine - localY * sine,
        localX * sine + localY * cosine,
        Math.max(horizontalForce, verticalForce),
      );
    }
  }

  // Emit a placement burst from only the exposed outline segments, rather
  // than from each mino centre. This makes a locked polyomino read as one body.
  outlineBurst(cells, color, count, force = 0.7) {
    if (!cells.length || count <= 0) return;
    const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const edges = [];
    cells.forEach(({ x, y }) => {
      [
        [0, -1, 0.5, 0, 0, -1, 1, 0],
        [1, 0, 1, 0.5, 1, 0, 0, 1],
        [0, 1, 0.5, 1, 0, 1, 1, 0],
        [-1, 0, 0, 0.5, -1, 0, 0, 1],
      ].forEach(([dx, dy, px, py, nx, ny, tx, ty]) => {
        if (!occupied.has(`${x + dx},${y + dy}`))
          edges.push({ x: x + px, y: y + py, nx, ny, tx, ty });
      });
    });
    if (!edges.length) return;
    for (let index = 0; index < count; index++) {
      const edge = edges[index % edges.length];
      const speed = (45 + Math.random() * 80) * force;
      // Sample across the full exposed one-mino edge. The particle begins on
      // the exact silhouette and receives an outward normal plus light jitter.
      const along = Math.random() - 0.5;
      this.spawn(
        edge.x + edge.tx * along,
        edge.y + edge.ty * along,
        color,
        edge.nx * speed + (Math.random() - 0.5) * 25 * force,
        edge.ny * speed - 20 * force + (Math.random() - 0.5) * 25 * force,
        force,
      );
    }
  }

  // A hard drop reads as one broad falling silhouette, framed by two narrow
  // trails at the left and right edges of the controlled polyomino.
  hardDropTrail(fromCells, toCells, color) {
    if (!fromCells.length || !toCells.length) return;
    const firstFrom = fromCells.reduce(
      (lowest, cell) => Math.min(lowest, cell.y),
      Infinity,
    );
    const lastTo = toCells.reduce(
      (lowest, cell) => Math.max(lowest, cell.y + 1),
      -Infinity,
    );
    if (lastTo <= firstFrom) return;

    const left = Math.min(...fromCells.map((cell) => cell.x)) * CELL;
    const right = (Math.max(...fromCells.map((cell) => cell.x)) + 1) * CELL;
    const top = firstFrom * CELL;
    const bottom = lastTo * CELL;
    const centre = (left + right) / 2;
    const trail = this.trailPool.pop() ?? new PIXI.Container();
    trail.label = "hardDropTrail";
    if (!trail.wide) {
      trail.wide = new PIXI.Sprite(PIXI.Texture.WHITE);
      trail.left = new PIXI.Sprite(PIXI.Texture.WHITE);
      trail.right = new PIXI.Sprite(PIXI.Texture.WHITE);
      trail.addChild(trail.wide, trail.left, trail.right);
    }
    const height = bottom - top;
    const setStrip = (sprite, x, width, alpha) => {
      sprite.tint = color;
      sprite.alpha = alpha;
      sprite.position.set(x, top);
      sprite.width = width;
      sprite.height = height;
    };
    // The wide centre pass uses the polyomino bounding width rather than a
    // separate streak for every mino column.
    setStrip(trail.wide, centre - (right - left) / 2, right - left, 0.16);
    setStrip(trail.left, left - 1, 2, 0.9);
    setStrip(trail.right, right - 1, 2, 0.9);
    trail.alpha = 1;
    this.root.addChild(trail);
    this.trails.push({ graphic: trail, age: 0, life: 260 });
  }

  update(deltaMS) {
    this.particles = this.particles.filter((particle) => {
      particle.age += deltaMS;
      particle.vy += 180 * (deltaMS / 1000);
      particle.sprite.x += particle.vx * (deltaMS / 1000);
      particle.sprite.y += particle.vy * (deltaMS / 1000);
      particle.sprite.alpha = Math.max(0, 1 - particle.age / particle.life);
      if (particle.age < particle.life) return true;
      particle.sprite.removeFromParent();
      this.particlePool.push(particle.sprite);
      return false;
    });
    this.trails = this.trails.filter((trail) => {
      trail.age += deltaMS;
      const progress = trail.age / trail.life;
      trail.graphic.alpha = Math.max(0, 1 - progress);
      if (progress < 1) return true;
      trail.graphic.removeFromParent();
      this.trailPool.push(trail.graphic);
      return false;
    });
  }

  destroy() {
    [
      ...this.particles.map(({ sprite }) => sprite),
      ...this.particlePool,
    ].forEach((sprite) => sprite.destroy());
    [...this.trails.map(({ graphic }) => graphic), ...this.trailPool].forEach(
      (trail) => trail.destroy({ children: true }),
    );
    this.particles = [];
    this.trails = [];
    this.particlePool = [];
    this.trailPool = [];
  }
}
