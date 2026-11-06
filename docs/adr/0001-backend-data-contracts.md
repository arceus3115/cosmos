# ADR 0001: Backend data contracts

**Status:** Prototype defaults; review pending  
**Date:** 2026-11-05  
**Scope:** B-001, backend build tickets

This ADR records choices already entered in the design inputs and the narrow defaults used to make the prototype build coherent. It is not a claim that the remaining scholarly or operational policies have been approved. The open items below remain editable before a production release.

## Decisions carried from the design inputs

- Deliver a compact graph bootstrap at page load and fetch record details from a versioned API on demand.
- Keep canonical editorial data in JSON. Derive JSON-LD, RDF/Turtle, CSV, search data, and the graph bootstrap from that source.
- Use PostgreSQL for relational records and keep vector similarity behind a separate provider adapter. Vector matches are candidates only.
- Store Tier-1 hierarchy as one `parent_id` on each child node. Keep influence as a separate first-class claim with evidence.
- Require a bibliographic citation for published influence claims. Preserve an explicit `unsourced` state for records without citations; do not present that state as scholarly support.
- Attach license terms to each source/dataset. Retain normalized ingestion records and provenance metadata, not full upstream payloads.
- Promote ingestion candidates through human edits and reviewed Git changes.
- Keep canonical names on records and build a separate versioned search index.
- Represent historical phases with bounded date assertions, evidence, and uncertainty notes.
- Identify builds with source commit metadata and a checksum of deterministic outputs.
- Return non-dominated paths with evidence on each step and no combined confidence score.

## Prototype defaults used where the inputs left details open

- A content ID is SHA-256 over a namespaced, immutable `identity_key`; the readable title, summary, dates, and citations can change without changing the ID. The initial imported identity key is frozen in the canonical record. Legacy prototype slugs are kept in an alias file.
- Historical years use negative BCE and positive CE integers, with no year zero. Open bounds are `null`; date labels and uncertainty notes remain display metadata.
- Initial date aspects distinguish tradition scope, textual formation, narrative attestation, work composition/publication, and claim relationship periods. Numeric bounds are filled only when the existing label supports an unambiguous conversion; broad/ambiguous labels retain display text, null bounds, and an explicit review note.
- Path traversal follows the claim's subject-to-object direction by default. Reverse traversal is opt-in and is labeled as exploration, not as a reversed scholarly claim.
- Pareto comparison uses hop count, the weakest edge consensus label, and the weakest edge confidence as separate dimensions. Confidence is an editorial scale, not a probability. Stable IDs break display ties only.
- The graph payload includes node IDs, labels, types, parents, date bounds, and compact relationship fields required to draw/filter. API responses carry a release ID and `ETag`; detail records stay out of the bootstrap.
- `prototype` records are available only in prototype/dev builds. Production publication status and unsourced-node visibility need the open policy below.

## Revisit before production

| Open choice | Options and tradeoffs | Prototype default |
| --- | --- | --- |
| Identity collisions and merges | Add a disambiguator to the immutable key before publication (clear identity, manual curation); mint random collision overrides (fast, less reproducible); after a merge, keep old IDs as aliases to the survivor (stable URLs, one canonical target) or tombstone them (preserves history, requires deleted-record behavior). | Reject duplicate generated IDs; add a stable identity-key suffix before publication. Legacy/merged IDs redirect to the surviving record; never silently recalculate a published ID. |
| Unsourced-node publication | Show in graph and detail with a strong badge (more coverage, higher risk of implied support); detail only (less prominence, clearer graph); do not publish (strictest citation policy, fewer records). | Seed records are `prototype`; production visibility is not implemented. Published claims require evidence. |
| Multiple hierarchy parents | Keep one parent and reject exceptions (simple and consistent with the current sample); move to a relation table (supports contextual/multiple containment at the cost of extra review and cycle rules). | One parent in Tier 1; do not add multi-parent data until the relation-table decision is made. |
| Reverse path traversal | Forward direction only (strongest fidelity to claims); always allow reverse traversal (more connected exploration, easier to misread); user opt-in with an explicit reverse label (exploration without changing the claim). | User opt-in; claim subject/object and `direction` remain unchanged. Unknown direction follows the stored subject-to-object orientation unless reviewed otherwise. |
| Consensus comparison | Order `consensus > majority > contested > fringe` (simple but categorical); treat categories as incomparable (fewer dominance decisions and more output). | Current Pareto comparison uses the ordered categories as one independent dimension. Confidence is a second dimension; neither is combined into a score. |
| Vector provider | PostgreSQL `pgvector` (one service and SQL joins, tighter coupling); separate managed vector store (isolated scaling, extra service/vendor); defer vectors (no discovery benefit yet, simplest operations). | Provider adapter seam only. No vector index or candidate generation is implemented. |
| Multilingual search normalization | Exact Unicode only (preserves every distinction, weaker fuzzy recall); case-fold plus Latin-only mark folding (better common Latin lookup, can merge spellings); curated transliterations (higher recall, editorial work). | Exact written form first, Unicode case-fold and Latin-only mark folding as fallback; no generated transliteration. |

Influence paths currently traverse influence claims only; hierarchy remains separately queryable as containment. Revisit if the product needs mixed containment/influence paths, since their evidence dimensions are not directly comparable.

## Consequences

Canonical JSON is the editorial boundary; PostgreSQL and all interchange/runtime files are reproducible projections. A source edit must pass canonical validation before database loading. The browser can render the compact release without waiting for detail calls. Changing an immutable identity key requires an explicit alias/migration rather than silently minting a different public ID.
