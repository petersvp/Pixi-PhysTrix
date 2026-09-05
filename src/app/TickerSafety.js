// Pixi ticker listeners execute inside requestAnimationFrame. Reject corrupt
// timing values before they can keep a finite animation alive indefinitely.
export const MAX_TICKER_DELTA_MS = 1000;

export const safeTickerDelta = (deltaMS, label) => {
  if (!Number.isFinite(deltaMS) || deltaMS < 0) {
    console.error(`[Ticker] Ignoring invalid delta for ${label}.`, { deltaMS });
    return null;
  }
  if (deltaMS > MAX_TICKER_DELTA_MS) {
    console.warn(`[Ticker] Capping delayed frame for ${label}.`, { deltaMS });
    return MAX_TICKER_DELTA_MS;
  }
  return deltaMS;
};
