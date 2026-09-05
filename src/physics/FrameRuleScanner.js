/**
 * Performs periodic Box2D horizontal ray scans to find occupied lines.
 *
 * This module is part of the physics layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import {
  COLS,
  ROWS,
  FRAMERULE_INTERVAL,
  LINE_SCAN_VERTICAL_TOLERANCE,
  PHYSICS_LINE_PERFECT_VERTICAL_TOLERANCE,
  PHYSICS_LINE_STRAIGHTNESS_MAX_MULTIPLIER,
  PHYSICS_LINE_STRAIGHTNESS_MIN_MULTIPLIER,
} from "../config/gameplayConstants.js";
export class FrameRuleScanner {
  constructor(world, api, verticalTolerance = LINE_SCAN_VERTICAL_TOLERANCE, chain = {}) {
    this.world = world;
    this.api = api;
    this.frame = 0;
    this.verticalTolerance = verticalTolerance;
    this.chain = chain || {};
  }
  colorMatches() {
    const { Dynamics } = this.api;
    const cells = new Map();
    let bodies = 0;
    let fixtures = 0;
    for (let body = this.world.GetBodyList(); body; body = body.GetNext()) {
      if (++bodies > 4096) break;
      if (body.GetType() !== Dynamics.b2Body.b2_dynamicBody) continue;
      for (let fixture = body.GetFixtureList(); fixture; fixture = fixture.GetNext()) {
        if (++fixtures > ROWS * COLS * 8) {
          console.error("[Physics] Color-chain fixture scan safety limit reached.", { fixtures });
          return [];
        }
        const tile = fixture.GetUserData();
        if (!tile) continue;
        const center = body.GetWorldPoint(fixture.GetShape().m_centroid);
        const x = Math.floor(center.x), y = Math.floor(center.y);
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
        cells.set(`${x},${y}`, { x, y, tile, color: tile.color });
      }
    }
    const groups = [];
    if (this.chain.mode === "color-lines") {
      const minimum = Math.max(2, Number(this.chain.colorLineLength) || 2);
      const directions = [
        ...(this.chain.horizontal ? [[1, 0]] : []),
        ...(this.chain.vertical ? [[0, 1]] : []),
        ...(this.chain.diagonal ? [[1, 1], [1, -1]] : []),
      ];
      const matched = new Map();
      cells.forEach((cell) => directions.forEach(([dx, dy]) => {
        if (cells.get(`${cell.x - dx},${cell.y - dy}`)?.color === cell.color) return;
        const run = [];
        for (let x = cell.x, y = cell.y; cells.get(`${x},${y}`)?.color === cell.color; x += dx, y += dy)
          run.push(cells.get(`${x},${y}`));
        if (run.length >= minimum) run.forEach((item) => matched.set(item.tile, item.tile));
      }));
      if (matched.size)
        groups.push({ y: "color-lines", tiles: [...matched.values()], scoreMultiplier: 1, perfect: false });
    } else if (this.chain.mode === "color-clusters") {
      const minimum = Math.max(2, Number(this.chain.clusterSize) || 2);
      const visited = new Set();
      cells.forEach((cell, key) => {
        if (visited.has(key)) return;
        visited.add(key);
        const group = [cell];
        for (let index = 0; index < group.length; index += 1) {
          const current = group[index];
          [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
            const nextKey = `${current.x + dx},${current.y + dy}`;
            const next = cells.get(nextKey);
            if (!next || next.color !== cell.color || visited.has(nextKey)) return;
            visited.add(nextKey);
            group.push(next);
          });
        }
        if (group.length >= minimum)
          groups.push({ y: `color-cluster-${groups.length}`, tiles: group.map((item) => item.tile), scoreMultiplier: 1, perfect: false });
      });
    }
    return groups;
  }
  // A forced scan is used immediately after an ordinary lock. It also starts
  // a fresh frame-rule interval, so the next periodic scan is exactly twenty
  // simulation frames later rather than inheriting an old partial interval.
  scan(force = false) {
    if (force) this.frame = 0;
    else if (++this.frame % FRAMERULE_INTERVAL) return null;
    if (["color-lines", "color-clusters"].includes(this.chain.mode))
      return this.colorMatches();
    const M = this.api.Common.Math,
      Body = this.api.Dynamics.b2Body,
      rows = [];
    for (let y = 0; y < ROWS; y++) {
      const hit = new Map();
      this.world.RayCast(
        (f) => {
          if (
            (f.GetBody().GetType() === Body.b2_dynamicBody ||
              f.GetBody().GetType() === Body.b2_staticBody) &&
            f.GetUserData()
          ) {
            // The ray itself has a constant Y, so use the fixture's actual
            // world-space center to ensure a visually sloped pile cannot
            // qualify as a horizontal line merely by intersecting the ray.
            const center = f.GetBody().GetWorldPoint(f.GetShape().m_centroid);
            hit.set(f.GetUserData(), center.y);
          }
          return 1;
        },
        new M.b2Vec2(-1, y + 0.5),
        new M.b2Vec2(COLS + 1, y + 0.5),
      );
      const centers = [...hit.values()];
      const verticalSpread = centers.length
        ? globalThis.Math.max(...centers) - globalThis.Math.min(...centers)
        : 0;
      if (hit.size >= COLS && verticalSpread <= this.verticalTolerance) {
        const perfect =
          verticalSpread <= PHYSICS_LINE_PERFECT_VERTICAL_TOLERANCE;
        const straightness = 1 - verticalSpread / this.verticalTolerance;
        const scoreMultiplier = perfect
          ? PHYSICS_LINE_STRAIGHTNESS_MAX_MULTIPLIER
          : PHYSICS_LINE_STRAIGHTNESS_MIN_MULTIPLIER +
            (PHYSICS_LINE_STRAIGHTNESS_MAX_MULTIPLIER -
              PHYSICS_LINE_STRAIGHTNESS_MIN_MULTIPLIER) *
              straightness;
        rows.push({
          y,
          tiles: [...hit.keys()],
          verticalSpread,
          scoreMultiplier,
          perfect,
        });
      }
    }
    return rows;
  }
}
