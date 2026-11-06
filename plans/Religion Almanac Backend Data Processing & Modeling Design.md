# Religion Almanac: Backend Data Processing & Modeling Design

*Discussion draft · 5 November 2026 · No implementation decisions selected*

## How to use this draft

This document expands the backend portions of the [System Design & Delivery Plan](<Religion Almanac System Design & Delivery Plan.md>). It is a set of decision points, not an implementation plan. Each point lists options, tradeoffs, and a blank choice line for editing. No option is approved by this draft.

The current working scale is approximately 25 traditions, 100 texts, 400 stories, 300 influence claims, with a 500-node initial graph and a possible 2,000-node browser view. Revisit the choices if expected scale, contributors, or update frequency change.

## 1. First distinction: source data, query store, and runtime index

These are three different jobs and do not have to use the same format:

1. **Editorial source** — what contributors review and change; likely version-controlled.
2. **Query store** — an optional database for API queries, editorial workflow, or larger ingests.
3. **Runtime index** — lookup structures built for a processing job or browser session.

JavaScript `Map` and object dictionaries are runtime lookup structures. They are not persistent storage. A map from stable ID to a node, plus an adjacency list of edge IDs, gives average constant-time ID lookup and graph traversal proportional to the visited nodes and edges. At hundreds or a few thousand nodes, this is unlikely to be a meaningful memory or speed problem by itself. The larger risks are duplicating full node objects in several indexes, loading far more data than a view needs, and spending time in layout/rendering.

**Decision point 1 — What should the browser receive?**

| Option | Tradeoffs |
| --- | --- |
| One compact graph JSON document; build `Map` indexes on load | Simplest and predictable; the full graph is downloaded up front. Suitable if the Tier-1 file remains small. |
| Graph JSON plus separate detail files | Faster initial graph load and smaller per-node details; adds fetches, caching rules, and version coordination. |
| JSON Lines or other record stream | Can stream and process records incrementally; less convenient for direct browser use and ordinary editing. |
| Database-backed API only | Supports pagination and server-side queries; adds a running service and network dependency for a read-heavy site. |
**Your choice:** ______________________________________________

graph JSON + db api hybrid. high level pre-loads and for fine grain have it be a api call while the page is up so that users dont have to wait.

**Working note to edit:** Keeping a `Map`/dictionary for runtime lookup is compatible with YAML, PostgreSQL, RDF, or any other durable source. Benchmark before replacing a simple index; do not treat a runtime map as the canonical data store.

## 2. Editorial source of truth

The delivery plan favors reviewed YAML in Git. The options below cover how that data could be organized.

**Decision point 2 — Which authoring format and file shape?**

| Option | Advantages | Costs / risks |
| --- | --- | --- |
| YAML, one file per entity or claim | Small diffs, comments, easy review of a single record, low merge contention | YAML has parser edge cases; cross-record edits touch several files; contributors need clear conventions. |
| YAML grouped by tradition or source collection | Related records sit together; fewer files | Larger diffs and more merge conflicts as contributors edit the same group. |
| JSON, one file per entity or claim | Strict syntax and direct JSON Schema compatibility | No comments; less comfortable for hand-authored scholarly notes. |
| RDF/Turtle or JSON-LD as the authored format | Linked-data concepts are visible in the source; exports are close to canonical | Higher authoring burden; qualified claims and evidence can become verbose. |
| Editorial web interface writing to a database | Friendly forms and concurrent edits | Adds application and permissions work; Git review and reproducible builds need a separate export/review path. |

**Your choice:** ______________________________________________

conbination of json, rdf and json-ld


## 3. Durable storage and deployment shape

The published graph can be built directly from the editorial source. A database is only necessary if the product needs database-backed queries or workflow.

**Decision point 3 — What should the published read model use?**

| Option | Advantages | Costs / risks |
| --- | --- | --- |
| No database; build static JSON, search index, JSON-LD, and CSV | Fewest services; cheap CDN delivery; deterministic and easy to roll back by release | Queries are limited to the built artifacts; every data change needs a rebuild and redeploy. |
| PostgreSQL normalized schema | Strong referential constraints, transactions, mature backups, SQL joins, and recursive queries for hierarchy/path work | Requires database operations and migrations; graph traversal needs explicit SQL/query code. |
| PostgreSQL with selective JSONB fields | Keeps relational integrity for IDs and claims while allowing flexible name maps or source metadata | Flexible fields can drift unless schema validation remains authoritative; SQL indexes need deliberate design. |
| Property-graph database | Relationship traversal and graph queries are natural to express | Separate operational model, migrations, backups, and possibly licensing/hosting cost; may be excessive for a small curated graph. |
| RDF triple store | Standard identifiers, ontologies, linked-data queries, and direct RDF publication | Evidence attached to a relationship claim needs a qualified-edge pattern; SPARQL and vocabulary modeling have a learning cost. |
| Document database | Natural fit for nested node details and read-oriented documents | Duplicated edges/evidence can become inconsistent; cross-document validation and path queries need extra work. |
| SQLite for a build or single-instance API | Small operational footprint and a familiar relational model | Concurrent writes and multi-instance hosted use need care; better suited to build-time or low-write use than shared editorial writes. |

**Your choice:** ______________________________________________
vector db, with postgresql relational.

**Decision boundary to edit:** Is the first release static-only, or does it require live API queries, authenticated editing, or scheduled ingestion? If static-only, compare databases as a future option rather than a prerequisite.


## 4. Logical graph model

The model should separate containment from influence and treat influence as a reviewable claim. A pair of records may have more than one relationship claim, and claims may disagree.

### Candidate conceptual records

| Record | Candidate contents |
| --- | --- |
| `Node` | Stable ID, node type, neutral summary, lifecycle status. Types include Tradition, Text, Story, and Work; later tiers may add Figure, Motif, Place, and Period. |
| `NameVariant` | Node ID, written form, language, script, name role, source, and preferred/display status. |
| `ExternalIdentifier` | Node ID, identifier namespace, identifier value, target URL pattern, and source. A node can have several identifiers, and not every node will have one. |
| `HierarchyRelation` | Parent node, child node, relation type such as `part_of`, evidence, and status. Validate this relation as acyclic. |
| `InfluenceClaim` | Subject, object, relationship type, direction certainty, confidence, consensus, rationale, inferred flag, and status. The claim has its own stable ID. |
| `ClaimEvidence` | Claim ID, source ID, locator (chapter, tablet, verse, page, passage ID), evidence note, and optional excerpt only where rights permit. One claim can have several evidence records. |
| `Source` | Bibliographic or dataset identity, publisher/maintainer, source URL, license/terms, version or edition, access date, and source-native identifier. |
| `ReviewEvent` | Claim ID, reviewer identity, action, date, and resolution note. This preserves review history when a claim changes. |
| `DateAssertion` | Node or claim ID, what the date describes, earliest/latest bound, calendar convention, precision, uncertainty note, and evidence. |

This is a conceptual shape only. The records could become YAML files, relational tables, RDF resources, or a combination.

**Decision point 4 — How should hierarchy and influence be represented?**

| Option | Tradeoffs |
| --- | --- |
| One generic `Edge` table with a relation type | One traversal interface and simpler export; hierarchy and scholarly influence can acquire unrelated fields and constraints. |
| Separate hierarchy relations and influence claims | Acyclic containment can have dedicated validation, while influence retains claim-specific evidence and confidence; traversal code handles two relation families. |
| Hierarchy stored as a `parent_id` on nodes; influence as claims | Compact hierarchy and easy parent lookup; multi-parent or contextual containment becomes awkward, and each parent assignment is less visible in review. |

**Your choice:** ______________________________________________
hierarchy stored.

**Decision point 5 — Should an influence edge be a first-class claim?**

| Option | Tradeoffs |
| --- | --- |
| First-class claim with its own ID and evidence records | Supports multiple claims between the same nodes, competing scholarly positions, review history, and direct citation; uses more records and joins. |
| One relationship row with citations embedded as a list | Simpler for a small static build; updates to citations and per-citation locators are less normalized. |
| Bare source/target/type edge, with evidence elsewhere | Smallest graph representation; makes provenance harder to enforce and easy to lose on export. |

**Your choice:** ______________________________________________

## 5. Evidence, provenance, and licensing

Do not equate a source with evidence for a specific claim. A source can support many claims; a claim can cite several sources. A citation should point to a locator precise enough for review when one is available. Keep metadata provenance separate from a claim that one narrative influenced another.

**Decision point 6 — How much evidence detail is required at Tier 1?**

| Option | Tradeoffs |
| --- | --- |
| Bibliographic source only | Fastest curation; a reviewer may need to search the work for the supporting passage. |
| Source plus chapter/page/tablet/verse locator | Better auditability and later passage-level expansion; curation needs reliable locators across editions. |
| Source plus short explanatory note per citation | Clarifies how a work supports the claim; introduces interpretation that itself needs careful review. |
| Passage-level quotations | Highest precision; permissions, translation rights, edition differences, and storage scope become harder. |

**Your choice:** ______________________________________________
minnimum req is bibliographic only, if we want, we can put an *unsourced tag* for those that dont have it.

**Decision point 7 — Where does license information attach?**

| Option | Tradeoffs |
| --- | --- |
| License per source/dataset | Simple register and NOTICE generation; may miss edition- or snapshot-specific terms. |
| License per retrieved snapshot/version | Strong audit trail and repeatable ingestion; more metadata to curate. |
| License per field or derived record | Can represent mixed rights precisely; complex to explain and enforce. |

**Your choice:** ______________________________________________
license per source/data set

Candidate pipeline provenance fields: upstream URL, retrieval timestamp, upstream version/commit, content checksum, declared license, connector version, normalization version, and whether a record is raw, normalized, candidate, or curated. Full texts remain out of scope unless the user changes that policy.

## 6. Identity, multilingual names, and dates

### Stable identity

**Decision point 8 — How are IDs assigned?**

| Option | Tradeoffs |
| --- | --- |
| Curator-assigned stable slugs | Readable, persistent, and independent of upstream systems; requires an ID registry and rename discipline. |
| Primary ID copied from Wikidata or another source | Easy matching for covered entities; external records can be missing, merged, split, or inappropriate as the Almanac’s identity. |
| Generated UUID | Collision-resistant and stable after assignment; hard to read in diffs and citations. |
| Content-derived hash | Deterministic generation; changing a title or normalized field can change identity unless the hash excludes mutable content. |

**Your choice:** ______________________________________________
content-derived hash

Keep external identifiers as mappings, not as the node’s primary key. Decide how deleted/merged records resolve: redirect/alias record, tombstone, or hard removal with migration. Preserve old IDs when shared URLs may exist.


### Multilingual names

**Decision point 9 — How should names be stored and searched?**

| Option | Tradeoffs |
| --- | --- |
| Separate name-variant records | Language, script, source, and preferred form are explicit and searchable; adds joins and record volume. |
| JSON map of language/script to labels | Compact and convenient for static display; multiple spellings, sources, and label roles are awkward. |
| Keep canonical labels in records and build a separate search index | Efficient search and independent ranking; the index is derived data that must be versioned and rebuilt. |

**Your choice:** ______________________________________________
keep canonical labels in records + build separate search index.

Store the source spelling intact. Treat search normalization as a derived key: Unicode normalization and case-folding can help matching, but removing marks globally can erase meaningful distinctions. Decide whether accent-insensitive matching applies only to Latin-script names, whether alternate transliterations are curated, and how exact-script matches rank.

**Your choice:** ______________________________________________

### Dates and uncertainty

**Decision point 10 — How should historical dates be encoded?**

| Option | Tradeoffs |
| --- | --- |
| Earliest/latest integer year plus uncertainty note | Simple filters and timeline bars; a single range can blur composition, manuscript attestation, and narrative setting. |
| Structured date assertion with aspect and evidence | Separates composition, surviving witness, setting, and reception; more fields and curation work. |
| Standardized time-span representation (for example, a linked-data time ontology) | Better interoperability; adds conventions and vocabulary overhead. |

**Your choice:** ______________________________________________
using historical time phases, ranges with the best evidence we have, uncertainty note is needed.
Also choose a BCE/CE numeric convention. Astronomical year numbering includes a year zero; historical BCE/CE notation does not. Conversions must be explicit so sorting, display, and exports do not shift ancient dates. Decide how open bounds such as “before 500 BCE,” disputed ranges, and date precision are represented.

**Your choice:** ______________________________________________

## 7. Processing pipeline and promotion boundary

### Candidate stages

```text
Upstream source
  → immutable raw snapshot + license/checksum metadata
  → source-specific parse
  → normalized staging records
  → identity match / unresolved-match queue
  → candidates (never public by default)
  → curator edits canonical records
  → schema + semantic validation
  → reviewed Git change
  → deterministic graph build + exports + manifest
```

No connector should write directly into the published graph. Separate imported observations from curated assertions so that a source update cannot silently overwrite an editor’s record.

**Decision point 11 — What does the ingestion system retain?**

| Option | Tradeoffs |
| --- | --- |
| Raw snapshot plus normalized output | Maximum auditability and parser re-runs; storage and license-retention policy need attention. |
| Raw snapshot only for selected sources; checksummed normalized output for the rest | Saves storage; less ability to reproduce normalization for sources whose raw data is not retained. |
| Normalized candidate records only | Smallest footprint; harder to trace discrepancies to the upstream payload. |

**Your choice:** ______________________________________________
normalized 


**Decision point 12 — How are candidates promoted?**

| Option | Tradeoffs |
| --- | --- |
| Curator manually edits canonical YAML/JSON in a pull request | Clear review diff and Git history; promotion requires data-format comfort. |
| Generate a proposed pull request from a curation interface | Easier for non-technical reviewers and preserves Git review; requires interface, identity, and audit-trail work. |
| Approve candidates in a database, then export reviewed snapshots to Git | Useful for high-volume review; dual state and export conflicts need strict reconciliation. |

**Your choice:** ______________________________________________
manual edit
The promotion gate should be explicit: schema validity, referenced IDs, evidence presence, license completeness, hierarchy acyclicity, contested-claim citation count, reviewer requirements, and deterministic output manifest. Machine-generated similarity remains a candidate signal, never a published influence claim by itself.

## 8. Validation, versioning, and reproducibility

**Decision point 13 — Where should validation live?**

| Option | Tradeoffs |
| --- | --- |
| JSON Schema only | Portable structural validation; cannot express every cross-record and graph invariant. |
| JSON Schema plus semantic validator | Structural and referential checks can be separated; two validation layers must share vocabulary and error reporting. |
| Typed application models only | Convenient in a Python pipeline; schema reuse by non-Python tools and docs generation takes extra work. |
| Database constraints as the primary gate | Strong after loading; errors arrive late in the authoring flow and do not validate static builds by themselves. |

**Your choice:** ______________________________________________
db constraints

Candidate semantic rules include unique stable IDs, valid parent references, hierarchy cycle detection, at least one evidence record per published claim, two sources for contested claims, confidence/citation requirements, controlled vocabulary checks, license completeness, and duplicate-claim review warnings.

**Decision point 14 — What identifies a build?**

| Option | Tradeoffs |
| --- | --- |
| Git commit SHA plus schema and pipeline versions in a manifest | Easy to trace from release to reviewed source; identical output also depends on controlled tool versions. |
| Content checksum of canonicalized graph output | Detects content drift independent of commit metadata; canonical serialization rules must be fixed. |
| Both commit metadata and output checksum | Best audit trail and reproducibility check; slightly more release metadata. |

**Your choice:** ______________________________________________
commit metadata + output checksum
Sort output records and JSON keys deterministically; pin normalization/configuration versions; record connector inputs; exclude volatile build timestamps from the content checksum or place them outside the hashed payload.

## 9. Query model and path ranking

For a graph API or browser path explorer, an adjacency list is the simplest baseline: node ID to outgoing claim IDs, with an optional incoming index. This avoids scanning every edge for each step. A database can build the same indexes at load time.

**Decision point 15 — How should path ranking work?**

| Option | Tradeoffs |
| --- | --- |
| Filter by user-selected confidence/consensus, then rank by hop count | Easy to explain; can prefer short weak routes unless filters are strict. |
| Lexicographic ranking (e.g. consensus category, weakest edge, hop count) | Keeps evidence dimensions visible; ordering policy still needs scholarly/editorial agreement. |
| Weighted path cost from confidence, consensus, inferred status, and hop count | Flexible and deterministic; weights can imply precision that subjective labels do not have. |
| Return several non-dominated paths with per-edge evidence and no single score | Avoids hiding tradeoffs; more complex UI and potentially more results. |

**Your choice:** ______________________________________________
280 | Return several non-dominated paths with per-edge evidence and no single score | Avoids hiding tradeoffs; more complex UI and potentially more results. |

Do not interpret confidence 1–5 as a probability unless the project defines and calibrates it as one. Keep path result explanations at edge level: why the edge is included, its direction certainty, consensus label, and citations. Decide whether paths may be traversed backward for exploration; if so, label reverse traversal without reversing the scholarly claim’s direction.

**Your choice:** ______________________________________________

## 10. Scale and migration triggers

Choose triggers based on measurements and product needs rather than raw node count alone.

| Trigger | Possible response |
| --- | --- |
| Static graph bundle becomes slow to download | Split graph/detail assets, compress, or load traditions on demand. |
| Browser memory or pan/zoom frame time misses target | Profile graph layout first; consider canvas/WebGL or a renderer suited to larger graphs. |
| Path queries or filtered exports become slow | Add precomputed adjacency/search indexes or move queries server-side. |
| Multiple editors need concurrent workflows | Add review tooling and possibly database-backed editing while keeping Git export/review provenance. |
| Graph traversal exceeds the relational model’s operational simplicity | Re-evaluate property graph or RDF storage using representative queries and an export migration. |
| External data volume exceeds what can be reviewed manually | Keep discovery in a candidate store; measure reviewer precision and backlog before any automation changes. |

**Your thresholds / triggers to edit:** ______________________________________________

## 11. Open decisions ledger

Edit this table as choices are made. A selected option should include an owner, rationale, and revisit trigger.

| Decision | Selected option | Rationale / constraint | Revisit trigger |
| --- | --- | --- | --- |
| Browser payload | TBD |  |  |
| Editorial file format and layout | TBD |  |  |
| Query store | TBD |  |  |
| Hierarchy vs. influence representation | TBD |  |  |
| Claim and evidence model | TBD |  |  |
| External identifiers and stable IDs | TBD |  |  |
| Multilingual name/search model | TBD |  |  |
| Date assertion model and year convention | TBD |  |  |
| Snapshot retention and promotion workflow | TBD |  |  |
| Validation and build identity | TBD |  |  |
| Path ranking policy | TBD |  |  |

