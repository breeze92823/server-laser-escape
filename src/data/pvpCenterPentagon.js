// A new landmark prop, not sourced from the .blend: a stack of pentagon
// prisms marking the middle of the Pvp zone (data/pvpBlocks.js, data/
// pvpWall.js), fully code-generated the same way as TargetGroundMat.jsx.
//
// Position derived, not authored: the Pvp zone's 6 grass_block_cube wall
// segments (data/pvpBlocks.js RAW_CUBE) form a walled rectangle around the
// zone's dirt terrain. Their world AABBs (PVP_CUBE_AABBS) bound that
// rectangle at three.js x: [-155.12, -45.63], z: [-59.34, 50.98] — this
// prop's X/Z sit at that rectangle's midpoint. None of the Pvp zone's dirt
// tiles (PVP_DIRT_AABBS) actually cover that midpoint — they're terrain
// mounds clustered near the zone's north/south edges — so the midpoint sits
// on the shared base Ground plane (Ground.jsx, flat at y = 0) rather than on
// any raised dirt platform, hence Y = 0 here (the bottom tier's own mesh
// lifts itself by half its height on top of that, same convention as every
// other box/cylinder prop in the scene).
export const PVP_CENTER_PENTAGON_POSITION = [-80, 0, -5]
export const PVP_CENTER_PENTAGON_ROTATION_Y = Math.PI / 3 // 60°, turn around the up axis

// Same checker-cell pitch as Ground.jsx's own CELL (2m), so each tier's
// recolored stud texture (systems/studTexture.js, built per-tier in
// PvpCenterPentagon.jsx) reads at the same physical stud density as the
// ground it's standing on, not a stretched or squished copy of it.
export const PVP_CENTER_PENTAGON_CELL = 2

// The stack: a wide purple base tier, then alternating narrower/shorter
// tiers (purple/yellow) on top of each other, each one 0.98x the radius and
// 0.85x the height of the tier below it — originally authored as just a
// base + one tier on top, then extended to 5 such purple/yellow couples (10
// tiers total) by continuing that same pair of ratios.
const BASE_RADIUS = 15 // metres, circumscribed radius of tier 0's 5-sided prism
const BASE_HEIGHT = 0.75
const RADIUS_RATIO = 0.98 // each tier's radius, relative to the tier below it
const HEIGHT_RATIO = 0.85 // each tier's height, relative to the tier below it
const COUPLES = 5 // purple+yellow pairs, tier 0 (purple) included
const PURPLE = '#5500ff'
const YELLOW = '#ffe600'

const [PENTAGON_X, GROUND_Y, PENTAGON_Z] = PVP_CENTER_PENTAGON_POSITION

// Each tier's own world centre, stacked directly on the running height
// total of every shorter tier below it (PvpCenterPentagon.jsx no longer
// needs to redo this walk itself — it just mounts each tier at its own
// `position`).
let centerY = GROUND_Y
export const PVP_CENTER_PENTAGON_TIERS = Array.from({ length: COUPLES * 2 }, (_, i) => {
  const radius = BASE_RADIUS * RADIUS_RATIO ** i
  const height = BASE_HEIGHT * HEIGHT_RATIO ** i
  centerY += height / 2
  const position = [PENTAGON_X, centerY, PENTAGON_Z]
  centerY += height / 2
  return { radius, height, color: i % 2 === 0 ? PURPLE : YELLOW, position }
})

// Real pentagon colliders, not a box approximation: an axis-aligned box
// around a 5-sided shape rotated 60° always leaves big empty wedges at its
// corners (or, shrunk to fit inside, chops off the mesh's points) — neither
// reads as "the collider matches the object". So systems/playerMovement.js
// gained a second collider kind for this stack: a convex-polygon prism,
// tested as a circle (the player's own XZ radius) against the pentagon's 5
// face planes directly, the same push-the-shallow-way idea data/hub.js's
// AABBs use, generalized from 2 push axes (±x, ±z) to 5 (one per face
// normal). Each tier is fully described by its centre, its Y range, and its
// apothem (perpendicular centre-to-face distance, R*cos(pi/N) for a regular
// N-gon — the same for every face by construction) plus that face's own
// outward unit normal.
//
// Face i sits between vertex i and vertex i+1 (CylinderGeometry — three.js
// source — places local vertex i at angle i*(2*pi/N), (x, z) =
// (radius*sin(angle), radius*cos(angle)); the mesh's own rotation-y just
// adds directly to every vertex's angle, per data/pvpBlocks.js's rotateYaw
// precedent), so face i's outward normal points along the angular midpoint
// of its two vertices: rotationY + (i + 0.5) * (2*pi/N). Same rotation for
// every tier, so these 5 normals are shared across the whole stack. Reused
// below at N=24 for the cylinder cap: a true circle has no faces to test
// against, so it's approximated as a many-sided regular polygon instead —
// tight enough (apothem within 1% of radius at 24 sides) that the join
// between "circle" mesh and "polygon" collider is imperceptible, and it's
// one code path shared with the pentagon tiers rather than a second kind of
// collider.
const SIDES = 5
function regularPolygonNormals(sides, rotationY) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = rotationY + (i + 0.5) * ((Math.PI * 2) / sides)
    return { x: Math.sin(angle), z: Math.cos(angle) }
  })
}
const PENTAGON_FACE_NORMALS = regularPolygonNormals(SIDES, PVP_CENTER_PENTAGON_ROTATION_Y)

// Registered into data/hub.js's HUB_POLYGONS (a second, parallel collider
// list next to HUB_AABBS — systems/collision.js's getPolys(), threaded into
// systems/playerMovement.js's step() alongside getAabbs()) so the whole
// stack is solid, closely-fitting ground: players land on top of each tier
// and step from one onto the next the moment its rise is within
// systems/playerMovement.js's STEP_HEIGHT (0.45m) — true once BASE_HEIGHT's
// 0.85x falloff has shrunk a tier past that, same jump-assisted climb below
// that point as stepping up data/podiumStage.js's risers.
export const PVP_CENTER_PENTAGON_POLYGONS = PVP_CENTER_PENTAGON_TIERS.map((tier) => ({
  center: { x: tier.position[0], z: tier.position[2] },
  minY: tier.position[1] - tier.height / 2,
  maxY: tier.position[1] + tier.height / 2,
  apothem: tier.radius * Math.cos(Math.PI / SIDES),
  normals: PENTAGON_FACE_NORMALS,
}))

// A hollow cylinder shell on the very top of the stack, same X/Z centre as
// every tier below it, resting flush on the topmost tier's own top face —
// the summit of the ziggurat: an outer wall (radius 9) with a narrower
// wall (radius 8) cut out of its middle, "a shell inside a shell", 1m thick.
// The topmost tier's own top face still shows through the hollow centre —
// the shell reads as a raised rim/parapet around the platform, not a lid
// sealing it, and (per the ring collider below) a player standing in that
// open middle is genuinely standing on the tier below, not floating on an
// invisible solid fill.
export const PVP_CENTER_CYLINDER_RADIUS = 9 // outer wall
export const PVP_CENTER_CYLINDER_INNER_RADIUS = 8 // inner wall — the hollow bore
export const PVP_CENTER_CYLINDER_HEIGHT = 0.5
export const PVP_CENTER_CYLINDER_COLOR = YELLOW
export const PVP_CENTER_CYLINDER_POSITION = [
  PENTAGON_X,
  centerY + PVP_CENTER_CYLINDER_HEIGHT / 2, // centerY is the last tier's own top y, left over from the stacking walk above
  PENTAGON_Z,
]

export const PVP_CENTER_CYLINDER_SIDES = 24 // a true circle has no faces; see regularPolygonNormals's header note

// The ring's collider (systems/playerMovement.js's resolveRingXZ/
// resolveRingY): same regular-polygon approximation as every other round
// collider in this file, but with two apothems sharing one set of face
// normals — `outerApothem` blocks the player out of the wall from outside
// (exactly like PVP_CENTER_PENTAGON_POLYGONS' solid discs), `innerApothem`
// blocks them back out of the wall from inside the hollow bore, and neither
// applies once they're clear of the wall on either side (fully outside, or
// deep in the hollow middle — where the topmost tier's own collider is
// already the floor).
export const PVP_CENTER_CYLINDER_RING = {
  center: { x: PVP_CENTER_CYLINDER_POSITION[0], z: PVP_CENTER_CYLINDER_POSITION[2] },
  minY: PVP_CENTER_CYLINDER_POSITION[1] - PVP_CENTER_CYLINDER_HEIGHT / 2,
  maxY: PVP_CENTER_CYLINDER_POSITION[1] + PVP_CENTER_CYLINDER_HEIGHT / 2,
  outerApothem: PVP_CENTER_CYLINDER_RADIUS * Math.cos(Math.PI / PVP_CENTER_CYLINDER_SIDES),
  innerApothem: PVP_CENTER_CYLINDER_INNER_RADIUS * Math.cos(Math.PI / PVP_CENTER_CYLINDER_SIDES),
  normals: regularPolygonNormals(PVP_CENTER_CYLINDER_SIDES, PVP_CENTER_PENTAGON_ROTATION_Y),
}

// A second, solid cylinder at the exact same spot (X/Z centre and Y level)
// as the shell above — no collider registered anywhere (not HUB_AABBS,
// HUB_POLYGONS, or HUB_RINGS), so it renders but stays walk-through, same
// as the shell itself.
export const PVP_CENTER_SUMMIT_DISC_RADIUS = 9.5
export const PVP_CENTER_SUMMIT_DISC_HEIGHT = 20
export const PVP_CENTER_SUMMIT_DISC_COLOR = '#bfe9ff' // same pale-blue "honest glass" tint as data/pvpWall.js's PVP_WALL_MATERIAL, not the stack's purple/yellow
export const PVP_CENTER_SUMMIT_DISC_POSITION = PVP_CENTER_CYLINDER_POSITION
// Glass look (same recipe as data/pvpWall.js's PVP_WALL_MATERIAL — alpha-
// blended, low-roughness MeshStandardMaterial via MATERIAL_PBR.GLASS, still
// no transmission/refraction): a plain solid stud-textured disc doesn't read
// as glass no matter how low its opacity, so PvpCenterPentagon.jsx gives
// this one a dedicated untextured material instead of PentagonSlab's.
export const PVP_CENTER_SUMMIT_DISC_OPACITY = 0.35

// The Power-gain bonus PVP_CENTER_SIGN's subtitle below promises: "inside the
// glass cylinder" means inside this disc's own footprint, so the check is the
// same distance-in-XZ/range-in-Y test as any round collider in this file,
// just never registered as one — the disc stays walk-through by design (see
// this section's own header note), so isInsideSummitZone() only gates
// systems/actionTracker.js's Power grant, never movement.
const SUMMIT_ZONE_MIN_Y = PVP_CENTER_SUMMIT_DISC_POSITION[1] - PVP_CENTER_SUMMIT_DISC_HEIGHT / 2
const SUMMIT_ZONE_MAX_Y = PVP_CENTER_SUMMIT_DISC_POSITION[1] + PVP_CENTER_SUMMIT_DISC_HEIGHT / 2
const SUMMIT_ZONE_RADIUS_SQ = PVP_CENTER_SUMMIT_DISC_RADIUS * PVP_CENTER_SUMMIT_DISC_RADIUS
export function isInsideSummitZone({ x, y, z }) {
  const dx = x - PVP_CENTER_SUMMIT_DISC_POSITION[0]
  const dz = z - PVP_CENTER_SUMMIT_DISC_POSITION[2]
  return dx * dx + dz * dz <= SUMMIT_ZONE_RADIUS_SQ && y >= SUMMIT_ZONE_MIN_Y && y <= SUMMIT_ZONE_MAX_Y
}

// "350% Strength!" — the factor store/useGameStore.js's gainPower() gets
// multiplied by (on top of powerPerAction/rebirth/multiplier/auraMult, same
// floor-then-clamp) while isInsideSummitZone() is true.
export const PVP_CENTER_SUMMIT_POWER_MULT = 3.5

// In-world signage floating inside the glass disc/shell (Tech.md §1: drei's
// <Text> + <Billboard> — always turned to face the player, same idea as
// GlowFloorPanelLabel.jsx's "+N Wins"/"Return" pair). Two lines, no
// gradient: a big yellow title, a smaller white caption underneath.
export const PVP_CENTER_SIGN = {
  title: 'King of the Hill!',
  titleSize: 1.4,
  titleColor: '#ffd21e',
  subtitle: '350% Strength!',
  subtitleSize: 0.8,
  subtitleColor: '#ffffff',
  subtitleGap: 1.4, // vertical drop from the title's own anchor to the subtitle's
}
// Same X/Z as the shell/disc, but a fixed 10m above the ground plane
// (GROUND_Y — Ground.jsx's flat y = 0) rather than tied to the shell's own
// (much lower) centre.
export const PVP_CENTER_SIGN_POSITION = [PVP_CENTER_CYLINDER_POSITION[0], GROUND_Y + 10, PVP_CENTER_CYLINDER_POSITION[2]]
