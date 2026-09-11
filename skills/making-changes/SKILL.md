# Making Changes

> 本 skill 讲的是"在 MeetMind 里做一次变更时，什么是真的重要"。
> 它写给强模型：给你上下文、不变量和验证手段，不给步骤脚本。步骤由你判断。
> 目标不变：每次变更都可验证、可回滚、可解释；会话结束时工作树是干净的。

## 立场

你是这个仓库的资深同事，不是流程执行器。产品自己的信条是 **Less Structure, More
Intelligence**（`项目开发文档/提示词设计哲学.md`）——它对你同样成立：本文描述"要什么、
为什么"，"怎么做"留给你。下面凡是写成规则的，都附了理由；理由不成立的场合，你可以
偏离，把理由写进提交说明或文件头注即可。

## 开始前：把事情弄清楚，而不是填表

- 搞清"要什么、为什么"。用户的一句话请求往往藏着范围判断，不确定时按一个资深同事的
  常识做出选择并说明假设，不要为了确认而停下来（见 AGENTS.md §1）。
- `DOMAIN.md` 是地图，源码是真相。地图会过期（它由上一个 agent 写，未必同步），凡是
  要动的东西，读源码确认；读到地图与代码不一致，顺手把地图改对。
- 动一个符号之前用 grep 看谁在用它——类型系统会替你抓大部分，但字符串契约
  （stream marker / 事件名 / 偏好 key / COPY 键）它抓不到。
- 想清楚验证方式：哪条 `make` 命令、哪个 eval、哪条手工路径能证明改对了。

## 变更的规模

- 一个变更 = 一个可解释的意图。文件数不设上限：一次 30 个文件的一致性重命名是一个变更，
  两个不相干的修复是两个变更。
- 大变更拆成**可独立验证的提交**，而不是拆成多次对话。
- 不要为了规模规则中断任务。任务能一口气做完就做完，分提交是为了可读的历史，不是为了
  节省一次上下文。

## 编辑

- 精确替换还是整文件重写，按哪个更清楚来定：改 40 行文件里的三处，重写往往更干净；
  改 3000 行文件里的一处，必须精确。
- 保持文件原有风格与缩进；TypeScript strict 下通过；不要用 `any` 逃逸类型（真需要就写
  一行为什么）。
- 日志用 `src/lib/logger.ts`（pino），不要 `console.log`。
- 用户面字符串走 `src/lib/ui/copy.ts` 的 `COPY`——这是口吻审查的单一入口，不是形式主义。
- 文件超过 500 行（工具/类型 300 行）是**拆分信号，不是禁令**：内聚边界清楚就拆，
  不清楚就先做任务，在头注写一句为什么暂不拆。详见 `skills/architecture-enforcement/SKILL.md`。

## 文档同步（代码和文档一起交付）

判断标准只有一句：**下一个 agent 读旧文档会不会被误导？** 会，就改文档；不会，就不用碰。

| 代码变化 | 通常要同步 |
|---------|-----------|
| 新增 / 删除 / 移动文件，或目录职责变了 | 对应 `DOMAIN.md`；关键路径再动 `AGENTS.md` §3/§4 |
| 新增 API 字段、渲染契约、stream marker、事件名、工具调用契约 | `src/app/api/**/DOMAIN.md` + 相关 `docs/*` |
| 新增模型 provider、默认模型、API key、环境变量 | `src/lib/config/DOMAIN.md` + `.env.example`（+ `docs/TUTOR_AGENT.md` 若涉 Tutor） |
| 改 Tutor / ASR / teach / fenshen / 记忆 主链路 | 对应 `DOMAIN.md` + 对应 `docs/*` |
| 改用户设置、偏好 key、用户面文案 | 设置页说明 + `src/lib/utils/DOMAIN.md` / `copy.ts` |
| 交付一个里程碑 | `CHANGELOG.md` 一条（每条可追到 commit） |

写 `DOMAIN.md` 时记录**不变量与理由**（"为什么这样设计、什么不能破"），不记录步骤脚本，
不写行数这类一周就过期的数字。

## 验证（与改动成比例）

- 改了任何 `.ts/.tsx`：`make check`（增量 tsc，十几秒）。
- 改到哪条链路，跑哪条门禁：ASR → `make eval-asr`；Tutor prompt/工具 → `make eval-tutor`；
  teach-engine / teach-skills / teach prompt → `make eval-teach`；改 prompt/smoothStream/
  provider 后 `make ttft`。文档-only 改动不跑 eval。
- 有单测覆盖的模块跑定向 `npx vitest run <path>`；契约变更（事件名、marker、schema）
  跑 `make test`。
- UI 改动对齐 `docs/DESIGN_SYSTEM.md`（v7：双签名色、token、克制投影——**不是**"零阴影"）
  与 `docs/PRODUCT_TASTE.md` 的原则层；中文文案可读。
- 生产环境上验证（本仓库常直接跑在服务器上）：`curl localhost:3002/api/health`，
  pino 日志在 `/root/.pm2/logs/`。

## 提交与推送

历史是给下一个人读的：

- 格式沿用仓库实践（conventional commits，中文说明）：
  `feat|fix|refactor|docs|chore|perf|test(scope): 一句话说清改了什么`，scope 自由
  （teach / fenshen / asr / desktop / memory / blackboard …）。正文写**为什么**与不显然的取舍。
- 原子提交（可 bisect）；提交前 `make check` 绿；不把不相关改动塞进一个提交。
- **默认行为**：在当前特性分支上提交，并推送到同名远端分支。这是把工作变成事实的动作，
  不需要每次请示——2026-09 曾有整整一周、一万六千行的工作只活在一台机器的工作树里。
- **需要明确指令才做**：推送或合并到 `main`、force-push、改写已推送历史、删除远端分支、
  开 PR 合并。
- 会话结束前工作树必须干净；确实不能提交的部分，在最终汇报里写明是什么、为什么。
- **多人并行（2026-09-11 起，`docs/RELEASE_FLOW.md`）**：一个会话一个 worktree 一个分支。只 `git add <路径>` /
  `git commit -- <路径>`，禁 `git add -A`、`commit -a`、`git stash`——共享机器上另一个会话的改动可能已暂存在索引里，
  一次 `-A` 就把它带进你的提交（9-10 实际发生过三次）。不进别人的目录执行 git。上线 = 合进 `release/prod`
  再 `make deploy`（固定在 `/mnt/meetmind-prod` 构建），开发目录永远不是运行目录。

## 特殊场景

### God File：`src/app/(main)/app/page.tsx`

仍是几千行的主页面，按域分阶段提取中（`src/app/DOMAIN.md`）。在这里改动：读足够的上下文再改；
精确编辑；改完立即 `make check`；如果改动自然形成了 ≥50 行的独立模块就顺手提取到 hooks/组件。
**不要企图一次拆完**——那是独立任务。

### 用户可见的东西

任何用户面改动先过 `docs/PRODUCT_TASTE.md` 的五问（更容易收集？更原件优先？更少打扰？
更像发消息？更容易长出复习和 Tutor？）。视觉细节以 `docs/DESIGN_SYSTEM.md` 当前版为准，
它是皮肤层，可以提出更好的方案——去 `design-demo/` 建 showcase，而不是绕开它散写样式。

### 添加新功能

1. 先确认属于哪个域、放哪个目录（`skills/architecture-enforcement/SKILL.md` 域表）。
2. API 路由只做请求转换，逻辑在 `lib/services/`；共享类型放 `src/types/`。
3. 新目录承担独立职责就补 `DOMAIN.md`；改变了默认行为、配置项、公共契约或阅读路径，
   同步 `AGENTS.md` / `docs/*` / `.env.example`。

## 反模式

- 声称完成但没有任何新鲜的验证输出
- 在 `utils/` 写业务逻辑；在 API 路由里写业务逻辑或直接操作数据库
- 组件直接 `fetch` 或 import services（走 hooks / props）
- `console.log`
- 把不相关的改动塞进一个提交；或反过来，为了"一次只做一件事"把一个内聚变更硬拆成碎片
- 为了行数机械拆文件，拆出漏抽象
- 为了走流程停下来问用户一个自己能判断的问题
- 只读 `DOMAIN.md` 不读源码就动手
