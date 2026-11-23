# GlanceDesk — 2m30s Demo Video Script (Even Hub Simulator)

- **0:00 – 0:20 (Problem):** Show Telegram group + Even Hub Simulator side by side. Explain: *"Real traders set structure first on candlesticks (SL & TP), then choose their exact dollar risk so position size auto-calculates — never fixed-RR toys or blind margin presets."*
- **0:20 – 0:50 (Live Telegram + Coin-Scoped Context):** Send `"BTC breaking out"` in Telegram while an ETH position is already open -> G2 stays cleanly on **BTC 15m OHLC candlesticks** (`Tap` shows `Short BTC` / `Long BTC`, never hijacking to ETH).
- **0:50 – 1:40 (3-Step Structure-First Ticket):**
  - Pick `Long BTC (place SL/TP)` -> **Step 1/3 (`Stop Loss`)**: swipe to slide **`SL` onto the 15m candle structure**.
  - Tap -> **Step 2/3 (`Take Profit`)**: swipe to slide **`TP`** and see live **`Setup R:R 2.67R`**.
  - Tap -> **Step 3/3 (`Risk & Execute`)**: type exact risk (`242` or `850`) or swipe on glasses -> watch **coin size & exact target `$` profit auto-calculate** -> tap executes paper order and posts receipt to Telegram.
- **1:40 – 2:15 (Per-Coin Management):** In `Open Positions`, switch between `BTC` and `ETH`, tap `Move ETH SL to BE`, `Take 50% ETH`, or `Close ETH 100%` (leaves BTC open), posting clean logs to Telegram.
- **2:15 – 2:30 (Close):** Double-tap on root screen to show mandatory `shutDownPageContainer(1)` exit dialog + passing `npm test`. Done!
