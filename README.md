# easy-chat
Lightweight message board for quickly sharing text and attachments across devices.

[中文说明 (Chinese README)](README.zh-CN.md)

## Features
- Responsive Next.js 14 front-end with Tailwind styling and Headless UI components.
- Custom Node.js server that exposes JSON APIs with Server-Sent Events for live updates.
- JSON-backed datastore with automatic trimming to the 100 newest messages and on-disk blob storage for attachments.
- Inline image previews, download links for other files, and click-to-copy text convenience.
- Configurable via environment variables for deployment flexibility (paths, host/port, attachment limits).

## Project Layout
- `server.mjs`: boots Next.js, wires up the message store, and serves API endpoints plus SSE stream.
- `store.mjs`: JSON persistence helpers handling message IDs, trim logic, and deletion notifications.
- `blob-store.mjs`: attachment storage utilities (streaming writes, reads, and cleanup).
- `app/`: Next.js App Router UI with the primary client experience (`app/page.tsx`) and reset helper (`app/reset/page.tsx`).
- `pages/api/message.ts`: legacy Next.js API Route mirroring the message REST API for compatibility.
- `store-data.json`: default message store file (customizable via environment variables).

## Getting Started
```bash
npm install
npm run dev       # starts Next.js + custom server on localhost:3000
```

Production build:
```bash
npm run build
npm start         # runs the compiled Next.js app behind server.mjs
```

Docker image:
```bash
docker build -t easy-chat .
docker run -p 3000:3000 -v $(pwd)/data:/data easy-chat
```

## Configuration
| Variable | Default | Description |
| --- | --- | --- |
| `SERVER_HOST` | `localhost` | Interface to bind the HTTP server to (e.g. `0.0.0.0`). |
| `SERVER_PORT` | `3000` | Port for the HTTP server. |
| `STORE_FILE` | `store-data.json` | JSON file used for persisting messages. |
| `STORE_BLOBS_DIR` | `store-blobs` | Directory for attachment payloads. |
| `MAX_ATTACHMENT_SIZE` | `10485760` (10 MiB) | Maximum accepted attachment size. |
| `TZ` | system default | Time zone (recommended for container deployments). |
| `NEXT_TELEMETRY_DISABLED` | `1` | Disable Next.js telemetry (set in Dockerfile). |

All API responses are JSON. Successful responses wrap payloads in `{ "data": ... }`; errors return `{ "error": "message" }` with an HTTP status code indicating the failure.

## API Reference (HTTP)
The SSE stream is documented in `GET /api/message/stream`. This section focuses on request/response contracts for the standard HTTP endpoints that external systems typically integrate with.

### `GET /api/message`
Fetch all messages (newest last). Optional query string `limit=<number>` returns only the most recent `limit` items.

```http
GET /api/message?limit=20
```

**Response**
```json
{
  "data": [
    {
      "id": 123,
      "client": "Work Laptop",
      "createAt": 1716020150000,
      "content": "Deployment complete",
      "attachmentId": "3832a2dd...",
      "mimeType": "image/png",
      "size": 204800
    }
  ]
}
```

### `POST /api/message`
Create a new message. Two payload styles are accepted:

1. **JSON**
   ```http
   POST /api/message
   Content-Type: application/json

   {
     "client": "Work Laptop",
     "content": "Deployment complete"
   }
   ```

2. **Multipart form data (text + file)** — the UI uses fields `client`, `content`, and `attachment`:
   ```http
   POST /api/message
   Content-Type: multipart/form-data; boundary=---

   ---
   Content-Disposition: form-data; name="client"

   Work Laptop
   ---
   Content-Disposition: form-data; name="content"

   deployment.png
   ---
   Content-Disposition: form-data; name="attachment"; filename="deployment.png"
   Content-Type: image/png

   <binary data>
   ---
   ```

**Response**
```json
{
  "data": {
    "id": 124,
    "client": "Work Laptop",
    "createAt": 1716020195123,
    "content": "Deployment complete",
    "attachmentId": "47a48f4a...",
    "mimeType": "image/png",
    "size": 204800
  }
}
```

**Validation notes**
- `client` is required for all requests.
- `content` is required unless an attachment is provided (the attachment filename is used as fallback text).
- Attachments are limited to a single file and constrained by `MAX_ATTACHMENT_SIZE`.

### `DELETE /api/message/:id`
Remove an existing message and any stored attachment.

```http
DELETE /api/message/124
```

**Response**
```json
{
  "data": {
    "id": 124
  }
}
```

Returns HTTP 404 if the message does not exist.

### `GET /api/message/latest`
Fetch the latest message or `null` if no messages exist.

```http
GET /api/message/latest
```

**Response**
```json
{
  "data": {
    "id": 125,
    "client": "Phone",
    "createAt": 1716020330330,
    "content": "On the way"
  }
}
```

### `GET /api/attachment/:id`
Stream an attachment by its `attachmentId`. Image mimetypes are rendered inline by default.

```http
GET /api/attachment/47a48f4a...
```

Query parameter `download=true` forces a download response. The service sets `Content-Type`, `Content-Length` (when available), and a sanitized filename via `Content-Disposition`.

## Real-Time Updates
For live synchronization, clients subscribe to the Server-Sent Events stream:

```http
GET /api/message/stream
Accept: text/event-stream
```

Events emit named payloads such as `message-created`, `message-deleted`, and periodic `heartbeat` updates. Each event body is JSON matching the message schema above.

## Development Notes
- The store automatically trims to the 100 most recent messages, deleting oldest entries and associated blobs.
- `app/reset/page.tsx` clears the cached client name to help demo the onboarding prompt.
- Extend the persistence layer by replacing `store.mjs` and `blob-store.mjs` with custom implementations conforming to the same APIs.

## License
MIT
