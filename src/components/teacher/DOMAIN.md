# Teacher — 教师端组件

> 教师视角的课堂数据展示。

## 文件索引

| 文件 | 职责 |
|------|------|
| `TeacherDashboard.tsx` | 教师仪表盘主面板 |
| `ReflectionGenerator.tsx` | 课后反思生成器 |
| `ConfusionHotspotCard.tsx` | 困惑热点卡片 |

## ⚠️ 依赖违规

- `TeacherDashboard.tsx` 直接 import `classroom-data-service`，应改为通过 hook 中转
