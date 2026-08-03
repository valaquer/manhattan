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
│   │       ├── db.ts                # SQLite: messages, pipeline_outputs, memory
│   │       └── openrouter.ts        # OpenRouter API client (callModel, streamModel)
│   └── routes/
│       ├── +layout.svelte            # Root layout
│       ├── +page.svelte              # Main UI -- chat interface, pipeline controls
│       ├── +page.ts                  # Client-side data loader
│       └── api/
│           ├── pipeline/+server.ts   # POST: runs full 5-agent pipeline
│           ├── turns/+server.ts      # GET: conversation history
│           └── reset/+server.ts      # POST: reset conversation state
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
    → db.ts → manhattan.db (SQLite)
    → openrouter.ts → OpenRouter API (external)
    → merge.ts (pure TypeScript, zero framework deps)

turns/+server.ts → db.ts (read conversation history)
reset/+server.ts → db.ts (clear conversation state)
```

### External Dependencies

```
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
    2. Director processes user message context
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
Touches: pipeline/+server.ts only. All chat turns flow through here. Changes affect every pipeline run.

### merge.ts
Touches: engine.ts only. Zero framework dependencies -- designed to port to Prague as pure TypeScript. Changes must maintain zero-dep constraint.

### openrouter.ts
Touches: engine.ts only. External API calls to OpenRouter. Changes affect model selection, retry behavior, and token instrumentation.

### db.ts
Touches: pipeline (write), turns (read), reset (write), session browser (read). 3-table schema: messages, pipeline_outputs, memory. Sessions table tracks conversation runs. No data deletion -- reset creates a new session, old data preserved.

### Wiki book files (external)
Touches: books.ts reads at runtime. Hana's team maintains. Changes to book structure or character sheet headers can break the pipeline silently.

---

## 5. Known Issues

### Character sheet parsing fragile
Canon section parsing depends on exact `## CANON -- {field}` header format. Format mismatch returns empty string with no error. Books.test.ts covers 12 character sheets but doesn't test format deviation.

### Port-readiness constraint
merge.ts is designed to port to Prague. Must maintain zero framework dependencies. Any change that adds a dependency breaks the port path.

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
