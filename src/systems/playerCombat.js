// PVP hit-testing (Tech.md §5.1 style: framework-free, mutable module state,
// stepped once per frame from GameLoop right after systems/laser.js). Mirrors
// systems/wallHealth.js's split: step() tracks which remote player (if any)
// the beam is on this frame, strikeTarget() lands one discrete Action's worth
// of damage on it — falling back to strikeWall() when the beam is on a wall
// instead. Scoped entirely to the PVP zone (data/pvpZone.js): outside it
// neither side of a fight can hit or be hit, same as the real world can't
// reach in through data/pvpWall.js's glass.
import { laser } from './laser.js'
import { player } from './playerState.js'
import { remotePlayers, sendPlayerDamage } from './net.js'
import { strikeWall } from './wallHealth.js'
import { isInPvpZone } from '../data/pvpZone.js'
import { REMOTE_BODY } from '../data/net.js'
import { PVP_DAMAGE_PER_HIT } from '../data/playerHealth.js'

const R = REMOTE_BODY.RADIUS
const H = REMOTE_BODY.HEIGHT

// The remote player id the beam is on this frame, or null.
let targetId = null

// Ray (origin o, unit direction d) vs a sphere at c, radius r. Returns the
// entry distance along the ray, clamped to maxT, or Infinity if the ray
// never enters the sphere within that range (D is unit length, so the
// quadratic's `a` term is 1). If the origin is already inside the sphere —
// not expected in practice, the beam starts at the camera/gun, never inside
// another player — that counts as touching immediately (t = 0) rather than
// reporting no hit.
function raySphereEntry(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz
  const b = fx * dx + fy * dy + fz * dz
  const c = fx * fx + fy * fy + fz * fz - r * r
  const disc = b * b - c
  if (disc < 0) return Infinity
  const sq = Math.sqrt(disc)
  const t1 = -b - sq
  if (t1 >= 0) return t1 <= maxT ? t1 : Infinity
  const t2 = -b + sq
  return t2 >= 0 ? 0 : Infinity
}

// Ray vs the infinite cylinder of radius r wrapped around the axis through
// a, with unit direction (adx,ady,adz) and length axisLen — the straight
// "barrel" part of a capsule, the two rounded ends are raySphereEntry above
// at a and b. Solves for the ray parameter s where the ray's distance to the
// axis LINE equals r: projecting out the along-axis component turns that
// into a quadratic in s, same derivation as the old closest-approach solve
// (Ericson, "Real-Time Collision Detection" §5.1.9) but stopping at the
// surface instead of the nearest point. A valid wall hit must also land
// between the caps (axisT in [0, axisLen]) — outside that range belongs to
// one of the end spheres instead.
function rayCylinderEntry(ox, oy, oz, dx, dy, dz, ax, ay, az, adx, ady, adz, axisLen, r, maxT) {
  const px = ox - ax, py = oy - ay, pz = oz - az
  const u = dx * adx + dy * ady + dz * adz
  const A = 1 - u * u
  if (A < 1e-8) return Infinity // ray runs parallel to the axis: no wall to cross
  const p = px * adx + py * ady + pz * adz
  const pd = px * dx + py * dy + pz * dz
  const pp = px * px + py * py + pz * pz
  const B = 2 * (pd - p * u)
  const C = pp - p * p - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return Infinity
  const t = (-B - Math.sqrt(disc)) / (2 * A)
  if (t < 0 || t > maxT) return Infinity
  const axisT = p + t * u
  return axisT >= 0 && axisT <= axisLen ? t : Infinity
}

// True ray-vs-capsule surface intersection — the capsule matches the
// remote's own rendered hitbox (a->b = feet+R to head-R, radius r, same as
// data/net.js REMOTE_BODY) rather than a "close enough to the core line"
// distance check. Entry distance along the ray, or Infinity if it never
// touches the capsule within [0, maxT]. Because maxT is bounded by the
// laser's actual environment hit distance (systems/laser.js), a shot the
// ground or a wall stops first can geometrically never reach here — no
// separate "was it occluded" check needed, unlike the old closest-approach
// version.
function rayCapsuleEntry(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r, maxT) {
  const axisX = bx - ax, axisY = by - ay, axisZ = bz - az
  const axisLen = Math.hypot(axisX, axisY, axisZ)
  if (axisLen < 1e-6) return raySphereEntry(ox, oy, oz, dx, dy, dz, ax, ay, az, r, maxT)
  const adx = axisX / axisLen, ady = axisY / axisLen, adz = axisZ / axisLen
  const wall = rayCylinderEntry(ox, oy, oz, dx, dy, dz, ax, ay, az, adx, ady, adz, axisLen, r, maxT)
  const capA = raySphereEntry(ox, oy, oz, dx, dy, dz, ax, ay, az, r, maxT)
  const capB = raySphereEntry(ox, oy, oz, dx, dy, dz, bx, by, bz, r, maxT)
  return Math.min(wall, capA, capB)
}

export function step() {
  targetId = null
  if (!laser.active) return
  if (!isInPvpZone(player.position.x, player.position.z)) return

  // Hit-test against the SAME ray systems/laser.js actually fired (camera
  // origin/direction in the mouse-aim case, not a line reconstructed from
  // `start`/`end` — those two differ in third person, and testing the wrong
  // one is exactly what let clearly-aimed shots miss). `laser.end` always
  // lies on this ray, so its distance along it is the true environment range.
  const ox = laser.rayOrigin.x, oy = laser.rayOrigin.y, oz = laser.rayOrigin.z
  const dx = laser.rayDir.x, dy = laser.rayDir.y, dz = laser.rayDir.z
  const envDist = Math.hypot(laser.end.x - ox, laser.end.y - oy, laser.end.z - oz)
  if (envDist < 1e-6) return

  let bestT = envDist
  let bestId = null
  for (const [id, e] of remotePlayers) {
    if (!e.present || e.alpha < 0.5 || e.dead || e.hp <= 0) continue
    if (!isInPvpZone(e.rx, e.rz)) continue

    // bestT (not envDist) as maxT: a closer player found earlier this loop
    // shrinks the search range for every player checked after them, same
    // early-out envDist itself already gave over "unbounded ray". Radius is
    // the remote's actual rendered body radius (R) — no distance-widened aim
    // assist: that used to let shots landing metres wide of the character
    // still register as hits at range, which read as "damaged by nothing".
    const t = rayCapsuleEntry(
      ox, oy, oz, dx, dy, dz,
      e.rx, e.ry + R, e.rz,
      e.rx, e.ry + H - R, e.rz,
      R, bestT,
    )
    if (t > 0.01 && t < bestT) {
      bestT = t
      bestId = id
    }
  }

  if (bestId) {
    targetId = bestId
    // Clip the beam to the player's surface so it visibly lands on them
    // instead of passing through to whatever's behind (laser.js's own hit
    // convention: laser.hit true + laser.end at the strike point).
    laser.end.x = ox + dx * bestT
    laser.end.y = oy + dy * bestT
    laser.end.z = oz + dz * bestT
    laser.hit = true
  }
}

// One discrete Action's worth of damage (systems/actionTracker.js, same
// cadence as a wall strike). If the beam is on a live PVP target, report
// their next hp to the server (systems/net.js) — same client-authoritative
// trust model as wallHealth.js's strikeWall(): we never write the target's
// hp locally, systems/net.js adopts the server's echo into remotePlayers on
// a later frame, same as every other tracked remote stat. Falls back to
// strikeWall() when the beam isn't on a player, so systems/actionTracker.js
// only ever needs to call this one function.
//
// Fixed damage per hit (PVP_DAMAGE_PER_HIT = PLAYER_MAX_HP / 10): Power never
// enters into it — every player kills another in exactly 10 hits, regardless
// of either side's Power.
export function strikeTarget() {
  if (!targetId) return strikeWall()
  const e = remotePlayers.get(targetId)
  if (!e || e.dead || e.hp <= 0) return
  const next = Math.max(0, e.hp - PVP_DAMAGE_PER_HIT)
  sendPlayerDamage(targetId, next)
}
