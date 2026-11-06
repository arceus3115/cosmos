# Religion Almanac: Backend Build Tickets

*Implementation snapshot · 5 November 2026 · based on the edited Backend Data Processing & Modeling Design*

These tickets translate the current inputs into a build sequence. Prototype code uses the explicit defaults in **B-001**'s ADR; unresolved publication and provider choices remain open and do not imply production approval.

## Prototype status

*Execution update · 5 November 2026.* Runtime dependencies are installed. The canonical seed validated, the prototype release built to `exports/current`, and the PostgreSQL migration and loader ran against a disposable local PostgreSQL 17 instance. The API was started against that loaded release and its health, graph, detail, neighbor, search, and path endpoints returned HTTP 200. The temporary server and database were stopped after execution. No formal test suite was run.

| Ticket | Current state |
| --- | --- |
| B-001 | Review pending. Prototype defaults and remaining choices are recorded in [ADR 0001](../docs/adr/0001-backend-data-contracts.md). |
| B-101–B-103 | Schemas, content-derived ID migration/aliases, and pre-load validator are implemented. `ra-pipeline validate` passed on the canonical seed; it loaded successfully through the database constraints. Broader invalid-record fixtures remain unrun. |
| B-201 | Normalized-only staging contract and provenance capture are implemented; source-specific connectors remain open and staging was not exercised in this run. |
| B-202 | PostgreSQL migration applied and transactional loader executed against a disposable local PostgreSQL 17 instance. Reconciled counts: 7 sources, 18 nodes, 8 claims, 25 date assertions, 0 review events, and 2 guided paths. A persistent project database is still unconfigured. |
| B-203 | `ra-pipeline build --include-prototype --output exports/current` generated CSV, JSON graph/search/detail, RDF, JSON-LD, `NOTICE`, and the release manifest for `prototype-01`. Repeat-build checksum and export round-trip checks remain. |
| B-301–B-303 | API runtime exercised against the matching build/database release. Health, graph, node, claim, source, neighbor, search, and path requests returned HTTP 200; graph served 18 nodes/22 links, search returned 2 “Atra” matches, and the selected flood path returned one 1-hop route. Broader query fixtures remain unrun. |
| B-304 | Implemented: the browser loads the API graph first, keeps release-scoped detail caching, fetches record/citation details on selection, uses API search/path queries, exposes connection and fallback release status, and preserves bundled data as an identified fallback. Local CORS and startup instructions are documented. Runtime verification of this change remains pending. |
| B-401 | Provider-neutral vector-candidate protocol exists; provider selection and actual indexing remain unstarted. |
| B-402 | Build manifest/release matching exists; operations and rollback procedures remain. |

No formal tests have been added or run. `python -m compileall` completed for the backend Python packages; this checks syntax only. Runtime execution above is a manual smoke run, not a substitute for the ticket exit fixtures.

## Inputs carried into the backlog

- PostgreSQL for relational records; a vector store for later similarity/candidate work.
- Preload the high-level graph; fetch detailed node/claim records from an API as needed.
- Use JSON, RDF, and JSON-LD together, with one canonical source and derived interchange formats to be confirmed.
- Store hierarchy on node records for Tier 1; influence remains a first-class claim.
- Bibliographic citation is the minimum evidence detail. Records without a source need an explicit `unsourced` marker and a clear publication rule.
- Record licensing per source/dataset. Retain normalized ingestion results, not full raw payloads.
- Promote candidates through manual edits and Git review.
- Build a separate multilingual search index from canonical name records.
- Store historically phased date ranges with evidence and uncertainty notes.
- Use content-derived IDs, database constraints, and build identity composed of commit metadata plus output checksum.
- Return several non-dominated paths with per-edge evidence and no single aggregate score.

## M0 — Lock the contracts

### B-001 · Resolve remaining data contracts

**Size:** S · **Blocks:** all implementation tickets

Record the selected design in an ADR before schemas or migrations are built. Resolve:

- Which format is authoritative: likely canonical JSON with RDF/JSON-LD derived from it, or another explicit division of roles.
- The immutable inputs to the content hash, collision handling, and alias/migration behavior. Editing a title or summary must not silently change a published ID.
- Hierarchy is stored on node records as selected; define parent cardinality and how a future multi-parent case is represented.
- When an `unsourced` record is allowed in the database, API, and public graph; ensure the badge never implies scholarly support.
- Date-phase vocabulary, date aspects, BCE/CE numeric convention, and open-ended ranges.
- Path traversal direction and how incomparable paths are ordered or presented without a single score.
- PostgreSQL remains the relational store and vector search remains a separate concern as selected; confirm provider/integration boundary. Vectors are for discovery, not canonical identity or automatic publication.
- The graph bootstrap/API detail payload and cache/version contract.

**Exit:** one reviewed ADR contains decisions, rationale, owner, and revisit triggers. Unresolved items remain explicit and block dependent tickets.

## M1 — Define and curate the canonical model

### B-101 · Define schemas and controlled vocabularies

**Size:** M · **Depends on:** B-001

Specify versioned schemas for nodes, names, identifiers, hierarchy, influence claims, evidence, sources/licenses, date assertions, review events, and guided paths. Publish definitions for node types, edge types, confidence, consensus, status, and `unsourced`.

**Exit:** valid fixtures conform; schema version is recorded; unknown vocabulary values fail with a record path and actionable error.

### B-102 · Create canonical JSON record layout and ID policy

**Size:** M · **Depends on:** B-101

Create the repository layout and ID registry. Encode the approved content-derived ID recipe using immutable identity fields; keep names, summaries, dates, and citations mutable without changing a published ID. Define redirects/aliases for merges and corrections.

**Exit:** representative tradition, text, story, work, source, hierarchy, and claim records serialize deterministically; repeat builds produce the same IDs; rename and merge cases have documented outcomes.

### B-103 · Add editorial validation and manual promotion workflow

**Size:** M · **Depends on:** B-101, B-102

Build the validator and contribution flow for manual candidate promotion through reviewed Git changes. Use database constraints as the persistence gate, with pre-load validation that reports equivalent failures against source files. Enforce referential integrity, unique IDs, hierarchy acyclicity, vocabulary, evidence status, and dataset-license completeness.

**Exit:** invalid records are rejected before publication with file/record context; `unsourced` is visibly distinct and obeys the B-001 publication rule; contested claims follow the approved citation/review rule.

## M2 — Normalize sources and persist approved records

### B-201 · Build the normalized-ingestion framework

**Size:** M · **Depends on:** B-101, B-103

Implement connector contracts that produce normalized staging records only. Store source URL, retrieval time, upstream version when available, checksum, license, connector version, and normalization version. Do not persist full raw payloads. Unknown or incompatible licenses are quarantined from promotion.

**Exit:** fixture-based connector runs produce deterministic normalized records; reruns are idempotent; every record can be traced to its source and license metadata.

### B-202 · Create the PostgreSQL relational read model

**Size:** M · **Depends on:** B-101, B-102, B-103, existing seed-content tickets T-201–T-204

Create migrations and constraints for nodes, name variants, external identifiers, influence claims, evidence, sources/licenses, date assertions, review events, and approved hierarchy storage. Keep candidates separated from the public read model. Add indexes for IDs, claim endpoints/types, names, and source references.

**Exit:** the canonical JSON seed loads idempotently; database constraints enforce the approved invariants; a documented reconciliation reports source/output counts and rejected records.

### B-203 · Generate RDF, JSON-LD, CSV, and build manifest

**Size:** M · **Depends on:** B-102, B-202

Generate RDF/JSON-LD and CSV from canonical records and the relational read model using the approved mappings. Include citations, source/dataset license notes, schema version, source commit, pipeline version, and output checksum. Generate `NOTICE` from the source-license register.

**Exit:** exports round-trip the approved IDs and claim/evidence links; identical commit and tool versions produce identical checksums; every exported record and source has its expected license metadata.

## M3 — Serve the graph and detailed records

### B-301 · Build graph bootstrap artifact and detail API

**Size:** M · **Depends on:** B-202, B-203, existing content tickets T-201–T-204

Build a compact static graph payload containing IDs, display names, types, hierarchy, and the fields needed to draw and filter the graph. Add API endpoints for node detail, claim detail, evidence, external identifiers, and neighbors. Keep long summaries and citation metadata out of the initial payload when the approved contract calls for on-demand detail.

**Exit:** initial payload is versioned with the API; detail calls return the matching release; pagination and caching behavior are documented; the browser can draw the graph before detail requests complete.

### B-302 · Build multilingual search index

**Size:** M · **Depends on:** B-102, B-202

Build a versioned search index from canonical labels and alternate names. Preserve original script and spelling; use the B-001 normalization/ranking rules for Unicode, diacritics, transliteration, and exact-script matches.

**Exit:** index generation is deterministic; queries return stable IDs plus the matched label and language/script; search results identify the graph/API release that produced them.

### B-303 · Implement non-dominated path queries

**Size:** M/L · **Depends on:** B-001, B-202, B-301

Return several non-dominated paths with per-edge rationale, direction certainty, consensus, confidence, and citations. Do not collapse path evidence into one undocumented score. Apply the agreed date, edge-type, confidence, consensus, and tradition filters; label reverse traversal if enabled.

**Exit:** deterministic results for connected, disconnected, cyclic, and competing-route fixtures; output explains why each path is included and does not imply unsupported certainty.

### B-304 · Connect the prototype page to bootstrap and detail APIs

**Size:** M · **Depends on:** B-301, B-302

Load the compact graph before requesting any node details. Fetch node/claim/source details on selection, cache them by release ID, and show a clear unavailable state if an API request fails. Keep the static seed as a development fallback only if the release identity is visible.

**Exit:** the graph renders from `/v1/graph` before any detail request completes; selecting a node loads the matching release's details; a release change invalidates cached detail records; browser interaction works with the existing filters and guided paths.

## M4 — Add vector-backed discovery

### B-401 · Add vector indexing for candidate discovery

**Size:** M/L · **Depends on:** B-001, B-201, B-202

Index only approved-to-process text representations or metadata in the selected vector store. Record model/version, input record IDs, generation time, and source/license provenance. Emit candidate relationships with rationale and similarity metadata; never write candidates into the published graph.

**Exit:** vectors can be rebuilt from normalized data; model changes are versioned; candidates remain isolated until manual Git promotion; a reviewer can trace each candidate to its inputs.

### B-402 · Add release reconciliation and operational handoff

**Size:** S/M · **Depends on:** B-203, B-301, B-302, B-401

Publish the artifact/API release manifest and document rebuild, rollback, database restore, vector reindex, and license-register refresh procedures.

**Exit:** a release is traceable to its source commit and checksums; rollback restores a matching graph/API version; operators can rebuild search and vector indexes from the approved normalized/canonical data.

## Dependency order

```text
B-001
  → B-101 → B-102 → B-103
                 ↘       ↘
                  B-201 → B-202 → B-301 → B-303
                         ↘       ↘
                          B-203    B-302
                            ↘      ↙
                              B-402

B-401 depends on B-001 + B-201 + B-202; it can follow the core API release. B-304 can follow B-301/B-302 independently of vector search.
```

