/**
 * Provides Box2D point-query helpers for binary gameplay occupancy tests.
 *
 * This module is part of the physics layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

/** Box2D point-query helpers; callers own fixture filtering policy. */
export const pointOccupied = (world, point, accept) => {
  let hit = false;
  world.QueryAABB(
    (f) => {
      if (accept(f) && f.TestPoint(point)) {
        hit = true;
        return false;
      }
      return true;
    },
    { lowerBound: point, upperBound: point },
  );
  return hit;
};
