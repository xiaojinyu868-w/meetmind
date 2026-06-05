# `src/components/share/` — Domain

SharedAgent client UI for creating and rendering share links.

## Files

| File | Responsibility |
|---|---|
| `useShareAgentCreator.tsx` | Creates a SharedAgent, copies the public link automatically, and only shows a lightweight manual-copy fallback when clipboard write fails. |
| `OctoCrystalDispatcher.tsx` | App-matrix share entry: builds the snapshot from the generated artifact and calls `openCreator(snapshot)`. |
| `ArtifactRender.tsx` | Read-only artifact preview for the public `/share/[token]` landing page. |

## Product Rule

Sharing is link-first. Do not reintroduce generated share images, save-image actions, or a multi-action share modal for SharedAgent creation.

## Boundaries

- Share creation business logic lives in `src/lib/services/share-agent-service.ts`.
- Public landing page UI lives in `src/app/share/[token]/`.
- Share management lives in `src/app/me/shares/`.
