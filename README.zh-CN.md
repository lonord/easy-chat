# easy-chat
跨设备快速共享文本与附件的轻量级消息板。

[English README](README.md)

## 特性
- 基于 Next.js 14（App Router）、Tailwind CSS 与 Headless UI 的响应式界面。
- 自定义 Node.js 服务器处理 REST API 与 SSE 实时推送。
- JSON 数据存储自动保留最近 100 条消息，并在磁盘上管理附件文件。
- 图片自动预览、其他文件提供下载链接，文本支持一键复制。
- 通过环境变量灵活配置监听地址、存储路径和附件大小限制。

## 项目结构
- `server.mjs`：启动 Next.js、初始化存储，并实现 API 与 SSE 端点。
- `store.mjs`：管理消息 ID、自清理逻辑以及删除通知。
- `blob-store.mjs`：附件文件的写入、读取与清理工具。
- `app/`：前端界面（`app/page.tsx` 为主页面，`app/reset/page.tsx` 用于重置设备名）。
- `pages/api/message.ts`：保留的 Next.js API Route，提供与自定义服务器一致的接口。
- `store-data.json`：默认消息存储文件，可通过环境变量覆盖。

## 快速开始
```bash
npm install
npm run dev       # 默认监听 http://localhost:3000
```

生产部署：
```bash
npm run build
npm start
```

Docker：
```bash
docker build -t easy-chat .
docker run -p 3000:3000 -v $(pwd)/data:/data easy-chat
```

## 配置项
| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SERVER_HOST` | `localhost` | HTTP 服务器绑定地址（如 `0.0.0.0`）。 |
| `SERVER_PORT` | `3000` | HTTP 服务器端口。 |
| `STORE_FILE` | `store-data.json` | 消息持久化文件路径。 |
| `STORE_BLOBS_DIR` | `store-blobs` | 附件文件存储目录。 |
| `MAX_ATTACHMENT_SIZE` | `10485760` (10 MiB) | 单个附件允许的最大体积。 |
| `TZ` | 系统默认 | 时区（容器环境推荐显式设置）。 |
| `NEXT_TELEMETRY_DISABLED` | `1` | 关闭 Next.js 遥测（Dockerfile 中默认设置）。 |

所有 API 成功响应均包装为 `{ "data": ... }`，错误响应为 `{ "error": "message" }`，并结合 HTTP 状态码表明失败原因。

## REST API
以下为常规 HTTP 请求说明（不含 SSE 流）。

### `GET /api/message`
返回全部消息，按时间升序排列。可选查询参数 `limit=<number>` 限制返回最新的若干条消息。

**响应示例**
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
创建消息，支持 JSON 或 multipart/form-data。

- **JSON**：`{ "client": "设备名", "content": "文本内容" }`
- **Multipart**：字段 `client`、`content` 与 `attachment`（附件仅允许一个文件）。

成功时返回新建消息对象。校验要点：`client` 必填；若无附件则 `content` 必填；附件大小受 `MAX_ATTACHMENT_SIZE` 限制。

### `DELETE /api/message/:id`
根据 ID 删除消息及其附件。

**响应示例**
```json
{
  "data": {
    "id": 124
  }
}
```

若 ID 不存在则返回 404。

### `GET /api/message/latest`
返回最新一条消息，如无记录则为 `null`。

### `GET /api/attachment/:id`
按 `attachmentId` 流式输出附件。图片默认 inline 显示，可添加查询参数 `download=true` 强制下载。响应头包含正确的 `Content-Type`、`Content-Length`（若可用）以及经过清理的文件名。

## 实时推送
实时同步使用 SSE：`GET /api/message/stream`。事件名称包括 `message-created`、`message-deleted` 和周期性的 `heartbeat`，事件体为 JSON。

## 开发提示
- 数据存储自动裁剪为最新 100 条消息，并清理关联附件文件。
- `app/reset/page.tsx` 可清除本地设备名缓存，方便演示登录流程。
- 如需替换存储方案，可实现与 `store.mjs`、`blob-store.mjs` 相同接口的自定义模块。

## 许可证
MIT
