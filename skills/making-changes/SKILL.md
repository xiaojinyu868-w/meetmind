# Making Changes

> 本 skill 定义 agent 执行任何代码变更的标准流程。
> 目标：每次变更都是可验证的、可回滚的、可解释的。

## 触发条件

每次开始编写或修改代码时，自动遵循本流程。

## 流程：Plan → Execute → Document → Verify → Review → Commit

### 1. Plan（2 分钟规划）

在写任何代码之前：

```
变更目标：[一句话描述]
影响文件：[列出要修改的文件路径]
不动的文件：[明确哪些文件不能碰]
文档同步：[本次是否需要更新 AGENTS.md / DOMAIN.md / docs/* / .env.example，为什么]
验证方式：[怎么确认改对了]
回滚方式：[如果搞砸了怎么恢复]
```

**规则**：
- 每次变更只做一件事
- 如果计划涉及 >5 个文件，必须拆分为多次变更
- 如果涉及 `page.tsx`，先 `read_file` 确认上下文（前后 30 行）

### 2. Execute（精确修改）

**修改规则**：
- 用 `replace_in_file` 精确替换，绝不整文件重写
- 一次只改一个功能点
- 保持原有缩进和代码风格
- 新增代码必须有类型标注（TypeScript strict）

**文件大小检查**：
- 修改后文件是否超 500 行？如果是，考虑先提取再修改
- 是否引入了新的 `console.log`？用 `logger` 替代
- 是否使用了设计系统之外的颜色？检查 AGENTS.md §2

### 3. Document（同步事实来源）

代码改完、验证之前，必须检查文档是否需要同步。判断标准：

| 代码变化 | 必须同步 |
|---------|---------|
| 新增 / 删除 / 移动文件或改变目录职责 | 对应 `DOMAIN.md`；若是关键路径，再更新 `AGENTS.md` |
| 新增 API 字段、渲染契约、stream marker、工具调用契约 | 对应 `src/app/api/**/DOMAIN.md` + 相关 `docs/*` |
| 新增模型 provider、默认模型、API key、环境变量 | `src/lib/config/DOMAIN.md` + `.env.example` + `docs/TUTOR_AGENT.md` + `AGENTS.md` |
| 改 Tutor / ASR / AI-Native 主链路 | 对应 `DOMAIN.md` + `docs/TUTOR_AGENT.md` / `docs/ASR_PIPELINE.md` / `src/lib/ai-native/DOMAIN.md` |
| 改用户设置、用户面文案或偏好 key | 设置页相关说明 + `src/lib/utils/DOMAIN.md` / `src/lib/ui/copy.ts` |

没有单独的“更新文档命令”。执行方式是看 `git diff --name-only`，按上表补齐文档；验证方式仍然使用 Makefile 命令。

### 4. Verify（立即验证）

每次修改后：

```bash
make check                # 零类型错误（等价于项目约定的 tsc 检查）
```

如果修改了 UI：
- 检查是否违反设计系统（零渐变、零阴影、系统 token）
- 确认中文文案是可读的简体中文（无乱码）

如果修改了 API 路由或服务：
- 确认导出接口未变（或所有消费方已更新）

### 5. Review（提交前自审）

提交或声明完成前，按 `skills/code-review/SKILL.md` 自审：
- 目标是否完成，不多不少
- 文档是否和代码事实一致
- `make check` / 相关 `make eval-*` / 定向测试是否有新鲜输出
- 是否误改了不相关文件或泄露密钥

### 6. Commit（原子提交）

**提交格式**：
```
<domain>(<scope>): <description>

domain: capture | echo | tutor | import | auth | workspace | infra | docs
scope: 被修改的主要文件或模块
description: 用中文或英文，一句话说清楚改了什么
```

**示例**：
```
echo(card): 回声卡正文行高从 1.7 调整为 1.9
import(xiaoyuzhou): 小宇宙管线支持 165 分钟以上长音频
infra(logger): 创建统一日志工具替代 console.log
docs(agents): 更新架构边界和域划分说明
```

**规则**：
- 一个提交只做一件事（bisectable）
- 提交前 `make check` 必须通过
- 不要把不相关的改动塞进同一个提交

## 特殊场景

### 修改 page.tsx

这是约 2300 行的 God File。额外规则：
1. 改动前：`read_file` 确认目标区域的前后 30 行上下文
2. 改动中：只用 `replace_in_file`，绝不重写大段
3. 改动后：立即 `make check`
4. 如果修改自然产生了可提取的函数（≥50行），顺手提取到独立文件

### 修改 Echo 相关文件

必须对齐产品 taste：
- 安静、小、有根
- 设计系统：零渐变、零阴影、纯平涂
- 详见 AGENTS.md §2 设计系统

### 添加新功能

1. 先在 `skills/architecture-enforcement/SKILL.md` 中确认该功能属于哪个域
2. 文件放在正确的目录
3. 导出的类型放在 `src/types/` 中
4. 如果需要新 API 路由，路由只做请求转换，逻辑放 services/
5. 如果新增了独立功能目录，同时补充对应 `DOMAIN.md`
6. 如果新增功能改变了推荐阅读路径、关键文件列表、默认行为、配置项或公共契约，同时更新 `AGENTS.md` / 对应 `DOMAIN.md` / `docs/*` / `.env.example`

## 反模式（绝对不做）

- 在一个提交里改 10 个不相关的文件
- 不验证就提交
- 在 utils/ 里写业务逻辑
- 在 API 路由里直接操作数据库（必须经过 service 层）
- 添加 `console.log`（用 `@/lib/logger` 的 `createLogger`）
- 在组件里直接调用 fetch（通过 hooks/SWR）
