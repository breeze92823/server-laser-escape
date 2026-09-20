import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { firePool, auraClock } from '../systems/auraParticles.js'
import { AURA_PARTICLE_VERTEX_SHADER, AURA_FIRE_FRAGMENT_SHADER } from '../systems/auraParticleShader.js'
import {
  FIRE_FADE_IN,
  FIRE_FADE_OUT_START,
  FIRE_SIZE_GROWTH,
  FIRE_SWAY_AMOUNT,
  FIRE_CORE_COLOR,
  FIRE_EDGE_COLOR,
} from '../data/auraParticles.js'

// Builds the pool's static (never-changing) BufferGeometry, wrapping the
// typed arrays systems/auraParticles.js writes spawns into directly — no
// copy, so a spawn there needs only an `addUpdateRange` + `needsUpdate` here
// to reach the GPU. DynamicDrawUsage hints the driver these buffers are
// rewritten every frame rather than set once (the ShaderMaterial default,
// StaticDrawUsage, is meant for geometry that never changes after upload).
function buildGeometry(pool) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pool.offset, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aBirth', new THREE.BufferAttribute(pool.birth, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aLifetime', new THREE.BufferAttribute(pool.lifetime, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aRise', new THREE.BufferAttribute(pool.rise, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSway', new THREE.BufferAttribute(pool.sway, 2).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aWind', new THREE.BufferAttribute(pool.wind, 2).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(pool.particleSize, 1).setUsage(THREE.DynamicDrawUsage))
  return geometry
}

// Pushes this frame's spawned slot ranges (systems/auraParticles.js's
// pool.dirtyRanges) to the GPU as partial buffer updates instead of
// re-uploading the whole pool every frame — with thousands of particles in
// the pool but only a couple dozen spawned per frame, a full re-upload would
// move ~100x more data than actually changed. `itemSize` converts a
// particle-slot range into the flat-array element range addUpdateRange
// expects (e.g. a vec2 attribute's slot N lives at elements [2N, 2N+2)).
function uploadDirtyRanges(attribute, itemSize, dirtyRanges) {
  for (const { start, count } of dirtyRanges) {
    attribute.addUpdateRange(start * itemSize, count * itemSize)
  }
  attribute.needsUpdate = true
}

// Presentation only: a GPU-animated THREE.Points cloud driven by
// systems/auraParticles.js's typed-array pool and systems/
// auraParticleShader.js's vertex shader (see that file for why this is one
// draw call with no per-particle JS work, unlike components/
// LaserParticles.jsx's InstancedMesh, which has to loop and compose a matrix
// per instance every frame since it has no shader of its own to hand that
// off to).
export default function AuraParticles() {
  const fireRef = useRef(null)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const fireGeometry = useMemo(() => buildGeometry(firePool), [])

  const fireMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: AURA_PARTICLE_VERTEX_SHADER,
        fragmentShader: AURA_FIRE_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uPixelScale: { value: 1 },
          uFadeIn: { value: FIRE_FADE_IN },
          uFadeOutStart: { value: FIRE_FADE_OUT_START },
          uSizeGrowth: { value: FIRE_SIZE_GROWTH },
          uSwayAmount: { value: FIRE_SWAY_AMOUNT },
          uCoreColor: { value: new THREE.Color(FIRE_CORE_COLOR) },
          uEdgeColor: { value: new THREE.Color(FIRE_EDGE_COLOR) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )

  // Standard perspective point-size-attenuation scale (mirrors THREE's own
  // size_vertex shader chunk): gl_PointSize = size * scale / -mvPosition.z.
  useEffect(() => {
    if (!camera.isPerspectiveCamera) return
    const dpr = gl.getPixelRatio()
    const fovRad = (camera.fov * Math.PI) / 180
    const pixelScale = (size.height * dpr) / (2 * Math.tan(fovRad / 2))
    fireMaterial.uniforms.uPixelScale.value = pixelScale
  }, [camera, gl, size, fireMaterial])

  useEffect(
    () => () => {
      fireGeometry.dispose()
      fireMaterial.dispose()
    },
    [fireGeometry, fireMaterial],
  )

  useFrame(() => {
    fireMaterial.uniforms.uTime.value = auraClock.elapsed

    // Only the slots systems/auraParticles.js actually wrote this frame need
    // to reach the GPU — everything else is still animating purely from the
    // vertex shader's own function of uTime, with no CPU-side change at all.
    const dirtyRanges = firePool.dirtyRanges
    if (dirtyRanges.length === 0) return

    const fireAttrs = fireGeometry.attributes
    uploadDirtyRanges(fireAttrs.position, 3, dirtyRanges)
    uploadDirtyRanges(fireAttrs.aBirth, 1, dirtyRanges)
    uploadDirtyRanges(fireAttrs.aLifetime, 1, dirtyRanges)
    uploadDirtyRanges(fireAttrs.aRise, 1, dirtyRanges)
    uploadDirtyRanges(fireAttrs.aSway, 2, dirtyRanges)
    uploadDirtyRanges(fireAttrs.aWind, 2, dirtyRanges)
    uploadDirtyRanges(fireAttrs.aSize, 1, dirtyRanges)
  })

  return (
    <points
      ref={fireRef}
      geometry={fireGeometry}
      material={fireMaterial}
      frustumCulled={false}
      userData={{ laserIgnore: true }}
    />
  )
}
