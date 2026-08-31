/**
 * Renders a textured ribbon from an authored baseline polyline.
 * The baseline can extrude separately to its left and right sides.
 * Offset joins are intersected instead of overlapping independent rope quads.
 * Callers can provide exact along-path UV coordinates for cap mappings.
 * Closed paths wrap their joins and use one constant middle UV, avoiding caps.
 * This Pixi mesh primitive provides LineRenderer-style path control.
 */

export class AdvancedLineRenderer {
  static whiteTexture = null;
  static halfParticleTextures = new Map();
  static fullParticleTextures = new Map();

  static getWhiteTexture() {
    if (AdvancedLineRenderer.whiteTexture)
      return AdvancedLineRenderer.whiteTexture;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 2, 2);
    AdvancedLineRenderer.whiteTexture = PIXI.Texture.from(canvas);
    return AdvancedLineRenderer.whiteTexture;
  }

  // The texture contains the lower half of one circular particle. Its bright
  // edge sits at V = 1 (the path baseline), while its alpha fades outward to
  // V = 0. U spans the full particle diameter, so the first and final rope
  // segments can map their respective half-particle end caps explicitly.
  static getHalfParticleTexture(radius = 24) {
    const size = Math.max(2, Math.round(radius));
    const cached = AdvancedLineRenderer.halfParticleTextures.get(size);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = size * 2;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(
      size,
      size,
      0,
      size,
      size,
      size,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = PIXI.Texture.from(canvas);
    texture.source.scaleMode = "linear";
    AdvancedLineRenderer.halfParticleTextures.set(size, texture);
    return texture;
  }

  // A complete radial particle. This is useful for broad, soft focus glows
  // where the baseline should pass through the middle of the gradient rather
  // than sit on its bright edge.
  static getFullParticleTexture(radius = 24) {
    const size = Math.max(2, Math.round(radius));
    const cached = AdvancedLineRenderer.fullParticleTextures.get(size);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size * 2;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(
      size,
      size,
      0,
      size,
      size,
      size,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = PIXI.Texture.from(canvas);
    texture.source.scaleMode = "linear";
    AdvancedLineRenderer.fullParticleTextures.set(size, texture);
    return texture;
  }

  static appendQuadratic(points, control, end, segments = 6) {
    const start = points[points.length - 1];
    for (let index = 1; index <= segments; index++) {
      const t = index / segments;
      const inverse = 1 - t;
      points.push(
        new PIXI.Point(
          inverse * inverse * start.x +
            2 * inverse * t * control.x +
            t * t * end.x,
          inverse * inverse * start.y +
            2 * inverse * t * control.y +
            t * t * end.y,
        ),
      );
    }
  }

  constructor({
    texture,
    tint = 0xffffff,
    leftWidth = 0,
    rightWidth = 0,
    alpha = 1,
    miterLimit = 4,
    flipV = false,
    closed = false,
    closedU = 0.5,
    name = "advancedLine",
  }) {
    Object.assign(this, {
      texture,
      tint,
      leftWidth,
      rightWidth,
      alpha,
      miterLimit,
      flipV,
      closed,
      closedU,
      name,
    });
  }

  draw(parent, points, alongUvs = null) {
    const path =
      this.closed &&
      points.length > 2 &&
      points[0].x === points.at(-1).x &&
      points[0].y === points.at(-1).y
        ? points.slice(0, -1)
        : points;
    if (path.length < 2 || (this.closed && path.length < 3)) return null;
    const vertices = new Float32Array(path.length * 4);
    const uvs = new Float32Array(path.length * 4);
    const segmentCount = this.closed ? path.length : path.length - 1;
    const indices = new Uint16Array(segmentCount * 6);
    const lengths = [0];
    for (let index = 1; index < path.length; index++)
      lengths[index] =
        lengths[index - 1] +
        Math.hypot(
          path[index].x - path[index - 1].x,
          path[index].y - path[index - 1].y,
        );
    const total = lengths.at(-1) || 1;
    path.forEach((point, index) => {
      const previous =
        path[
          this.closed
            ? (index - 1 + path.length) % path.length
            : Math.max(0, index - 1)
        ];
      const next =
        path[
          this.closed
            ? (index + 1) % path.length
            : Math.min(path.length - 1, index + 1)
        ];
      const previousDistance =
        Math.hypot(point.x - previous.x, point.y - previous.y) || 1;
      const nextDistance = Math.hypot(next.x - point.x, next.y - point.y) || 1;
      const previousNormal = {
        x: -(point.y - previous.y) / previousDistance,
        y: (point.x - previous.x) / previousDistance,
      };
      const nextNormal = {
        x: -(next.y - point.y) / nextDistance,
        y: (next.x - point.x) / nextDistance,
      };
      let normalX = previousNormal.x + nextNormal.x;
      let normalY = previousNormal.y + nextNormal.y;
      const normalLength = Math.hypot(normalX, normalY) || 1;
      normalX /= normalLength;
      normalY /= normalLength;
      const denominator =
        Math.abs(normalX * nextNormal.x + normalY * nextNormal.y) || 1;
      const left = Math.min(
        this.leftWidth / denominator,
        this.leftWidth * this.miterLimit,
      );
      const right = Math.min(
        this.rightWidth / denominator,
        this.rightWidth * this.miterLimit,
      );
      const offset = index * 4;
      vertices.set(
        [
          point.x + normalX * left,
          point.y + normalY * left,
          point.x - normalX * right,
          point.y - normalY * right,
        ],
        offset,
      );
      const u = this.closed
        ? this.closedU
        : (alongUvs?.[index] ?? lengths[index] / total);
      const leftV = this.flipV ? 1 : 0;
      const rightV = this.flipV ? 0 : 1;
      uvs.set([u, leftV, u, rightV], offset);
      if (index < segmentCount) {
        const triangle = index * 6;
        const vertex = index * 2;
        const nextVertex = ((index + 1) % path.length) * 2;
        indices.set(
          [
            vertex,
            vertex + 1,
            nextVertex,
            vertex + 1,
            nextVertex + 1,
            nextVertex,
          ],
          triangle,
        );
      }
    });
    const mesh = new PIXI.MeshSimple({
      texture: this.texture,
      vertices,
      uvs,
      indices,
    });
    mesh.label = this.name;
    mesh.tint = this.tint;
    mesh.alpha = this.alpha;
    parent.addChild(mesh);
    return mesh;
  }
}
