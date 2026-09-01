/**
 * Describes supported player modes independently of gameplay modes.
 *
 * This module is part of the player layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

/**
 * Player modes are deliberately separate from gameplay modes.  The currently
 * shipped games are 1P; the descriptors reserve a stable extension point for
 * versus/co-op without coupling them to Classic or Physics rules.
 */
export const playerModeDescriptors = {
  "1p": { players: 1, implementation: "single-board" },
  "2p-vs": { players: 2, implementation: "versus" },
  "2p-coop": { players: 2, implementation: "co-op" },
};
