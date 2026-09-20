// Sound-effect data (Tech.md §4: src/data/ owns every tunable number/path).
// Both laser sounds are real audio files, not synthesized: drop them at these
// paths (same convention as /models, /textures, /ui — see data/hexPowerPad.js,
// data/actionPopups.js) and Vite serves them as-is.

// The one-shot fired on the press edge only (systems/actionTracker.js) —
// never repeated while the button stays held, that's laser_beam.mp3's job.
export const LASER_FIRE_SOUND_URL = '/audio/laser_fire.mp3'
export const LASER_FIRE_GAIN = 0.12 // 0..1, multiplies on top of the master volume bus

// Looped for as long as systems/laser.js's laser.active stays true (real
// mouse hold or the AFK auto-fire lock) — the continuous "still firing" bed,
// started/stopped on that edge instead of retriggering the one-shot above.
export const LASER_BEAM_SOUND_URL = '/audio/laser_beam.mp3'
export const LASER_BEAM_GAIN = 0.09 // 0..1, multiplies on top of the master volume bus
export const LASER_BEAM_FADE_IN = 0.04 // s, click-free start
export const LASER_BEAM_FADE_OUT = 0.06 // s, click-free stop

// One-shot fired every time an Action grants Power (systems/actionPopups.js's
// spawnActionPopup(), the same instant the "+N" badge pops in) — a "pop" that
// syncs with the badge's spawn animation. Drop the file at this path; until it
// exists, sfx.js's loader fails quietly and the game just stays silent here.
// Pitched into the 1.4-2.8kHz range on purpose: laser_beam.mp3's energy sits
// almost entirely below 800Hz, so this stays clear of it instead of getting
// masked by the continuous beam loop while the player holds fire.
export const POWER_GAIN_SOUND_URL = '/audio/power_gain.mp3'
export const POWER_GAIN_GAIN = 0.135 // 0..1, multiplies on top of the master volume bus

// One-shot fired every time the store's `level` rises (components/hud/
// LevelUpPopup.jsx's store subscription, the same instant the "LEVEL UP!"
// banner pops in) — never on Rebirth's drop back to level 1. No real file has
// been dropped at this path yet, so systems/sfx.js's playLevelUp() synthesizes
// it via WebAudio instead (see LEVEL_UP_SYNTH_* below). Drop a real file here
// and swap playLevelUp() over to load it — a real file wins over synthesized
// audio once one exists.
export const LEVEL_UP_SOUND_URL = '/audio/level_up.mp3'
export const LEVEL_UP_GAIN = 0.12 // 0..1, multiplies on top of the master volume bus

// Synthesized stopgap chime: a short ascending arpeggio (systems/sfx.js's
// synthesizeLevelUpBuffer()), rendered once via OfflineAudioContext and cached
// like a decoded file. Delete these and the synthesis code the moment
// level_up.mp3 exists — see the note above.
export const LEVEL_UP_SYNTH_NOTES_HZ = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
export const LEVEL_UP_SYNTH_NOTE_GAP_S = 0.055 // time between each note's start
export const LEVEL_UP_SYNTH_ATTACK_S = 0.006
export const LEVEL_UP_SYNTH_DECAY_S = 0.22
export const LEVEL_UP_SYNTH_SHIMMER_RATIO = 2.01 // detuned octave-up layer per note, slightly sharp for shimmer
export const LEVEL_UP_SYNTH_SHIMMER_GAIN = 0.18 // 0..1, mixed under each note's fundamental

// One-shot fired whenever systems/actionResult.js's showActionResult() is
// called with success=false (a blocked held-E attempt: insufficient Rebirth
// at an AFK target, insufficient Wins at a HexPower pad — see systems/afk.js
// and systems/hexPowerPad.js) — the failure counterpart to POWER_GAIN_GAIN's
// success "pop" above. No real file has been dropped at this path yet, so
// systems/sfx.js's playActionFail() synthesizes it via WebAudio instead (see
// ACTION_FAIL_SYNTH_* below). Drop a real file here and swap playActionFail()
// over to load it, same as LEVEL_UP_SOUND_URL above.
export const ACTION_FAIL_SOUND_URL = '/audio/action_fail.mp3'
export const ACTION_FAIL_GAIN = 0.14 // 0..1, multiplies on top of the master volume bus

// Synthesized stopgap "buzz": two short descending square-wave notes (systems/
// sfx.js's synthesizeActionFailBuffer()), rendered once via OfflineAudioContext
// and cached like a decoded file. Delete these and the synthesis code the
// moment action_fail.mp3 exists — see the note above.
export const ACTION_FAIL_SYNTH_NOTES_HZ = [220, 164.81] // A3 down to E3
export const ACTION_FAIL_SYNTH_NOTE_GAP_S = 0.09 // time between each note's start
export const ACTION_FAIL_SYNTH_ATTACK_S = 0.004
export const ACTION_FAIL_SYNTH_DECAY_S = 0.16

// Fired on every HUD button press (components/hud/Hud.jsx) — Aura/Shop/
// Rebirth open, buy/equip tier, confirm/close/skip. No real file has been
// dropped at this path yet, so systems/sfx.js's playButtonClick() synthesizes
// a short "tick" via WebAudio instead (see BUTTON_CLICK_SYNTH_* below). Drop
// a real file here and swap playButtonClick() over to load it, same as
// LEVEL_UP_SOUND_URL above.
export const BUTTON_CLICK_SOUND_URL = '/audio/button_click.mp3'
export const BUTTON_CLICK_GAIN = 0.075 // 0..1, multiplies on top of the master volume bus

// Synthesized stopgap click: a quick high sine "tick" plus a short filtered
// noise burst for tactile texture (systems/sfx.js's
// synthesizeButtonClickBuffer()), rendered once via OfflineAudioContext and
// cached like a decoded file. Delete these and the synthesis code the moment
// button_click.mp3 exists.
export const BUTTON_CLICK_SYNTH_FREQ_HZ = 1050 // sine tone pitch
export const BUTTON_CLICK_SYNTH_ATTACK_S = 0.002
export const BUTTON_CLICK_SYNTH_DECAY_S = 0.045
export const BUTTON_CLICK_SYNTH_NOISE_GAIN = 0.22 // 0..1, mixed under the tone
export const BUTTON_CLICK_SYNTH_NOISE_DECAY_S = 0.02
