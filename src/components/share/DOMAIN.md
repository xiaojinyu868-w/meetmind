# `src/components/share/` — Domain

SharedAgent client UI for creating and rendering share links.

## Files

| File | Responsibility |
|---|---|
| `useShareAgentCreator.tsx` | Creates a SharedAgent, copies the public link automatically, and only shows a lightweight manual-copy fallback when clipboard write fails. |
| `ShareArtifactAction.tsx` | Contextual share action rendered beside a completed artifact in matrix cards, desktop result headers, course cheatsheets, and mobile result pages. |
| `share-artifact-model.ts` | Pure privacy boundary and snapshot builder for the four scene-level shareable artifacts. |
| `ArtifactRender.tsx` | Read-only artifact preview for the public `/share/[token]` landing page. |

## Product Rule

Sharing is link-first. Do not reintroduce generated share images, save-image actions, or a multi-action share modal for SharedAgent creation.

Sharing is also object-local: the action must sit beside the completed artifact. Do not move it into a separate bottom-of-page ceremony or require users to return to the matrix to find it. Flashcards and audio overview remain private/non-shareable here; only cheatsheet, mindmap, quiz, and infographic produce SharedAgent snapshots.

## Boundaries

- Share creation business logic lives in `src/lib/services/share-agent-service.ts`.
- Public landing page UI lives in `src/app/share/[token]/`.
- Share management lives in `src/app/me/shares/`.
