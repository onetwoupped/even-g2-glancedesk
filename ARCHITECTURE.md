# GlanceDesk — Even G2 Architecture (Telegram + Hyperliquid)

**Hackathon:** Heads Up — Even Realities × TVM Ventures × Daos Hub (Nov 23 – Nov 29, 2026)  
**Tracks:** Track 01 (Messaging & News: Telegram) + Track 02 (Crypto & DeFi: Hyperliquid) + Special Prize (Best Telegram Integration)

---

## 1. Core Read → Structure → Risk → Confirm Loop (576 × 288 Monochrome Green)
1. **GLANCE (Root HUD):** Borderless transparent glass (`borderWidth: 0`). Surfaces triggered price alerts, `+1.5R` Break-Even prompts, or live Telegram messages paired with the matched Hyperliquid perp (`150+` perps) and live OHLC candlesticks (`updateImageRawData`).
2. **REPLY (Coin-Locked Context Menu):** Tapping a coin's message locks `lockedSymbol` so unrelated open positions never hijack an incoming alert. Offers `Short <COIN>`, `Long <COIN>`, inline `Chart TF (1m–1D)`, 1-tap smart Telegram replies, and explicit `Open positions (<OTHER>)`.
3. **TIMEFRAME (Inline Multi-TF Picker — No Separate Tab):** Swipe `Up/Down` through `1m · 3m · 5m · 15m · 1h · 2h · 4h · 1D` with live candlestick preview. Selecting a timeframe automatically calibrates SL/TP step precision (`±0.05%` on `1m` up to `±1.25%` on `1D`) and default bracket distances.
4. **STRUCTURE-FIRST TICKET (`TICKET_SL` -> `TICKET_TP` -> `TICKET_RISK` -> `TICKET_CONFIRM`):**
   - Place **Stop Loss** and **Take Profit** directly over live candlesticks.
   - Enter any exact dollar risk of arbitrary length on the **2D Looping Numpad** (`Swipe Down` = next row, `Swipe Up` = next col, `Tap` = pick digit, `Double Tap` = review). Coin quantity auto-solves `qty = riskUsd / |entry - SL|`.
   - **Fat-Finger & Account Risk Guardrail (`evaluateRiskGuard` + Server `PaperLedger`):**
     - Hard-blocks risks exceeding available cash (e.g., `$12,500` slip on `$10,000`) OR exceeding the configurable per-trade account cap (`maxRiskPct`, default `10%`, set via `/maxrisk <pct>`).
     - Requires a mandatory second **`Are you sure? · Risking X.X% of balance`** confirmation tap on **every** trade.
5. **MANAGE (Per-Coin Position Control):** Explicit coin-scoped actions (`Move <COIN> SL to BE`, `Take 50% <COIN>`, `Close <COIN> 100%`, `Switch to <NEXT>`) with automatic Telegram execution receipts.

---

## 2. Asymmetric Offline & Connection-Drop Resilience
- **Protective Actions (`MOVE_BE`, `TAKE_HALF`, `CLOSE_POS`):** Carry a client-generated `idempotencyKey`. If BLE or network drops mid-stop move, the HUD never silently pretends it succeeded — it displays `retrying <COIN> BE` in the eyebrow and replays the exact idempotent request every 3 seconds until the server confirms (zero silent failures, zero duplicate executions).
- **New Risk-Increasing Entries (`placePaperOrder`):** Fail fast with `OFFLINE · order NOT sent` so a stale entry never fills minutes later at a different price.

---

## 3. Safe Transition From Paper to Live Hyperliquid Accounts
1. **Hyperliquid API Agent Wallet (Trade-Only):** Sub-key authorized strictly for order placement/modification with **zero withdrawal permission**.
2. **Exchange-Native Reduce-Only SL/TP Orders:** Submitted to Hyperliquid's matching engine atomically with entry so protective stops execute on-chain even if glasses, phone, and internet all disconnect simultaneously.
3. **Hard Server/Wallet Risk Caps & Biometric Escalation:** Per-trade `maxRiskPct`, daily drawdown circuit breaker, and phone FaceID/fingerprint sign-off above a user-configured dollar threshold.

---

## 4. Even Hub Hardware & Store QA Invariants
- 576 × 288 px borderless layout: `eyebrow` (`34px`, `textColor: 1`), `main` (`isEventCapture: 1`, `textColor: 4`), `hint` (`34px`, `textColor: 1`), `chart` (`220 × 142` PNG image container, strictly within `288 × 144`).
- `createStartUpPageContainer` once at boot; flicker-free `textContainerUpgrade` for live updates; coalesced sequential `updateImageRawData` keyed by `symbol:interval:close:levels`.
- Root double-tap invokes `shutDownPageContainer(1)` (mandatory native exit confirmation dialog).
- Zero secrets in WebView; all Telegram and Hyperliquid requests flow through the local CORS backend (`http://127.0.0.1:8787`) whitelisted in `app.json`.
