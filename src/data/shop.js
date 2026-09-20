// Shop tile list shown in the HUD's Shop popup (components/hud/Hud.jsx
// ShopWindow) — one card per SKU, priced in Bux (systems/bloxity.js's premium
// balance; see AuthPanel.jsx). Mirrors AURA_TIERS' "data owns every tunable"
// shape (data/aura.js) but for purchasable one-off perks instead of a tier
// ladder.
//
// `iconUrl` reuses the existing wins-trophy art for the one SKU that already
// has an icon; the other two have none yet (`null` renders as a bare card,
// same "blank until art lands" convention as AURA_TIERS' iconUrl).
// `featured` picks the gold/highlighted card treatment vs. the plain grey
// one — set on the SKU that should stand out, same idea as a "best value"
// badge in a real IAP shop.
//
// Buying with Bux is not wired yet: systems/bloxity.js's Bux section
// explains why (SDK.bux.requestPurchase needs a server-to-server webhook
// this game does not have; calling it today would charge Bux for nothing
// and auto-refund). ShopWindow's Bux buy button is visual-only until that
// backend lands.
//
// `winsRequired` is the alternate "Buy with Wins" price
// (store/useGameStore.js buyShopItemWithWins) — set to the same number as
// priceBux so a card reads as one price in two currencies, not two
// different deals.
export const SHOP_ITEMS = [
  { id: 'x2_wins', name: 'x2 Wins', priceBux: 79, winsRequired: 79000, iconUrl: '/ui/xp_cup.png', featured: true },
  { id: 'vip_laser', name: 'VIP LASER', priceBux: 67, winsRequired: 67000, iconUrl: null, featured: false },
  { id: 'golden_target', name: 'GOLDEN TARGET', priceBux: 299, winsRequired: 299000, iconUrl: null, featured: false },
]
