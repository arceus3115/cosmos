# Canonical data

`seed.json` is the editable JSON source for the backend. Build outputs, RDF/Turtle, JSON-LD, CSV, the search index, and the PostgreSQL read model are derived from it. The original browser prototype's `data.js` remains a separate UI snapshot until the frontend is wired to the API.

## Identity and edits

Every source, node, and claim has a frozen `identity_key`. The `id` is SHA-256 of `kind + NUL + identity_key`, truncated to 24 hex characters and prefixed `ra:<kind>:`. Keep the identity key unchanged when editing a label, summary, date, or citation. If identity must change, add an explicit mapping to `legacy_aliases.json` and migrate references in a reviewed change. That alias registry includes the old IDs imported from the prototype.

## Record boundaries

- A node stores its canonical label, alternate written forms, dates, evidence status, source references, identifiers, and optional single Tier-1 `parent_id`.
- A date assertion separates aspect, bounds, calendar convention, precision, uncertainty note, and evidence. BCE years are negative, CE years positive, and year zero is not used. `null` means the bound is open or unknown.
- An influence claim has its own stable ID, subject/object, type, direction, confidence, consensus, rationale, source-level evidence, and optional date assertions. It is not a bare graph edge.
- A source stores bibliographic metadata and the dataset/source license note. Keep retrieved data normalized; do not place full source payloads or copyrighted excerpts in this seed.
- A review event records the reviewer, action, timestamp, and resolution note. Published ordinary claims require one reviewer; contested claims require two distinct reviewers and two citations.
- `evidence_status: "unsourced"` is an explicit warning state. It is not equivalent to a citation. New nodes cannot be published until at least one bibliographic source is attached; see [ADR 0002](../../docs/adr/0002-add-record-workflow.md).
- New add-record proposals are held outside the canonical seed until a curator reviews the exported JSON and applies it in a Git branch. Applied node/source/claim records start as `draft`; a published node must have at least one bibliographic source.

## Vocabularies

Node types: `tradition`, `text`, `story`, `work`, `motif`, `figure`, `place`, `period`.  
Influence types: `direct_textual_dependence`, `shared_source`, `motif_parallel`, `oral_diffusion`, `polemical_adaptation`, `reception_commentary`, `tradition_lineage`.  
Direction: `certain`, `probable`, `unknown`. Confidence is an ordinal editorial label from 1–5, not a probability. Consensus: `consensus`, `majority`, `contested`, `fringe`. Lifecycle: `draft`, `reviewed`, `published`, or `prototype`.

Run `ra-pipeline validate-proposal <file>` before `ra-pipeline apply-proposal <file> --apply`. The apply command defaults to a diff preview, blocks stale proposal checksums unless `--revalidate` is supplied, and never publishes or deploys. Run `ra-pipeline validate` before a reviewed data change is promoted. Database constraints repeat persistence-critical checks; the validator adds cross-file and hierarchy checks with record paths.
