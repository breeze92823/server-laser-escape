import { useState } from 'react'
import {
  authState,
  isAvailable,
  login,
  logout,
  toggleCustomizer,
} from '../../systems/bloxity.js'
import { useAuth } from './hooks.js'
import FriendsPanel from './FriendsPanel.jsx'

// Dev builds only need a quick way to sign out and re-test the auth flow —
// skip the balance/avatar/friends chrome and show just the Logout button.
const DEV_ONLY_LOGOUT = import.meta.env.VITE_ENVIRONMENT === 'Development'

// Renders whatever the single onUserChanged subscription last reported. The
// user object is never cached here — authState is rewritten by that handler.
export default function AuthPanel({ panelStyle }) {
  useAuth()
  const [busy, setBusy] = useState(false)
  const [showFriends, setShowFriends] = useState(false)

  // Nothing to sign into when the SDK is blocked or absent; stay out of the way.
  if (!isAvailable()) return null

  const { user, balance, ready } = authState

  const onLogin = async () => {
    setBusy(true)
    try {
      await login()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-auto absolute right-4 top-4 w-56 font-mono text-xs">
      <div className="rounded px-3 py-2" style={panelStyle}>
        {!ready && <div className="text-slate-400">Connecting…</div>}

        {ready && !user && (
          <button
            type="button"
            onClick={onLogin}
            disabled={busy}
            className="w-full rounded border border-emerald-400/50 bg-emerald-600 px-2 py-1.5 font-semibold text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Log in'}
          </button>
        )}

        {ready && user && DEV_ONLY_LOGOUT && (
          <button
            type="button"
            onClick={logout}
            className="w-full rounded bg-slate-100/10 px-2 py-1 hover:bg-slate-100/20"
          >
            Log out
          </button>
        )}

        {ready && user && !DEV_ONLY_LOGOUT && (
          <>
            <div className="flex items-center gap-2">
              {user.pfp && (
                <img
                  src={user.pfp}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-100">
                  {user.displayName || user.username}
                </div>
                <div className="text-slate-400">
                  {balance == null ? '— Bux' : `${balance} Bux`}
                </div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={toggleCustomizer}
                className="rounded bg-slate-100/10 px-2 py-1 hover:bg-slate-100/20"
              >
                Avatar
              </button>
              <button
                type="button"
                onClick={() => setShowFriends((v) => !v)}
                className="rounded bg-slate-100/10 px-2 py-1 hover:bg-slate-100/20"
              >
                Friends
              </button>
            </div>
          </>
        )}
      </div>

      {ready && user && !DEV_ONLY_LOGOUT && showFriends && (
        <FriendsPanel panelStyle={panelStyle} />
      )}
    </div>
  )
}
