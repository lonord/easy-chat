import { createServer } from "node:http";
import { parse } from 'node:url'
import next from "next";
import { Server } from "socket.io";
import { initStore, addMessage, getMessages, onMessage } from './store.mjs';

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.SERVER_HOST || "localhost";
const port = parseInt(process.env.SERVER_PORT || "3000");
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

initStore().then(() => app.prepare()).then(() => {
    const httpServer = createServer((req, res) => {
        const parsedUrl = parse(req.url, true)
        console.log('** Path: ' + parsedUrl.pathname)
        if (parsedUrl.pathname === '/api/message') {
            req.query = parsedUrl.query
            handleApi(req, res)
            return
        }
        handle(req, res, parsedUrl)
    });

    const io = new Server(httpServer);

    io.on("connection", (socket) => {
        let client;
        socket.on("info", (info, cb) => {
            client = info.name;
            cb();
            console.log(`[io@${client}] receive client info: client = ${client}`)
        });
        socket.on("msg_push", async (data, cb) => {
            if (!client) {
                cb(null, "no client info");
                return;
            }

            let msg = {
                client: client,
                createAt: new Date().getTime(),
                content: data.content || '',
            }
            if (msg.content.length === 0) {
                cb(null, "content is empty");
                console.log(`[io@${client}] msg_push: content is empty`)
                return;
            }
            if (msg.content.length > 1024 * 1024) {
                cb(null, `content is too long, length: ${msg.content.length}`);
                console.log(`[io@${client}] msg_push: content is too long, length = ${msg.content.length}`)
                return;
            }
            try {
                msg = await addMessage(msg);
                socket.broadcast.emit('msg_update', msg);
                cb(msg, null);
                console.log(`[io@${client}] msg_push: ok, id = ${msg.id}, length = ${msg.content.length}`)
            } catch (e) {
                cb(null, `push message error: ${e.message || e}`);
                console.log(`[io@${client}] msg_push: error: ${e.message || e}`)
            }
        });
        socket.on("msg_sync", async (args, cb) => {
            const ms = await getMessages();
            cb(ms);
            console.log(`[io@${client || "<UNKNOW>"}] msg_sync: ${ms.length} messages total`)
        });
        onMessage(msg => socket.broadcast.emit('msg_update', msg))
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

function handleApi(req, res) {
    if (req.method === 'GET') {
        listMessages(req.query.limit).then(handleData(res)).catch(handleError(res))
        return
    }
    if (req.method === 'POST') {
        putMessages(req.body.client, req.body.content).then(() => handleData(res)('ok')).catch(handleError(res))
        return
    }
    handleError(res)(createHttpError(404, 'Not found: method ' + req.method + ' handler'))
}

function handleError(res) {
    return (err) => res.status(err.status || 500).json({ error: err.message || err })
}

function handleData(res) {
    return (data) => res.status(200).json({ data })
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
    if (!content) {
        throw createHttpError(400, 'param `content` is required')
    }
    let msg = {
        client: client,
        createAt: new Date().getTime(),
        content: content || '',
    }
    await addMessage(msg, true)
}

function createHttpError(status, msg) {
    const err = new Error(msg)
    err.status = status
    return err
}