# GlanceDesk for Even G2

![GlanceDesk Interactive OHLC Candlestick SL/TP Ticket](artifacts/g2_feed_preview.png)
![GlanceDesk 1.5R Break-Even Position Management](artifacts/g2_alert_entry.png)

**A borderless 1R risk-sized OHLC candlestick HUD for Even G2 smart glasses — lock your exact dollar risk (e.g. `$100`, `$242`, `$850`), slide Stop Loss & Take Profit over live 15m Hyperliquid candlesticks while position size auto-calculates, manage `+1.5R` Break-Even in one tap, and stay synced with Telegram.**

Built for **Heads Up: Even Realities Hackathon (Nov 23 – Nov 29, 2026)**.

- **Tracks Entered (2 + Special Prize):**
  - **Track 01 · Messaging & News:** Telegram Bot API (live alerts, `/risk 242`, `/alert NEAR 4.20`, `/be`, `/half`, `/close`, `/pnl`, 1-tap natural replies)
  - **Track 02 · Crypto & DeFi:** Hyperliquid API (all 150+ live perps, live 15m OHLC candlesticks rendered via `updateImageRawData`, true 1R risk-based position sizing `qty = riskUsd / |entry - SL|`, safe paper-only R-multiple ledger)
  - **Special Prize:** Best Telegram Integration

---

## Real Trader Workflow on Even G2 (Structure First -> Exact Dollar Risk -> Execute)
1. **True OHLC Candlesticks on 4-Bit Monochrome Glass:** Bullish bars render as crisp hollow bright outlines with wicks; bearish bars render as solid filled bodies with wicks — floating borderlessly over transparent black glass (`borderWidth: 0`).
2. **3-Step Structure-First Ticket (`SL` -> `TP` -> Exact `$` Risk & Execute):**
   - Pick `Short <COIN>` or `Long <COIN>` directly from the active coin's Telegram feed context (coin-locked so an open ETH trade never hijacks a BTC alert).
   - **Step 1/3 (`Place Stop Loss`):** Swipe up/down to place **`SL` directly on the 15m candle structure**.
   - **Step 2/3 (`Place Take Profit`):** Swipe up/down to place **`TP` on the candles** and see the setup's **`R:R` (`2.51R`)**.
   - **Step 3/3 (`On-Glasses 2D Looping Numpad` -> `Review & Execute`):** Enter **any exact dollar risk of any length** (`$35`, `$253`, `$12,500`) directly on the glasses using a 2D looping keypad (`1–9 / < 0 OK`): **`Swipe Down`** moves down a row (wraps), **`Swipe Up`** moves right a column (wraps), **`Tap`** picks the digit, and **`Double Tap`** (or `OK`) locks the amount and opens the exact Risk/Gain/Size review screen. Single tap executes and logs the receipt to Telegram.
3. **Explicit Per-Coin Position Management (+1.5R Break-Even & 50% Partial):** Every action names its coin explicitly (`Move ETH SL to BE`, `Take 50% ETH`, `Close ETH 100%`, `Switch to BTC`) so managing multiple open positions is unambiguous.

---

## Real-Life Edge Cases, Resilience & Path to Live Accounts
- **3-Tier Fat-Finger Guard (`$12,500` vs `$125` slip protection):**
  - `<= 5%` of account equity -> fast 1-tap execution on the Confirm screen (zero extra friction).
  - `> 5%` of account equity -> triggers an explicit second **`! ARE YOU SURE? (X% equity)`** confirmation gate before sending.
  - Exceeding available balance or required isolated margin (e.g., accidentally typing `$12,500` on a `$10,000` account) -> **hard-blocked on-lens** and rejected server-side before an order can fire.
- **Connection Drops Mid-Stop Move (BLE / Network Resilience):**
  - Every order, Break-Even move, partial close, and full close carries a client-generated **`idempotencyKey`**.
  - If connectivity drops mid-`Move SL to BE`, GlanceDesk **never pretends it succeeded**: the eyebrow immediately displays `retrying <COIN> BE` and automatically replays the exact idempotent request every 3 seconds until the server confirms — zero silent stop failures, zero duplicate executions.
- **Safe Path From Paper to Real Hyperliquid Accounts:**
  - **Hyperliquid Trade-Only API Agent Wallet:** Zero withdrawal permissions — even a compromised phone or proxy cannot move funds out of the account.
  - **Exchange-Native Reduce-Only SL/TP Orders:** Attached on Hyperliquid's orderbook at entry so the stop still executes on-chain even if glasses, phone, and internet all go offline simultaneously.
  - **Daily Drawdown Circuit Breaker + Phone Biometric Sign-Off:** Hard daily loss cap enforced before signing, plus phone FaceID/fingerprint sign-off for any risk above the user's configured threshold.
- **Daily Users & Monetization:**
  - Built for busy active perp traders (students, engineers, founders, funded-account traders) who already monitor Telegram alpha groups and Hyperliquid, and miss Break-Even moves or clean setups during lectures, meetings, or commutes.
  - Sustainable dual model: affordable **Pro subscription (`$9–$19/mo`)** for multi-account API-wallet execution, custom Telegram alert routing, and journal sync, paired with opt-in **Hyperliquid Builder Code fee share** (`1–3 bps` on live volume).

---

## Hardware & Store QA Compliance
- **Calibrated on Real Even Hub Simulator (`@evenrealities/evenhub-simulator`):** `eyebrow` and `hint` heights tuned to `34px` to eliminate LVGL single-line scrollbars; `220 × 142` OHLC image container strictly within the `288 × 144` hardware cap.
- **Official SDK Validated (`validateEvenHubPageContainer`):** 3 borderless text zones (`textColor: 4` primary / `textColor: 1` whisper metadata) + sequential coalesced `updateImageRawData` for smooth SL/TP sliding + native `menuObject`.
- **Flicker-Free & Safe:** `textContainerUpgrade` in-place refreshes, `CLICK_EVENT (0 -> undefined)` handling, mandatory root `shutDownPageContainer(1)` exit dialog, zero secrets in WebView, strictly paper-only funds.

---

## Quick Start (Reproducible Setup)

**Requirements:** Node.js `>= 20` and a free Telegram bot token from `@BotFather`.

```bash
npm install
cp .env.example .env   # Paste your TELEGRAM_BOT_TOKEN
npm test               # Runs 10 unit, safety-guard & official SDK validation tests
npm run server         # Terminal 1 — Backend proxy (:8787)
npm run dev            # Terminal 2 — Glasses WebView (:5173)
npm run sim            # Terminal 3 — Official Even Hub G2 Simulator
```

*(Build & package `.ehpk`)*
```bash
npm run build
npm run pack:ehpk
```

---

## Money Safety & Prior Work Disclosure
- **Paper Trading Only:** GlanceDesk runs strictly on a simulated `$10,000` paper balance. Zero custody, zero real-money execution, no financial advice.
- **Built During Hackathon:** All source code was written from scratch starting November 23, 2026 during the official build window.

---

## 5 API Feature Requests (For Even Realities, Telegram & Hyperliquid Teams)
1. **Even Hub SDK — Preserve Explicit `0` on `CLICK_EVENT`:** Prevent `OsEventTypeList.CLICK_EVENT` (`0`) from deserializing as `undefined` so tap handlers never silently miss clicks.
2. **Even Hub SDK — Optional Single-Line `noScroll` Flag on Text Containers:** Short single-line headers/footers render an LVGL scrollbar unless extra vertical padding is added; an explicit `scrollable: false` flag would simplify clean HUD layouts.
3. **Even Hub SDK — Native Partial-Region Image Diffing:** When sliding an SL/TP line over a static candlestick background, delta-patching only the moved horizontal row would make interactive chart scrubbing feel instant over BLE.
4. **Telegram Bot API — Scoped Opt-In Recent Group Context:** Allowing assistant bots to fetch the last N messages upon opt-in would remove cold-start empty feeds on wearables.
5. **Hyperliquid Info API — Filtered `assetCtxs` Query:** Supporting `{ type: "assetCtxs", coins: ["BTC", "ETH", "SOL", "NEAR"] }` would reduce wearable proxy payload size by >95%.
