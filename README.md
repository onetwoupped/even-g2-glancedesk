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

## Real Trader Workflow on Even G2 (True 1R Risk Sizing — Zero Swipe Fatigue)
1. **True OHLC Candlesticks on 4-Bit Monochrome Glass:** Bullish bars render as crisp hollow bright outlines with wicks; bearish bars render as solid filled bodies with wicks — floating borderlessly over transparent black glass (`borderWidth: 0`).
2. **Exact Dollar Risk First (`1R`), Auto-Calculated Size (`qty = risk / |entry - SL|`):**
   - Set your exact `1R` dollar risk once via Telegram (`/risk 242` or `/risk 850`) or the companion WebView input — never scroll through 20+ dollar presets on glasses.
   - **Step 1 (`Side & Risk`):** Flip `SHORT / LONG` and toggle just **3 clean options on glasses: `0.5R / 1R / 2R`** (e.g., `$121 / $242 / $484`).
   - **Step 2 (`Place Stop Loss`):** Swipe up/down to slide the live **`SL` line across the actual 15m candle wicks**. Your **dollar risk stays locked (`-$242`)** while **coin quantity & notional (`18.47 ETH / $31.9k`) auto-calculate** instantaneously.
   - **Step 3 (`Place Take Profit`):** Swipe up/down to slide the live **`TP` line across the candles** while seeing **exact dollar gain (`+$608`)** and **real `R:R` (`2.51R`)** before entering.
   - **Step 4 (`Confirm`):** Single tap executes the simulated paper order and posts the full entry/SL/TP/qty risk receipt to Telegram.
3. **In-Lecture / Hands-Free Management (+1.5R Break-Even & 50% Partial):** When a position reaches `+1.5R`, the glasses quietly surface **`Move stop to BE`**, **`Take 50%`**, or **`Close all`** — one tap moves your stop to entry and logs it to Telegram.

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
npm test               # Runs 7 unit & official SDK validation tests
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
