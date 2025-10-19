import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, unlink, access, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const blobDir = resolve(process.cwd(), process.env.STORE_BLOBS_DIR || "store-blobs");

let initialized = false;

export async function initBlobStore() {
  if (initialized) {
    return;
  }
  await mkdir(blobDir, { recursive: true });
  initialized = true;
}

export function getBlobPath(id) {
  return join(blobDir, id);
}

export async function saveBlob(stream) {
  await initBlobStore();
  const attachmentId = randomUUID();
  const targetPath = getBlobPath(attachmentId);
  const writeStream = createWriteStream(targetPath, { mode: 0o600 });
  let size = 0;
  stream.on("data", (chunk) => {
    size += chunk.length;
  });
  try {
    await pipeline(stream, writeStream);
    return { attachmentId, size };
  } catch (err) {
    await safeUnlink(targetPath);
    throw err;
  }
}

export function createBlobReadStream(id) {
  return createReadStream(getBlobPath(id));
}

export async function blobExists(id) {
  try {
    await access(getBlobPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function deleteBlob(id) {
  await safeUnlink(getBlobPath(id));
}

export async function getBlobStat(id) {
  return stat(getBlobPath(id));
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath);
  } catch (err) {
    if (!err || err.code === "ENOENT") {
      return;
    }
    throw err;
  }
}
