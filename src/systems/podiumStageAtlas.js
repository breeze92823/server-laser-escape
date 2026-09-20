// The one texture the `podium_stage` prop uses: a single 1024^2 canvas atlas
// holding the wood grains, the dark trim, the sign's brushed-metal cap and the
// unique neon sign face. Framework-free (Tech.md rule 2).
//
// Generated, not downloaded — the same trick Ground.jsx / BuildingBlocks.jsx /
// WallProp.jsx use: procedural detail costs nothing to ship and stays one
// texture in GPU memory (Tech.md §7). Everything the model needs lives in this
// one image, so the whole prop is two materials (lit wood + unlit sign face)
// over one map, i.e. two draw calls.
//
// Layout, region sizes and the palette are data (data/podiumStage.js ATLAS /
// PODIUM_STAGE_COLORS). Wood regions are painted seamlessly along U so a face
// wider than one grain pass tiles without a visible join; the sign region is
// unique and never tiled.
import * as THREE from 'three'
import { ATLAS, PODIUM_STAGE_COLORS as C, SIGN_TEXT, TARGET_SIGN_TEXT } from '../data/podiumStage.js'

// The prop is now placed twice in the hub (data/podiumStage.js
// PODIUM_STAGE_HUB_TRANSFORM "POWER", PODIUM_STAGE_TARGET_TRANSFORM
// "TARGETS"), each wanting different sign artwork baked into the same
// canvas layout — so the atlas is keyed by sign text below rather than
// being a single singleton, one canvas (and texture) per distinct string,
// each still shared by every instance that asks for that same text.

// Deterministic PRNG (mulberry32) — the grain must be identical across
// reloads rather than reshuffling every session, and identical between the
// runtime texture and an exported GLB's baked one.
function makeRand(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- wood ----------------------------------------------------------------
// One wood region: flat base, long grain lines running along U (so the region
// is seamless left-to-right — a line that leaves the right edge is redrawn
// entering the left), a few elliptical knots, and a soft vignette so adjacent
// planks in the model do not read as one flat sheet.
function paintWood(g, [x, y, w, h], base, grain, light, seed) {
  const rand = makeRand(seed)
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()

  g.fillStyle = base
  g.fillRect(x, y, w, h)

  // broad tonal banding across V (plank-to-plank colour variation)
  const bands = 7
  for (let i = 0; i < bands; i++) {
    const by = y + (i * h) / bands
    const bh = h / bands
    g.fillStyle = i % 2 ? light : grain
    g.globalAlpha = 0.06 + rand() * 0.05
    g.fillRect(x, by, w, bh)
  }

  // grain lines: each is a sine-warped polyline spanning the full width, so
  // both ends sit at the same V and the region tiles along U.
  g.globalAlpha = 1
  g.lineCap = 'round'
  const lines = 150
  for (let i = 0; i < lines; i++) {
    const v = y + rand() * h
    const amp = 1.5 + rand() * 5
    const waves = 1 + Math.floor(rand() * 3) // whole waves => seamless ends
    const phase = rand() * Math.PI * 2
    g.strokeStyle = rand() < 0.35 ? light : grain
    g.globalAlpha = 0.12 + rand() * 0.3
    g.lineWidth = 0.6 + rand() * 2.2
    g.beginPath()
    for (let px = 0; px <= w; px += 6) {
      const t = px / w
      const vy = v + Math.sin(phase + t * waves * Math.PI * 2) * amp
      if (px === 0) g.moveTo(x + px, vy)
      else g.lineTo(x + px, vy)
    }
    g.stroke()
  }

  // knots: a few concentric ellipses, drawn again shifted by +/- w so one
  // straddling an edge continues on the other side.
  for (let k = 0; k < 3; k++) {
    const kx = x + rand() * w
    const ky = y + rand() * h
    const kr = 6 + rand() * 14
    for (const shift of [-w, 0, w]) {
      for (let r = kr; r > 1.5; r -= 2.2) {
        g.strokeStyle = r < kr * 0.45 ? grain : light
        g.globalAlpha = 0.35
        g.lineWidth = 1.1
        g.beginPath()
        g.ellipse(kx + shift, ky, r, r * 0.55, 0.4, 0, Math.PI * 2)
        g.stroke()
      }
    }
  }

  // vignette: slightly darker toward the region's V edges, which reads as the
  // shaded corner of a plank once the mesh is lit.
  const vg = g.createLinearGradient(0, y, 0, y + h)
  vg.addColorStop(0, 'rgba(0,0,0,0.16)')
  vg.addColorStop(0.5, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.16)')
  g.globalAlpha = 1
  g.fillStyle = vg
  g.fillRect(x, y, w, h)
  g.restore()
}

// --- brushed metal -------------------------------------------------------
function paintMetal(g, [x, y, w, h], base, light, seed) {
  const rand = makeRand(seed)
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = base
  g.fillRect(x, y, w, h)
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = rand() < 0.5 ? light : '#6e737a'
    g.globalAlpha = 0.1 + rand() * 0.22
    g.lineWidth = 0.5 + rand() * 1.6
    const ly = y + rand() * h
    g.beginPath()
    g.moveTo(x, ly)
    g.lineTo(x + w, ly)
    g.stroke()
  }
  g.restore()
}

// --- the sign face -------------------------------------------------------
// Dark ground, a double-stroked white "neon" rounded rectangle with a warm
// falloff either side of it, the sign text in the middle and an icon
// flanking each end — a red/orange burst star for POWER, a bullseye for
// TARGETS — the whole lit look of the sign, baked. Drawn unlit at runtime
// (MeshBasicMaterial), so these pixels ARE the emission: no alpha, no glow
// geometry, nothing for a post pass to do (Tech.md §7).
function paintStar(g, cx, cy, r, points, inner, red, hot) {
  const step = Math.PI / points
  // soft halo
  const halo = g.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9)
  halo.addColorStop(0, 'rgba(255,150,90,0.55)')
  halo.addColorStop(0.45, 'rgba(224,35,52,0.28)')
  halo.addColorStop(1, 'rgba(224,35,52,0)')
  g.fillStyle = halo
  g.beginPath()
  g.arc(cx, cy, r * 1.9, 0, Math.PI * 2)
  g.fill()

  const spike = (radius, fill) => {
    g.beginPath()
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? radius : radius * inner
      const a = -Math.PI / 2 + i * step
      const px = cx + Math.cos(a) * rad
      const py = cy + Math.sin(a) * rad
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fillStyle = fill
    g.fill()
  }
  spike(r, red)
  spike(r * 0.52, hot)
}

// Bullseye flanking the TARGETS sign instead of the burst star — same warm
// halo treatment, alternating rings in the sign's own ink/red/hot colours so
// it reads as one family of "neon icon" with paintStar.
function paintBullseye(g, cx, cy, r, ink, red, hot) {
  const halo = g.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9)
  halo.addColorStop(0, 'rgba(255,150,90,0.55)')
  halo.addColorStop(0.45, 'rgba(224,35,52,0.28)')
  halo.addColorStop(1, 'rgba(224,35,52,0)')
  g.fillStyle = halo
  g.beginPath()
  g.arc(cx, cy, r * 1.9, 0, Math.PI * 2)
  g.fill()

  const rings = [
    [r, ink],
    [r * 0.74, red],
    [r * 0.48, ink],
    [r * 0.22, hot],
  ]
  for (const [radius, fill] of rings) {
    g.beginPath()
    g.arc(cx, cy, radius, 0, Math.PI * 2)
    g.fillStyle = fill
    g.fill()
  }
}

function paintSign(g, [x, y, w, h], signText) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()

  g.fillStyle = C.signBase
  g.fillRect(x, y, w, h)

  // the neon frame: a warm wide stroke (the falloff) under a hard white core
  const m = Math.round(h * 0.13) // frame inset from the face edge
  const rr = (inset, radius) => {
    const rx = x + inset
    const ry = y + inset
    const rw = w - inset * 2
    const rh = h - inset * 2
    g.beginPath()
    g.moveTo(rx + radius, ry)
    g.lineTo(rx + rw - radius, ry)
    g.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius)
    g.lineTo(rx + rw, ry + rh - radius)
    g.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh)
    g.lineTo(rx + radius, ry + rh)
    g.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius)
    g.lineTo(rx, ry + radius)
    g.quadraticCurveTo(rx, ry, rx, ry + radius)
    g.closePath()
  }

  g.lineJoin = 'round'
  for (const [width, color, alpha] of [
    [22, C.signGlow, 0.18],
    [13, C.signGlow, 0.35],
    [7, C.signNeon, 0.85],
    [3.5, C.signNeon, 1],
  ]) {
    g.globalAlpha = alpha
    g.lineWidth = width
    g.strokeStyle = color
    rr(m, 10)
    g.stroke()
  }
  g.globalAlpha = 1

  // the sign text, and a flanking icon either side of it
  const cy = y + h / 2
  g.font = `700 ${Math.round(h * 0.42)}px "Trebuchet MS", "Arial Black", Arial, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = C.signInk
  g.shadowColor = 'rgba(255,235,190,0.75)'
  g.shadowBlur = 14
  g.fillText(signText, x + w / 2, cy + h * 0.01)
  g.shadowBlur = 0

  const starR = h * 0.17
  const textHalf = g.measureText(signText).width / 2
  const starX = Math.min(w / 2 - m - starR * 1.6, textHalf + starR * 2.1)
  if (signText === TARGET_SIGN_TEXT) {
    paintBullseye(g, x + w / 2 - starX, cy, starR, C.signInk, C.starRed, C.starHot)
    paintBullseye(g, x + w / 2 + starX, cy, starR, C.signInk, C.starRed, C.starHot)
  } else {
    paintStar(g, x + w / 2 - starX, cy, starR, 6, 0.4, C.starRed, C.starHot)
    paintStar(g, x + w / 2 + starX, cy, starR, 6, 0.4, C.starRed, C.starHot)
  }

  g.restore()
}

// --- the atlas -----------------------------------------------------------
// Keyed by sign text: every part of the atlas except the sign region paints
// identically regardless of text, but re-running the whole paint per key is
// simpler than splicing just the sign region into a shared canvas, and this
// still only runs once per distinct string (data/podiumStage.js only defines
// two: SIGN_TEXT "POWER" and TARGET_SIGN_TEXT "TARGETS").
const atlases = new Map()

function paintAtlas(signText) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = ATLAS.size
  const g = canvas.getContext('2d')
  // Anything not covered by a region is never sampled, but a mid-wood fill
  // keeps a stray UV from reading as a bright hole.
  g.fillStyle = C.oakBase
  g.fillRect(0, 0, ATLAS.size, ATLAS.size)

  const r = ATLAS.regions
  paintWood(g, r.oak, C.oakBase, C.oakGrain, C.oakLight, 0x51f00d)
  paintWood(g, r.walnut, C.walnutBase, C.walnutGrain, C.walnutLight, 0x2b71c3)
  paintWood(g, r.trim, C.trimBase, C.trimGrain, C.walnutBase, 0x7c3a19)
  paintMetal(g, r.metal, C.metalBase, C.metalGrain, 0x1de9a4)
  paintSign(g, r.sign, signText)
  return canvas
}

// One texture per distinct sign text, built on first use and shared by every
// instance of the prop asking for that text (the same module-level-singleton
// idea WallProp.jsx uses for its crack bitmap, just keyed instead of solo).
// Mipmapped and sRGB, anisotropy left at 1 per Tech.md §7.
export function getPodiumStageAtlas(signText = SIGN_TEXT) {
  let atlas = atlases.get(signText)
  if (!atlas) {
    atlas = new THREE.CanvasTexture(paintAtlas(signText))
    atlas.colorSpace = THREE.SRGBColorSpace
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping
    atlas.generateMipmaps = true
    atlas.minFilter = THREE.LinearMipmapLinearFilter
    atlas.magFilter = THREE.LinearFilter
    atlas.anisotropy = 1
    atlas.name = `podium_stage_atlas:${signText}`
    atlas.needsUpdate = true
    atlases.set(signText, atlas)
  }
  return atlas
}

// A region as a UV rect in 0..1 texture space, inset by ATLAS.padding pixels
// so a mip level cannot pull a neighbouring region's pixels into an edge.
// V is flipped here: canvas Y grows downward, UV V grows upward, and the
// texture keeps three's default flipY (which the glTF exporter also accounts
// for, so a baked GLB samples the same pixels).
export function regionUv(name) {
  const region = ATLAS.regions[name]
  if (!region) throw new Error(`podiumStageAtlas: unknown region "${name}"`)
  const [x, y, w, h] = region
  const s = ATLAS.size
  const p = ATLAS.padding
  return {
    x: (x + p) / s,
    y: 1 - (y + h - p) / s,
    w: (w - p * 2) / s,
    h: (h - p * 2) / s,
  }
}

// Disposal is deliberately not offered: the atlas is a process-wide singleton
// shared by every mounted instance, exactly like WallProp's crack texture.
// If the prop ever becomes streamable, refcount it the way propModel.js does.
