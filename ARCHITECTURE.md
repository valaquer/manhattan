# Manhattan — Architecture

> **Status: Placeholder.** Sections below are empty — to be filled by the project principal from the actual codebase.

---

## Directory Structure

```
src/lib/server/
  books.ts          -- book loader: reads 7 wiki books, parses 12 character sheets, builds identity headers
  books.test.ts     -- 20 tests: loadBook (7 roles), loadModelProfile, loadCharacterSheet (12 chars), extractFirstTurnInsert, buildIdentityHeader, no-SvelteKit-deps
  engine.ts         -- pipeline orchestrator: 5 agents, retry loops, token instrumentation. Imports books.ts
  engine.test.ts    -- 20 tests: pipeline stages, refusal handling, retry paths
  merge.ts          -- merge/parse functions for pipeline data. Zero framework deps
  merge.test.ts     -- 19 tests
  db.ts             -- SQLite: messages, pipeline_outputs, memory
  openrouter.ts     -- OpenRouter API client (callModel, streamModel)
src/routes/api/
  pipeline/         -- POST endpoint, consumes engine.ts
```

## Dependency Graph

```
pipeline/+server.ts → engine.ts → books.ts → wiki files (filesystem read)
                                 → db.ts → manhattan.db
                                 → openrouter.ts → OpenRouter API
                                 → merge.ts
```

books.ts reads from: `library/wiki/Relationship Engine/books/` (7 book files) and `library/wiki/Relationship Engine/characters/` (12 character sheets). Pure filesystem, no DB, no network.

## Data Flow

_TBD — principal to document (pipeline message flow, agent call sequence)._

## Blast Radius Map

**books.ts** -- consumed by engine.ts only. Changes to book file paths or section parsing affect all pipeline runs. Character sheet format changes (section headers) break silently (empty strings, no error).

**engine.ts** -- consumed by pipeline/+server.ts only. Changes here affect all chat turns.

**merge.ts** -- consumed by engine.ts. Zero framework dependencies, ports to Prague as pure TypeScript.

## Known Issues

- ARCHITECTURE.md sections (Data Flow) still placeholder -- needs full pipeline flow documentation.
- Canon section parsing depends on exact `## CANON -- {field}` header format in character sheets. Format mismatch fails silently (returns empty string).

---

## Parking Lot

> **Unverified — extracted from LOGBOOK, not yet validated against codebase.** Do not treat as authoritative until a principal signs off.

- Port 51770. GitHub valaquer/manhattan. SvelteKit app (Workbench umbrella).
- Ownership split: UI/infrastructure/controls/API wiring = OPS (Rio's team). Prompt engineering/chat LLM pipeline = Hana/Wyatt/Klara.
- 3-table DB: messages + pipeline_outputs + memory (replaced earlier sessions/turns/blocks schema).
- 5-call pipeline: Director-for-User → Actor-for-User → Director-for-Character → Actress-for-Character → Artisan Cutter. Cutter feedback loop closes the memory chain.
- Klara MCP integration: `mcp-manhattan-server.js` with `post_klara_review`. Pipeline delivers turn summary to Klara via Aether POST (system sender — no Kitty delivery).
- Sidebar 180px (differs from other Workbench apps which use 320px).
- Bronx rebase constraint: codebase may be rebased onto Bronx in the future.
