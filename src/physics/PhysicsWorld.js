/**
 * Owns dynamic Box2D mino bodies, scans, marking, vanishing, and fractures.
 *
 * This module is part of the physics layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import {
  COLS,
  ROWS,
  PHYSICS_FRICTION,
  PHYSICS_BOUNCINESS,
  PHYSICS_MASS,
  PHYSICS_HARD_DROP_MASS_MULTIPLIER,
  PHYSICS_HARD_DROP_MASS_IMPACT_HOLD_DURATION_MS,
  PHYSICS_HARD_DROP_MASS_RESET_DURATION_MS,
  PHYSICS_RELEASE_MASS_MULTIPLIER,
  PHYSICS_RELEASE_MASS_RESET_DURATION_MS,
  VANISH_DURATION_MS,
} from "../config/gameplayConstants.js";
import { FrameRuleScanner } from "./FrameRuleScanner.js";
import { VanishSystem } from "./VanishSystem.js";
import {
  fixtureAtPoint,
  pointOccupied as queryPointOccupied,
} from "./PhysicsQueries.js";
import { polyominoCentroid } from "../game/Polyomino.js";

// Balanced preserves the project's existing material. The menu selects the
// other two dynamic presets; Static never constructs this physics world.
const PHYSICS_MATERIAL_PRESETS = Object.freeze({
  balanced: {
    density: PHYSICS_MASS,
    friction: PHYSICS_FRICTION,
    restitution: PHYSICS_BOUNCINESS,
  },
  slippery: { density: PHYSICS_MASS, friction: 0.03, restitution: 0.16 },
  rubber: { density: PHYSICS_MASS, friction: 0.45, restitution: 0.88 },
});


/** Owns the Box2D world and every locked compound body in physics gameplay. */
export class PhysicsWorld {
  constructor(api = globalThis.Box2D, preset = "balanced", config = {}) {
    if (!api) {
      console.error("[Physics] Box2D failed to load.");
      this.unavailable = true;
      return;
    }
    this.api = api;
    this.material =
      PHYSICS_MATERIAL_PRESETS[preset] || PHYSICS_MATERIAL_PRESETS.balanced;
    this.materials = Array.isArray(config.materials) && config.materials.length
      ? config.materials.map((material) => ({
          density: Math.max(
            0.01,
            Math.min(20, Number(material.density) || PHYSICS_MASS),
          ),
          friction: Math.max(0, Number(material.friction) || 0),
          restitution: Math.max(0, Number(material.bounciness) || 0),
        }))
      : [this.material];
    this.config = config;
    this.cols = Math.max(4, Math.floor(Number(config.cols) || COLS));
    this.rows = Math.max(4, Math.floor(Number(config.rows) || ROWS));
    this.maxFixtureChainSteps = this.rows * this.cols + 8;
    this.maxFragmentResolveCells = this.rows * this.cols;
    const { b2Vec2 } = api.Common.Math;
    this.world = new api.Dynamics.b2World(new b2Vec2(0, Number(config.gravity) || 24), true);
    this.bodies = [];
    this.nextLockedPolyominoId = 1;
    this.scanner = new FrameRuleScanner(
      this.world,
      api,
      Number(config.tolerance) || undefined,
      config.chain,
      this.cols,
      this.rows,
    );
    this.vanish = new VanishSystem(VANISH_DURATION_MS);
    this.setupContactListener();
    this.createBounds();
  }
  setupContactListener() {
    const { Dynamics } = this.api;
    const listener = new Dynamics.b2ContactListener();
    listener.BeginContact = (contact) => {
      const bodyA = contact.GetFixtureA()?.GetBody?.();
      const bodyB = contact.GetFixtureB()?.GetBody?.();
      [bodyA, bodyB].forEach((body) => {
        const data = body?.GetUserData?.();
        if (!data?.temporaryMassActive) return;
        data.contacting = true;
        data.temporaryMassTouched = true;
      });
    };
    listener.EndContact = (contact) => {
      const bodyA = contact.GetFixtureA()?.GetBody?.();
      const bodyB = contact.GetFixtureB()?.GetBody?.();
      [bodyA, bodyB].forEach((body) => {
        const data = body?.GetUserData?.();
        if (!data?.temporaryMassActive) return;
        data.contacting = false;
      });
    };
    this.world.SetContactListener(listener);
  }
  setTemporaryMass(body, boost) {
    if (!body) return;
    const data = body.GetUserData();
    if (!data) return;
    data.temporaryMassBoost = Math.max(0, boost);
    let fixtureSteps = 0;
    for (let fixture = body.GetFixtureList(); fixture; fixture = fixture.GetNext()) {
      if (++fixtureSteps > this.maxFixtureChainSteps) {
        console.error("[Physics] Fixture-chain safety limit reached while setting mass.", {
          fixtureSteps,
          polyominoId: data.polyominoId,
        });
        break;
      }
      const density = (data.material || this.material).density + data.temporaryMassBoost;
      // `fixture.density = value` only creates a JavaScript-side property in
      // Box2DWeb. SetDensity updates the native fixture mass used by contact
      // resolution; ResetMassData then updates the compound body's inertia.
      if (typeof fixture.SetDensity === "function") fixture.SetDensity(density);
      else fixture.m_density = density;
    }
    body.ResetMassData();
  }
  updateTemporaryMass(body, dtMs) {
    const data = body.GetUserData();
    if (!data || !data.temporaryMassActive) return;
    // Contact is a one-way state change: a heavy piece remains boosted through
    // its fall, then smoothly normalizes even if it bounces away.
    if (!data.temporaryMassTouched) return;
    data.temporaryMassImpactHoldElapsed = Math.min(
      data.temporaryMassImpactHoldDurationMs,
      (data.temporaryMassImpactHoldElapsed || 0) + dtMs,
    );
    if (
      data.temporaryMassImpactHoldElapsed <
      data.temporaryMassImpactHoldDurationMs
    )
      return;
    const resetDuration = Math.max(1, data.temporaryMassResetDurationMs);
    data.temporaryMassResetElapsed = Math.min(
      resetDuration,
      (data.temporaryMassResetElapsed || 0) + dtMs,
    );
    const resetProgress =
      data.temporaryMassResetElapsed / resetDuration;
    this.setTemporaryMass(
      body,
      Math.max(
        0,
        data.temporaryMassInitialBoost * (1 - resetProgress),
      ),
    );
    if (resetProgress >= 1) data.temporaryMassActive = false;
  }
  beginTemporaryMass(
    body,
    multiplier,
    resetDurationMs,
    impactHoldDurationMs = 0,
  ) {
    const data = body?.GetUserData?.();
    if (!data) return;
    data.temporaryMassActive = true;
    data.contacting = false;
    data.temporaryMassTouched = false;
    data.temporaryMassResetElapsed = 0;
    data.temporaryMassResetDurationMs = Math.max(1, resetDurationMs);
    data.temporaryMassImpactHoldElapsed = 0;
    data.temporaryMassImpactHoldDurationMs = Math.max(0, impactHoldDurationMs);
    data.temporaryMassInitialBoost =
      (data.material || this.material).density * (Math.max(1, multiplier) - 1);
    this.setTemporaryMass(body, data.temporaryMassInitialBoost);
  }
  beginReleaseMass(body) {
    this.beginTemporaryMass(
      body,
      this.config.releaseMassMultiplier || PHYSICS_RELEASE_MASS_MULTIPLIER,
      this.config.releaseMassResetMs || PHYSICS_RELEASE_MASS_RESET_DURATION_MS,
    );
  }
  beginHardDropMass(body) {
    this.beginTemporaryMass(
      body,
      this.config.hardDropMassMultiplier || PHYSICS_HARD_DROP_MASS_MULTIPLIER,
      this.config.hardDropMassResetMs || PHYSICS_HARD_DROP_MASS_RESET_DURATION_MS,
      PHYSICS_HARD_DROP_MASS_IMPACT_HOLD_DURATION_MS,
    );
  }
  getControlledMassBoost() {
    const data = this.controlBody?.GetUserData?.();
    if (!data || !data.temporaryMassActive) return 0;
    return data.temporaryMassBoost || 0;
  }
  createBounds() {
    const {
        Dynamics,
        Collision: { Shapes },
        Common: { Math },
      } = this.api,
      body = this.world.CreateBody(new Dynamics.b2BodyDef());
    [
      [this.cols / 2, this.rows + 0.5, this.cols / 2 + 0.5, 0.5],
      [-0.5, this.rows / 2, 0.5, this.rows / 2],
      [this.cols + 0.5, this.rows / 2, 0.5, this.rows / 2],
    ].forEach(([x, y, hx, hy]) => {
      const s = new Shapes.b2PolygonShape();
      s.SetAsOrientedBox(hx, hy, new Math.b2Vec2(x, y), 0);
      body.CreateFixture2(s, 0);
    });
  }
  pointOccupied(x, y) {
    const {
      Common: { Math },
      Dynamics,
    } = this.api;
    const point = new Math.b2Vec2(x + 0.5, y + 0.5);
    return queryPointOccupied(this.world, point, (fixture) => {
      const body = fixture.GetBody();
      return (
        this.bodies.includes(body) &&
        (body.GetType() === Dynamics.b2Body.b2_dynamicBody ||
          body.GetType() === Dynamics.b2Body.b2_staticBody)
      );
    });
  }
  /**
   * The player-controlled polyomino is a separate kinematic compound body.
   * It is intentionally excluded from `bodies`: that list contains only
   * settled dynamic pieces eligible for line scanning and destruction.
   */
  createControlled(piece) {
    this.destroyControlled();
    const { Dynamics } = this.api;
    const def = new Dynamics.b2BodyDef();
    def.type = Dynamics.b2Body.b2_kinematicBody;
    // The controller is repositioned at guideline cell boundaries. It stays
    // awake so Box2D can resolve any resulting overlap against dynamic piles.
    def.allowSleep = false;
    this.controlBody = this.world.CreateBody(def);
    this.controlSignature = "";
    this.controlMaterial = this.materials[piece.definition.materialIndex] || this.material;
    this.syncControlled(piece, 0, true);
  }

  destroyControlled() {
    if (!this.controlBody) return;
    this.world.DestroyBody(this.controlBody);
    this.controlBody = null;
    this.controlSignature = "";
  }

  syncControlled(piece, frameMs, forceFixtures = false) {
    if (!this.controlBody) return;
    const {
      Dynamics,
      Collision: { Shapes },
      Common: { Math },
    } = this.api;
    const cells = piece.cells();
    const origin = polyominoCentroid(cells);
    const signature = cells
      .map((cell) => `${cell.x - origin.x}:${cell.y - origin.y}`)
      .sort()
      .join("|");
    const rebuild = forceFixtures || signature !== this.controlSignature;
    if (rebuild) {
      let fixtureSteps = 0;
      for (let fixture = this.controlBody.GetFixtureList(); fixture;) {
        if (++fixtureSteps > this.maxFixtureChainSteps) {
          console.error("[Physics] Fixture-chain safety limit reached while rebuilding control body.", {
            fixtureSteps,
          });
          break;
        }
        const next = fixture.GetNext();
        this.controlBody.DestroyFixture(fixture);
        fixture = next;
      }
      cells.forEach((cell) => {
        const shape = new Shapes.b2PolygonShape();
        shape.SetAsOrientedBox(
          0.5,
          0.5,
          new Math.b2Vec2(cell.x - origin.x + 0.5, cell.y - origin.y + 0.5),
          0,
        );
        const fixture = new Dynamics.b2FixtureDef();
        fixture.shape = shape;
        fixture.friction = this.controlMaterial.friction;
        fixture.restitution = this.controlMaterial.restitution;
        this.controlBody.CreateFixture(fixture);
      });
      // A discrete rotation changes the compound shape immediately.
      this.controlBody.SetPosition(new Math.b2Vec2(origin.x, origin.y));
      this.controlBody.SetLinearVelocity(new Math.b2Vec2(0, 0));
      this.controlBody.SetAwake(true);
      this.controlSignature = signature;
      return;
    }
    // Do not turn a one-cell guideline input into a large kinematic velocity:
    // it creates an unrealistically forceful shove. Teleport instead, then let
    // Box2D's contact/unpenetration solver settle overlapping dynamic bodies.
    this.controlBody.SetPosition(new Math.b2Vec2(origin.x, origin.y));
    this.controlBody.SetLinearVelocity(new Math.b2Vec2(0, 0));
    this.controlBody.SetAwake(true);
  }
  lock(piece) {
    const {
        Dynamics,
        Collision: { Shapes },
        Common: { Math },
      } = this.api,
      cells = piece.cells();
    if (!cells.length) return null;
    if (cells.length > this.maxFragmentResolveCells) {
      console.error("[Physics] Refusing oversized locked polyomino.", {
        cells: cells.length,
        maximum: this.maxFragmentResolveCells,
      });
      return null;
    }
    const origin = polyominoCentroid(cells),
      def = new Dynamics.b2BodyDef();
    def.type = Dynamics.b2Body.b2_dynamicBody;
    def.position.Set(origin.x, origin.y);
    const body = this.world.CreateBody(def),
      data = {
        polyominoId: this.nextLockedPolyominoId++,
        color: piece.color,
        material: this.materials[piece.definition.materialIndex] || this.material,
        cells: cells.map(({ color: _color, ...cell }) => ({
          ...cell,
          baseColor: cell.baseColor ?? piece.color,
          marked: false,
        })),
        origin,
        visualPose: { x: origin.x, y: origin.y, angle: 0 },
      };
    data.cells.forEach((cell) => {
      cell.visualLinks ??= {
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
      };
    });
    data.cells.forEach((cell) => {
      const s = new Shapes.b2PolygonShape();
      s.SetAsOrientedBox(
        0.5,
        0.5,
        new Math.b2Vec2(cell.x - origin.x + 0.5, cell.y - origin.y + 0.5),
        0,
      );
      const f = new Dynamics.b2FixtureDef();
      f.shape = s;
      f.density = data.material.density;
      f.friction = data.material.friction;
      f.restitution = data.material.restitution;
      body.CreateFixture(f).SetUserData(cell);
    });
    data.temporaryMassActive = false;
    data.temporaryMassBoost = 0;
    data.contacting = false;
    data.temporaryMassTouched = false;
    data.temporaryMassInitialBoost = 0;
    data.temporaryMassResetElapsed = 0;
    data.temporaryMassResetDurationMs = 0;
    data.temporaryMassImpactHoldElapsed = 0;
    data.temporaryMassImpactHoldDurationMs = 0;
    body.SetUserData(data);
    this.bodies.push(body);
    const lockedBodies = this.splitDisconnectedLockedBody(body);
    if (lockedBodies.length > 1) return lockedBodies;
    this.onLockedPolyominoCreated?.({ body, data });
    return [body];
  }
  spawnTrash(cells) {
    const {
      Dynamics,
      Collision: { Shapes },
      Common: { Math },
    } = this.api;
    cells.forEach(({ x, y, colorIndex = -1, baseColor, trash }) => {
      const def = new Dynamics.b2BodyDef();
      def.type = Dynamics.b2Body.b2_staticBody;
      def.position.Set(x + 0.5, y + 0.5);
      const body = this.world.CreateBody(def);
      const cell = {
        x,
        y,
        colorIndex,
        trash: Boolean(trash),
        marked: false,
        visualLinks: {
          top: false,
          right: false,
          bottom: false,
          left: false,
          topLeft: false,
          topRight: false,
          bottomRight: false,
          bottomLeft: false,
        },
        broken: { top: false, right: false, bottom: false, left: false },
      };
      const shape = new Shapes.b2PolygonShape();
      shape.SetAsOrientedBox(0.5, 0.5, new Math.b2Vec2(0, 0), 0);
      const fixture = new Dynamics.b2FixtureDef();
      fixture.shape = shape;
      fixture.friction = this.material.friction;
      fixture.restitution = this.material.restitution;
      body.CreateFixture(fixture).SetUserData(cell);
      const data = {
        polyominoId: this.nextLockedPolyominoId++,
        color: baseColor,
        trash: true,
        cells: [cell],
        origin: { x: x + 0.5, y: y + 0.5 },
        visualPose: { x: x + 0.5, y: y + 0.5, angle: 0 },
      };
      body.SetUserData(data);
      this.bodies.push(body);
      this.onLockedPolyominoCreated?.({ body, data });
    });
  }
  hasTrash() {
    return this.bodies.some((body) => body.GetUserData()?.trash);
  }
  hasTrashOnRow(row) {
    if (!Number.isInteger(row)) return false;
    return this.bodies.some((body) => {
      if (!body.GetUserData()?.trash) return false;
      return Math.round(body.GetPosition().y - 0.5) === row;
    });
  }
  clearLockedBodies() {
    this.bodies.forEach((body) => {
      this.onLockedPolyominoDestroyed?.({
        body,
        data: body.GetUserData(),
      });
      this.world.DestroyBody(body);
    });
    this.bodies = [];
  }
  scan(now) {
    const rows = this.scanner.scan();
    if (rows === null) return { scanned: false, rows: [], marks: [] };
    return { scanned: true, rows, marks: this.vanish.mark(rows, now) };
  }
  // Locks deliberately scan immediately instead of waiting for the next
  // twenty-frame rule. `FrameRuleScanner` resets its cadence in force mode.
  scanImmediately(now = performance.now()) {
    const rows = this.scanner.scan(true);
    return { scanned: true, rows, marks: this.vanish.mark(rows, now) };
  }
  hasPendingVanish() {
    return this.vanish.pending();
  }
  splitDisconnectedLockedBody(body) {
    const data = body?.GetUserData?.();
    if (!data?.cells?.length) return body ? [body] : [];
    const remaining = new Map(
      data.cells.map((cell) => [`${cell.x},${cell.y}`, cell]),
    );
    const components = [];
    let inspected = 0;
    while (remaining.size) {
      if (components.length >= this.maxFragmentResolveCells) {
        console.error("[Physics] Lock component safety limit reached.", {
          componentCount: components.length,
          remainingCells: remaining.size,
        });
        return [body];
      }
      const [firstKey, first] = remaining.entries().next().value;
      remaining.delete(firstKey);
      const component = [first];
      for (let index = 0; index < component.length; index += 1) {
        if (++inspected > this.maxFragmentResolveCells) {
          console.error("[Physics] Lock component cell safety limit reached.", {
            inspected,
            componentSize: component.length,
          });
          return [body];
        }
        const cell = component[index];
        [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
          const key = `${cell.x + dx},${cell.y + dy}`;
          const neighbor = remaining.get(key);
          if (!neighbor) return;
          remaining.delete(key);
          component.push(neighbor);
        });
      }
      components.push(component);
    }
    if (components.length <= 1) return [body];
    const position = body.GetPosition();
    const velocity = body.GetLinearVelocity();
    const pose = {
      position: { x: position.x, y: position.y },
      angle: body.GetAngle(),
      velocity: { x: velocity.x, y: velocity.y },
      angularVelocity: body.GetAngularVelocity(),
    };
    this.world.DestroyBody(body);
    this.bodies = this.bodies.filter((candidate) => candidate !== body);
    return components.map((component) =>
      this.createFragment(
        component,
        data.color,
        data.material || this.material,
        data.origin,
        pose,
      ),
    );
  }
  createFragment(cells, color, material, origin, pose) {
    const {
      Dynamics,
      Collision: { Shapes },
      Common: { Math: Box2DMath },
    } = this.api;
    const contains = (cell, dx, dy) =>
      cells.some((other) => other.x === cell.x + dx && other.y === cell.y + dy);
    const fragmentCells = cells.map((source) => {
      const previous = source.visualLinks || {};
      return {
        ...source,
        marked: false,
        // Keep the original SDF adjacency. A broken side is a material state,
        // not a replacement topology mask for the surviving mino texture.
        visualLinks: { ...previous },
        // Only sides whose original neighbor was removed become broken.
        broken: {
          top: Boolean(
            source.broken?.top || (previous.top && !contains(source, 0, -1)),
          ),
          right: Boolean(
            source.broken?.right || (previous.right && !contains(source, 1, 0)),
          ),
          bottom: Boolean(
            source.broken?.bottom ||
            (previous.bottom && !contains(source, 0, 1)),
          ),
          left: Boolean(
            source.broken?.left || (previous.left && !contains(source, -1, 0)),
          ),
        },
        fractured: true,
      };
    });
    // A fractured body's origin must move to its own centroid.  That gives
    // source rendering and playback the same local, integer-cell geometry.
    const fragmentOrigin = polyominoCentroid(fragmentCells);
    const localOffset = {
      x: fragmentOrigin.x - origin.x,
      y: fragmentOrigin.y - origin.y,
    };
    const cosine = globalThis.Math.cos(pose.angle);
    const sine = globalThis.Math.sin(pose.angle);
    const fragmentPosition = {
      x: pose.position.x + localOffset.x * cosine - localOffset.y * sine,
      y: pose.position.y + localOffset.x * sine + localOffset.y * cosine,
    };
    const def = new Dynamics.b2BodyDef();
    def.type = Dynamics.b2Body.b2_dynamicBody;
    def.position.Set(fragmentPosition.x, fragmentPosition.y);
    def.angle = pose.angle;
    const body = this.world.CreateBody(def);
    fragmentCells.forEach((cell) => {
      const shape = new Shapes.b2PolygonShape();
      shape.SetAsOrientedBox(
        0.5,
        0.5,
        new Box2DMath.b2Vec2(
          cell.x - fragmentOrigin.x + 0.5,
          cell.y - fragmentOrigin.y + 0.5,
        ),
        0,
      );
      const fixture = new Dynamics.b2FixtureDef();
      fixture.shape = shape;
      fixture.density = material.density;
      fixture.friction = material.friction;
      fixture.restitution = material.restitution;
      body.CreateFixture(fixture).SetUserData(cell);
    });
    const data = {
      polyominoId: this.nextLockedPolyominoId++,
      color,
      material,
      cells: fragmentCells,
      origin: fragmentOrigin,
      visualPose: {
        x: fragmentPosition.x,
        y: fragmentPosition.y,
        angle: pose.angle,
      },
    };
    body.SetUserData(data);
    // Moving the body's origin to the fragment centroid must preserve the
    // velocity at that new origin while it is spinning.
    const worldOffset = {
      x: fragmentPosition.x - pose.position.x,
      y: fragmentPosition.y - pose.position.y,
    };
    body.SetLinearVelocity(
      new Box2DMath.b2Vec2(
        pose.velocity.x - pose.angularVelocity * worldOffset.y,
        pose.velocity.y + pose.angularVelocity * worldOffset.x,
      ),
    );
    body.SetAngularVelocity(pose.angularVelocity);
    this.bodies.push(body);
    this.onLockedPolyominoCreated?.({ body, data });
    return body;
  }
  fractureBodies(removedByBody) {
    const removed = [];
    this.bodies.slice().forEach((body) => {
      const data = body.GetUserData();
      const removedCells = removedByBody.get(body);
      if (!removedCells?.size) return;
      removed.push(
        ...data.cells
          .filter((tile) => removedCells.has(tile))
          .map((tile) => {
            // Penetration removal records the live Box2D mino position. Line
            // clears use their logical grid tile position as before.
            const worldPosition = removedCells.get?.(tile);
            return {
              ...tile,
              baseColor: tile.baseColor ?? data.color,
              x: worldPosition?.x ?? tile.x,
              y: worldPosition?.y ?? tile.y,
              angle: worldPosition?.angle ?? 0,
            };
          }),
      );
      const remaining = data.cells.filter((tile) => !removedCells.has(tile));
      const remainingByPosition = new Map(
        remaining.map((tile) => [`${tile.x},${tile.y}`, tile]),
      );
      const components = [];
      let componentCount = 0;
      let visitedCells = 0;
      while (remainingByPosition.size) {
        if (++componentCount > this.maxFragmentResolveCells) {
          console.error("[Physics] Fragment component safety limit reached.", {
            componentCount,
            remainingCells: remainingByPosition.size,
          });
          break;
        }
        const [firstKey, first] = remainingByPosition.entries().next().value;
        remainingByPosition.delete(firstKey);
        const component = [first];
        for (let index = 0; index < component.length; index++) {
          if (++visitedCells > this.maxFragmentResolveCells) {
            console.error("[Physics] Fragment cell safety limit reached.", {
              visitedCells,
              componentSize: component.length,
            });
            component.length = index;
            remainingByPosition.clear();
            break;
          }
          const cell = component[index];
          [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ].forEach(([dx, dy]) => {
            const key = `${cell.x + dx},${cell.y + dy}`;
            const neighbor = remainingByPosition.get(key);
            if (!neighbor) return;
            remainingByPosition.delete(key);
            component.push(neighbor);
          });
        }
        components.push(component);
      }
      const position = body.GetPosition();
      const velocity = body.GetLinearVelocity();
      const pose = {
        position: { x: position.x, y: position.y },
        angle: body.GetAngle(),
        velocity: { x: velocity.x, y: velocity.y },
        angularVelocity: body.GetAngularVelocity(),
      };
      this.onLockedPolyominoDestroyed?.({ body, data });
      this.world.DestroyBody(body);
      this.bodies = this.bodies.filter((candidate) => candidate !== body);
      components.forEach((component) =>
        this.createFragment(component, data.color, data.material || this.material, data.origin, pose),
      );
    });
    return removed;
  }
  breakPenetratingMinos() {
    const { Common: { Math } } = this.api;
    const brokenByBody = new Map();
    this.bodies.forEach((body) => {
      if (!body.IsAwake?.()) return;
      const data = body.GetUserData();
      data.cells.forEach((cell) => {
        const centroid = body.GetWorldPoint(
          new Math.b2Vec2(
            cell.x - data.origin.x + 0.5,
            cell.y - data.origin.y + 0.5,
          ),
        );
        const hit = fixtureAtPoint(this.world, centroid, (fixture) => {
          const otherBody = fixture.GetBody();
          return otherBody !== body && this.bodies.includes(otherBody);
        });
        if (!hit) return;
        const broken = brokenByBody.get(body) || new Map();
        // EffectsRenderer uses a mino's top-left grid coordinate and adds its
        // own half-cell center offset. Preserve the rotated Box2D centroid.
        broken.set(cell, {
          x: centroid.x - 0.5,
          y: centroid.y - 0.5,
          angle: body.GetAngle(),
        });
        brokenByBody.set(body, broken);
      });
    });
    return this.fractureBodies(brokenByBody);
  }
  destroyMarked() {
    const vanishedLines = this.vanish.consumeLines();
    const markedByBody = new Map(
      this.bodies
        .map((body) => [body, new Set(body.GetUserData().cells.filter((tile) => tile.marked))])
        .filter(([, marked]) => marked.size),
    );
    const vanished = this.fractureBodies(markedByBody);
    this.vanish.reset();
    return { vanished, vanishedLines };
  }
  step(ms, now = performance.now()) {
    this.bodies.forEach((body) => this.updateTemporaryMass(body, ms));
    this.world.Step(Math.min(ms / 1000, 1 / 30), 8, 3);
    this.world.ClearForces();
    const scan = this.scan(now);
    // Run after Box2D resolves this frame. A locked mino whose exact centroid
    // lies in another locked fixture is removed through the normal fracture
    // path, preserving all broken-edge and component segmentation behavior.
    const broken = this.breakPenetratingMinos();
    const destroyed = this.vanish.due(now)
      ? this.destroyMarked()
      : { vanished: [], vanishedLines: [] };
    return { ...scan, ...destroyed, broken };
  }
  clear() {
    this.destroyControlled();
    this.clearLockedBodies();
    this.nextLockedPolyominoId = 1;
  }
}
