# `src/app/me/shares/` — Domain

Owner-facing management page for SharedAgent links.

## Purpose

After a user shares a lesson, they can review created links, copy them again, open the public landing page, and revoke shares.

## Files

| File | Responsibility |
|---|---|
| `page.tsx` | Route shell rendering `<MyShareList />`. |
| `MyShareList.tsx` | Client list that fetches `/api/share/me`, renders share rows, and supports open/copy/revoke actions. |

## Boundaries

- Share creation entry is `OctoCrystalDispatcher` + `useShareAgentCreator`.
- Business logic lives in `src/lib/services/share-agent-service.ts`.
- Public landing UI lives in `src/app/share/[token]/`.
