// Owns the live copy of the kinematic collider's AABB list (Tech.md §5.1
// style: framework-free, mutable module state). Starts as a copy of
// data/hub.js's static HUB_AABBS; systems/wallHealth.js calls removeAabb()
// on the rare event a wall is destroyed, so getAabbs() stays a cached array
// reference the rest of the time — no per-frame allocation on the hot path.
import { HUB_AABBS, HUB_POLYGONS, HUB_RINGS } from '../data/hub.js'
import { PVP_WALL_AABB } from '../data/pvpWall.js'
import { useGameStore } from '../store/useGameStore.js'

// pvp_wall (data/pvpWall.js's "UNLOCKABLE ON REBIRTH 1" sign) is deliberately
// left out of HUB_AABBS itself (data/hub.js) — whether it blocks movement
// depends on live store state, not the static layout. Kept as a second
// cached variant of liveAabbs (with the gate box appended) so getAabbs() can
// pick one or the other with a plain reference read, same "no per-frame
// allocation" contract as liveAabbs above; only rebuilt when liveAabbs itself
// changes (removeAabb/resetAabbs), not every frame.
const PVP_GATE_AABB = { id: 'pvp_wall', ...PVP_WALL_AABB }

let liveAabbs = HUB_AABBS.slice()
let liveAabbsGateClosed = [...liveAabbs, PVP_GATE_AABB]

function rebuildGateVariant() {
  liveAabbsGateClosed = [...liveAabbs, PVP_GATE_AABB]
}

// The zone opens at rebirth 1 and stays open for every rebirth after that
// (data/pvpWall.js's sign text: "UNLOCKABLE ON REBIRTH 1") — rebirth 0 is the
// only locked-out case.
export function getAabbs() {
  return useGameStore.getState().rebirth >= 1 ? liveAabbs : liveAabbsGateClosed
}

// The convex-polygon collider list (data/hub.js's HUB_POLYGONS — currently
// just data/pvpCenterPentagon.js's pentagon stack) never grows/shrinks at
// runtime the way HUB_AABBS does, so it's exposed as-is with no live-copy or
// remove/reset machinery to match.
export function getPolys() {
  return HUB_POLYGONS
}

// Same story as getPolys(): data/hub.js's HUB_RINGS (currently just
// data/pvpCenterPentagon.js's cylinder shell) is static forever.
export function getRings() {
  return HUB_RINGS
}

export function removeAabb(id) {
  liveAabbs = liveAabbs.filter((a) => a.id !== id)
  rebuildGateVariant()
}

// Bring every collider back — used by the win-panel respawn
// (systems/glowFloorPanel.js) to undo the removeAabb() calls destroyed walls
// made. Cheap: one slice, same as boot.
export function resetAabbs() {
  liveAabbs = HUB_AABBS.slice()
  rebuildGateVariant()
}
