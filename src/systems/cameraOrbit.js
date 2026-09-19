import { inputState } from './input.js'
import { player } from './playerState.js'

// Third-person follow with right-drag orbit + wheel zoom (Tech.md §5.2), plus
// a keyboard turn: A/D and the left/right arrows yaw the camera around the
// player at a constant rate instead of strafing (systems/input.js's `turn`),
// so W/S become "walk the way the camera's facing" rather than a fixed
// world-relative direction. No OrbitControls — left-click is the game's
// action verb.
const START_PITCH = 0.35 // radians above the horizon
const state = {
  yaw: 0, // radians; 0 puts the camera on +Z looking toward -Z
  pitch: START_PITCH,
  distance: 7,
}

const MIN_PITCH = -0.15
const MAX_PITCH = 1.3
const MIN_DIST = 3
const MAX_DIST = 14
const ORBIT_SENS = 0.005
const ZOOM_SENS = 0.01
const TURN_KEY_RATE = 2.4 // rad/s at sensitivity 1, A/D or arrow keys held

// Position and look-at ease at different rates — the look-at point tracks the
// player noticeably faster than the rig itself trails behind it, which reads
// as a third-person follow cam rather than a rigid mount. Also what smooths
// over playerMovement's stair step-up assist (systems/playerMovement.js
// STEP_HEIGHT), which snaps player.position.y in discrete jumps as the player
// crosses each tread — lookAt easing at its own rate absorbs that the same
// way the position lerp already absorbed X/Z jitter.
const POSITION_SMOOTHING = 12 // higher = snappier follow
const LOOK_SMOOTHING = 20

// A same-frame jump in the player's position bigger than this is a teleport
// (respawn, a win pad's trip home, death) rather than real movement — easing
// across that distance reads as an unwanted swoop across the map, so snap
// instead, and face behind the player the way a fresh spawn should rather
// than keeping whatever orbit angle was last set.
const TELEPORT_DISTANCE = 15

// Scratch, hoisted to module scope — zero allocation per frame (Tech.md §7).
const target = { x: 0, y: 0, z: 0 }
const lookAt = { x: 0, y: 0, z: 0 }
const lastTarget = { x: 0, y: 0, z: 0 }
let initialised = false

// Multiplier over the base sensitivities, driven by the portal's
// camera_sensitivity setting (0.1–5.0). 1 leaves the tuned feel untouched.
let sensitivity = 1

export function setSensitivity(mult) {
  sensitivity = Number.isFinite(mult) && mult > 0 ? mult : 1
}

export function getYaw() {
  return state.yaw
}

// Snaps the orbit to sit directly behind the player, e.g. right after a
// spawn/respawn — otherwise the camera keeps whatever angle it last had
// (default 0) while the player model faces player.facing, so the two visibly
// disagree the moment the player spawns in. Player forward is
// (sin(facing), cos(facing)) (see systems/laser.js's laser.start), and this
// camera sits opposite that, at +PI.
export function syncYawToPlayer() {
  state.yaw = player.facing + Math.PI
}

export function update(camera, dt) {
  // Consume drag + wheel accumulated by input.js.
  state.yaw -= inputState.look.dx * ORBIT_SENS * sensitivity
  state.pitch += inputState.look.dy * ORBIT_SENS * sensitivity
  inputState.look.dx = 0
  inputState.look.dy = 0

  // Held-key turn (not edge-triggered, so nothing to zero here): a continuous
  // yaw rate for as long as A/D or an arrow key is down.
  state.yaw -= inputState.turn * TURN_KEY_RATE * sensitivity * dt

  if (state.pitch < MIN_PITCH) state.pitch = MIN_PITCH
  if (state.pitch > MAX_PITCH) state.pitch = MAX_PITCH

  state.distance += inputState.zoom * ZOOM_SENS * sensitivity
  inputState.zoom = 0
  if (state.distance < MIN_DIST) state.distance = MIN_DIST
  if (state.distance > MAX_DIST) state.distance = MAX_DIST

  // Aim at the player's upper body.
  target.x = player.position.x
  target.y = player.position.y + player.dims.height * 0.6
  target.z = player.position.z

  const jump = Math.hypot(target.x - lastTarget.x, target.y - lastTarget.y, target.z - lastTarget.z)
  const teleported = initialised && jump > TELEPORT_DISTANCE
  lastTarget.x = target.x
  lastTarget.y = target.y
  lastTarget.z = target.z

  if (teleported) {
    // A fresh spawn should be looked at dead-on, not from whatever angle the
    // camera happened to be at before the teleport.
    state.yaw = player.facing + Math.PI
    state.pitch = START_PITCH
  }

  const cp = Math.cos(state.pitch)
  const desiredX = target.x + Math.sin(state.yaw) * cp * state.distance
  const desiredY = target.y + Math.sin(state.pitch) * state.distance
  const desiredZ = target.z + Math.cos(state.yaw) * cp * state.distance

  if (!initialised || teleported) {
    // Snap rather than swoop in from wherever the camera was (startup, or a
    // teleport).
    camera.position.set(desiredX, desiredY, desiredZ)
    lookAt.x = target.x
    lookAt.y = target.y
    lookAt.z = target.z
    initialised = true
  } else {
    // Frame-rate independent smoothing, one rate for the rig, a faster one
    // for where it's looking.
    const tPos = dt > 0 ? 1 - Math.exp(-POSITION_SMOOTHING * dt) : 1
    camera.position.x += (desiredX - camera.position.x) * tPos
    camera.position.y += (desiredY - camera.position.y) * tPos
    camera.position.z += (desiredZ - camera.position.z) * tPos

    const tLook = dt > 0 ? 1 - Math.exp(-LOOK_SMOOTHING * dt) : 1
    lookAt.x += (target.x - lookAt.x) * tLook
    lookAt.y += (target.y - lookAt.y) * tLook
    lookAt.z += (target.z - lookAt.z) * tLook
  }

  camera.lookAt(lookAt.x, lookAt.y, lookAt.z)
}
