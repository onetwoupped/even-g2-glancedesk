# GlanceDesk — 2m30s Demo Video Script (Even Hub Simulator)

- **0:00 – 0:20 (Problem):** Show Telegram group + Even Hub Simulator side by side. Explain: *"Traders don't use line charts or fixed 1:2 boxes — they read candlesticks, pick their own Stop Loss and Take Profit, and want to know exact dollar risk before entering."*
- **0:20 – 0:50 (Custom Size + Live OHLC Candles):** Send `/size 35` or `"ETH structure breaking"` in Telegram -> G2 shows live 15m OHLC candlesticks (hollow bull, solid bear) floating borderlessly on transparent glass.
- **0:50 – 1:40 (Interactive SL & TP Sliding Over Candles):**
  - Tap -> `1/4 Size`: `$35 × 10x`, flip `SHORT / LONG`.
  - Tap -> `2/4 Stop Loss`: Swipe Up/Down and watch the **`SL` line slide live across the candle wicks** while exact **`Risk -$2.65`** updates live!
  - Tap -> `3/4 Take Profit`: Swipe Up/Down and watch the **`TP` line slide live** while **`Gain +$6.68`** and **`Reward 2.52R`** update live!
  - Tap -> `4/4 Confirm` -> executes paper order and posts exact entry/SL/TP receipt to Telegram!
- **1:40 – 2:15 (Hands-Free Management — BE & 50% Partial):** In `MANAGE`, 1 tap moves stop to **Break-Even**, 1 tap takes **50% profit**, both posting clean human logs to Telegram.
- **2:15 – 2:30 (Close):** Double-tap on root screen to show mandatory `shutDownPageContainer(1)` exit dialog + passing `npm test`. Done!
