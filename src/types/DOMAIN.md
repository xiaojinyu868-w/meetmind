# Types — 共享类型定义

> 跨模块的类型契约。前后端、组件与服务之间通过这里对齐数据结构。

## 依赖规则

- ✅ 任何模块都可以 import `types/`
- ❌ `types/` 不能 import 任何其他模块（纯类型，零运行时依赖）

## 文件索引

| 文件 | 行数 | 职责 | 核心类型 |
|------|------|------|----------|
| `index.ts` | ~410 | 核心领域类型 | `AnchorType`, `TranscriptSegment`, `SessionStatus`, `HighlightTopic`, `ClassSummary`, `FeedItem`（含外部内容类型、作者、出版时间与视角）, `Note`, `TutorResponse`, `ActionItem`, `ImportedVideoSource` |
| `user.ts` | ~360 | 用户/认证与学习上下文类型 | `UserRole`, `Permission`, `User`, `LearnerProfile`（含 `stage='unknown'`）、`LearningMemoryEntry`（用户确认的长期记忆）、`LearningActivityEntry`（近期学习现场）、`LearningThreadEntry`（可恢复的深度学习线索） |
| `page-types.ts` | 200 | 页面级类型（page.tsx 域） | `ViewMode`, `DataSource`, `WorkspaceTab`（含 `transcript`）, `SourceIngestItem`（含照片锚点与 `provenance` 来源契约）, `SourceProvenance`, `WechatCaptureMessage`, `WorkspaceEchoMessage` |
| `dify.ts` | 203 | Dify 集成类型 | `ExtendedTutorRequest`, `GuidanceQuestion`, `Citation`, `WebSearchResult` |
| `conversation.ts` | 121 | 对话历史类型 | `ConversationType`, `MessageRole`, `ConversationHistory`, `ConversationMessage` |
| `classroom-flow.ts` | ~35 | 课中课堂脉络契约 | `ClassroomFlowState`, `ClassroomMoment`, `ClassroomSignal` |
| `learning-intent.ts` | ~20 | 深度学习开始前的可编辑意图契约 | `LearningIntentPlan`, `LearningIntentApproach`, `LearningContextFocus` |

## 使用约定

1. **新增跨模块类型**必须放在 `types/` 中
2. **模块内部类型**放在模块自己的文件里（如 `video-import-types.ts`）
3. 类型文件**不能有运行时代码**（const/function/class），只有 `type`/`interface`/`enum`

`LearnerProfile.stage='unknown'` 仅用于用户已经通过对话确认 bio/goals、但尚未主动填写结构化学习档案的场景。此时不得猜测用户是大学生、在职或具体年级；Tutor 直接使用已确认的自然语言画像。

`LearnerProfile.memories` 与 `recentLearningActivities` 必须分开：应用点击、闪卡/测验结果和模型推断只能先写近期活动；只有用户明确确认的内容才能成为长期记忆。暂停的记忆保留给用户查看，但不得注入 Tutor 上下文。
