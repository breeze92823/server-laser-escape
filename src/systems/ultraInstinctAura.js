// Ultra Instinct's full-body energy aura (Tech.md §5.1 style: framework-
// free, mutable singleton pool, stepped once per frame from GameLoop) —
// sibling to systems/auraParticles.js's shared violet fire trail, but only
// ever spawns while ULTRA_INSTINCT_INDEX is the equipped tier (data/
// aura.js). Same GPU-driven-trajectory approach as the fire trail: this
// module only ever writes a handful of floats into a typed array when a
// particle (re)spawns, everything else is evaluated per-vertex on the GPU
// from those floats plus a shared uTime uniform — see
// systems/ultraInstinctAuraShader.js and components/UltraInstinctAura.jsx.
import { player } from './playerState.js'
import { useGameStore } from '../store/useGameStore.js'
import { ULTRA_INSTINCT_INDEX } from '../data/aura.js'
import { auraClock } from './auraParticles.js'
import {
  UI_AURA_POOL_SIZE,
  UI_AURA_SPAWN_RATE,
  UI_AURA_LIFETIME_MIN,
  UI_AURA_LIFETIME_MAX,
  UI_AURA_SHEATH_SHARE,
  UI_AURA_SHEATH_RADIUS_BASE,
  UI_AURA_SHEATH_RADIUS_TOP,
  UI_AURA_SHEATH_HEIGHT_MIN_FRAC,
  UI_AURA_SHEATH_HEIGHT_MAX_FRAC,
  UI_AURA_CROWN_HEIGHT_MIN_FRAC,
  UI_AURA_CROWN_HEIGHT_MAX_FRAC,
  UI_AURA_CROWN_RADIUS_BASE,
  UI_AURA_CROWN_RADIUS_TOP,
  UI_AURA_RADIAL_BIAS,
  UI_AURA_SIZE_MIN,
  UI_AURA_SIZE_MAX,
  UI_AURA_RISE_MIN,
  UI_AURA_RISE_MAX,
  UI_AURA_SWAY_SPEED_MIN,
  UI_AURA_SWAY_SPEED_MAX,
  UI_AURA_WIND_DRAG,
} from '../data/ultraInstinctAura.js'

// The pool's typed-array attributes. Same shape as systems/auraParticles.js's
// pool plus `radial` (each particle's fixed 0..1 distance from the body's
// own vertical axis, sampled once at spawn — the fragment shader's 3-stop
// color gradient key, see systems/ultraInstinctAuraShader.js). components/
// UltraInstinctAura.jsx wraps each array in a THREE.BufferAttribute
// directly over this same memory and uploads only the ranges dirtyRanges
// marks below, exactly like the fire trail's pool.
function makePool(size) {
  return {
    size,
    nextSlot: 0,
    spawnAccumulator: 0,
    offset: new Float32Array(size * 3),
    // Birth defaults far in the past so every slot starts already "dead"
    // (age >> lifetime) instead of visible at the world origin on frame one.
    birth: new Float32Array(size).fill(-1e6),
    lifetime: new Float32Array(size).fill(1),
    rise: new Float32Array(size),
    sway: new Float32Array(size * 2),
    wind: new Float32Array(size * 2),
    particleSize: new Float32Array(size),
    radial: new Float32Array(size),
    dirtyRanges: [],
  }
}

export const uiAuraPool = makePool(UI_AURA_POOL_SIZE)

function spawnInto(pool, windX, windZ) {
  const i = pool.nextSlot
  pool.nextSlot = (pool.nextSlot + 1) % pool.size

  const height = player.dims.height
  const radius = player.dims.radius

  // Body-hugging "sheath" (feet to head) vs. the wider "crown" burst above
  // the head — see data/ultraInstinctAura.js for the two bands' shapes.
  const inSheath = Math.random() < UI_AURA_SHEATH_SHARE
  let heightFrac
  let maxRadiusMul
  if (inSheath) {
    heightFrac = UI_AURA_SHEATH_HEIGHT_MIN_FRAC + Math.random() * (UI_AURA_SHEATH_HEIGHT_MAX_FRAC - UI_AURA_SHEATH_HEIGHT_MIN_FRAC)
    const bandFrac = (heightFrac - UI_AURA_SHEATH_HEIGHT_MIN_FRAC) / (UI_AURA_SHEATH_HEIGHT_MAX_FRAC - UI_AURA_SHEATH_HEIGHT_MIN_FRAC)
    maxRadiusMul = UI_AURA_SHEATH_RADIUS_BASE + bandFrac * (UI_AURA_SHEATH_RADIUS_TOP - UI_AURA_SHEATH_RADIUS_BASE)
  } else {
    heightFrac = UI_AURA_CROWN_HEIGHT_MIN_FRAC + Math.random() * (UI_AURA_CROWN_HEIGHT_MAX_FRAC - UI_AURA_CROWN_HEIGHT_MIN_FRAC)
    const bandFrac = (heightFrac - UI_AURA_CROWN_HEIGHT_MIN_FRAC) / (UI_AURA_CROWN_HEIGHT_MAX_FRAC - UI_AURA_CROWN_HEIGHT_MIN_FRAC)
    maxRadiusMul = UI_AURA_CROWN_RADIUS_BASE + bandFrac * (UI_AURA_CROWN_RADIUS_TOP - UI_AURA_CROWN_RADIUS_BASE)
  }

  const maxRadius = maxRadiusMul * radius
  // Biased toward 0 so the axis reads as a solid bright core, thinning out
  // toward the edge, rather than an even scatter across the disc.
  const radialFrac = Math.pow(Math.random(), UI_AURA_RADIAL_BIAS)
  const r = radialFrac * maxRadius
  const angle = Math.random() * Math.PI * 2

  pool.offset[i * 3 + 0] = player.position.x + Math.cos(angle) * r
  pool.offset[i * 3 + 1] = player.position.y + heightFrac * height
  pool.offset[i * 3 + 2] = player.position.z + Math.sin(angle) * r

  pool.birth[i] = auraClock.elapsed
  pool.lifetime[i] = UI_AURA_LIFETIME_MIN + Math.random() * (UI_AURA_LIFETIME_MAX - UI_AURA_LIFETIME_MIN)
  pool.rise[i] = UI_AURA_RISE_MIN + Math.random() * (UI_AURA_RISE_MAX - UI_AURA_RISE_MIN)
  pool.sway[i * 2 + 0] = UI_AURA_SWAY_SPEED_MIN + Math.random() * (UI_AURA_SWAY_SPEED_MAX - UI_AURA_SWAY_SPEED_MIN)
  pool.sway[i * 2 + 1] = Math.random() * Math.PI * 2
  pool.wind[i * 2 + 0] = windX * UI_AURA_WIND_DRAG
  pool.wind[i * 2 + 1] = windZ * UI_AURA_WIND_DRAG
  pool.particleSize[i] = UI_AURA_SIZE_MIN + Math.random() * (UI_AURA_SIZE_MAX - UI_AURA_SIZE_MIN)
  pool.radial[i] = radialFrac
}

function stepPool(pool, dt, spawning, windX, windZ) {
  pool.dirtyRanges.length = 0
  if (!spawning) {
    pool.spawnAccumulator = 0
    return
  }
  pool.spawnAccumulator += UI_AURA_SPAWN_RATE * dt
  if (pool.spawnAccumulator > pool.size) pool.spawnAccumulator = pool.size

  const spawnStart = pool.nextSlot
  let spawnCount = 0
  while (pool.spawnAccumulator >= 1) {
    spawnInto(pool, windX, windZ)
    pool.spawnAccumulator -= 1
    spawnCount += 1
  }
  if (spawnCount === 0) return

  if (spawnCount >= pool.size) {
    pool.dirtyRanges.push({ start: 0, count: pool.size })
  } else if (spawnStart + spawnCount <= pool.size) {
    pool.dirtyRanges.push({ start: spawnStart, count: spawnCount })
  } else {
    // Wrapped past the end of the ring buffer mid-burst.
    const tailCount = pool.size - spawnStart
    pool.dirtyRanges.push({ start: spawnStart, count: tailCount })
    pool.dirtyRanges.push({ start: 0, count: spawnCount - tailCount })
  }
}

export function step(dt) {
  const equipped = useGameStore.getState().equippedAura === ULTRA_INSTINCT_INDEX
  const windX = -player.velocity.x
  const windZ = -player.velocity.z
  stepPool(uiAuraPool, dt, equipped, windX, windZ)
}
