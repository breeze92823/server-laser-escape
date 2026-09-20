// Aura tier list shown in the HUD's Aura popup (components/hud/Hud.jsx
// AuraWindow) — one row per tier, same list-of-upgrades shape as
// HEX_POWER_PAD_TIERS but for the (not yet implemented) Aura system, so the
// UI has something real to render before the feature's own balancing lands.
// winsRequired spans 5 -> 100,000,000 and strengthMult spans 1.2x -> 5x
// across the 13 tiers.
//
// `iconUrl` points at per-tier art that doesn't exist yet — placeholder
// filenames under public/ui/aura/ for icons to be dropped in by hand later;
// until then the <img> just renders blank (Hud.jsx's AuraEntry sets no
// broken-image fallback on purpose).
// The magical-fire particle trail (components/AuraParticles.jsx) no longer
// varies by tier — every aura renders the same fixed violet gradient (data/
// auraParticles.js's FIRE_CORE_COLOR/FIRE_EDGE_COLOR).
export const AURA_TIERS = [
  { name: 'Spark Aura', strengthMult: 1.2, winsRequired: 5, gemCost: 3, iconUrl: '/ui/aura/aura-01.png' },
  { name: 'Ember Aura', strengthMult: 1.35, winsRequired: 25, gemCost: 5, iconUrl: '/ui/aura/aura-02.png' },
  { name: 'Ultra Instinct', strengthMult: 1.6, winsRequired: 100, gemCost: 17, iconUrl: '/ui/aura/aura-03.png' },
  { name: 'Frost Aura', strengthMult: 1.9, winsRequired: 500, gemCost: 25, iconUrl: '/ui/aura/aura-04.png' },
  { name: 'Storm Aura', strengthMult: 2.2, winsRequired: 2500, gemCost: 35, iconUrl: '/ui/aura/aura-05.png' },
  { name: 'Radiant Aura', strengthMult: 2.6, winsRequired: 10000, gemCost: 50, iconUrl: '/ui/aura/aura-06.png' },
  { name: 'Phoenix Aura', strengthMult: 3, winsRequired: 50000, gemCost: 70, iconUrl: '/ui/aura/aura-07.png' },
  { name: 'Void Aura', strengthMult: 3.4, winsRequired: 250000, gemCost: 95, iconUrl: '/ui/aura/aura-08.png' },
  { name: 'Divine Aura', strengthMult: 3.8, winsRequired: 1000000, gemCost: 130, iconUrl: '/ui/aura/aura-09.png' },
  { name: 'Celestial Aura', strengthMult: 4.2, winsRequired: 5000000, gemCost: 175, iconUrl: '/ui/aura/aura-10.png' },
  { name: 'Eternal Aura', strengthMult: 4.5, winsRequired: 15000000, gemCost: 230, iconUrl: '/ui/aura/aura-11.png' },
  { name: 'Omega Aura', strengthMult: 4.8, winsRequired: 50000000, gemCost: 300, iconUrl: '/ui/aura/aura-12.png' },
  { name: 'Transcendent Aura', strengthMult: 5, winsRequired: 100000000, gemCost: 400, iconUrl: '/ui/aura/aura-13.png' },
]

// store/useGameStore.js's gainPower() factor for the currently equipped aura
// — same shape as data/afk.js's afkPowerMultiplier. `equippedAura` is an
// index into AURA_TIERS, or null while nothing is equipped (1x, i.e. no-op).
export function auraStrengthMultiplier(equippedAura) {
  const tier = AURA_TIERS[equippedAura]
  return tier ? tier.strengthMult : 1
}

// Looked up by name rather than hardcoded so both systems/auraParticles.js
// (which suppresses its own violet trail for this tier) and systems/
// ultraInstinctAura.js (which spawns instead) agree on the same tier even
// if AURA_TIERS is ever reordered.
export const ULTRA_INSTINCT_INDEX = AURA_TIERS.findIndex((tier) => tier.name === 'Ultra Instinct')
