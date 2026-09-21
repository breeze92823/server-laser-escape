import { create } from 'zustand'
import {
  POWER_INITIAL,
  POWER_MIN,
  POWER_MAX,
  LEVEL_INITIAL,
  REBIRTH_INITIAL,
  REBIRTH_MIN,
  REBIRTH_MAX,
  WINS_INITIAL,
  WINS_MIN,
  WINS_MAX,
  POWER_PER_ACTION_INITIAL,
  levelForPower,
  canAcceptRebirth,
  clamp,
} from '../data/progression.js'
import { HEX_POWER_PAD_TIERS } from '../data/hexPowerPad.js'
import { AURA_TIERS, auraStrengthMultiplier } from '../data/aura.js'
import { SHOP_ITEMS } from '../data/shop.js'
import { AFK_TARGET_CONFIG } from '../data/afk.js'

// Tech.md §2/§5: THE store — durable state + derive() + all actions. No
// middleware (no persist, no immer, no subscribeWithSelector).

// Recomputes every field that is a pure function of another durable field.
// Called at the end of any action that changes power, so level never has to
// be restated by hand at more than one call site.
function derive(state) {
  return { ...state, level: levelForPower(state.power) }
}

export const useGameStore = create((set, get) => ({
  power: POWER_INITIAL,
  level: LEVEL_INITIAL,
  rebirth: REBIRTH_INITIAL,
  wins: WINS_INITIAL,
  powerPerAction: POWER_PER_ACTION_INITIAL,
  destroyedWalls: new Set(),
  // Tier 0 (data/hexPowerPad.js HEX_POWER_PAD_TIERS[0]) has winsRequired: 0
  // and powerPerAction 1 — same as POWER_PER_ACTION_INITIAL above — so it's
  // the free starter tier, owned and equipped from the start.
  ownedHexPads: new Set([0]), // indices into data/hexPowerPad.js's HEX_POWER_PAD_TIERS
  equippedHexPad: 0, // index of the currently equipped pad, or null
  ownedAuras: new Set(), // indices into data/aura.js's AURA_TIERS bought with wins
  equippedAura: null, // index into data/aura.js's AURA_TIERS, or null (1x, no aura equipped)
  ownedTargets: new Set(), // data/targets.js ids bought via buyTarget below (only ids with an AFK_TARGET_CONFIG winsRequired ever need to appear here)

  // One Action's worth of Power. Called only from systems/actionTracker.js,
  // never directly from a component. `multiplier` is the AFK target's "xN"
  // tier (systems/afk.js afkState.multiplier) while AFK-locked, else 1 — the
  // spec's override: powerPerAction * (rebirth + 1) * multiplier * aura
  // strength (auraStrengthMultiplier(equippedAura), 1x while nothing's
  // equipped), floored to a whole number (aura/AFK multipliers are the only
  // non-integer factors). Returns the Power actually added after the
  // POWER_MAX clamp (0 once maxed), which systems/actionTracker.js turns
  // into a "+N" popup.
  gainPower(multiplier = 1) {
    let applied = 0
    set((state) => {
      const mult = multiplier > 0 ? multiplier : 1
      const auraMult = auraStrengthMultiplier(state.equippedAura)
      const gain = Math.floor(state.powerPerAction * (state.rebirth + 1) * mult * auraMult)
      const power = clamp(state.power + gain, POWER_MIN, POWER_MAX)
      applied = power - state.power
      return derive({ ...state, power })
    })
    return applied
  },

  // Manual, gated by canAcceptRebirth. Re-checks eligibility itself so a
  // duplicate/stale caller can never double-apply a rebirth.
  acceptRebirth() {
    const state = get()
    if (!canAcceptRebirth(state.level, state.rebirth)) return
    set((s) =>
      derive({
        ...s,
        rebirth: clamp(s.rebirth + 1, REBIRTH_MIN, REBIRTH_MAX),
        power: POWER_INITIAL,
      }),
    )
  },

  // Called once from systems/wallHealth.js the frame a wall's health first
  // reaches 0. Idempotent: adding an id already in the set is a no-op change.
  destroyWall(id) {
    set((s) => ({ destroyedWalls: new Set(s.destroyedWalls).add(id) }))
  },

  // Called only from systems/glowFloorPanel.js, the frame the player first
  // steps onto a given win panel (that system re-arms per panel on exit, so a
  // held stand never re-triggers). Just grows the running total — spending
  // (buyHexPad, buyAuraTier) happens separately.
  awardWins(amount) {
    if (!(amount > 0)) return
    set((s) => ({ wins: s.wins + amount }))
  },

  // Also called from systems/glowFloorPanel.js on a win-panel respawn: forget
  // every destroyed wall so WallProps.jsx remounts them all. The matching
  // health snapshot and colliders are restored by systems/wallHealth.js
  // resetWalls() and systems/collision.js resetAabbs() in the same step. A
  // no-op change when nothing is destroyed.
  resetWalls() {
    set((s) => (s.destroyedWalls.size === 0 ? s : { destroyedWalls: new Set() }))
  },

  // Called only from systems/hexPowerPad.js, which already checked
  // nearness/interact — re-checks ownership and affordability itself so a
  // duplicate/stale caller (or a wins value that has since dropped) can never
  // double-charge, double-apply, or drive wins negative. Wins are spent here,
  // same as buyAuraTier below.
  buyHexPad(index) {
    const state = get()
    if (state.ownedHexPads.has(index)) return
    const tier = HEX_POWER_PAD_TIERS[index]
    if (!tier || state.wins < tier.winsRequired) return
    set((s) => ({ wins: s.wins - tier.winsRequired, ownedHexPads: new Set(s.ownedHexPads).add(index) }))
  },

  // Re-checks ownership itself, same reasoning as buyHexPad above.
  equipHexPad(index) {
    const state = get()
    if (!state.ownedHexPads.has(index)) return
    const tier = HEX_POWER_PAD_TIERS[index]
    if (!tier) return
    set({ equippedHexPad: index, powerPerAction: tier.powerPerAction })
  },

  // Called from components/hud/Hud.jsx's AuraEntry wins button. Unlike
  // buyHexPad, wins here are spent, not a threshold — re-checks ownership and
  // affordability itself so a duplicate/stale caller (or a wins value that
  // has since dropped) can never double-charge or drive wins negative.
  // Buying doesn't equip it — the tier just becomes available to equip via
  // equipAuraTier below (Hud.jsx swaps the wins button for an Equip button
  // once owned).
  buyAuraTier(index) {
    const state = get()
    if (state.ownedAuras.has(index)) return
    const tier = AURA_TIERS[index]
    if (!tier || state.wins < tier.winsRequired) return
    set((s) => ({ wins: s.wins - tier.winsRequired, ownedAuras: new Set(s.ownedAuras).add(index) }))
  },

  // Re-checks ownership itself, same reasoning as equipHexPad above. Only one
  // aura can be equipped at a time — setting equippedAura to a new index is
  // itself what un-equips whichever tier held it before (Hud.jsx's AuraEntry
  // just compares its own index against equippedAura to render Equip vs
  // Equipped, so the previous tier's button flips back automatically).
  equipAuraTier(index) {
    const state = get()
    if (!state.ownedAuras.has(index)) return
    set({ equippedAura: index })
  },

  // Clears equippedAura back to null (1x, no aura) — only if the given index
  // is the one currently equipped, so a stale caller can't clobber a tier the
  // player has since switched to. Hud.jsx's AuraEntry swaps its "Equipped"
  // pill for an "Unequip" button while owned && equipped, wired to this.
  unequipAuraTier(index) {
    const state = get()
    if (state.equippedAura !== index) return
    set({ equippedAura: null })
  },

  // Called from components/hud/Hud.jsx's TargetPurchaseWindow Buy button —
  // the one-time Wins unlock for a data/afk.js AFK_TARGET_CONFIG entry that
  // carries a winsRequired (currently vortex_target, grand_gold_multi_target).
  // Same re-check-everything-itself shape as buyHexPad/buyAuraTier above so a
  // duplicate/stale caller can't double-charge or drive wins negative. A
  // target with no winsRequired (or already owned) is a no-op — systems/
  // afk.js never opens this purchase flow for one anyway, but this stays
  // safe to call regardless.
  buyTarget(id) {
    const state = get()
    if (state.ownedTargets.has(id)) return
    const cfg = AFK_TARGET_CONFIG[id]
    if (!cfg?.winsRequired || state.wins < cfg.winsRequired) return
    set((s) => ({ wins: s.wins - cfg.winsRequired, ownedTargets: new Set(s.ownedTargets).add(id) }))
  },

  // Called from components/hud/Hud.jsx's ShopItemCard "Buy with Wins"
  // button — the wins-priced alternative to the SKU's (unwired) Bux price,
  // same affordability-gate-then-spend shape as buyAuraTier/buyHexPad above.
  // Re-checks affordability itself so a duplicate/stale caller (or a wins
  // value that has since dropped) can never double-charge or drive wins
  // negative. These SKUs (data/shop.js) have no owned/equip state of their
  // own yet, so spending the wins is the whole action for now.
  buyShopItemWithWins(id) {
    const state = get()
    const item = SHOP_ITEMS.find((i) => i.id === id)
    if (!item || state.wins < item.winsRequired) return
    set((s) => ({ wins: s.wins - item.winsRequired }))
  },

  // Called from systems/net.js's sendIdentityNow() the moment a signed-in
  // player logs out back to a guest session — a guest has no durable save
  // (getStableUserId() is '' for one, so progressPayload() never reaches
  // Mongo for it either), so without this the old account's numbers would
  // just keep running as if they were free progress on the anonymous session
  // that follows. Puts every account-scoped field back to the exact defaults
  // a brand-new guest starts with. World state (destroyedWalls) is untouched
  // — that belongs to the shared level, not the player's own progress.
  resetProgress() {
    set((s) =>
      derive({
        ...s,
        power: POWER_INITIAL,
        rebirth: REBIRTH_INITIAL,
        wins: WINS_INITIAL,
        powerPerAction: POWER_PER_ACTION_INITIAL,
        ownedHexPads: new Set([0]),
        equippedHexPad: 0,
        ownedAuras: new Set(),
        equippedAura: null,
        ownedTargets: new Set(),
      }),
    )
  },

  // Called once from systems/net.js when the server's `progress` message
  // arrives (server-laser-escape ArenaRoom.ts loadProgress(), the saved doc
  // for this signed-in player's Bloxity user id). Only ever runs at most once
  // per room attach, right after join — never merges into an already-playing
  // session, so a slow load can't stomp progress the player made in the few
  // seconds before it arrived. Numbers are re-clamped exactly like every
  // other write path (gainPower, buyHexPad, ...) rather than trusted as-is,
  // since this round-tripped through the network and, before that, whatever
  // this same client last saved.
  hydrate(saved) {
    if (!saved || typeof saved !== 'object') return
    set((s) => {
      const power = clamp(Number(saved.power) || 0, POWER_MIN, POWER_MAX)
      const rebirth = clamp(Number(saved.rebirth) || 0, REBIRTH_MIN, REBIRTH_MAX)
      const wins = clamp(Number(saved.wins) || 0, WINS_MIN, WINS_MAX)
      const ownedHexPads = new Set(
        Array.isArray(saved.ownedHexPads) && saved.ownedHexPads.length ? saved.ownedHexPads : [0],
      )
      const equippedHexPad = ownedHexPads.has(saved.equippedHexPad) ? saved.equippedHexPad : 0
      const ownedAuras = new Set(Array.isArray(saved.ownedAuras) ? saved.ownedAuras : [])
      const equippedAura = ownedAuras.has(saved.equippedAura) ? saved.equippedAura : null
      const ownedTargets = new Set(Array.isArray(saved.ownedTargets) ? saved.ownedTargets : [])
      const tier = HEX_POWER_PAD_TIERS[equippedHexPad]
      return derive({
        ...s,
        power,
        rebirth,
        wins,
        ownedHexPads,
        equippedHexPad,
        powerPerAction: tier ? tier.powerPerAction : s.powerPerAction,
        ownedAuras,
        equippedAura,
        ownedTargets,
      })
    })
  },
}))
