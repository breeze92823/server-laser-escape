import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { uiAuraPool } from '../systems/ultraInstinctAura.js'
import { auraClock } from '../systems/auraParticles.js'
import { UI_AURA_VERTEX_SHADER, UI_AURA_FRAGMENT_SHADER } from '../systems/ultraInstinctAuraShader.js'
import {
  UI_AURA_FADE_IN,
  UI_AURA_FADE_OUT_START,
  UI_AURA_SIZE_GROWTH,
  UI_AURA_SWAY_AMOUNT,
  UI_AURA_CORE_COLOR,
  UI_AURA_MID_COLOR,
  UI_AURA_EDGE_COLOR,
} from '../data/ultraInstinctAura.js'

// Builds the pool's static (never-changing) BufferGeometry, wrapping the
// typed arrays systems/ultraInstinctAura.js writes spawns into directly —
// same DynamicDrawUsage + partial-upload approach as components/
// AuraParticles.jsx's fire trail (see uploadDirtyRanges there for why).
function buildGeometry(pool) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pool.offset, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aBirth', new THREE.BufferAttribute(pool.birth, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aLifetime', new THREE.BufferAttribute(pool.lifetime, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aRise', new THREE.BufferAttribute(pool.rise, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSway', new THREE.BufferAttribute(pool.sway, 2).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aWind', new THREE.BufferAttribute(pool.wind, 2).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(pool.particleSize, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aRadial', new THREE.BufferAttribute(pool.radial, 1).setUsage(THREE.DynamicDrawUsage))
  return geometry
}

function uploadDirtyRanges(attribute, itemSize, dirtyRanges) {
  for (const { start, count } of dirtyRanges) {
    attribute.addUpdateRange(start * itemSize, count * itemSize)
  }
  attribute.needsUpdate = true
}

// Presentation only: a GPU-animated THREE.Points cloud for Ultra Instinct's
// full-body aura, driven by systems/ultraInstinctAura.js's typed-array pool
// (only ever spawning while that tier is equipped) and systems/
// ultraInstinctAuraShader.js's shaders. Sibling to components/
// AuraParticles.jsx, sharing its auraClock so both effects' particle ages
// read off the same running time.
export default function UltraInstinctAura() {
  const pointsRef = useRef(null)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const geometry = useMemo(() => buildGeometry(uiAuraPool), [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: UI_AURA_VERTEX_SHADER,
        fragmentShader: UI_AURA_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uPixelScale: { value: 1 },
          uFadeIn: { value: UI_AURA_FADE_IN },
          uFadeOutStart: { value: UI_AURA_FADE_OUT_START },
          uSizeGrowth: { value: UI_AURA_SIZE_GROWTH },
          uSwayAmount: { value: UI_AURA_SWAY_AMOUNT },
          uCoreColor: { value: new THREE.Color(UI_AURA_CORE_COLOR) },
          uMidColor: { value: new THREE.Color(UI_AURA_MID_COLOR) },
          uEdgeColor: { value: new THREE.Color(UI_AURA_EDGE_COLOR) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )

  useEffect(() => {
    if (!camera.isPerspectiveCamera) return
    const dpr = gl.getPixelRatio()
    const fovRad = (camera.fov * Math.PI) / 180
    const pixelScale = (size.height * dpr) / (2 * Math.tan(fovRad / 2))
    material.uniforms.uPixelScale.value = pixelScale
  }, [camera, gl, size, material])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    material.uniforms.uTime.value = auraClock.elapsed

    const dirtyRanges = uiAuraPool.dirtyRanges
    if (dirtyRanges.length === 0) return

    const attrs = geometry.attributes
    uploadDirtyRanges(attrs.position, 3, dirtyRanges)
    uploadDirtyRanges(attrs.aBirth, 1, dirtyRanges)
    uploadDirtyRanges(attrs.aLifetime, 1, dirtyRanges)
    uploadDirtyRanges(attrs.aRise, 1, dirtyRanges)
    uploadDirtyRanges(attrs.aSway, 2, dirtyRanges)
    uploadDirtyRanges(attrs.aWind, 2, dirtyRanges)
    uploadDirtyRanges(attrs.aSize, 1, dirtyRanges)
    uploadDirtyRanges(attrs.aRadial, 1, dirtyRanges)
  })

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      userData={{ laserIgnore: true }}
    />
  )
}
