// AFK auto-fire tunables (Tech.md §4: src/data/ owns every tunable number).

// Metres from a target's placement position (data/targets.js) within which
// the "Press E to AFK Here" prompt appears and E is allowed to start AFK.
export const AFK_RANGE = 4.5

export const AFK_INTERACT_KEY = 'KeyE'

// Per-target AFK config, keyed by data/targets.js prop id (collection
// `Targets`). While AFK-locked onto a target the beam auto-fires at its top
// area — the aim point, customizable per id in data/targets.js
// TARGET_AIM_OFFSET — and every Action's Power is overridden to
//   powerPerAction * (rebirth + 1) * multiplier
// where `multiplier` is the "xN" tier below (see afkPowerMultiplier: "x0" or
// any non-positive value collapses to 1x). `rebirthRequired` is the minimum
// player rebirth (store/useGameStore.js) for E to start AFK on that target —
// below it the HUD shows the requirement instead of the prompt. `powerColorTop`
// / `powerColorBottom` optionally override the "xN Power" label's gradient,
// and `rebirthColorTop` / `rebirthColorBottom` do the same independently for
// the "Rebirth Required" label (both pairs default in
// components/AfkTargetLabel.jsx — omit either pair to use its default).
//
// `winsRequired`, where present, gates the target behind a one-time Wins
// purchase (store/useGameStore.js ownedTargets/buyTarget) on top of the
// rebirth gate: holding E there before it's owned opens a Buy popup
// (systems/afk.js afkState.purchaseRequestedId -> components/hud/Hud.jsx
// TargetPurchaseWindow) instead of starting AFK — see systems/interact.js.
// Omit it (or leave undefined) for a target that's free once its
// rebirthRequired is met, same as every entry below except the two
// centrepiece targets.
export const AFK_TARGET_CONFIG = {
  target_grey: { power: 'x1', rebirthRequired: 0 },
  target_yellow: { power: 'x1', rebirthRequired: 0 },
  target_red: { power: 'x2', rebirthRequired: 2 },
  triple_target_grey: { power: 'x4', rebirthRequired: 4 },
  target_tan: { power: 'x6', rebirthRequired: 6 },
  target_blue: { power: 'x10', rebirthRequired: 10 },
  triple_target_gold: { power: 'x15', rebirthRequired: 15 },
  grand_gold_multi_target: { power: 'x0', rebirthRequired: 0, winsRequired: 40000 },
  vortex_target: { power: 'x0', rebirthRequired: 0, winsRequired: 20000 },
}

// "xN" tier string (or a bare number) -> the multiplier actually applied to
// each AFK Action's Power. Per the spec's "power (count; if it's 0 then 1)",
// "x0" and anything non-positive collapse to 1x (no multiplier).
export function afkPowerMultiplier(power) {
  const n = typeof power === 'string' ? parseInt(power.replace(/^x/i, ''), 10) : Number(power)
  return Number.isFinite(n) && n > 0 ? n : 1
}

// Metres above a target's aim point (data/targets.js TARGET_AIM_OFFSET) at
// which its floating Power / Rebirth-required sign sits — same idea as
// components/HexPowerPadLabel.jsx's LABEL_HEIGHT. Tune here.
export const AFK_LABEL_HEIGHT = 1.1
