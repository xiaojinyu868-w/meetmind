// 教学 MCP server（codex 的子进程，stdio JSON-RPC，零依赖手写协议）。
//
// 由 codex app-server 按 CODEX_HOME/config.toml 的 [mcp_servers.teach] 拉起。
// 不做任何教学逻辑：tools/list 从 Next 内部路由拉描述（schema 单一事实源是
// src/lib/services/teach-agent/tools.ts），tools/call POST 回 Next 内部回调
// （按 TEACH_THREAD_ID 进事件总线 → SSE 扇出；BoardEnv digest 作为结果返回）。
//
// env（全部由 config.toml 的 [mcp_servers.teach.env] 注入）：
//   TEACH_THREAD_ID       教学线程 id
//   TEACH_TOOL_CALLBACK   POST 工具执行（{threadId,name,args} → {result}）
//   TEACH_TOOLS_URL       GET 工具描述（→ {tools:[{name,description,inputSchema}]}）
//   TEACH_INTERNAL_TOKEN  内部共享令牌（x-teach-internal 头）

const THREAD_ID = process.env.TEACH_THREAD_ID || '';
const TOOL_CALLBACK = process.env.TEACH_TOOL_CALLBACK || '';
const TOOLS_URL = process.env.TEACH_TOOLS_URL || '';
const TOKEN = process.env.TEACH_INTERNAL_TOKEN || '';

const PROTOCOL_VERSION = '2025-06-18';

let toolsCache = null;

function log(...args) {
  // stdio 的 stdout 是协议通道，日志只能走 stderr
  console.error('[teach-mcp]', ...args);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function listTools() {
  if (toolsCache) return toolsCache;
  const res = await fetch(TOOLS_URL, { headers: { 'x-teach-internal': TOKEN } });
  if (!res.ok) throw new Error(`tools fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  toolsCache = (body.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return toolsCache;
}

async function callTool(name, args) {
  const res = await fetch(TOOL_CALLBACK, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-teach-internal': TOKEN },
    body: JSON.stringify({ threadId: THREAD_ID, name, args: args ?? {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      content: [{ type: 'text', text: `工具执行失败: ${body.error || `HTTP ${res.status}`}` }],
      isError: true,
    };
  }
  const result = body.result ?? {};
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    ...(result.ok === false ? { isError: true } : {}),
  };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  try {
    if (method === 'initialize') {
      sendResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'teach-tools', version: '1.0.0' },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') {
      if (isRequest) sendResult(id, {});
      return;
    }
    if (method === 'tools/list') {
      sendResult(id, { tools: await listTools() });
      return;
    }
    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments);
      sendResult(id, result);
      return;
    }
    if (isRequest) sendError(id, -32601, `method not found: ${method}`);
  } catch (err) {
    log('handler error', method, err?.message || err);
    if (isRequest) {
      sendError(id, -32603, `internal error: ${err?.message || err}`);
    }
  }
}

// stdio 按行分隔的 JSON-RPC（MCP stdio transport）
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handleMessage(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

log('started', { threadId: THREAD_ID, callback: TOOL_CALLBACK });
