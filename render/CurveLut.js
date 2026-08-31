/**
 * Stores an editable scalar response curve and exposes it as a 64-sample LUT.
 * The curve uses fixed authoring slots and linear interpolation on the GPU.
 * Each material response owns one instance, avoiding hidden scalar remapping.
 * Pixi uploads the one-row canvas as a texture for mino fragment shaders.
 */

export class CurveLut {
  constructor(
    points = [0, 0.2, 0.7, 1],
    samples = 64,
    transparentFirstTexel = false,
  ) {
    this.points = new Array(16).fill(null);
    points.forEach((value, index) => {
      const slot = Math.round((index * 15) / Math.max(1, points.length - 1));
      this.points[slot] = value;
    });
    this.points[0] ??= 0;
    this.points[15] ??= 1;
    this.defaultPoints = [...this.points];
    this.samples = samples;
    this.transparentFirstTexel = transparentFirstTexel;
    this.mode = "linear";
    this.canvas = document.createElement("canvas");
    this.canvas.width = samples;
    this.canvas.height = 1;
    this.context = this.canvas.getContext("2d", { alpha: false });
    this.texture = PIXI.Texture.from(this.canvas);
    this.update();
  }

  sample(t) {
    const x = Math.max(0, Math.min(1, t)) * (this.points.length - 1);
    const active = this.points
      .map((value, index) => (value == null ? null : index))
      .filter((index) => index != null);
    const right = active.find((index) => index >= x) ?? this.points.length - 1;
    const left = [...active].reverse().find((index) => index <= x) ?? 0;
    if (left === right) return this.points[left];
    const fraction = (x - left) / (right - left);
    if (this.mode === "hold") return this.points[left];
    if (this.mode !== "smooth")
      return this.points[left] * (1 - fraction) + this.points[right] * fraction;
    const leftIndex = active.indexOf(left);
    const rightIndex = active.indexOf(right);
    const p0 = this.points[active[Math.max(0, leftIndex - 1)]];
    const p1 = this.points[left];
    const p2 = this.points[right];
    const p3 = this.points[active[Math.min(active.length - 1, rightIndex + 1)]];
    const t2 = fraction * fraction;
    const t3 = t2 * fraction;
    return Math.max(
      0,
      Math.min(
        1,
        0.5 *
          (2 * p1 +
            (-p0 + p2) * fraction +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
            (-p0 + 3 * p1 - 3 * p2 + p3) * t3),
      ),
    );
  }

  update() {
    const image = this.context.createImageData(this.samples, 1);
    for (let x = 0; x < this.samples; x += 1) {
      const sampled = this.sample(x / (this.samples - 1));
      const value = Math.round(
        (x === 0 && this.transparentFirstTexel ? 0 : sampled) * 255,
      );
      image.data.set([value, value, value, 255], x * 4);
    }
    this.context.putImageData(image, 0, 0);
    this.texture.source.update();
  }

  reset() {
    this.points = [...this.defaultPoints];
    this.mode = "linear";
    this.update();
  }

  serialize() {
    return {
      resolution: this.points.length,
      points: [...this.points],
      mode: this.mode,
    };
  }

  load(data) {
    if (
      !data ||
      !Array.isArray(data.points) ||
      ![2, 8, 16, 32].includes(data.resolution) ||
      data.points.length !== data.resolution ||
      !["linear", "smooth", "hold"].includes(data.mode)
    )
      throw new Error("Invalid curve skin data.");
    if (
      !data.points.every(
        (value) =>
          value == null || (Number.isFinite(value) && value >= 0 && value <= 1),
      )
    )
      throw new Error("Invalid curve skin points.");
    if (
      !Number.isFinite(data.points[0]) ||
      !Number.isFinite(data.points[data.points.length - 1])
    )
      throw new Error("Curve endpoints are required.");
    this.points = [...data.points];
    this.mode = data.mode;
    this.update();
  }

  setResolution(resolution) {
    const previous = this.points;
    const previousLength = previous.length;
    const samplePrevious = (t) => {
      const x = t * (previousLength - 1);
      const left = Math.floor(x);
      const right = Math.min(previousLength - 1, left + 1);
      return (
        (previous[left] ?? 0) * (1 - (x - left)) +
        (previous[right] ?? 1) * (x - left)
      );
    };
    this.points = Array.from({ length: resolution }, (_, index) =>
      samplePrevious(index / (resolution - 1)),
    );
    this.points[0] = previous[0] ?? 0;
    this.points[resolution - 1] = previous[previousLength - 1] ?? 1;
    this.update();
  }

  destroy() {
    this.texture.destroy(true);
  }
}
