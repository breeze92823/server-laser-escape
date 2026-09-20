// Multiplayer / netcode tunables (Tech.md §4: src/data/ owns every tunable
// number). All durations are milliseconds unless the name says otherwise.
//
// The game is single-player-complete: nothing below gates gameplay. The netcode
// only adds *presence* — seeing other players move and fire in the same arena —
// and every path here is built so a slow or absent server degrades to solo play
// with a HUD notice, never a stall (same stance as systems/bloxity.js §5.6).

// Colyseus server. Render.com's free tier spins the instance down after ~15 min
// idle and takes 30–60 s to cold-boot on the next request, so the connect loop
// below is written to wait through that and fall back to solo if it never
// answers.
const DEFAULT_SERVER_URL = 'https://server-laser-escape.onrender.com'

// A local `npm start` in server/ (ws://localhost:2567) or any other deploy can
// override without touching code: set VITE_SERVER_URL in an .env file.
export const SERVER_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_SERVER_URL) ||
  DEFAULT_SERVER_URL

// Room handler name registered in server/src/app.config.ts.
export const ROOM_NAME = 'arena'

// One join attempt is abandoned after this long. A cold Render boot normally
// answers well inside this; a dead host never will, and we must not hang on it.
export const JOIN_TIMEOUT_MS = 45_000

// Backoff between connect attempts. The index clamps to the last entry, so after
// a handful of tries it settles at one quiet attempt per 30 s forever — enough
// to pick the server back up when it wakes, without hammering it.
export const RETRY_BACKOFF_MS = [3_000, 6_000, 12_000, 20_000, 30_000]

// From attempt #2 onward the HUD banner flips from "connecting" to "server is
// waking up — playing solo meanwhile", because by then a cold start is the
// likely cause and the player should know they can just play.
export const SOLO_NOTICE_AFTER_ATTEMPT = 2

// A mid-game socket drop is ridden out by the @colyseus/sdk Room's own
// reconnection (message buffering + exponential backoff). systems/net.js only
// takes over — dropping to solo and running the retry loop below — once that
// built-in recovery has exhausted its attempts and fires room.onLeave.

// Local player → server: cadence of the `move` relay. Sent at MOVE_SEND_HZ while
// the transform is changing, and once every MOVE_IDLE_MS at rest so a player who
// joins after us still sees where we are stood.
export const MOVE_SEND_HZ = 12
export const MOVE_IDLE_MS = 1_000

// Smallest change worth a packet (metres / radians / gait fraction). Below all
// of these and not firing, we're "at rest" and fall back to the idle cadence.
export const MOVE_EPSILON_POS = 0.02
export const MOVE_EPSILON_YAW = 0.01

// Remote bodies ease toward their last reported transform at this fraction per
// second, smoothing the MOVE_SEND_HZ packets into continuous motion.
export const REMOTE_LERP_RATE = 16

// A remote whose last packet is older than this is treated as gone even if the
// server never sent onRemove (covers a silently dropped socket): its body fades
// and is culled.
export const REMOTE_STALE_MS = 8_000

// Tech.md §6: "remote players, if they ever ship, must be capped or merged
// rather than each paying" the multi-mesh Bloxity-avatar cost. They ship here
// as the real rig (equipped cosmetics + run cycle), so the cap is what keeps
// the draw-call budget (§7) bounded: a bare rig is ~6 draw calls, +1 per
// equipped cosmetic. Past this count, extra players fall back to the capsule.
export const MAX_REMOTE_BODIES = 8

// Cap on our serialised avatar JSON ({e:<equipped>,p:<proportions>}) — matches
// the server's AVATAR_MAX_LEN. A full set serialises to a few hundred bytes.
export const AVATAR_MAX_LEN = 4096

// Debounce on re-sending our avatar after the portal reports a change
// (customizer edits fire a burst of proportion updates).
export const AVATAR_RESEND_DEBOUNCE_MS = 600

// Debounce on re-sending our own power/rebirth/wins after any of them
// change. Longer than the avatar's: an actively-grinding AFK player can gain
// Power many times a second (systems/actionTracker.js), and the in-world
// leaderboard (components/LeaderboardBoard.jsx) only needs a roughly-current
// rank, not a per-gain packet.
export const STATS_RESEND_DEBOUNCE_MS = 1_000

// Debounce on re-sending the signed-in player's durable save (server
// systems/db.ts's `players` collection, via ArenaRoom.ts's `saveProgress`) —
// longer than STATS_RESEND_DEBOUNCE_MS since this hits Mongo, not just an
// in-memory schema field, and a save a second behind is harmless (the next
// change reschedules it, and teardown() flushes one final time on the way out).
export const PROGRESS_RESEND_DEBOUNCE_MS = 3_000

// Wait up to this long for the Bloxity auth state to settle before the first
// connect, so a signed-in player joins under their real name rather than the
// "Player" fallback. Not waited on reconnects.
export const USERNAME_WAIT_MS = 2_500

// --- Remote body look (components/RemotePlayers.jsx) --------------------------
// Capsule dims mirror playerState.js's defaults so a remote reads as the same
// size as the local fallback capsule.
export const REMOTE_BODY = {
  RADIUS: 0.4,
  HEIGHT: 1.8,
  COLOR: '#4aa3ff', // cool blue — distinct from the local capsule's red
  NUB_COLOR: '#ffd36b',
  NAME_HEIGHT: 2.35, // metres above the feet for the floating name tag
  NAME_COLOR: '#ffffff',
  NAME_OUTLINE: '#000000',
  NAME_SIZE: 0.32,
  BEAM_COLOR: '#ff5a5a',
  BEAM_CORE_COLOR: '#ffd6d6',
  BEAM_RADIUS: 0.05,
  BEAM_CORE_RADIUS: 0.02,
  BEAM_OPACITY: 0.5,
  FADE_RATE: 3, // opacity/sec the whole body fades in on spawn / out when stale
}

// Beam origin on a remote, as fractions of REMOTE_BODY height/radius — matches
// data/laser.js's LASER_EYE_HEIGHT_RATIO / LASER_FORWARD_RATIO.
export const REMOTE_BEAM_EYE_RATIO = 0.85
export const REMOTE_BEAM_FORWARD_RATIO = 0.9
