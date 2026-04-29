# lib/ — 库代码层

> 所有非 UI、非路由的逻辑都在这里。

## 子目录

| 目录 | 文件数 | 职责 |
|------|--------|------|
| `services/` | 51 | 业务逻辑核心（ASR/AI/导入/认证/微信…） |
| `consult/` | — | Agent Native Infra：tool atom 注册、UI tool schema、action routing、arena 评测纯函数 |
| `academic/` | — | Agent Native Infra：机构、多租户、场景、playbook、practice、checkpoint 服务域 |
| `utils/` | 7 | 纯工具函数（JSON/时间/转录/链接解析） |
| `db/` | 12 | IndexedDB (Dexie) Schema + CRUD |
| `ai-native/` | 17 | 应用插件系统（测验/闪卡/思维导图…） |
| `longcut/` | 6 | 转录处理算法（句子合并/引用匹配/主题提取） |
| `capture/` | 3 | 收集逻辑（类型识别/录音追加/视频会话） |
| `context-reach/` | 2 | 输入内容智能分流（URL→管线路由） |
| `config/` | 2 | 统一配置中心（环境变量映射） |

## 根级文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `logger.ts` | ~50 | 统一日志工具（替代 console.log） |
| `server-failover.ts` | ~60 | 服务端 failover（主/备服务器切换） |

## 依赖方向

```
services → utils, db, config, longcut, capture, context-reach
             ↑ 不可反向
```

详见各子目录的 DOMAIN.md。

## 产品线边界

| Track | lib 区域 | 说明 |
|------|----------|------|
| 原 MeetMind 学习产品 | `services/workspace-*`, `services/commonstack-echo-service.ts`, `services/tutor-service.ts`, `db`, `ai-native`, `capture`, `context-reach`, `longcut` | 学习收集、Echo、Tutor、AI 工坊 |
| Agent Native Infra | `consult`, `academic`, `services/consult-*` | B 端数字员工、tool atoms、skills、trace、eval |
| 共享底座 | `services/llm-service.ts`, `services/web-search-service.ts`, `services/qwen-asr-service.ts`, `services/dashscope-asr-service.ts`, `config`, `utils`, `logger.ts` | 两条产品线都可复用 |

共享底座不得 import `consult` 或 `academic`。`consult` / `academic` 可以调用共享底座。
