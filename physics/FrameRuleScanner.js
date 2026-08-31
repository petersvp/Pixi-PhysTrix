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
  constructor(world, api) {
    this.world = world;
    this.api = api;
    this.frame = 0;
  }
  // A forced scan is used immediately after an ordinary lock. It also starts
  // a fresh frame-rule interval, so the next periodic scan is exactly twenty
  // simulation frames later rather than inheriting an old partial interval.
  scan(force = false) {
    if (force) this.frame = 0;
    else if (++this.frame % FRAMERULE_INTERVAL) return null;
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
      if (hit.size >= COLS && verticalSpread <= LINE_SCAN_VERTICAL_TOLERANCE) {
        const perfect =
          verticalSpread <= PHYSICS_LINE_PERFECT_VERTICAL_TOLERANCE;
        const straightness = 1 - verticalSpread / LINE_SCAN_VERTICAL_TOLERANCE;
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
