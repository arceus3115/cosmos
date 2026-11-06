# Religion Almanac prototype

A dependency-free browser prototype of the Religion Almanac seed graph. The curated sample contains 18 records, 22 typed hierarchy/influence links, a small citation register, two guided paths, and open-data exports.

## Open it

Open `index.html` in a modern browser. If the browser blocks local file behavior, serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Explore

- Select nodes and links to inspect summaries, dates, languages, scholarly claims, and citations.
- Search alternate names, including Hebrew and Greek forms; matching ignores Latin diacritics.
- Filter by tradition, influence type, consensus label, confidence, and overlapping date range.
- Open either guided path or use **Find a path** to rank supported directed routes by confidence and consensus.
- Switch between relationship map, timeline, and the accessible table index.
- Copy a URL that restores the active view and filters. Export the currently visible records as JSON-LD or CSV.

## Data and limits

The interactive page is static HTML, CSS, and JavaScript. `data.js` is the prototype's hand-curated source file; the app does not yet implement the planned YAML/JSON-Schema pipeline, API, database, automated license gate, scholarly review workflow, or deployment setup. Records are marked as prototype seeds, and no reviewer is implied. The source register links to scholarly/institutional references and records the applicable attribution note. No translations or full source texts are bundled.

This is a demonstration-scale selection, not a representative survey of religious traditions. Similarity is labeled separately from direct textual dependence, and edge confidence/consensus fields belong to the sample records rather than a completed peer-review process.
