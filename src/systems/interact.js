// Orchestrates every "Press E to ..." start action (systems/afk.js's
// lock-on, systems/hexPowerPad.js's buy/equip, systems/merchant.js's aura)
// behind the shared 2-second hold gate (systems/interactHold.js) instead of
// firing instantly on keydown — so InteractPrompt (components/hud/Hud.jsx)
// can show a fill ring the player watches complete before anything happens,
// and an early release visibly cancels it. Stepped once per frame from
// GameLoop.jsx, right after afk/hexPad/merchant's own step() (which only
// compute proximity now) and before inputState.interact's end-of-frame
// reset.
//
// AFK's "E again to stop" toggle is the one exception: it keeps firing
// instantly off inputState.interact inside systems/afk.js itself, since that
// message ("AFK firing — move or press Space to stop") has no keycap to
// hold against.
import { isInteractKeyDown } from './input.js'
import { afkState, startAfk } from './afk.js'
import { hexPowerPadState, interactWithNearestPad } from './hexPowerPad.js'
import { merchantState } from './merchant.js'
import { step as stepHold } from './interactHold.js'
import { playPowerGainPop } from './sfx.js'

export function step() {
  if (afkState.active) {
    stepHold(null, false) // no hold-confirmable prompt while auto-firing
    return
  }

  let zoneKey = null
  if (afkState.nearTargetId !== null) zoneKey = `afk:${afkState.nearTargetId}`
  else if (hexPowerPadState.nearIndex !== null) zoneKey = `hexPad:${hexPowerPadState.nearIndex}`
  else if (merchantState.near) zoneKey = 'merchant'

  const confirmed = stepHold(zoneKey, isInteractKeyDown())
  if (!confirmed) return

  if (zoneKey.startsWith('afk:')) {
    if (afkState.nearAllowed) startAfk(afkState.nearTargetId)
  } else if (zoneKey.startsWith('hexPad:')) {
    interactWithNearestPad()
  } else if (zoneKey === 'merchant') {
    merchantState.openAuraRequested = true
    // Same confirmation "pop" as startAfk()/interactWithNearestPad() — this
    // is the merchant zone's own "the hold actually did something" moment.
    playPowerGainPop()
  }
}
