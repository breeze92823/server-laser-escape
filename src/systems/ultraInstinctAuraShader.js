// GLSL for Ultra Instinct's full-body energy aura (components/
// UltraInstinctAura.jsx). Trajectory math mirrors systems/
// auraParticleShader.js's shared vertex shader (rise/sway/wind-bend as a
// closed-form function of age, evaluated once per vertex on the GPU — see
// that file for why), but adds one more attribute: aRadial, each particle's
// fixed 0..1 distance from the body's own vertical axis at spawn (systems/
// ultraInstinctAura.js), which the fragment shader below uses as its color
// gradient key instead of age. That's what gives the effect a bright core
// along the body with color fading outward at a fixed radius, rather than
// the fire trail's core-to-edge fade over each particle's lifetime.
export const UI_AURA_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPixelScale;
  uniform float uFadeIn;
  uniform float uFadeOutStart;
  uniform float uSizeGrowth;
  uniform float uSwayAmount;

  attribute float aBirth;
  attribute float aLifetime;
  attribute float aRise;
  attribute vec2 aSway;
  attribute vec2 aWind;
  attribute float aSize;
  attribute float aRadial;

  varying float vAlpha;
  varying float vRadial;

  void main() {
    float age = uTime - aBirth;
    bool deadOrUnspawned = age < 0.0 || age >= aLifetime;
    float ageFrac = clamp(age / aLifetime, 0.0, 1.0);

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
    vRadial = aRadial;
    gl_Position = projectionMatrix * mvPosition;
  }
`

// Three-stop radial gradient — white core along the axis, through cyan, out
// to deep blue-magenta at the rim — additively blended for the glow.
export const UI_AURA_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCoreColor;
  uniform vec3 uMidColor;
  uniform vec3 uEdgeColor;
  varying float vAlpha;
  varying float vRadial;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv * vec2(1.7, 1.15));
    float mask = smoothstep(0.5, 0.0, dist);
    float alpha = mask * vAlpha;
    if (alpha < 0.02) discard;
    vec3 color = vRadial < 0.5
      ? mix(uCoreColor, uMidColor, vRadial * 2.0)
      : mix(uMidColor, uEdgeColor, (vRadial - 0.5) * 2.0);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`
