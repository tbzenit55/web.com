# ZENIT XMD — Pairing Web (Render)

Only job: link a WhatsApp device (pairing code or QR) and give back a **Session ID**.
The main bot runs separately (Pterodactyl panel). Nothing is stored here after pairing.

## Deploy on Render
1. Push this folder to its own GitHub repo (or use it as the root directory).
2. Render → New → Web Service → connect the repo.
3. Build: `npm install` · Start: `npm start` (or use `render.yaml`).
4. Open the Render URL, pair, copy the Session ID.

## Use the Session ID in the main bot
- Multi-session (same format as the bot's Telegram pairing):
  `SESSIONS={"919876543210":"ZenitXMD!...."}` in the panel's env / `.env`
- Single session: put the "SESSION variable" value (base64) into `SESSION`.

Session ID is also sent to the linked number's own WhatsApp chat.
Env (optional): `MAX_ACTIVE` (default 20 parallel pairings).
