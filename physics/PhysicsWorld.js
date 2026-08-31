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
  PHYSICS_RELEASE_MASS_GAIN_PER_SECOND,
  PHYSICS_RELEASE_MASS_RESET_PER_SECOND,
  VANISH_DURATION_MS,
} from "../config/gameplayConstants.js";
import { FrameRuleScanner } from "./FrameRuleScanner.js";
import { VanishSystem } from "./VanishSystem.js";
import { pointOccupied as queryPointOccupied } from "./PhysicsQueries.js";
import { survivingTiles } from "./FractureSystem.js";

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
  constructor(api = globalThis.Box2D, preset = "balanced") {
    if (!api) throw new Error("Box2D failed to load.");
    this.api = api;
    this.material =
      PHYSICS_MATERIAL_PRESETS[preset] || PHYSICS_MATERIAL_PRESETS.balanced;
    const { b2Vec2 } = api.Common.Math;
    this.world = new api.Dynamics.b2World(new b2Vec2(0, 24), true);
    this.bodies = [];
    this.scanner = new FrameRuleScanner(this.world, api);
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
        if (!data || typeof data.releaseMassBoost !== "number") return;
        data.contacting = true;
      });
    };
    listener.EndContact = (contact) => {
      const bodyA = contact.GetFixtureA()?.GetBody?.();
      const bodyB = contact.GetFixtureB()?.GetBody?.();
      [bodyA, bodyB].forEach((body) => {
        const data = body?.GetUserData?.();
        if (!data || typeof data.releaseMassBoost !== "number") return;
        data.contacting = false;
      });
    };
    this.world.SetContactListener(listener);
  }
  setReleaseMass(body, boost) {
    if (!body) return;
    const data = body.GetUserData();
    if (!data) return;
    data.releaseMassBoost = Math.max(0, boost);
    for (let fixture = body.GetFixtureList(); fixture; fixture = fixture.GetNext()) {
      fixture.density = this.material.density + data.releaseMassBoost;
    }
    body.ResetMassData();
  }
  updateReleaseMass(body, dtMs) {
    const data = body.GetUserData();
    if (!data || !data.releaseActive) return;
    const dt = dtMs / 1000;
    if (data.contacting) {
      this.setReleaseMass(
        body,
        Math.max(
          0,
          data.releaseMassBoost -
            dt * PHYSICS_RELEASE_MASS_RESET_PER_SECOND,
        ),
      );
      return;
    }
    this.setReleaseMass(
      body,
      data.releaseMassBoost +
        dt * PHYSICS_RELEASE_MASS_GAIN_PER_SECOND,
    );
  }
  beginReleaseMass(body) {
    const data = body?.GetUserData?.();
    if (!data) return;
    data.releaseActive = true;
    data.contacting = false;
    data.releaseMassBoost = 0;
    this.setReleaseMass(body, 0);
  }
  getControlledMassBoost() {
    const data = this.controlBody?.GetUserData?.();
    if (!data || !data.releaseActive) return 0;
    return data.releaseMassBoost || 0;
  }
  createBounds() {
    const {
        Dynamics,
        Collision: { Shapes },
        Common: { Math },
      } = this.api,
      body = this.world.CreateBody(new Dynamics.b2BodyDef());
    [
      [COLS / 2, ROWS + 0.5, COLS / 2 + 0.5, 0.5],
      [-0.5, ROWS / 2, 0.5, ROWS / 2],
      [COLS + 0.5, ROWS / 2, 0.5, ROWS / 2],
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
        body.GetType() === Dynamics.b2Body.b2_dynamicBody
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
    const origin = {
      x: cells.reduce((sum, cell) => sum + cell.x + 0.5, 0) / cells.length,
      y: cells.reduce((sum, cell) => sum + cell.y + 0.5, 0) / cells.length,
    };
    const signature = cells
      .map((cell) => `${cell.x - origin.x}:${cell.y - origin.y}`)
      .sort()
      .join("|");
    const rebuild = forceFixtures || signature !== this.controlSignature;
    if (rebuild) {
      for (let fixture = this.controlBody.GetFixtureList(); fixture;) {
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
        fixture.friction = this.material.friction;
        fixture.restitution = this.material.restitution;
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
    const origin = {
        x: cells.reduce((n, c) => n + c.x + 0.5, 0) / cells.length,
        y: cells.reduce((n, c) => n + c.y + 0.5, 0) / cells.length,
      },
      def = new Dynamics.b2BodyDef();
    def.type = Dynamics.b2Body.b2_dynamicBody;
    def.position.Set(origin.x, origin.y);
    const body = this.world.CreateBody(def),
      data = {
        color: piece.color,
        cells: cells.map((c) => ({ ...c, marked: false })),
        origin,
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
      f.density = this.material.density;
      f.friction = this.material.friction;
      f.restitution = this.material.restitution;
      body.CreateFixture(f).SetUserData(cell);
    });
    data.releaseActive = false;
    data.releaseMassBoost = 0;
    data.contacting = false;
    body.SetUserData(data);
    this.bodies.push(body);
    return body;
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
  createFragment(cells, color, origin, pose) {
    const {
      Dynamics,
      Collision: { Shapes },
      Common: { Math },
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
    const def = new Dynamics.b2BodyDef();
    def.type = Dynamics.b2Body.b2_dynamicBody;
    def.position.Set(pose.position.x, pose.position.y);
    def.angle = pose.angle;
    const body = this.world.CreateBody(def);
    fragmentCells.forEach((cell) => {
      const shape = new Shapes.b2PolygonShape();
      shape.SetAsOrientedBox(
        0.5,
        0.5,
        new Math.b2Vec2(cell.x - origin.x + 0.5, cell.y - origin.y + 0.5),
        0,
      );
      const fixture = new Dynamics.b2FixtureDef();
      fixture.shape = shape;
      fixture.density = this.material.density;
      fixture.friction = this.material.friction;
      fixture.restitution = this.material.restitution;
      body.CreateFixture(fixture).SetUserData(cell);
    });
    body.SetUserData({ color, cells: fragmentCells, origin });
    body.SetLinearVelocity(new Math.b2Vec2(pose.velocity.x, pose.velocity.y));
    body.SetAngularVelocity(pose.angularVelocity);
    this.bodies.push(body);
  }
  destroyMarked() {
    const vanished = [];
    const vanishedLines = this.vanish.consumeLines();
    this.bodies.slice().forEach((body) => {
      const data = body.GetUserData();
      if (!data.cells.some((tile) => tile.marked)) return;
      vanished.push(
        ...data.cells
          .filter((tile) => tile.marked)
          .map((tile) => ({ ...tile, color: data.color })),
      );
      const remaining = survivingTiles(data);
      const remainingByPosition = new Map(
        remaining.map((tile) => [`${tile.x},${tile.y}`, tile]),
      );
      const components = [];
      while (remainingByPosition.size) {
        const [firstKey, first] = remainingByPosition.entries().next().value;
        remainingByPosition.delete(firstKey);
        const component = [first];
        for (let index = 0; index < component.length; index++) {
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
      this.world.DestroyBody(body);
      this.bodies = this.bodies.filter((candidate) => candidate !== body);
      components.forEach((component) =>
        this.createFragment(component, data.color, data.origin, pose),
      );
    });
    this.vanish.reset();
    return { vanished, vanishedLines };
  }
  step(ms, now = performance.now()) {
    this.bodies.forEach((body) => this.updateReleaseMass(body, ms));
    this.world.Step(Math.min(ms / 1000, 1 / 30), 8, 3);
    this.world.ClearForces();
    const scan = this.scan(now);
    const destroyed = this.vanish.due(now)
      ? this.destroyMarked()
      : { vanished: [], vanishedLines: [] };
    return { ...scan, ...destroyed };
  }
  clear() {
    this.destroyControlled();
    this.bodies.forEach((b) => this.world.DestroyBody(b));
    this.bodies = [];
  }
}
