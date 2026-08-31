/**
 * Provides common Pixi rendering utilities used by game UI and renderers.
 *
 * This module is part of the render layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { COLORS } from "../config/colors.js";

export const makeLabel = (text, size = 16, color = COLORS.WHITE) =>
  new PIXI.Text({
    text,
    style: {
      fontFamily: "Quantico, sans-serif",
      fontSize: size,
      fontWeight: "bold",
      fill: color,
      align: "center",
    },
  });
