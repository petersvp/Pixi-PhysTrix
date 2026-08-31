/**
 * Defines the finite states used by a gameplay session.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export const GameState = Object.freeze({
  START: "start",
  PLAYING: "playing",
  PAUSED: "paused",
  GAME_OVER: "gameover",
});
