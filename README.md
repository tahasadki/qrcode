# Riad Dar Nakhil — Interactive Hospitality Platform

An interactive platform connecting a **host** (Moroccan riad manager) with a **tourist** via in-browser audio/video calls, with **live Moroccan Darija translation**.

## Contents

- `index.html` — Advertisement page with QR code (shown on venue screens)
- `qr.html` — Tourist landing/home page (entry point)
- `contact.html` — Tourist page with call modal (Audio/Video + translation)
- `host.html` — Host dashboard (call management, speech recognition, translation)
- `server.js` — HTTP + WebSocket server with Darija translation
- `index.css` / `qr.css` / `contact.css` — Styles
- `motion.js` — 3D motion effects (mouse + phone gyroscope)
- `test.html` — Microphone/camera diagnostic page

## Requirements

- **Node.js** (14+)
- Internet connection (translation uses MyMemory API)

## Run

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`:
- Tourist page: `http://localhost:3000/qr.html`
- Host dashboard: `http://localhost:3000/host.html`

## How Translation Works

1. **Tourist** selects language and initiates a call (audio/video).
2. **Server** receives `incoming-call` signal and notifies the host.
3. **Host** accepts the call and waits for tourist speech.
4. **Tourist** speaks → browser `SpeechRecognition` captures text → sent to server.
5. **Server** normalizes Moroccan Darija via `darijaMap`, then translates to tourist language (MyMemory API).
6. **Host** hears translation via `speechSynthesis`, and the translated Darija is sent back to the tourist in their language.

## Notes

- Translation uses **MyMemory API** (free, may rate-limit).
- Calls use **WebRTC** with Google STUN servers (no central signaling server needed).
- If microphone/camera is unavailable, a **canvas dummy stream** is used as fallback.
- Darija is normalized before translation via `darijaMap` in `server.js`.