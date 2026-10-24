# ZENIT XMD — Pairing Website (Render)

Users enter their number here → get a pairing code → enter it in WhatsApp.
The **main bot** (Pterodactyl panel) links the device itself and starts that account
directly. No session ID is sent to users; no hosting is needed on their side.
A "Connected" card is posted to the Telegram pair group (PAIR_GROUP_ID).

## 1. Main bot (panel) — env
- `WEB_PAIR_KEY` = a long random secret
- `PAIR_GROUP_ID` + `TELEGRAM_BOT_TOKEN` (for the Telegram group message)
- The bot's web port must be reachable from the internet (panel allocation / domain).

## 2. This site (Render) — env
- `BOT_URL`  = public URL of the bot, e.g. `https://bot.yourdomain.com` or `http://IP:PORT`
- `PAIR_KEY` = same value as `WEB_PAIR_KEY`

Build `npm install` · Start `npm start` (or use `render.yaml`).
