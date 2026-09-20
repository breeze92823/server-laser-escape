import { Canvas, useLoader } from '@react-three/fiber'
import {
  TextureLoader,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
} from 'three'
import { Environment, Lightformer } from '@react-three/drei'
import GameLoop from './components/GameLoop.jsx'
import ShadowSun from './components/ShadowSun.jsx'
import BuildingBlocks from './components/BuildingBlocks.jsx'
import GrassBlocks from './components/GrassBlocks.jsx'
import GrassBlockCubes from './components/GrassBlockCubes.jsx'
import Ground from './components/Ground.jsx'
import Road from './components/Road.jsx'
import Obstacles from './components/Obstacles.jsx'
import PodiumStage from './components/PodiumStage.jsx'
import MerchantShop from './components/MerchantShop.jsx'
import WoodCrateStack from './components/WoodCrateStack.jsx'
import TreeProp from './components/TreeProp.jsx'
import TreePineProp from './components/TreePineProp.jsx'
import PvpWall from './components/PvpWall.jsx'
import PvpCenterPentagon from './components/PvpCenterPentagon.jsx'
import HexPowerPads from './components/HexPowerPads.jsx'
import Targets from './components/Targets.jsx'
import LeaderboardBoard from './components/LeaderboardBoard.jsx'
import { LEADERBOARD_TRANSFORMS } from './data/leaderboardBoard.js'
import GlowFloorPanels from './components/GlowFloorPanels.jsx'
import WallProps from './components/WallProps.jsx'
import WallDebris from './components/WallDebris.jsx'
import WallHealthBars from './components/WallHealthBars.jsx'
import Ragdoll from './components/Ragdoll.jsx'
import Player from './components/Player.jsx'
import RemotePlayers from './components/RemotePlayers.jsx'
import Laser from './components/Laser.jsx'
import LaserParticles from './components/LaserParticles.jsx'
import AuraParticles from './components/AuraParticles.jsx'
import UltraInstinctAura from './components/UltraInstinctAura.jsx'
import Hud from './components/hud/Hud.jsx'
import LoadingScreen from './components/LoadingScreen.jsx'
import { QUALITY_DPR, QUALITY_SHADOWS } from './data/bloxity.js'
import {
  PODIUM_STAGE_HUB_TRANSFORM,
  PODIUM_STAGE_TARGET_TRANSFORM,
  PODIUM_STAGE_TARGET_PROFILE,
  TARGET_SIGN_TEXT,
} from './data/podiumStage.js'
import { PVP_DIRT_INSTANCES, PVP_CUBE_INSTANCES } from './data/pvpBlocks.js'
import { WOOD_CRATE_TRANSFORMS } from './data/woodCrate.js'
import { TREE_TRANSFORMS } from './data/tree.js'
import { TREE_PINE_TRANSFORMS } from './data/treePine.js'
import { settings } from './systems/settingsState.js'
import { useSettings } from './components/hud/hooks.js'

// Equirectangular sky (CC0, Poly Haven "Syferfontein 18d Clear Pure Sky")
// used as the scene background instead of a flat color.
function SkyBackground() {
  const texture = useLoader(TextureLoader, '/textures/sky.jpg')
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = SRGBColorSpace
  return <primitive attach="background" object={texture} />
}

// <Canvas> + DOM overlay siblings (Tech.md §2, §5.4).
export default function App() {
  // graphics_quality caps the device pixel ratio. This is a *user-elected*
  // tier applied on change — not the frame-time-driven resolution scaling
  // Tech.md §7 rejects — and it stays inside the [1, 1.5] clamp.
  useSettings()
  const dprCap = QUALITY_DPR[settings.graphics_quality] ?? QUALITY_DPR.High
  // Shadows are gated by the same user-elected quality tier, not adaptive at
  // runtime (Tech.md §7): Low keeps the original shadow-free look, Medium+
  // get the player-following shadow-sun (ShadowSun.jsx).
  const shadowsEnabled = QUALITY_SHADOWS[settings.graphics_quality] ?? QUALITY_SHADOWS.High

  return (
    <>
      <Canvas
        dpr={[1, dprCap]}
        shadows={shadowsEnabled ? { type: PCFSoftShadowMap } : false}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
          outputColorSpace: SRGBColorSpace,
        }}
        camera={{ fov: 55, near: 0.1, far: 200, position: [0, 6, 12] }}
      >
        <SkyBackground />
        {/* Hemisphere + directional key light (Tech.md §7). Retuned down from
           the old shadow-free flat-lighting values now that ACES tone mapping
           and PBR specular response are in play — the old 2.2/2.4 intensities
           blow out highlights once materials actually have a specular curve —
           then retuned back up slightly (plus gl.toneMappingExposure above)
           once the Tharindu-style stud-checker materials (naturally darker,
           earthy tones at roughness 0.9) made the first-pass values read too
           dim overall. The directional light is ShadowSun: a tight,
           player-following shadow frustum, cast-shadow gated by
           graphics_quality above. */}
        <hemisphereLight args={['#eaf3ff', '#b7a98f', 1.1]} />
        <ShadowSun castShadow={shadowsEnabled} />
        {/* Locally-baked, zero-network fake environment map (Tech.md §7) — a
           64px PMREM cubemap baked once (frames=1) from three static
           Lightformer panels, not an HDR file. Purely soft specular/reflection
           fill; art-directed to bias toward the sky's cool-blue/warm-ground
           palette so reflections don't read as neutral gray. */}
        <Environment resolution={64} frames={1} environmentIntensity={0.55}>
          <Lightformer
            form="rect"
            intensity={2}
            color="#eaf3ff"
            position={[0, 10, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[20, 20, 1]}
          />
          <Lightformer
            form="rect"
            intensity={1}
            color="#ffe9c4"
            position={[10, 3, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[20, 5, 1]}
          />
          <Lightformer
            form="rect"
            intensity={0.6}
            color="#b7a98f"
            position={[-10, 3, 0]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[20, 5, 1]}
          />
        </Environment>

        <GameLoop />
        <Ground />
        <Road />
        <BuildingBlocks />
        <GrassBlocks />
        <GrassBlockCubes />
        <GrassBlocks instances={PVP_DIRT_INSTANCES} />
        <GrassBlockCubes instances={PVP_CUBE_INSTANCES} />
        <PvpWall />
        <PvpCenterPentagon />
        <Obstacles />
        <PodiumStage transform={PODIUM_STAGE_HUB_TRANSFORM} />
        <PodiumStage
          transform={PODIUM_STAGE_TARGET_TRANSFORM}
          signText={TARGET_SIGN_TEXT}
          profile={PODIUM_STAGE_TARGET_PROFILE}
        />
        <MerchantShop />
        {WOOD_CRATE_TRANSFORMS.map((t, i) => (
          <WoodCrateStack key={i} transform={t} />
        ))}
        {TREE_TRANSFORMS.map((t, i) => (
          <TreeProp key={i} transform={t} />
        ))}
        {TREE_PINE_TRANSFORMS.map((t, i) => (
          <TreePineProp key={i} transform={t} />
        ))}
        <HexPowerPads />
        <Targets />
        {LEADERBOARD_TRANSFORMS.map((t, i) => (
          <LeaderboardBoard key={i} transform={t} title={t.title} stat={t.stat} />
        ))}
        <GlowFloorPanels />
        <WallProps />
        <WallDebris />
        <WallHealthBars />
        <Ragdoll />
        <Player />
        <AuraParticles />
        <UltraInstinctAura />
        <RemotePlayers />
        <Laser />
        <LaserParticles />
      </Canvas>
      <Hud />
      <LoadingScreen />
    </>
  )
}
