import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const storeFile = process.env.STORE_FILE || 'store-data.json'

const maxRecords = 100

const storeData = {
    idNext: 1,
    messages: [],
}

const msgListeners = []
const trimListeners = []

export async function initStore() {
    if (existsSync(storeFile)) {
        const fileContent = await readFile(storeFile, 'utf8');
        try {
            const fileData = JSON.parse(fileContent);
            if (Array.isArray(fileData?.messages)) {
                storeData.messages = fileData.messages.map(normalizeLegacyMessage);
            }
            const maxId = storeData.messages.map(msg => (msg.id || 0)).reduce((a, b) => a > b ? a : b) || 0;
            storeData.idNext = maxId + 1;
        } catch (e) {
            console.error(`[store] read data error: ${e.message || e}`)
        }
    }
    const removed = trimMessages();
    if (removed.length) {
        try {
            await save();
        } catch (err) {
            console.error('[store] trim save error:', err);
        }
        notifyTrim(removed);
    }
}

export async function getMessages() {
    return [...storeData.messages];
}

export async function addMessage(msg, notify) {
    msg.id = storeData.idNext;
    storeData.messages.push(msg);
    const removed = trimMessages();
    try {
        await save();
        storeData.idNext++;
        if (notify) {
            msgListeners.forEach(fn => fn(msg));
        }
        if (removed.length) {
            notifyTrim(removed);
        }
        return msg;
    } catch (e) {
        storeData.messages.splice(storeData.messages.length - 1, 1);
        throw e;
    }
}

export function onMessage(fn) {
    msgListeners.push(fn)
}

export function onTrim(fn) {
    trimListeners.push(fn);
}

async function save() {
    await writeFile(storeFile, JSON.stringify(storeData), 'utf8');
}

function trimMessages() {
    if (storeData.messages.length > maxRecords) {
        return storeData.messages.splice(0, storeData.messages.length - maxRecords);
    }
    return [];
}

function notifyTrim(removed) {
    trimListeners.forEach(fn => {
        try {
            fn(removed);
        } catch (err) {
            console.error('[store] trim listener error:', err);
        }
    });
}

function normalizeLegacyMessage(msg) {
    if (!msg || typeof msg !== 'object') {
        return msg;
    }
    if (typeof msg.createAt !== 'number') {
        const createAt = Date.parse(msg.createAt);
        msg.createAt = Number.isFinite(createAt) ? createAt : Date.now();
    }
    if (typeof msg.content !== 'string') {
        msg.content = '';
    }
    return msg;
}
