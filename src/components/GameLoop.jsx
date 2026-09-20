import { useThree, useFrame } from '@react-three/fiber'
import { tick } from '../systems/timeScale.js'
import { step } from '../systems/playerMovement.js'
import { update as updateCamera } from '../systems/cameraOrbit.js'
import { step as stepShadowSun } from '../systems/shadowSun.js'
import { step as stepAction } from '../systems/actionTracker.js'
import { step as stepActionPopups } from '../systems/actionPopups.js'
import { step as stepAfk } from '../systems/afk.js'
import { step as stepHexPowerPad } from '../systems/hexPowerPad.js'
import { step as stepMerchant } from '../systems/merchant.js'
import { step as stepInteract } from '../systems/interact.js'
import { step as stepGlowFloorPanel } from '../systems/glowFloorPanel.js'
import { step as stepLaser } from '../systems/laser.js'
import { step as stepLaserParticles } from '../systems/laserParticles.js'
import { step as stepAuraParticles } from '../systems/auraParticles.js'
import { step as stepWallHealth } from '../systems/wallHealth.js'
import { step as stepPlayerHealth, health as playerHealthState } from '../systems/playerHealth.js'
import { step as stepPlayerCombat } from '../systems/playerCombat.js'
import { step as stepWallDebris } from '../systems/wallDebris.js'
import { step as stepRagdoll } from '../systems/ragdoll.js'
import { step as stepNet, reportLocal } from '../systems/net.js'
import { getAabbs, getPolys, getRings } from '../systems/collision.js'
import { notifyFirstFrame } from '../systems/bloxity.js'
import { tickFrame } from '../systems/gameReadiness.js'
import { inputState } from '../systems/input.js'

// The single simulation tick. Rendered before the view components so its
// useFrame subscribes first and runs first each frame. Reads systems directly;
// never calls setState (Tech.md §5.4).
export default function GameLoop() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  useFrame(() => {
    const dt = tick()
    stepPlayerHealth()
    // Frozen while dead (PVP only) — position/velocity hold where they died
    // until systems/playerHealth.js's respawn timer teleports them back out.
    if (!playerHealthState.dead) step(dt, getAabbs(), getPolys(), getRings())
    stepShadowSun()
    updateCamera(camera, dt)
    // Project the player to the screen and age live popups before stepAction
    // below can spawn new ones this frame (systems/actionPopups.js).
    stepActionPopups(dt, camera)
    stepAfk()
    stepHexPowerPad()
    stepMerchant()
    // Resolves which (if any) of the three proximity zones above is the
    // shared hold-to-confirm gate's current target, and fires that zone's
    // action once the player has held E against it for HOLD_MS (systems/
    // interactHold.js) — see systems/interact.js for the priority order.
    stepInteract()
    stepGlowFloorPanel()
    // afk.js's own "E again to stop" toggle is the only thing left reading
    // inputState.interact directly, and already clears it when it fires —
    // reset here so a press that toggled nothing never lingers into a later
    // frame.
    inputState.interact = false
    // Laser aim first, then PVP hit-testing (which may clip the beam onto a
    // player it found), then stepAction — which reads this frame's result to
    // apply a discrete strike on each Action event (systems/playerCombat.js,
    // falling back to systems/wallHealth.js off the PVP zone).
    stepLaser(camera, scene)
    stepPlayerCombat()
    stepAction(dt)
    stepWallHealth(dt)
    // After stepAction/stepWallHealth so a wall broken this frame has already
    // queued its burst (systems/wallHealth.js strikeWall -> wallDebris.spawnBurst).
    stepWallDebris(dt)
    stepRagdoll(dt)
    stepLaserParticles(dt)
    stepAuraParticles(dt)
    // Multiplayer presence: advance remote-body interpolation, then relay our
    // own transform + beam (throttled inside net.js). A no-op while offline —
    // the game never waits on the socket (systems/net.js).
    stepNet(dt)
    reportLocal()
    // The game is interactive as soon as a frame is on screen, with or without
    // a signed-in avatar; dismiss the portal loading screen here. No-ops after
    // the first call.
    notifyFirstFrame()
    // Counts real rendered frames toward LoadingScreen.jsx's post-load
    // warm-up gate; a no-op until that screen arms it (systems/gameReadiness.js).
    tickFrame()
  })

  return null
}
