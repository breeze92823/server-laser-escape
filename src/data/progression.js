// Progression balance constants (Tech.md §4: src/data/ owns every tunable
// number). Pure constants and pure functions of primitives only — no React,
// no store import — so both the store and the HUD can depend on this without
// depending on each other.

// Vite only exposes VITE_-prefixed vars, and always as strings, so an
// override needs explicit numeric parsing with a fallback to the hardcoded
// default when the var is unset, blank, or not a number (same override
// pattern as SERVER_URL in data/net.js).
export function envInt(name, fallback) {
  const raw = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export const POWER_INITIAL = envInt('VITE_POWER_INITIAL', 1)
export const POWER_MIN = 1
export const POWER_MAX = 1_000_000_000_000

export const LEVEL_INITIAL = 1
export const LEVEL_MIN = 1
export const LEVEL_MAX = 50_000
export const POWER_PER_LEVEL = 50 // level = floor(power / POWER_PER_LEVEL) + 1

export const REBIRTH_INITIAL = envInt('VITE_REBIRTH_INITIAL', 0)
export const REBIRTH_MIN = 0
export const REBIRTH_MAX = 5000
export const REBIRTH_LEVEL_STEP = 10 // requirement(rebirth) = (rebirth + 1) * REBIRTH_LEVEL_STEP

export const WINS_INITIAL = envInt('VITE_WINS_INITIAL', 0)
export const WINS_MIN = 0
export const WINS_MAX = 1_000_000_000_000

export const POWER_PER_ACTION_INITIAL = 1
export const POWER_PER_ACTION_MIN = 1
export const POWER_PER_ACTION_MAX = 3500

// A continuous hold re-fires an Action every this-many seconds.
export const ACTION_HOLD_INTERVAL = 1

export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n
}

export function levelForPower(power) {
  return clamp(Math.floor(power / POWER_PER_LEVEL) + 1, LEVEL_MIN, LEVEL_MAX)
}

export function rebirthRequirement(rebirth) {
  return (rebirth + 1) * REBIRTH_LEVEL_STEP
}

// Where the given Power sits inside its current level, for the HUD level bar:
// `into` Power earned toward `span` (POWER_PER_LEVEL) needed for the next level,
// and `frac` (0..1) for the fill width. `total` is the player's whole Power and
// `needed` the whole-Power threshold that trips the next level, so the bar can
// read cumulative ("123 / 150") instead of within-level. At LEVEL_MAX the bar
// reads full and `needed` equals `total`.
export function levelProgress(power) {
  const level = levelForPower(power)
  const total = Math.floor(power)
  if (level >= LEVEL_MAX) {
    return {
      level,
      into: POWER_PER_LEVEL,
      span: POWER_PER_LEVEL,
      frac: 1,
      total,
      needed: total,
    }
  }
  const into = Math.floor(power - (level - LEVEL_MIN) * POWER_PER_LEVEL)
  return {
    level,
    into,
    span: POWER_PER_LEVEL,
    frac: clamp(into / POWER_PER_LEVEL, 0, 1),
    total,
    needed: (level - LEVEL_MIN + 1) * POWER_PER_LEVEL,
  }
}

// The single source of truth for rebirth eligibility — the store's guard and
// the HUD button's visibility check both call this, so they can never disagree.
export function canAcceptRebirth(level, rebirth) {
  return rebirth < REBIRTH_MAX && level >= rebirthRequirement(rebirth)
}
