/**
 * Captures only rendered minos into a multisampled scene texture each frame.
 * The mino shader samples this texture for its local reflection contribution.
 * Capture disables reflection temporarily to prevent a texture feedback loop.
 * UI, board, ghost, and effects remain excluded from the reflection source.
 */

import { shaderSettings } from "./ShaderSettings.js";

export class ReflectionCapture {
  constructor(app, root, sources) {
    this.app = app;
    this.root = root;
    this.sources = sources;
    this.resize();
  }

  resize() {
    this.factor = Math.max(
      1,
      Math.round(shaderSettings.reflectionDownsample[0]),
    );
    const width = Math.ceil(900 / this.factor);
    const height = Math.ceil(700 / this.factor);
    if (this.texture) this.texture.resize(width, height);
    // Pixi v8 uses a string MSAA quality instead of PIXI.MSAA_QUALITY.HIGH.
    else
      this.texture = PIXI.RenderTexture.create({
        width,
        height,
        resolution: 1,
        multisample: "high",
      });
    shaderSettings.reflectionTexture = this.texture;
    shaderSettings.sceneSize.set([900, 700, 0, 0]);
  }

  update() {
    if (
      this.factor !==
      Math.max(1, Math.round(shaderSettings.reflectionDownsample[0]))
    )
      this.resize();
    const original = shaderSettings.reflectionEnabled[0];
    shaderSettings.reflectionEnabled[0] = 0;
    const rootX = this.root.x;
    const rootY = this.root.y;
    const rootScaleX = this.root.scale.x;
    const rootScaleY = this.root.scale.y;
    this.root.position.set(0, 0);
    this.root.scale.set(1, 1);
    const states = this.root.children.map((child) => child.visible);
    this.root.children.forEach((child) => {
      child.visible = this.sources.includes(child);
    });
    this.app.renderer.render({
      container: this.root,
      target: this.texture,
      clear: true,
    });
    this.root.children.forEach((child, index) => {
      child.visible = states[index];
    });
    this.root.position.set(rootX, rootY);
    this.root.scale.set(rootScaleX, rootScaleY);
    shaderSettings.reflectionEnabled[0] = original;
  }

  destroy() {
    this.texture?.destroy(true);
  }
}
