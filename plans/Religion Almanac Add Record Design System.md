# Religion Almanac: Add a Record Design System

*Design system · 6 November 2026 · Curator-tool decisions selected in [ADR 0002](../docs/adr/0002-add-record-workflow.md)*

## Purpose

Define a consistent way for a curator to propose a **tradition**, **text**, **story**, or **work** for the Religion Almanac. The system helps create a careful record, shows what is known and what is uncertain, and keeps editorial review distinct from publication.

The local curator editor lives in `tools/record-editor/`. It creates proposal JSON; canonical records continue to be edited and reviewed in Git. It has no public write API or direct publication action.

The implementation sequence is in [Add a Record Tickets](Religion%20Almanac%20Add%20Record%20Tickets.md). Core workflow and field decisions are recorded in [ADR 0002](../docs/adr/0002-add-record-workflow.md); the questions near the end are future model decisions and do not block the local editor.

## Outcomes to design for

- A contributor can tell which record type fits their subject and understand ambiguous cases.
- A new record does not duplicate an existing name, alias, or external identifier.
- Dates, names, sources, and uncertainty are captured in a consistent shape.
- Containment (what a record is part of) is kept separate from scholarly claims of influence.
- A draft is visibly incomplete or unreviewed; saving a record does not imply that it is approved or published.
- A reviewer can understand the proposed record and its evidence without reconstructing the contributor's intent.

## Selected type definitions

All four types need plain-language definitions in the flow. Distinguish them by **role in the Almanac**, rather than by medium or whether an item is technically a written work:

| Type | Working definition | Example prompt |
| --- | --- | --- |
| **Tradition** | A historically situated religious, cultural, or literary tradition used as a broad context for records. Avoid implying that a diverse community is uniform or unchanged over time. | “What tradition or historical context does this record belong to?” |
| **Text** | A named textual corpus, scripture, or textual witness treated as a primary source or foundational textual context in the graph. It may have multiple versions, languages, or layers. | “What text or textual collection is this, and which version or layer are you describing?” |
| **Story** | A named narrative subject or episode that may be represented in multiple texts or retellings. Keep it distinct from a particular textual witness and from a later authored adaptation. | “Which narrative or episode are you tracing across texts or retellings?” |
| **Work** | A distinct authored, performed, or adapted creation included because of its place in a transmission or reception story. It can be religious or secular, written or performed. | “What is the work, and how does it relate to other records?” |

These definitions follow role in the Almanac, not medium or sacredness. A textual source can be an authored literary work; classify it as **Text** when the graph uses it as a primary textual anchor, **Story** when the narrative subject itself is being traced, or **Work** when the object being traced is a distinct act of authorship, performance, adaptation, or reception. The interface lets a curator flag **“I’m unsure”** for reviewer resolution. See [ADR 0002](../docs/adr/0002-add-record-workflow.md) for the examples and selected policy.

A connection is a separately sourced claim between records, not another record type. Create the Story, Text, Tradition, or Work first; add any transmission or influence connection as an optional claim with its own evidence and review.

## Contribution flow

### 1. Find or create

Start with a search across canonical labels, name variants, and identifiers. Show likely matches with type, dates, parent/context, and external identifiers. Offer **Open existing record**, **Add a missing name or identifier**, or **This is a new record**. A possible duplicate should be a soft warning with a reason, not a blocking error.

### 2. Choose a record type

Show the four definitions above, a one-line example, and the “not sure” path. If type changes later in the form, retain shared fields and ask the contributor to review fields whose meaning changes, especially dates and parent/context.

### 3. Describe the record

| Field | Suggested control and guidance |
| --- | --- |
| Preferred label | Single-line text; preserve the chosen form and diacritics. |
| Other names | Repeatable rows for written form, language, script, and role (alternate, transliteration, historical, preferred). |
| Summary | Short plain-language paragraph; neutral, descriptive, and explicit about diversity or uncertainty where relevant. |
| Languages | Searchable multi-select or token input; accept named historical languages and modern languages. |
| Dates | One or more date assertions with aspect, earliest/latest year, precision, display label, and uncertainty note. Explain historical BCE/CE entry and that year zero is not used. |
| Context / part of | Search existing records and select at most one parent under the current model. Explain that this records containment/context, not influence. |
| Sources | Select an existing source or add bibliographic metadata; show source license/terms and a link. Keep a citation visually distinct from a source relationship or influence claim. |
| External identifiers | Repeatable namespace/value rows with a resolved link preview when available. |
| External links | Label + URL; validate URL and display host before save. |

### 4. Ask type-specific questions

- **Tradition:** “What historical scope does this label cover?” Encourage a bounded scope and note porous boundaries, internal diversity, and present-day continuity where relevant. Parent tradition should be optional and used only for an explicit hierarchy.
- **Text:** Ask which textual scope is represented (whole corpus, named text, or version/layer), its language or languages, and what a date describes (formation, surviving witness, or another aspect). Ask for an edition or source locator when known.
- **Story:** Ask whether the label names the narrative subject or a specific textual account. Use narrative attestation for dates where relevant; describe recurring versions in the summary, and use separately sourced claims for specific transmission or influence relationships.
- **Work:** Ask for creator/attribution when known, medium or form, and what date refers to (composition, first performance, or publication). Ask for the tradition/context separately from any proposed source or adaptation relationship.

Type-specific fields beyond the common schema are design candidates. The current canonical node schema has no structured creator, medium, edition, or text-scope fields; these details should not be silently squeezed into unrelated fields. Decide whether they merit schema changes or remain in sourced summaries before building a form.

### 5. Preview, save, and export

Show a compact preview in the same hierarchy/detail style as the public record: label, type, summary, date with uncertainty, parent/context, names, identifiers, and citations. Include a **“What this does not assert”** preview for the selected parent and any drafted influence claim when that distinction could be misunderstood.

Possible actions:

- **Save draft** — preserves incomplete work; clearly private/unreviewed.
- **Validate & export JSON** — checks required structure, duplicate warnings, evidence and license completeness, then downloads a reviewable proposal.
- **Cancel** — confirm only if unsaved changes would be lost.

Do not use a generic “Publish” action in the editor. Applying a proposal creates draft records; a successful export does not imply review, approval, or publication.

## Content and interaction patterns

- **One concept per field.** Put dates in date assertions, names in name variants, citations in sources, and scholarly influence in claims.
- **Explain terms inline.** Define “textual formation,” “surviving witness,” “part of,” “identity key,” and “consensus” at the point of use; keep specialist vocabulary available in optional help.
- **Preserve source forms.** Do not normalize spelling, script, capitalization, or diacritics in saved labels. Search normalization is separate from editorial data.
- **Represent uncertainty visibly.** Permit open date bounds and explicit uncertainty notes. Avoid making a vague estimate look exact just to satisfy a control.
- **Separate absent from unknown.** Empty optional fields mean not provided; an explicit “unknown” or “unsourced” state should be used only where the schema and product define that meaning.
- **Use stable, non-color status cues.** Draft, needs review, reviewed, published, and unsourced states need text and accessible indicators, not color alone.
- **Offer progressive detail.** Keep the minimum path short; expose name variants, multiple dates, identifiers, and citation notes through repeatable “Add another” sections.

## Validation and feedback

Use field-level messages, preserve entered values after an error, and summarize remaining issues before submission. Suggested checks:

- Required identity and display fields are present; labels and aliases are checked for likely duplicates.
- Parent references resolve, are type-appropriate, and do not create hierarchy cycles.
- Date bounds use the historical BCE/CE convention; open bounds are supported; display text and numeric bounds are not contradictory.
- Language, script, and name-role values use the controlled vocabulary or clearly mark an extension for review.
- Source metadata includes its license/terms. Published claims require evidence under the current contracts; an unsourced node is clearly marked and remains subject to the separate publication policy.
- Each external identifier is unique within its namespace where appropriate, and links resolve or are clearly labeled unchecked.
- A changed record preserves its stable identity key. The contributor should not edit generated IDs directly.

Validation should distinguish **blocking errors** (invalid references, malformed dates, missing required structure) from **review warnings** (possible duplicate, uncertain classification, missing optional identifier, weakly located citation). Warnings explain their consequence and remain visible in the review proposal.

## Add relationships as a separate step

After the record is saved, offer **Add a relationship** as a distinct task:

1. Choose the other record.
2. Choose a controlled relationship type (for example direct textual dependence, shared source, motif parallel, oral diffusion, reception/commentary, or tradition lineage).
3. State direction and uncertainty; explain that similarity alone does not establish transmission.
4. Add rationale and supporting sources.
5. Save as a claim for review, with its own identity and lifecycle.

This keeps `parent_id`/`part_of` as containment under the current model. A work's parent does not assert that the parent influenced it, and an influence claim does not make the work a child of its source.

## Current model fit and future questions

The existing canonical JSON model already supports a common label, summary, multilingual name variants, languages, one optional parent, external IDs/links, date assertions, sources, and separate influence claims. It also has immutable identity keys and lifecycle statuses.

The prototype defers these broader changes:

1. **Structured authorship/edition metadata:** Add creator, attribution confidence, medium/form, edition/version, or text-scope fields only when the product needs structured filtering or export. For this release, put essential context in the sourced summary and bibliographic entry.
2. **Multi-parent hierarchy:** The current editor uses one optional `parent_id`; a broader relation model needs its own schema and review rules.
3. **Node-level citation locators:** The current node source list is bibliographic. Passage/page/tablet locators are a future model change.
4. **Shared drafts and merges:** The editor stores drafts in one browser. Multi-curator collaboration, merge requests, and identity redirects remain Git/editorial tasks.

## Implementation and review

Use the [Add a Record Tickets](Religion%20Almanac%20Add%20Record%20Tickets.md) backlog for implementation and the curator handoff. Every exported proposal should be checked with `ra-pipeline validate-proposal` before it is applied to a Git branch.
