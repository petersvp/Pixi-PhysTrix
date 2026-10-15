// Converts an attack value into independent falling-mino states. Each attack
// point makes two rolls. A lane may receive up to three rolls; those rolls
// represent the same mino's health instead of stacking multiple minos there.
export const planMinoDrops = (attackValue, width, random = Math.random, resilient = false) => {
  const columns = Math.max(1, Math.floor(Number(width) || 1));
  const rolls = Math.min(
    columns * 3,
    Math.max(0, Math.floor(Number(attackValue) || 0)) * 2,
  );
  const hits = Array(columns).fill(0);
  for (let roll = 0; roll < rolls; roll += 1) {
    const available = hits
      .map((count, column) => ({ count, column }))
      .filter(({ count }) => count < 3);
    if (!available.length) break;
    const upgradeable = available.filter(({ count }) => count > 0);
    const fresh = available.filter(({ count }) => count === 0);
    // A drop already chosen for this attack is normally strengthened instead
    // of starting another drop.  The remaining chance keeps a batch spread
    // across the field, while the per-lane limit still prevents level four.
    const pool =
      upgradeable.length && (!fresh.length || random() < 0.8)
        ? upgradeable
        : fresh.length
          ? fresh
          : upgradeable;
    const picked = pool[Math.floor(random() * pool.length)];
    hits[picked.column] += 1;
  }
  return hits
    .map((hitsAtColumn, x) => ({ x, hits: hitsAtColumn }))
    .filter(({ hits }) => hits > 0)
    .map(({ x, hits }) => ({
      x,
      material: hits === 1 ? "attachment" : "metal",
      metalLives: hits === 1 ? undefined : hits,
      broken: hits === 2,
      resilient: Boolean(resilient),
    }));
};
