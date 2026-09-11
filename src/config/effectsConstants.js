/**
 * Defines counts and timing values for procedural visual effects.
 * These values never affect collision, scoring, or simulation state.
 * Placement particles are distributed along exposed polyomino edges.
 * Clear particles are emitted separately for every vanished mino.
 * EffectsRenderer consumes these values through gameplay mode handlers.
 */

export const PLACEMENT_OUTLINE_PARTICLE_COUNT = 50;
export const CLEAR_PARTICLE_COUNT_PER_MINO = 25;
// Clear bursts use board axes; fracture bursts use each mino's rotated axes.
export const LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE = 3;
export const LINE_CLEAR_PARTICLE_VERTICAL_FORCE = 1.35;
export const MINO_BREAK_PARTICLE_HORIZONTAL_FORCE = 5;
export const MINO_BREAK_PARTICLE_VERTICAL_FORCE = 5;
// Glow treatment for minos awaiting a physics line-clear vanish.
export const MARKED_MINO_GLOW_DISTANCE = 12;
export const MARKED_MINO_GLOW_STRENGTH = 1.4;
export const MARKED_MINO_GLOW_QUALITY = 0.3;
export const MARKED_MINO_OUTLINE_LIGHTNESS = 0.45;
// Spins receive a distinct stronger outline burst as soon as they are detected.
export const SPIN_OUTLINE_PARTICLE_COUNT = 70;
export const SPIN_OUTLINE_PARTICLE_FORCE = 1.25;

// Cosmetic Playfield responses. Each preset is scale, local Y offset,
// rotation in radians, and duration in milliseconds. They never modify board
// coordinates, input, or the physics world.
export const PLAYFIELD_MATCH_PUNCH = Object.freeze({
  scale: 0,
  y: -5,
  rotation: 0,
  duration: 180,
});
export const PLAYFIELD_SPIN_PUNCH = Object.freeze({
  scale: 0,
  y: 0,
  rotation: 0.02,
  duration: 500,
});
export const PLAYFIELD_HARD_DROP_PUNCH = Object.freeze({
  scale: 0,
  y: 3,
  rotation: 0,
  duration: 160,
});
export const PLAYFIELD_LIFE_LOSS_PUNCH = Object.freeze({
  scale: 0.12,
  y: -12,
  rotation: 0.05,
  shake: 14,
  duration: 700,
  glowColor: 0xff2638,
  glowDistance: 20,
  glowStrength: 3,
  glowPulseCycles: 3,
  glowMinimumStrength: 0.15,
});
