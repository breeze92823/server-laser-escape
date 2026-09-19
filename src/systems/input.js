// inputState (Tech.md §5.1): camera-relative move vector, orbit look delta, wheel
// zoom, edge-triggered jump, and the firing flag.
//
// Left-click / tap is the action verb (hold to fire) — that is why the camera
// orbits on right-drag and there is no OrbitControls.
import { AFK_INTERACT_KEY } from '../data/afk.js'
export const inputState = {
  // x = strafe (+ right), z = forward (+ forward); pre-normalised. Keyboard
  // only ever writes z now — A/D and the arrow keys turn the camera (see
  // `turn` below) instead of strafing; touch's virtual joystick is the only
  // thing that still drives x, straight from setTouchMove.
  move: { x: 0, z: 0 },
  turn: 0, // -1 (A/Left) .. +1 (D/Right); held-key camera yaw, consumed by cameraOrbit
  look: { dx: 0, dy: 0 }, // pixels dragged this frame; consumed by cameraOrbit
  zoom: 0, // wheel delta this frame; consumed by cameraOrbit
  pointerNDC: { x: 0, y: 0 }, // mouse position in [-1, 1] clip space; consumed by systems/laser.js
  jump: false, // set on keydown, consumed by playerMovement
  firing: false, // held while left mouse / primary touch is down
  // A frame-loop poll of `firing` alone can miss a press that both starts and
  // ends between two frames (a fast click). These let a poller (see
  // systems/actionTracker.js) reconstruct exactly what happened from real
  // event timestamps instead of relying on catching the level mid-transition.
  firePressAt: 0, // performance.now() at the most recent pointerdown
  fireReleaseAt: 0, // performance.now() at the most recent pointerup/forced-release
  firePressSeq: 0, // increments once per pointerdown; never missed even if already resolved by the time it's polled
  interact: false, // edge-triggered on AFK_INTERACT_KEY keydown; consumed by systems/afk.js
}

// Touch sessions have no keyboard and no cursor: the on-screen controls
// (components/hud/TouchControls.jsx) drive `inputState` through the setters
// below. The laser aims at a crosshair that starts at screen centre and then
// sticks wherever the player last tapped the look zone (setTouchAim() below)
// — there is no cursor to track continuously, so aim is tap-to-set instead of
// hover-to-follow. `active` flips once — on the first real touch, or
// immediately when the primary pointer is coarse — and never flips back for
// the session.
export const touchState = {
  active: false,
}

const touchModeSubs = new Set()

export function subscribeTouchMode(cb) {
  touchModeSubs.add(cb)
  return () => touchModeSubs.delete(cb)
}

// Sticky tap-to-aim point, in viewport px. Purely so components/hud/
// TouchControls.jsx's Crosshair can redraw itself where the player last
// tapped — systems/laser.js only ever reads inputState.pointerNDC, which
// setTouchAim() below keeps in sync with this.
export const touchAimState = { x: 0, y: 0 }
const touchAimSubs = new Set()

export function subscribeTouchAim(cb) {
  touchAimSubs.add(cb)
  return () => touchAimSubs.delete(cb)
}

// Called by TouchControls.jsx's LookZone on a qualifying tap (pointerdown ->
// pointerup with negligible movement in between, and not part of a pinch).
// The aim point then holds here until the next such tap — independent of
// firing, and unaffected by a drag that DOES move the camera (that path
// never calls this).
export function setTouchAim(clientX, clientY) {
  touchAimState.x = clientX
  touchAimState.y = clientY
  inputState.pointerNDC.x = (clientX / window.innerWidth) * 2 - 1
  inputState.pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1
  touchAimSubs.forEach((cb) => cb(clientX, clientY))
}

function enableTouchMode() {
  if (touchState.active) return
  touchState.active = true
  // Centre-aim by default: with no pointermove events feeding it (see the
  // guards in the pointer handlers), pointerNDC would otherwise sit at its
  // last mouse value. A tap in the look zone moves it from here via
  // setTouchAim().
  touchAimState.x = window.innerWidth / 2
  touchAimState.y = window.innerHeight / 2
  inputState.pointerNDC.x = 0
  inputState.pointerNDC.y = 0
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('touch-mode')
  }
  touchModeSubs.forEach((cb) => cb(true))
}

function onTouchStartDetect() {
  enableTouchMode()
}

// Called by TouchControls.jsx. Movement is analog here (magnitude 0..1), unlike
// the keyboard's unit vector — playerMovement scales by SPEED either way.
export function setTouchMove(x, z) {
  inputState.move.x = x
  inputState.move.z = z
}

export function addTouchLook(dx, dy) {
  inputState.look.dx += dx
  inputState.look.dy += dy
}

export function addTouchZoom(dz) {
  inputState.zoom += dz
}

// Mirrors onPointerDown / onPointerUp's fire bookkeeping so a poller
// (systems/actionTracker.js) reconstructs touch presses the same way.
export function setTouchFiring(on) {
  if (on) {
    if (inputState.firing) return
    inputState.firing = true
    inputState.firePressAt = performance.now()
    inputState.firePressSeq++
  } else if (inputState.firing) {
    inputState.firing = false
    inputState.fireReleaseAt = performance.now()
  }
}

export function pressTouchJump() {
  inputState.jump = true // consumed + cleared next frame by playerMovement
}

export function pressTouchInteract() {
  inputState.interact = true // consumed + cleared next frame (afk.js / hexPowerPad.js / GameLoop.jsx)
}

const held = new Set()
let orbiting = false
let installed = false

// Escape opens the portal's pause menu. Registered by the Bloxity facade so
// this module keeps knowing nothing about the SDK.
let escapeHandler = null

export function setEscapeHandler(fn) {
  escapeHandler = fn
}

// Reasons the game currently must not receive input: an SDK auth modal, the
// avatar customizer, the portal menu. Listeners are on window, so without this
// every keystroke typed into an SDK overlay would also drive WASD.
const suspensions = new Set()

export function suspend(reason) {
  suspensions.add(reason)
  if (installed) uninstall()
}

export function resume(reason) {
  suspensions.delete(reason)
  if (suspensions.size === 0 && !installed) install()
}

export function isSuspended() {
  return suspensions.size > 0
}

function recomputeMove() {
  let z = 0
  if (held.has('KeyW') || held.has('ArrowUp')) z += 1
  if (held.has('KeyS') || held.has('ArrowDown')) z -= 1
  inputState.move.z = z
}

// A/D and the left/right arrows turn the camera around the player instead of
// strafing (see the inputState.move comment above) — held, not edge-
// triggered, so cameraOrbit can drive a continuous yaw rate while a key is
// down, the same way a mouse drag does.
function recomputeTurn() {
  let t = 0
  if (held.has('KeyA') || held.has('ArrowLeft')) t -= 1
  if (held.has('KeyD') || held.has('ArrowRight')) t += 1
  inputState.turn = t
}

function onKeyDown(e) {
  if (e.repeat) return
  if (e.code === 'Escape') {
    // Never treated as a held key — it leaves the game and opens the menu.
    if (escapeHandler) escapeHandler()
    return
  }
  held.add(e.code)
  if (e.code === 'Space') inputState.jump = true
  if (e.code === AFK_INTERACT_KEY) inputState.interact = true
  recomputeMove()
  recomputeTurn()
}

function onKeyUp(e) {
  held.delete(e.code)
  recomputeMove()
  recomputeTurn()
}

function onPointerDown(e) {
  // Touch pointers are handled entirely by TouchControls.jsx — never the
  // desktop mouse path (which would fire the laser at the raw tap point and
  // give no camera or movement control).
  if (e.pointerType === 'touch') return
  // Scoped to the canvas so clicking a HUD element (the Rebirth button, auth
  // panel, chat box) never also fires the laser — those are separate DOM
  // elements the pointer lands on, never the canvas itself.
  if (e.button === 0 && e.target.tagName === 'CANVAS') {
    inputState.firing = true
    inputState.firePressAt = performance.now()
    inputState.firePressSeq++
  }
  // right or middle button starts a camera orbit drag
  if (e.button === 1 || e.button === 2) orbiting = true
}

function onPointerUp(e) {
  if (e.pointerType === 'touch') return
  // Not target-scoped: this only closes a press that onPointerDown actually
  // opened (inputState.firing already true), so a drag that started on the
  // canvas and released over the HUD still ends correctly.
  if (e.button === 0 && inputState.firing) {
    inputState.firing = false
    inputState.fireReleaseAt = performance.now()
  }
  if (e.button === 1 || e.button === 2) orbiting = false
}

function onPointerMove(e) {
  if (e.pointerType === 'touch') return
  // Tracked unconditionally (not just while orbiting) — this is what the
  // laser aims at, updated regardless of whether a button is held.
  inputState.pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1
  inputState.pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1

  if (!orbiting) return
  inputState.look.dx += e.movementX || 0
  inputState.look.dy += e.movementY || 0
}

function onWheel(e) {
  inputState.zoom += e.deltaY
}

function onContextMenu(e) {
  e.preventDefault() // right-drag is the orbit gesture
}

function onBlur() {
  held.clear()
  orbiting = false
  if (inputState.firing) inputState.fireReleaseAt = performance.now()
  inputState.firing = false
  inputState.interact = false
  recomputeMove()
  recomputeTurn()
}

// Live key-held check, for systems (e.g. systems/afk.js) that need to poll a
// specific key each frame rather than react to inputState's edge-triggered
// flags (jump/interact), which are consumed and cleared the frame they fire.
export function isHeld(code) {
  return held.has(code)
}

export function install() {
  if (installed || suspensions.size > 0) return
  installed = true
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('blur', onBlur)
  window.addEventListener('touchstart', onTouchStartDetect, { passive: true })

  // A coarse primary pointer (phone / tablet / handheld console) means there is
  // no mouse coming — show the on-screen controls right away rather than
  // waiting for the first touch.
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches &&
    (navigator.maxTouchPoints || 0) > 0
  ) {
    enableTouchMode()
  }
}

export function uninstall() {
  if (!installed) return
  installed = false
  // Drop anything held so a key down at suspend time is not stuck down on
  // resume — the same clearing onBlur already does.
  onBlur()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('touchstart', onTouchStartDetect)
}
