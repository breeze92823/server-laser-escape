import { useEffect, useMemo, useReducer } from 'react'
import { Text } from '@react-three/drei'
import { MATERIAL_PBR } from '../data/materials.js'
import { makeStudTexture } from '../systems/studTexture.js'
import { useGameStore } from '../store/useGameStore.js'
import { getLeaderboard, subscribe as subscribeNet } from '../systems/net.js'
import { formatShort } from '../data/format.js'
import {
  LEADERBOARD_TRANSFORM,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BOARD_THICKNESS,
  BOARD_BOTTOM,
  BOARD_TOP,
  BOARD_CENTER_Y,
  LEG_HEIGHT,
  LEG_SECTION,
  LEG_INSET,
  PANEL_INSET_X,
  PANEL_THICKNESS,
  PANEL_WIDTH,
  PANEL_HEIGHT,
  PANEL_CENTER_Y,
  BOARD_STUD_CELL,
  CORNER_STUD_RADIUS,
  CORNER_STUD_HEIGHT,
  CORNER_STUD_INSET,
  SIDE_TAB_WIDTH,
  SIDE_TAB_HEIGHT,
  SIDE_TAB_DEPTH,
  LEADERBOARD_COLORS,
  LEADERBOARD_TITLE,
  TITLE_FONT_SIZE,
  TITLE_Y,
  FIXED_ROW_SLOTS,
  rankColorFor,
  PLAYER_ROW_SCORE_COLOR,
  ENTRY_NAME_COLOR,
  ROW_FONT_SIZE,
  ROW_HEIGHT,
  ROW_YS,
  RANK_TEXT_X,
  NAME_TEXT_X,
  SCORE_TEXT_X,
  getRowLayout,
  TIMER_FONT_SIZE,
  TIMER_Y,
} from '../data/leaderboardBoard.js'

// Everything below is local to the mount group in this file's default export:
// origin at ground level, centred on X, +Z the readable front face — same
// convention data/leaderboardBoard.js documents. Every size/position number
// (BOARD_HEIGHT, PANEL_CENTER_Y, TITLE_Y, ROW_YS, TIMER_Y, ...) is computed
// there, not here.
const FRAME_FRONT_Z = BOARD_THICKNESS / 2
const PANEL_FRONT_Z = FRAME_FRONT_Z + PANEL_THICKNESS / 2
const TEXT_Z = PANEL_FRONT_Z + PANEL_THICKNESS / 2 + 0.01

// The brown frame board: a stud-textured checker on its front face (systems/
// studTexture.js — same "Lego brick" material as Ground.jsx/
// PvpCenterPentagon.jsx, just recolored), plain wood color on every other
// face. BoxGeometry's six material groups run [+x, -x, +y, -y, +z, -z], so
// index 4 is the front (+Z) face this board reads from.
function FrameBoard() {
  const studTexture = useMemo(
    () =>
      makeStudTexture({
        light: LEADERBOARD_COLORS.frame,
        dark: LEADERBOARD_COLORS.frame,
        repeatX: BOARD_WIDTH / (BOARD_STUD_CELL * 2),
        repeatY: BOARD_HEIGHT / (BOARD_STUD_CELL * 2),
        studShadow: false,
        plateBevel: false,
      }),
    [],
  )
  useEffect(() => () => studTexture.dispose(), [studTexture])

  return (
    <mesh position={[0, BOARD_CENTER_Y, 0]} castShadow receiveShadow>
      <boxGeometry args={[BOARD_WIDTH, BOARD_HEIGHT, BOARD_THICKNESS]} />
      <meshStandardMaterial attach="material-0" color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
      <meshStandardMaterial attach="material-1" color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
      <meshStandardMaterial attach="material-2" color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
      <meshStandardMaterial attach="material-3" color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
      <meshStandardMaterial attach="material-4" map={studTexture} {...MATERIAL_PBR.WOOD} />
      <meshStandardMaterial attach="material-5" color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
    </mesh>
  )
}

// Two square support posts from the ground up to the frame's own bottom
// edge — same "physical object needs a base" idea as data/podiumStage.js's
// sign posts, just standalone here rather than resting on a tier.
function Legs() {
  const x = BOARD_WIDTH / 2 - LEG_INSET
  return (
    <>
      {[-x, x].map((lx) => (
        <mesh key={lx} position={[lx, LEG_HEIGHT / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[LEG_SECTION, LEG_HEIGHT, LEG_SECTION]} />
          <meshStandardMaterial color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
        </mesh>
      ))}
    </>
  )
}

// The two decorative knob studs above the frame's top edge and the flat
// side tabs at mid-height — the reference image's corner lugs/notches.
// Purely cosmetic, no collider (same precedent as data/pvpCenterPentagon.js's
// summit shell/disc: renders, stays walk-through).
function Trim() {
  const studX = BOARD_WIDTH / 2 - CORNER_STUD_INSET
  const tabX = BOARD_WIDTH / 2 + SIDE_TAB_WIDTH / 2
  return (
    <>
      {[-studX, studX].map((sx) => (
        <mesh key={sx} position={[sx, BOARD_TOP + CORNER_STUD_HEIGHT / 2, 0]} castShadow>
          <cylinderGeometry args={[CORNER_STUD_RADIUS, CORNER_STUD_RADIUS, CORNER_STUD_HEIGHT, 16]} />
          <meshStandardMaterial color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
        </mesh>
      ))}
      {[-tabX, tabX].map((sx) => (
        <mesh key={sx} position={[sx, BOARD_CENTER_Y, 0]} castShadow>
          <boxGeometry args={[SIDE_TAB_WIDTH, SIDE_TAB_HEIGHT, SIDE_TAB_DEPTH]} />
          <meshStandardMaterial color={LEADERBOARD_COLORS.frame} {...MATERIAL_PBR.WOOD} />
        </mesh>
      ))}
    </>
  )
}

// The dark readable panel, proud of the frame's front face, plus faint
// alternating row-banding stripes behind every fixed slot (the reference
// image's own scroll shading) — drawn for all FIXED_ROW_SLOTS regardless of
// how many are actually filled, so an empty slot still reads as "a row",
// just blank, rather than the banding jumping around as players join/leave.
// `selfSlot` (0-based, or -1 if we're not in the visible rows — e.g. more
// than FIXED_ROW_SLOTS players outrank us) swaps that one slot's stripe for
// panelStripeSelf, a small "that's you" cue behind whichever rank we hold.
function Panel({ selfSlot }) {
  return (
    <>
      <mesh position={[0, PANEL_CENTER_Y, PANEL_FRONT_Z]}>
        <boxGeometry args={[PANEL_WIDTH, PANEL_HEIGHT, PANEL_THICKNESS]} />
        <meshStandardMaterial color={LEADERBOARD_COLORS.panel} {...MATERIAL_PBR.WOOD} />
      </mesh>
      {ROW_YS.map((y, i) => (
        <mesh key={i} position={[0, y, PANEL_FRONT_Z + PANEL_THICKNESS / 2 + 0.002]}>
          <planeGeometry args={[PANEL_WIDTH - 0.1, ROW_HEIGHT * 0.92]} />
          <meshStandardMaterial
            color={
              i === selfSlot
                ? LEADERBOARD_COLORS.panelStripeSelf
                : i % 2 === 0
                  ? LEADERBOARD_COLORS.panelStripeA
                  : LEADERBOARD_COLORS.panelStripeB
            }
            {...MATERIAL_PBR.WOOD}
          />
        </mesh>
      ))}
    </>
  )
}

// One row: rank (left, gold/purple/orange for the top 3 — data/
// leaderboardBoard.js's rankColorFor), name (centre-left, white), score
// (right) — same three-text-elements-per-row idea as GlowFloorPanelLabel.jsx's
// title/caption pair, just three columns instead of one stacked pair. Not
// billboarded: this is a physical board mounted at a fixed yaw (data/
// leaderboardBoard.js LEADERBOARD_TRANSFORM), same static-signage convention
// as data/podiumStage.js's own board.
//
// `rank`/`name`/`score`/`isSelf` are live (systems/net.js's getLeaderboard(),
// fed by the room's shared player state), read by this file's default
// export below and passed down already formatted/ranked — this component
// just lays them out, same "component just mounts what data/ computed"
// split as the rest of the file. `isSelf` tints the name a distinct color
// (data/leaderboardBoard.js's selfNameColor) — the small "that's you" cue,
// alongside Panel's own matching stripe for the same row.
function Row({ rank, name, score, isSelf }) {
  const { y, nameFontSize } = getRowLayout(rank, name, score)
  return (
    <group position={[0, y, TEXT_Z]}>
      <Text
        position={[RANK_TEXT_X, 0, 0]}
        fontSize={ROW_FONT_SIZE}
        fontWeight="bold"
        color={rankColorFor(rank)}
        outlineWidth={0.02}
        outlineColor="#000000"
        anchorX="left"
        anchorY="middle"
      >
        {`#${rank}`}
      </Text>
      <Text
        position={[NAME_TEXT_X, 0, 0]}
        fontSize={nameFontSize}
        fontWeight="bold"
        color={isSelf ? LEADERBOARD_COLORS.selfNameColor : ENTRY_NAME_COLOR}
        outlineWidth={0.02}
        outlineColor="#000000"
        anchorX="left"
        anchorY="middle"
        whiteSpace="nowrap"
      >
        {name}
      </Text>
      <Text
        position={[SCORE_TEXT_X, 0, 0]}
        fontSize={ROW_FONT_SIZE}
        fontWeight="bold"
        color={PLAYER_ROW_SCORE_COLOR}
        outlineWidth={0.02}
        outlineColor="#000000"
        anchorX="right"
        anchorY="middle"
      >
        {score}
      </Text>
    </group>
  )
}

// The footer timer strip: a small dark chip with two bright glow bars either
// side of the label (the reference image's countdown strip). The label
// itself (data/leaderboardBoard.js LEADERBOARD_TIMER_TEXT) is hidden for
// now — it was static "101s" text, not a live countdown, and read as
// misleading. Chip + bars stay so the footer slot doesn't visibly change.
function TimerChip() {
  const chipWidth = PANEL_WIDTH * 0.62
  const chipHeight = TIMER_FONT_SIZE * 1.8
  const barWidth = PANEL_WIDTH * 0.14
  const barX = chipWidth / 2 + 0.1 + barWidth / 2
  return (
    <group position={[0, TIMER_Y, 0]}>
      <mesh position={[0, 0, TEXT_Z - 0.004]}>
        <planeGeometry args={[chipWidth, chipHeight]} />
        <meshStandardMaterial color={LEADERBOARD_COLORS.timerChip} {...MATERIAL_PBR.WOOD} />
      </mesh>
      {[-barX, barX].map((bx) => (
        <mesh key={bx} position={[bx, 0, TEXT_Z - 0.002]}>
          <planeGeometry args={[barWidth, chipHeight * 0.35]} />
          <meshBasicMaterial color={LEADERBOARD_COLORS.timerGlow} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// Re-renders on any roster/roster-field change systems/net.js's emit() fires
// for (a player joining/leaving, a username, avatar, or REMOTE stat change —
// see net.js's own subscribe() doc comment). Not per frame (Tech.md §5.4):
// emit() only fires on those human-speed events, never per move packet.
function useNetRoster() {
  const [, bump] = useReducer((n) => n + 1, 0)
  useEffect(() => subscribeNet(() => bump()), [])
}

// A freestanding Lego-brick-styled scoreboard: a stud-textured brown frame
// (FrameBoard) on two support posts (Legs), decorative corner studs/side
// tabs (Trim), a dark inset panel with row banding (Panel), a customizable
// title + a live, real leaderboard (Row, one per systems/net.js
// getLeaderboard() entry), and a static footer timer chip (TimerChip). The
// title is data-driven from data/leaderboardBoard.js (each
// LEADERBOARD_TRANSFORMS entry's own `title`); the rows are live — read
// here, not from a data table, since which players are connected and what
// they've earned only exists at runtime.
//
// `transform` picks where/how this instance is placed — same shape as
// data/podiumStage.js's own transform objects, `{ x, y, z, yaw }` — so
// App.jsx can mount several boards (one per entry in data/leaderboardBoard.js's
// LEADERBOARD_TRANSFORMS) the same way it mounts two PodiumStage instances
// off PODIUM_STAGE_HUB_TRANSFORM/PODIUM_STAGE_TARGET_TRANSFORM. `title` is
// each board's own heading; `stat` is which store/useGameStore.js field
// (mirrored onto the Colyseus room's shared PlayerState — Server/src/rooms/
// schema/ArenaState.ts) it ranks by (`'power'` | `'rebirth'` | `'wins'`,
// ...) — App.jsx passes each transform entry's own `title`/`stat` fields
// alongside it, so the three boards rank differently while sharing this one
// component. All three default to LEADERBOARD_TRANSFORM/LEADERBOARD_TITLE/
// `'power'` so a bare <LeaderboardBoard /> still works unchanged.
//
// Rows come from systems/net.js's getLeaderboard(stat, limit): our own row
// always from the live store (no network round trip needed for our own
// numbers), every other row from remotePlayers, both formatted with data/
// format.js's formatShort — the one place number presentation is decided
// (Tech.md §4), same formatter the HUD's own Power caption uses (components/
// hud/LevelBar.jsx). `useGameStore((s) => s[stat])` below re-renders this
// instantly on our OWN stat changing (getLeaderboard() reads it fresh either
// way, this just triggers the re-render) rather than waiting on the
// debounced network round trip that updates everyone else's copy of us.
export default function LeaderboardBoard({
  transform = LEADERBOARD_TRANSFORM,
  title = LEADERBOARD_TITLE,
  stat = 'power',
}) {
  useNetRoster()
  useGameStore((s) => s[stat])
  const rows = getLeaderboard(stat, FIXED_ROW_SLOTS)
  const selfSlot = rows.findIndex((row) => row.isSelf)

  return (
    <group position={[transform.x, transform.y, transform.z]} rotation={[0, transform.yaw, 0]}>
      <FrameBoard />
      <Legs />
      <Trim />
      <Panel selfSlot={selfSlot} />
      <Text
        position={[0, TITLE_Y, TEXT_Z]}
        fontSize={TITLE_FONT_SIZE}
        fontWeight="bold"
        color={LEADERBOARD_COLORS.titleColor}
        outlineWidth={0.045}
        outlineColor="#000000"
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        maxWidth={PANEL_WIDTH - 0.4}
        whiteSpace="normal"
      >
        {title}
      </Text>
      {rows.map((row, i) => (
        <Row key={row.id} rank={i + 1} name={row.name} score={formatShort(row.value)} isSelf={row.isSelf} />
      ))}
      <TimerChip />
    </group>
  )
}
