/**
 * Loads external GLSL mino shaders before gameplay constructs mino meshes.
 * Browser ES modules cannot import GLSL source files directly.
 * The loaded source is cached for every later Pixi shader instance.
 * Shader logic remains in the dedicated GLSL files for direct editing.
 */

let minoSources = null;

export const loadMinoShaderSources = async () => {
  if (minoSources) return minoSources;
  try {
    const load = async (name) => {
      const response = await fetch(new URL(`./${name}`, import.meta.url), {
        cache: "no-store",
      });
      if (!response.ok) {
        console.error("[ShaderSources] Unable to load shader source.", {
          name,
          status: response.status,
        });
        return null;
      }
      return response.text();
    };
    const [vertex, fragment] = await Promise.all([
      load("mino.vert.glsl"),
      load("mino.frag.glsl"),
    ]);
    if (!vertex || !fragment) return null;
    minoSources = { vertex, fragment };
  } catch (error) {
    console.error("[ShaderSources] Shader source loading failed.", error);
    return null;
  }
  return minoSources;
};

export const getMinoShaderSources = () => {
  if (!minoSources)
    console.error("[ShaderSources] Mino shader sources are not ready.");
  return minoSources;
};
