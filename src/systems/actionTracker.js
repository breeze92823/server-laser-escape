// Turns inputState.firing into "Action" events (Tech.md §5.1 style: a
// framework-free module, mutable module-level state, stepped once per frame
// from GameLoop). An Action is either a click (press-release under
// ACTION_HOLD_INTERVAL) or a continuous hold, which re-fires every
// ACTION_HOLD_INTERVAL seconds. The two are mutually exclusive per press: a
// hold that crosses the interval always fires before release can be
// observed, which suppresses the click grant on the release frame.
//
// Every Action also lands one discrete strike (systems/playerCombat.js
// strikeTarget() — a PVP hit on another player if the beam is on one and both
// are in the PVP zone, else systems/wallHealth.js's strikeWall()): the click
// hit on the press edge, then one more per hold interval — so whatever's on
// the beam loses health per Action, the same cadence gainPower() adds Power
// on. Both are throttled to that one-per-ACTION_HOLD_INTERVAL cadence
// (strikeThrottled/gainPowerThrottled below), so spam-clicking can't land
// strikes — or drain a wall — any faster than a held beam would.
import { inputState } from './input.js'
import { afkState } from './afk.js'
import { spawnActionPopup } from './actionPopups.js'
import { strikeTarget } from './playerCombat.js'
import { health as playerHealth } from './playerHealth.js'
import { useGameStore } from '../store/useGameStore.js'
import { ACTION_HOLD_INTERVAL } from '../data/progression.js'
import { playLaserPulse } from './sfx.js'

let firingPrev = false
let pressElapsed = 0 // seconds since the current press started
let sinceLastAction = 0 // seconds since the last action fired in this press
let holdFiredDuringPress = false
let lastProcessedPressSeq = 0

// Global Power-gain cooldown, independent of pressElapsed/sinceLastAction
// (which reset on every new press). Without this, rapidly clicking — release
// before ACTION_HOLD_INTERVAL, then press again — would grant Power on every
// click, far faster than the same-cadence hold. Starts "ready" so the very
// first Action isn't held back.
let sinceLastGain = ACTION_HOLD_INTERVAL

// Same idea, for the wall/PVP strike. Without its own cooldown, spam-clicking
// would land a strikeTarget() hit on every press edge (below) even though
// gainPowerThrottled caps Power to one grant per ACTION_HOLD_INTERVAL — free
// wall/PVP damage disproportionate to the Power actually gained. Kept as a
// separate counter from sinceLastGain since the two fire at different points
// in a click (strike on press, Power on release) but share the same cadence.
let sinceLastStrike = ACTION_HOLD_INTERVAL

// Only actually grants Power once ACTION_HOLD_INTERVAL has passed since the
// last grant, click or hold alike — one shared cadence no matter how fast the
// player clicks. Callers still land the wall/PVP strike unconditionally.
function gainPowerThrottled(multiplier) {
  if (sinceLastGain < ACTION_HOLD_INTERVAL) return 0
  sinceLastGain = 0
  return useGameStore.getState().gainPower(multiplier)
}

// Mirrors gainPowerThrottled above, for strikeTarget(): one shared cadence no
// matter how fast the player clicks, so spam-clicking can't out-damage a
// held beam.
function strikeThrottled() {
  if (sinceLastStrike < ACTION_HOLD_INTERVAL) return
  sinceLastStrike = 0
  strikeTarget()
}

export function step(dt) {
  // Dead (systems/playerHealth.js, PVP only) — no Actions land while frozen.
  if (playerHealth.dead) {
    firingPrev = false
    return
  }
  sinceLastGain += dt
  sinceLastStrike += dt

  // inputState.firePressSeq is bumped synchronously in the real pointerdown
  // handler, so a press-and-release that both happen between two polls of
  // this function (a fast click, easily faster than one animation frame) is
  // never silently lost the way a plain level-read of `firing` would lose it.
  if (inputState.firePressSeq !== lastProcessedPressSeq) {
    lastProcessedPressSeq = inputState.firePressSeq
    pressElapsed = 0
    sinceLastAction = 0
    holdFiredDuringPress = false

    if (!inputState.firing && inputState.fireReleaseAt >= inputState.firePressAt) {
      // The whole press already resolved before we ever observed `firing`
      // live — grant exactly the one action it's worth, same as a click. No
      // wall strike: the beam never rendered this press, so there is no aim to
      // resolve a wall from.
      spawnActionPopup(gainPowerThrottled(1))
      firingPrev = false
      return
    }
  }

  // AFK lock (systems/afk.js) counts as a continuous hold, same as a real
  // mouse press — it drives systems/laser.js the same way (see laser.js).
  const firing = inputState.firing || afkState.active

  if (firing) {
    // The "click" wall hit, landed the frame the button goes down while the
    // beam is still guaranteed on the wall (the Power grant for a click comes
    // later, on the release frame, by when systems/laser.js has cleared the
    // aim). A press that turns into a hold keeps taking one strike per
    // ACTION_HOLD_INTERVAL below, so a held wall drains at t=0, 2, 4, ...
    if (!firingPrev) {
      strikeThrottled()
      playLaserPulse()
    }
    pressElapsed += dt
    sinceLastAction += dt
    // While AFK-locked, each Action's Power is scaled by the target's "xN"
    // tier (systems/afk.js); a real held mouse press is always 1x.
    const mult = afkState.active ? afkState.multiplier : 1
    while (sinceLastAction >= ACTION_HOLD_INTERVAL) {
      strikeThrottled()
      spawnActionPopup(gainPowerThrottled(mult))
      sinceLastAction -= ACTION_HOLD_INTERVAL
      holdFiredDuringPress = true
    }
  } else if (firingPrev) {
    if (!holdFiredDuringPress && pressElapsed < ACTION_HOLD_INTERVAL) {
      spawnActionPopup(gainPowerThrottled(1))
    }
    pressElapsed = 0
    sinceLastAction = 0
    holdFiredDuringPress = false
  }

  firingPrev = firing
}
