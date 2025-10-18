**Project Overview**
- Purpose: lightweight message board for sharing text snippets across devices via a web UI.
- Stack: Next.js 14 (App Router) with React 18, custom Node HTTP server, Tailwind CSS, Headless UI components.
- Persistence: JSON file store (`store-data.json`) with up to 100 retained messages, location configurable through the `STORE_FILE` env variable.

**Runtime Flow**
- `server.mjs` bootstraps Next, initializes the store, and mounts an HTTP server that proxies to Next while handling three custom endpoints:
  - `GET /api/message`: returns all messages or the newest `limit` items.
  - `POST /api/message`: validates `client` & `content`, persists the entry, and broadcasts it.
  - `GET /api/message/latest`: fetches the most recent message (or `null`).
  - `GET /api/message/stream`: Server-Sent Events channel; all connected clients receive new messages and heartbeats every 30s.
- Store helpers (`store.mjs`) provide `initStore`, `getMessages`, `addMessage`, and `onMessage`. Messages receive incremental IDs and are trimmed to the `maxRecords` cap (100).

**Front-End**
- `app/page.tsx`: client component that
  - prompts for a device name via `useClient` (`app/client.js`, uses `localStorage`).
  - fetches the initial message list and listens to `/api/message/stream` for real-time updates.
  - allows composing/sending messages, highlights the current client's entries, and supports click-to-copy with toast feedback.
- `app/reset/page.tsx`: utility page to clear the cached client name and reload.
- Styling leverages Tailwind via `app/globals.css`; Headless UI provides accessible buttons/textarea.

**API Route (legacy)**
- `pages/api/message.ts` mirrors the REST interface using Next's API routes. The custom server now fulfills these endpoints directly, but the file remains for compatibility with the default Next runtime.

**Build & Deployment**
- Scripts (`package.json`):
  - `npm run dev`: starts `server.mjs` with `SERVER_HOST=0.0.0.0`.
  - `npm run build`: Next build (standalone output).
  - `npm start`: runs `server.mjs` in production mode.
- `Dockerfile`: multi-stage build producing a minimal Node 18 Alpine image that copies the Next standalone output and runs `server.mjs`. Exposes port 3000 and stores message data under `/data`.
- `Makefile`: helper targets for `npm run build` and pushing a multi-arch Docker image (`lonord/easy-chat`).

**Configuration Notes**
- Environment variables:
  - `SERVER_HOST`, `SERVER_PORT`: control the listening address.
  - `STORE_FILE`: persistence path (defaults to `store-data.json`; Docker image points it to `/data/store-data.json`).
  - `NEXT_TELEMETRY_DISABLED`, `TZ`: set in the Docker runtime stage.
- Add additional message retention or storage backends by replacing `store.mjs`.
