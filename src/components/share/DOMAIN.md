# `src/components/share/` — Domain

SharedAgent client UI for creating and rendering share links.

## Files

| File | Responsibility |
|---|---|
| `useShareAgentCreator.tsx` | Creates a SharedAgent, copies the public link automatically, and only shows a lightweight manual-copy fallback when clipboard write fails. |
| `ShareArtifactAction.tsx` | Contextual share action rendered beside a completed artifact in matrix cards, desktop result headers, course cheatsheets, and mobile result pages. |
| `share-artifact-model.ts` | Pure privacy boundary and snapshot builder for the four scene-level shareable artifacts. |
| `ArtifactRender.tsx` | Read-only artifact preview for the public `/share/[token]` landing page. |
| `ShareMindmapGraph.tsx` | 分享页静态思维导图：复用 MindmapWindow 的 `mindmap-layout` 引擎与视觉语言（全展开、只读、viewBox 适配容器宽度），第一眼就是整张图，不再是文字大纲。 |

## Product Rule

Sharing is link-first. Do not reintroduce generated share images, save-image actions, or a multi-action share modal for SharedAgent creation.

Sharing is also object-local: the action must sit beside the completed artifact. Do not move it into a separate bottom-of-page ceremony or require users to return to the matrix to find it. Flashcards and audio overview remain private/non-shareable here; only cheatsheet, mindmap, quiz, and infographic produce SharedAgent snapshots.

## Boundaries

- Share creation business logic lives in `src/lib/services/share-agent-service.ts`.
- Public landing page UI lives in `src/app/share/[token]/`.
- Share management lives in `src/app/me/shares/`.
