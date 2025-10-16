import { createServer } from "node:http";
import { parse } from 'node:url'
import next from "next";
import { initStore, addMessage, getMessages, onMessage } from './store.mjs';

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.SERVER_HOST || "localhost";
const port = parseInt(process.env.SERVER_PORT || "3000");
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

initStore().then(() => app.prepare()).then(() => {
    const sseClients = new Set();

    onMessage(msg => broadcastSseMessage(sseClients, msg));

    const httpServer = createServer((req, res) => {
        const parsedUrl = parse(req.url, true)
        console.log('** Path: ' + parsedUrl.pathname)
        if (parsedUrl.pathname === '/api/message/stream') {
            handleSse(req, res, sseClients);
            return;
        }
        if (parsedUrl.pathname === '/api/message') {
            req.query = parsedUrl.query
            handleApi(req, res)
            return
        }
        handle(req, res, parsedUrl)
    });

    httpServer
        .once("error", (err) => {
            console.error(err);
            process.exit(1);
        })
        .listen(port, () => {
            console.log(`> Ready on http://${hostname}:${port}`);
        });
}).catch((err) => {
    console.error(err);
    process.exit(1);
})

async function handleApi(req, res) {
    if (req.method === 'GET') {
        try {
            const messages = await listMessages(req.query.limit)
            handleData(res)(messages)
        } catch (err) {
            handleError(res)(err)
        }
        return
    }
    if (req.method === 'POST') {
        try {
            const body = await readJsonBody(req)
            const message = await putMessages(body.client, body.content)
            handleData(res)(message)
        } catch (err) {
            handleError(res)(err)
        }
        return
    }
    handleError(res)(createHttpError(404, 'Not found: method ' + req.method + ' handler'))
}

function handleError(res) {
    return (err) => {
        const status = err && err.status ? err.status : 500
        const message = err && err.message ? err.message : err
        sendJson(res, status, { error: message })
    }
}

function handleData(res) {
    return (data) => sendJson(res, 200, { data })
}

async function listMessages(limit) {
    const count = parseInt(limit)
    const messages = await getMessages()
    if (!isNaN(count) && count > 0 && messages.length > count) {
        return messages.slice(messages.length - count)
    }
    return messages
}

async function putMessages(client, content) {
    if (!client) {
        throw createHttpError(400, 'param `client` is required')
    }
    if (typeof content !== 'string' || content.length === 0) {
        throw createHttpError(400, 'param `content` is required')
    }
    if (content.length > 1024 * 1024) {
        throw createHttpError(400, `content is too long, length: ${content.length}`)
    }
    let msg = {
        client: client,
        createAt: new Date().getTime(),
        content: content || '',
    }
    return await addMessage(msg, true)
}

function createHttpError(status, msg) {
    const err = new Error(msg)
    err.status = status
    return err
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
}

function broadcastSseMessage(clients, msg) {
    const payload = `data: ${JSON.stringify(msg)}\n\n`
    clients.forEach((client) => {
        try {
            client.write(payload)
        } catch (err) {
            console.error('[sse] broadcast error:', err)
            clients.delete(client)
            try {
                client.end()
            } catch { }
        }
    })
}

function handleSse(req, res, clients) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    })

    res.write('\n')

    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n')
        } catch {
            clearInterval(heartbeat)
        }
    }, 30000)

    const client = {
        write: (data) => res.write(data),
        end: () => res.end(),
    }

    clients.add(client)

    req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(client)
        try {
            res.end()
        } catch { }
    })
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = ''
        req.on('data', (chunk) => {
            data += chunk
            if (data.length > 1024 * 1024) {
                reject(createHttpError(413, 'request body too large'))
                req.destroy()
            }
        })
        req.on('end', () => {
            if (!data) {
                resolve({})
                return
            }
            try {
                resolve(JSON.parse(data))
            } catch (err) {
                reject(createHttpError(400, 'invalid JSON body'))
            }
        })
        req.on('error', (err) => {
            reject(createHttpError(400, err.message || err))
        })
    })
}
