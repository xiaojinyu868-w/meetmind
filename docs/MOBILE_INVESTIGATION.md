# 手机端调查报告

## 1. 全景速览

MeetMind 手机端已有基础组件框架（18个组件），但**架构分裂严重、功能不完整、缺乏原生设计**。手机端大量逻辑散落在主页面的条件渲染（isMobile ? ...）中，组件复用度低。核心问题：`compactMode` 强制 batch 转写模式阻止流式 ASR；review 模式缺乏原生优化；应用矩阵卡片在小屏幕未适配；安全区域支持不完整。**演示和日常使用都会遇到明显卡顿和功能缺失**。

---

## 2. 手机端组件与入口（关键文件清单）

### 手机端组件概览（src/components/mobile/）

| 组件 | 文件 | 职责 | 状态 |
|------|------|------|------|
| **MobileLayout** | MobileLayout.tsx | 移动端整体布局（主内容 + 底部面板 + 抽屉） | ✅ 完整 |
| **MobileTopBar** | MobileTopBar.tsx:L30 | Review 模式顶部导航（课堂/收集/复习 tab） | ✅ 完整 |
| **MobileRecordTopBar** | MobileRecordTopBar.tsx:L23 | 收集模式顶部条（菜单/tab/历史） | ✅ 完整 |
| **MiniPlayer** | MiniPlayer.tsx:L31 | 迷你音频播放器（进度条 + 困惑点标记） | ⚠️ 部分完整 |
| **DedaoTimeline** | DedaoTimeline.tsx | 得到风格实时转写时间线（可横滑编辑） | ✅ 完整 |
| **DedaoConfusionCard** | DedaoConfusionCard.tsx | 得到风格困惑点卡片（显示/编辑备注） | ✅ 完整 |
| **DedaoMenu** | DedaoMenu.tsx:L12 | 得到风格菜单（任务/应用/AI 导航） | ✅ 完整 |
| **MobileAIChatPanel** | MobileAIChatPanel.tsx:L57 | AI 聊天面板（含文字同桌 + 语音同桌） | ✅ 完整 |
| **MobileCollectionSheet** | MobileCollectionSheet.tsx | 收集页底部面板（Echo/历史/更多） | ✅ 完整 |
| **BottomPanel** | BottomPanel.tsx | 可拖拽底部面板（用于时间线/困惑点） | ⚠️ 需调整 |
| **MenuDrawer** | MenuDrawer.tsx | 侧边菜单抽屉 | ⚠️ 可用性差 |
| **MobileAIFab** | MobileAIFab.tsx | 浮动按钮（快速打开 AI） | ⚠️ 设计过时 |

### 入口逻辑

- **主入口**：`src/app/(main)/app/page.tsx:L153+` 
  - 判断手机端：`useResponsive()` 检测 `window.innerWidth < 768px`（L332）
  - 强制手机预览：URL 参数 `?mobile=1`（L2281）
  - **分支决策**：`isMobile ? <MobileUI> : <DesktopUI>`（贯穿 L1717-L2200）

- **三大视图模式分支**：
  1. `viewMode === 'classroom'`（L1717-L1820）：ClassroomView（课堂录课）
  2. `viewMode === 'record'`（L1821-L1843）：renderCollectionFeed（收集页）
  3. `viewMode === 'review'`（L1844+）：时间线 + 转写 + AI 聊天

- **手机端子页面**（mobileSubPage）：
  - `null`：主内容区（时间线 + 转写）
  - `'ai-chat'`：AI 聊天面板（L2046）
  - `'ai-call'`：实时语音同桌
  - `'apps'`：应用矩阵（L2136）
  - `'tasks'`：任务面板（L2155）

---

## 3. 关键功能可用性矩阵

| 功能 | 状态 | 证据 | 严重度 |
|---|---|---|---|
| **录音（classroom）** | ⚠️ 部分能用 | sr-only 挂载点（L1808），continuous=false，streaming 模式启用 | **高** |
| **录音（collect）** | ❌ 断裂 | compactMode=true 强制 batch（L1497），阻止流式 ASR（L130:page.tsx） | **严重** |
| **实时转写显示** | ✅ 可用 | DedaoTimeline（L2001），segments 完整映射 | 低 |
| **困惑点标记 / 播放** | ✅ 可用 | MiniPlayer + markers（L1878），clickable anchors（L1888） | 低 |
| **应用矩阵** | ⚠️ 可打开 | renderSharedWorkspacePanel('apps')（L2149），但卡片排版未做小屏适配 | **中** |
| **AI 聊天** | ✅ 可用 | MobileAIChatPanel（L2048），SafeAITutor 内核 | 低 |
| **语音同桌** | ✅ 可用 | RealtimeTutorPanel（mobileSubPage='ai-call'，L2124） | 低 |
| **复习页** | ⚠️ 断裂 | 手机端无 DesktopVideoReviewLayout 对标物；仅有时间线 + MiniPlayer | **高** |
| **视频复习** | ⚠️ 断裂 | VideoReviewPlayer 仅在 mobileSubPage===null 且 videoSource 时显示（L1935），小屏不适配 | **中** |
| **Safe-area** | ⚠️ 部分支持 | 部分组件有 `pb-[max(env(safe-area-inset-bottom),12px)]`（MobileRecordTopBar），但不完整 | **中** |

### 核心问题追踪

#### 问题 1：录音段裂 —— Batch vs Streaming（P0 - 阻塞演示）

**位置**：`src/app/(main)/app/page.tsx:L1497 + src/components/Recorder.tsx:L130`

```
// 收集页的 Recorder：
<Recorder compactMode={true} />  // ← 强制 batch 模式

// Recorder.tsx L130：
const effectiveTranscribeMode = compactMode ? 'batch' : transcribeMode;
// 即使 transcribeMode='streaming'，compactMode=true 也会被覆盖为 'batch'
```

**后果**：
- 用户点"录课"→ 录音完全无实时转写反馈
- 必须等整个录音结束才能看到转写结果（可能 10-30 秒延迟）
- 用户不知道录音是否真的在进行

**对比**：课堂视图（L1808）的 Recorder 没有 compactMode，能正常流式转写。

---

#### 问题 2：Review 模式手机端缺设计

**位置**：`src/app/(main)/app/page.tsx:L1844-L2200`（手机端 review 渲染）

手机端 review 是【时间线 + MiniPlayer + 困惑卡】的组合，**完全没有**：
- 逐句编辑转写
- 词汇提取视图
- 视频洞察时间线
- 行动项目管理
- 实时教师对接（只有 ai-call 才有，但隐藏在子页面）

对比桌面端（DesktopVideoReviewLayout），手机端是**阉割版**。

---

#### 问题 3：应用矩阵卡片排版崩坏

**位置**：`src/app/(main)/app/page.tsx:L2149`

```tsx
{mobileSubPage === 'apps' && (
  <div className="flex min-h-0 flex-1 flex-col bg-white">
    <div className="flex items-center gap-3 border-b border-divider px-4 py-3">
      {/* 返回按钮 + 标题 */}
    </div>
    <div className="flex-1 min-h-0 overflow-hidden">
      {renderSharedWorkspacePanel('apps')}  // ← 直接用 desktop 组件，无适配
    </div>
  </div>
)}
```

SharedWorkspacePanel 原设计是 **desktop 宽屏**，卡片间距、字号、按钮大小都超大。在手机屏幕（375px）上：
- 卡片宽度 > 屏幕宽度，必须左右滚
- 按钮 > 可点击区域，坑爹
- 文字无截断，溢出

---

#### 问题 4：Safe-area 支持不完整

**支持情况**：
- ✅ MobileRecordTopBar（L23）、MobileTopBar（L30）、MobileCollectionSheet（L98）：有 safe-area-inset-top
- ✅ 大多底部组件：有 safe-area-inset-bottom
- ❌ **缺失**：左右 safe-area（iPhone 14 Pro 的动态岛）、某些中间层组件

**viewport 配置**（src/app/layout.tsx:L35-L44）：
```ts
export const viewport: Viewport = {
  viewportFit: 'cover',  // ← 正确（允许内容延伸到安全区外）
  // 但大量子组件没有用好 safe-area-inset-*
};
```

---

## 4. 与电脑端的对齐缺口

### 功能缺失清单

| 功能 | 桌面端 | 手机端 | 差距 |
|---|---|---|---|
| 逐句编辑转写 | ✅ TranscriptFlowView | ❌ 无 | **严重** |
| 困惑点编辑 | ✅ 多行弹窗 | ⚠️ 卡片式，字号小 | 中 |
| 词汇提取 | ✅ WordExplainer 气泡 | ❌ 无 | **严重** |
| 视频洞察 | ✅ VideoInsightTimeline | ❌ 无 | **严重** |
| 行动项列表 | ✅ ActionList（可勾选） | ❌ 无 | **中** |
| 实时教师 | ✅ 嵌入桌面端 review | ⚠️ 单独子页面，需手动切 | 中 |
| 应用矩阵 | ✅ 适配 desktop | ❌ 卡片排版崩坏 | **中** |
| 复习笔记 | ✅ 侧边栏 | ❌ 无 | 低 |
| 分享 Echo | ✅ 菜单 + 分享卡 | ⚠️ 需进应用/更多菜单 | 中 |

### 最近代码变更但手机端未跟上

- ✅ **V3.0 SharedAgent**（src/app/share/、src/components/share/）：已能在 mobile 应用列表中打开，但**卡片排版未优化**
- ✅ **语音同桌（RealtimeTutorPanel）**：已支持手机端，但隐藏在 mobileSubPage='ai-call' 二级菜单
- ❌ **ClassCheckOverlay / ClassCheckToast**：仅在 desktop review 中激活，手机 review 无
- ❌ **LearnerOnboarding**：已 dynamic import，但手机端未走过一遍完整流程

---

## 5. 架构健康度评估

### **总体评分：3/10（严重问题）**

#### 5.1 "原生设计"还是"缩放桌面端"？

**现状**：**两者混合，但以缩放为主**

- ✅ MobileTopBar / MobileRecordTopBar：设计专用（safe-area、紧凑布局）
- ⚠️ MiniPlayer / DedaoTimeline：半原生（响应式，但逻辑仍从桌面抄）
- ❌ 应用矩阵 / AI 聊天面板内部卡片：完全是桌面版缩小（间距、字号未调）

**结论**：**不是真正的移动原生体验**，只是"大屏上隐藏/缩小"。

---

#### 5.2 手机端逻辑是否散落在 God File？

**位置追踪**：`src/app/(main)/app/page.tsx`

```
总代码行数：~2400 行
手机相关条件渲染：L1264-L2200（~900 行）
  ├─ viewMode 分支（L1717-L1820）：200 行
  ├─ review 模式手机渲染（L1844-L2200）：350 行
  ├─ mobileSubPage 条件渲染（L2046-L2160）：100 行
手机端 store 订阅：L182, L269-L279
手机端事件处理：分散在各个 handleXxx 函数中（>200 行）
```

**结论**：**严重散落。移动端业务逻辑的 50% 都在 page.tsx 里，没有提取到专用容器组件**。

---

#### 5.3 状态管理

**手机端有独立 store**：`useMobileAIStore`（L269-L291）
```ts
├─ mobileAIQuestion / mobileAIDisplayQuestion
├─ mobileAILaunchImages / mobileAILaunchSupportContextText
├─ mobileAIQuestionNonce / mobileAIConsumedQuestionNonce
└─ mobileAILaunchTarget（'mobile-ai-chat' 或其他）
```

**但**：
- ❌ mobileSubPage、showMobileRecorder 等 UI 状态仍在通用 ui-store（L182, L188）
- ❌ 没有专用的"手机端 session 管理" store，recording state 仍全局混用
- ❌ 手机端的"收集页"和"review 页"共用同一个 capture-editor-store，导致状态混污

**结论**：**状态管理不完整，手机端应该有独立的 MobilePageStore 来隔离 UI 状态**。

---

#### 5.4 移动端基础工程

| 需求 | 支持 | 证据 |
|------|------|------|
| **Viewport** | ✅ 部分 | L41：viewportFit='cover'；但缺少 viewport-fit 媒体查询 |
| **Safe-area** | ⚠️ 部分 | 大多顶部/底部组件有，但不完整（缺左右）|
| **Touch-target** | ❌ 无 | 按钮大小 h-8/w-8（32px），低于 iOS 44px 推荐 |
| **Momentum-scroll** | ⚠️ 部分 | MobileCollectionSheet 有 `WebkitOverflowScrolling: 'touch'`（L1252），但仅局部 |
| **Keyboard 避让** | ❌ 无 | 输入框拉起软键盘时无上推动画；sheet 未设置 max-height |
| **双击缩放禁用** | ❌ 无 | viewport 里没有 `user-scalable: false`（当前 true） |

**结论**：**移动端基础工程不达标。缺少 touch 优化、键盘处理、性能监测**。

---

## 6. 用户立即可感知的痛点（按严重度排序）

### **P0 - 完全不能用（演示 Game Over）**

1. **"录课"按钮点击无反馈** 
   - 点击后看不到录音计时、音量等级，无法确认是否在录
   - 根本原因：compactMode=true 阻止 streaming ASR，隐藏了 Recorder 的 UI
   - **影响**：用户怀疑是否真的录上了，重复点击或放弃

2. **收集页面崩坏的应用矩阵**
   - 打开"学习应用" → 卡片宽度超出屏幕，无法交互
   - 根本原因：SharedWorkspacePanel 设计仅考虑桌面端
   - **影响**：完全无法访问 AI 应用矩阵功能

### **P1 - 显著体验差（日常使用痛点）**

3. **时间线编辑按钮太小**
   - DedaoTimeline 的"编辑" icon（18px）难以点击，需多次尝试
   - 解决：至少 44x44px touch target

4. **AI 聊天面板键盘弹起遮挡输入框**
   - 移动键盘把输入框遮到屏幕外，用户看不到自己在打什么
   - 根本原因：MobileAIChatPanel 没有设置 maxHeight，缺乏键盘避让逻辑
   - **影响**：打字体验极差，用户会放弃输入

5. **困惑点卡片在竖屏下文字溢出**
   - 长备注（>20 字）无法完整显示，被截断且无 tooltip
   - 影响：用户看不到完整信息

6. **实时转写区域字号太小**
   - DedaoTimeline 段落文字约 12-14px，长时间阅读眼疲劳
   - 建议：14-16px + 行高 1.6

### **P2 - 明显缺失（功能不完整）**

7. **无法编辑转写文本**
   - 手机端只能"看"，不能改。桌面端可以逐句编辑
   - 影响：ASR 错误无法纠正，只能在电脑上改

8. **无词汇提取**
   - WordExplainer（桌面端的气泡解释）在手机端不存在
   - 影响：词汇学习功能完全残废

9. **无行动项目管理**
   - 手机端看不到 action items 列表和完成度
   - 影响：复习流程不完整

10. **Safe-area 部分缺失**
    - 动态岛/刘海机型上，某些内容靠太近边缘
    - 特别是横屏使用（商务演示场景）时左右 safe-area 无效
    - 影响：屏幕边缘内容被裁剪

---

## 7. 给打磨规划的建议

### **第一阶段：停止流血（P0，3-5 天）**

#### P0.1：修复收集页录音（关键）
```
优先级：🔴 阻塞演示
任务：
1. src/app/(main)/app/page.tsx:L1497
   - 改 compactMode={false}
   - 增加 Recorder 的 UI 挂载点（进度条、计时、音量）
2. 确保 streaming mode 启用，ASR 实时反馈

测试：手机端"录课"→ 应看到实时转写计数、音量等级
预期时间：1 天
```

#### P0.2：修复应用矩阵排版（关键）
```
优先级：🔴 演示必须
任务：
1. src/app/(main)/app/page.tsx:L2136-L2154
   - 创建 MobileWorkshopYellowPage.tsx（复用 WorkshopYellowPage 逻辑，改排版）
   - 卡片改为：宽 100%、字号 13-14px、padding 压缩
   - 按钮改为 44x44px touch target
2. 或直接用 SingleColumnWorkshopLayout 的手机版

测试：打开应用 → 卡片能完整显示、按钮可点击
预期时间：1-2 天
```

### **第二阶段：补齐核心 UX（P1，5-7 天）

#### P1.1：键盘避让 + 输入框修复
```
任务：
1. MobileAIChatPanel 增加 useEffect 监听软键盘弹起
   - 在键盘弹起时自动 scroll 到输入框
   - 或使用 bottom 的 inset 动态调整
2. 用 ResizeObserver 监测 vh 变化（软键盘弹起会改变 100vh）

参考：src/components/AIChat.tsx:L469 已有 safe-area-inset-bottom
```

#### P1.2：Touch target 标准化
```
任务：
1. 扫描 src/components/mobile/*.tsx
2. 所有交互元素改为 h-10 w-10（40px）+ 根据需要微调
3. DedaoTimeline 的"编辑"按钮改为可点击的行本身（增大热区）

参考：src/components/mobile/MobileRecordTopBar.tsx:L25 用的 h-9 w-9 已偏小
```

#### P1.3：字号/行高标准化
```
任务：
1. DedaoTimeline 段落改为 text-base（16px）+ leading-relaxed
2. DedaoConfusionCard 改为 text-sm（14px）
3. 所有标题改为 text-lg（18px）

预期时间：1 天（改 tailwind classes）
```

### **第三阶段：功能补齐（P2，7-10 天）**

#### P2.1：转写编辑（中等优先）
```
任务：
1. 创建 MobileTranscriptEditView.tsx
   - 单个 segment 详情弹窗
   - 可编辑 textarea
   - 保存/取消按钮
2. 在 DedaoTimeline entry 上增加"编辑"菜单项
3. 调用 handleTranscriptTextUpdate (已有，L1909)

复杂度：中（逻辑存在，只需包装 UI）
预期时间：2 天
```

#### P2.2：词汇提取（低优先，影响复习体验）
```
任务：
1. 集成 WordExplainer 到 DedaoTimeline segment
   - 或创建 MobileWordExplainer（popup instead of bubble）
2. 长按单词 → 弹出 AI 解释

复杂度：中（需适配 touch 交互）
预期时间：2 天
```

#### P2.3：行动项列表（低优先）
```
任务：
1. 在 review 首页增加"待办"标签页（DedaoMenu 中已有框架）
2. 展示 actionItems，支持勾选完成
3. 调用现有 handleActionComplete

复杂度：低（逻辑完整）
预期时间：1-2 天
```

### **第四阶段：工程优化（P3，后续）**

- [ ] **提取手机端 UI 逻辑到 MobilePageContainer**（解耦 page.tsx）
- [ ] **创建 mobile-page-store**（隔离手机端 UI 状态）
- [ ] **补齐 safe-area 左右**（iPhone 14 Pro 支持）
- [ ] **Momentum-scroll 全覆盖**
- [ ] **性能监测**（LCP、FID、CLS）
- [ ] **暗黑模式**（可选）

---

## 8. 关键数据点速查

| 项目 | 值 | 位置 |
|------|-----|------|
| 手机端阈值 | <768px | src/hooks/useResponsive.ts:L17 |
| 主入口分支 | L1717-L2200 | src/app/(main)/app/page.tsx |
| 强制手机预览 | ?mobile=1 | L2281 |
| mobileSubPage 类型 | 'apps'\|'ai-chat'\|'ai-call'\|'tasks'\|null | L6 (types/page-types) |
| Recorder compactMode 问题 | L130 (Recorder.tsx) | 强制 batch，阻止 streaming |
| 应用矩阵问题 | L2149 | 无小屏适配 |
| Safe-area 配置 | L41 (layout.tsx) | viewportFit='cover' 正确 |

---

## 结论

**手机端现状**：有框架无内核，看起来完整但关键功能破碎。最严重的三个问题直接导致"无法演示"：

1. **收集页无录音反馈**（compactMode 问题）
2. **应用矩阵排版崩坏**（无小屏适配）
3. **AI 聊天键盘遮挡**（缺乏 UX 工程）

**建议**：先花 3-5 天过 P0（保证能演示），再用 5-7 天补 P1（可用性），再用一周补齐剩余功能。总计 2-3 周可以达到"真正可演示的手机端"。

