# server — 自定义 Node 运行时

> Next.js HTTP 服务与实时语音 WebSocket 的生产入口。保持 CommonJS；纯逻辑拆出后由 `make test-server` 验证。

## 文件索引

| 文件 | 职责 |
|------|------|
| `../server.js` | 启动 Next.js、自定义运行时媒体响应、ASR / 说话人分离 / 实时通话 WebSocket 代理 |
| `runtime-lifecycle.js` | 解析生产监听地址；在 PM2、SIGTERM、SIGINT 停机时等待 HTTP 与 WebSocket 排空 |
| `runtime-lifecycle.test.js` | 回环监听、PM2 消息与平滑停机顺序回归测试 |
| `asr/` | ASR 协议与文本处理纯逻辑，详见 `asr/DOMAIN.md` |

## 运行契约

- 生产环境默认监听 `127.0.0.1`，由 Nginx 反代；开发环境默认监听 `0.0.0.0`，`HOST` 可显式覆盖。
- HTTP 超时：`keepAliveTimeout=75s`、`headersTimeout=80s`，必须大于 Nginx upstream 的 `keepalive_timeout`（默认 60s），否则空闲 5s（Node 默认值）后 Nginx 复用正被关闭的连接会触发 `HPE_CLOSED_CONNECTION` 竞争，用户看到空 body 的 400；Nginx 侧所有 `proxy_http_version 1.1` 的 location 必须 `proxy_set_header Connection ''`（见 `nginx-capture.conf`）。
- PM2 使用 `shutdown_with_message` 时，运行时收到 `shutdown` 后停止接收新请求，向 WebSocket 客户端发送 `1012`，等待 HTTP 与 WebSocket 都关闭后退出。
- 平滑关闭最多等待 25 秒；PM2 `kill_timeout` 必须大于该值。
- 基础 readiness 使用 `GET /api/health`，必须验证 SQLite 核心 Schema，而不是只检查页面能否返回。

## 验证

```bash
make test-server
make check
```

修改 ASR 主链路时额外运行 `make eval-asr`。
