# ADR 0002: Add-record authoring workflow

**Status:** Selected for the curator-tool prototype  
**Date:** 2026-11-06  
**Scope:** AR-001–AR-012

## Context

The Explore site reads a published/prototype graph and has no authenticated write API. The existing editorial source is canonical JSON in Git. We need a repeatable way for a curator to propose a Tradition, Text, Story, or Work without turning the public graph into an unreviewed submission surface. A relationship between records remains a separate sourced claim.

## Decisions

### Authoring and promotion

- The first authoring surface is a local curator tool, served on loopback only. It has no account system and no public write API.
- The editor stores in-progress drafts in that browser's local storage and exports one versioned JSON proposal at a time.
- A proposal contains one new node or a targeted addition of missing name variants/external identifiers to an existing node, any newly proposed bibliographic sources, separately represented influence claims, its base dataset release/checksum, and curator notes. An existing-record change cannot bundle a new claim or source.
- Applying a proposal creates canonical records with `status: "draft"`; it does not add review events, set records to `reviewed`/`published`, or deploy anything. Scholarly review and release continue through the ordinary Git change process.
- The importer shows a diff by default. `--apply` is required to modify the working tree. A stale canonical checksum requires explicit `--revalidate`, which reruns validation against the current seed.
- `identity_key` and generated IDs are frozen when the draft identity is first established. Editing the label later does not change them. A merge or identity correction uses the existing alias/migration workflow.

### Record type definitions

- **Tradition:** a historically situated religious, cultural, or literary context. The summary must avoid presenting internally diverse communities as uniform. A parent is optional and means an explicit hierarchy only.
- **Text:** a textual corpus, collection, textual tradition, or named textual source used as a primary textual anchor in the graph. It can be religious or literary.
- **Story:** a named narrative subject or episode that may appear in multiple texts or retellings. It is distinct from a particular textual witness and from a later authored adaptation.
- **Work:** a distinct authored, performed, or adapted creation represented because its authorship, production, adaptation, or reception is being traced. It can be religious or secular.
- Classify by the record's role in the Almanac, not medium, sacredness, or title. One entity receives one node type. A standalone work may be a Text when the graph treats it as a primary textual source; a Story node represents the narrative subject; a separate Work node represents a distinct authored/adapted object being traced. A connection between these records is an optional claim with its own evidence and review lifecycle.

Current seed classifications remain unchanged. This inventory lists every current Tradition, Text, Story, and Work node; each retains its existing type:

| ID | Label | Selected type | Classification note |
| --- | --- | --- | --- |
| `ra:node:07daaa2359c148bacc726f54` | Early modern Europe | Tradition | Retain as historical context. |
| `ra:node:1c3d6441cf5cf281fd9b458f` | Atra-ḫasīs Epic | Text | Retain as a named textual source in the graph. |
| `ra:node:1bc917c241ffa946f5da1fae` | The flood of Atra-ḫasīs | Story | Retain as the narrative subject represented in the Atra-ḫasīs Epic. |
| `ra:node:31d535440cdc136a3837333e` | Mesopotamian traditions | Tradition | Retain as a broad historical tradition. |
| `ra:node:36cfa8e5fa28462fa1944d18` | Histoires tragiques | Text | Retain as a source text in the adaptation chain. |
| `ra:node:4d4c82372a65f39b405fab6f` | Genesis · בְּרֵאשִׁית | Text | Retain as a named textual source. |
| `ra:node:518be0a7ef3189eda7b59dcd` | Romeo e Giulietta | Text | Retain as a source text in the adaptation chain. |
| `ra:node:6842dc23f881e981fe399bea` | Metamorphoses | Text | Retain as a named textual source. |
| `ra:node:785a964ff7f630a02284370c` | Pyramus and Thisbe | Story | Retain as the narrative subject represented in Metamorphoses and later reception. |
| `ra:node:69ec3665f2987a22dfcd522c` | Jewish traditions | Tradition | Retain as a broad historical tradition. |
| `ra:node:6a321f8f77129c981774c3af` | Romeo and Juliet | Work | Retain as a distinct authored play. |
| `ra:node:ad641f7f99fd572c03cd2972` | Uta-napišti’s flood | Story | Retain as the narrative subject represented in the Epic of Gilgamesh. |
| `ra:node:c06c33aaf22addf5c6184700` | Noah and the flood | Story | Retain as the narrative subject represented in Genesis. |
| `ra:node:843965f1d2e2f0c3e175453e` | A Midsummer Night’s Dream | Work | Retain as a distinct authored play. |
| `ra:node:c4de2c905f7ac39511d0d8e3` | Giulietta e Romeo | Text | Retain as a source text in the adaptation chain. |
| `ra:node:dee6fb10521e95b452af7086` | Romeus and Juliet | Text | Retain as a source text in the adaptation chain. |
| `ra:node:e5fac6e07d065a575d444d99` | Epic of Gilgamesh | Text | Retain as a named textual source. |
| `ra:node:fdc869a57f0ef30f7cf59086` | Greco-Roman literature | Tradition | Retain as a broad literary context. |

For the Text/Story/Work boundary, textual witnesses remain Text records, narrative subjects such as flood or Pyramus and Thisbe remain Story records, and Shakespeare's plays remain later creative Works. The add-record tool does not reclassify existing seed records.

### Field mapping

| Prompt or concept | Canonical representation |
| --- | --- |
| Preferred label and alternate forms | `label`, `name_variants` |
| Creator, attribution, medium/form, edition/version, or text scope | Include only when materially useful in the sourced `summary`; bibliographic details belong in `sources`. No new node-specific columns in this slice. |
| Historical scope / textual formation / surviving witness / narrative attestation / composition or publication | `date_assertions`, with the aspect named explicitly |
| Context or containment | Single optional `parent_id` with `hierarchy_relation: "part_of"`; never use it to claim influence |
| Node bibliography | `source_ids` |
| Date evidence | `date_assertions[].evidence_source_ids` |
| Scholarly transmission or relationship | Separate `claim` with its own sources and review lifecycle |
| Uncertainty in dates or classification | `uncertainty_note` for dates; `curator_notes` in the proposal for uncertain type or duplicate overrides |

### Evidence and lifecycle

- A source is bibliographic metadata with a required, non-empty license/terms note. No full texts or copyrighted excerpts are collected.
- A new node can be saved as a draft with no source, in which case it is marked `evidence_status: "unsourced"`.
- A node cannot be marked `published` unless it has at least one bibliographic source and is marked `sourced`.
- A new influence claim is a draft; publication still requires the existing evidence/reviewer checks. Contested published claims require two citations and two distinct reviewers.
- The source list stores no per-node locator in this release. A bibliography entry may include a locator in its title/container metadata when needed; dedicated node-evidence locators are deferred.

### Identity and proposal references

- The editor starts node identity keys as `node|<initial-type>|<initial-preferred-label>` and freezes the key once the initial proposal is saved. Curators may append a stable disambiguator before first save when two distinct entities share the same label.
- New source and claim identity keys are similarly established at creation and then frozen. Stable IDs are SHA-256 of `kind + NUL + identity_key`, truncated to 24 hexadecimal characters and prefixed `ra:<kind>:`.
- Proposal records carry their generated stable IDs, so a new claim can point to the new node and proposed sources without temporary identifiers. The validator confirms every generated ID and reference against the canonical graph.
- Date IDs follow the existing validator rule: `ra:date:` plus the first 24 hex characters of SHA-256 over `date + NUL + owner_id + "|" + aspect`. A node or claim has at most one assertion per aspect in the editor.

## Consequences

- The editor is useful for a trusted local curator and produces reviewable Git diffs. It is not a collaborative editing service.
- Node summaries remain the only node field for creator/form/version explanations until a future model change is justified.
- Local browser drafts are not a backup. Exported proposals are the portable artifact; curators should keep them in their review branch.
- External identifier matching is exact and namespace-aware. Name similarity only raises a warning and never asserts identity.
- The publish package uses an explicit file allowlist so the local editor cannot enter the public site artifact.

## Decision owners and revisit triggers

| Decision | Owner | Revisit when |
| --- | --- | --- |
| Local curator workflow and Git handoff | Project maintainer | More than one curator needs shared drafts, access control, or an authenticated submission workflow. |
| Tradition / Text / Story / Work definitions and classification | Project maintainer with a scholarly editor | Curators repeatedly disagree on classification or the graph begins representing new kinds of entities. |
| Summary-only creator/form/version metadata | Project maintainer with a data-model reviewer | These values need filtering, structured export, or independent attribution/confidence tracking. |
| Source and publication evidence rules | Project maintainer with a scholarly editor | The project adopts node-level locators, alternate source roles, or a different publication policy. |
| Stable identity and proposal contents | Project maintainer | Identity migrations, collaborative drafts, or richer proposal operations become necessary. |
| Draft/reviewed/published lifecycle | Project maintainer and release reviewer | A CMS or formal multi-reviewer workflow replaces Git-based review. |

## Revisit when

- More than one curator needs concurrent drafts or shared workflow state.
- Creator, attribution confidence, edition/version, medium, or text-scope needs to be filtered or exported as structured metadata.
- Node-level passage locators or competing node descriptions become a product requirement.
- The project adopts a CMS or authenticated contribution service.
