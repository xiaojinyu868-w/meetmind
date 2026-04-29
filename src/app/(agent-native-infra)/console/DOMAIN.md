# Console Routes

> 机构控制台路由。职责是聚合机构资产、线索、场景、知识库和 Agent OS 观测数据。

## 依赖规则

```
console pages -> components/console + components/academic + lib hooks + fetch/API
```

- 页面可以通过 `academicFetch` 调用 console API。
- 复杂展示逻辑应下沉到 `components/console/`。
- 不在页面里写业务服务逻辑。

## 文件索引

| 文件 | 职责 |
|------|------|
| `page.tsx` | 控制台首页，聚合核心入口和指标 |
| `agent-assets/page.tsx` | Agent OS 资产控制台：服务动作原子、skill、Arena、知识资产、运行证据 |
| `assets/page.tsx` | 机构资产列表 |
| `knowledge/page.tsx` | 知识库页面 |
| `leads/page.tsx` | 线索列表 |
| `leads/[id]/page.tsx` | 线索详情和对话 replay |
| `members/page.tsx` | 成员管理 |
| `onboarding/page.tsx` | 机构 onboarding |
| `playbook/page.tsx` | 服务 playbook 管理 |
| `scenarios/page.tsx` | 学生端 scenario 管理 |
| `settings/page.tsx` | 机构设置 |
| `skills/page.tsx` | Skill 上传/审核/管理 |
| `sources/page.tsx` | 资料源管理 |
