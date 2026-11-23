# GlanceDesk — Even G2 Architecture (Telegram + Hyperliquid)

**Hackathon:** Heads Up — Even Realities × TVM Ventures × Daos Hub (Nov 23 – Nov 29, 2026)  
**Tracks:** Track 01 (Messaging & News: Telegram) + Track 02 (Crypto & DeFi: Hyperliquid) + Special Prize (Best Telegram Integration)

## Core Read → Decide → Write Loop (576 × 288 Monochrome Green)
1. **FEED (Root):** Live Telegram VIP chat alert condensed to 3 lines + auto-linked live Hyperliquid perp (`BTC-PERP`, `ETH-PERP`, `SOL-PERP`, `HYPE-PERP`, etc.) with mark price, 24h change, and hourly funding.
2. **REPLY (Telegram Write):** 1-tap contextual smart reply (embedding the live Hyperliquid mark price) OR hold G2 temple/ring (`LONG_PRESS_EVENT`) to capture G2 microphone PCM (`AudioInputSource.Glasses`) and send a voice reply directly to Telegram.
3. **ORDER (Hyperliquid Paper Write):** Flip `LONG / SHORT` and `$100 / $250 / $500` notional -> 1-tap simulated paper execution at live Hyperliquid mark price -> auto-posts formatted paper trade receipt back into Telegram.
4. **PORT (Live Mark-to-Market PnL):** Real-time simulated portfolio priced against live Hyperliquid `metaAndAssetCtxs`.

## Even Hub Hardware & QA Invariants
- 576 × 288 px 3-zone grid (`hdr`, `main`, `act`), `containerName <= 16` chars, strictly one `isEventCapture: 1` per screen.
- `createStartUpPageContainer` once at boot; flicker-free `textContainerUpgrade` for live updates; `rebuildPageContainer` only on view switch.
- Root-page double-tap invokes `shutDownPageContainer(1)` (mandatory native exit confirmation dialog).
- Zero secrets in WebView; all Telegram/Hyperliquid traffic routed through local CORS backend proxy (`http://127.0.0.1:8787`) whitelisted in `app.json`.
