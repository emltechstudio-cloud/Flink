# Flink PWA

Flink is a privacy-first communications Progressive Web App. The product is intentionally client-first: the browser stores local conversations and room history in IndexedDB, WebRTC carries media and direct session data, and the EML Core API provides identity, groups, invitations, signaling, push registration, and optional TURN credentials. There is no Node.js server in production.

## Develop and build

```sh
npm ci
npm run dev          # local development
npm run build        # typecheck and write dist/
npm run build:pages  # build and copy the static site to the Pages root
```

The app source lives in `frontend/`. The generated `dist/` directory is ignored for normal development. The legacy INet implementation has been moved to `archive/inet-v1/` so it cannot be accidentally served as a second application.

The published project-site URL is controlled by the repository's GitHub Pages settings. The app uses relative asset and room paths so it can be hosted below either `/Flink/` or another configured project path.

## Install and offline behavior

Open the Pages site over HTTPS, then use the browser's **Install app** / **Add to Home Screen** action. The app shell, static bundles, local contacts, saved room links, room messages, and direct conversation history are cached or stored locally. Account recovery, signaling, push delivery, and calls still require a network connection.

Push notifications are opt-in from **You → Enable notifications**. Voice and video notifications expose Answer and Decline actions; when the app is open, an in-app ringtone can be enabled or disabled from **You → Ringtone**.

## Returning INet users

On first open, the PWA reads the old `inet_db` IndexedDB database and imports the local profile, contacts, direct text/image messages, and call log into the Flink store. It never deletes the old database. Older SIM backup files can also be restored through the saved number and password.

## What is included

- Device, password, and SIM-file account recovery
- Six-digit number approach flow for ping, chat, voice, and video
- Reconnecting WebSocket signaling with buffered outbound signaling
- WebRTC peer sessions with single-initiator negotiation, ICE restart, and TURN configuration support
- Chunked WebRTC data-channel transfer for large media payloads
- Temporary shareable rooms with saved links, local room history, multi-participant video, and screen sharing
- Groups, local conversation history, contacts, reactions, and opt-in push notifications
- Responsive app shell and GitHub Pages-safe relative routes/assets
