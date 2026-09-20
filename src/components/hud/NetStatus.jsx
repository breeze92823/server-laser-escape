import { useEffect, useReducer, useRef, useState } from 'react'
import { netState, subscribe, retryNow } from '../../systems/net.js'

// Top-centre multiplayer status pill. A DOM sibling of the canvas (Tech.md
// §5.4), never drei <Html>. Event-driven only: it re-renders when
// systems/net.js emits a status / player-count / roster change, never per
// frame. Sits at the very top so it never collides with the transient
// "LEVEL UP!" banner (data/levelUpPopup.js, top: 116).

const TONE = {
  wait: { dot: '#7dd3fc', ring: 'border-sky-400/40' },
  warn: { dot: '#fbbf24', ring: 'border-amber-400/50' },
  ok: { dot: '#34d399', ring: 'border-emerald-400/40' },
}

function describe(s) {
  if (s.status === 'idle') return null

  if (s.status === 'connecting') {
    return s.everConnected
      ? { text: 'Reconnecting to multiplayer…', tone: 'wait' }
      : {
          text: s.attempt < 1 ? 'Connecting to multiplayer…' : 'Waking multiplayer server…',
          tone: 'wait',
        }
  }

  if (s.status === 'solo') {
    return s.everConnected
      ? {
          text: 'Multiplayer disconnected — playing solo. Reconnecting…',
          tone: 'warn',
          retry: true,
        }
      : {
          text: 'Multiplayer server is warming up — playing solo. Retrying…',
          tone: 'warn',
          retry: true,
        }
  }

  if (s.status === 'online') {
    const others = Math.max(0, s.playerCount - 1)
    return {
      text:
        others > 0
          ? `Multiplayer connected — ${others} other player${others === 1 ? '' : 's'} here`
          : 'Multiplayer connected — you’re the only one here',
      tone: 'ok',
      transient: others === 0,
    }
  }

  return null
}

const SHOW_STATUS = import.meta.env.VITE_ENVIRONMENT === 'Development'

export default function NetStatus() {
  const [, bump] = useReducer((n) => n + 1, 0)
  const [dismissed, setDismissed] = useState(false)
  const hideTimer = useRef(0)

  useEffect(
    () =>
      subscribe(() => {
        setDismissed(false)
        bump()
      }),
    [],
  )

  const view = SHOW_STATUS ? describe(netState) : null

  // Auto-hide the "connected, nobody else here" confirmation after a few
  // seconds; every other state stays until it changes.
  useEffect(() => {
    clearTimeout(hideTimer.current)
    if (view && view.transient) {
      hideTimer.current = setTimeout(() => setDismissed(true), 4500)
    }
    return () => clearTimeout(hideTimer.current)
  })

  if (!view || dismissed) return null
  const tone = TONE[view.tone] || TONE.wait

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border ${tone.ring} bg-black/70 px-3.5 py-1.5 text-xs font-medium text-slate-100 shadow-lg`}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: tone.dot,
          animation: view.tone === 'ok' ? 'none' : 'netstatus-pulse 1.4s ease-in-out infinite',
        }}
      />
      <span className="whitespace-nowrap">{view.text}</span>
      {view.retry && (
        <button
          type="button"
          onClick={retryNow}
          className="pointer-events-auto ml-1 rounded-full border border-slate-300/30 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-white/20"
        >
          Retry
        </button>
      )}
      <style>{`@keyframes netstatus-pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
    </div>
  )
}
