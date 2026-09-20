// Equipped-Aura magical fire trail tunables (Tech.md §4: src/data/ owns
// every tunable number). Rendered as one GPU-animated THREE.Points cloud
// (see systems/auraParticleShader.js) rather than CPU-simulated instances —
// the vertex shader evaluates each particle's whole trajectory as a function
// of its age, so the only per-frame CPU work is writing a handful of floats
// into a typed array when a new particle spawns (systems/auraParticles.js)
// and nudging two uniforms (systems/auraParticles.js + components/
// AuraParticles.jsx). That's what makes it cheap even on a phone GPU: no
// per-particle JS math, no per-particle matrix composition, one draw call.

// Fixed pool size — the GPU buffer is allocated once at this capacity and
// never resized (Tech.md §7: no per-frame allocation, no growing buffers).
// Sized well above spawn-rate * lifetime so a full trail never runs out of
// slots mid-burst.
export const FIRE_POOL_SIZE = 3840

// New flame particles spawned per second while an aura is equipped.
export const FIRE_SPAWN_RATE = 3120

export const FIRE_LIFETIME_MIN = 0.35
export const FIRE_LIFETIME_MAX = 0.65

// Spawn ring around the player's feet, and how high above them flames start.
export const FIRE_SPAWN_RADIUS = 0.66
export const FIRE_SPAWN_HEIGHT_MIN = 0.06
export const FIRE_SPAWN_HEIGHT_MAX = 0.9

// Deliberately tiny and numerous — "lots of small particles" reads as a
// denser flame than fewer big ones spawned at the same fill rate.
export const FIRE_SIZE_MIN = 0.05
export const FIRE_SIZE_MAX = 0.12

// Upward drift speed, m/s (sampled per particle at spawn — no per-frame
// integration, the shader just multiplies this by the particle's own age).
export const FIRE_RISE_MIN = 1.1
export const FIRE_RISE_MAX = 1.9

// Per-particle lateral sway (licking-flame look), sampled at spawn.
export const FIRE_SWAY_SPEED_MIN = 5
export const FIRE_SWAY_SPEED_MAX = 10
export const FIRE_SWAY_AMOUNT = 0.22

// How far a particle ultimately drifts opposite the player's spawn-time
// velocity by the end of its life — this is what makes the trail bend and
// stream out behind the player while moving. Tuned as a fraction of player
// speed (playerMovement.js SPEED=6) rather than real drag physics, since a
// short-lived particle only needs to look right, not solve an ODE.
export const FIRE_WIND_DRAG = 0.12

// Alpha fades in over the first fraction of life and out over the last
// fraction; size shrinks to this fraction of its start size by end of life
// (a shrinking flame tip).
export const FIRE_FADE_IN = 0.08
export const FIRE_FADE_OUT_START = 0.55
export const FIRE_SIZE_GROWTH = 0.5

// Fixed violet core -> edge gradient (no longer sourced from the equipped
// tier's own color in data/aura.js — every aura now renders the same violet
// magical-fire trail), lerped per particle over its age and additively
// blended for the glowing look.
export const FIRE_CORE_COLOR = '#e6ccff'
export const FIRE_EDGE_COLOR = '#6a0dad'
