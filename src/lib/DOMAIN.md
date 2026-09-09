# lib/ — 库代码层

> 所有非 UI、非路由的逻辑都在这里。

## 子目录

| 目录 | 文件数 | 职责 |
|------|--------|------|
| `services/` | 60 | 业务逻辑核心（ASR/AI/导入/认证/微信…） |
| `utils/` | 40 | 纯工具函数（JSON/时间/转录/链接解析/模型偏好/provider 解析） |
| `learning/` | 4 | 学习记忆的纯模型，客户端与服务端共用：`mastery-trail-model.ts`（检验结果 → 掌握状态：还没稳 / 刚记住 / 已经稳了）、`device-outcomes.ts`（本机 localStorage 里的应用结果）、`moment-title.ts`（给课堂里的一个时刻起名：学生备注 → 脉络要点 → 老师那一刻原话首句；复习页困惑点列表 / 问同学书桌 / 同桌开场 chip 同一套命名）、`lesson-title-generic.ts`（`isPlaceholderLessonTitle`：零信息标题的唯一判定——产品自己写下的默认值「课堂录音 / 图片材料 / 微信随手记 / 正片…」+ 纯时间 / ID / URL；服务端重命名、lessonAdapter、course-context、db/sessions、share、问同学书桌六处共用，之前各自维护名单导致 152 条「课堂录音」永远不被回填） |
| `db/` | 12 | IndexedDB (Dexie) Schema + CRUD |
| `ai-native/` | 8 | 应用插件系统（测验/闪卡/思维导图…） |
| `longcut/` | 6 | 转录处理算法（句子合并/引用匹配/主题提取） |
| `capture/` | 3 | 收集逻辑（类型识别/录音追加/视频会话） |
| `context-reach/` | 2 | 输入内容智能分流（URL→管线路由） |
| `config/` | 2 | 统一配置中心（环境变量映射） |
| `tutor/` | 3 | Tutor Agent 工具与语音同桌纯业务 helper |

## 根级文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `logger.ts` | ~50 | 统一日志工具（替代 console.log） |
| `server-failover.ts` | ~60 | 服务端 failover（主/备服务器切换） |
| `ui/copy.ts` | ~200 | 用户面文案唯一真相源 |
| `ui/user-facing-jargon-guard.test.ts` | — | 高频 UI 用户面黑话护栏 |

## 依赖方向

```
services → utils, db, config, longcut, capture, context-reach
             ↑ 不可反向
```

详见各子目录的 DOMAIN.md。
