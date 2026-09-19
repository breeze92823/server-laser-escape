// The Bloxity (Legion) SDK facade.
//
// Every SDK call in the codebase goes through this module. It is framework-free
// (Tech.md rule 2: systems never import React) and holds the *single*
// onUserChanged subscription, which is the source of truth for auth UI and for
// (re)loading friends, avatar and balance.
//
// Nothing here may throw when the SDK is missing. Tech.md §1 rejected drei
// <Environment> precisely because a CDN stall breaks the scene; a blocked
// sdk.bloxity.io must leave the game fully playable on the capsule fallback.
import { GAME_SLUG, SETTINGS } from '../data/bloxity.js'
import { SPAWN } from '../data/hub.js'
import { resetPlayer } from './playerState.js'
import { timeScale, resetClock } from './timeScale.js'
import { setSensitivity } from './cameraOrbit.js'
import { setEscapeHandler, suspend, resume } from './input.js'
import { settings, setSetting, subscribe as subscribeSettings } from './settingsState.js'
import { setAvatar, setProportions, resetAvatar } from './avatarState.js'
import * as session from './session.js'
import * as chat from './chat.js'
import * as audio from './audio.js'
import * as sfx from './sfx.js'

export function sdk() {
  return (typeof window !== 'undefined' && window.Legion && window.Legion.SDK) || null
}

export function isAvailable() {
  return !!sdk()
}

// --- Auth state -----------------------------------------------------------
// What the UI renders. `user` is only ever written from the onUserChanged
// handler, which re-reads getUser() rather than trusting a cached object.
// `guest` is the Bloxity-generated guest identity ({ username, displayName,
// pfp } — e.g. "bear5") every player has before signing in; null once `user`
// is set, or when the SDK is too old to expose getGuest().
export const authState = {
  ready: false,
  user: null,
  guest: null,
  friends: [],
  balance: null,
  embedded: false,
}

const authListeners = new Set()

export function subscribeAuth(fn) {
  authListeners.add(fn)
  fn(authState)
  return () => authListeners.delete(fn)
}

function emitAuth() {
  for (const fn of authListeners) fn(authState)
}

// Guards the async fan-out against a fast logout/login flip.
let userGeneration = 0
const unsubscribers = []

// --- Pause ----------------------------------------------------------------
export function setPaused(paused) {
  if (timeScale.paused === paused) return
  timeScale.paused = paused
  // Resuming after a pause must not hand the next tick() a multi-second dt.
  if (!paused) resetClock()
}

// graphics_quality is applied by App.jsx through <Canvas dpr>, which is the
// R3F-native path and survives resizes; there is no second mechanism here.

// --- Settings -------------------------------------------------------------
function applySetting(key) {
  const value = settings[key]
  switch (key) {
    case 'master_volume':
      audio.setMasterVolume(value)
      break
    case 'music_volume':
      audio.setMusicVolume(value)
      break
    case 'camera_sensitivity':
      setSensitivity(value)
      break
    case 'fullscreen':
      requestFullscreen(value)
      break
    default:
      // graphics_quality, show_fps, enable_chat and background_transparency are
      // read through settingsState's subscription by the HUD and <Canvas>.
      break
  }
}

function registerSettings(SDK) {
  for (const key of Object.keys(SETTINGS)) {
    // Registering a listener is also what makes the control appear in the
    // portal menu, so only keys with something behind them belong here.
    const off = SDK.settings.listen(key, (raw) => {
      setSetting(key, raw)
      applySetting(key)
    })
    if (typeof off === 'function') unsubscribers.push(off)
  }
  SDK.settings.triggerAll()
}

// --- Auth fan-out ---------------------------------------------------------
async function loadFriends(generation) {
  const SDK = sdk()
  if (!SDK) return
  try {
    const friends = await SDK.social.getFriends()
    if (generation !== userGeneration) return
    authState.friends = Array.isArray(friends) ? friends : []
    emitAuth()
  } catch {
    // Friends are non-essential; the game plays without them.
  }
}

async function loadBalance(generation) {
  const SDK = sdk()
  if (!SDK) return
  try {
    const balance = await SDK.bux.getBalance()
    if (generation !== userGeneration) return
    authState.balance = typeof balance === 'number' ? balance : null
    emitAuth()
  } catch {
    authState.balance = null
  }
}

function loadAvatar() {
  const SDK = sdk()
  if (!SDK) return
  try {
    // Equipped + proportions as one atomic update — see setAvatar()'s comment
    // in avatarState.js for why two separate calls used to race.
    setAvatar(SDK.avatar.getEquipped(), SDK.avatar.getProportions())
  } catch (err) {
    console.warn('[bloxity] failed to read avatar state', err)
    resetAvatar()
  }
}

// Bloxity assigns every unsigned player a stable guest identity (generated
// name + pfp). Optional-chained because older SDK builds lack it; never throws
// (Tech.md §5.6).
function readGuest() {
  const SDK = sdk()
  if (!SDK || typeof SDK.auth.getGuest !== 'function') return null
  try {
    const g = SDK.auth.getGuest()
    return g && (g.username || g.displayName) ? g : null
  } catch {
    return null
  }
}

// Stable Bloxity user id for a signed-in player, keying their server-side save
// (see systems/net.js progressPayload()). Same `_id` shape already used for a
// friend entry (components/hud/FriendsPanel.jsx); `id`/`userId` are read too
// in case the SDK's own user object names it differently. Empty for a guest
// -- Bloxity's generated guest identity isn't stable across sessions, so a
// guest's progress has nowhere durable to live.
export function getStableUserId() {
  const u = authState.user
  if (!u) return ''
  const id = u._id || u.id || u.userId
  return typeof id === 'string' && id ? id : ''
}

function onUser() {
  const SDK = sdk()
  // Re-read rather than trusting the callback argument, so nothing downstream
  // can hold a stale user across a logout.
  const user = SDK ? SDK.auth.getUser() : null
  const generation = ++userGeneration

  authState.ready = true
  authState.user = user
  authState.guest = user ? null : readGuest()
  authState.friends = []
  authState.balance = null
  emitAuth()

  if (!user) {
    resetAvatar()
    return
  }
  loadAvatar()
  loadFriends(generation)
  loadBalance(generation)
}

// --- Player events --------------------------------------------------------
// The game orbits on right-drag and never requests pointer lock itself, so a
// lone `false` at startup must not pause us forever. Only treat the event as a
// pause signal once we have actually seen lock held.
let sawPointerLock = false

function onPlayerEvent(event, data) {
  switch (event) {
    case 'respawn_request':
      resetPlayer(SPAWN)
      break
    case 'chat_message_sent':
      chat.push(data)
      break
    case 'pointer_lock_changed':
      if (data) {
        sawPointerLock = true
        setPaused(false)
        resume('pointer-lock')
      } else if (sawPointerLock) {
        setPaused(true)
        suspend('pointer-lock')
      }
      break
    default:
      break
  }
}

// --- Init -----------------------------------------------------------------
let initialised = false

export function init() {
  if (initialised) return
  initialised = true

  audio.install()
  sfx.preload()
  session.install()

  const SDK = sdk()
  if (!SDK) {
    // Standalone with the SDK blocked or offline: mark auth resolved so the UI
    // settles on the signed-out state instead of spinning forever.
    authState.ready = true
    emitAuth()
    return
  }

  try {
    // Always pass the slug: embedded play auto-provides it, but standalone
    // hosting and Bux purchases both need it explicitly.
    //
    // SDK.init() has an undocumented dev convenience: if it sees neither
    // apiUrl nor portalUrl AND the page origin is localhost/127.0.0.1, it
    // silently repoints both its API base and its auth-popup base at that
    // same origin (presumably for testing against a locally-run portal).
    // We don't run one, so showAuthPopup() would open OUR dev server's own
    // /auth route instead of the real bloxity.io login. Passing portalUrl
    // explicitly here — only while running on localhost — opts back into
    // the real portal. A real standalone deploy or embedded play never hits
    // this branch.
    const onLocalhost =
      typeof window !== 'undefined' &&
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    SDK.init(onLocalhost ? { gameSlug: GAME_SLUG, portalUrl: 'https://bloxity.io' } : { gameSlug: GAME_SLUG })
    authState.embedded = !!SDK.portal.isEmbeddedInLegion()

    SDK.game.loadingStep('Starting Laser Escape')

    registerSettings(SDK)

    // THE auth subscription. Fires immediately with current state.
    unsubscribers.push(SDK.auth.onUserChanged(onUser))

    unsubscribers.push(SDK.avatar.onAvatarChanged(() => loadAvatar()))
    unsubscribers.push(
      SDK.avatar.onProportionsChanged(() => {
        try {
          setProportions(SDK.avatar.getProportions())
        } catch {
          // Keep the last good proportions.
        }
      }),
    )

    unsubscribers.push(SDK.player.onEvent(onPlayerEvent))

    // Escape hands off to the portal's pause menu.
    setEscapeHandler(() => {
      setPaused(true)
      showMenu()
    })

    // Publish the room so invites resolve, and forward join notices.
    unsubscribers.push(
      session.subscribe((event, payload) => {
        if (event === 'room') SDK.game.updateRoom(payload.roomId, payload.partyId)
        else if (event === 'playerJoined') SDK.game.playerJoined(payload)
        else if (event === 'playerInRoom') SDK.game.playerInRoom(payload)
      }),
    )
    SDK.game.updateRoom(session.session.roomId, session.session.partyId)

    SDK.game.loadingStep('Ready')
  } catch (err) {
    console.warn('[bloxity] init failed; running without the SDK', err)
    authState.ready = true
    emitAuth()
  }
}

// Called from the first rendered frame: the game is interactive at that point,
// with or without a signed-in avatar.
let announcedFirstFrame = false

export function notifyFirstFrame() {
  if (announcedFirstFrame) return
  announcedFirstFrame = true
  const SDK = sdk()
  if (!SDK) return
  try {
    SDK.game.loadingEnd()
    SDK.game.gameplayStart()
  } catch {
    // Non-fatal.
  }
}

export function endGameplay() {
  const SDK = sdk()
  if (!SDK) return
  try {
    SDK.game.gameplayEnd()
  } catch {
    // Non-fatal.
  }
}

export function teardown() {
  for (const off of unsubscribers.splice(0)) {
    try {
      off()
    } catch {
      // Ignore: we are tearing down anyway.
    }
  }
  endGameplay()
}

// --- Auth actions ---------------------------------------------------------
export async function login() {
  const SDK = sdk()
  if (!SDK) return null
  // Keystrokes typed into the auth modal must not also drive WASD.
  suspend('auth')
  try {
    return await SDK.auth.showAuthPopup()
  } catch (err) {
    console.warn('[bloxity] showAuthPopup failed', err)
    return null
  } finally {
    resume('auth')
  }
}

export function logout() {
  const SDK = sdk()
  if (SDK) SDK.auth.logout()
}

// For a backend that wants to verify the identity server-side. Unused today —
// this game has no accounts of its own — but the seam is here.
export async function authenticateWithServer(url) {
  const SDK = sdk()
  if (!SDK) return null
  try {
    return await SDK.auth.authenticateWithServer(url)
  } catch {
    return null
  }
}

// --- Avatar actions -------------------------------------------------------
let customizerPoll = 0

export function toggleCustomizer() {
  const SDK = sdk()
  if (!SDK) return
  SDK.avatar.toggleCustomizer()
  watchCustomizer()
}

// The SDK exposes isCustomizerOpen() but no close event, so poll while it is
// open to know when to give input back. Runs only while the customizer is up.
function watchCustomizer() {
  const SDK = sdk()
  if (!SDK || customizerPoll) return
  if (!SDK.avatar.isCustomizerOpen()) return
  suspend('customizer')
  customizerPoll = setInterval(() => {
    if (!SDK.avatar.isCustomizerOpen()) {
      clearInterval(customizerPoll)
      customizerPoll = 0
      resume('customizer')
    }
  }, 250)
}

export async function applyProportions(partial) {
  const SDK = sdk()
  if (!SDK) return
  try {
    await SDK.avatar.setProportions(partial)
  } catch {
    // The change simply does not stick.
  }
}

export async function resetProportions() {
  const SDK = sdk()
  if (!SDK) return
  try {
    await SDK.avatar.resetProportions()
  } catch {
    // Ignore.
  }
}

// --- Social ---------------------------------------------------------------
export async function inviteFriend(userId) {
  const SDK = sdk()
  if (!SDK) return false
  try {
    // updateRoom FIRST, so the friend lands in the right room.
    SDK.game.updateRoom(session.session.roomId, session.session.partyId)
    return await SDK.social.inviteFriend(userId)
  } catch {
    return false
  }
}

export function getInviteLink() {
  const SDK = sdk()
  if (!SDK) return ''
  try {
    return SDK.social.getInviteFriendsLink({
      gameSlug: GAME_SLUG,
      roomId: session.session.roomId,
      partyId: session.session.partyId,
    })
  } catch {
    return ''
  }
}

export async function sendFriendRequest(userId) {
  const SDK = sdk()
  if (!SDK) return { success: false, error: 'SDK unavailable' }
  try {
    return await SDK.social.sendFriendRequest(userId)
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function refreshFriends() {
  return loadFriends(userGeneration)
}

// --- Bux ------------------------------------------------------------------
// Balance is a plain read and needs no server, so it is wired. Purchases are
// deliberately NOT wired: fulfillment arrives by a server-to-server webhook and
// this game has no backend, so a non-2xx auto-refunds and every grant would be
// free. When the backend and the Tech.md §3 economy land, call
// SDK.bux.requestPurchase(sku) here — sku only, never a price; the catalog is
// server-authoritative — and grant against the returned transactionId.
export async function refreshBalance() {
  return loadBalance(userGeneration)
}

// --- Portal ---------------------------------------------------------------
export function showMenu() {
  const SDK = sdk()
  if (!SDK) return
  try {
    SDK.portal.showMenu(true)
  } catch {
    // Ignore.
  }
}

export function requestFullscreen(on) {
  const SDK = sdk()
  if (!SDK) return
  try {
    if (on) SDK.portal.requestFullscreen()
    else SDK.portal.exitFullscreen()
  } catch {
    // Ignore.
  }
}

export function isInIframe() {
  const SDK = sdk()
  return SDK ? !!SDK.portal.isInIframe() : false
}

// Re-exported so components subscribe to settings without importing two modules.
export { subscribeSettings, settings }
