# GlanceDesk — 2m30s Demo Video Script (Even Hub Simulator)

- **0:00 – 0:20 (Problem):** Show Telegram group + Even Hub Simulator side by side. Explain: *"Real traders don't trade off line charts or fixed margin presets — they pick exact dollar risk (1R), place Stop Loss and Take Profit on candlesticks, and auto-size the position so SL always loses their exact risk."*
- **0:20 – 0:50 (Exact 1R Risk + Live OHLC Candles):** Send `/risk 242` and `"ETH structure breaking"` in Telegram -> G2 syncs `1R = $242` live and shows 15m OHLC candlesticks (hollow bull, solid bear) floating borderlessly on transparent glass.
- **0:50 – 1:40 (Interactive SL & TP Sliding Over Candles with Auto-Sizing):**
  - Tap -> `1/4 Risk`: flip `SHORT / LONG`, toggle only 3 clean options (`0.5R / 1R / 2R` — zero swipe fatigue).
  - Tap -> `2/4 Stop Loss`: Swipe Up/Down and watch the **`SL` line slide live across the candle wicks** while **Max Loss stays locked at `-$242`** and **Size (`18.47 ETH / $31.9k`) auto-recalculates**!
  - Tap -> `3/4 Take Profit`: Swipe Up/Down and watch the **`TP` line slide live** while **`Gain +$608`** and **`Reward 2.51R`** update live!
  - Tap -> `4/4 Confirm` -> executes paper order and posts exact entry/SL/TP/qty receipt to Telegram!
- **1:40 – 2:15 (Hands-Free Management — BE & 50% Partial):** In `MANAGE`, 1 tap moves stop to **Break-Even**, 1 tap takes **50% profit**, both posting clean human logs to Telegram.
- **2:15 – 2:30 (Close):** Double-tap on root screen to show mandatory `shutDownPageContainer(1)` exit dialog + passing `npm test`. Done!
