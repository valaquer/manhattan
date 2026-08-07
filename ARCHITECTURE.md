# Manhattan -- Architecture

Director/Actress/Cutter chat pipeline workbench. Standalone SvelteKit app at port 51770. Proves the 5-agent chat pipeline that powers the companion experience before porting to Prague. OPS owns the backend infrastructure, Hana's team owns the pipeline design.

---

## 1. Directory Structure

```
library/manhattan-app/                 # App codebase (git: valaquer/manhattan)
├── src/
│   ├── lib/
│   │   └── server/
│   │       ├── books.ts               # Book loader: reads wiki books + character sheets
│   │       ├── books.test.ts          # 20 tests
│   │       ├── engine.ts             # Pipeline orchestrator: 5 agents, retry, tokens
│   │       ├── engine.test.ts        # 20 tests
│   │       ├── merge.ts             # Merge/parse for pipeline data (zero framework deps)
│   │       ├── merge.test.ts        # 19 tests
│   │       ├── moderation.ts        # OpenAI Moderation API client (content classifier)
│   │       ├── db.ts                # SQLite: messages, pipeline_outputs, memory
│   │       └── openrouter.ts        # OpenRouter API client (callModel, streamModel)
│   └── routes/
│       ├── +layout.svelte            # Root layout
│       ├── +page.svelte              # Main UI -- chat interface, pipeline controls
│       ├── +page.ts                  # Client-side data loader
│       └── api/
│           ├── pipeline/+server.ts   # POST: runs full 5-agent pipeline
│           ├── turns/+server.ts      # GET: conversation history
│           ├── reset/+server.ts      # POST: reset conversation state (creates new session)
│           └── sessions/+server.ts  # GET: list all sessions with turn counts
├── data/
│   └── manhattan.db                  # SQLite database
├── vite.config.ts                    # Port 51770
└── package.json                      # SvelteKit 2 + better-sqlite3 + openai

library/wiki/Relationship Engine/      # Book + character content (NOT in app repo)
├── books/                            # 7 book files read by books.ts
└── characters/                       # 12 character sheets read by books.ts
```

---

## 2. Dependency Graph

```
pipeline/+server.ts
  → engine.ts (5-agent pipeline orchestrator)
    → books.ts → wiki files (filesystem read from library/wiki/Relationship Engine/)
    → moderation.ts → OpenAI Moderation API (content classifier, advisory)
    → db.ts → manhattan.db (SQLite)
    → openrouter.ts → OpenRouter API (external)
    → merge.ts (pure TypeScript, zero framework deps)

turns/+server.ts → db.ts (read conversation history)
reset/+server.ts → db.ts (create new session, preserve old data)
sessions/+server.ts → db.ts (list all sessions with turn counts)
```

### External Dependencies

```
OpenAI Moderation API
  Used by: moderation.ts for content classification (advisory input to Director)
  Auth: API key via Burt ($env/dynamic/private OPENAI_API_KEY)
  Graceful degradation: returns null on missing key or API failure; pipeline runs without flags

OpenRouter API
  Used by: openrouter.ts for model calls (callModel, streamModel)
  Auth: API key via Burt

Wiki book files (library/wiki/Relationship Engine/)
  Read by: books.ts at pipeline runtime
  Maintained by: Hana's team (Klara writes, Hana QAs)

Credential: OpenRouter API key
  Managed by: Burt
```

---

## 3. Data Flow

```
Boss or Hana triggers pipeline:
  → POST /api/pipeline { characterId, message }
  → engine.ts orchestrates 5-agent pipeline:
    1. books.ts loads character sheet + identity header from wiki files
    2. Director receives Cutter memory (ACCUMULATED MEMORY) + 5-turn sliding window (RECENT TURNS)
    3. Actress generates response using character personality
    4. Cutter refines and formats the response
    5. Each agent call → openrouter.ts → OpenRouter API
  → Pipeline output saved to SQLite (messages + pipeline_outputs)
  → Response streamed to client via ReadableStream
  → +page.svelte renders chat turn with pipeline metadata

Conversation history:
  → GET /api/turns
  → db.ts reads from messages table
  → Returns chronological turn history
```

---

## 4. Blast Radius Map

### books.ts
Touches: engine.ts only (imported). Reads 7 wiki books and 12 character sheets from `library/wiki/Relationship Engine/`. Changes to book file paths or section parsing affect all pipeline runs. Character sheet format depends on exact `## CANON -- {field}` headers -- format mismatch fails silently (returns empty string).

### engine.ts
Touches: pipeline/+server.ts only. All chat turns flow through here. Changes affect every pipeline run. Director window defaults: 10 message rows (5 turns) for both Director-for-User and Director-for-Character. Actress window: 5 message rows (~2.5 turns). Configurable via `PipelineConfig.windows`.

### merge.ts
Touches: engine.ts only. Zero framework dependencies -- designed to port to Prague as pure TypeScript. Changes must maintain zero-dep constraint.

### openrouter.ts
Touches: engine.ts only. External API calls to OpenRouter. `callModel()` returns `{ content, usage }` with token counts. `streamModelBuffered()` captures usage from SSE stream. Changes affect model selection, retry behavior, and cost recording.

### db.ts
Touches: pipeline (write), turns (read), reset (write), session browser (read). 3-table schema: messages, pipeline_outputs, memory. Sessions table tracks conversation runs. No data deletion -- reset creates a new session, old data preserved. Retry uses attempt column (pipeline_outputs, memory) and superseded flag (memory) to preserve original outputs while updating to new takes.

### Wiki book files (external)
Touches: books.ts reads at runtime. Hana's team maintains. Changes to book structure or character sheet headers can break the pipeline silently.

---

## 5. Known Issues

### Keyboard navigation
CTRL+Left/Right navigates turns (calls goBack/goForward). CTRL+Up/Down navigates sessions (newer/older). Focus guard skips when target is INPUT/TEXTAREA/SELECT/contentEditable. Listener attached in onMount with cleanup.

### Klara review display
Multiple reviews per stage are collected into arrays (not overwritten by Map). Within each stage block, reviews are sorted: [WIRING] first, [MESSAGES] second, joined with `\n\n` separator in `turns/+server.ts`. Client-side (`+page.svelte`) splits klara block content on `\n\n` before `[WIRING]` or `[MESSAGES]` prefixes and renders each segment as a separate paragraph. Multi-paragraph content within a single prefix group is preserved.

### Klara review SSE
`events.ts` provides an in-memory EventTarget. `POST /api/klara-review` emits after save. `GET /api/klara-events` streams events to the client via SSE (15s keepalive, `closed` flag guards against enqueue-after-close crashes). `+page.svelte` subscribes via EventSource, reloads turns on each event and on reconnection.

### Character sheet parsing fragile
Canon section parsing depends on exact `## CANON -- {field}` header format. Format mismatch returns empty string with no error. Books.test.ts covers 12 character sheets but doesn't test format deviation.

### Port-readiness constraint
merge.ts is designed to port to Prague. Must maintain zero framework dependencies. Any change that adds a dependency breaks the port path.

### Pipeline transparency (A25/A26/A27)
+page.svelte displays full input (system_prompt + user_content merged into single "Input" section) and output for every agent in collapsible sections. DB stores system_prompt and user_content per pipeline_outputs row for historical browsing. Input sections render at full height with no inner scrolling (max-height/overflow-y removed in A27).

### Content classifier (A16)
moderation.ts calls OpenAI Moderation API on user messages. Returns filtered category flags (8 criminal-statute-mapped categories, `sexual` suppressed). Flags are advisory input to Director tray item 12. Graceful degradation: returns null on missing key or API failure.

### Ownership split
UI/infrastructure/API wiring owned by OPS. Prompt engineering/pipeline design owned by Hana's team. Changes to engine.ts require coordination.

---

## Conventions

- Port 51770
- SQLite with WAL mode (data/manhattan.db)
- Books loaded from wiki filesystem, not database
- merge.ts must stay zero-dep (port to Prague)
- OpenRouter credentials through Burt
- Update this file after every shipped REQ (R14)
