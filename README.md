# Riad Dar Nakhil — Interactive Hospitality Platform

An interactive platform connecting a **host** (Moroccan riad manager) with a **tourist** via in-browser audio/video calls, with **live Moroccan Darija translation**.

## Contents

- `index.html` — Advertisement page with QR code (shown on venue screens)
- `qr.html` — Tourist landing/home page (entry point)
- `contact.html` — Tourist page with call modal (Audio/Video + translation)
- `call.html` / `call.js` — WebRTC peer-to-peer video call (Firestore signaling)
- `host.html` — Host dashboard (call management, speech recognition, translation)
- `host-login.html` — Host login / room join page
- `server.js` — HTTP + WebSocket server with Darija translation (local only, see below)
- `firebase-config.js` — **Single source** of Firebase client config
- `index.css` / `qr.css` / `contact.css` — Styles
- `motion.js` — 3D motion effects (mouse + phone gyroscope)
- `test.html` — Microphone/camera diagnostic page
- `api/translate.js` — Vercel serverless function for translation

## Requirements

- **Node.js** (14+)
- Internet connection (translation uses MyMemory API / OpenRouter)
- A Firebase project with Firestore enabled (project: `riad-265a5`)

## Run Locally

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`:
- Tourist page: `http://localhost:3000/qr.html`
- Host dashboard: `http://localhost:3000/host.html`

### Video Call (call.html)

The video call page (`call.html`) works **without** `server.js` — it uses
Firestore for signaling. Open two browser tabs at:

```
call.html?room=test-room
```

Both tabs will connect peer-to-peer via WebRTC.

## TURN Server Configuration

By default, only Google STUN servers are used. This is sufficient for
calls on the same network or most home connections, but **will fail on
4G/mobile and corporate/strict NATs**.

To enable TURN relay, set the `TURN_URL`, `TURN_USERNAME`, and
`TURN_CREDENTIAL` environment variables in Vercel. They are served to
the client by the `api/turn-credentials.js` serverless function at
`/api/turn-credentials`. The client (`call.js`) fetches this endpoint
before creating the `RTCPeerConnection`, so TURN credentials never ship
in the HTML/JS bundle.

You can still override via `<meta>` tags in `call.html` or
`window.__TURN_*__` globals as a fallback:
```html
<meta name="turn-url" content="turn:your-server:3478">
<meta name="turn-username" content="your-user">
<meta name="turn-credential" content="your-password">
```

### Free TURN Providers

1. **[Metered TURN](https://www.metered.ca/stun-turn)**
   - Sign up for a free account (500 MB/month free).
   - Get your TURN URL, username and credential from the dashboard.
   - Format: `turn:a.relay.metered.ca:443?transport=tcp`

2. **[Cloudflare Calls TURN](https://developers.cloudflare.com/calls/turn/)**
   - Available to Cloudflare users. Create TURN credentials via the
     Cloudflare API (`POST /accounts/{id}/calls/turn/keys`).
   - Format: `turn:turn.cloudflare.com:3478?transport=udp`

3. **[Open Relay (TURN)](https://www.metered.ca/tools/openrelay/)**
   - Free community TURN server by Metered.
   - No signup required, but no SLA.

## Vercel Deployment

The site is deployed at `https://qrcode-tsadki.vercel.app`.

### Environment Variables for Vercel

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | For translation | OpenRouter API key for `api/translate.js` |
| `ALLOWED_ORIGIN` | Optional | CORS origin for the translate API |
| `TURN_URL` | Optional | TURN server URL for `api/turn-credentials.js` (e.g. `turn:a.relay.metered.ca:443?transport=tcp`) |
| `TURN_USERNAME` | Optional | TURN username for `api/turn-credentials.js` |
| `TURN_CREDENTIAL` | Optional | TURN password/credential for `api/turn-credentials.js` |

TURN credentials are served by the `api/turn-credentials.js` Vercel serverless function,
which reads them from server-side environment variables and returns them to the client
at `/api/turn-credentials`. This keeps TURN secrets out of the HTML/JS bundle.

If TURN is not configured, calls fall back to Google STUN only and may fail on
4G/mobile or strict NATs.

## Firestore Security Rules

The file `FIRESTORE_RULES.md` documents the recommended Firestore
security rules. **These are documentation only** — the actually deployed
rules must be checked and updated in the
[Firebase Console](https://console.firebase.google.com/project/riad-265a5/firestore/rules).

## host.html and server.js

> **Important:** `host.html` depends on `server.js` (a Node.js WebSocket
> server) which **cannot run on Vercel** (Vercel only supports HTTP
> serverless functions, not persistent WebSocket connections).

Features in `host.html` that depend on `server.js`:
- **WebSocket connection** (`ws://hostname:3000`) for real-time signaling
- **Incoming call notifications** (`incoming-call` message type)
- **WebRTC offer/answer relay** via WebSocket (not Firestore)
- **Live translation pipeline** (speech → server → translate → TTS)
- **Host registration** (registers as "host" role via WebSocket)

The `call.html` page does **not** depend on `server.js` — it uses
Firestore for all signaling and works on Vercel as-is.

## How Translation Works

1. **Tourist** selects language and initiates a call (audio/video).
2. **Server** receives `incoming-call` signal and notifies the host.
3. **Host** accepts the call and waits for tourist speech.
4. **Tourist** speaks → browser `SpeechRecognition` captures text → sent to server.
5. **Server** normalizes Moroccan Darija via `darijaMap`, then translates to tourist language (MyMemory API).
6. **Host** hears translation via `speechSynthesis`, and the translated Darija is sent back to the tourist in their language.

## Notes

- Translation uses **MyMemory API** (free, may rate-limit) or **OpenRouter** (via `api/translate.js`).
- `call.html` calls use **WebRTC** with Google STUN servers + optional TURN.
- If microphone/camera is unavailable, a **canvas dummy stream** is used as fallback.
- Darija is normalized before translation via `darijaMap` in `server.js`.
