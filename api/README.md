# Backend API and read model

This is the initial backend slice. Canonical data remains in `data/canonical/seed.json`; PostgreSQL is an optional rebuilt relational read model. The build emits a compact graph payload, per-node details, multilingual search index, JSON-LD, Turtle/RDF, CSV, a source-license NOTICE, and a checksum manifest. FastAPI serves graph, search, and checksummed detail artifacts directly, and uses PostgreSQL for database-backed path queries and as the preferred source for details when its release matches.

## Local development

1. Install dependencies from the repository root with `npm install` and `make setup`.
2. Build development artifacts with `make build-prototype`.
3. Start Vite and the reloadable FastAPI server together with `make dev`; open `http://127.0.0.1:5173`. No PostgreSQL setup is needed for the graph, search, record details, source details, or source search.
4. For database-backed path queries, create a PostgreSQL database, apply the initial schema once with `PGURL='postgresql://…' make migrate`, then load the canonical seed with `DATABASE_URL='postgresql+psycopg://…' make load`. Restart development with that `DATABASE_URL` set.

The current canonical records are explicitly marked `prototype`. The regular build includes only `published` records; use `--include-prototype` only for development. Set `RA_EXPORT_DIR` when artifacts are outside `exports/current`. Vite proxies `/v1` and `/health` to the local API, so the browser uses same-origin requests during development. Detail endpoints prefer PostgreSQL only when its release matches the manifest; otherwise they serve the same-release checksummed detail artifacts and mark the response with `X-RA-Read-Source: release-artifacts`. Database-backed path requests still require a matching loaded release. Node.js 20.19+ or 22.12+ is required by Vite 8.

The Explore map remains a curated custom SVG renderer. See the [graph package evaluation](../docs/graph-visualization-packages.md) for options before adopting a graph-rendering or layout dependency.

## API

- `GET /health`
- `GET /v1/graph` — compact bootstrap; returns release ID and ETag.
- `GET /v1/nodes/{id}` — detail, alternate names, external identifiers, date assertions, and sources.
- `GET /v1/nodes/{id}/neighbors?direction=both&limit=100&offset=0` — influence and hierarchy neighbors with paging metadata.
- `GET /v1/claims/{id}` and `GET /v1/sources/{id}` — claim and bibliographic details.
- `GET /v1/search?q=...&limit=20` — separate versioned index, stable node IDs and matched written form.
- `GET /v1/sources?q=...&limit=50` — release-scoped bibliography search with license metadata; only sources used by visible nodes/claims are returned. Exact external identifiers are also indexed by `/v1/search` (use `namespace:value` to disambiguate namespaces).
- `GET /v1/paths?source=...&target=...&max_hops=6&allow_reverse=false` — directed influence paths by default; reverse exploration is explicitly labeled. Optional filters are repeated `relation_types`, `consensus`, `traditions`, plus `min_confidence`, `start_year`, and `end_year`. Returns non-dominated routes and per-edge citations without one combined score. `truncated` reports when the bounded search or result limit was reached.
- `GET /v1/resolve/{kind}/{legacy_id}` — permanent redirect from a prototype slug to its hash ID.

The browser loads `/v1/graph` before making any detail request. The graph, search index, and per-record details are checksummed static release artifacts. Node, neighbor, claim, and source endpoints prefer a matching PostgreSQL release but use the matching artifact data when PostgreSQL is missing, unavailable, or stale. They identify artifact-backed responses with `X-RA-Read-Source: release-artifacts`. Path queries use PostgreSQL; the Explore UI falls back to its local path search on failure. Responses identify the same `release_id`. The browser caches detail requests within that release and reloads its bootstrap if a response identifies a newer release. Neighbor lists are paginated with `limit` and `offset` (maximum page size 200).

## Pipeline commands

`ra-pipeline validate` checks JSON Schema plus unique IDs, frozen identity hashes, references, source licenses, year ranges, hierarchy acyclicity, citation/reviewer publication rules, and guided-path continuity. Database constraints repeat persistence-critical invariants. `ra-pipeline build` writes reproducible artifacts and a commit/checksum manifest. `ra-pipeline stage` accepts already-normalized records and writes provenance plus normalized candidate data; absent or explicitly unverified license metadata is quarantined. It rejects raw-payload fields and never saves upstream payloads.

The initial SQL migration is `api/migrations/001_initial.sql`. Candidate staging is physically separate from curated tables. The current migration records the SQL schema version; deployment automation and rollback procedures are still follow-up work.

## Local curator editor

With `make dev` running, open `http://127.0.0.1:5173/tools/record-editor/`; `make editor` starts Vite and opens that route. The editor stores drafts in that browser's local storage and exports one JSON proposal at a time. Check a proposal and preview its canonical diff with:

```sh
ra-pipeline validate-proposal path/to/proposal.json
ra-pipeline apply-proposal path/to/proposal.json
ra-pipeline apply-proposal path/to/proposal.json --apply
```

The proposal checksum is compared with the canonical seed. If the seed has changed, review the current diff and explicitly revalidate before applying with `--revalidate`. Applied records stay `draft` until a reviewer changes their status in the Git change. The editor has no write API or direct publishing action. `make package-site` runs the Vite production build, then stages only the public Explore entry and its manifest-listed assets under `exports/site-release`; it excludes the local editor.

## Scope limits

There are no source-specific ingestion connectors, authenticated editing, vector-store implementation, or automatic candidate promotion. Vector provider selection and production unsourced-record policy remain open in [ADR 0001](../docs/adr/0001-backend-data-contracts.md). The browser retains `data.js` as a visible fallback for local development when the API cannot be reached.
