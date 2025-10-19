**Project Overview**
- Purpose: lightweight message board for sharing text snippets across devices via a web UI.
- Stack: Next.js 14 (App Router) with React 18, custom Node HTTP server, Tailwind CSS, Headless UI components.
- Persistence: JSON file store (`store-data.json`) with up to 100 retained messages, location configurable through the `STORE_FILE` env variable.

**Runtime Flow**
- `server.mjs` bootstraps Next, initializes the store, and mounts an HTTP server that proxies to Next while handling custom endpoints:
- `GET /api/message`: returns all messages or the newest `limit` items.
- `POST /api/message`: accepts JSON or multipart form data, validates `client`, and stores text or attachment metadata before broadcasting.
- `DELETE /api/message/:id`: removes an existing message, cleaning up attachment blobs and notifying connected clients.
- `GET /api/message/latest`: fetches the most recent message (or `null`).
- `GET /api/message/stream`: Server-Sent Events channel; all connected clients receive new messages and heartbeats every 30s.
- `GET /api/attachment/:id`: streams stored blobs with appropriate headers for inline image preview or downloads.
- Server-Sent Events now emit structured payloads with `event` keys (e.g. `"message-created"`, `"message-deleted"`) to allow clients to sync additions and removals.
- Store helpers (`store.mjs`) provide `initStore`, `getMessages`, `addMessage`, `deleteMessage`, `onMessage`, `onDelete`, and `onTrim`. Messages receive incremental IDs, retain attachment metadata (`attachmentId`, `mimeType`, `size`), and are trimmed to the `maxRecords` cap (100) with orphaned blobs cleaned up; deleted messages trigger blob cleanup and downstream notifications.
- `blob-store.mjs` encapsulates attachment persistence, ensuring the blob directory exists, streaming uploads to disk, and exposing read/delete utilities for the server.

**Front-End**
- `app/page.tsx`: client component that
  - prompts for a device name via `useClient` (`app/client.js`, uses `localStorage`).
  - fetches the initial message list and listens to `/api/message/stream` for real-time updates.
  - allows composing/sending text messages, uploading/pasting attachments (images render inline; other files show download controls), highlights the current client's entries, and supports click-to-copy for text messages.
  - renders per-message copy and delete actions, with delete operations gated behind a confirmation prompt.
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
  - `STORE_BLOBS_DIR`: directory for attachment payloads (`store-blobs` by default).
  - `MAX_ATTACHMENT_SIZE`: optional override for the maximum attachment size (defaults to 10 MiB).
  - `NEXT_TELEMETRY_DISABLED`, `TZ`: set in the Docker runtime stage.
- Add additional message retention or storage backends by replacing `store.mjs`; customize attachment handling by extending `blob-store.mjs`.
