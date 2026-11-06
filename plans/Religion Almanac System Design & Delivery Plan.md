# Religion Almanac: System Design & Delivery Plan

*Draft v0.1 · 5 November 2026 · Status: for review*

## 1. Purpose and scope

The Religion Almanac is an educational, graph-based visualization of how religious traditions, their foundational texts, and their stories relate to and influence one another, from the origin of myths through downstream religious and secular literature (for example Judaism → Christianity, or Ovid’s Pyramus and Thisbe → Romeo and Juliet).

**In scope (v1):** a curated Tier-1 graph (tradition → foundational text → prominent story), typed and cited influence edges, path-finding between any two nodes, a timeline view, search, and open data export.

**Out of scope (v1):** user accounts, crowd-sourced editing, hosting copyrighted translations, automatic publication of machine-detected links, and any theological evaluation of a tradition.

**Working assumptions:** 1–3 developers part-time; volunteer scholarly reviewers; hosting budget under about $50/month; Tier-1 size of roughly 25 traditions, 100 texts, 400 stories and 300 edges. Revisit if any of these is wrong.

**Graph tiers**

| Tier | Contents | Release |
| --- | --- | --- |
| 1 | Tradition, Text, Story, derived Work | v1 |
| 2 | Sub-texts, figures, motifs, places, periods | v1.x |
| 3 | Passage level (verse, tablet line, parallel passage) | v2 |

## 2. Design principles

1. **Provenance first.** No edge is published without at least one scholarly citation.
2. **Edges are claims, not facts.** Every edge carries a type, direction, confidence and a scholarly-consensus label, because similarity does not prove connection.
3. **Tier before depth.** Ship the high-level graph with cited data before adding passage-level or machine-found links.
4. **Git is the editorial source of truth.** Curated data lives as reviewed YAML in the repository; the database and site are derived builds.
5. **Open standards.** Wikidata QIDs for identity, TEI/JSON-LD for interchange, source-native IDs (ctext URNs, SuttaCentral UIDs, Sefaria refs) for deep links.
6. **Static-first delivery.** The data is read-heavy and changes on release, so pre-build graph JSON and serve it from a CDN.
7. **Neutral and contestable.** Present scholarly positions, label contested claims visibly, never rank traditions.

## 3. Requirements

**Functional**

- FR1: Browse the Tier-1 graph with pan, zoom and expand/collapse by tradition.
- FR2: Node detail with summary, dates, languages, external links and citations.
- FR3: Edge inspector showing type, direction, confidence, consensus and evidence.
- FR4: Filter by edge type, confidence, consensus, date range and tradition.
- FR5: Path explorer: choose node A and node B and see the best-supported paths with a step-by-step narrative.
- FR6: Timeline layout with date-uncertainty bars; map layout in a later phase.
- FR7: Search across names in multiple scripts, with diacritic-insensitive matching.
- FR8: Shareable URLs that restore the current view.
- FR9: Guided “story paths” for educators (for example the flood narrative across traditions).
- FR10: Export as JSON-LD and CSV with citations and licenses included.

**Non-functional**

- Initial render of a 500-node Tier-1 graph under 3 seconds on a mid-range laptop; smooth pan and zoom up to 2,000 nodes.
- WCAG 2.2 AA, including full keyboard operation and a table/list alternative to the visual graph.
- Reproducible builds: the same data commit always produces the same output checksum.
- Every ingested dataset has a recorded license, and share-alike obligations are surfaced in a generated NOTICE file.
- Multi-script names (Devanagari, Han, Arabic, cuneiform transliteration, Hebrew) render correctly.

## 4. Technology decisions

Two languages, deliberately: **Python** for data work, **TypeScript** for everything the user sees.

| Layer | Choice | Rationale | Rejected alternatives |
| --- | --- | --- | --- |
| Curated data | YAML in Git, validated by JSON Schema | Diffable, reviewable by non-developers via pull requests, full audit trail | Spreadsheet (no review history); headless CMS (extra service to run) |
| Pipeline | Python 3.12 with lxml, httpx, pydantic, rdflib, pandas | Best ecosystem for TEI/XML, RDF and later NLP; most source tooling (for example the ctext wrapper) is Python | Node (weaker NLP and XML tooling) |
| Serving DB | PostgreSQL 16 (pgvector added in Phase 3) | Relational plus recursive CTEs handle path queries at this scale; JSONB for flexible attributes; one boring dependency | Neo4j (operational overhead not justified at about 10^4 edges); revisit past about 10^6 edges |
| API | FastAPI with SQLAlchemy and Alembic | Shares language with the pipeline; automatic OpenAPI; typed models reused from validation | Express/NestJS (would add a third data-model copy) |
| Frontend | TypeScript, React, Vite | Mainstream, large talent pool, strong typing against generated API types | Heavy meta-frameworks (SSR not needed for v1) |
| Graph rendering | Cytoscape.js, with D3 scales for the timeline | Compound nodes, built-in layouts, handles low thousands of nodes | D3-force from scratch (more work); Sigma.js/WebGL held in reserve if scale tests demand it |
| Search | MiniSearch in the browser for v1, Postgres full-text later | Corpus is small; no search server needed | Elasticsearch (overkill) |
| Map (Phase 3) | MapLibre GL | Open source, no vendor lock-in | Proprietary map SDKs |
| Hosting | Static CDN for the site; one small container plus managed Postgres for the API | Low cost, simple rollback | Kubernetes (unneeded) |
| CI/CD | GitHub Actions | Co-located with the repo and data review workflow | n/a |
| Testing | pytest, Vitest, Playwright, axe-core | Covers pipeline, UI logic, end-to-end and accessibility | n/a |

**Escape hatch:** the build also emits RDF/JSON-LD, so moving to a graph database later means loading an export, not rewriting the model.

## 5. Architecture

```
 External sources        Python pipeline                 Data stores            Delivery
 (Wikidata, ctext,   -->  Connectors (fetch, snapshot,   --> Raw snapshots       
  SuttaCentral,           license tag) -> Normalizer         (with checksums)     
  Sefaria, GRETIL,                          |                                     
  ORACC, TLA, Tanzil,                       v                                     
  Thompson/ATU)                    Candidate store (status=candidate)             
                                            |  curator promotes via PR           
 Curated YAML (Git) --> Validator --> Build loader --> PostgreSQL + static JSON --> FastAPI + CDN --> React app
```

**Build outputs:** a Tier-1 graph file (nodes and edges), one detail file per node, a search index, JSON-LD and CSV exports, and a NOTICE file.

**Key flows**

- *Curation:* contributor edits YAML → CI validates → scholarly reviewer approves the PR → merge triggers build and deploy.
- *Ingestion:* connectors run on a schedule, write snapshots and candidate records, and never write to the published graph.
- *Reading:* the site loads the static Tier-1 graph; detail, search and path queries use pre-built files or the API.

## 6. Data model

**Node types:** Tradition, Text, Story, Work (derived or later works such as plays and novels), Motif, Figure, Place, Period, Source (citation).

**Common node fields:** id (stable slug), type, names (language/script map), summary (60 words maximum, neutral), date range with uncertainty note, languages, external IDs (Wikidata QID, ctext URN, SuttaCentral UID, Sefaria ref, GRETIL, ORACC, TLA, Tanzil, Thompson/ATU), status (draft, reviewed, published).

**Hierarchy edges:** part\_of (Story in Text in Tradition), kept acyclic and separate from influence edges.

**Influence edge types**

| Type | Meaning |
| --- | --- |
| direct\_textual\_dependence | One text demonstrably draws on another (for example da Porto → Bandello → Brooke → Shakespeare) |
| shared\_source | Both descend from a common earlier source or tradition |
| motif\_parallel | Shared narrative element with no established transmission |
| oral\_diffusion | Transmission through oral retelling or migration |
| polemical\_adaptation | Material reworked to answer or invert the source |
| reception\_commentary | Later tradition interprets or comments on an earlier text |
| tradition\_lineage | Religion-level parent, schism, syncretism or influence |

**Edge fields:** source node, target node, type, direction certainty (certain, probable, unknown), confidence (1–5), consensus (consensus, majority, contested, fringe), date range, one-sentence rationale, evidence list (at least one Source; two or more when consensus is contested), reviewer, status, inferred flag (true for machine-derived links such as SuttaCentral inferred parallels).

**Rules enforced by the validator:** no published edge without evidence; confidence 4–5 requires a scholarly citation; part\_of forms a forest; every referenced ID exists; IDs are unique; contested edges require two citations.

**Worked example (Romeo and Juliet).** Ovid’s Pyramus and Thisbe, set in Babylon but a Roman-era telling, is linked to Romeo and Juliet by a chain of edges through da Porto (1530), Bandello, Boaistuau and Brooke (1562) to Shakespeare. The Ovid-to-Shakespeare link is modelled as an indirect motif ancestry, not direct dependence, and no edge asserts a Mesopotamian origin for the myth unless a cited scholar does.

## 7. Source ingestion plan

| Source | Access | Role in graph | Notes and risks |
| --- | --- | --- | --- |
| Wikidata | SPARQL | Identity, multilingual labels, dates, coordinates | CC0; version-control all queries |
| Database of Religious History | To be confirmed | Tradition backbone and cross-references | Confirm data access and license before relying on it |
| Chinese Text Project | API, RDF/SPARQL, OAI-PMH | Confucian and Daoist texts, parallel passages | Confirm current API key and rate-limit terms |
| SuttaCentral / BuddhaNexus | GitHub data, API | Buddhist parallels across Pali, Chinese, Tibetan, Sanskrit | Some parallels are inferred; flag them |
| Sefaria and Bible cross-reference sets | GitHub exports | Jewish and Christian texts, intra-Bible links | Per-dataset license varies |
| GRETIL / SARIT / Ambuda | Downloads (TEI, text) | Hindu and Sanskrit text identity and structure | Check each file’s terms; edition rights can apply |
| ORACC / CDLI / TLA | Downloads, APIs | Mesopotamian and Egyptian texts | Metadata only in v1 |
| Tanzil / Quranic Arabic Corpus | Downloads | Quran structure and references | Attribution and share-alike terms apply |
| Avestan Digital Archive, Avesta.org | Web, EPUB | Zoroastrian text references | Metadata and links only |
| Thompson Motif-Index and ATU | Open datasets, Wikidata | Cross-cultural story tags | Verify dataset license |

v1 ingests **identifiers, structure and metadata, not full texts**; deep links point back to the source sites, which sidesteps most redistribution issues.

## 8. Edge discovery (Phase 3)

Three candidate generators, all producing records with status=candidate that never reach the public graph without human promotion:

1. **Curated parallels import:** SuttaCentral parallels, ctext parallel passages and Bible cross-references mapped to candidate edges.
2. **Motif co-occurrence:** stories sharing Thompson motifs or ATU types across traditions, scored by specificity (rare shared motifs weigh more).
3. **Text-reuse and embeddings:** lexical matching within a language and multilingual embeddings across languages. Precision and recall are measured against known benchmark pairs before use.

The design deliberately avoids treating a similarity score as proof, because phylogenetic and similarity methods in comparative mythology are contested.

## 9. Quality, ethics and legal

- Two-reviewer rule for any edge labelled contested; one reviewer otherwise.
- A neutrality and sensitivity guideline, linked from the PR template.
- Licensing register for every source, enforced in CI.
- Prefer public-domain or openly licensed translations; link rather than copy.
- Never invent attributions; unsupported claims are dropped rather than softened.
- Visible “contested” and “fringe” labels, shown with text as well as colour.

## 10. Milestones

Sizing: **S** ≤ 1 day, **M** 2–3 days, **L** 4–6 days for one developer.

| Milestone | Tickets | Exit criteria |
| --- | --- | --- |
| M1 Skeleton | E0, E1 | Fresh clone builds; validator and loader work on fixtures |
| M2 Tier-1 MVP | E2, T-301, T-302, T-309, T-310, T-401, T-402, T-501–T-504, T-506, T-508 | Public site with the seed graph, cited edges and a working path explorer, passing accessibility checks |
| M3 Enrichment | Remaining connectors, T-403, T-505, T-507, T-509, T-705 | All source IDs linked; filters, timeline and guided paths live |
| M4 Discovery | E6, T-510, T-704 | Reviewed candidate-edge workflow; scale decision recorded |

## 11. Tickets

Each ticket lists its size, dependencies and **verification checks** that must all pass before it is closed.

### E0: Foundations

**T-001 Repository and tooling \[S\].** Monorepo with /data, /pipeline, /api, /web, /docs; Makefile; pre-commit hooks. *Verify:* a fresh clone runs `make setup && make test` successfully; pre-commit blocks a badly formatted file.

**T-002 CI pipeline \[S\], needs T-001.** Lint, tests, validator and build on every PR; preview deploy on PR. *Verify:* a PR with a deliberately failing test cannot merge; a passing PR produces a working preview URL.

**T-003 Architecture decision records \[S\].** ADRs for language split, Postgres versus graph DB, Cytoscape, static-first delivery, git-as-source-of-truth. *Verify:* five ADRs merged, each with context, decision, consequences and a revisit trigger.

### E1: Data model

**T-101 JSON Schemas \[M\], needs T-001.** Schemas for nodes, edges, sources and guided paths, versioned. *Verify:* valid fixtures pass; at least 15 invalid fixtures each fail with the expected error; schema version is embedded in every file.

**T-102 Controlled vocabularies \[S\], needs T-101.** Edge types, node types, confidence, consensus, license identifiers. *Verify:* every value has a definition and an example; a generated docs page lists them; unknown values are rejected.

**T-103 Validator CLI \[M\], needs T-101, T-102.** Referential integrity, evidence rules, acyclic part\_of, unique IDs, confidence and consensus rules. *Verify:* one unit test per rule; runs on the full seed in under 10 seconds; exits non-zero with file and line on failure.

**T-104 Postgres schema and migrations \[M\], needs T-101.** Tables, indexes on edge (source, target, type), Alembic migrations. *Verify:* migrate up and down on an empty database; model-to-schema drift test passes; query plan for neighbour lookup uses the index.

**T-105 Build loader \[M\], needs T-103, T-104.** YAML to Postgres and to static JSON, JSON-LD and CSV exports. *Verify:* node and edge counts equal source counts; two runs on the same commit give identical checksums; JSON-LD loads into rdflib without errors.

### E2: Tier-1 seed content

**T-201 Tradition list and hierarchy \[M\], needs T-103.** About 25 traditions (including Mesopotamian, Egyptian, Greek, Roman, Norse, Vedic and Hindu, Jain, Buddhist, Zoroastrian, Jewish, Christian, Islamic, Confucian, Daoist, Shinto, Sikh) with Wikidata QIDs and DRH cross-references. *Verify:* each tradition has a QID or a documented reason for none; no duplicates; reviewer sign-off recorded.

**T-202 Foundational texts \[L\], needs T-201.** Two to six texts per tradition with date ranges, languages and external IDs. *Verify:* each text has a date range with an uncertainty note, at least one authoritative citation, and at least one external ID where one exists; link checker passes on all external IDs.

**T-203 Prominent stories \[L\], needs T-202.** Three to five per text, using “teaching” or “anecdote” story subtypes for Confucian and Daoist material; Thompson or ATU codes where applicable. *Verify:* summary of 60 words or fewer, neutral in tone; location pointer in the text (book, chapter, tablet) that resolves on a source site; motif codes exist in the loaded index.

**T-204 Seed influence edges \[L\], needs T-203.** About 60 edges across tradition lineage and text dependence, including the Mesopotamian flood to Genesis claim and the Pyramus and Thisbe to Romeo and Juliet chain. *Verify:* every edge has type, direction, confidence, consensus and at least one scholarly citation (two if contested); the Romeo and Juliet chain has each hop separately cited; the validator passes.

**T-205 Scholarly review pass \[M\], needs T-204.** *Verify:* every published edge has a named reviewer; the reviewer checklist is completed; disputes are logged with their resolution.

### E3: Ingestion

**T-301 Connector framework \[M\], needs T-104.** Fetch, snapshot, normalize; caching, rate limiting, user-agent, robots handling, license metadata. *Verify:* contract tests pass using recorded HTTP fixtures; every snapshot stores URL, retrieval date, checksum and license.

**T-302 Wikidata connector \[M\], needs T-301.** *Verify:* at least 95% of seed entities have English plus native-script labels; SPARQL queries are version-controlled and re-runnable.

**T-303 ctext connector \[M\], needs T-301.** Text list, URNs, chapter structure, parallel passages. *Verify:* every seed Chinese text resolves to a URN; rate limits respected in tests; 20 sampled parallel passages match the live site.

**T-304 SuttaCentral connector \[M\], needs T-301.** *Verify:* parallel counts match upstream data; inferred parallels carry inferred=true; a sample of 20 resolves on the site.

**T-305 Sefaria and Bible cross-reference connector \[M\], needs T-301.** *Verify:* 25 sampled references resolve; each dataset’s license is recorded.

**T-306 Sanskrit connector (GRETIL, SARIT) \[M\], needs T-301.** *Verify:* seed texts map to source IDs; Devanagari and IAST text round-trips without corruption.

**T-307 Ancient Near East and remaining sources \[L\], needs T-301.** ORACC, CDLI, TLA, Tanzil/QAC, Avestan Digital Archive, Old Japanese corpus metadata. *Verify:* each seed text from these traditions has a source ID or a documented gap; no full text is stored.

**T-309 Motif and ATU loader \[M\], needs T-104.** *Verify:* row counts match the source dataset; all codes match the expected pattern; all seed story tags resolve.

**T-310 License register and compliance gate \[S\], needs T-301.** *Verify:* CI fails if any source lacks a license entry; a NOTICE file is generated; share-alike obligations are listed.

### E4: API

**T-401 Read API \[M\], needs T-105.** Node detail, graph by tier, edge filters, pagination. *Verify:* OpenAPI spec generated; contract tests pass; p95 latency under 200 ms on the seed with a warm cache.

**T-402 Path-finding \[L\], needs T-401.** K best paths between two nodes, cost derived from confidence and consensus, with filters and a maximum hop count. *Verify:* unit tests on hand-built graphs including cycles and disconnected nodes; the Pyramus and Thisbe to Shakespeare chain is returned as the top path; results are deterministic; a clear response is returned when no path exists.

**T-403 Search \[M\], needs T-401.** Multi-script, diacritic-insensitive. *Verify:* a 30-query test set returns the expected node in the top three for at least 90% of queries.

**T-404 Export endpoints \[S\], needs T-105.** *Verify:* JSON-LD loads in rdflib; CSV opens in a spreadsheet; both include citations and licenses.

### E5: Frontend

**T-501 App shell and URL state \[S\], needs T-001.** Routing and hash-based view state. *Verify:* copying the URL reproduces the view; back and forward buttons work.

**T-502 Tier-1 graph view \[L\], needs T-105, T-501.** Cytoscape with compound nodes by tradition. *Verify:* 500 nodes render in under 3 seconds; pan and zoom stay smooth in a Playwright performance trace; visual-regression snapshots show no overlapping labels at default zoom.

**T-503 Node detail panel \[M\], needs T-502.** *Verify:* every node shows its citations and external links; the CI link checker finds no broken external links.

**T-504 Edge inspector \[M\], needs T-502.** *Verify:* all edge fields are displayed; contested and fringe edges are distinguished by label and style, not colour alone.

**T-505 Filters \[M\], needs T-502.** *Verify:* filter combinations produce the same counts as the API; filter state persists in the URL.

**T-506 Path explorer \[L\], needs T-402, T-502.** Pick two nodes and see highlighted paths with a step-by-step narrative. *Verify:* end-to-end tests for the Romeo and Juliet and flood-narrative paths; the step list matches the API response exactly.

**T-507 Timeline layout \[M\], needs T-502.** Date axis with uncertainty bars and an “undated” lane. *Verify:* layout test confirms ordering by date midpoint; undated nodes are visible and not dropped.

**T-508 Accessibility \[M\], needs T-503.** Keyboard navigation, screen-reader list and table alternative, reduced motion, contrast. *Verify:* axe-core reports zero serious or critical issues; a manual screen-reader script passes; all graph information is reachable from the table view.

**T-509 Guided story paths \[M\], needs T-502.** Educator paths authored in YAML. *Verify:* the validator rejects paths that reference missing nodes or edges; one complete path (flood narrative) is reviewed by a scholar.

**T-510 Map layout \[M\], Phase 3, needs T-502.** MapLibre with place nodes. *Verify:* nodes without coordinates are listed, not hidden; coordinates match Wikidata for a 20-node sample.

### E6: Edge discovery (Phase 3)

**T-601 Curated-parallel import \[M\], needs T-304, T-305.** Candidate edges from existing parallel datasets. *Verify:* no candidate appears in the public graph; counts reconcile with source data.

**T-602 Motif co-occurrence generator \[M\], needs T-309.** *Verify:* precision is reported on 50 hand-labelled pairs; every candidate carries a score and rationale; candidates only.

**T-603 Text-reuse and embedding pipeline \[L\], needs T-301.** *Verify:* benchmark against known cross-language parallels with recall at k reported; thresholds documented; human review required before promotion.

**T-604 Curation queue \[M\], needs T-601.** Promote a candidate into a pull request with edge YAML. *Verify:* a promoted edge passes the validator and includes a citation; the audit trail shows who promoted it and when.

### E7: Quality and operations

**T-701 Neutrality and sensitivity guidelines \[S\].** *Verify:* guideline approved by at least two reviewers; PR template links to the checklist.

**T-702 Observability and backups \[M\], needs T-401.** *Verify:* a restore drill from backup succeeds; an alert fires on a simulated API error.

**T-703 Infrastructure as code and release process \[M\], needs T-002.** *Verify:* a tagged release deploys to staging then production; a rollback is exercised once.

**T-704 Scale test \[S\], Phase 3, needs T-502.** Synthetic 10,000 nodes and 50,000 edges. *Verify:* results documented; a recorded decision on whether to adopt Sigma.js or WebGL rendering.

**T-705 Public documentation \[M\].** Methodology, data dictionary, how to cite, contribution guide. *Verify:* link check passes; an outside contributor adds a valid edge using only the documentation.

## 12. Risks and open questions

| Risk or question | Mitigation or next step |
| --- | --- |
| DRH data access and licensing unconfirmed | Confirm early; fall back to Wikidata plus manual curation |
| Scholarly reviewer availability | Recruit during M1; scope Tier-1 to what can be reviewed |
| Contested claims drawing controversy | Visible labels, two citations, neutrality guideline |
| Source API terms change (for example ctext) | Snapshot data; cache; record terms at ingestion |
| Similarity mistaken for influence | Typed edges, consensus labels, candidates never auto-published |
| Scope creep into Tier 3 | Gate on M2 exit criteria and usage feedback |
| Team size smaller than assumed | Cut order: T-510, E6, T-507 before touching E2 or the path explorer |

**Open questions for you:** team size and timeline, whether named scholarly advisors are available, hosting budget, and whether v1 should be public or invite-only.
