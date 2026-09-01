/**
 * Holds shared material settings for every active mino shader instance.
 * Scalar settings are typed arrays so existing Pixi uniforms update live.
 * Curve LUTs provide distance-based responses for authored material stages.
 * The A1/A2 SDF blend remains the sole source of every downstream effect.
 * Reflection state is shared by the mino-only render-texture capture pass.
 */

import { CurveLut } from "./CurveLut.js";

const createPerlinTexture = () => {
  const size = 64;
  const gradients = Array.from({ length: 9 * 9 }, (_, index) => {
    const angle = (((index * 16807) % 65521) / 65521) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const fade = (value) =>
    value * value * value * (value * (value * 6 - 15) + 10);
  const gradient = (x, y, dx, dy) => {
    const value = gradients[(y % 9) * 9 + (x % 9)];
    return value[0] * dx + value[1] * dy;
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const px = (x / size) * 8;
      const py = (y / size) * 8;
      const gx = Math.floor(px);
      const gy = Math.floor(py);
      const fx = px - gx;
      const fy = py - gy;
      const sx = fade(fx);
      const sy = fade(fy);
      const top =
        gradient(gx, gy, fx, fy) * (1 - sx) +
        gradient(gx + 1, gy, fx - 1, fy) * sx;
      const bottom =
        gradient(gx, gy + 1, fx, fy - 1) * (1 - sx) +
        gradient(gx + 1, gy + 1, fx - 1, fy - 1) * sx;
      const value = Math.round((top * (1 - sy) + bottom * sy) * 90 + 127.5);
      image.data.set([value, value, value, 255], (y * size + x) * 4);
    }
  context.putImageData(image, 0, 0);
  const texture = PIXI.Texture.from(canvas);
  texture.source.style.addressMode = "repeat";
  return texture;
};

// Texture noise is immutable and shared. Scalar uniforms and LUT graphics are
// created per Playfield so players may use independent skins in one scene.
const sharedNoiseTexture = createPerlinTexture();

export const createShaderSettings = () => ({
  sdfBlend: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  previewRange: new Float32Array([0.28, 0.0, 0.0, 0.0]),
  cornerRadius: new Float32Array([0.42, 0.0, 0.0, 0.0]),
  sdfStrength: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  sdfDebug: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  albedoDarkness: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  transparency: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  finalAlpha: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  light: new Float32Array([-0.45, -0.6, 0.9, 0.0]),
  normalEnabled: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  normalPreview: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  bevelWidth: new Float32Array([0.28, 0.0, 0.0, 0.0]),
  bevelHardness: new Float32Array([1.5, 0.0, 0.0, 0.0]),
  specularEnabled: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  metallic: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  smoothness: new Float32Array([0.65, 0.0, 0.0, 0.0]),
  specularTint: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  specularPower: new Float32Array([48.0, 0.0, 0.0, 0.0]),
  edgeTone: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  edgeWidth: new Float32Array([0.08, 0.0, 0.0, 0.0]),
  selfEdgeTone: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  selfEdgeWidth: new Float32Array([0.08, 0.0, 0.0, 0.0]),
  brokenEdgeTone: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  brokenEdgeWidth: new Float32Array([0.08, 0.0, 0.0, 0.0]),
  brokenEdgeOffset: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  brokenDistortion: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  brokenNoiseScale: new Float32Array([8.0, 0.0, 0.0, 0.0]),
  brokenSdfBlend: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  noiseTexture: sharedNoiseTexture,
  reflectionEnabled: new Float32Array([0.0, 0.0, 0.0, 0.0]),
  reflectionOffset: new Float32Array([0.0, -18.0, 0.0, 0.0]),
  reflectionDownsample: new Float32Array([1.0, 0.0, 0.0, 0.0]),
  sceneSize: new Float32Array([900.0, 700.0, 0.0, 0.0]),
  reflectionTexture: PIXI.Texture.WHITE,
  bevelProfile: new CurveLut([0, 0.05, 0.2, 0.5, 0.78, 0.94, 1, 1]),
  transparencyCurve: new CurveLut([1, 1], 64),
  finalAlphaCurve: new CurveLut([1, 1], 64, true),
  metallicCurve: new CurveLut([0, 0, 0, 0, 0, 0, 0, 0]),
});

// The editor keeps one default material for previews and authoring. Gameplay
// Playfields create their own instance with createShaderSettings().
export const shaderSettings = createShaderSettings();

// A material owns its curve textures. The generated noise source is shared and
// deliberately survives individual playfield teardown.
export const destroyShaderSettings = (settings) => {
  if (!settings || settings === shaderSettings) return;
  skinCurveKeys.forEach((key) => settings[key]?.destroy());
};

export const resetShaderSettings = (settings = shaderSettings) => {
  // Keep the authored reset list below readable while allowing callers to
  // target a Playfield-owned material instead of the editor default.
  const shaderSettings = settings;
  settings.sdfBlend.set([1.0, 0.0, 0.0, 0.0]);
  shaderSettings.previewRange.set([0.28, 0.0, 0.0, 0.0]);
  shaderSettings.cornerRadius.set([0.42, 0.0, 0.0, 0.0]);
  shaderSettings.sdfStrength.set([1, 0, 0, 0]);
  shaderSettings.sdfDebug.set([0, 0, 0, 0]);
  shaderSettings.albedoDarkness.set([0, 0, 0, 0]);
  shaderSettings.transparency.set([1, 0, 0, 0]);
  shaderSettings.finalAlpha.set([1, 0, 0, 0]);
  shaderSettings.light.set([-0.45, -0.6, 0.9, 0]);
  shaderSettings.normalEnabled.set([1, 0, 0, 0]);
  shaderSettings.normalPreview.set([0, 0, 0, 0]);
  shaderSettings.bevelWidth.set([0.28, 0, 0, 0]);
  shaderSettings.bevelHardness.set([1.5, 0, 0, 0]);
  shaderSettings.specularEnabled.set([1, 0, 0, 0]);
  shaderSettings.metallic.set([0, 0, 0, 0]);
  shaderSettings.smoothness.set([0.65, 0, 0, 0]);
  shaderSettings.specularTint.set([0, 0, 0, 0]);
  shaderSettings.specularPower.set([48, 0, 0, 0]);
  shaderSettings.edgeTone.set([0, 0, 0, 0]);
  shaderSettings.edgeWidth.set([0.08, 0, 0, 0]);
  shaderSettings.selfEdgeTone.set([0, 0, 0, 0]);
  shaderSettings.selfEdgeWidth.set([0.08, 0, 0, 0]);
  shaderSettings.brokenEdgeTone.set([0, 0, 0, 0]);
  shaderSettings.brokenEdgeWidth.set([0.08, 0, 0, 0]);
  shaderSettings.brokenEdgeOffset.set([0, 0, 0, 0]);
  shaderSettings.brokenDistortion.set([0, 0, 0, 0]);
  shaderSettings.brokenNoiseScale.set([8, 0, 0, 0]);
  shaderSettings.brokenSdfBlend.set([1, 0, 0, 0]);
  shaderSettings.reflectionEnabled.set([0, 0, 0, 0]);
  shaderSettings.reflectionOffset.set([0, -18, 0, 0]);
  shaderSettings.reflectionDownsample.set([1, 0, 0, 0]);
  shaderSettings.bevelProfile.reset();
  shaderSettings.transparencyCurve.reset();
  shaderSettings.finalAlphaCurve.reset();
  shaderSettings.metallicCurve.reset();
};

// Only authored scalar material values are part of a skin. Runtime render
// targets, canvas sizes, and generated textures deliberately stay local.
export const skinScalarKeys = Object.freeze([
  "sdfBlend",
  "previewRange",
  "cornerRadius",
  "sdfStrength",
  "sdfDebug",
  "albedoDarkness",
  "transparency",
  "finalAlpha",
  "light",
  "normalEnabled",
  "normalPreview",
  "bevelWidth",
  "bevelHardness",
  "specularEnabled",
  "metallic",
  "smoothness",
  "specularTint",
  "specularPower",
  "edgeTone",
  "edgeWidth",
  "selfEdgeTone",
  "selfEdgeWidth",
  "brokenEdgeTone",
  "brokenEdgeWidth",
  "brokenEdgeOffset",
  "brokenDistortion",
  "brokenNoiseScale",
  "brokenSdfBlend",
  "reflectionEnabled",
  "reflectionOffset",
  "reflectionDownsample",
]);

export const skinCurveKeys = Object.freeze([
  "bevelProfile",
  "transparencyCurve",
  "finalAlphaCurve",
  "metallicCurve",
]);

export const exportSkin = (settings = shaderSettings) => ({
  version: 1,
  values: Object.fromEntries(
    skinScalarKeys.map((key) => [key, [...settings[key]]]),
  ),
  curves: Object.fromEntries(
    skinCurveKeys.map((key) => [key, settings[key].serialize()]),
  ),
});

// A skin is always loaded from known defaults. Imports are deliberately
// permissive: recognized valid data is merged and all other fields are ignored.
// This keeps the editor usable with hand-written and previously saved JSON.
export const loadSkin = (skin, settings = shaderSettings) => {
  resetShaderSettings(settings);
  const shaderSettings = settings;
  if (!skin || typeof skin !== "object" || Array.isArray(skin)) return 0;

  const values =
    skin.values &&
    typeof skin.values === "object" &&
    !Array.isArray(skin.values)
      ? skin.values
      : skin;
  const curves =
    skin.curves &&
    typeof skin.curves === "object" &&
    !Array.isArray(skin.curves)
      ? skin.curves
      : skin;
  let applied = 0;

  skinScalarKeys.forEach((key) => {
    const incoming = values[key];
    const target = shaderSettings[key];
    const numbers = Number.isFinite(incoming) ? [incoming] : incoming;
    if (!Array.isArray(numbers)) return;
    let wrote = false;
    numbers.slice(0, target.length).forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      target[index] = value;
      wrote = true;
    });
    if (wrote) applied += 1;
  });

  skinCurveKeys.forEach((key) => {
    const incoming = curves[key];
    const points = Array.isArray(incoming) ? incoming : incoming?.points;
    const resolution = incoming?.resolution ?? points?.length;
    const mode = ["linear", "smooth", "hold"].includes(incoming?.mode)
      ? incoming.mode
      : "linear";
    if (
      !Array.isArray(points) ||
      ![2, 8, 16, 32].includes(resolution) ||
      points.length !== resolution
    )
      return;
    if (
      !points.every(
        (value) =>
          value == null || (Number.isFinite(value) && value >= 0 && value <= 1),
      )
    )
      return;
    if (
      !Number.isFinite(points[0]) ||
      !Number.isFinite(points[points.length - 1])
    )
      return;
    shaderSettings[key].load({ resolution, points, mode });
    applied += 1;
  });
  return applied;
};
