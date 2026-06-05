# `src/app/share/` — Domain

Public SharedAgent landing routes.

## Route

`/share/[token]`

Visitors can open a shared lesson without logging in. Logged-in visitors can claim the share into their own workspace and continue the conversation in shared mode.

## Flow

1. `SharedAgentLanding` fetches `GET /api/share/[token]`.
2. The page renders the shared lesson title, transcript digest, artifact preview, and optional shared chat.
3. Claiming calls `POST /api/share/[token]/claim`.
4. Re-sharing from the landing page copies the current public URL directly.

## Files

| File | Responsibility |
|---|---|
| `[token]/page.tsx` | Next.js route shell. |
| `[token]/SharedAgentLanding.tsx` | Public landing UI. |
| `[token]/SharedAgentChat.tsx` | Shared-mode tutor chat. |

## Boundaries

- Share creation is handled by `src/components/share/useShareAgentCreator.tsx`.
- Business rules live in `src/lib/services/share-agent-service.ts`.
- API contracts live in `src/app/api/share/`.
