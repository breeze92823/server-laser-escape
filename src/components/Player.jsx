import { useCallback, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import { player } from '../systems/playerState.js'
import { health as playerHealthState } from '../systems/playerHealth.js'
import { hitFlashFraction } from '../systems/hitFlash.js'
import PlayerAvatar from './PlayerAvatar.jsx'
import { MATERIAL_PBR } from '../data/materials.js'
import { HIT_FLASH_COLOR } from '../data/playerHealth.js'
import { GAIT } from '../data/bloxity.js'

// Scratch, hoisted to module scope — zero allocation per frame (Tech.md §7).
const _up = new Vector3(0, 1, 0)
const _targetQuat = new Quaternion()

// Presentation only: read the player singleton, draw the character. The group
// origin sits at the capsule base (feet), matching playerState's convention —
// the Bloxity rig uses the same origin, so both mount unchanged.
export default function Player() {
  const ref = useRef()
  const capsuleMatRef = useRef()
  const [hasAvatar, setHasAvatar] = useState(false)

  // Stable identity: PlayerAvatar's effect depends on this.
  const onAvatarReady = useCallback((ready) => setHasAvatar(ready), [])

  useFrame((_state, delta) => {
    const g = ref.current
    if (!g) return
    g.position.set(player.position.x, player.position.y, player.position.z)
    // Turn toward player.facing rather than snapping to it — playerMovement
    // only updates facing while there's real input, so this is a no-op at
    // rest and a smooth turn the instant movement starts or changes direction.
    _targetQuat.setFromAxisAngle(_up, player.facing)
    g.quaternion.slerp(_targetQuat, 1 - Math.pow(GAIT.turnRate, delta))
    // Hide the standing body the instant we're dead — systems/ragdoll.js has
    // already burst its own boxes at this same position/facing (systems/
    // playerHealth.js's applyRemoteHealth), so a frozen standee underneath
    // them would read as a rendering glitch, not a death.
    g.visible = !playerHealthState.dead

    // Fallback-capsule half of the "just got hit" pulse — PlayerAvatar.jsx
    // drives the same pulse on the real rig once it's loaded.
    if (capsuleMatRef.current) {
      const f = hitFlashFraction(playerHealthState.hitFlashAt, performance.now())
      capsuleMatRef.current.emissive.setRGB(
        HIT_FLASH_COLOR[0] * f,
        HIT_FLASH_COLOR[1] * f,
        HIT_FLASH_COLOR[2] * f,
      )
    }
  })

  // The capsule is the fallback, not dead code: it is what renders while the
  // default rig loads, or when the avatar CDN is unreachable and a load fails.
  const { radius, height } = player.dims
  const cylinder = height - radius * 2

  return (
    <group ref={ref} userData={{ laserIgnore: true }}>
      <group visible={!hasAvatar}>
        <mesh position-y={height / 2} castShadow>
          <capsuleGeometry args={[radius, cylinder, 4, 12]} />
          <meshStandardMaterial ref={capsuleMatRef} color="#d9564b" {...MATERIAL_PBR.FLAT_PLACEHOLDER} />
        </mesh>
        {/* nub marking the facing direction */}
        <mesh position={[0, height * 0.62, radius]} castShadow>
          <boxGeometry args={[0.14, 0.14, 0.28]} />
          <meshStandardMaterial color="#ffd36b" {...MATERIAL_PBR.FLAT_PLACEHOLDER} />
        </mesh>
      </group>
      <PlayerAvatar onReady={onAvatarReady} />
    </group>
  )
}
