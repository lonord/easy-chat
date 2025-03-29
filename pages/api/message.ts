"use server";

import { NextApiResponse, NextApiRequest } from 'next'
import { addMessage, getMessages } from '../../store.mjs';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        return listMessages(req.query.limit).then(handleData(res)).catch(handleError(res))
    }
    if (req.method === 'POST') {
        return putMessages(req.body.client, req.body.content).then(() => handleData(res)('ok')).catch(handleError(res))
    }
    return handleError(res)(createHttpError(404, 'Not found: method ' + req.method + ' handler'))
}

function handleError(res: NextApiResponse) {
    return (err: any) => res.status(err.status || 500).json({ error: err.message || err })
}

function handleData(res: NextApiResponse) {
    return (data: any) => res.status(200).json({ data })
}

async function listMessages(limit?: any) {
    const count = parseInt(limit)
    const messages = await getMessages()
    if (!isNaN(count) && count > 0 && messages.length > count) {
        return messages.slice(messages.length - count)
    }
    return messages
}

async function putMessages(client: string, content: string) {
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

function createHttpError(status: number, msg: string) {
    const err = new Error(msg) as any
    err.status = status
    return err
}