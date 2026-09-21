// Multiplayer presence (Tech.md §5.1 style: framework-free, mutable module
// state, no React import). This is the ONLY module that talks to the Colyseus
// server, and — exactly like systems/bloxity.js §5.6 — every path through it is
// built so a slow, asleep, or absent server leaves the game fully playable
// solo. Nothing here blocks gameplay; the scene never waits on a socket.
//
// The server (server/src/rooms/ArenaRoom.ts) is a dumb relay: we send our
// transform + beam endpoint as a `move` message, it fans every player's state
// out through `room.state.players`. We read that map once per frame in step()
// rather than wiring per-field schema callbacks, so there is no dependency on
// the exact @colyseus/schema callback API.
import { player } from './playerState.js'
import { laser } from './laser.js'
import { SPEED } from './playerMovement.js'
import { authState, subscribeAuth, getStableUserId } from './bloxity.js'
import { avatarState, subscribe as subscribeAvatar } from './avatarState.js'
import { useGameStore } from '../store/useGameStore.js'
import { subscribeHealthNet, applyRemoteHealth } from './playerHealth.js'
import { spawnRagdoll } from './ragdoll.js'
import { PROPORTIONS, clamp } from '../data/bloxity.js'
import { PLAYER_MAX_HP } from '../data/playerHealth.js'
import {
  SERVER_URL,
  ROOM_NAME,
  JOIN_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  SOLO_NOTICE_AFTER_ATTEMPT,
  MOVE_SEND_HZ,
  MOVE_IDLE_MS,
  MOVE_EPSILON_POS,
  MOVE_EPSILON_YAW,
  REMOTE_LERP_RATE,
  REMOTE_STALE_MS,
  MAX_REMOTE_BODIES,
  USERNAME_WAIT_MS,
  AVATAR_MAX_LEN,
  AVATAR_RESEND_DEBOUNCE_MS,
  STATS_RESEND_DEBOUNCE_MS,
  PROGRESS_RESEND_DEBOUNCE_MS,
  REMOTE_BODY,
} from '../data/net.js'

// --- Public state -----------------------------------------------------------
// Coarse connection status the HUD renders (components/hud/NetStatus.jsx):
//   'idle'       — not started / torn down
//   'connecting' — a join or reconnect attempt is in flight
//   'solo'       — between retry attempts; the game is single-player right now
//   'online'     — attached to a room
export const netState = {
  status: 'idle',
  attempt: 0, // failed attempts since the last successful attach
  playerCount: 0, // total players in the room, including us
  everConnected: false, // true once we have attached at least once this session
  error: null, // last error string, for diagnostics
}

// id -> live remote body. Mutated in place; the frame loop (step),
// components/RemotePlayers.jsx and getLeaderboard() below read it directly.
//   x/y/z/yaw/speed   last values the server reported
//   rx/ry/rz/ryaw/rspeed  eased render values (smooth the MOVE_SEND_HZ packets)
//   firing            beam on?          beam {x,y,z}  world-space beam endpoint
//   username          name-tag text
//   power/rebirth/wins  last-reported store/useGameStore.js stats (0 until
//                     their first `stats` packet, or forever on a server that
//                     predates that field — a leaderboard reads a stale-but-
//                     harmless 0 rather than throwing)
//   hp/maxHp/dead     PVP health (systems/playerCombat.js, components/
//                     RemotePlayers.jsx's floating bar) — server-authoritative,
//                     written by whichever OTHER client last hit this one
//   alpha             0..1 fade (spawn-in / leave-out)
//   present           seen in room.state this frame
//   lastAt            performance.now() of the last time it was seen present
export const remotePlayers = new Map()

// --- Listeners ------------------------------------------------------------
// Fires on status / count / roster changes — NOT per move packet, so a HUD
// subscriber never re-renders per frame (Tech.md §5.4).
const listeners = new Set()

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  netState.attempt = attempt
  for (const fn of listeners) {
    try {
      fn(netState)
    } catch {
      // A broken subscriber must not wedge the netcode.
    }
  }
}

function setStatus(status) {
  if (netState.status !== status) {
    netState.status = status
    emit()
  } else {
    emit()
  }
}

// --- Connection machine -------------------------------------------------
let sdkModule = null
let client = null
let room = null
let selfId = ''
let started = false
let stopped = true
let connecting = false
let attempt = 0
let retryTimer = 0
let sdkReconnecting = false // mirrors room.reconnection.isReconnecting

// Server's periodic merge of "every account that ever saved to Mongo" +
// "everyone online right now" (server ArenaRoom.ts's refreshLeaderboard()),
// one array per stat. Empty until the first 'leaderboard' message arrives
// (fresh connect, offline/solo play, or an older server predating this
// feature) — getLeaderboard() below degrades to a self-only row in that case,
// same "never blocks gameplay" stance as the rest of this file.
let globalLeaderboard = { power: [], rebirth: [], wins: [] }

async function loadSdk() {
  if (!sdkModule) sdkModule = await import('@colyseus/sdk')
  return sdkModule
}

function currentUsername() {
  // Signed-in account, else Bloxity's generated guest identity ("bear5" …),
  // matching the HUD identity chip. Plain "Guest" only if neither exists.
  const u = authState.user || authState.guest
  const name = u && (u.displayName || u.username || u.name)
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 64) : 'Guest'
}

// --- Avatar sync -------------------------------------------------------
// Our own Bloxity avatar, serialised for the wire so every other client can
// build the real character. `avatarState` already holds the SDK's equipped ids
// + clamped proportions (systems/avatarState.js); a guest's `equipped` is {}
// which still builds the bare base rig, exactly like the local PlayerAvatar.
function avatarPayload() {
  try {
    const json = JSON.stringify({
      e: avatarState.equipped || {},
      p: avatarState.proportions || {},
    })
    return json.length <= AVATAR_MAX_LEN ? json : ''
  } catch {
    return ''
  }
}

// Full, clamped proportions from a possibly-partial remote object (untrusted —
// it came off the wire). Mirrors avatarState.js's writeProportions().
function sanitizeProportions(raw) {
  const out = {}
  const src = raw && typeof raw === 'object' ? raw : {}
  for (const [k, spec] of Object.entries(PROPORTIONS)) {
    const n = Number(src[k])
    out[k] = clamp(Number.isFinite(n) ? n : spec.def, spec.min, spec.max)
  }
  return out
}

// Keep only string-valued cosmetic ids, each length-capped. buildAvatar()
// already 404s any bad id back to the default mesh, so this is just hygiene.
function sanitizeEquipped(raw) {
  const out = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v.length <= 64) out[k] = v
    }
  }
  return out
}

// Parse an inbound `avatar` schema string into { equipped, proportions }.
function parseAvatar(str) {
  let obj = null
  if (typeof str === 'string' && str) {
    try {
      obj = JSON.parse(str)
    } catch {
      obj = null
    }
  }
  return {
    equipped: sanitizeEquipped(obj && obj.e),
    proportions: sanitizeProportions(obj && obj.p),
  }
}

let avatarResendTimer = 0

function sendAvatarNow() {
  if (!room) return
  const avatar = avatarPayload()
  if (!avatar) return
  try {
    room.send('setAvatar', { avatar })
  } catch {
    // Socket mid-close — the next attach re-seeds via join options anyway.
  }
}

function scheduleAvatarResend() {
  if (avatarResendTimer) return
  avatarResendTimer = setTimeout(() => {
    avatarResendTimer = 0
    sendAvatarNow()
  }, AVATAR_RESEND_DEBOUNCE_MS)
}

// --- Stats sync ---------------------------------------------------------
// Our own live power/rebirth/wins (store/useGameStore.js), pushed to the room
// so components/LeaderboardBoard.jsx can rank currently-connected players.
// useGameStore is zustand's plain store object — .getState()/.subscribe() are
// framework-free (no React import here, same constraint as the rest of this
// file); only a React component would call it as a hook.
function statsPayload() {
  const s = useGameStore.getState()
  return { power: s.power, rebirth: s.rebirth, wins: s.wins }
}

let statsResendTimer = 0

function sendStatsNow() {
  if (!room) return
  try {
    room.send('stats', statsPayload())
  } catch {
    // Socket mid-close — the next attach re-seeds via attachRoom() anyway.
  }
}

// Same "schedule once, ride out further triggers until it fires" shape as
// scheduleAvatarResend, just a longer window (STATS_RESEND_DEBOUNCE_MS):
// an actively-grinding AFK player can gain Power many times a second
// (systems/actionTracker.js), and a per-gain packet would be needless
// chatter for a leaderboard that only needs a roughly-current rank.
function scheduleStatsResend() {
  if (statsResendTimer) return
  statsResendTimer = setTimeout(() => {
    statsResendTimer = 0
    sendStatsNow()
  }, STATS_RESEND_DEBOUNCE_MS)
}

// Last power/rebirth/wins we scheduled a resend for — useGameStore.subscribe
// fires on ANY store change (no subscribeWithSelector middleware, store/
// useGameStore.js's own header comment), so this filters out the unrelated
// ones (buying a hex pad, a wall being marked destroyed, ...) rather than
// scheduling a pointless resend for every one of them.
let lastScheduledStats = { power: undefined, rebirth: undefined, wins: undefined }

function onLocalStoreChange(state) {
  if (
    state.power !== lastScheduledStats.power ||
    state.rebirth !== lastScheduledStats.rebirth ||
    state.wins !== lastScheduledStats.wins
  ) {
    lastScheduledStats = { power: state.power, rebirth: state.rebirth, wins: state.wins }
    scheduleStatsResend()
  }
}

// --- Progress sync (persisted save) --------------------------------------
// The durable half of store/useGameStore.js — power/rebirth/wins plus owned
// and equipped hex pads/auras and owned wins-gated targets — pushed to a
// signed-in player's own document
// in the server's Mongo `players` collection (server src/db.ts, ArenaRoom.ts's
// `saveProgress`). A guest has no stable id (systems/bloxity.js
// getStableUserId(), which this gates on) and this simply never sends for
// one — same "nowhere durable to live" stance as the rest of the SDK
// integration (Tech.md §5.6).
function progressPayload() {
  const s = useGameStore.getState()
  return {
    power: s.power,
    rebirth: s.rebirth,
    wins: s.wins,
    ownedHexPads: Array.from(s.ownedHexPads),
    equippedHexPad: s.equippedHexPad,
    ownedAuras: Array.from(s.ownedAuras),
    equippedAura: s.equippedAura,
    ownedTargets: Array.from(s.ownedTargets),
  }
}

let progressResendTimer = 0

// No client-side identity gate here on purpose: the ROOM is the authority on
// whether this session is allowed to persist (ArenaRoom.ts's `userIds` map,
// set by `identify`/join options), so a send that arrives just after a logout
// simply lands as a no-op there instead of racing this module's own view of
// authState. sendIdentityNow() below relies on exactly this to flush a final
// save under the OLD id before the room forgets it.
function sendProgressNow() {
  if (!room) return
  try {
    room.send('saveProgress', progressPayload())
  } catch {
    // Socket mid-close — teardown() already tried to flush before this point.
  }
}

// Same "schedule once, ride out further triggers until it fires" shape as
// scheduleStatsResend, just a longer window (PROGRESS_RESEND_DEBOUNCE_MS) —
// this hits Mongo on the other end, not just an in-memory schema field, and a
// save a few seconds behind is harmless since teardown() flushes once more on
// the way out.
function scheduleProgressResend() {
  if (progressResendTimer) return
  progressResendTimer = setTimeout(() => {
    progressResendTimer = 0
    sendProgressNow()
  }, PROGRESS_RESEND_DEBOUNCE_MS)
}

// Cheap snapshot string for change detection — same purpose as
// lastScheduledStats above, just covering the extra owned/equipped fields
// stats doesn't carry.
let lastScheduledProgress = ''

function onLocalStoreChangeProgress(state) {
  if (!getStableUserId()) return
  const snap = JSON.stringify([
    state.power,
    state.rebirth,
    state.wins,
    state.equippedHexPad,
    state.equippedAura,
    state.ownedHexPads.size,
    state.ownedAuras.size,
    state.ownedTargets.size,
  ])
  if (snap !== lastScheduledProgress) {
    lastScheduledProgress = snap
    scheduleProgressResend()
  }
}

// Applied at most once per page session: the FIRST successful attach's
// `progress` message is the real load from this player's save. A later
// reattach (a full drop + fresh joinOrCreate, not the SDK's own buffered
// reconnection) would otherwise re-fetch a possibly-stale Mongo snapshot and
// clobber whatever the player did locally during the blip — our own store is
// already the source of truth by then, and the next scheduled saveProgress
// writes it back over Mongo regardless.
let hydratedFromServer = false

// --- Identity sync (login/logout mid-session) ----------------------------
// join options only carry whatever username/userId was true the instant the
// socket opened. Bloxity auth routinely settles AFTER that (or changes later
// via login/logout without a page reload), so without this, ArenaRoom.ts's
// userIds map would stay stuck on whatever was true at join forever — a
// player who joined as a guest and later signed in would see their real name
// on their OWN leaderboard row (currentUsername() is read live in
// getLeaderboard() below) while `saveProgress` silently no-oped server-side
// for their whole session, since the room never learned their userId. That
// was the actual bug: progress looked like it was being tracked but never
// reached Mongo, so it was always gone on the next refresh.
let lastIdentity = { userId: '', username: '' }

function sendIdentityNow() {
  if (!room) return
  const prevUserId = lastIdentity.userId
  const userId = getStableUserId()
  const username = currentUsername()
  if (userId === prevUserId && username === lastIdentity.username) return

  // Logging out (or switching accounts) — flush this session's progress
  // under the OLD id before the room forgets it below; once it does,
  // saveProgress can no longer reach that document.
  if (prevUserId && prevUserId !== userId) sendProgressNow()
  // A freshly-signed-in id gets its saved doc hydrated again, same as a
  // brand-new join — see hydratedFromServer's own comment.
  if (userId && userId !== prevUserId) hydratedFromServer = false

  lastIdentity = { userId, username }
  try {
    room.send('identify', { userId, username })
  } catch {
    // Socket mid-close — the next attach re-seeds via join options anyway.
  }
}

// --- PVP health sync ----------------------------------------------------
// Our own respawn (systems/playerHealth.js) -> the room. Damage itself is
// sent from the ATTACKER's client (see sendPlayerDamage below), not from
// here — this module only ever reports that WE came back to life.
function onLocalHealthEvent(ev) {
  if (!room) return
  try {
    if (ev.type === 'respawn') room.send('playerRespawn', {})
  } catch {
    // Socket mid-close — handleLeave() will pick it up; local state already moved.
  }
}

// Called from systems/playerCombat.js's strikeTarget() when the beam is on
// another player in the PVP zone. Client-authoritative: the attacker computes
// the target's next hp, the server clamps + stores it, every client
// (including the target) adopts it back from room.state.players on a later
// frame.
export function sendPlayerDamage(targetId, hp) {
  if (!room) return
  try {
    room.send('playerDamage', { targetId, hp })
  } catch {
    // Socket mid-close — the hit is simply lost.
  }
}

// Resolve once auth has settled, so a signed-in player joins under their real
// name. Bounded — a blocked SDK never settles and must not hold the connect.
function waitForAuth(ms) {
  if (authState.ready) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(t)
      off()
      resolve()
    }
    const off = subscribeAuth((s) => {
      if (s.ready) finish()
    })
    const t = setTimeout(finish, ms)
  })
}

function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

async function connect() {
  if (stopped || connecting || room) return
  connecting = true
  clearTimeout(retryTimer)
  retryTimer = 0
  setStatus('connecting')

  try {
    const mod = await loadSdk()
    if (stopped) return
    if (!client) client = new mod.Client(SERVER_URL)

    // The @colyseus/sdk Room has its own automatic reconnection (buffered
    // messages, exponential backoff) that transparently rides out a brief
    // socket drop — a Render dyno recycle, a Wi-Fi blip. This connect() is
    // only reached for the FIRST join and for the outer fallback after that
    // built-in reconnection has exhausted its retries (room.onLeave). So a
    // plain joinOrCreate is all that's needed here; JOIN_TIMEOUT_MS covers a
    // cold Render boot.
    const joined = await withTimeout(
      // `avatar` in the join options so a joiner is drawn as the right
      // character from their very first patch, before any `setAvatar` lands.
      client.joinOrCreate(ROOM_NAME, {
        username: currentUsername(),
        avatar: avatarPayload(),
        // Empty string for a guest — ArenaRoom.ts's onJoin treats a falsy
        // userId as "nothing to load/save", same as every other field here.
        userId: getStableUserId(),
      }),
      JOIN_TIMEOUT_MS,
      'join timed out',
    )

    if (stopped) {
      try {
        joined.leave()
      } catch {
        /* nothing to clean up */
      }
      return
    }
    attachRoom(joined)
  } catch (err) {
    connecting = false
    attempt += 1
    netState.error = String((err && err.message) || err)
    if (stopped) return
    scheduleRetry()
  }
}

function scheduleRetry() {
  if (stopped || room || retryTimer) return
  // Between attempts the game IS single-player. Say so plainly once a cold
  // start is the likely cause; keep retrying underneath either way.
  setStatus(attempt >= SOLO_NOTICE_AFTER_ATTEMPT || netState.everConnected ? 'solo' : 'connecting')
  const i = Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_MS.length - 1)
  retryTimer = setTimeout(() => {
    retryTimer = 0
    connect()
  }, RETRY_BACKOFF_MS[i])
}

function attachRoom(joined) {
  room = joined
  connecting = false
  attempt = 0
  selfId = joined.sessionId
  sdkReconnecting = false
  netState.everConnected = true
  netState.error = null

  // Fires only once the SDK's own reconnection has given up (or on a
  // consented leave from teardown()). That's our cue to drop to solo and run
  // the slower outer retry loop.
  room.onLeave((code) => handleLeave(code))
  room.onError((code, message) => {
    netState.error = message || `error ${code}`
  })

  // The saved doc for our own Bloxity user id (ArenaRoom.ts's onJoin ->
  // loadProgress()), sent once right after this join resolves. See
  // hydratedFromServer's own comment for why only the FIRST attach applies it.
  room.onMessage('progress', (msg) => {
    if (hydratedFromServer) return
    hydratedFromServer = true
    useGameStore.getState().hydrate(msg)
  })

  // The merged all-time + online leaderboard (server ArenaRoom.ts's
  // refreshLeaderboard(), broadcast every LEADERBOARD_REFRESH_MS). Re-render
  // the boards on every update via emit() — not per frame, same convention
  // as every other emit() site in this file.
  room.onMessage('leaderboard', (msg) => {
    globalLeaderboard = msg || { power: [], rebirth: [], wins: [] }
    emit()
  })

  // Re-send our avatar on every (re)attach — the join options already carried
  // it, but a fresh joinOrCreate after a drop needs it re-stated on the new
  // session, and a server that predates the `avatar` field just ignores this.
  sendAvatarNow()
  // Same reasoning for stats: a fresh session starts every field at its
  // schema default (0), so a rejoin needs its current power/rebirth/wins
  // re-stated immediately rather than waiting for the next store change.
  sendStatsNow()
  // The join options already carried whatever identity was true the instant
  // we connected — seed lastIdentity to match so sendIdentityNow() (fired
  // from the subscribeAuth callback below) only resends on a REAL change
  // after this point, not an immediate redundant duplicate of the join.
  lastIdentity = { userId: getStableUserId(), username: currentUsername() }

  recount()
  setStatus('online')
}

function handleLeave() {
  room = null
  selfId = ''
  connecting = false
  sdkReconnecting = false
  netState.playerCount = 0
  // Stale rows from the last session shouldn't linger on the boards while
  // we're disconnected/retrying; the next attach's first broadcast refills this.
  globalLeaderboard = { power: [], rebirth: [], wins: [] }
  // Fade every remote out; step() culls them as alpha hits 0.
  for (const e of remotePlayers.values()) e.present = false

  if (stopped) return
  attempt = 0
  scheduleRetry()
}

function recount() {
  const n = room && room.state && room.state.players ? room.state.players.size : 0
  if (n !== netState.playerCount) {
    netState.playerCount = n
    emit()
  }
}

// --- Public lifecycle -------------------------------------------------
let offAvatar = null
let offStats = null
let offProgress = null
let offIdentity = null
let offHealthNet = null

export function init() {
  if (started) return
  started = true
  stopped = false
  // One subscription for the whole session: the portal changed our avatar
  // (login, customizer) — push it to the room, debounced. A no-op while
  // offline; the next attach re-seeds from avatarPayload().
  if (!offAvatar) offAvatar = subscribeAvatar(() => scheduleAvatarResend())
  // Our own power/rebirth/wins -> the room, debounced (see scheduleStatsResend).
  // A no-op while offline; the next attach re-seeds via sendStatsNow().
  if (!offStats) offStats = useGameStore.subscribe(onLocalStoreChange)
  // Our own durable save -> the room, debounced (see scheduleProgressResend).
  // A no-op for a guest or while offline; see progressPayload()'s own comment.
  if (!offProgress) offProgress = useGameStore.subscribe(onLocalStoreChangeProgress)
  // Login/logout/account-switch -> the room, immediately (see
  // sendIdentityNow()'s own comment for why this exists). subscribeAuth also
  // fires on friends/balance/avatar loads, not just identity changes;
  // sendIdentityNow()'s own diff check is what filters those out.
  if (!offIdentity) offIdentity = subscribeAuth(() => sendIdentityNow())
  // Our own PVP respawn -> the room. A no-op while offline; harmless if it
  // never sends (there's no server hp to reconcile against without a room).
  if (!offHealthNet) offHealthNet = subscribeHealthNet(onLocalHealthEvent)
  waitForAuth(USERNAME_WAIT_MS).then(() => {
    if (!stopped) connect()
  })
}

export function teardown() {
  stopped = true
  started = false
  clearTimeout(retryTimer)
  retryTimer = 0
  clearTimeout(avatarResendTimer)
  avatarResendTimer = 0
  clearTimeout(statsResendTimer)
  statsResendTimer = 0
  clearTimeout(progressResendTimer)
  progressResendTimer = 0
  if (offAvatar) {
    offAvatar()
    offAvatar = null
  }
  if (offStats) {
    offStats()
    offStats = null
  }
  if (offProgress) {
    offProgress()
    offProgress = null
  }
  if (offIdentity) {
    offIdentity()
    offIdentity = null
  }
  if (offHealthNet) {
    offHealthNet()
    offHealthNet = null
  }
  // Final best-effort save before the socket closes — a page unload can't
  // wait on PROGRESS_RESEND_DEBOUNCE_MS, and room.send() is fire-and-forget
  // (no ack needed) so this never delays the leave() right after it.
  sendProgressNow()
  if (room) {
    try {
      // Stop the SDK from trying to reconnect a socket we are deliberately
      // closing on the way out.
      if (room.reconnection) room.reconnection.enabled = false
      room.leave()
    } catch {
      /* page is going away */
    }
  }
  room = null
  connecting = false
  remotePlayers.clear()
  globalLeaderboard = { power: [], rebirth: [], wins: [] }
  netState.playerCount = 0
  setStatus('idle')
}

// Manual "Retry" from the HUD banner. Collapses the backoff and tries now.
export function retryNow() {
  if (stopped) {
    stopped = false
    started = true
  }
  clearTimeout(retryTimer)
  retryTimer = 0
  attempt = 0
  connect()
}

// --- Outgoing: local player -> server --------------------------------
let lastSendAt = 0
const lastSent = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, firing: false }

// Called every frame from GameLoop. Throttles itself: MOVE_SEND_HZ while the
// transform is changing, once per MOVE_IDLE_MS at rest so a late joiner still
// sees us standing where we are.
export function reportLocal() {
  if (!room) return

  const p = player.position
  const yaw = player.facing
  const speed = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / SPEED)
  const firing = laser.active

  const changed =
    Math.abs(p.x - lastSent.x) > MOVE_EPSILON_POS ||
    Math.abs(p.y - lastSent.y) > MOVE_EPSILON_POS ||
    Math.abs(p.z - lastSent.z) > MOVE_EPSILON_POS ||
    Math.abs(yaw - lastSent.yaw) > MOVE_EPSILON_YAW ||
    Math.abs(speed - lastSent.speed) > 0.05 ||
    firing !== lastSent.firing

  const now = performance.now()
  const minGap = changed ? 1000 / MOVE_SEND_HZ : MOVE_IDLE_MS
  if (now - lastSendAt < minGap) return
  lastSendAt = now

  lastSent.x = p.x
  lastSent.y = p.y
  lastSent.z = p.z
  lastSent.yaw = yaw
  lastSent.speed = speed
  lastSent.firing = firing

  try {
    room.send('move', {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw,
      speed,
      firing,
      beamToX: firing ? laser.end.x : 0,
      beamToY: firing ? laser.end.y : 0,
      beamToZ: firing ? laser.end.z : 0,
    })
  } catch {
    // Socket mid-close — handleLeave() will pick it up.
  }
}

// --- Per-frame: remote interpolation + roster upkeep -----------------
function shortestAngleTo(from, to) {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function ingestRemote(id, s, now) {
  let e = remotePlayers.get(id)
  if (!e) {
    // MAX_REMOTE_BODIES bounds the avatar-rig draw-call cost (data/net.js's
    // own comment); getLeaderboard() below reuses this same tracked set
    // rather than a separate channel, so with more than that many other
    // players connected the leaderboard only ranks whichever ones got
    // tracked first, not necessarily the true top scorers room-wide.
    if (remotePlayers.size >= MAX_REMOTE_BODIES) return
    const parsed = parseAvatar(s.avatar)
    e = {
      x: s.x, y: s.y, z: s.z, yaw: s.yaw, speed: s.speed,
      rx: s.x, ry: s.y, rz: s.z, ryaw: s.yaw, rspeed: s.speed,
      firing: false, beam: { x: 0, y: 0, z: 0 },
      username: s.username || 'Player',
      // Bloxity avatar for RemotePlayers.jsx. `avatarRaw` is the last schema
      // string we built from; `avatarRev` bumps whenever it changes so the
      // component rebuilds the rig (and only then).
      avatarRaw: s.avatar || '',
      equipped: parsed.equipped,
      proportions: parsed.proportions,
      avatarRev: 0,
      // 0 until their first `stats` packet (client systems/net.js
      // sendStatsNow), or forever against a server predating that field —
      // getLeaderboard() below just reads whatever's here, no special-casing.
      power: s.power || 0, rebirth: s.rebirth || 0, wins: s.wins || 0,
      // PVP health (systems/playerCombat.js / components/RemotePlayers.jsx).
      // Continuous, read straight off the map every frame like x/y/z — never
      // gated behind emit(), same reasoning as those.
      hp: typeof s.hp === 'number' ? s.hp : PLAYER_MAX_HP,
      maxHp: typeof s.maxHp === 'number' ? s.maxHp : PLAYER_MAX_HP,
      dead: !!s.dead,
      // performance.now() of their last hp decrease, or 0 — components/
      // RemotePlayers.jsx (via systems/hitFlash.js) reads this for the same
      // red emissive pulse systems/playerHealth.js drives on our own avatar.
      hitFlashAt: 0,
      alpha: 0, present: true, lastAt: now,
    }
    remotePlayers.set(id, e)
    emit() // a new body joined the render roster
  }
  e.x = s.x
  e.y = s.y
  e.z = s.z
  e.yaw = s.yaw
  e.speed = s.speed
  e.firing = !!s.firing
  e.beam.x = s.beamToX
  e.beam.y = s.beamToY
  e.beam.z = s.beamToZ
  const nextHp = typeof s.hp === 'number' ? s.hp : PLAYER_MAX_HP
  if (nextHp < e.hp) e.hitFlashAt = now
  e.hp = nextHp
  e.maxHp = typeof s.maxHp === 'number' ? s.maxHp : PLAYER_MAX_HP
  const wasDead = e.dead
  e.dead = !!s.dead
  // Ragdoll the instant we witness a remote's dead flag flip true — skip a
  // remote we first see already dead (e.g. joining mid-fight), since we never
  // saw that death happen. Mirrors systems/playerHealth.js's own edge-detect
  // for our own death.
  if (e.dead && !wasDead) spawnRagdoll(e.x, e.y, e.z, e.yaw)
  const power = s.power || 0
  const rebirth = s.rebirth || 0
  const wins = s.wins || 0
  if (power !== e.power || rebirth !== e.rebirth || wins !== e.wins) {
    e.power = power
    e.rebirth = rebirth
    e.wins = wins
    emit() // a tracked stat changed — a leaderboard's rank may need updating
  }
  if (s.username && s.username !== e.username) {
    e.username = s.username
    emit()
  }
  const nextAvatar = s.avatar || ''
  if (nextAvatar !== e.avatarRaw) {
    const parsed = parseAvatar(nextAvatar)
    e.avatarRaw = nextAvatar
    e.equipped = parsed.equipped
    e.proportions = parsed.proportions
    e.avatarRev++
    emit() // the character changed — rebuild the rig
  }
  e.present = true
  e.lastAt = now
}

export function step(dt) {
  const now = performance.now()

  // Reflect the SDK's own reconnection loop (a transient socket drop it is
  // riding out) into the HUD as "Reconnecting…", and back to "online" once it
  // recovers. If it never recovers, room.onLeave -> handleLeave takes over.
  if (room && room.reconnection) {
    const reconnecting = !!room.reconnection.isReconnecting
    if (reconnecting !== sdkReconnecting) {
      sdkReconnecting = reconnecting
      setStatus(reconnecting ? 'connecting' : 'online')
    }
  }

  if (room && room.state && room.state.players) {
    const live = room.state.players
    live.forEach((s, id) => {
      if (id !== selfId) ingestRemote(id, s, now)
    })
    // Anything we track that the room no longer lists has left.
    for (const [id, e] of remotePlayers) {
      if (!live.get(id)) e.present = false
    }
    recount()

    // Our own PVP hp/dead, as some OTHER client's strikeTarget() last wrote
    // it to the room — an "adopt the server's echo" pattern keyed to our own
    // sessionId. Wall health is NOT synced this way: each client tracks and
    // breaks its own walls independently (systems/wallHealth.js).
    const self = live.get(selfId)
    if (self) applyRemoteHealth(self.hp, !!self.dead)
  }

  const lerp = 1 - Math.exp(-REMOTE_LERP_RATE * Math.min(dt, 0.1))
  const fadeStep = REMOTE_BODY.FADE_RATE * Math.min(dt, 0.1)

  for (const [id, e] of remotePlayers) {
    const stale = now - e.lastAt > REMOTE_STALE_MS
    const targetAlpha = e.present && !stale ? 1 : 0
    if (e.alpha < targetAlpha) e.alpha = Math.min(targetAlpha, e.alpha + fadeStep)
    else if (e.alpha > targetAlpha) e.alpha = Math.max(targetAlpha, e.alpha - fadeStep)

    e.rx += (e.x - e.rx) * lerp
    e.ry += (e.y - e.ry) * lerp
    e.rz += (e.z - e.rz) * lerp
    e.ryaw += shortestAngleTo(e.ryaw, e.yaw) * lerp
    e.rspeed += (e.speed - e.rspeed) * lerp

    if (targetAlpha === 0 && e.alpha <= 0.001) {
      remotePlayers.delete(id)
      emit() // the body left the render roster
    }
  }
}

// --- Leaderboard --------------------------------------------------------
// Top `limit` players by `stat` ('power' | 'rebirth' | 'wins' — any
// store/useGameStore.js field), local player included, highest first —
// components/LeaderboardBoard.jsx's own data source. Our own row always
// comes straight off the live store (no round trip needed for our own
// numbers, and it's always the freshest value there is); every other row
// comes from globalLeaderboard (server ArenaRoom.ts's refreshLeaderboard() —
// every account that has EVER saved to Mongo, merged with everyone online
// right now, logged in or guest). Offline/solo, or before the first
// broadcast arrives, globalLeaderboard[stat] is empty and this degrades to
// just our own row — the same "degrades to solo, never blocks" stance as the
// rest of this file (file header comment).
export function getLeaderboard(stat, limit) {
  const selfRow = {
    id: selfId || 'self',
    name: currentUsername(),
    value: Number(useGameStore.getState()[stat]) || 0,
    isSelf: true,
  }
  // The server already excludes our own account from this list (an online
  // session's live value replaces its own Mongo doc there), but filtering by
  // id here too is cheap insurance against ever showing ourselves twice.
  const others = (globalLeaderboard[stat] || [])
    .filter((row) => row.id !== selfId)
    .map((row) => ({ id: row.id, name: row.name || 'Player', value: Number(row.value) || 0, isSelf: false }))

  const rows = [selfRow, ...others]
  rows.sort((a, b) => b.value - a.value)
  return rows.slice(0, limit)
}
