/**
 * Converts a chain length into its display label.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

const lineClearNames = [
  "",
  "SINGLE",
  "DOUBLE",
  "TRIPLE",
  "PHYSTRIX",
  "PENTATRIX",
  "HEXATRIX",
  "HEPTATRIX",
  "OCTATRIX",
  "NONATRIX",
  "MEGATRIX", // 10
  "MEGATRIX", // 11
  "MEGATRIX", // 12
  "FATALIX", // 13
  "LEGENDTRIX", // 14
  "LEGENDTRIX", // 15
  "LEGENDTRIX", // 16
  "LEGENDTRIX", // 17
  "IMPOSTRIX", // 18
  "IMPOSTRIX", // 19
  "IMPOSTRIX", // 20
];
export const chainName = (count) =>
  lineClearNames[Math.min(20, count)] || `IMPOSTRIX`;
