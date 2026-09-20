import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { afkState } from '../../systems/afk.js'
import { hexPowerPadState } from '../../systems/hexPowerPad.js'
import { merchantState } from '../../systems/merchant.js'
import { interactHoldState } from '../../systems/interactHold.js'
import { settings } from '../../systems/settingsState.js'
import { health as playerHealth } from '../../systems/playerHealth.js'
import { playButtonClick } from '../../systems/sfx.js'
import { useGameStore } from '../../store/useGameStore.js'
import { canAcceptRebirth, rebirthRequirement } from '../../data/progression.js'
import { AURA_TIERS } from '../../data/aura.js'
import { SHOP_ITEMS } from '../../data/shop.js'
import ActionPopups from './ActionPopups.jsx'
import TouchControls from './TouchControls.jsx'
import RotatePrompt from './RotatePrompt.jsx'
import LevelBar from './LevelBar.jsx'
import RebirthLevelBar from './RebirthLevelBar.jsx'
import LevelUpPopup from './LevelUpPopup.jsx'
import NetStatus from './NetStatus.jsx'
import AuthPanel from './AuthPanel.jsx'
import IdentityChip from './IdentityChip.jsx'
import ActionResult from './ActionResult.jsx'
import { actionResultState } from '../../systems/actionResult.js'
import { useSettings, useTouchMode } from './hooks.js'

// 1000 -> "1K", 1500 -> "1.5K", 2_000_000 -> "2M". Trims a trailing ".0".
function formatCompact(n) {
  const abs = Math.abs(n)
  if (abs < 1000) return String(n)
  const units = [
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' },
    { value: 1e3, suffix: 'K' },
  ]
  const { value, suffix } = units.find((u) => abs >= u.value)
  const scaled = n / value
  const text = scaled.toFixed(1).replace(/\.0$/, '')
  return `${text}${suffix}`
}

// Shared chrome for every left-center HUD popup (Rebirth, Aura, ...): a
// transparent panel with the title floating (no fill/border box) above its
// top-left corner and the close button overhanging its top-right corner, so
// every popup reads as one consistent "poking out of the panel" style.
//
// `isTouch` shrinks the body's padding — RotatePrompt.jsx forces landscape on
// touch, and phones in landscape there can be as short as ~320px, too little
// for the desktop sizing to fit alongside a bottom-anchored TouchControls
// layer. The panel also caps itself to the viewport height and scrolls
// internally (`max-h-[92vh] overflow-y-auto`) as a hard backstop so a
// shorter device than anticipated still reaches the bottom of the content
// instead of clipping it.
function HudModal({ title, onClose, isTouch, children }) {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2"
      // systems/input.js listens for wheel on window to drive camera zoom
      // (cameraOrbit.js) regardless of what's under the cursor. Stop it here
      // so scrolling a popup's content (e.g. AuraWindow's tier list) doesn't
      // also zoom the camera behind it.
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="relative w-[min(800px,78vw)]">
        <span
          className="pointer-events-none absolute -top-5 left-6 z-10 text-4xl font-black text-white"
          style={{ WebkitTextStroke: '1.5px black', paintOrder: 'stroke fill' }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={() => {
            playButtonClick()
            onClose()
          }}
          aria-label="Close"
          className="absolute -top-4 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-md border-2 border-black bg-red-600 font-black text-white shadow-[0_3px_0_rgba(0,0,0,0.4)] transition hover:bg-red-500"
        >
          X
        </button>
        <div className="flex max-h-[92vh] flex-col overflow-hidden rounded-lg border-2 border-black bg-slate-900/60 shadow-2xl">
          <div className="h-6 shrink-0 border-b-2 border-black bg-slate-900/60" />
          <div
            className={`flex flex-col items-center overflow-y-auto text-slate-100 ${isTouch ? 'gap-2 p-2' : 'gap-3 p-4'}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// Opened by Button 4, titled "Rebirth". Confirms the trade of current Power
// for a rebirth point rather than firing it on a single click.
function RebirthWindow({ rebirth, canRebirth, onConfirm, onClose, isTouch }) {
  const requirement = rebirthRequirement(rebirth)
  return (
    <HudModal title="Rebirth" onClose={onClose} isTouch={isTouch}>
      <div
            className={`flex items-center justify-center ${isTouch ? 'gap-2 text-2xl' : 'gap-6 text-[3.625rem]'}`}
          >
            <img
              src="/ui/action_popup.png"
              alt=""
              className={isTouch ? 'h-9 w-9' : 'h-[5.5rem] w-[5.5rem]'}
              draggable={false}
            />
            <span className="font-bold text-amber-300">X{rebirth}</span>
            <span
              className={`inline-block font-black leading-none text-white ${isTouch ? 'text-2xl' : 'text-[4.5rem]'}`}
              style={{ WebkitTextStroke: isTouch ? '2px #7dd3fc' : '3px #7dd3fc', paintOrder: 'stroke fill' }}
            >
              ▶
            </span>
            <img
              src="/ui/action_popup.png"
              alt=""
              className={isTouch ? 'h-9 w-9' : 'h-[5.5rem] w-[5.5rem]'}
              draggable={false}
            />
            <span className="font-bold text-amber-300">X{rebirth + 1}</span>
          </div>

          <div
            className={`text-center font-bold text-red-500 ${isTouch ? 'text-sm' : 'text-[1.625rem]'}`}
            style={{ WebkitTextStroke: isTouch ? '1.5px black' : '3px black', paintOrder: 'stroke fill' }}
          >
            Rebirth resets your Strength and Level!
          </div>

          {/* Visual twin of the bottom-of-screen LevelBar, but plotting level
             progress toward this rebirth's requirement instead of Power
             toward the next character level — see RebirthLevelBar.jsx.
             LevelBar itself stays untouched. */}
          <div className="w-full">
            <RebirthLevelBar compact={isTouch} />
          </div>

          <div
            className={`flex w-full items-stretch justify-center ${isTouch ? 'mb-3 gap-2' : 'mb-5 mt-2 gap-3'}`}
          >
            <button
              type="button"
              onClick={() => {
                playButtonClick()
                onConfirm()
              }}
              disabled={!canRebirth}
              className={`flex-1 self-center rounded-lg border-2 border-black bg-gradient-to-b from-lime-400 to-green-600 font-black text-white shadow-[0_4px_0_rgba(0,0,0,0.4)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${isTouch ? 'px-2 py-2 text-sm' : 'px-4 py-3 text-lg'}`}
              style={{ WebkitTextStroke: isTouch ? '1px black' : '1.5px black', paintOrder: 'stroke fill' }}
            >
              {canRebirth ? 'Rebirth' : `Level ${requirement} needed`}
            </button>

            <span className={`self-center font-black text-slate-100 ${isTouch ? 'text-sm' : 'text-xl'}`}>
              or
            </span>

            {/* relative wrapper keeps the caption out of flow so it can't
               stretch this column taller than the Rebirth button and knock
               the two buttons' top edges out of alignment. */}
            <div className="relative flex-1 self-center">
              <button
                type="button"
                onClick={() => {
                  playButtonClick()
                  onClose()
                }}
                className={`w-full rounded-lg border-2 border-black font-black text-white shadow-[0_4px_0_rgba(0,0,0,0.4)] transition hover:brightness-110 ${isTouch ? 'px-2 py-2 text-sm' : 'px-4 py-3 text-lg'}`}
                style={{
                  background:
                    'linear-gradient(90deg, #ff3b3b, #ff9d00, #ffee00, #4dff4d, #33d1ff, #6f6fff, #c96fff)',
                  WebkitTextStroke: isTouch ? '1px black' : '1.5px black',
                  paintOrder: 'stroke fill',
                }}
              >
                Skip Rebirth
              </button>
              <span
                className={`absolute inset-x-0 top-full mt-1 text-center font-bold text-fuchsia-400 ${isTouch ? 'text-[10px]' : 'text-sm'}`}
              >
                Keep all Levels
              </span>
            </div>
          </div>
    </HudModal>
  )
}

// One row of the Aura popup's tier list: icon on the left, name + strength
// multiplier in the middle, one action button on the right that walks
// through three states — mirrors the reference mock the list was built from.
//   1. Not owned: the wins button (buyAuraTier), disabled until affordable.
//   2. Owned, not equipped: an "Equip" button (equipAuraTier).
//   3. Owned and equipped: an "Unequip" button (unequipAuraTier) next to the
//      non-interactive "Equipped" pill.
// equippedAura is a single store field, so equipping tier N is itself what
// flips every other tier's button back to "Equip" — each row just compares
// its own index against the shared equippedAura. Unequipping sets it back to
// null (1x, no aura) rather than to another tier.
function AuraEntry({ tier, index, isTouch }) {
  const wins = useGameStore((s) => s.wins)
  const owned = useGameStore((s) => s.ownedAuras.has(index))
  const equipped = useGameStore((s) => s.equippedAura === index)
  const buyAuraTier = useGameStore((s) => s.buyAuraTier)
  const equipAuraTier = useGameStore((s) => s.equipAuraTier)
  const unequipAuraTier = useGameStore((s) => s.unequipAuraTier)
  const canAfford = wins >= tier.winsRequired
  const textOutline = { WebkitTextStroke: isTouch ? '1px black' : '1.5px black', paintOrder: 'stroke fill' }
  return (
    <div
      className={`flex w-full shrink-0 items-center rounded-lg border-2 border-black bg-slate-800/80 ${isTouch ? 'gap-2 p-2' : 'gap-3 p-3'}`}
    >
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-slate-500 bg-slate-950 ${isTouch ? 'h-11 w-11' : 'h-16 w-16'}`}
      >
        <img
          src={tier.iconUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className={`font-black text-white ${isTouch ? 'text-sm' : 'text-xl'}`} style={textOutline}>
          {tier.name}
        </span>
        <span className={`font-black text-amber-400 ${isTouch ? 'text-xs' : 'text-lg'}`} style={textOutline}>
          x{tier.strengthMult} Strength
        </span>
      </div>

      <div className={`flex shrink-0 flex-col ${isTouch ? 'gap-0.5' : 'gap-1'}`}>
        {!owned && (
          <button
            type="button"
            onClick={() => {
              playButtonClick()
              buyAuraTier(index)
            }}
            disabled={!canAfford}
            className={`flex items-center justify-center gap-1 rounded-md border-2 border-black bg-gradient-to-b from-amber-300 to-amber-500 font-black text-white transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${isTouch ? 'px-1.5 py-0.5 text-xs' : 'px-3 py-1 text-base'}`}
            style={textOutline}
          >
            <span>🏆</span>
            <span>{formatCompact(tier.winsRequired)}</span>
          </button>
        )}
        {owned && !equipped && (
          <button
            type="button"
            onClick={() => {
              playButtonClick()
              equipAuraTier(index)
            }}
            className={`flex items-center justify-center rounded-md border-2 border-black bg-gradient-to-b from-lime-400 to-green-600 font-black text-white transition hover:brightness-110 active:brightness-95 ${isTouch ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-base'}`}
            style={textOutline}
          >
            Equip
          </button>
        )}
        {owned && equipped && (
          <>
            <button
              type="button"
              disabled
              className={`flex cursor-default items-center gap-1 rounded-md border-2 border-black bg-gradient-to-b from-sky-400 to-blue-600 font-black text-white ${isTouch ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-base'}`}
              style={textOutline}
            >
              <span>✓</span>
              <span>Equipped</span>
            </button>
            <button
              type="button"
              onClick={() => {
                playButtonClick()
                unequipAuraTier(index)
              }}
              className={`flex items-center justify-center rounded-md border-2 border-black bg-gradient-to-b from-rose-400 to-rose-600 font-black text-white transition hover:brightness-110 active:brightness-95 ${isTouch ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-base'}`}
              style={textOutline}
            >
              Unequip
            </button>
          </>
        )}
        {/* Gem-cost purchase path isn't live yet — hidden until it is
           (data/aura.js still carries gemCost per tier for when it lands). */}
      </div>
    </div>
  )
}

// Coin glyph for a shop card's price pill. Inline rather than a PNG since
// it's just a stroked hexagon — one shape, reused at any size.
function BuxIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 2 21 7v10l-9 5-9-5V7z"
        fill="#f8fafc"
        stroke="#0f172a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Temporary kill switch for the Bux buy button below: it was already
// visual-only (systems/bloxity.js's Bux section explains why
// SDK.bux.requestPurchase isn't called yet — no backend to fulfil it), and
// is hidden entirely for now on top of that. Flip back to true once Bux
// purchases are meant to be shown again.
const BUX_BUY_ENABLED = false

// One SKU in the Shop popup's card row: title banner, icon on a radial-glow
// backdrop (blank until that SKU's art lands, same convention as
// AuraEntry's iconUrl), and a buy button. `featured` swaps the gold
// treatment in for the plain grey one — data/shop.js picks which SKU gets
// it.
//
// The Bux button (BUX_BUY_ENABLED) is visual-only even when shown. The Wins
// button is real — same amber gradient/🏆/formatCompact and
// affordability-disable as AuraEntry's wins button above, wired to
// buyShopItemWithWins.
function ShopItemCard({ item, isTouch }) {
  const wins = useGameStore((s) => s.wins)
  const buyShopItemWithWins = useGameStore((s) => s.buyShopItemWithWins)
  const canAffordWins = wins >= item.winsRequired
  const textOutline = { WebkitTextStroke: isTouch ? '1px black' : '1.5px black', paintOrder: 'stroke fill' }
  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden rounded-xl border-2 border-black shadow-[0_4px_0_rgba(0,0,0,0.4)] ${
        item.featured ? 'bg-gradient-to-b from-amber-300 to-yellow-500' : 'bg-gradient-to-b from-slate-500 to-slate-700'
      }`}
    >
      <div
        className={`text-center font-black text-white ${isTouch ? 'py-1.5 text-xs' : 'py-2.5 text-lg'}`}
        style={textOutline}
      >
        {item.name}
      </div>

      <div
        className={`flex items-center justify-center ${isTouch ? 'h-16' : 'h-28'}`}
        style={{
          background: item.featured
            ? 'radial-gradient(circle, rgba(255,240,150,0.9), rgba(230,170,20,0.5))'
            : 'radial-gradient(circle, rgba(203,213,225,0.5), rgba(71,85,105,0.4))',
        }}
      >
        {item.iconUrl && (
          <img
            src={item.iconUrl}
            alt=""
            className={isTouch ? 'h-10 w-10' : 'h-16 w-16'}
            draggable={false}
          />
        )}
      </div>

      <div className={`flex flex-col items-center ${isTouch ? 'gap-1 p-1.5' : 'gap-1.5 p-2.5'}`}>
        {BUX_BUY_ENABLED && (
          <>
            <button
              type="button"
              disabled
              onClick={() => playButtonClick()}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-black bg-gradient-to-b from-lime-400 to-green-600 font-black text-white shadow-[0_3px_0_rgba(0,0,0,0.4)] transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${isTouch ? 'py-1 text-sm' : 'py-2 text-lg'}`}
              style={textOutline}
            >
              <BuxIcon className={isTouch ? 'h-4 w-4' : 'h-5 w-5'} />
              <span>{formatCompact(item.priceBux)}</span>
            </button>

            <span className={`font-black text-slate-300 ${isTouch ? 'text-[10px]' : 'text-xs'}`}>or</span>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            playButtonClick()
            buyShopItemWithWins(item.id)
          }}
          disabled={!canAffordWins}
          className={`flex w-full items-center justify-center gap-1 rounded-lg border-2 border-black bg-gradient-to-b from-amber-300 to-amber-500 font-black text-white transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${isTouch ? 'py-1 text-sm' : 'py-2 text-lg'}`}
          style={textOutline}
        >
          <span>🏆</span>
          <span>{formatCompact(item.winsRequired)}</span>
        </button>
      </div>
    </div>
  )
}

// Opened by the Shop button. Shares RebirthWindow's chrome via HudModal — a
// row of Bux-priced SKU cards (data/shop.js) plus a thank-you line, same
// "money-shop" layout as the reference mock this was built from.
function ShopWindow({ onClose, isTouch }) {
  return (
    <HudModal title="Shop" onClose={onClose} isTouch={isTouch}>
      <div className={`flex w-full ${isTouch ? 'gap-2' : 'gap-4'}`}>
        {SHOP_ITEMS.map((item) => (
          <ShopItemCard key={item.id} item={item} isTouch={isTouch} />
        ))}
      </div>

      <div
        className={`text-center font-black text-white ${isTouch ? 'text-sm' : 'text-xl'}`}
        style={{ WebkitTextStroke: isTouch ? '1px black' : '1.5px black', paintOrder: 'stroke fill' }}
      >
        Thanks for supporting our game 💖
      </div>
    </HudModal>
  )
}

// Popup for the HUD's Aura button — shares RebirthWindow's chrome via
// HudModal. Body is AURA_TIERS' 10 entries in a fixed-height list so it's
// always mouse-wheel scrollable regardless of viewport height, rather than
// growing the whole modal to fit every row.
function AuraWindow({ onClose, isTouch }) {
  return (
    <HudModal title="Aura" onClose={onClose} isTouch={isTouch}>
      <div
        className={`w-full overflow-y-auto ${isTouch ? 'max-h-[38vh] pr-1' : 'max-h-[26rem] pr-2'}`}
      >
        <div className={`flex flex-col ${isTouch ? 'gap-1.5' : 'gap-2.5'}`}>
          {AURA_TIERS.map((tier, index) => (
            <AuraEntry key={tier.name} tier={tier} index={index} isTouch={isTouch} />
          ))}
        </div>
      </div>
    </HudModal>
  )
}

// Left-edge, vertically centred stack: win count above, rebirth action below.
// Both are selector-driven and re-render only when their value changes, never
// per frame (Tech.md §5.4). Wins change at human speed; rebirth eligibility is
// a boolean flip. The rebirth button stays mounted but disabled until eligible.
function LeftCenterControls() {
  const wins = useGameStore((s) => s.wins)
  const level = useGameStore((s) => s.level)
  const rebirth = useGameStore((s) => s.rebirth)
  const canRebirth = useGameStore((s) => canAcceptRebirth(s.level, s.rebirth))
  const acceptRebirth = useGameStore((s) => s.acceptRebirth)
  const [showRebirthWindow, setShowRebirthWindow] = useState(false)
  const [showAuraWindow, setShowAuraWindow] = useState(false)
  const [showShopWindow, setShowShopWindow] = useState(false)
  const isTouch = useTouchMode()

  // systems/merchant.js can't open a React panel itself (framework-free,
  // Tech.md §5.1), so E near the shop just raises an edge flag there; this
  // throttled poll is the one place that consumes it, same 100ms cadence
  // Hud()'s own prompt polls below use for the same singleton's `near`.
  useEffect(() => {
    const id = setInterval(() => {
      if (merchantState.openAuraRequested) {
        merchantState.openAuraRequested = false
        setShowAuraWindow(true)
      }
    }, 100)
    return () => clearInterval(id)
  }, [])

  const rebirthWindow =
    showRebirthWindow &&
    createPortal(
      <RebirthWindow
        rebirth={rebirth}
        canRebirth={canRebirth}
        isTouch={isTouch}
        onConfirm={() => {
          acceptRebirth()
          setShowRebirthWindow(false)
        }}
        onClose={() => setShowRebirthWindow(false)}
      />,
      document.body,
    )

  const auraWindow =
    showAuraWindow &&
    createPortal(
      <AuraWindow isTouch={isTouch} onClose={() => setShowAuraWindow(false)} />,
      document.body,
    )

  const shopWindow =
    showShopWindow &&
    createPortal(
      <ShopWindow isTouch={isTouch} onClose={() => setShowShopWindow(false)} />,
      document.body,
    )

  // Touch/mobile only: a compact single row anchored top-left, below
  // IdentityChip (top-4). The desktop layout below (vertically centred at
  // the left edge) sits inside the touch layout's movement-stick capture
  // zone (TouchControls.jsx's MoveStick, the bottom ~58% of the screen) —
  // the game forces landscape on touch (RotatePrompt.jsx), so screen height
  // there is short enough that the two regions collide. This row fits in the
  // strip above that zone on every supported landscape height instead.
  if (isTouch) {
    return (
      <div
        data-hud="left-center"
        className="pointer-events-none absolute left-4 top-24 flex items-center gap-2"
      >
        <div className="flex items-center gap-1 rounded-lg border border-slate-400/30 bg-black/50 px-2 py-1.5 text-slate-100 shadow-lg">
          <img src="/ui/xp_cup.png" alt="" className="h-5 w-5" draggable={false} />
          <span
            className="font-bold tabular-nums"
            style={{
              // Matches GlowFloorPanelLabel's Wins <Text>: #ffd21e fill, bold,
              // letterSpacing -0.02, black outline at ~10% of font size, drawn
              // behind the fill (SDF outlineWidth 0.09 / fontSize 0.9).
              fontSize: '0.85rem',
              lineHeight: 1,
              color: '#ffd21e',
              letterSpacing: '-0.02em',
              WebkitTextStroke: '1.5px #000000',
              paintOrder: 'stroke fill',
            }}
          >
            {formatCompact(wins)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            playButtonClick()
            setShowAuraWindow(true)
          }}
          title="Open Aura"
          className="pointer-events-auto flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-amber-400/40 bg-amber-600/80 text-slate-100 shadow-lg transition hover:bg-amber-500"
        >
          <img src="/ui/aura.png" alt="" className="h-5 w-5" draggable={false} />
          <span className="text-[7px] font-semibold leading-none tracking-wide">Aura</span>
        </button>
        <button
          type="button"
          onClick={() => {
            playButtonClick()
            setShowShopWindow(true)
          }}
          title="Open Shop"
          className="pointer-events-auto flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-amber-400/40 bg-amber-600/80 text-slate-100 shadow-lg transition hover:bg-amber-500"
        >
          <img src="/ui/shop.png" alt="" className="h-5 w-5" draggable={false} />
          <span className="text-[7px] font-semibold leading-none tracking-wide">Shop</span>
        </button>
        <button
          type="button"
          onClick={() => {
            playButtonClick()
            acceptRebirth()
          }}
          disabled
          title="Coming soon"
          className="pointer-events-auto flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-amber-400/40 bg-amber-600/80 text-slate-100 shadow-lg transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600/80"
        >
          <img src="/ui/invite_friends.png" alt="" className="h-5 w-5" draggable={false} />
          <span className="text-center text-[6px] font-semibold leading-[1.1] tracking-wide">
            Invite
            <br />
            Friends
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            playButtonClick()
            setShowRebirthWindow(true)
          }}
          title="Open Rebirth"
          className="pointer-events-auto flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg border border-amber-400/40 bg-amber-600/80 text-slate-100 shadow-lg transition hover:bg-amber-500"
        >
          <img src="/ui/rebirth.png" alt="" className="h-5 w-5" draggable={false} />
          <span className="text-[7px] font-semibold leading-none tracking-wide">Rebirth</span>
        </button>
        {rebirthWindow}
        {auraWindow}
        {shopWindow}
      </div>
    )
  }

  // Desktop: original vertically-centred 2x2 grid at the left edge — no
  // movement stick to collide with here, so it keeps its larger, more
  // readable footprint.
  return (
    <div
      data-hud="left-center"
      className="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2"
    >
      <div className="flex items-center gap-2 rounded-lg border border-slate-400/30 bg-black/50 px-3 py-2 text-slate-100 shadow-lg">
        <img src="/ui/xp_cup.png" alt="" className="h-8 w-8" draggable={false} />
        <span
          className="font-bold tabular-nums"
          style={{
            fontSize: '1.125rem',
            lineHeight: 1,
            color: '#ffd21e',
            letterSpacing: '-0.02em',
            WebkitTextStroke: '2px #000000',
            paintOrder: 'stroke fill',
          }}
        >
          {formatCompact(wins)}
        </span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playButtonClick()
              setShowAuraWindow(true)
            }}
            title="Open Aura"
            className="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-amber-400/40 bg-amber-600/80 px-3 py-2 text-slate-100 shadow-lg transition hover:bg-amber-500"
          >
            <img src="/ui/aura.png" alt="" className="h-10 w-10" draggable={false} />
            <span className="text-xs font-semibold tracking-wide">Aura</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playButtonClick()
              setShowShopWindow(true)
            }}
            title="Open Shop"
            className="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-amber-400/40 bg-amber-600/80 px-3 py-2 text-slate-100 shadow-lg transition hover:bg-amber-500"
          >
            <img src="/ui/shop.png" alt="" className="h-10 w-10" draggable={false} />
            <span className="text-xs font-semibold tracking-wide">Shop</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playButtonClick()
              acceptRebirth()
            }}
            disabled
            title="Coming soon"
            className="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-amber-400/40 bg-amber-600/80 px-3 py-2 text-slate-100 shadow-lg transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600/80"
          >
            <img src="/ui/invite_friends.png" alt="" className="h-10 w-10" draggable={false} />
            <span className="text-xs font-semibold leading-tight tracking-wide text-center">
              Invite
              <br />
              Friends
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              playButtonClick()
              setShowRebirthWindow(true)
            }}
            title="Open Rebirth"
            className="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-amber-400/40 bg-amber-600/80 px-3 py-2 text-slate-100 shadow-lg transition hover:bg-amber-500"
          >
            <img src="/ui/rebirth.png" alt="" className="h-10 w-10" draggable={false} />
            <span className="text-xs font-semibold tracking-wide">Rebirth</span>
          </button>
        </div>
      </div>
      {rebirthWindow}
      {auraWindow}
      {shopWindow}
    </div>
  )
}

// Circumference of the hold-progress ring's r=15 circle (systems/
// interactHold.js's HOLD_MS gate) — the SVG's stroke-dasharray/dashoffset
// unit. Drawn from full offset (empty) down to 0 (a full ring) as the hold
// approaches HOLD_MS.
const HOLD_RING_RADIUS = 15
const HOLD_RING_CIRCUMFERENCE = 2 * Math.PI * HOLD_RING_RADIUS

// Every "Press E to ..." (or informational, key-less) proximity prompt —
// afk/hexPad/merchant below all render one of these. A translucent dark card
// (backdrop-blur, so the world stays visible through it) with a square "E"
// keycap next to the label, ringed by the shared hold-to-confirm progress
// (systems/interactHold.js) — holding E fills the ring over HOLD_MS; an
// early release snaps it back empty, same as never having pressed at all.
// Still written imperatively (setText/setHoldProgress, via a ref) on the
// same ~10Hz poll those callers already ran, so this stays a DOM sibling
// that never re-renders per frame (Tech.md §5.4) — only the look changed.
//
// setText(null) hides it. Otherwise: a message starting with "Press E to "
// gets the keycap + ring plus the remainder as the label (matching every
// existing caller's copy); anything else — the AFK-active line, a "Need N
// Wins"/"Rebirth N required" gate — renders as label-only text, no keycap,
// since there's no single key (or hold) to point at.
const InteractPrompt = forwardRef(function InteractPrompt(_props, ref) {
  const rootRef = useRef(null)
  const keyWrapRef = useRef(null)
  const ringRef = useRef(null)
  const textRef = useRef(null)

  useImperativeHandle(
    ref,
    () => ({
      setText(message) {
        const root = rootRef.current
        if (!root) return
        if (!message) {
          root.style.display = 'none'
          return
        }
        const prefix = 'Press E to '
        const isPressE = message.startsWith(prefix)
        keyWrapRef.current.style.display = isPressE ? '' : 'none'
        textRef.current.textContent = isPressE ? message.slice(prefix.length) : message
        root.style.display = ''
      },
      // fraction: 0..1, systems/interactHold.js's current progress toward
      // HOLD_MS. Harmless to call while the keycap/ring is hidden (a
      // key-less message) — there's nothing on screen for it to affect.
      // While fraction is above 0 (E is actually being held against this
      // prompt) the card strips down to just the scaled-up ring + keycap,
      // with the same translucent backing now cut to a circle sized to just
      // that ring instead of the full pill — no label, no rectangular card —
      // and restores everything the instant it drops back to 0, same
      // reset-on-release the ring itself follows.
      setHoldProgress(fraction) {
        const ring = ringRef.current
        const root = rootRef.current
        const keyWrap = keyWrapRef.current
        const text = textRef.current
        if (!ring || !root || !keyWrap || !text) return
        const clamped = Math.max(0, Math.min(1, fraction || 0))
        ring.style.strokeDashoffset = String(HOLD_RING_CIRCUMFERENCE * (1 - clamped))
        const held = clamped > 0
        root.classList.toggle('scale-150', held)
        root.classList.toggle('bg-black/50', !held)
        root.classList.toggle('backdrop-blur-sm', !held)
        root.classList.toggle('px-4', !held)
        root.classList.toggle('py-2', !held)
        keyWrap.classList.toggle('bg-black/50', held)
        keyWrap.classList.toggle('backdrop-blur-sm', held)
        keyWrap.classList.toggle('rounded-full', held)
        text.style.display = held ? 'none' : ''
      },
    }),
    [],
  )

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute left-1/2 top-[70%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-2xl bg-black/50 px-4 py-2 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
      style={{ display: 'none' }}
    >
      <span
        ref={keyWrapRef}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center transition-colors duration-300"
      >
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-9 w-9 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r={HOLD_RING_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="2.5"
          />
          <circle
            ref={ringRef}
            cx="18"
            cy="18"
            r={HOLD_RING_RADIUS}
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              strokeDasharray: HOLD_RING_CIRCUMFERENCE,
              strokeDashoffset: HOLD_RING_CIRCUMFERENCE,
              transition: 'stroke-dashoffset 120ms linear',
            }}
          />
        </svg>
        <span className="relative flex h-5 w-5 items-center justify-center rounded-[5px] border-2 border-white/70 bg-white/10 text-xs font-bold text-white">
          E
        </span>
      </span>
      <span ref={textRef} className="text-base font-bold tracking-wide text-white" />
    </div>
  )
})

// DOM siblings of the canvas, never drei <Html> (Tech.md §5.4). Must not
// re-render per frame: the proximity prompts are written through
// InteractPrompt's setText ref on a ~10Hz interval that reads the singletons
// directly. React state here is only for panels and portal-driven settings,
// which change at human speed.
export default function Hud() {
  useSettings()
  const afkPromptRef = useRef(null)
  const hexPadPromptRef = useRef(null)
  const merchantPromptRef = useRef(null)
  const deathPromptRef = useRef(null)
  const actionResultRef = useRef(null)

  // systems/actionResult.js's showActionResult() (called from systems/
  // interact.js and systems/hexPowerPad.js on a failed/succeeded held-E
  // attempt) — same throttled-poll pattern as the prompts below, comparing
  // against the singleton's `id` so a repeat of the same message still
  // re-triggers the popup instead of being mistaken for no change.
  useEffect(() => {
    let lastId = actionResultState.id
    const intervalId = setInterval(() => {
      if (actionResultState.id === lastId) return
      lastId = actionResultState.id
      actionResultRef.current?.show(actionResultState.text, actionResultState.success)
    }, 100)
    return () => clearInterval(intervalId)
  }, [])

  // Dead in the PVP zone (systems/playerHealth.js) — a countdown to the
  // respawn that system's own step() runs, same throttled-poll pattern as
  // the prompts below (this value changes at human speed, not per frame).
  useEffect(() => {
    const id = setInterval(() => {
      const el = deathPromptRef.current
      if (!el) return
      if (playerHealth.dead) {
        const secs = Math.max(0, Math.ceil((playerHealth.respawnAt - performance.now()) / 1000))
        el.textContent = `You Died — Respawning in ${secs}s`
        el.style.display = ''
      } else {
        el.style.display = 'none'
      }
    }, 100)
    return () => clearInterval(id)
  }, [])

  // afkState (systems/afk.js) changes at human speed — near a target, locked
  // on, or neither — so a throttled textContent poll keeps this out of
  // React's render loop.
  useEffect(() => {
    const id = setInterval(() => {
      const prompt = afkPromptRef.current
      if (!prompt) return
      if (afkState.active) {
        prompt.setText('AFK firing — move or press Space to stop (E to stop)')
      } else if (afkState.nearTargetId) {
        // Shown even below the target's rebirth requirement — holding E
        // through an ineligible target reports the gate via ActionResult
        // (systems/interact.js) instead of blocking the prompt up front.
        prompt.setText('Press E to AFK Here')
      } else {
        prompt.setText(null)
      }
      prompt.setHoldProgress(interactHoldState.progress)
    }, 100)
    return () => clearInterval(id)
  }, [])

  // Same throttled-poll pattern as the afk prompt above. Hidden whenever the
  // afk prompt would show (target zones and pad zones can't both be relevant
  // at once — see systems/hexPowerPad.js and systems/afk.js's shared
  // interact-flag handling), so the two never overlap on screen.
  useEffect(() => {
    const id = setInterval(() => {
      const prompt = hexPadPromptRef.current
      if (!prompt) return
      const index = hexPowerPadState.nearIndex
      if (index === null || afkState.active || afkState.nearTargetId) {
        prompt.setText(null)
        return
      }
      const { ownedHexPads, equippedHexPad } = useGameStore.getState()
      if (ownedHexPads.has(index)) {
        prompt.setText(equippedHexPad === index ? null : 'Press E to Equip Laser')
      } else {
        // Shown even below the pad's Wins requirement — holding E through an
        // unaffordable pad reports the gate via ActionResult (systems/
        // interact.js -> hexPowerPad.js) instead of blocking the prompt up
        // front.
        prompt.setText('Press E to Buy Laser')
      }
      prompt.setHoldProgress(interactHoldState.progress)
    }, 100)
    return () => clearInterval(id)
  }, [])

  // Same throttled-poll pattern as the prompts above. Hidden whenever the afk
  // or hex-pad prompt would show — all three render at the same screen
  // position, and while the shop sits in its own zone this keeps that
  // shared-position assumption (see the hex-pad effect above) true for a
  // third system too.
  useEffect(() => {
    const id = setInterval(() => {
      const prompt = merchantPromptRef.current
      if (!prompt) return
      const visible =
        merchantState.near &&
        !afkState.active &&
        !afkState.nearTargetId &&
        hexPowerPadState.nearIndex === null
      prompt.setText(visible ? 'Press E to Aura' : null)
      prompt.setHoldProgress(interactHoldState.progress)
    }, 100)
    return () => clearInterval(id)
  }, [])

  // background_transparency (0.2–1.0, default 0.9) scales the panel backing
  // rather than replacing it, so the default lands on the 0.4 alpha the HUD was
  // designed with instead of a hard black slab.
  const panelStyle = {
    backgroundColor: `rgba(0, 0, 0, ${(settings.background_transparency * 0.4).toFixed(3)})`,
  }

  return (
    <div className="pointer-events-none absolute inset-0 p-4 font-mono text-xs leading-5 text-slate-200">
      {/* First child: the touch look-zone paints beneath the interactive HUD
         panels (auth, wins/rebirth, retry) so their taps still land, while its
         own Fire/Jump/E buttons sit at z-40 above everything. */}
      <TouchControls />

      <InteractPrompt ref={afkPromptRef} />
      <InteractPrompt ref={hexPadPromptRef} />
      <InteractPrompt ref={merchantPromptRef} />

      <div
        ref={deathPromptRef}
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/70 px-6 py-3 text-2xl font-bold text-red-500"
        style={{ display: 'none', WebkitTextStroke: '2px black', paintOrder: 'stroke fill' }}
      />

      <LeftCenterControls />

      {/* Top-left identity chip: "Guest" + Bloxity default picture until login,
         the real avatar + name after. Always visible, even with the SDK
         blocked. Event-driven, never per frame (Tech.md §5.4). */}
      <IdentityChip panelStyle={panelStyle} />

      <AuthPanel panelStyle={panelStyle} />

      {/* Top-centre buy/equip/lock-on result popup — green on success, red
         with the reason on failure (insufficient Rebirth/Wins). Driven
         imperatively via actionResultRef; see ActionResult.jsx. */}
      <ActionResult ref={actionResultRef} />

      {/* Bottom-centre level progress bar. DOM sibling of the canvas, written
         from a throttled store subscription — never re-renders per frame
         (Tech.md §5.4). */}
      <LevelBar />

      {/* Top-centre "LEVEL UP!" banner. DOM sibling of the canvas, driven by a
         transient store subscription that runs one Web-Animations pass per
         level rise — never re-renders per frame (Tech.md §5.4). */}
      <LevelUpPopup />

      {/* Top-centre multiplayer status pill. Event-driven — re-renders only on
         connect / disconnect / player-count changes (Tech.md §5.4). */}
      <NetStatus />

      {/* Per-Action "+N" power badges around the player. Owns its own rAF loop
         and never re-renders (Tech.md §5.4). */}
      <ActionPopups />

      {/* Full-screen "rotate to landscape" gate for touch sessions. Last child
         + z-100 so it covers the touch controls while it is up. */}
      <RotatePrompt />
    </div>
  )
}
