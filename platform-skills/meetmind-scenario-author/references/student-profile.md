# Student Profile Schema · MeetMind Consult

> 跨 skill 的学生画像 schema。**所有 scenario skill 读写画像必须只用本清单里的字段**。
>
> 实现：`src/lib/services/consult-profile-service.ts` 的 `PROFILE_ALLOWED_KEYS`。
> 字段不在此清单的 writeProfile 会被自动挪到 `institution_tags.<原字段名>`，不会丢。

## 设计原则

1. **跨 skill 复用**：cold-email-draft 写的 `advisor_candidates`，advisor-radar 能直接读
2. **学生视角**：字段代表"关于这个学生的事实"，不代表"这次对话的事件"
3. **保守**：宁缺毋滥。不确定的事不写进来
4. **机构扩展**：`institution_tags` 是逃生舱，装机构特有但不通用的标签

## 字段清单

### 目标（学生想申什么）

| 字段 | 类型 | 示例 | 备注 |
|---|---|---|---|
| `target_country` | string (ISO 2) | `"US"` `"HK"` `"UK"` | |
| `target_region` | string | `"bay-area"` `"east-coast"` | 自由文本，建议小写短横 |
| `target_degree` | enum | `"phd"` `"master"` `"research-master"` `"mba"` `"bachelor"` | |
| `target_field` | string | `"NLP"` `"quant finance"` `"urban planning"` | 自由文本 |
| `target_start_term` | string | `"2026-fall"` `"2027-spring"` | |
| `target_schools` | string[] | `["CMU","Stanford"]` | 有序，第一个最偏好 |
| `target_programs` | object[] | 见下 | |

`target_programs` 数组单项结构：
```ts
{
  school: string;
  program: string;
  tier?: "reach" | "fit" | "safety";
  ddl?: string; // ISO date
  note?: string;
}
```

### 背景（学生是谁）

| 字段 | 类型 | 备注 |
|---|---|---|
| `cv` | object | 见下 |
| `gpa` | number | 1-4.0 或 0-100 自行协调 |
| `test_scores` | object | 见下 |

`cv` 结构：
```ts
{
  fileId?: string;       // 上传后 storage 里的文件 id
  text?: string;         // 纯文本解析结果（fileUpload 后 agent writeProfile 进来）
  structured?: {
    education?: { school: string; degree: string; gpa?: number; period: string }[];
    experience?: { org: string; role: string; period: string; bullets: string[] }[];
    skills?: string[];
    publications?: { title: string; venue: string; year: number; role: string }[];
  };
}
```

`test_scores`：
```ts
{
  toefl?: number;
  ielts?: number;
  gre?: { verbal: number; quant: number; writing: number };
  gmat?: number;
}
```

### 导师 / 项目侦察

```ts
advisor_candidates?: {
  name: string;
  school: string;
  field?: string;
  status?: "mentioned" | "exploring" | "shortlisted" | "rejected";
  starred?: boolean;         // 学生 star 过的
  why_match?: string;        // 一句话匹配理由
  recent_work?: { title: string; year: number; url?: string }[];
  last_refreshed?: string;   // ISO date
}[];
```

`advisor_candidates` 表示"学生和 agent 讨论过的导师对象"，不是天然的最终意向名单。
除非学生明确说"保留/重点考虑/加入短名单"，否则只写 `status: "mentioned"` 或 `"exploring"`，不要写
`starred: true`。后续 skill 读取时也要把 `mentioned` 当作上下文线索，而不是学生承诺。

### 定位 / 故事线

| 字段 | 类型 |
|---|---|
| `strengths` | string[] (3-5 条) |
| `weaknesses` | string[] (3-5 条) |
| `narrative_angle` | string（1-2 句话概括学生的"定位故事"） |
| `tone_preference` | enum `"formal"` `"warm"` `"academic"` `"confident"` |

### Session 产出（累积 artifacts）

```ts
artifacts?: {
  kind: "cold-email-draft" | "cv-diagnosis" | "program-shortlist" | "advisor-card" | "interview-feedback" | "application-plan" | "statement-draft" | "recommendation-plan";
  createdAt: string;
  sessionId: string;
  title: string;
  bodyRef?: string;   // opaque 指针
}[];
```

### 担忧 / 阻塞

| 字段 | 类型 | 示例 |
|---|---|---|
| `worries` | string[] | `["GPA 不够 3.5", "没有一作 paper"]` |

### 机构扩展

| 字段 | 类型 | 备注 |
|---|---|---|
| `institution_tags` | `Record<string, string \| number \| boolean>` | 机构私有标签，跨机构不共享 |

---

## 只读字段（writeProfile 会拒绝）

以下是平台管理的，你的 skill **不得写**：

- `studentId`
- `nickname` / `email` / `wechatId`（学生个人信息由平台管）
- `sessions_count` / `mock_interview_attempts` / `cold_emails_drafted`（平台计数器）

试图写会在 `rejectedKeys` 里返回。

---

## 扩展白名单的流程

想加新通用字段（比如 `internship_history`）：在你的 scenario skill 的 `references/dependencies.md`
加一段：

```markdown
## 申请新 profile 字段：`<field>`

- **类型**：`...`
- **用途**：...
- **为什么 institution_tags 不行**：<如果觉得这字段跨机构通用，说清理由>
```

审核员评估，通过后平台把它加到 `PROFILE_ALLOWED_KEYS`，你的 skill 自动可用。

没通过就用 `institution_tags.<你的字段名>`，一样能用，只是跨不出当前机构。

---

## 合并语义

`writeProfile({ patch: {...} })` 的合并规则：

| 原字段类型 | patch 字段类型 | 合并方式 |
|---|---|---|
| 对象 | 对象 | **浅合并**（同 key 覆盖，新 key 追加） |
| 数组 | 数组 | **deep merge 去重**（`JSON.stringify` 相同的元素只保留一个） |
| 标量 | 标量 | **覆盖** |

示例：
```
原画像: { advisor_candidates: [{name:"Liu", starred:true}] }
patch:  { advisor_candidates: [{name:"Chen", starred:false}] }
结果:   { advisor_candidates: [{name:"Liu", starred:true}, {name:"Chen", starred:false}] }
```

**不要在一个 patch 里同时改覆盖和追加**。如果你想**替换**一个数组（比如学生改了目标学校），
分两轮：先 writeProfile 一个空数组清掉，再 writeProfile 新数组。
