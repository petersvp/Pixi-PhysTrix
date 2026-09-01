/**
 * Loads external GLSL mino shaders before gameplay constructs mino meshes.
 * Browser ES modules cannot import GLSL source files directly.
 * The loaded source is cached for every later Pixi shader instance.
 * Shader logic remains in the dedicated GLSL files for direct editing.
 */

let minoSources = null;

export const loadMinoShaderSources = async () => {
  if (minoSources) return minoSources;
  const load = (name) =>
    fetch(new URL(`./${name}`, import.meta.url), { cache: "no-store" }).then(
      (response) => {
        if (!response.ok)
          throw new Error(`Unable to load shader source: ${name}`);
        return response.text();
      },
    );
  const [vertex, fragment] = await Promise.all([
    load("mino.vert.glsl"),
    load("mino.frag.glsl"),
  ]);
  minoSources = { vertex, fragment };
  return minoSources;
};

export const getMinoShaderSources = () => {
  if (!minoSources)
    throw new Error(
      "Mino shader sources were not loaded before gameplay started.",
    );
  return minoSources;
};
