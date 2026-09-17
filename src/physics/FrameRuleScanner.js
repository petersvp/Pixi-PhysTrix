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
  constructor(
    world,
    api,
    verticalTolerance = LINE_SCAN_VERTICAL_TOLERANCE,
    chain = {},
    cols = COLS,
    rows = ROWS,
  ) {
    this.world = world;
    this.api = api;
    this.frame = 0;
    this.verticalTolerance = verticalTolerance;
    this.chain = chain || {};
    this.cols = cols;
    this.rows = rows;
    this.lineIds = new WeakMap();
    this.clusterIds = new WeakMap();
    this.nextColorGroupId = 1;
  }
  colorMatches() {
    const { Dynamics } = this.api;
    const cells = new Map();
    let bodies = 0;
    let fixtures = 0;
    for (let body = this.world.GetBodyList(); body; body = body.GetNext()) {
      if (++bodies > 4096) break;
      // Static trash participates in colour chains before it loses support.
      if (
        body.GetType() !== Dynamics.b2Body.b2_dynamicBody &&
        body.GetType() !== Dynamics.b2Body.b2_staticBody
      ) continue;
      for (let fixture = body.GetFixtureList(); fixture; fixture = fixture.GetNext()) {
        if (++fixtures > this.rows * this.cols * 8) {
          console.error("[Physics] Color-chain fixture scan safety limit reached.", { fixtures });
          return [];
        }
        const tile = fixture.GetUserData();
        if (!tile) continue;
        const center = body.GetWorldPoint(fixture.GetShape().m_centroid);
        const x = Math.floor(center.x), y = Math.floor(center.y);
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
        if (!Number.isInteger(tile.colorIndex) || tile.colorIndex < 0) continue;
        cells.set(`${x},${y}`, { x, y, tile, colorIndex: tile.colorIndex });
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
      cells.forEach((cell) => directions.forEach(([dx, dy]) => {
        if (cells.get(`${cell.x - dx},${cell.y - dy}`)?.colorIndex === cell.colorIndex) return;
        const run = [];
        for (let x = cell.x, y = cell.y; cells.get(`${x},${y}`)?.colorIndex === cell.colorIndex; x += dx, y += dy)
          run.push(cells.get(`${x},${y}`));
        if (run.length < minimum) return;

        // Keep the identity on minos rather than their current grid position:
        // Box2D may move a marked line before its vanish deadline. A newly
        // joined mino therefore extends the old line instead of creating one.
        // The orientation is part of the key, so a crossing line is distinct.
        const directionKey = `${cell.colorIndex}:${dx},${dy}`;
        const id = run
          .map((item) => this.lineIds.get(item.tile)?.get(directionKey))
          .find(Boolean) ?? `color-line:${this.nextColorGroupId++}`;
        run.forEach((item) => {
          const ids = this.lineIds.get(item.tile) ?? new Map();
          ids.set(directionKey, id);
          this.lineIds.set(item.tile, ids);
        });
        groups.push({
          id,
          y: cell.y,
          tiles: run.map((item) => item.tile),
          extraMinoCount: run.length - minimum,
          scoreMultiplier: 1,
          perfect: false,
        });
      }));
    } else if (this.chain.mode === "color-clusters") {
      const minimum = Math.max(2, Number(this.chain.clusterSize) || 17);
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
            if (!next || next.colorIndex !== cell.colorIndex || visited.has(nextKey)) return;
            visited.add(nextKey);
            group.push(next);
          });
        }
        if (group.length >= minimum) {
          const id = group
            .map((item) => this.clusterIds.get(item.tile))
            .find(Boolean) ?? `color-cluster:${this.nextColorGroupId++}`;
          group.forEach((item) => this.clusterIds.set(item.tile, id));
          groups.push({
            id,
            y: cell.y,
            tiles: group.map((item) => item.tile),
            extraMinoCount: group.length - minimum,
            scoreMultiplier: 1,
            perfect: false,
          });
        }
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
    for (let y = 0; y < this.rows; y++) {
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
        new M.b2Vec2(this.cols + 1, y + 0.5),
      );
      const centers = [...hit.values()];
      const verticalSpread = centers.length
        ? globalThis.Math.max(...centers) - globalThis.Math.min(...centers)
        : 0;
      if (hit.size >= this.cols && verticalSpread <= this.verticalTolerance) {
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
