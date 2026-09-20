import { useEffect, useReducer, useRef, useState } from 'react'
import {
  touchAimState,
  subscribeTouchAim,
  setTouchMove,
  addTouchLook,
  addTouchZoom,
  setTouchAim,
  setTouchFiring,
  pressTouchJump,
  pressTouchInteract,
  releaseTouchInteract,
} from '../../systems/input.js'
import { useTouchMode } from './hooks.js'

// On-screen controls for a touch session (Tech.md §5.1: input.js owns
// "keyboard + pointer + touch joystick"). DOM siblings of the canvas like the
// rest of the HUD (§5.4) — this never re-renders per frame: gestures write the
// input singleton directly through the setters in systems/input.js. The only
// React state here is the transient joystick thumb position and the
// crosshair's own position (re-rendered on a tap, not per frame).
//
// Layout, matched to a phone held in two hands:
//   left  ~45% / lower  ~55%  → floating movement stick
//   right ~62%               → drag to orbit the camera, pinch to zoom,
//                               or TAP to move the laser's aim point there
//   bottom-right cluster     → Fire (hold), Jump, Interact (E)
// The laser aims at a crosshair that starts at screen centre and sticks
// wherever the player last tapped the look zone (LookZone below) — there is
// no cursor to hover, so aim is tap-to-set rather than continuous.

const STICK_RADIUS = 54 // px; thumb travel that maps to full-speed movement
const DEAD_ZONE = 0.16 // fraction of the radius ignored before the avatar moves
const LOOK_SENS = 0.75 // touch drag px → same units cameraOrbit expects from a mouse
const PINCH_ZOOM = 2.5 // pinch distance px → wheel-equivalent zoom units
const TAP_MOVE_THRESHOLD = 12 // px of travel beyond which a press reads as a drag, not a tap

// One-finger drag on this half orbits the camera; two fingers pinch-zoom. A
// one-finger press that never travels past TAP_MOVE_THRESHOLD is instead read
// as a tap and moves the laser's aim point there (setTouchAim(), sticky until
// the next such tap) — the two gestures share this zone since a drag doesn't
// have a meaningful "aim" reading until it's finished being a drag, and a tap
// produces no orbit motion to conflict with.
function LookZone() {
  const pointers = useRef(new Map())
  const lastPinch = useRef(0)
  // The single finger still eligible to resolve as a tap on release, or null
  // once it's moved too far, or a second finger turned this into a pinch.
  const tapCandidate = useRef(null)

  const dist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    tapCandidate.current =
      pointers.current.size === 1
        ? { id: e.pointerId, downX: e.clientX, downY: e.clientY, moved: false }
        : null // a second finger down means this is now a pinch, not a tap
    if (pointers.current.size === 2) lastPinch.current = dist()
  }

  const onMove = (e) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)

    if (pointers.current.size >= 2) {
      const d = dist()
      if (lastPinch.current) addTouchZoom((lastPinch.current - d) * PINCH_ZOOM)
      lastPinch.current = d
      tapCandidate.current = null
      return
    }
    addTouchLook((next.x - prev.x) * LOOK_SENS, (next.y - prev.y) * LOOK_SENS)

    const tap = tapCandidate.current
    if (tap && tap.id === e.pointerId) {
      const traveled = Math.hypot(e.clientX - tap.downX, e.clientY - tap.downY)
      if (traveled > TAP_MOVE_THRESHOLD) tap.moved = true
    }
  }

  const onUp = (e) => {
    pointers.current.delete(e.pointerId)
    lastPinch.current = 0
    const tap = tapCandidate.current
    if (tap && tap.id === e.pointerId && !tap.moved) setTouchAim(e.clientX, e.clientY)
    tapCandidate.current = null
  }

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      className="pointer-events-auto fixed right-0 top-0 bottom-0"
      style={{ left: '46%', touchAction: 'none' }}
    />
  )
}

// Floating stick: the base springs to wherever the thumb lands inside the lower
// wedge, so it never has to be found by feel.
function MoveStick() {
  const [, force] = useReducer((n) => n + 1, 0)
  const stick = useRef(null) // { id, ox, oy, tx, ty } in viewport px, or null

  const publish = () => {
    const s = stick.current
    if (!s) return setTouchMove(0, 0)
    let x = (s.tx - s.ox) / STICK_RADIUS
    let y = (s.ty - s.oy) / STICK_RADIUS
    let mag = Math.hypot(x, y)
    if (mag > 1) {
      x /= mag
      y /= mag
      mag = 1
    }
    if (mag < DEAD_ZONE) return setTouchMove(0, 0)
    // Rescale past the dead zone so control is smooth from the edge of it.
    const k = ((mag - DEAD_ZONE) / (1 - DEAD_ZONE)) / mag
    setTouchMove(x * k, -y * k) // screen up (−y) is forward (+z)
  }

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    stick.current = {
      id: e.pointerId,
      ox: e.clientX,
      oy: e.clientY,
      tx: e.clientX,
      ty: e.clientY,
    }
    force()
  }

  const onMove = (e) => {
    const s = stick.current
    if (!s || s.id !== e.pointerId) return
    s.tx = e.clientX
    s.ty = e.clientY
    publish()
    force()
  }

  const onUp = (e) => {
    if (stick.current && stick.current.id !== e.pointerId) return
    stick.current = null
    setTouchMove(0, 0)
    force()
  }

  const s = stick.current
  let knobX = 0
  let knobY = 0
  if (s) {
    knobX = s.tx - s.ox
    knobY = s.ty - s.oy
    const mag = Math.hypot(knobX, knobY)
    if (mag > STICK_RADIUS) {
      knobX = (knobX / mag) * STICK_RADIUS
      knobY = (knobY / mag) * STICK_RADIUS
    }
  }

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="pointer-events-auto fixed bottom-0 left-0"
      style={{ width: '45%', height: '58%', touchAction: 'none' }}
    >
      {s && (
        <>
          <div
            className="fixed rounded-full border border-white/40 bg-white/5"
            style={{
              left: s.ox - STICK_RADIUS,
              top: s.oy - STICK_RADIUS,
              width: STICK_RADIUS * 2,
              height: STICK_RADIUS * 2,
              zIndex: 35,
            }}
          />
          <div
            className="fixed rounded-full border border-white/70 bg-white/25 backdrop-blur-sm"
            style={{
              left: s.ox - 26 + knobX,
              top: s.oy - 26 + knobY,
              width: 52,
              height: 52,
              zIndex: 35,
            }}
          />
        </>
      )}
    </div>
  )
}

function ActionButton({ onPress, onRelease, size, label, sub, glow }) {
  const [down, setDown] = useState(false)
  const press = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDown(true)
    onPress()
  }
  const release = () => {
    setDown(false)
    if (onRelease) onRelease()
  }
  return (
    <button
      type="button"
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      className="pointer-events-auto flex select-none flex-col items-center justify-center rounded-full border text-white shadow-lg transition-transform"
      style={{
        width: size,
        height: size,
        touchAction: 'none',
        transform: down ? 'scale(0.92)' : 'scale(1)',
        borderColor: glow ? 'rgba(248,113,113,0.7)' : 'rgba(255,255,255,0.35)',
        background: down
          ? glow
            ? 'rgba(239,68,68,0.85)'
            : 'rgba(255,255,255,0.28)'
          : glow
            ? 'rgba(239,68,68,0.55)'
            : 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <span className="text-sm font-bold leading-none tracking-wide">{label}</span>
      {sub && <span className="mt-0.5 text-[9px] font-medium opacity-80">{sub}</span>}
    </button>
  )
}

// Drawn at the sticky tap-to-aim point (systems/input.js touchAimState),
// starting at screen centre — not a per-frame follow, just a re-render on
// each tap (subscribeTouchAim), since the point only ever changes on a tap.
function Crosshair() {
  const [pos, setPos] = useState({ x: touchAimState.x, y: touchAimState.y })
  useEffect(() => subscribeTouchAim((x, y) => setPos({ x, y })), [])
  return (
    <div
      className="pointer-events-none fixed"
      style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}
    >
      <div className="h-5 w-5 rounded-full border border-white/60" />
      <div
        className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-white/80"
        style={{ transform: 'translate(-50%, -50%)' }}
      />
    </div>
  )
}

export default function TouchControls() {
  const on = useTouchMode()

  // Backgrounding the tab mid-gesture must not leave the avatar walking or the
  // beam stuck on. systems/input.js clears the singleton on window blur too;
  // this keeps our own visuals honest.
  useEffect(() => {
    if (!on) return
    const stop = () => {
      setTouchMove(0, 0)
      setTouchFiring(false)
    }
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [on])

  if (!on) return null

  const fireSize = 'clamp(66px, 16vmin, 92px)'
  const smallSize = 'clamp(48px, 11vmin, 64px)'

  return (
    <div
      className="pointer-events-none fixed inset-0"
      style={{ touchAction: 'none' }}
    >
      <LookZone />
      <Crosshair />
      <MoveStick />

      <div
        className="fixed flex items-end gap-3"
        style={{
          right: 'calc(env(safe-area-inset-right, 0px) + 18px)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)',
          zIndex: 40,
        }}
      >
        <div className="flex flex-col gap-3">
          <ActionButton
            onPress={pressTouchInteract}
            onRelease={releaseTouchInteract}
            size={smallSize}
            label="E"
            sub="USE"
          />
          <ActionButton
            onPress={pressTouchJump}
            size={smallSize}
            label="JUMP"
          />
        </div>
        <ActionButton
          onPress={() => setTouchFiring(true)}
          onRelease={() => setTouchFiring(false)}
          size={fireSize}
          label="FIRE"
          glow
        />
      </div>
    </div>
  )
}
