import { createServer } from "node:http";
import { parse } from "node:url";
import { basename } from "node:path";
import next from "next";
import Busboy from "busboy";
import {
  initStore,
  addMessage,
  getMessages,
  deleteMessage,
  onMessage,
  onTrim,
  onDelete,
} from "./store.mjs";
import {
  initBlobStore,
  saveBlob,
  createBlobReadStream,
  deleteBlob,
  blobExists,
  getBlobStat,
} from "./blob-store.mjs";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.SERVER_HOST || "localhost";
const port = parseInt(process.env.SERVER_PORT || "3000", 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const sseClients = new Set();

const MAX_TEXT_LENGTH = 1024 * 1024;
const DEFAULT_ATTACHMENT_LIMIT = 10 * 1024 * 1024;
const parsedAttachmentLimit = Number.parseInt(process.env.MAX_ATTACHMENT_SIZE || "", 10);
const MAX_ATTACHMENT_SIZE =
  Number.isFinite(parsedAttachmentLimit) && parsedAttachmentLimit > 0
    ? parsedAttachmentLimit
    : DEFAULT_ATTACHMENT_LIMIT;

onTrim(handleTrimmedMessages);
onDelete(handleDeletedMessage);

Promise.all([initStore(), initBlobStore()])
  .then(() => app.prepare())
  .then(() => {
    onMessage((msg) => broadcastSseMessageCreated(sseClients, msg));
    onTrim((messages) => {
      messages
        .filter((message) => message && typeof message.id === "number")
        .forEach((message) => {
          broadcastSseMessageDeleted(sseClients, message);
        });
    });
    onDelete((msg) => broadcastSseMessageDeleted(sseClients, msg));

    const httpServer = createServer((req, res) => {
      const parsedUrl = parse(req.url || "", true);
      const pathname = parsedUrl.pathname || "";
      console.log("** Path: " + pathname);

      if (pathname === "/api/message/stream") {
        handleSse(req, res, sseClients);
        return;
      }
      if (pathname === "/api/message/latest") {
        handleLatestMessage(req, res);
        return;
      }
      if (pathname.startsWith("/api/message/")) {
        const idSegment = decodeURIComponent(pathname.replace("/api/message/", ""));
        handleMessageItem(req, res, idSegment);
        return;
      }
      if (pathname === "/api/message") {
        req.query = parsedUrl.query;
        handleApi(req, res);
        return;
      }
      if (pathname.startsWith("/api/attachment/")) {
        const attachmentId = decodeURIComponent(pathname.replace("/api/attachment/", ""));
        handleAttachmentRequest(req, res, attachmentId, parsedUrl.query);
        return;
      }

      handle(req, res, parsedUrl);
    });

    httpServer
      .once("error", (err) => {
        console.error(err);
        process.exit(1);
      })
      .listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
      });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

async function handleApi(req, res) {
  if (req.method === "GET") {
    try {
      const messages = await listMessages(req.query?.limit);
      handleData(res)(messages);
    } catch (err) {
      handleError(res)(err);
    }
    return;
  }

  if (req.method === "POST") {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    try {
      if (contentType.includes("multipart/form-data")) {
        const { fields, file } = await parseMultipartMessage(req);
        const message = await putMessages(fields.client, fields.content, file);
        handleData(res)(message);
      } else {
        const body = await readJsonBody(req);
        const message = await putMessages(body.client, body.content);
        handleData(res)(message);
      }
    } catch (err) {
      handleError(res)(err);
    }
    return;
  }

  if (req.method === "DELETE") {
    const messageId = parseMessageId(req.query?.id);
    if (!messageId) {
      handleError(res)(createHttpError(400, "param `id` is required"));
      return;
    }
    try {
      const deleted = await performDeleteMessage(messageId);
      handleData(res)({ id: deleted.id });
    } catch (err) {
      handleError(res)(err);
    }
    return;
  }

  handleError(res)(createHttpError(404, "Not found: method " + req.method + " handler"));
}

async function handleLatestMessage(req, res) {
  if (req.method !== "GET") {
    handleError(res)(createHttpError(405, "method " + req.method + " not allowed"));
    return;
  }
  try {
    const message = await getLatestMessage();
    handleData(res)(message);
  } catch (err) {
    handleError(res)(err);
  }
}

async function handleMessageItem(req, res, idSegment) {
  const messageId = parseMessageId(idSegment);
  if (!messageId) {
    handleError(res)(createHttpError(400, "invalid message id"));
    return;
  }

  if (req.method === "DELETE") {
    try {
      const deleted = await performDeleteMessage(messageId);
      handleData(res)({ id: deleted.id });
    } catch (err) {
      handleError(res)(err);
    }
    return;
  }

  handleError(res)(createHttpError(405, "method " + req.method + " not allowed"));
}

async function handleAttachmentRequest(req, res, attachmentId, query) {
  if (req.method !== "GET") {
    handleError(res)(createHttpError(405, "method " + req.method + " not allowed"));
    return;
  }
  if (!attachmentId) {
    handleError(res)(createHttpError(400, "attachment id is required"));
    return;
  }
  try {
    const message = await findMessageByAttachment(attachmentId);
    if (!message) {
      throw createHttpError(404, "attachment not found");
    }
    const exists = await blobExists(attachmentId);
    if (!exists) {
      throw createHttpError(404, "attachment data missing");
    }
    const headers = await buildAttachmentHeaders(message, query);
    res.writeHead(200, headers);
    const stream = createBlobReadStream(attachmentId);
    stream.on("error", (err) => {
      console.error("[attachment] stream error:", err);
      if (!res.headersSent) {
        handleError(res)(createHttpError(500, "attachment read error"));
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  } catch (err) {
    handleError(res)(err);
  }
}

function handleError(res) {
  return (err) => {
    const status = err && err.status ? err.status : 500;
    const message = err && err.message ? err.message : err;
    if (!res.headersSent) {
      sendJson(res, status, { error: message });
    } else {
      try {
        res.end();
      } catch (endErr) {
        console.error("[response] end error:", endErr);
      }
    }
  };
}

function handleData(res) {
  return (data) => sendJson(res, 200, { data });
}

async function listMessages(limit) {
  const count = parseInt(limit, 10);
  const messages = await getMessages();
  if (!Number.isNaN(count) && count > 0 && messages.length > count) {
    return messages.slice(messages.length - count);
  }
  return messages;
}

async function getLatestMessage() {
  const messages = await getMessages();
  if (!messages.length) {
    return null;
  }
  return messages[messages.length - 1];
}

async function performDeleteMessage(messageId) {
  const deleted = await deleteMessage(messageId, true);
  if (!deleted) {
    throw createHttpError(404, `message ${messageId} not found`);
  }
  return deleted;
}

async function putMessages(client, content, attachment) {
  if (!client) {
    await cleanupAttachment(attachment);
    throw createHttpError(400, "param `client` is required");
  }

  const normalizedContent = typeof content === "string" ? content : "";
  const hasAttachment = !!(attachment && attachment.attachmentId);
  const finalContent = hasAttachment
    ? normalizedContent || attachment.filename || attachment.attachmentId
    : normalizedContent;

  if (!hasAttachment && (!finalContent || finalContent.length === 0)) {
    await cleanupAttachment(attachment);
    throw createHttpError(400, "param `content` is required");
  }

  if (finalContent.length > MAX_TEXT_LENGTH) {
    await cleanupAttachment(attachment);
    throw createHttpError(400, `content is too long, length: ${finalContent.length}`);
  }

  const msg = {
    client,
    createAt: Date.now(),
    content: finalContent,
  };

  if (hasAttachment) {
    msg.attachmentId = attachment.attachmentId;
    msg.mimeType = attachment.mimeType;
    if (typeof attachment.size === "number") {
      msg.size = attachment.size;
    }
  }

  try {
    return await addMessage(msg, true);
  } catch (err) {
    await cleanupAttachment(attachment);
    throw err;
  }
}

function createHttpError(status, msg) {
  const err = new Error(msg);
  err.status = status;
  return err;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcastSsePayload(clients, payload) {
  if (!payload) {
    return;
  }
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((client) => {
    try {
      client.write(data);
    } catch (err) {
      console.error("[sse] broadcast error:", err);
      clients.delete(client);
      try {
        client.end();
      } catch {
        // ignore
      }
    }
  });
}

function broadcastSseMessageCreated(clients, message) {
  if (!message) {
    return;
  }
  broadcastSsePayload(clients, { event: "message-created", message });
}

function broadcastSseMessageDeleted(clients, message) {
  if (!message || typeof message.id !== "number") {
    return;
  }
  broadcastSsePayload(clients, { event: "message-deleted", id: message.id });
}

function handleSse(req, res, clients) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write("\n");

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  const client = {
    write: (data) => res.write(data),
    end: () => res.end(),
  };

  clients.add(client);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
    try {
      res.end();
    } catch {
      // ignore
    }
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_TEXT_LENGTH) {
        reject(createHttpError(413, "request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(createHttpError(400, "invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      reject(createHttpError(400, err.message || err));
    });
  });
}

function handleTrimmedMessages(messages) {
  messages
    .filter((msg) => msg && msg.attachmentId)
    .forEach((msg) => {
      deleteBlob(msg.attachmentId).catch((err) => {
        console.error("[attachment] cleanup error:", err);
      });
    });
}

function handleDeletedMessage(message) {
  cleanupAttachment(message);
}

async function findMessageByAttachment(attachmentId) {
  const messages = await getMessages();
  return messages.find((msg) => msg && msg.attachmentId === attachmentId) || null;
}

async function buildAttachmentHeaders(message, query) {
  const mimeType =
    typeof message.mimeType === "string" && message.mimeType.length
      ? message.mimeType
      : "application/octet-stream";
  const downloadParam = String(query?.download || "").toLowerCase();
  const forceDownload = downloadParam === "1" || downloadParam === "true";
  const isImage = mimeType.startsWith("image/");
  const inline = isImage && !forceDownload;
  const filename = sanitizeFilename(message.content || message.attachmentId || "download");
  const headers = {
    "Content-Type": mimeType,
    "Cache-Control": "no-cache",
    "Content-Disposition": buildContentDisposition(filename, inline),
  };
  const sizeValue =
    typeof message.size === "number" && Number.isFinite(message.size)
      ? message.size
      : await resolveAttachmentSize(message.attachmentId);
  if (typeof sizeValue === "number" && Number.isFinite(sizeValue)) {
    headers["Content-Length"] = sizeValue;
  }
  return headers;
}

function buildContentDisposition(filename, inline) {
  const dispositionType = inline ? "inline" : "attachment";
  const fallback = filename
    .replace(/["\r\n]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `${dispositionType}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function sanitizeFilename(filename) {
  const base = basename(filename);
  return base.replace(/[/\\?%*:|"<>]/g, "_") || "download";
}

function parseMessageId(input) {
  let value = input;
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const id = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return id;
}

async function resolveAttachmentSize(attachmentId) {
  try {
    const stats = await getBlobStat(attachmentId);
    return stats.size;
  } catch (err) {
    console.error("[attachment] stat error:", err);
    return undefined;
  }
}

async function cleanupAttachment(attachment) {
  if (!attachment || !attachment.attachmentId) {
    return;
  }
  try {
    await deleteBlob(attachment.attachmentId);
  } catch (err) {
    console.error("[attachment] cleanup error:", err);
  }
}

function parseMultipartMessage(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_ATTACHMENT_SIZE,
        fields: 10,
        fieldSize: MAX_TEXT_LENGTH,
      },
    });

    const fields = {};
    let filePromise = null;
    let truncated = false;
    let settled = false;

    const done = (err, result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    };

    busboy.on("field", (name, value) => {
      if (typeof fields[name] === "undefined") {
        fields[name] = value;
      }
    });

    busboy.on("file", (fieldName, file, info) => {
      if (filePromise) {
        file.resume();
        return;
      }
      const { filename, mimeType } = info;
      if (!filename) {
        file.resume();
        return;
      }
      file.on("limit", () => {
        truncated = true;
      });
      filePromise = saveBlob(file).then(({ attachmentId, size }) => ({
        attachmentId,
        filename,
        mimeType: mimeType || "application/octet-stream",
        size,
      }));
    });

    busboy.on("error", (err) => done(err));
    busboy.on("filesLimit", () => done(createHttpError(400, "only one attachment is allowed")));
    busboy.on("partsLimit", () => done(createHttpError(400, "too many parts in multipart payload")));

    busboy.on("finish", async () => {
      if (truncated) {
        try {
          if (filePromise) {
            const fileResult = await filePromise.catch(() => null);
            if (fileResult?.attachmentId) {
              await deleteBlob(fileResult.attachmentId);
            }
          }
        } catch (err) {
          console.error("[attachment] cleanup after truncate error:", err);
        }
        done(createHttpError(413, `attachment exceeds size limit (${MAX_ATTACHMENT_SIZE} bytes)`));
        return;
      }
      try {
        const fileResult = filePromise ? await filePromise : null;
        done(null, { fields, file: fileResult });
      } catch (err) {
        done(err);
      }
    });

    req.on("aborted", () => {
      done(createHttpError(400, "request aborted by client"));
    });

    req.on("error", (err) => done(err));

    req.pipe(busboy);
  });
}
