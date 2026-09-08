# Context 本地交付状态：可以进入服务器集成

2026-09-08。本地交付边界是：可运行、可检查的 M1 Context 底座与画像页面，以及可交给服务器 AI 的源码增量和执行提示词。完整 V1、生产上线和教育效果尚未完成。

## 已交付的变化

- 通用 HTTP/SDK/MCP/Skill 源码：受限应用共享授权空间的原始经历及模型理解；Hindsight 0.9.2 负责提取/归并/检索。
- 可靠接收和投递：幂等、租约、后台重试、暂停/恢复/忘记和上游 document/operation payload 清理。权限/来源检查不依赖模型判断。
- `/context` 从输入表单改为自动画像：最近来源带来的理解优先，首屏三条、其余展开；原始学习轨迹单独列出，完整原文在 modal dialog 查看。补充自述和授权位于次级展开区。没有虚构掌握率或知识图谱。
- 修复冷启动作答丢失：已有 token 在认证初始化期间的实际交互暂存，只有同一凭证验证成功才投递；游客或其他账户的交互不转移。真实浏览器验收通过延迟实际认证响应复现该问题。
- global Tutor 优先携带最近 active 经历，并明确晚于旧摘要的偏好更新优先。原始自述与验证过的表现保持区分。

## 证据与边界

| 项目 | 当前证据 |
|---|---|
| 类型 | make check 通过（最终交付阶段） |
| 服务测试 | make test-context：3文件、26项通过；真实隔离SQLite，上游为明确测试替身 |
| Tutor 回归 | make eval-tutor：26/28，与改动前一致；不是全部通过 |
| 构建 | make build 通过，新增 /context 与API在路由列表；原项目lint warnings仍在 |
| 完整真实合成旅程 | `out/context-live/context-live-de26ecab-46bc-4807-a81e-a35ab1cd110f/REPORT.md`：9项通过，完整SSE回答、实际worker/Hindsight、测验三次交互、画像来源、暂停/恢复/忘记及清理 |
| 最终画像 | `out/context-live/context-live-0b6f6b42-a7b0-4994-8052-b55887bc597f/` 的desktop/mobile/evidence截图；浏览器核验真实理解、原文一致、手机无横向溢出。系统终止了该轮进程，因此整轮不能标记passed |
| 空态与降级显示 | 上述最终目录的UI_STATES.json：真实暂停账户空态；降级为明确HTTP响应fixture，不冒充服务停机验收 |
| 最终账户清理 | 同目录RECOVERY.json：7条经历及上游清理确认后删除fixture |
| 性能 | 最新每mode单次抽样：goal15601ms、review984ms、in-class897ms；shared缺少分享fixture返回404。不是统计性能验收，global Context额外延迟未单独量化 |
| 静态检查 | git diff --check通过；make stats和make ledger已执行；全仓lint未通过，历史178条warning/0error不能当作通过 |

真实旅程仍使用合成学生。课堂内容通过正式内部HTTP观察入口进入，未测试录音采集。测验页面、交互、身份和事件接口真实，只有出题响应使用fixture。teach与真实测验生成尚未消费Context。

一次成功不能证明长期效果：de26…回答在纠正后使用天文信号/行星基准率，暂停后回到通用题目。但89bab…另一轮仍沿用旧羽毛球偏好，已记录失败；之后补充应用侧冲突使用规则，最终0b6…运行中纠正检查通过但进程中断，不能据此宣称稳定纠正已解决。

## 必须交给服务器继续做的部分

1. 合并服务器最新应用代码，隔离数据库验证schema增量，配置Web和独立worker，再接入teach和测验生成。不能直接用本地checkout覆盖服务器。
2. 当前画像是开放的有来源检索视图，不是永久完整画像。重复、旧偏好与新偏好并存仍可能出现；需继续利用上游能力完善纠正/变化呈现与任务选择。首屏折叠不改变存储上限。
3. 最近事件优先不等于持久纠正覆盖。后续无关事件、超预算原文或模型忽视更新，都可能削弱效果；当前Tutor没有自动打开超预算source工具。服务器提示词要求跨多次互动验证。
4. 控制针对原始来源；补充更新保存自述，不直接改写推断。旧画像迁移、主产品入口融合、浏览器离线持久化outbox仍待完成。
5. SDK/MCP/Skill未公开发布；OAuth、支付分账、流量和软件自进化未实现。生产Hindsight外置数据库、备份保留、限流Redis与监控另行规划。

## 故障恢复记录

- 旧3220…fixture曾被错误提前删除本地记录。之后已删除6个上游document，本次补删21个terminal operation；RECOVERY.json记录operations=0、recall=0。这个历史错误不隐瞒，也不当作正常清理通过。
- 1ba860…因SSH连接重置投递失败，原文已经forget但operation未出现，服务保守保持cleanup_unconfirmed。对这个精确合成bank人工确认documents=0、operations=0、document DELETE=404后，审计并推进清理阶段，正式恢复命令完成删除。通用系统不会自动将未知提交当作未提交；服务器必须保留人工核查路径，禁止直接删本地记录。
- 0b6…被系统终止后，worker重启和make cleanup-context-live完成剩余清理。该工具严格要求匹配的合成fixture报告和用户ID，不适用于真实用户批量删除。

## 接管材料

可直接给服务器AI的任务正文： [CONTEXT_SERVER_HANDOFF.md](./CONTEXT_SERVER_HANDOFF.md)。通过 `make context-handoff` 生成 `out/context-handoff/<时间>/`，含START_HERE、MANIFEST、tracked.patch和最终源码快照；所有复制文件验证SHA-256，补丁在临时index中检查可应用到基线。交付包不含秘密、数据库、node_modules或运行日志。

基线：5326eea30470055ac9e29a46305719c856ed3314。用户随后授权提交推送，Git交付分支为feat/context-m1-handoff；此前ZIP保留为提交前验收快照。未部署主应用。先在隔离checkout接收该分支，再与服务器最新版本合并；部署之前交付差异、数据库操作和回滚方案。
