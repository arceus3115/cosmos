"""FastAPI surface for compact graph delivery and on-demand relational detail."""

from __future__ import annotations

import hashlib
import json
import os
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .paths import non_dominated_paths

app = FastAPI(title="Religion Almanac API", version="1.0.0")
_default_origins = (
    "http://127.0.0.1:5173", "http://localhost:5173",
    "http://127.0.0.1:5500", "http://localhost:5500",
)
_allowed_origins = tuple(
    origin.strip()
    for origin in os.environ.get("RA_ALLOWED_ORIGINS", ",".join(_default_origins)).split(",")
    if origin.strip()
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # Local static servers and editor previews commonly choose a non-default
    # port. Keep development access on loopback without opening CORS to LAN or
    # public origins.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET"],
    allow_headers=["If-None-Match"],
    expose_headers=["ETag", "X-RA-Release", "X-RA-Read-Source"],
)


@lru_cache(maxsize=1)
def _engine() -> Engine:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
    return create_engine(database_url, pool_pre_ping=True)


def _export_dir() -> Path:
    return Path(os.environ.get("RA_EXPORT_DIR", "exports/current"))


def _manifest() -> dict[str, Any]:
    manifest_path = _export_dir() / "build-manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=503, detail="A graph release is not built") from error
    if not isinstance(manifest, dict):
        raise HTTPException(status_code=503, detail="The graph release manifest has an invalid shape")
    return manifest


def _release(manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = manifest or _manifest()
    try:
        with _engine().connect() as connection:
            database_release = connection.execute(text("""
                SELECT dataset_release, canonical_checksum FROM data_releases WHERE singleton_id = 1
            """)).mappings().first()
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="The relational read model is unavailable; check DATABASE_URL and PostgreSQL connectivity",
        ) from error
    if not database_release:
        raise HTTPException(status_code=503, detail="The relational read model has not been loaded")
    if (database_release["dataset_release"] != manifest["dataset_release"]
            or database_release["canonical_checksum"] != manifest["canonical_checksum"]):
        raise HTTPException(status_code=503, detail="Graph artifacts and database are from different releases")
    return manifest


def _status_filter(manifest: dict[str, Any]) -> str:
    return "('published','prototype')" if manifest["publication_mode"] == "published_plus_prototype" else "('published')"


def _conditional_cache(
    request: Request, response: Response, manifest: dict[str, Any], cache_key: str
) -> Response | None:
    digest = hashlib.sha256(f"{manifest['output_checksum']}\0{cache_key}".encode("utf-8")).hexdigest()
    etag = f'"{digest}"'
    headers = {
        "ETag": etag,
        "X-RA-Release": manifest["release_id"],
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    }
    response.headers.update(headers)
    supplied = {value.strip() for value in request.headers.get("if-none-match", "").split(",")}
    if etag in supplied:
        return Response(status_code=304, headers=headers)
    return None


def _read_json_artifact(name: str, manifest: dict[str, Any]) -> dict[str, Any]:
    artifact_path = _export_dir() / name
    try:
        content = artifact_path.read_bytes()
    except OSError as error:
        raise HTTPException(status_code=503, detail=f"Artifact {name} is unavailable") from error
    expected = manifest.get("artifact_checksums", {}).get(name)
    actual = hashlib.sha256(content).hexdigest()
    if not expected or actual != expected:
        raise HTTPException(status_code=503, detail=f"Artifact {name} does not match its release manifest")
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=503, detail=f"Artifact {name} is not valid JSON") from error
    if not isinstance(payload, dict):
        raise HTTPException(status_code=503, detail=f"Artifact {name} has an invalid shape")
    return payload


def _use_release_artifacts(manifest: dict[str, Any], response: Response) -> bool:
    """Use checksummed release files for read-only detail when PostgreSQL is down."""
    try:
        _release(manifest)
    except HTTPException as error:
        if error.status_code != 503:
            raise
        response.headers["X-RA-Read-Source"] = "release-artifacts"
        return True
    response.headers["X-RA-Read-Source"] = "postgresql"
    return False


def _detail_artifacts(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    names = sorted(
        name for name in manifest.get("artifact_checksums", {})
        if name.startswith("details/") and name.endswith(".json")
    )
    return [_read_json_artifact(name, manifest) for name in names]


def _node_artifact(node_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    name = f"details/{quote(node_id, safe=':')}.json"
    if name not in manifest.get("artifact_checksums", {}):
        raise HTTPException(status_code=404, detail="Node not found")
    return _read_json_artifact(name, manifest)


def _artifact_source_map(details: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        source["id"]: {**source, "publication_year": source.get("publication_year", source.get("year"))}
        for detail in details for source in detail.get("sources", [])
    }


def _artifact_node_detail(node_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    detail = _node_artifact(node_id, manifest)
    node = detail["node"]
    source_ids = set(node.get("source_ids", [])) | set(node.get("hierarchy_evidence_source_ids", []))
    sources = {source["id"]: source for source in detail.get("sources", [])}
    names = [{"value": node["label"], "language": None, "script": None, "role": "preferred"}]
    names.extend(node.get("name_variants", []))
    return {
        "release_id": manifest["release_id"], "node": node, "names": names,
        "external_identifiers": node.get("external_identifiers", []),
        "sources": [sources[source_id] for source_id in sorted(source_ids) if source_id in sources],
        "date_assertions": node.get("date_assertions", []),
    }


def _artifact_claim_detail(claim_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    for detail in _detail_artifacts(manifest):
        claim = next((item for item in detail.get("claims", []) if item["id"] == claim_id), None)
        if claim:
            sources = {source["id"]: source for source in detail.get("sources", [])}
            evidence = [
                {**sources[source_id], "locator": None, "note": None}
                for source_id in claim.get("evidence_source_ids", []) if source_id in sources
            ]
            return {
                "release_id": manifest["release_id"], "claim": claim,
                "evidence": evidence, "date_assertions": claim.get("date_assertions", []),
            }
    raise HTTPException(status_code=404, detail="Claim not found")


def _artifact_source_detail(source_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    details = _detail_artifacts(manifest)
    sources = _artifact_source_map(details)
    source = sources.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    cited_nodes: dict[str, dict[str, str]] = {}
    cited_claims: dict[str, dict[str, str]] = {}
    for detail in details:
        node = detail["node"]
        node_sources = set(node.get("source_ids", [])) | set(node.get("hierarchy_evidence_source_ids", []))
        if source_id in node_sources:
            cited_nodes[node["id"]] = {"id": node["id"], "label": node["label"]}
        for claim in detail.get("claims", []):
            if source_id in claim.get("evidence_source_ids", []):
                cited_claims[claim["id"]] = {
                    "id": claim["id"], "relation_type": claim["relation_type"],
                    "subject_id": claim["subject_id"], "object_id": claim["object_id"],
                }
    return {
        "release_id": manifest["release_id"], "source": source,
        "cited_nodes": sorted(cited_nodes.values(), key=lambda item: item["label"]),
        "cited_claims": sorted(cited_claims.values(), key=lambda item: item["id"]),
    }


def _artifact_source_search(q: str, limit: int, manifest: dict[str, Any]) -> dict[str, Any]:
    sources = _artifact_source_map(_detail_artifacts(manifest))
    query = q.strip().casefold()
    results = [source for source in sources.values() if not query or any(
        query in str(source.get(field) or "").casefold()
        for field in ("id", "title", "author", "container", "publisher")
    )]
    results.sort(key=lambda source: (source["title"].casefold(), source["id"]))
    return {"release_id": manifest["release_id"], "query": q, "results": results[:limit]}


def _artifact_neighbors(
    node_id: str, direction: str, limit: int, offset: int, manifest: dict[str, Any]
) -> dict[str, Any]:
    detail = _node_artifact(node_id, manifest)
    graph = _read_json_artifact("graph.json", manifest)
    node = detail["node"]
    claims = [claim for claim in detail.get("claims", []) if (
        direction == "both"
        or direction == "out" and claim["subject_id"] == node_id
        or direction == "in" and claim["object_id"] == node_id
    )]
    nodes = {item["id"]: item for item in graph.get("nodes", [])}
    hierarchy = []
    if direction in {"in", "both"} and node.get("parent_id") in nodes:
        parent = nodes[node["parent_id"]]
        hierarchy.append({
            "id": parent["id"], "label": parent["label"], "parent_id": parent.get("parent_id"),
            "hierarchy_relation": "part_of",
        })
    if direction in {"out", "both"}:
        hierarchy.extend({
            "id": item["id"], "label": item["label"], "parent_id": item.get("parent_id"),
            "hierarchy_relation": "part_of",
        } for item in nodes.values() if item.get("parent_id") == node_id)
    claims.sort(key=lambda item: item["id"])
    hierarchy.sort(key=lambda item: item["id"])
    return {
        "release_id": manifest["release_id"], "node_id": node_id,
        "claims": [{key: claim[key] for key in (
            "id", "subject_id", "object_id", "relation_type", "direction", "confidence", "consensus", "status"
        )} for claim in claims[offset:offset + limit]],
        "hierarchy": hierarchy[offset:offset + limit],
        "pagination": {
            "limit": limit, "offset": offset,
            "claims_total": len(claims), "hierarchy_total": len(hierarchy),
            "claims_next_offset": offset + limit if offset + limit < len(claims) else None,
            "hierarchy_next_offset": offset + limit if offset + limit < len(hierarchy) else None,
        },
    }


def _node_exists(connection: Any, node_id: str, statuses: str) -> bool:
    return connection.execute(text(
        f"SELECT 1 FROM nodes WHERE id = :id AND status IN {statuses}"
    ), {"id": node_id}).first() is not None


@app.get("/health")
def health() -> dict[str, str]:
    try:
        with _engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail="Database unavailable") from error
    return {"status": "ok"}


@app.get("/v1/graph")
def graph(request: Request, response: Response) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, "graph")
    if cached:
        return cached
    payload = _read_json_artifact("graph.json", manifest)
    return {
        **payload,
        "release_id": manifest["release_id"],
        "canonical_checksum": manifest.get("canonical_checksum"),
    }


@app.get("/v1/nodes/{node_id}")
def node_detail(node_id: str, request: Request, response: Response) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, f"node:{node_id}")
    if cached:
        return cached
    if _use_release_artifacts(manifest, response):
        return _artifact_node_detail(node_id, manifest)
    statuses = _status_filter(manifest)
    with _engine().connect() as connection:
        record = connection.execute(text(f"""
            SELECT id, type, label, summary, status, parent_id, hierarchy_relation,
                   evidence_status, name_variants, languages, external_links
            FROM nodes WHERE id = :id AND status IN {statuses}
        """), {"id": node_id}).mappings().first()
        if not record:
            raise HTTPException(status_code=404, detail="Node not found")
        names = connection.execute(text("""
            SELECT value, language, script, role FROM node_names
            WHERE node_id = :id ORDER BY role, value
        """), {"id": node_id}).mappings().all()
        identifiers = connection.execute(text("""
            SELECT namespace, value FROM external_identifiers WHERE node_id = :id ORDER BY namespace, value
        """), {"id": node_id}).mappings().all()
        sources = connection.execute(text("""
            SELECT DISTINCT s.id, s.title, s.author, s.publisher, s.publication_year, s.url, s.license, ns.role
            FROM sources s JOIN node_sources ns ON ns.source_id = s.id
            WHERE ns.node_id = :id ORDER BY s.title
        """), {"id": node_id}).mappings().all()
        dates = connection.execute(text("""
            SELECT d.id, d.aspect, d.start_year, d.end_year, d.year_convention,
                   d.precision, d.display_label, d.uncertainty_note,
                   COALESCE(array_agg(ds.source_id) FILTER (WHERE ds.source_id IS NOT NULL), '{}') AS evidence_source_ids
            FROM date_assertions d LEFT JOIN date_assertion_sources ds ON ds.date_assertion_id = d.id
            WHERE d.node_id = :id GROUP BY d.id ORDER BY d.aspect, d.id
        """), {"id": node_id}).mappings().all()
    return {
        "release_id": manifest["release_id"], "node": dict(record),
        "names": [dict(row) for row in names],
        "external_identifiers": [dict(row) for row in identifiers],
        "sources": [dict(row) for row in sources],
        "date_assertions": [dict(row) for row in dates],
    }


@app.get("/v1/claims/{claim_id}")
def claim_detail(claim_id: str, request: Request, response: Response) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, f"claim:{claim_id}")
    if cached:
        return cached
    if _use_release_artifacts(manifest, response):
        return _artifact_claim_detail(claim_id, manifest)
    statuses = _status_filter(manifest)
    with _engine().connect() as connection:
        claim = connection.execute(text(f"""
            SELECT c.* FROM influence_claims c
            WHERE c.id = :id AND c.status IN {statuses}
        """), {"id": claim_id}).mappings().first()
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        evidence = connection.execute(text("""
            SELECT s.id, s.title, s.author, s.url, s.license, cs.locator, cs.note
            FROM claim_sources cs JOIN sources s ON s.id = cs.source_id
            WHERE cs.claim_id = :id ORDER BY s.title, cs.locator
        """), {"id": claim_id}).mappings().all()
        dates = connection.execute(text("""
            SELECT d.id, d.aspect, d.start_year, d.end_year, d.year_convention,
                   d.precision, d.display_label, d.uncertainty_note,
                   COALESCE(array_agg(ds.source_id) FILTER (WHERE ds.source_id IS NOT NULL), '{}') AS evidence_source_ids
            FROM date_assertions d LEFT JOIN date_assertion_sources ds ON ds.date_assertion_id = d.id
            WHERE d.claim_id = :id GROUP BY d.id ORDER BY d.aspect, d.id
        """), {"id": claim_id}).mappings().all()
    return {"release_id": manifest["release_id"], "claim": dict(claim),
            "evidence": [dict(row) for row in evidence],
            "date_assertions": [dict(row) for row in dates]}


@app.get("/v1/sources/{source_id}")
def source_detail(source_id: str, request: Request, response: Response) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, f"source:{source_id}")
    if cached:
        return cached
    if _use_release_artifacts(manifest, response):
        return _artifact_source_detail(source_id, manifest)
    statuses = _status_filter(manifest)
    with _engine().connect() as connection:
        source = connection.execute(text(f"""
            SELECT s.id, s.title, s.author, s.container, s.publisher, s.publication_year,
                   s.url, s.license, s.status
            FROM sources s WHERE s.id = :id AND (
                EXISTS (SELECT 1 FROM node_sources ns JOIN nodes n ON n.id = ns.node_id
                        WHERE ns.source_id = s.id AND n.status IN {statuses}) OR
                EXISTS (SELECT 1 FROM claim_sources cs JOIN influence_claims c ON c.id = cs.claim_id
                        WHERE cs.source_id = s.id AND c.status IN {statuses})
            )
        """), {"id": source_id}).mappings().first()
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")
        cited_nodes = connection.execute(text(f"""
            SELECT DISTINCT n.id, n.label FROM node_sources ns JOIN nodes n ON n.id = ns.node_id
            WHERE ns.source_id = :id AND n.status IN {statuses} ORDER BY n.label
        """), {"id": source_id}).mappings().all()
        cited_claims = connection.execute(text(f"""
            SELECT DISTINCT c.id, c.relation_type, c.subject_id, c.object_id
            FROM claim_sources cs JOIN influence_claims c ON c.id = cs.claim_id
            WHERE cs.source_id = :id AND c.status IN {statuses} ORDER BY c.id
        """), {"id": source_id}).mappings().all()
    return {"release_id": manifest["release_id"], "source": dict(source),
            "cited_nodes": [dict(row) for row in cited_nodes],
            "cited_claims": [dict(row) for row in cited_claims]}


@app.get("/v1/sources")
def source_search(
    request: Request,
    response: Response,
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, f"sources:{q}:{limit}")
    if cached:
        return cached
    if _use_release_artifacts(manifest, response):
        return _artifact_source_search(q, limit, manifest)
    statuses = _status_filter(manifest)
    pattern = f"%{q.strip()}%"
    with _engine().connect() as connection:
        records = connection.execute(text(f"""
            SELECT DISTINCT s.id, s.title, s.author, s.container, s.publisher,
                   s.publication_year, s.url, s.license, s.status
            FROM sources s
            WHERE s.status IN {statuses}
              AND (
                EXISTS (SELECT 1 FROM node_sources ns JOIN nodes n ON n.id = ns.node_id
                        WHERE ns.source_id = s.id AND n.status IN {statuses}) OR
                EXISTS (SELECT 1 FROM claim_sources cs JOIN influence_claims c ON c.id = cs.claim_id
                        WHERE cs.source_id = s.id AND c.status IN {statuses})
              )
              AND (:query = '' OR s.title ILIKE :pattern OR COALESCE(s.author, '') ILIKE :pattern
                   OR COALESCE(s.container, '') ILIKE :pattern OR s.id = :query)
            ORDER BY s.title, s.id LIMIT :limit
        """), {"query": q.strip(), "pattern": pattern, "limit": limit}).mappings().all()
    return {"release_id": manifest["release_id"], "query": q, "results": [dict(row) for row in records]}


@app.get("/v1/resolve/{kind}/{legacy_id}")
def resolve_legacy(kind: str, legacy_id: str) -> RedirectResponse:
    if kind not in {"node", "claim", "source"}:
        raise HTTPException(status_code=404, detail="Unknown legacy record kind")
    aliases_path = Path(os.environ.get("RA_ALIAS_FILE", "data/canonical/legacy_aliases.json"))
    try:
        aliases = json.loads(aliases_path.read_text(encoding="utf-8"))["aliases"]
    except (OSError, json.JSONDecodeError, KeyError) as error:
        raise HTTPException(status_code=503, detail="ID alias registry is unavailable") from error
    canonical_id = aliases.get(f"{kind}:{legacy_id}")
    if not canonical_id:
        raise HTTPException(status_code=404, detail="Legacy ID not found")
    resource = {"node": "nodes", "claim": "claims", "source": "sources"}[kind]
    return RedirectResponse(url=f"/v1/{resource}/{canonical_id}", status_code=308)


@app.get("/v1/nodes/{node_id}/neighbors")
def neighbors(
    node_id: str,
    request: Request,
    response: Response,
    direction: str = Query(default="both", pattern="^(both|out|in)$"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, f"neighbors:{node_id}:{direction}:{limit}:{offset}")
    if cached:
        return cached
    if _use_release_artifacts(manifest, response):
        return _artifact_neighbors(node_id, direction, limit, offset, manifest)
    statuses = _status_filter(manifest)
    with _engine().connect() as connection:
        if not _node_exists(connection, node_id, statuses):
            raise HTTPException(status_code=404, detail="Node not found")
        claim_condition = {"out": "c.subject_id = :id", "in": "c.object_id = :id", "both": "(c.subject_id = :id OR c.object_id = :id)"}[direction]
        claims = connection.execute(text(f"""
            SELECT c.id, c.subject_id, c.object_id, c.relation_type, c.direction,
                   c.confidence, c.consensus, c.status
            FROM influence_claims c
            WHERE {claim_condition} AND c.status IN {statuses}
            ORDER BY c.id LIMIT :limit OFFSET :offset
        """), {"id": node_id, "limit": limit, "offset": offset}).mappings().all()
        claim_total = connection.execute(text(f"""
            SELECT count(*) FROM influence_claims c
            WHERE {claim_condition} AND c.status IN {statuses}
        """), {"id": node_id}).scalar_one()
        hierarchy_condition = {
            "out": "parent_id = :id",
            "in": "id = (SELECT parent_id FROM nodes WHERE id = :id)",
            "both": "(id = (SELECT parent_id FROM nodes WHERE id = :id) OR parent_id = :id)",
        }[direction]
        hierarchy = connection.execute(text(f"""
            SELECT id, label, parent_id, hierarchy_relation
            FROM nodes WHERE {hierarchy_condition} AND status IN {statuses}
            ORDER BY id LIMIT :limit OFFSET :offset
        """), {"id": node_id, "limit": limit, "offset": offset}).mappings().all()
        hierarchy_total = connection.execute(text(f"""
            SELECT count(*) FROM nodes WHERE {hierarchy_condition} AND status IN {statuses}
        """), {"id": node_id}).scalar_one()
    return {
        "release_id": manifest["release_id"], "node_id": node_id,
        "claims": [dict(row) for row in claims], "hierarchy": [dict(row) for row in hierarchy],
        "pagination": {
            "limit": limit, "offset": offset,
            "claims_total": claim_total, "hierarchy_total": hierarchy_total,
            "claims_next_offset": offset + limit if offset + limit < claim_total else None,
            "hierarchy_next_offset": offset + limit if offset + limit < hierarchy_total else None,
        },
    }


@app.get("/v1/search")
def search(
    request: Request,
    response: Response,
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    manifest = _manifest()
    cached = _conditional_cache(request, response, manifest, f"search:{q}:{limit}")
    if cached:
        return cached
    index = _read_json_artifact("search-index.json", manifest)
    nfc_query = unicodedata.normalize("NFC", q)
    casefold_query = nfc_query.casefold()
    latin_query = _latin_fold(q)
    results: dict[str, dict[str, Any]] = {}
    for item in index["records"]:
        exact = item["nfc_key"]
        casefold = item["casefold_key"]
        folded = item["latin_folded_key"]
        if item.get("match_kind") == "external_identifier":
            rank = 0 if exact == nfc_query else None
        else:
            rank = (
                0 if exact == nfc_query else
                1 if casefold == casefold_query else
                2 if casefold.startswith(casefold_query) else
                3 if casefold_query in casefold else
                4 if folded.startswith(latin_query) else
                5 if latin_query in folded else None
            )
        if rank is None:
            continue
        candidate = {
            "node_id": item["node_id"], "label": item["label"],
            "matched_name": item["value"] if item.get("match_kind") != "external_identifier" else None,
            "matched_identifier": ({"namespace": item["namespace"], "value": item["identifier_value"]}
                                   if item.get("match_kind") == "external_identifier" else None),
            "match_kind": item.get("match_kind", "name"),
            "language": item["language"], "script": item["script"], "rank": rank,
        }
        if item["node_id"] not in results or rank < results[item["node_id"]]["rank"]:
            results[item["node_id"]] = candidate
    ordered = sorted(results.values(), key=lambda item: (item["rank"], item["label"].casefold(), item["node_id"]))[:limit]
    return {"release_id": manifest["release_id"], "query": q, "results": ordered}


@app.get("/v1/paths")
def find_paths(
    request: Request,
    response: Response,
    source: str,
    target: str,
    max_hops: int = Query(default=6, ge=1, le=8),
    limit: int = Query(default=10, ge=1, le=20),
    allow_reverse: bool = False,
    relation_types: list[str] | None = Query(default=None),
    consensus: list[str] | None = Query(default=None),
    min_confidence: int | None = Query(default=None, ge=1, le=5),
    start_year: int | None = None,
    end_year: int | None = None,
    traditions: list[str] | None = Query(default=None),
) -> dict[str, Any]:
    manifest = _release()
    statuses = _status_filter(manifest)
    valid_relations = {
        "direct_textual_dependence", "shared_source", "motif_parallel", "oral_diffusion",
        "polemical_adaptation", "reception_commentary", "tradition_lineage",
    }
    valid_consensus = {"consensus", "majority", "contested", "fringe"}
    if relation_types and set(relation_types) - valid_relations:
        raise HTTPException(status_code=422, detail="Unknown relation type filter")
    if consensus and set(consensus) - valid_consensus:
        raise HTTPException(status_code=422, detail="Unknown consensus filter")
    if start_year is not None and end_year is not None and start_year > end_year:
        raise HTTPException(status_code=422, detail="start_year must not exceed end_year")
    if start_year == 0 or end_year == 0:
        raise HTTPException(status_code=422, detail="year zero is not used by the historical BCE/CE convention")
    path_key = json.dumps({
        "source": source, "target": target, "max_hops": max_hops, "limit": limit,
        "allow_reverse": allow_reverse, "relation_types": relation_types,
        "consensus": consensus, "min_confidence": min_confidence,
        "start_year": start_year, "end_year": end_year, "traditions": traditions,
    }, sort_keys=True, separators=(",", ":"))
    cached = _conditional_cache(request, response, manifest, "paths:" + path_key)
    if cached:
        return cached
    with _engine().connect() as connection:
        rows = connection.execute(text(f"""
            SELECT id, subject_id, object_id, relation_type, direction, confidence,
                   consensus, inferred, rationale, status
            FROM influence_claims WHERE status IN {statuses}
        """)).mappings().all()
        citations = connection.execute(text("""
            SELECT cs.claim_id, s.id AS source_id, s.title, s.author, s.url, s.license,
                   NULLIF(cs.locator, '') AS locator, cs.note
            FROM claim_sources cs JOIN sources s ON s.id = cs.source_id
            ORDER BY cs.claim_id, s.title
        """)).mappings().all()
        dates = connection.execute(text("""
            SELECT d.id, d.claim_id, d.aspect, d.start_year, d.end_year, d.year_convention,
                   d.precision, d.display_label, d.uncertainty_note,
                   COALESCE(array_agg(ds.source_id) FILTER (WHERE ds.source_id IS NOT NULL), '{}') AS evidence_source_ids
            FROM date_assertions d LEFT JOIN date_assertion_sources ds ON ds.date_assertion_id = d.id
            WHERE d.claim_id IS NOT NULL GROUP BY d.id ORDER BY d.claim_id, d.id
        """)).mappings().all()
        node_rows = connection.execute(text(
            f"SELECT id, type, parent_id FROM nodes WHERE status IN {statuses}"
        )).mappings().all()
    visible_nodes = [row["id"] for row in node_rows]
    source_map: dict[str, list[dict[str, Any]]] = {}
    for row in citations:
        evidence = dict(row)
        evidence.pop("claim_id", None)
        source_map.setdefault(row["claim_id"], []).append(evidence)
    date_map: dict[str, list[dict[str, Any]]] = {}
    for row in dates:
        date = dict(row)
        date_claim_id = date.pop("claim_id")
        date_map.setdefault(date_claim_id, []).append(date)
    claims = [{
        **dict(row),
        "evidence_source_ids": [item["source_id"] for item in source_map.get(row["id"], [])],
        "evidence": source_map.get(row["id"], []),
        "date_assertions": date_map.get(row["id"], []),
    } for row in rows]
    if relation_types:
        claims = [claim for claim in claims if claim["relation_type"] in relation_types]
    if consensus:
        claims = [claim for claim in claims if claim["consensus"] in consensus]
    if min_confidence is not None:
        claims = [claim for claim in claims if claim["confidence"] is not None and claim["confidence"] >= min_confidence]
    if start_year is not None or end_year is not None:
        lower = start_year if start_year is not None else float("-inf")
        upper = end_year if end_year is not None else float("inf")
        claims = [claim for claim in claims if any(
            (date["start_year"] is not None or date["end_year"] is not None)
            and (date["start_year"] is None or date["start_year"] <= upper)
            and (date["end_year"] is None or date["end_year"] >= lower)
            for date in claim["date_assertions"]
        )]
    node_id_set = set(visible_nodes)
    if traditions:
        nodes_by_id = {row["id"]: dict(row) for row in node_rows}
        if any(node_id not in nodes_by_id or nodes_by_id[node_id]["type"] != "tradition" for node_id in traditions):
            raise HTTPException(status_code=422, detail="traditions must contain visible tradition node IDs")
        allowed_nodes: set[str] = set()
        for node_id in visible_nodes:
            current = nodes_by_id[node_id]
            while current:
                if current["type"] == "tradition" and current["id"] in traditions:
                    allowed_nodes.add(node_id)
                    break
                parent_id = current["parent_id"]
                current = nodes_by_id.get(parent_id) if parent_id else None
        node_id_set &= allowed_nodes
    if source not in node_id_set or target not in node_id_set:
        raise HTTPException(status_code=404, detail="Path endpoint node not found in the selected release/filters")
    path_result = non_dominated_paths(
        node_id_set, claims, source, target,
        max_hops=max_hops, limit=limit, allow_reverse=allow_reverse,
    )
    return {"release_id": manifest["release_id"], "source": source, "target": target,
            "allow_reverse": allow_reverse, "filters": {
                "relation_types": relation_types or [], "consensus": consensus or [],
                "min_confidence": min_confidence, "start_year": start_year,
                "end_year": end_year, "traditions": traditions or [],
            }, "paths": path_result["paths"],
            "truncated": path_result["truncated"],
            "enumerated_routes": path_result["enumerated_routes"],
            "expansions": path_result["expansions"]}


def _latin_fold(value: str) -> str:
    if not any("LATIN" in unicodedata.name(char, "") for char in value):
        return value.casefold()
    return "".join(
        char for char in unicodedata.normalize("NFD", value).casefold()
        if not unicodedata.combining(char)
    )
