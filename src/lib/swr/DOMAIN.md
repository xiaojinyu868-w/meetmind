# SWR — 数据请求基础设施

> SWR 配置、全局 Provider 和 fetcher。

## 文件索引

| 文件 | 职责 |
|------|------|
| `index.ts` | barrel 导出 |
| `fetcher.ts` | 带认证的 fetch 封装 |
| `provider.tsx` | SWR 全局 Provider（缓存/错误/重试策略） |
