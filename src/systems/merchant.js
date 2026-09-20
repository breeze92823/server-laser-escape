// Merchant shop proximity (Tech.md §5.1 style: framework-free, mutable
// singleton, stepped once per frame from GameLoop). Near the AURA stall's
// counter the HUD prompts "Press E to Aura" (components/hud/Hud.jsx polls
// merchantState.near); holding E there for systems/interactHold.js's
// HOLD_MS opens the Aura popup — systems/interact.js sets
// openAuraRequested below once that hold completes.
//
// Opening a React panel isn't state this framework-free system can drive
// directly (unlike hexPowerPad.js/afk.js, which just call store actions), so
// completing the hold here only raises an edge flag; Hud.jsx's
// LeftCenterControls polls and clears it, same throttled pattern it already
// uses to read this state's `near` for the prompt text.
import { player } from './playerState.js'
import { MERCHANT_PROMPT_POSITION, MERCHANT_RANGE } from '../data/merchantShop.js'

export const merchantState = {
  near: false, // within MERCHANT_RANGE of the counter this frame
  openAuraRequested: false, // edge-triggered by a completed hold; consumer clears it after acting
}

export function step() {
  const p = player.position
  const dx = p.x - MERCHANT_PROMPT_POSITION[0]
  const dy = p.y - MERCHANT_PROMPT_POSITION[1]
  const dz = p.z - MERCHANT_PROMPT_POSITION[2]
  merchantState.near = dx * dx + dy * dy + dz * dz <= MERCHANT_RANGE * MERCHANT_RANGE
}
