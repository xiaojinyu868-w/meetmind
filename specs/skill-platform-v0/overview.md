# Skill Platform v0

> **Status**: Agent Native Infra 子系统。2026-04-29 更新定位。
> Replaces deleted `specs/archive/product-focus.md` (F1-F5 / A1 feature list).
> Read first: `../agent-native-infra-spine.md`.

## Positioning

Skill Platform is not the product by itself. It is the **Skill Contract** subsystem of MeetMind Agent Native Infra.

Its job is to let institutions define scenario methodology, quality standards, examples, allowed service atoms, and failure modes. A skill should not become a fixed workflow. The runtime agent decides which tool atoms and UI actions to compose based on the current user state and trace.

## One-liner

MeetMind is a multi-tenant **skill-first** AI-agent platform for education consulting institutions. Every student-facing scenario (CV diagnosis, cold-email drafting, mock interview, advisor matching, program shortlisting, …) is a **scenario skill** — an OpenClaw/AgentSkills-shaped package that any LLM can author, institutions upload, MeetMind reviews and runs.

The product is **not** the scenarios. The product is:

1. **Meta-skill** that defines the contract → `platform-skills/meetmind-scenario-author/SKILL.md`
2. **Block renderer** that turns agent output into interactive UI
3. **Tool panel** that gives skills their capabilities (web search, file parsing, profile I/O, voice call)
4. **Profile schema** that lets skill A's output become skill B's input
5. **Submission / review / hot-update** pipeline so institutions can onboard new skills (and request new tools) without platform code changes

## Why skill-first

- **Leverage**: we stop writing every scenario. Institutions + other coding agents (Claude Code, Cursor) produce skills using our meta-skill as the contract.
- **Defensibility**: our moat is the **platform** (blocks, tools, profile, review, hot-update), not the scenarios. Scenarios are content; content is replaceable, platform isn't.
- **Multi-industry**: the same platform runs 留学 / 考研 / career coaching / language schools — each vertical is just a different skill pack + rubric.
- **Institution stickiness**: institution's rubric + sample library + case history lives inside their skills, in their workspace. Switching cost grows with every skill and every student session.

## Architecture

```
Student browser
  │
  │ chat UI (assistant-ui thread + block renderer)
  │
  ▼
MeetMind Next.js  ── multi-tenant (orgId row-level)
  │
  │ proxies chat turns + tool calls
  │
  ▼
OpenClaw agent gateway (one workspace per institution)
  │
  │ loads skills dynamically, runs agent loop
  │
  ▼
Qwen 3.6 Plus  (LLM)
```

**Runtime path**: student message → MeetMind → OpenClaw → Qwen → OpenClaw (agent decides: tool? block? prose?) → response → MeetMind parses fenced blocks / routes tool calls → student sees UI.

**Authoring path**: author (us / institution / other agent) reads `meetmind-scenario-author` SKILL.md → writes new scenario skill → `package.sh` validates + zips → uploads via `/console/skills` → MeetMind reviewer approves → synced into that institution's OpenClaw workspace → live.

**Tool hot-update**: if a submitted skill declares a tool we don't have (via `references/dependencies.md`), reviewer evaluates → if approved, platform adds the tool to the gateway → skill auto-activates.

## Milestones

- **S1** [in progress] Write `meetmind-scenario-author` (meta-skill). **This is the artifact we can hand to any coding agent today to start producing scenario skills.**
- **S2** Platform: skill import + review + sync to OpenClaw workspace.
- **S3** Platform: block renderer + assistant-ui thread (student UI).
- **S4** Platform: tool panel gateway (web-search / parse-file / read-profile / write-profile / voice-call).
- **S5** Validation: produce 1 real scenario skill (cold-email-draft) using the meta-skill in another coding agent, import, run end-to-end.

S1 proves the contract. S2-S4 build the runtime. S5 proves the contract is authorable by non-us agents — which is the whole thesis.

## What's in `platform-skills/`

```
platform-skills/
├── meetmind-scenario-author/      ← the meta-skill
│   ├── SKILL.md                   ← contract entry point
│   ├── references/                ← loaded on-demand by the authoring agent
│   │   ├── block-catalog.md       ← 7 block types + JSON schemas
│   │   ├── tool-panel.md          ← 5 tools + invocation protocol
│   │   ├── student-profile.md     ← cross-skill profile schema
│   │   ├── authoring-flow.md      ← 7-step flow + worked example
│   │   └── review-checklist.md    ← 18-item pre-submission checklist
│   └── assets/
│       └── skill-template/        ← copy-me starter
│           ├── SKILL.md
│           ├── references/playbook.md
│           ├── validate.mjs       ← schema + structure linter
│           └── package.sh         ← validate + zip to .skill
└── scenarios/                     ← concrete scenario skills live here (empty for now)
```

## What this supersedes

- Deleted `specs/archive/product-focus.md` — the F1-F5 / A1 feature plan. All of those scenarios are still valuable, but they're now **skill inventory**, not **code**. F1 (CV diagnosis) = `scenarios/cv-diagnose/`. F2 (advisor radar) = `scenarios/advisor-radar/`. And so on. Writing them is S5-onwards work, using the meta-skill.

## What's explicitly not in scope for v0

- Community skill marketplace (we review every submission manually; no self-serve publish).
- Skill versioning UI (institutions ship new versions by re-uploading; we keep history server-side).
- Automated skill quality scoring (evaluation pipeline is S6+).
- Cross-institution skill sharing (each institution's skills stay in their workspace).
- Long-term memory / standing-order weekly reports (still a future OpenClaw use case, not platform v0).

## Open decisions

- **Review UI depth**: for v0 we plan a minimal `/console/skills` upload page + reviewer CLI. Full-fledged review UI (diff view, inline comments, sandbox preview) is post-v0.
- **Skill auth**: currently any org admin can upload to their own workspace. Institution-level roles (author vs admin) deferred.
- **Voice tool cost model**: voice-call is 30× other tools' tokens. Per-org budget/throttle policy TBD in S4.
