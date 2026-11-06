# Curator proposals

The local editor exports one versioned proposal JSON file at a time. Keep the proposal file with the Git change so reviewers can see curator notes, duplicate override reasons, and date/evidence review flags. Run `ra-pipeline validate-proposal <file>` against the current canonical seed, then preview/apply it with `ra-pipeline apply-proposal <file> [--revalidate] [--apply]`.

Proposals only create `draft` records. They do not write review events, publish, or deploy. A stale base checksum requires `--revalidate` after manual review. `example_only` files can be validated for schema demonstration but the apply command refuses them.

`examples/` contains synthetic samples for Tradition, Text, Story, Work, and proposals with a source or a separate claim. The records and relationship are fictional workflow examples; do not use them as scholarly content.

## Reviewer checklist

- Confirm the node identity, preferred label, alternate names, and external identifiers do not duplicate another record.
- Confirm the selected Tradition/Text/Story/Work role fits the record's place in the graph; resolve the unsure-classification note. A connection is a separate claim with its own evidence.
- Check that the summary is neutral and distinguishes what is known from what is uncertain.
- Check that date aspects, ranges, precision, and uncertainty notes say what the date describes.
- Check source metadata, source links, and license/terms. A published node needs at least one bibliographic source.
- Confirm `parent_id` means containment/context only; review every influence claim separately with its own evidence.
- Leave new records and claims as drafts until review is complete; check contested claims for two citations and two distinct reviewers.
- Keep the proposal JSON with the Git change. Applying it only changes a working tree; it does not mark records reviewed, publish, or deploy them.
