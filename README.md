# Religion Almanac prototype

A Vite-powered browser prototype of the Religion Almanac seed graph. The curated sample contains 18 records, 22 typed hierarchy/influence links, a small citation register, two guided paths, and open-data exports.

## Start the front end and API

Install the Node and Python dependencies once:

```sh
npm install
make setup
```

Build the release artifacts and start the front end and API together:

```sh
make build-prototype
make dev
```

Open `http://127.0.0.1:5173`. Vite serves the Explore app with hot reload and proxies `/v1` and `/health` to FastAPI on port 8000. The record editor is at `http://127.0.0.1:5173/tools/record-editor/`. The checked release artifacts provide graph, search, record, source, and claim details without PostgreSQL. Configure PostgreSQL when you want database-backed path queries; the Explore app uses its local path search when that read model is unavailable. `make frontend` starts only Vite; `make api` starts only the API.

## Add a record (local curator workflow)

With `make dev` running, open the editor route. Alternatively, `make editor` starts Vite and opens that route. The local editor saves unfinished drafts in this browser and exports proposal JSON. Validate and preview/apply a proposal in a Git branch with `ra-pipeline validate-proposal` and `ra-pipeline apply-proposal`; the apply command never publishes or deploys. See [the add-record ADR](docs/adr/0002-add-record-workflow.md) and [curator workflow tickets](plans/Religion%20Almanac%20Add%20Record%20Tickets.md).

## Explore

- Select nodes and links to inspect summaries, dates, languages, scholarly claims, and citations.
- Search alternate names, including Hebrew and Greek forms; matching ignores Latin diacritics.
- Filter by tradition, influence type, consensus label, confidence, and overlapping date range.
- Open either guided path or use **Find a path** to see directed routes that remain non-dominated across hop count, consensus, and confidence.
- Switch between relationship map, timeline, and the accessible table index.
- Copy a URL that restores the active view and filters. Export the currently visible records as JSON-LD or CSV.

The current custom SVG renderer and graph-package options are compared in [the graph visualization evaluation](docs/graph-visualization-packages.md).

## Data and limits

The interactive page is static HTML, CSS, and JavaScript. It loads the compact graph from `/v1/graph`, then retrieves node, claim, and citation details when selected. Search uses the release index; checked artifact details keep record inspection and the source register usable without PostgreSQL. PostgreSQL powers the optional database-backed path query, with local path search as fallback. If the API itself is unavailable, the bundled `data.js` seed remains an identified development fallback. Records remain marked as prototype seeds, and no reviewer is implied. The source register links to scholarly/institutional references and records the applicable attribution note. No translations or full source texts are bundled.

This is a demonstration-scale selection, not a representative survey of religious traditions. Similarity is labeled separately from direct textual dependence, and edge confidence/consensus fields belong to the sample records rather than a completed peer-review process.

## Backend prototype

The first backend processing and API slice now lives alongside the static prototype. The editable JSON seed is in `data/canonical/seed.json`; schema, validation, deterministic exports, candidate staging, PostgreSQL migration/loader, API endpoints, and connected front-end startup are documented in [api/README.md](api/README.md). The current sample records remain marked `prototype`; review the remaining contracts in [ADR 0001](docs/adr/0001-backend-data-contracts.md) before treating any build as a production release.

To build the public static Explore site, run `make package-site`; Vite bundles the public entry and the packaging allowlist excludes the local curator editor. The default API base `/` expects the deployed API at the same origin; change the `almanac-api-base` meta tag before packaging if it is hosted elsewhere.
