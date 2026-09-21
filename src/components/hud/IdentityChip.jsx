import { useState } from 'react'
import { authState } from '../../systems/bloxity.js'
import { GUEST_PFP_URL } from '../../data/bloxity.js'
import { useAuth } from './hooks.js'

// Dev-only diagnostic — production/staging players don't need to see whose
// identity the client resolved, just the interactive AuthPanel.
const DEV_ONLY = import.meta.env.VITE_ENVIRONMENT === 'Development'

// Top-left identity chip. Unlike AuthPanel (top-right), this always renders —
// a guest with the SDK blocked still sees who they are — and it has no
// interactive controls, so it stays pointer-events-none and the touch look-zone
// underneath keeps working. Event-driven via useAuth(); never re-renders per
// frame (Tech.md §5.4).
export default function IdentityChip({ panelStyle }) {
  useAuth()
  const [imgFailed, setImgFailed] = useState(false)

  if (!DEV_ONLY) return null

  const { user, guest } = authState
  const isGuest = !user
  // Signed in → the real account. Signed out → Bloxity's generated guest
  // identity ("bear5" + pfp), if the SDK provides one; otherwise a plain label.
  const identity = user || guest
  const name = identity ? identity.displayName || identity.username || 'Player' : 'Guest'
  const src = (identity && identity.pfp) || GUEST_PFP_URL

  return (
    <div
      data-hud="identity-chip"
      className="pointer-events-none absolute left-4 top-4 w-48 font-mono text-xs"
    >
      <div className="flex items-center gap-2 rounded px-3 py-2" style={panelStyle}>
        {imgFailed ? (
          // CDN blocked / 404: a neutral silhouette rather than a broken image.
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100/10 text-slate-300">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v2h16v-2c0-3.31-3.58-6-8-6Z" />
            </svg>
          </span>
        ) : (
          <img
            src={src}
            alt=""
            onError={() => setImgFailed(true)}
            className="h-7 w-7 shrink-0 rounded-full bg-slate-100/10 object-cover"
          />
        )}

        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-100">{name}</div>
          {isGuest && <div className="text-slate-400">Playing as Guest</div>}
        </div>
      </div>
    </div>
  )
}
