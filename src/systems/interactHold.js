// Shared "hold E for HOLD_MS to confirm" gate for every proximity prompt
// that shows the keycap card (systems/afk.js's start-lock, systems/
// hexPowerPad.js's buy/equip, systems/merchant.js's aura) — one timer no
// matter which zone is near, since only one such prompt is ever visible at
// once (components/hud/Hud.jsx's InteractPrompt mirrors the same
// afk > hexPad > merchant priority systems/interact.js resolves a zoneKey
// with). Stepped once per frame from systems/interact.js; polled by Hud.jsx
// at ~10Hz (via InteractPrompt's setHoldProgress) to draw the fill ring.
export const HOLD_MS = 2000

export const interactHoldState = {
  active: false, // a hold is in progress against some zone this frame
  progress: 0, // 0..1 toward HOLD_MS
}

let ownerKey = null
let startedAt = 0

function reset() {
  ownerKey = null
  startedAt = 0
  interactHoldState.active = false
  interactHoldState.progress = 0
}

// zoneKey identifies the interactable currently in range (e.g. `afk:${id}`,
// `hexPad:${index}`, 'merchant'), or null when nothing eligible is near this
// frame. keyDown is whether the interact key is physically held right now
// (systems/input.js's isInteractKeyDown()). Returns true on the exact frame
// a continuous hold against the SAME zoneKey reaches HOLD_MS — the caller's
// cue to fire that zone's action, once. Releasing the key, or the zoneKey
// changing (walking from one prompt to another mid-hold), resets the timer
// to zero — there is no carrying partial progress between different actions,
// same as an early release visibly snapping the ring back to empty.
export function step(zoneKey, keyDown) {
  if (!zoneKey || !keyDown) {
    reset()
    return false
  }
  if (ownerKey !== zoneKey) {
    ownerKey = zoneKey
    startedAt = performance.now()
  }
  interactHoldState.active = true
  const elapsed = performance.now() - startedAt
  interactHoldState.progress = Math.min(1, elapsed / HOLD_MS)
  if (elapsed >= HOLD_MS) {
    reset()
    return true
  }
  return false
}
