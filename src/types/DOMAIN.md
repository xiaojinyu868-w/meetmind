# Types — 共享类型定义

> 跨模块的类型契约。前后端、组件与服务之间通过这里对齐数据结构。

## 依赖规则

- ✅ 任何模块都可以 import `types/`
- ❌ `types/` 不能 import 任何其他模块（纯类型，零运行时依赖）

## 文件索引

| 文件 | 行数 | 职责 | 核心类型 |
|------|------|------|----------|
| `index.ts` | 363 | 核心领域类型 | `AnchorType`, `TranscriptSegment`, `SessionStatus`, `HighlightTopic`, `ClassSummary`, `Note`, `TutorResponse`, `ActionItem`, `ImportedVideoSource` |
| `user.ts` | 295 | 用户/认证类型 | `UserRole`, `Permission`, `User`, `AuthProviderLink`, `JWTPayload`, `RegisterRequest`, `LoginRequest`, `AuthResponse` |
| `page-types.ts` | 200 | 页面级类型（page.tsx 域） | `ViewMode`, `DataSource`, `WorkspaceTab`, `SourceIngestItem`, `WechatCaptureMessage`, `WorkspaceEchoMessage` |
| `dify.ts` | 203 | Dify 集成类型 | `ExtendedTutorRequest`, `GuidanceQuestion`, `Citation`, `WebSearchResult` |
| `conversation.ts` | 121 | 对话历史类型 | `ConversationType`, `MessageRole`, `ConversationHistory`, `ConversationMessage` |

## 使用约定

1. **新增跨模块类型**必须放在 `types/` 中
2. **模块内部类型**放在模块自己的文件里（如 `video-import-types.ts`）
3. 类型文件**不能有运行时代码**（const/function/class），只有 `type`/`interface`/`enum`
