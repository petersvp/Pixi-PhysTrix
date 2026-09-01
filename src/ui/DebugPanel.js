/**
 * Provides the Skin Editor for shared mino material settings.
 * It edits live typed uniform arrays used by every active shader instance.
 * Curves are authored in fixed slots and serialized with their mode/resolution.
 * Imported skins are validated, reset to defaults, then merged atomically.
 * Physics fracture flags drive the optional broken-edge material controls.
 */

import {
  exportSkin,
  loadSkin,
  shaderSettings,
} from "../render/ShaderSettings.js";

export class DebugPanel {
  constructor(material = shaderSettings) {
    this.element = document.createElement("aside");
    this.refreshers = [];
    this.element.className = "shader-debug-panel";
    document.body.appendChild(this.element);
    this.setMaterial(material);
  }

  // The editor is an inspector, not material ownership. Rebuild its small DOM
  // control tree when the selected Playfield changes so closures never retain
  // stale uniform arrays from a disposed scene.
  setMaterial(material = shaderSettings) {
    this.material = material;
    this.refreshers = [];
    this.element.replaceChildren();
    this.build();
  }

  build() {
    const heading = document.createElement("h2");
    heading.textContent = "Skin Editor";

    this.element.append(heading);
    this.addSkinButtons();
    this.addSection("SDF");
    this.addSlider("A1 / A2 Blend", this.material.sdfBlend, 0, 1, 0.01);
    this.addSlider(
      "SDF Corner Radius",
      this.material.cornerRadius,
      0.001,
      0.999,
      0.001,
    );
    this.addSlider("SDF Strength", this.material.sdfStrength, 0, 3, 0.01);
    this.addToggle("SDF Debug", this.material.sdfDebug);
    this.addSection("Albedo");
    this.addCurve("Transparency", this.material.transparencyCurve);
    this.addCurve("Final Alpha", this.material.finalAlphaCurve);
    this.addSection("Edges");
    this.addSlider("Edge Tone", this.material.edgeTone, -1, 1, 0.01);
    this.addSlider("Edge Width", this.material.edgeWidth, 0.005, 1, 0.005);
    this.addSlider("Self Edge Tone", this.material.selfEdgeTone, -1, 1, 0.01);
    this.addSlider(
      "Self Edge Width",
      this.material.selfEdgeWidth,
      0.005,
      1,
      0.005,
    );
    this.addSlider(
      "Broken Edge Tone",
      this.material.brokenEdgeTone,
      -1,
      1,
      0.01,
    );
    this.addSlider(
      "Broken Edge Width",
      this.material.brokenEdgeWidth,
      0.005,
      1,
      0.005,
    );
    this.addSlider(
      "Broken Edge Offset",
      this.material.brokenEdgeOffset,
      0,
      1,
      0.005,
    );
    this.addSlider(
      "Broken Distortion",
      this.material.brokenDistortion,
      0,
      2,
      0.01,
    );
    this.addSlider(
      "Broken Noise Scale",
      this.material.brokenNoiseScale,
      0.1,
      32,
      0.1,
    );
    this.addSlider(
      "Broken A1 Border Blend",
      this.material.brokenSdfBlend,
      0,
      1,
      0.01,
    );
    this.addSection("Lighting");
    this.addSlider("Light X", this.material.light, -1, 1, 0.01, 0);
    this.addSlider("Light Y", this.material.light, -1, 1, 0.01, 1);
    this.addSlider("Light Z", this.material.light, -1, 1, 0.01, 2);
    this.addSection("Normal");
    this.addToggle("Normal", this.material.normalEnabled);
    this.addToggle("Normal Preview", this.material.normalPreview);
    this.addSlider("Bevel Width", this.material.bevelWidth, 0.01, 4, 0.01);
    this.addSlider(
      "Bevel Hardness",
      this.material.bevelHardness,
      0.1,
      10,
      0.01,
    );
    this.addCurve("Bevel Profile", this.material.bevelProfile);
    this.addSection("Specular");
    this.addToggle("Specular", this.material.specularEnabled);
    this.addSlider("Metallic", this.material.metallic, 0, 1, 0.01);
    this.addSlider("Smoothness", this.material.smoothness, 0, 1, 0.01);
    this.addSlider("Specular Tint", this.material.specularTint, 0, 1, 0.01);
    this.addSlider("Specular Power", this.material.specularPower, 1, 256, 1);
    this.addCurve("Metallic", this.material.metallicCurve);
    this.addSection("Reflection");
    this.addToggle("Reflection", this.material.reflectionEnabled);
    this.addSlider(
      "Reflection X",
      this.material.reflectionOffset,
      -128,
      128,
      1,
      0,
    );
    this.addSlider(
      "Reflection Y",
      this.material.reflectionOffset,
      -128,
      128,
      1,
      1,
    );
    this.addSlider(
      "Reflection Downsample",
      this.material.reflectionDownsample,
      1,
      16,
      1,
    );
  }

  addSection(titleText) {
    const title = document.createElement("h3");
    title.textContent = titleText;
    this.element.appendChild(title);
  }

  addSkinButtons() {
    const save = document.createElement("button");
    const load = document.createElement("button");
    const file = document.createElement("input");
    save.textContent = "Save Skin";
    load.textContent = "Load Skin";
    file.type = "file";
    file.accept = "application/json";
    file.hidden = true;
    save.addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify(exportSkin(this.material), null, 2)], {
          type: "application/json",
        }),
      );
      link.download = "phystix-skin.json";
      link.click();
      URL.revokeObjectURL(link.href);
    });
    load.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      try {
        const applied = loadSkin(
          JSON.parse(await file.files[0].text()),
          this.material,
        );
        this.refreshers.forEach((refresh) => refresh());
        console.info(`Skin loaded: ${applied} recognized settings applied.`);
      } catch (error) {
        loadSkin(null, this.material);
        this.refreshers.forEach((refresh) => refresh());
        console.warn(
          "Skin JSON could not be read; defaults were retained.",
          error,
        );
      }
      file.value = "";
    });
    this.element.append(save, load, file);
  }

  addSlider(titleText, target, min, max, step, component = 0) {
    const label = document.createElement("label");
    const title = document.createElement("span");
    const slider = document.createElement("input");
    const value = document.createElement("output");
    title.textContent = titleText;
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    const sync = () => {
      slider.value = String(target[component]);
      value.value = target[component].toFixed(step < 0.01 ? 3 : 2);
    };
    slider.addEventListener("input", () => {
      target[component] = Number(slider.value);
      sync();
    });
    label.append(title, slider, value);
    this.element.appendChild(label);
    sync();
    this.refreshers.push(sync);
  }

  addToggle(titleText, target) {
    const label = document.createElement("label");
    const title = document.createElement("span");
    const input = document.createElement("input");
    title.textContent = titleText;
    input.type = "checkbox";
    input.checked = target[0] > 0.5;
    input.addEventListener("change", () => {
      target[0] = input.checked ? 1 : 0;
    });
    label.append(title, input, document.createElement("output"));
    this.element.appendChild(label);
    this.refreshers.push(() => {
      input.checked = target[0] > 0.5;
    });
  }

  addCurve(titleText, curve) {
    const title = document.createElement("strong");
    const header = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 276;
    canvas.height = 72;
    canvas.className = "curve-editor";
    title.textContent = titleText;
    header.className = "curve-header";
    const controls = document.createElement("div");
    const resolutionGroup = document.createElement("div");
    const modeGroup = document.createElement("div");
    resolutionGroup.className = "curve-button-group";
    modeGroup.className = "curve-button-group";
    const resolutionButtons = [];
    const modeButtons = [];
    [2, 8, 16, 32].forEach((resolution) => {
      const button = document.createElement("button");
      button.textContent = resolution;
      button.addEventListener("click", () => {
        curve.setResolution(resolution);
        draw();
        refresh();
      });
      resolutionButtons.push(button);
      resolutionGroup.appendChild(button);
    });
    [
      ["L", "linear"],
      ["S", "smooth"],
      ["H", "hold"],
    ].forEach(([label, mode]) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("click", () => {
        curve.mode = mode;
        curve.update();
        draw();
        refresh();
      });
      modeButtons.push(button);
      modeGroup.appendChild(button);
    });
    controls.append(resolutionGroup, modeGroup);
    header.append(title, controls);
    const draw = () => {
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#1a5278";
      context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
      context.strokeStyle = "#65d8ff";
      context.beginPath();
      for (let x = 0; x < canvas.width; x += 1) {
        const y =
          (1 - curve.sample(x / (canvas.width - 1))) * (canvas.height - 1);
        x ? context.lineTo(x, y) : context.moveTo(x, y);
      }
      context.stroke();
      context.fillStyle = "#ffffff";
      curve.points.forEach((value, index) => {
        if (value == null) return;
        const x = (index * (canvas.width - 1)) / (curve.points.length - 1);
        context.fillRect(x - 2, (1 - value) * (canvas.height - 1) - 2, 4, 4);
      });
    };
    const paint = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const slot = Math.round((x / rect.width) * (curve.points.length - 1));
      if (event.buttons === 2 && slot !== 0 && slot !== curve.points.length - 1)
        curve.points[slot] = null;
      else
        curve.points[slot] = Math.max(
          0,
          Math.min(1, 1 - (event.clientY - rect.top) / rect.height),
        );
      curve.update();
      draw();
    };
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      paint(event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.buttons) paint(event);
    });
    const refresh = () => {
      resolutionButtons.forEach((button, index) =>
        button.classList.toggle(
          "active",
          curve.points.length === [2, 8, 16, 32][index],
        ),
      );
      modeButtons.forEach((button, index) =>
        button.classList.toggle(
          "active",
          curve.mode === ["linear", "smooth", "hold"][index],
        ),
      );
    };
    this.element.append(header, canvas);
    draw();
    refresh();
    this.refreshers.push(() => {
      draw();
      refresh();
    });
  }

  destroy() {
    this.element.remove();
  }

  setVisible(value) {
    this.element.hidden = !value;
  }
}
