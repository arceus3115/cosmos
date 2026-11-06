# Religion Almanac: Add a Record Tickets

*Execution snapshot · 6 November 2026 · Build implemented; acceptance verification remains*

This backlog turns the [Add a Record Design System](Religion%20Almanac%20Add%20Record%20Design%20System.md) brainstorm into reviewable work. It follows the existing canonical JSON → validation → reviewed Git change workflow and uses the Vite-served JavaScript frontend and Python pipeline.

## Selected first-release boundary

Build a **local curator tool** that produces reviewable proposal files. It has no accounts, public write API, direct publication, or anonymous submission path. A curator exports a proposal, validates it, and applies it to the canonical seed in a branch for normal Git review. This keeps the tool compatible with the system plan's out-of-scope user accounts and crowdsourced editing.

These decisions are recorded in [ADR 0002](../docs/adr/0002-add-record-workflow.md). The local editor, proposal schema/CLI, API lookup support, and curator handoff are implemented against this boundary.

## Implementation status

The code and documentation for AR-001 through AR-012 are in the working tree. The Vite production build, all four example proposal validations, and database-free detail API checks for 18 nodes, 8 claims, and 7 sources pass. The running API was also checked after restart. The complete browser authoring workflow and adversarial fixtures still need an acceptance pass.

| Ticket | Implementation status | Main deliverables |
| --- | --- | --- |
| AR-001 | Implemented | ADR 0002, selected field/type matrix, seed classification inventory, owners and revisit triggers |
| AR-002 | Implemented | Versioned proposal schema and synthetic Tradition, Text, Story, Work, source, and claim examples |
| AR-003 | Implemented; acceptance verification pending | `validate-proposal`, canonical reference/hierarchy/date/license/identity checks, duplicate and curator-note warnings |
| AR-004 | Implemented; acceptance verification pending | Diff preview, explicit `--apply`, stale checksum gate, draft-only import, collision protection |
| AR-005 | Implemented; browser verification pending | Loopback editor target, local draft storage, public-site allowlist |
| AR-006 | Implemented; browser verification pending | Type guidance, release-scoped node/identifier search, detail view, existing-record name/ID proposal |
| AR-007 | Implemented; browser verification pending | Shared name, summary, language, parent, and link fields with repeatable keyboard controls |
| AR-008 | Implemented; browser verification pending | Type-specific date prompts, open bounds, precision, uncertainty, evidence, and review flags |
| AR-009 | Implemented; browser/API verification pending | Active-release source search, source selection, license capture, identifiers, links, duplicate lookup |
| AR-010 | Implemented; browser verification pending | Separate optional influence-claim controls with direction, confidence, consensus, date label, rationale, and evidence |
| AR-011 | Implemented; browser verification pending | Review preview, warning notes, local draft save/select/duplicate/delete, proposal export |
| AR-012 | Implemented; workflow verification pending | Curator handoff instructions and reviewer checklist |

The implementation map and remaining acceptance work are described in the tickets below. Treat the backlog's acceptance criteria as not yet signed off until the verification pass is completed.

**Ticket sizing:** S = up to one day; M = two to three days. Estimates are implementation effort, excluding scholarly review and product decisions.

## AR-001 · Lock the authoring and classification contract

**Size:** S · **Depends on:** none · **Blocks:** all other AR tickets

Resolve and record the decisions needed to build one coherent first release:

- Define Tradition, Text, Story, and Work by their role in the Almanac; classify representative existing records and note ambiguous examples. Keep a connection as an optional, separately sourced claim.
- Confirm the local curator tool and manual Git review workflow described above.
- Decide which structured Work/Text fields are needed (creator/attribution, medium/form, edition/version, text scope) and which stay in sourced summaries.
- Define minimum node-source evidence, locator expectations, and the publication treatment of unsourced nodes; keep these rules distinct from the existing influence-claim rules.
- Define what a proposal may contain, how its immutable identity key is chosen, and how an exported proposal becomes canonical draft records for Git review without changing published IDs.
- Define the user-visible labels and lifecycle for a proposal versus a draft, reviewed record, and published record.

**Deliverable:** an ADR plus an updated field/type matrix in the design system document. Record the owner and revisit triggers for each choice.

**Acceptance:** the ADR has one selected first-release workflow; every field in the form maps to a canonical field or is explicitly excluded; every current seed node typed `tradition`, `text`, `story`, or `work` is listed with its selected type and a reason for any reclassification; no later ticket depends on an unresolved field or lifecycle choice.

## AR-002 · Define the proposal-file schema

**Size:** M · **Depends on:** AR-001

Add a versioned JSON Schema for an exported new-record or existing-record name/identifier proposal. The format represents the proposed node or targeted record change, any new source records, separately proposed influence claims, the base release and canonical checksum, and curator notes. Use generated stable IDs as references for records created together in one proposal. Do not put full source text or copyrighted excerpts in a proposal.

**Acceptance:** examples cover one tradition, one text, one story, one work, a proposal with a new source, and a proposal with a separate influence claim; valid examples pass and malformed references, unknown vocabulary, missing license metadata, and unsupported fields fail with JSON paths; schema documentation states what applying a proposal will change.

## AR-003 · Validate proposals against the canonical graph

**Size:** M · **Depends on:** AR-002

Add `ra-pipeline validate-proposal <file>` using the proposal schema and current canonical seed. Check required fields, identity-key/hash consistency, node and source references, parent type/existence/cycles, date conventions, licenses, duplicate labels/aliases/identifiers, and the approved publication/evidence rules. Report likely duplicates and unresolved scholarly questions as warnings; reject invalid structure and broken references as errors.

**Acceptance:** the command exits nonzero for every blocking error and prints the proposal path plus field path; warning output does not claim that similarity establishes identity; fixtures cover valid records, exact and likely duplicates, year zero, unknown parent, hierarchy cycle, missing source license, and invalid claim evidence; validating a proposal does not modify files.

## AR-004 · Apply a proposal to the canonical seed for Git review

**Size:** M · **Depends on:** AR-003

Add `ra-pipeline apply-proposal <file>` that first validates the proposal, then adds its node/sources/claims or targeted name/identifier changes to `data/canonical/seed.json` using the repository's stable IDs. Default to a diff preview; require an explicit `--apply` flag to modify the working tree. Set each new record's lifecycle to `draft` so the proposal is not accidentally published. Git review happens after application, in the branch/PR. Reject collisions and stale base release/checksum values unless the curator explicitly revalidates against the current seed.

**Acceptance:** default output lists every added record and generated ID without modifying the seed; `--apply` changes only intended canonical arrays; applying the same proposal twice fails with an actionable message and leaves the seed unchanged; a collision never overwrites a record; the resulting Git diff is reviewer-visible and the command does not publish/deploy or invent a completed review event.

## AR-005 · Add a local record-editor entry point

**Size:** S · **Depends on:** AR-001, AR-002

Create a separate local authoring page under `tools/record-editor/`, launched by a dedicated Make target that binds only to `127.0.0.1`. Keep it out of the public Explore navigation and site release artifacts. Add an explicit site-packaging allowlist if the publication workflow currently copies the repository wholesale. The tool uses the existing read-only graph/search API for lookup, keeps unfinished drafts in browser storage, and does not call a write endpoint.

**Acceptance:** `make editor` starts the editor at a documented localhost URL and binds to loopback; the development Explore header has an Add a record link, while the production site artifact excludes that link and the editor page/assets; a reload restores an unfinished local draft; clearing one draft does not clear unrelated drafts; no HTTP write request is made by the editor.

## AR-006 · Build type selection and duplicate search

**Size:** M · **Depends on:** AR-005

Implement the first step of the flow with the AR-001 definitions and examples. Search current canonical records by preferred label and alternate names using `/v1/search`; add exact external-identifier lookup to the search index/API. Show likely matches with type, dates, parent/context, and matched form; allow opening a match, adding a name/identifier proposal, or continuing as new after a warning.

**Acceptance:** the contributor sees all four definitions before entering record details; a Story is described as a narrative subject distinct from its text witness or authored adaptation; the unsure-classification path is saved into curator notes; exact label and alias matches use the existing search API, exact external-identifier matches return the stable node ID and namespace/value, and selecting a result loads its current detail; search failure is visible and does not silently imply no match; a warning can be overridden with a recorded reason.

## AR-007 · Implement shared record fields

**Size:** M · **Depends on:** AR-005, AR-006

Build reusable form controls for preferred label, multilingual name variants, summary, languages, and optional parent/context. Preserve entered spelling and diacritics. Parent selection must explain that `part_of` is containment/context and is separate from influence.

**Acceptance:** repeatable name rows capture value, language, script, and approved name role; summary length and required-field rules match the schema; language values and parent choices serialize to the approved proposal shape; changing record type preserves compatible values and clearly marks fields requiring review; keyboard users can add/remove rows and select parents.

## AR-008 · Implement type-specific date and metadata fields

**Size:** M · **Depends on:** AR-001, AR-007

Add Tradition, Text, Story, and Work guidance and date prompts using the approved field matrix. Include narrative attestation for Story dates. Support multiple date assertions, open bounds, precision, display label, uncertainty note, and evidence links. Add only the structured metadata chosen in AR-001; do not add ad hoc fields.

**Acceptance:** date aspects distinguish historical scope, textual formation/witness, and work composition/performance/publication as selected in the ADR; BCE/CE help states no year zero; empty bounds remain open rather than becoming zero; type-specific examples serialize to the proposal schema; display label/bounds conflicts are surfaced for review.

## AR-009 · Add sources, licenses, and external identifiers

**Size:** M · **Depends on:** AR-002, AR-007

Allow selecting an existing source or proposing a new bibliographic source with title, author, container/publisher, year, URL, and license/terms. Add a read-only, release-scoped source list/search endpoint if the current API does not expose enough data to select a source. Add repeatable external identifier and link rows. Keep node sources visually separate from influence-claim evidence.

**Acceptance:** the source endpoint returns only records from the active release and includes license metadata; a new source carries required license metadata; existing sources are referenced by stable ID; invalid URLs and likely duplicate identifiers are explained before export; all source and identifier data round-trips through the proposal schema; no full text or unlicensed excerpt can be entered.

## AR-010 · Add influence claims as a separate task

**Size:** M · **Depends on:** AR-002, AR-006, AR-009

After node details are saved, offer a separate relationship step. Capture the other node, relation type, direction, direction certainty, confidence, consensus, rationale, dates, and supporting sources. Make it clear that a parent choice is not a source/influence assertion and a motif parallel does not prove transmission.

**Acceptance:** claims receive their own proposal identity and are linked to evidence sources; contested claims meet the approved citation rule; missing evidence blocks a claim from being marked for publication; saving a node without a claim remains possible; no claim is added to the canonical graph until review/application.

## AR-011 · Add record preview, draft management, and proposal export

**Size:** M · **Depends on:** AR-003, AR-007, AR-008, AR-009, AR-010

Build a final review step showing the resulting record and any proposed sources/claims, warnings, and fields not asserted. Support save, duplicate, delete, and export of a versioned proposal JSON file. Export must run client-side proposal validation before download and must not label the file published.

**Acceptance:** preview matches the saved proposal values, including uncertainty and source attribution; blocking errors prevent export; warnings remain visible in the exported review notes; export can be opened by `validate-proposal`; downloaded files contain no browser storage contents from other drafts; draft and proposal lifecycle labels are unambiguous.

## AR-012 · Document curator handoff and reviewer checklist

**Size:** S · **Depends on:** AR-004, AR-011

Document the workflow from `make editor` through draft export, proposal validation, `apply-proposal`, scholarly/Git review, and release. Add a compact reviewer checklist covering identity/duplicate, classification, neutral summary, dates/uncertainty, source/license, hierarchy semantics, claims/evidence, and publication status.

**Acceptance:** a new curator can follow the documented example from editor launch to a canonical JSON diff and a review-ready PR; each checklist item maps to a schema rule, validator warning, or human review step; documentation says explicitly that applying a proposal only changes a working tree and does not mark it reviewed, publish, or deploy it.

## Dependency order

```text
AR-001 → AR-002 ─→ AR-003 → AR-004
          │
          └→ AR-005 → AR-006 → AR-007 ─→ AR-008 ─┐
                                     └→ AR-009 → AR-010
AR-003 + AR-007 + AR-008 + AR-009 + AR-010 → AR-011 → AR-012
```

AR-009 can be developed alongside AR-008 after AR-007. AR-012 closes only after the CLI and editor workflows are both usable.

## Release exit criteria

- A curator can draft one Tradition, one Text, one Story, and one Work, with saved spelling, sources, dates, and uncertainty; any connection remains a separate optional claim.
- Duplicate checks include names and external identifiers.
- A node can be proposed without an influence claim; any claim is separately evidenced.
- An exported proposal passes the CLI validator, applies to the canonical seed as a clear diff, and survives the existing canonical validation/build workflow.
- No UI or command can directly publish or deploy a proposal.
- Keyboard-only use, visible focus, field error association, and non-color status cues are checked before the local editor is handed off.
