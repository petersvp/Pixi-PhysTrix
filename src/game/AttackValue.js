// Shared PVP attack calculation. The returned value is the number of
// incoming garbage/attachment/mino-drop units, after room multipliers.
const COMBO_ATTACK_BONUSES = Object.freeze([0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);

export function comboAttackBonus(combo = 0) {
  const index = Math.max(0, Math.floor(Number(combo) || 0));
  return COMBO_ATTACK_BONUSES[index] ?? 5;
}

export function isDifficultClear(lines = 0, spin = "") {
  return Math.floor(Number(lines) || 0) >= 4 || Boolean(spin);
}

export function attackValue({
  lines = 0,
  miniTSpin = false,
  miniTSpinDouble = false,
  combo = 0,
  backToBack = false,
  bounty = 1,
  setting = 1,
} = {}) {
  const count = Math.max(0, Math.floor(Number(lines) || 0));
  const base = miniTSpinDouble
    ? 2
    : miniTSpin
      ? 1
      : count <= 1
        ? 0
        : count === 2
          ? 1
          : count === 3
            ? 2
            : count === 4
              ? 4
              : count * 1.5;
  const raw = base + comboAttackBonus(combo) + (backToBack ? 1 : 0);
  return Math.max(0, Math.floor(raw * (Number(bounty) || 1) * (Number(setting) || 1)));
}

export const ATTACK_VALUE_RULES = Object.freeze({
  miniTSpinSingle: 1,
  miniTSpinDouble: 2,
  single: 0,
  double: 1,
  triple: 2,
  tetris: 4,
  overTetrisMultiplier: 1.5,
});

export function pmOrderAttackValue(lines, spin, pvp = {}, combo = 0, backToBack = false) {
  if (pvp.pmOrderAttack === false) return 0;
  const bounty = pvp.bounty === false ? 1 : Number(pvp.bountyMultiplier) || 1;
  // PM Order attaches two minos per earned attack point by default. The room
  // setting remains an explicit strength multiplier for custom matches.
  const configuredMultiplier = Number(pvp.pmOrderMultiplier);
  const setting = Number.isFinite(configuredMultiplier) ? configuredMultiplier : 2;
  return attackValue({
    lines,
    miniTSpin: spin === "T-SPIN MINI" && lines === 1,
    miniTSpinDouble: spin === "T-SPIN MINI" && lines >= 2,
    combo,
    backToBack,
    bounty,
    setting,
  });
}

// God Essence is earned from the same unmodified attack result. PM Order's
// multiplier only controls the number of attachments; it must not make the
// player's own Essence generation stronger or weaker.
export function godEssenceValue(lines, spin, pvp = {}, combo = 0, backToBack = false) {
  if (pvp.godEssence === false) return 0;
  const bounty = pvp.bounty === false ? 1 : Number(pvp.bountyMultiplier) || 1;
  return attackValue({
    lines,
    miniTSpin: spin === "T-SPIN MINI" && lines === 1,
    miniTSpinDouble: spin === "T-SPIN MINI" && lines >= 2,
    combo,
    backToBack,
    bounty,
    setting: Number.isFinite(Number(pvp.godEssenceMultiplier))
      ? Number(pvp.godEssenceMultiplier)
      : 1,
  });
}

export function minoDropAttackValue(lines, spin, pvp = {}, combo = 0, backToBack = false) {
  if (pvp.minoDropsAttack === false) return 0;
  const bounty = pvp.bounty === false ? 1 : Number(pvp.bountyMultiplier) || 1;
  return attackValue({
    lines,
    miniTSpin: spin === "T-SPIN MINI" && lines === 1,
    miniTSpinDouble: spin === "T-SPIN MINI" && lines >= 2,
    combo,
    backToBack,
    bounty,
    setting: Number.isFinite(Number(pvp.minoDropsMultiplier))
      ? Number(pvp.minoDropsMultiplier)
      : 1,
  });
}
