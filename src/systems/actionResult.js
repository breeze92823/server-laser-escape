import { playActionFail } from './sfx.js'

// Shared trigger for the top-center ActionResult HUD popup
// (components/hud/ActionResult.jsx) — framework-free singleton in the same
// style as afkState/hexPowerPadState/merchantState, since the calls into
// showActionResult() below come from systems code (afk.js, hexPowerPad.js,
// interact.js) far outside React. `id` increments on every call so Hud.jsx's
// poll can detect a fresh trigger even when back-to-back messages share the
// same text (e.g. holding E against the same locked pad twice in a row).
export const actionResultState = {
  text: '',
  success: true,
  id: 0,
}

export function showActionResult(text, success) {
  actionResultState.text = text
  actionResultState.success = success
  actionResultState.id++
  if (!success) playActionFail()
}
