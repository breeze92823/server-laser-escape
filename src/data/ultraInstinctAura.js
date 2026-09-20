// Ultra Instinct's own full-body energy aura (Tech.md §4: src/data/ owns
// every tunable number) — swapped in for the shared violet fire trail (data/
// auraParticles.js) only while that specific tier is equipped (systems/
// ultraInstinctAura.js, gated on data/aura.js's ULTRA_INSTINCT_INDEX).
// Modeled on a reference image of a white-hot, full-body power-up aura:
// a bright core along the body's own vertical axis fading out through cyan
// to a deep blue-magenta at the outer edge, plus a wider burst cloud rising
// off the head. Unlike the fire trail (which spawns only near the feet),
// every particle here is placed directly across the player's own live
// height (systems/playerState.js player.dims.height) so the effect always
// covers head to toe regardless of avatar scale.

export const UI_AURA_POOL_SIZE = 900
export const UI_AURA_SPAWN_RATE = 700

export const UI_AURA_LIFETIME_MIN = 0.45
export const UI_AURA_LIFETIME_MAX = 0.9

// Fraction of spawns placed in the body-hugging "sheath" band (feet to just
// above the head) vs. the wider "crown" burst above the head — see
// spawnInto() in systems/ultraInstinctAura.js.
export const UI_AURA_SHEATH_SHARE = 0.55

// Sheath radius, in multiples of the player's own live collider radius
// (player.dims.radius) — flares out slightly from feet to head, like the
// reference image's shoulders-up bloom.
export const UI_AURA_SHEATH_RADIUS_BASE = 1.15
export const UI_AURA_SHEATH_RADIUS_TOP = 2.2
// Sheath height band, as a fraction of the player's own live height
// (player.dims.height) rather than a fixed meter value, so it always spans
// feet to head regardless of avatar scale.
export const UI_AURA_SHEATH_HEIGHT_MIN_FRAC = 0
export const UI_AURA_SHEATH_HEIGHT_MAX_FRAC = 1

// Crown: the wider burst cloud rising off the top of the head, widening the
// higher a particle spawns within the band. Max lowered to 0.75 of its
// original reach (1.7 -> 1.275) so the burst doesn't tower as far above the
// head; min stays anchored just below head height.
export const UI_AURA_CROWN_HEIGHT_MIN_FRAC = 0.85
export const UI_AURA_CROWN_HEIGHT_MAX_FRAC = 1.275
export const UI_AURA_CROWN_RADIUS_BASE = 1.5
export const UI_AURA_CROWN_RADIUS_TOP = 4.5

// Particles bias toward the body's own vertical axis (radial() below uses
// pow(random, 2.2)) so the core reads as a solid bright mass with the color
// bands thinning out toward the edge, rather than an even scatter.
export const UI_AURA_RADIAL_BIAS = 2.2

export const UI_AURA_SIZE_MIN = 0.05
export const UI_AURA_SIZE_MAX = 0.16

export const UI_AURA_RISE_MIN = 0.375
export const UI_AURA_RISE_MAX = 0.975

export const UI_AURA_SWAY_SPEED_MIN = 4
export const UI_AURA_SWAY_SPEED_MAX = 9
export const UI_AURA_SWAY_AMOUNT = 0.35

// Smaller than the fire trail's own drag (data/auraParticles.js) — this
// effect reads as enveloping the body, not streaming behind it, so it
// should barely bend with movement.
export const UI_AURA_WIND_DRAG = 0.06

export const UI_AURA_FADE_IN = 0.12
export const UI_AURA_FADE_OUT_START = 0.6
export const UI_AURA_SIZE_GROWTH = 0.7

// Three-stop radial color gradient, keyed by each particle's own distance
// from the body's vertical axis (aRadial, fixed at spawn) rather than by
// age: near-white along the axis, cyan through the body of the effect, deep
// blue-magenta at the outer rim — matching the reference image.
export const UI_AURA_CORE_COLOR = '#ffffff'
export const UI_AURA_MID_COLOR = '#4dd9ff'
export const UI_AURA_EDGE_COLOR = '#7a1fd6'
