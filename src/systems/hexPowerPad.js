// Hex power pad buy/equip (Tech.md §5.1 style: framework-free, mutable
// singleton, stepped once per frame from GameLoop). Near a pad, the HUD
// prompts "Press E to Buy Laser" or "Press E to Equip Laser"
// (components/hud/Hud.jsx polls hexPowerPadState.nearIndex against the
// store); holding E there for systems/interactHold.js's HOLD_MS buys or
// equips it — systems/interact.js calls interactWithNearestPad() below once
// that hold completes. step() itself only computes proximity now.
import { player } from './playerState.js'
import { useGameStore } from '../store/useGameStore.js'
import { playPowerGainPop } from './sfx.js'
import { HEX_POWER_PAD_POSITIONS, HEX_POWER_PAD_TIERS, HEX_POWER_PAD_RANGE } from '../data/hexPowerPad.js'

export const hexPowerPadState = {
  nearIndex: null, // index of the nearest pad within HEX_POWER_PAD_RANGE this frame, or null
}

function findNearestPadInRange() {
  const p = player.position
  let bestIndex = null
  let bestDistSq = HEX_POWER_PAD_RANGE * HEX_POWER_PAD_RANGE
  for (let i = 0; i < HEX_POWER_PAD_POSITIONS.length; i++) {
    const pos = HEX_POWER_PAD_POSITIONS[i]
    const dx = p.x - pos[0]
    const dy = p.y - pos[1]
    const dz = p.z - pos[2]
    const distSq = dx * dx + dy * dy + dz * dz
    if (distSq <= bestDistSq) {
      bestDistSq = distSq
      bestIndex = i
    }
  }
  return bestIndex
}

export function step() {
  hexPowerPadState.nearIndex = findNearestPadInRange()
}

// Called by systems/interact.js once a hold against this pad's zone
// completes. Does nothing if the pad is already equipped, or the player
// can't yet afford it — same "consume on zone entry, not on effect" shape
// the old edge-triggered version had. Reuses sfx.js's power-gain "pop" for
// an actual buy or equip, same confirmation sound the "+N" popups already
// use — nothing plays when the hold completes but neither branch fires.
export function interactWithNearestPad() {
  const index = hexPowerPadState.nearIndex
  if (index === null) return

  const state = useGameStore.getState()
  if (state.ownedHexPads.has(index)) {
    if (state.equippedHexPad !== index) {
      state.equipHexPad(index)
      playPowerGainPop()
    }
  } else {
    const tier = HEX_POWER_PAD_TIERS[index]
    if (tier && state.wins >= tier.winsRequired) {
      state.buyHexPad(index)
      playPowerGainPop()
    }
  }
}
