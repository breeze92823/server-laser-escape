// Every tunable number for the Bloxity (Legion) SDK integration (Tech.md §4,
// rule 1: src/data/ owns the numbers). Systems and components read from here;
// no SDK constant is allowed to live in a component.

// TODO: replace with the slug this game is registered under on bloxity.io.
// Embedded play auto-provides the slug, but standalone hosting and Bux both
// need the real value. This is the only line that has to change.
export const GAME_SLUG = 'laser-escape'

export const AVATAR_CDN = 'https://static.bloxity.io/avatars'

// Profile picture shown for a guest (not signed in) or when a signed-in user
// has no `pfp`. A remote Bloxity asset — the <img> onError in
// components/hud/IdentityChip.jsx falls back to an inline silhouette so a
// blocked CDN never leaves an empty slot (same stance as Tech.md §5.6).
export const GUEST_PFP_URL =
  'https://static.bloxity.io/img/pfps/s0.png?width=128&quality=85&v=2'

// The base rig, measured from the shipped player.glb: origin at the feet, 6.4
// units tall at bind pose. Player.jsx's group origin is also the feet, so the
// model only needs a uniform scale to land in metres.
export const RIG_HEIGHT = 6.4

// Bind-pose values of the rig nodes the proportions drive, read from
// player.glb. Proportions are multipliers applied against these.
export const RIG = {
  root: 'Rig1',
  armOffsetX: 2, // ArmL_Offset.x, mirrored for ArmR_Offset
  legOffsetX: 0.6, // LegL_Offset.x, mirrored
  neckOffsetY: 0.6, // Neck_Offset.y
}

// getProportions() ranges, straight from the SDK spec. Values arrive from a
// remote portal, so everything is clamped before it reaches the scene graph.
export const PROPORTIONS = {
  height: { def: 1, min: 0.5, max: 1.6 },
  shoulderWidth: { def: 1, min: 0.5, max: 1.5 },
  armLength: { def: 1, min: 0.05, max: 3 },
  legOffsetX: { def: 1, min: -0.7, max: 5 },
  torsoScaleX: { def: 1, min: 0.3, max: 2 },
  neckHeight: { def: 1, min: 0.94, max: 1.2 },
  headScale: { def: 1, min: 0.3, max: 2.6 },
}

// Equipped-slot table. `part` slots replace the matching default_* mesh in the
// base rig; `item` slots are extra meshes parented to a bone.
//
// `bone` is where a part hangs if it arrives as a plain (non-skinned) mesh; a
// part that ships as a SkinnedMesh is rebound to the base skeleton instead.
// Names come from the shipped player.glb rig.
export const AVATAR_SLOTS = [
  { key: 'headId', kind: 'part', type: 'head', replaces: 'default_head', bone: 'Neck1' },
  { key: 'torsoId', kind: 'part', type: 'torso', replaces: 'default_torso', bone: 'Spine1' },
  { key: 'armLId', kind: 'part', type: 'arms', side: 'L', replaces: 'default_arm_L', bone: 'ArmL1' },
  { key: 'armRId', kind: 'part', type: 'arms', side: 'R', replaces: 'default_arm_R', bone: 'ArmR1' },
  { key: 'legLId', kind: 'part', type: 'legs', side: 'L', replaces: 'default_leg_L', bone: 'LegL1' },
  { key: 'legRId', kind: 'part', type: 'legs', side: 'R', replaces: 'default_leg_R', bone: 'LegR1' },
  { key: 'hatId', kind: 'item', type: 'hats', attach: 'Neck1' },
  { key: 'backId', kind: 'item', type: 'back', attach: 'Spine2' },
]

// '-1' / '' / 'undefined' / null all mean "nothing equipped, use the default".
export function isEquipped(id) {
  return id != null && id !== '' && id !== '-1' && id !== 'undefined' && id !== 'null'
}

export function partUrl(slot, id) {
  const suffix = slot.side ? `_${slot.side}` : ''
  return `${AVATAR_CDN}/parts/${slot.type}/${id}${suffix}.glb`
}

export function itemUrls(slot, id) {
  return {
    mesh: `${AVATAR_CDN}/items/${slot.type}/${id}.obj`,
    texture: `${AVATAR_CDN}/textures/${slot.type}/${id}.png`,
  }
}

export function skinUrl(id) {
  return `${AVATAR_CDN}/skins/${id}.png`
}

export const BASE_MODEL_URL = `${AVATAR_CDN}/player.glb`

// What a guest (no SDK, not signed in, or the avatar read failed) wears. An
// empty set renders the base rig exactly as it ships: the default_* head,
// torso, arms and legs, its embedded texture, and no hat/back. Every slot here
// is optional and 404s back to that same default (see applyPart in
// avatarModel.js), so dropping real cosmetic IDs from https://docs.bloxity.io
// in later is a one-line change and can never break the guest.
export const DEFAULT_EQUIPPED = {}

// --- Locomotion: the run cycle -----------------------------------------
// The base rig is R6-style: single-segment limbs (ArmL1/ArmR1/LegL1/LegR1) and
// a two-node spine, with no forearm/shin/foot bone to key. A run that "rigs to
// it perfectly" therefore has to be a four-bone contralateral swing plus a body
// bob — the same shape as a Roblox R6 "Run" clip, which is exactly why it fits
// this skeleton with no retargeting.
//
// If player.glb ships its own clip whose name matches `runClip`, avatarAnim.js
// plays that through an AnimationMixer instead and ignores every number below;
// these only drive the generated fallback.
export const GAIT = {
  runClip: /run|sprint|jog/i, // embedded clip name to prefer, when present
  idleClip: /idle|stand/i, // cross-faded under the run when present
  strideHz: 2.6, // full leg cycles per second at full speed
  legSwing: 0.9, // rad, peak LegL1/LegR1 rotation
  armSwing: 0.55, // rad, peak ArmL1/ArmR1 rotation (opposed to the same-side leg)
  lean: 0.12, // rad, forward pitch of Spine1 at full speed
  bob: 0.06, // m, vertical body bob (two beats per stride)
  swingAxis: 'x', // bone-local axis the limbs swing about; see avatarAnim.js probe
  blendHz: 8, // how fast the cycle eases in/out as speed changes

  // --- Idle: a slow breathing sway when the generated fallback has nothing
  // else to animate (below is only reached once the walk cycle's own amp has
  // eased down to ~0) -----------------------------------------------------
  swayAxis: 'z', // bone-local axis for the idle arms' lateral sway
  idleSwayHz: 1.6, // rad/s, the breathing cycle's speed
  idleArmSway: 0.07, // rad, ArmL1/ArmR1's resting lateral offset
  idleArmSwayAmp: 0.03, // rad, extra sway riding on top of the offset
  idleSpineSway: 0.02, // rad, Spine1's breathing tilt
  idleBob: 0.03, // m, vertical body bob while idle

  // --- Airborne: jumping or falling -----------------------------------
  airborneLegL: -0.55, // rad, LegL1 swept back
  airborneLegR: 0.3, // rad, LegR1 swept forward
  airborneArm: -2.1, // rad, both arms thrown up
  airborneLean: -0.1, // rad, Spine1 leaned back slightly

  // --- Turning: how fast the visual mesh catches up to player.facing ---
  turnRate: 0.001, // base of 1 - turnRate^delta; smaller = snappier turn
}

// --- Settings -------------------------------------------------------------
// All SDK setting values are strings. Registering a listener is what makes the
// control appear in the portal menu, so every key here has something behind it.
export const SETTINGS = {
  master_volume: { def: '80', type: 'number', min: 0, max: 100 },
  music_volume: { def: '80', type: 'number', min: 0, max: 100 },
  graphics_quality: { def: 'High', type: 'enum', values: ['Low', 'Medium', 'High', 'Ultra'] },
  show_fps: { def: 'false', type: 'bool' },
  camera_sensitivity: { def: '1', type: 'number', min: 0.1, max: 5 },
  enable_chat: { def: 'true', type: 'bool' },
  fullscreen: { def: 'false', type: 'bool' },
  background_transparency: { def: '0.9', type: 'number', min: 0.2, max: 1 },
}

// Device pixel ratio per quality tier. Tech.md §7 clamps dpr to [1, 1.5]; Ultra
// sits at the ceiling rather than exceeding it.
export const QUALITY_DPR = { Low: 1, Medium: 1.25, High: 1.5, Ultra: 1.5 }

// Shadow-casting light per quality tier (Tech.md §7). Low keeps the original
// shadow-free behaviour; Medium and up get the player-following shadow-sun.
// A user-elected tier gate, not runtime-adaptive scaling — same category as
// QUALITY_DPR above.
export const QUALITY_SHADOWS = { Low: false, Medium: true, High: true, Ultra: true }

export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n
}

// Coerce one raw SDK string against its SETTINGS entry.
export function coerceSetting(key, raw) {
  const spec = SETTINGS[key]
  if (!spec) return raw
  const value = raw === '' || raw == null ? spec.def : raw
  if (spec.type === 'bool') return value === 'true'
  if (spec.type === 'enum') {
    return spec.values.includes(value) ? value : spec.def
  }
  const n = Number(value)
  return clamp(Number.isFinite(n) ? n : Number(spec.def), spec.min, spec.max)
}

// The chat line keeps a short scrollback; it is a HUD readout, not a log.
export const CHAT_MAX_LINES = 6
