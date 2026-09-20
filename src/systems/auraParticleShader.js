// Shared GLSL for the Aura magical fire trail (components/AuraParticles.jsx).
// Every particle's whole trajectory — rise, sideways sway, and the backward
// "wind" bend from the player's own movement — is a closed-form function of
// its own age, sampled once per vertex on the GPU. That's the whole
// optimization: systems/auraParticles.js only ever writes a few floats into
// a typed array when a particle spawns; there is no per-particle JS
// simulation loop and no per-frame CPU matrix math (contrast components/
// LaserParticles.jsx's InstancedMesh, which does need a JS loop because it
// can't run a vertex shader of its own).
//
// aWind is captured once at spawn (-playerVelocity.xz * a per-pool drag
// tunable, systems/auraParticles.js) rather than integrated frame-by-frame —
// an analytic stand-in for continuously accumulating drag that only needs to
// look right over a particle's fraction-of-a-second life, not solve an ODE.
export const AURA_PARTICLE_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPixelScale;
  uniform float uFadeIn;
  uniform float uFadeOutStart;
  uniform float uSizeGrowth;
  uniform float uSwayAmount;

  // The built-in position attribute (auto-declared by THREE.ShaderMaterial)
  // doubles as the world-space spawn point here — there's no mesh transform
  // to offset it against (components/AuraParticles.jsx leaves the Points at
  // the origin), so it's already exactly what a per-particle spawn
  // attribute would be.
  attribute float aBirth;   // uTime at spawn
  attribute float aLifetime;
  attribute float aRise;    // upward speed, m/s
  attribute vec2 aSway;     // x: sway speed, y: sway phase
  attribute vec2 aWind;     // world-space xz bend reached by end of life
  attribute float aSize;

  varying float vAlpha;
  varying float vAgeFrac;

  void main() {
    float age = uTime - aBirth;
    bool deadOrUnspawned = age < 0.0 || age >= aLifetime;
    float ageFrac = clamp(age / aLifetime, 0.0, 1.0);

    // smoothstep(0, 1, ageFrac): the bend ramps in as the particle ages
    // rather than snapping to its full drift immediately.
    float bend = ageFrac * ageFrac * (3.0 - 2.0 * ageFrac);
    vec3 bendOffset = vec3(aWind.x, 0.0, aWind.y) * bend;

    float rise = age * aRise;
    float sway = sin(age * aSway.x + aSway.y) * uSwayAmount * ageFrac;

    vec3 worldPos = position + bendOffset + vec3(sway, rise, sway * 0.6);
    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);

    float sizeMul = mix(1.0, uSizeGrowth, ageFrac);
    gl_PointSize = deadOrUnspawned ? 0.0 : aSize * sizeMul * uPixelScale / -mvPosition.z;

    vAlpha = deadOrUnspawned
      ? 0.0
      : smoothstep(0.0, uFadeIn, ageFrac) * (1.0 - smoothstep(uFadeOutStart, 1.0, ageFrac));
    vAgeFrac = ageFrac;
    gl_Position = projectionMatrix * mvPosition;
  }
`

// Fire: core -> edge color lerp over the particle's age (the two-tone flame
// gradient), premultiplied for THREE.AdditiveBlending so faint tails don't
// haze into a grey box.
export const AURA_FIRE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying float vAlpha;
  varying float vAgeFrac;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv * vec2(1.7, 1.15));
    float mask = smoothstep(0.5, 0.0, dist);
    float alpha = mask * vAlpha;
    if (alpha < 0.02) discard;
    vec3 color = mix(uCoreColor, uEdgeColor, vAgeFrac);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`
