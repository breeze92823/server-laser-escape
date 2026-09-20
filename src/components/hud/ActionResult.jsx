// Top-center popup that surfaces the result of a held-E interaction attempt
// (systems/interact.js) — success (green) for a completed AFK lock-on /
// HexPower buy-equip, failure (red) for one blocked by a gate the HUD prompt
// no longer states up front (insufficient Rebirth at an AFK target,
// insufficient Wins at a HexPower pad — see systems/afk.js and systems/
// hexPowerPad.js). Driven imperatively via `show(text, success)` on the same
// ref-handle pattern InteractPrompt (Hud.jsx) uses, and polled from
// systems/actionResult.js's showActionResult() singleton at Hud.jsx's usual
// ~10Hz cadence — never a per-frame re-render (Tech.md §5.4).
//
// Visual style: HexPowerPadLabel's in-world bar (BAR_GRADIENT_TEXTURE —
// transparent edges fading to solid colour at the centre, "+N Power" text on
// top of it) reproduced as 2D HUD chrome, recoloured black instead of red.
// Anchored just below NetStatus's top-center pill (left-1/2 top-3, see
// NetStatus.jsx) — top-16 clears that pill's height plus a gap.
import { forwardRef, useImperativeHandle, useRef } from 'react'

// Pop in with a slight overshoot (video-game "zoom in" punch), hold, then
// shrink back out — plays once per show() call, `forwards` so the popup
// stays hidden (via onAnimationEnd below) instead of looping.
const POP_ANIMATION = 'action-result-pop 2.4s cubic-bezier(0.34,1.56,0.64,1) forwards'

const ActionResult = forwardRef(function ActionResult(_props, ref) {
  const rootRef = useRef(null)
  const barRef = useRef(null)
  const textRef = useRef(null)

  useImperativeHandle(
    ref,
    () => ({
      show(text, success = true) {
        const root = rootRef.current
        const bar = barRef.current
        const label = textRef.current
        if (!root || !bar || !label) return
        label.textContent = text
        label.style.color = success ? '#4ade80' : '#f87171'
        root.style.display = ''
        // Restart the one-shot animation even if it's already mid-run for a
        // previous message: clear it, force a reflow, then re-apply.
        bar.style.animation = 'none'
        void bar.offsetHeight
        bar.style.animation = POP_ANIMATION
      },
    }),
    [],
  )

  return (
    <div
      ref={rootRef}
      data-hud="action-result"
      className="pointer-events-none absolute left-1/2 top-16 flex -translate-x-1/2 flex-col items-center gap-1"
      style={{ display: 'none' }}
    >
      <div
        ref={barRef}
        className="relative flex h-14 w-[32rem] items-center justify-center"
        onAnimationEnd={() => {
          if (rootRef.current) rootRef.current.style.display = 'none'
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)',
          }}
        />
        <span
          ref={textRef}
          className="relative text-3xl font-black"
          style={{ WebkitTextStroke: '1.5px black', paintOrder: 'stroke fill' }}
        />
      </div>

      <style>{`
        @keyframes action-result-pop {
          0% { opacity: 0; transform: scale(0.4); }
          8% { opacity: 1; transform: scale(1.12); }
          14% { opacity: 1; transform: scale(1); }
          80% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.5); }
        }
      `}</style>
    </div>
  )
})

export default ActionResult
