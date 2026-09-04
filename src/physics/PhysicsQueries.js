/**
 * Provides Box2D point-query helpers for binary gameplay occupancy tests.
 *
 * This module is part of the physics layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

/** Box2D point-query helpers; callers own fixture filtering policy. */
export const fixtureAtPoint = (world, point, accept) => {
  let hit = null;
  world.QueryAABB(
    (fixture) => {
      if (accept(fixture) && fixture.TestPoint(point)) {
        hit = fixture;
        return false;
      }
      return true;
    },
    { lowerBound: point, upperBound: point },
  );
  return hit;
};

export const pointOccupied = (world, point, accept) => {
  return Boolean(fixtureAtPoint(world, point, accept));
};
