import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const storeFile = process.env.STORE_FILE || 'store-data.json'

const storeData = {
    idNext: 1,
    messages: []
}

export async function initStore() {
    if (existsSync(storeFile)) {
        const fileContent = await readFile(storeFile, 'utf8');
        try {
            const fileData = JSON.parse(fileContent);
            storeData.messages = fileData.messages;
            const maxId = storeData.messages.map(msg => (msg.id || 0)).reduce((a, b) => a > b ? a : b) || 0;
            storeData.idNext = maxId + 1;
        } catch (e) {
            console.error(`[store] read data error: ${e.message || e}`)
        }
    }
}

export async function getMessages() {
    return [...storeData.messages];
}

export async function addMessage(msg) {
    msg.id = storeData.idNext;
    storeData.messages.push(msg);
    try {
        await save();
        storeData.idNext++;
        return msg;
    } catch (e) {
        storeData.messages.splice(storeData.messages.length - 1, 1);
        throw e;
    }
}

async function save() {
    await writeFile(storeFile, JSON.stringify(storeData), 'utf8');
}