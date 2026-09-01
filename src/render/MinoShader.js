/**
 * Creates Pixi shader instances from the external mino GLSL source files.
 * Per-mino adjacency is supplied as uniforms instead of baked textures.
 * Shared Skin Editor arrays update every active material immediately.
 * Field calculations and their authored comments live in mino.frag.glsl.
 */

import { shaderSettings as defaultShaderSettings } from "./ShaderSettings.js";
import { getMinoShaderSources } from "./ShaderSources.js";

const rgb = (color) =>
  new Float32Array([
    ((color >> 16) & 255) / 255,
    ((color >> 8) & 255) / 255,
    (color & 255) / 255,
  ]);
// Shader programs may share source and geometry, but their uniform resources
// must never cross Playfield boundaries. Each material owns its cache.
const shaderCaches = new WeakMap();
const cacheFor = (settings) => {
  let cache = shaderCaches.get(settings);
  if (!cache) {
    cache = new Map();
    shaderCaches.set(settings, cache);
  }
  return cache;
};

export const createMinoShader = (
  color,
  links,
  shaderSettings = defaultShaderSettings,
) => {
  const source = getMinoShaderSources();
  const adjacencyKey = [
    links.left ? 1 : 0,
    links.right ? 1 : 0,
    links.top ? 1 : 0,
    links.bottom ? 1 : 0,
    links.topLeft ? 1 : 0,
    links.topRight ? 1 : 0,
    links.bottomRight ? 1 : 0,
    links.bottomLeft ? 1 : 0,
    links.broken?.left ? 1 : 0,
    links.broken?.right ? 1 : 0,
    links.broken?.top ? 1 : 0,
    links.broken?.bottom ? 1 : 0,
  ].join("");
  const cacheKey = `${color}:${adjacencyKey}`;
  const shaderCache = cacheFor(shaderSettings);
  if (shaderCache.has(cacheKey)) return shaderCache.get(cacheKey);

  // In Pixi v8 number uniforms live in a typed resource group and sampler
  // uniforms receive a TextureSource. The arrays remain shared, so Skin Editor
  // changes continue to update every active mino without rebuilding meshes.
  const vec4 = (value) => ({ value, type: "vec4<f32>" });
  const minoUniforms = {
    uAdjacency: vec4(
      new Float32Array([
        links.left ? 1 : 0,
        links.right ? 1 : 0,
        links.top ? 1 : 0,
        links.bottom ? 1 : 0,
      ]),
    ),
    uDiagonalAdjacency: vec4(
      new Float32Array([
        links.topLeft ? 1 : 0,
        links.topRight ? 1 : 0,
        links.bottomRight ? 1 : 0,
        links.bottomLeft ? 1 : 0,
      ]),
    ),
    uBroken: vec4(
      new Float32Array([
        links.broken?.left ? 1 : 0,
        links.broken?.right ? 1 : 0,
        links.broken?.top ? 1 : 0,
        links.broken?.bottom ? 1 : 0,
      ]),
    ),
    uBaseColor: { value: rgb(color), type: "vec3<f32>" },
    uSkin: vec4(shaderSettings.sdfBlend),
    uPreviewRange: vec4(shaderSettings.previewRange),
    uCornerRadius: vec4(shaderSettings.cornerRadius),
    uNormalPreview: vec4(shaderSettings.normalPreview),
    uSdfStrength: vec4(shaderSettings.sdfStrength),
    uSdfDebug: vec4(shaderSettings.sdfDebug),
    uAlbedoDarkness: vec4(shaderSettings.albedoDarkness),
    uTransparency: vec4(shaderSettings.transparency),
    uFinalAlpha: vec4(shaderSettings.finalAlpha),
    uLight: vec4(shaderSettings.light),
    uNormalEnabled: vec4(shaderSettings.normalEnabled),
    uBevelWidth: vec4(shaderSettings.bevelWidth),
    uBevelHardness: vec4(shaderSettings.bevelHardness),
    uSpecularEnabled: vec4(shaderSettings.specularEnabled),
    uMetallic: vec4(shaderSettings.metallic),
    uSmoothness: vec4(shaderSettings.smoothness),
    uSpecularTint: vec4(shaderSettings.specularTint),
    uSpecularPower: vec4(shaderSettings.specularPower),
    uEdgeTone: vec4(shaderSettings.edgeTone),
    uEdgeWidth: vec4(shaderSettings.edgeWidth),
    uSelfEdgeTone: vec4(shaderSettings.selfEdgeTone),
    uSelfEdgeWidth: vec4(shaderSettings.selfEdgeWidth),
    uBrokenEdgeTone: vec4(shaderSettings.brokenEdgeTone),
    uBrokenEdgeWidth: vec4(shaderSettings.brokenEdgeWidth),
    uBrokenEdgeOffset: vec4(shaderSettings.brokenEdgeOffset),
    uBrokenDistortion: vec4(shaderSettings.brokenDistortion),
    uBrokenNoiseScale: vec4(shaderSettings.brokenNoiseScale),
    uBrokenSdfBlend: vec4(shaderSettings.brokenSdfBlend),
    uReflectionEnabled: vec4(shaderSettings.reflectionEnabled),
    uReflectionOffset: vec4(shaderSettings.reflectionOffset),
    uReflectionDownsample: vec4(shaderSettings.reflectionDownsample),
    uSceneSize: vec4(shaderSettings.sceneSize),
  };
  const shader = PIXI.Shader.from({
    gl: { vertex: source.vertex, fragment: source.fragment },
    resources: {
      minoUniforms,
      uNoiseTexture: shaderSettings.noiseTexture.source,
      uReflectionTexture: shaderSettings.reflectionTexture.source,
      uBevelProfile: shaderSettings.bevelProfile.texture.source,
      uTransparencyCurve: shaderSettings.transparencyCurve.texture.source,
      uFinalAlphaCurve: shaderSettings.finalAlphaCurve.texture.source,
      uMetallicCurve: shaderSettings.metallicCurve.texture.source,
    },
  });
  shaderCache.set(cacheKey, shader);
  return shader;
};
