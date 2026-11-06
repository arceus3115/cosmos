"""Deterministic build of browser, search, detail, and open-data artifacts."""

from __future__ import annotations

import csv
import hashlib
import importlib.metadata
import io
import json
import platform
import subprocess
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import quote

from rdflib import Graph, Literal, Namespace, RDF, RDFS, URIRef

from . import __version__
from .validate import validate_seed

RA = Namespace("https://religion-almanac.example/vocab/")
BASE_ID = "https://religion-almanac.example/id/"


def stable_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _latin_fold(value: str) -> str:
    if not any("LATIN" in unicodedata.name(char, "") for char in value):
        return value.casefold()
    return "".join(
        char for char in unicodedata.normalize("NFD", value).casefold()
        if not unicodedata.combining(char)
    )


def _commit_metadata() -> dict[str, Any]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, check=True, text=True
        ).stdout.strip()
        dirty = bool(subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            capture_output=True, check=True, text=True
        ).stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        commit, dirty = "unknown", True
    return {"commit": commit, "tracked_changes_present": dirty}


def build_artifacts(
    seed: dict[str, Any], output_dir: str | Path, *, include_prototype: bool = False
) -> dict[str, Any]:
    """Validate and write one reproducible release; prototype records require opt-in."""
    validate_seed(seed)
    allowed = {"published"}
    if include_prototype:
        allowed.add("prototype")
    sources = {source["id"]: source for source in seed["sources"]}
    nodes = [node for node in seed["nodes"] if node["status"] in allowed]
    node_ids = {node["id"] for node in nodes}
    claims = [
        claim for claim in seed["claims"]
        if claim["status"] in allowed and claim["subject_id"] in node_ids and claim["object_id"] in node_ids
    ]
    source_ids = {source_id for node in nodes for source_id in node["source_ids"]}
    source_ids.update(source_id for claim in claims for source_id in claim["evidence_source_ids"])
    source_ids.update(source_id for node in nodes for source_id in node["hierarchy_evidence_source_ids"])
    active_sources = [sources[source_id] for source_id in sorted(source_ids)]

    graph_nodes = [
        {
            "id": node["id"], "label": node["label"], "type": node["type"],
            "parent_id": node["parent_id"],
            "dates": [
                {"aspect": item["aspect"], "start_year": item["start_year"], "end_year": item["end_year"],
                 "label": item["display_label"], "uncertainty_note": item["uncertainty_note"]}
                for item in node["date_assertions"]
            ],
        }
        for node in sorted(nodes, key=lambda record: record["id"])
    ]
    graph_edges = []
    for node in nodes:
        if node["parent_id"]:
            graph_edges.append({
                "id": f"hierarchy:{node['id']}", "source": node["parent_id"], "target": node["id"],
                "type": "part_of", "family": "hierarchy", "direction": "certain",
                "evidence_source_ids": node["hierarchy_evidence_source_ids"],
            })
    for claim in claims:
        graph_edges.append({
            "id": claim["id"], "source": claim["subject_id"], "target": claim["object_id"],
            "type": claim["relation_type"], "family": "influence", "direction": claim["direction"],
            "confidence": claim["confidence"], "consensus": claim["consensus"],
            "dates": [
                {"start_year": item["start_year"], "end_year": item["end_year"],
                 "label": item["display_label"], "uncertainty_note": item["uncertainty_note"]}
                for item in claim["date_assertions"]
            ],
            "inferred": claim["inferred"], "evidence_source_ids": claim["evidence_source_ids"],
        })
    graph_edges.sort(key=lambda edge: edge["id"])
    visible_claim_ids = {claim["id"] for claim in claims}
    included_paths = [
        path for path in seed["guided_paths"]
        if all(node_id in node_ids for node_id in path["nodes"])
        and all(claim_id in visible_claim_ids for claim_id in path["edges"])
    ]
    graph_payload = {
        "dataset_release": seed["metadata"]["release"],
        "schema_version": seed["schema_version"],
        "nodes": graph_nodes,
        "edges": graph_edges,
        "guided_paths": [
            {"id": path["id"], "title": path["title"], "subtitle": path["subtitle"],
             "introduction": path["introduction"],
             "nodes": path["nodes"], "edges": path["edges"]}
            for path in included_paths
        ],
    }

    claims_by_node: dict[str, list[dict[str, Any]]] = {node_id: [] for node_id in node_ids}
    for claim in claims:
        claims_by_node[claim["subject_id"]].append(claim)
        claims_by_node[claim["object_id"]].append(claim)
    details: dict[str, dict[str, Any]] = {}
    for node in nodes:
        related_sources = {*node["source_ids"], *node["hierarchy_evidence_source_ids"]}
        related_sources.update(
            source_id for claim in claims_by_node[node["id"]] for source_id in claim["evidence_source_ids"]
        )
        details[node["id"]] = {
            "release": seed["metadata"]["release"], "node": node,
            "sources": [sources[source_id] for source_id in sorted(related_sources)],
            "claims": sorted(claims_by_node[node["id"]], key=lambda claim: claim["id"]),
        }

    search_records = []
    for node in nodes:
        names = [{"value": node["label"], "language": None, "script": None, "role": "preferred"}]
        names.extend(node["name_variants"])
        for name in names:
            value = name["value"]
            search_records.append({
                "match_kind": "name", "node_id": node["id"], "label": node["label"], "value": value,
                "language": name.get("language"), "script": name.get("script"),
                "role": name.get("role"), "nfc_key": unicodedata.normalize("NFC", value),
                "casefold_key": unicodedata.normalize("NFC", value).casefold(),
                "latin_folded_key": _latin_fold(value),
            })
        for identifier in node.get("external_identifiers", []):
            namespace, identifier_value = identifier["namespace"], identifier["value"]
            for query_value in (identifier_value, f"{namespace}:{identifier_value}"):
                normalized_query = unicodedata.normalize("NFC", query_value)
                search_records.append({
                    "match_kind": "external_identifier", "node_id": node["id"], "label": node["label"],
                    "value": query_value, "identifier_value": identifier_value,
                    "namespace": namespace, "language": None, "script": None,
                    "role": "external_identifier", "nfc_key": normalized_query,
                    "casefold_key": normalized_query.casefold(), "latin_folded_key": query_value,
                })
    search_records.sort(key=lambda item: (item["casefold_key"], item["node_id"], item["match_kind"], item["value"]))
    search_payload = {"release": seed["metadata"]["release"], "records": search_records}

    included_review_events = [event for event in seed["review_events"] if event["claim_id"] in visible_claim_ids]
    jsonld = _jsonld(nodes, claims, active_sources, included_paths, included_review_events)
    turtle = _turtle(nodes, claims, active_sources, included_paths, included_review_events)
    artifacts: dict[str, bytes] = {
        "graph.json": stable_json(graph_payload),
        "search-index.json": stable_json(search_payload),
        "religion-almanac.jsonld": stable_json(jsonld),
        "religion-almanac.ttl": turtle.encode("utf-8"),
        "nodes.csv": _csv_bytes(
            ["id", "type", "label", "parent_id", "status", "evidence_status", "source_ids", "date_labels"],
            ([node["id"], node["type"], node["label"], node["parent_id"], node["status"], node["evidence_status"],
              ";".join(node["source_ids"]), ";".join(item["display_label"] or "" for item in node["date_assertions"])] for node in nodes),
        ),
        "claims.csv": _csv_bytes(
            ["id", "subject_id", "object_id", "relation_type", "direction", "confidence", "consensus", "evidence_source_ids"],
            ([claim["id"], claim["subject_id"], claim["object_id"], claim["relation_type"], claim["direction"],
              claim["confidence"], claim["consensus"], ";".join(claim["evidence_source_ids"])] for claim in claims),
        ),
        "sources.csv": _csv_bytes(
            ["id", "title", "author", "container", "publisher", "year", "url", "license"],
            ([source["id"], source["title"], source["author"], source["container"], source["publisher"],
              source["year"], source["url"], source["license"]] for source in active_sources),
        ),
        "NOTICE.md": _notice(active_sources),
    }
    for node_id, detail in sorted(details.items()):
        artifacts[f"details/{quote(node_id, safe=':')}.json"] = stable_json(detail)

    checksums = {name: hashlib.sha256(content).hexdigest() for name, content in sorted(artifacts.items())}
    output_checksum = hashlib.sha256(stable_json(checksums)).hexdigest()
    commit = _commit_metadata()
    manifest = {
        "dataset_id": seed["metadata"]["dataset_id"],
        "dataset_release": seed["metadata"]["release"],
        "release_id": f"{commit['commit'][:12]}-{output_checksum[:12]}",
        "commit": commit["commit"], "tracked_changes_present": commit["tracked_changes_present"],
        "schema_version": seed["schema_version"], "pipeline_version": __version__,
        "toolchain": {
            "python": platform.python_version(),
            "jsonschema": importlib.metadata.version("jsonschema"),
            "rdflib": importlib.metadata.version("rdflib"),
        },
        "canonical_checksum": hashlib.sha256(stable_json(seed)).hexdigest(),
        "publication_mode": "published_plus_prototype" if include_prototype else "published_only",
        "counts": {"nodes": len(nodes), "claims": len(claims), "sources": len(active_sources)},
        "artifact_checksums": checksums,
        "output_checksum": output_checksum,
    }

    destination = Path(output_dir)
    for name, content in artifacts.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (destination / "build-manifest.json").write_bytes(stable_json(manifest))
    return manifest


def _csv_bytes(headers: list[str], rows: Any) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def _jsonld(
    nodes: list[dict[str, Any]], claims: list[dict[str, Any]], sources: list[dict[str, Any]],
    paths: list[dict[str, Any]], review_events: list[dict[str, Any]],
) -> dict[str, Any]:
    graph: list[dict[str, Any]] = []
    for node in sorted(nodes, key=lambda item: item["id"]):
        entity = {
            "@id": BASE_ID + quote(node["id"], safe=":"),
            "@type": "ra:" + node["type"].title(),
            "ra:identityKey": node["identity_key"],
            "ra:label": {"@value": node["label"]},
            "ra:status": node["status"],
        }
        if node["parent_id"]:
            entity["ra:parent"] = {"@id": BASE_ID + quote(node["parent_id"], safe=":")}
            entity["ra:hierarchyEvidence"] = [
                {"@id": BASE_ID + quote(item, safe=":")}
                for item in node["hierarchy_evidence_source_ids"]
            ]
        if node["summary"]:
            entity["ra:summary"] = {"@value": node["summary"]}
        entity["ra:language"] = node["languages"]
        entity["ra:alternateName"] = [
            ({"@value": item["value"]} if not item["language"] else
             {"@value": item["value"], "@language": item["language"]})
            for item in node["name_variants"]
        ]
        entity["ra:externalIdentifier"] = [
            {"ra:namespace": item["namespace"], "ra:identifierValue": item["value"]}
            for item in node["external_identifiers"]
        ]
        entity["ra:externalLink"] = [
            {"ra:label": item["label"], "@id": item["url"]} for item in node["external_links"]
        ]
        entity["ra:source"] = [{"@id": BASE_ID + quote(item, safe=":")} for item in node["source_ids"]]
        graph.append(entity)
        for assertion in node["date_assertions"]:
            date_node = {
                "@id": BASE_ID + quote(assertion["id"], safe=":"),
                "@type": "ra:DateAssertion",
                "ra:identityKey": f"{node['id']}|{assertion['aspect']}",
                "ra:about": {"@id": BASE_ID + quote(node["id"], safe=":")},
                "ra:aspect": assertion["aspect"],
                "ra:yearConvention": assertion["year_convention"],
                "ra:precision": assertion["precision"],
                "ra:evidence": [{"@id": BASE_ID + quote(item, safe=":")} for item in assertion["evidence_source_ids"]],
            }
            if assertion["start_year"] is not None:
                date_node["ra:startYear"] = assertion["start_year"]
            if assertion["end_year"] is not None:
                date_node["ra:endYear"] = assertion["end_year"]
            if assertion["display_label"]:
                date_node["ra:displayLabel"] = {"@value": assertion["display_label"]}
            if assertion["uncertainty_note"]:
                date_node["ra:uncertaintyNote"] = {"@value": assertion["uncertainty_note"]}
            graph.append(date_node)
    for claim in sorted(claims, key=lambda item: item["id"]):
        claim_node = {
            "@id": BASE_ID + quote(claim["id"], safe=":"), "@type": "ra:InfluenceClaim",
            "ra:identityKey": claim["identity_key"],
            "ra:subject": {"@id": BASE_ID + quote(claim["subject_id"], safe=":")},
            "ra:object": {"@id": BASE_ID + quote(claim["object_id"], safe=":")},
            "ra:relationType": claim["relation_type"], "ra:direction": claim["direction"],
            "ra:rationale": claim["rationale"], "ra:inferred": claim["inferred"],
            "ra:status": claim["status"], "ra:evidenceStatus": claim["evidence_status"],
            "ra:evidence": [{"@id": BASE_ID + quote(item, safe=":")} for item in claim["evidence_source_ids"]],
        }
        if claim["confidence"] is not None:
            claim_node["ra:confidence"] = claim["confidence"]
        if claim["consensus"] is not None:
            claim_node["ra:consensus"] = claim["consensus"]
        if claim["date_label"]:
            claim_node["ra:dateLabel"] = {"@value": claim["date_label"]}
        graph.append(claim_node)
        for assertion in claim["date_assertions"]:
            date_node = {
                "@id": BASE_ID + quote(assertion["id"], safe=":"),
                "@type": "ra:DateAssertion",
                "ra:identityKey": f"{claim['id']}|{assertion['aspect']}",
                "ra:about": {"@id": BASE_ID + quote(claim["id"], safe=":")},
                "ra:aspect": assertion["aspect"],
                "ra:yearConvention": assertion["year_convention"],
                "ra:precision": assertion["precision"],
                "ra:evidence": [{"@id": BASE_ID + quote(item, safe=":")} for item in assertion["evidence_source_ids"]],
            }
            if assertion["start_year"] is not None:
                date_node["ra:startYear"] = assertion["start_year"]
            if assertion["end_year"] is not None:
                date_node["ra:endYear"] = assertion["end_year"]
            if assertion["display_label"]:
                date_node["ra:displayLabel"] = {"@value": assertion["display_label"]}
            if assertion["uncertainty_note"]:
                date_node["ra:uncertaintyNote"] = {"@value": assertion["uncertainty_note"]}
            graph.append(date_node)
    for source in sorted(sources, key=lambda item: item["id"]):
        graph.append({
            "@id": BASE_ID + quote(source["id"], safe=":"), "@type": "ra:Source",
            "ra:identityKey": source["identity_key"],
            "ra:title": {"@value": source["title"]}, "ra:license": {"@value": source["license"]},
            "ra:author": source["author"], "ra:publisher": source["publisher"],
            "ra:container": source["container"], "ra:publicationYear": source["year"],
        })
        if source["url"]:
            graph[-1]["ra:url"] = {"@id": source["url"]}
    for path in sorted(paths, key=lambda item: item["id"]):
        graph.append({
            "@id": "https://religion-almanac.example/path/" + quote(path["id"]),
            "@type": "ra:GuidedPath", "ra:title": path["title"],
            "ra:introduction": {"@value": path["introduction"]},
            "ra:node": [{"@id": BASE_ID + quote(item, safe=":")} for item in path["nodes"]],
            "ra:claim": [{"@id": BASE_ID + quote(item, safe=":")} for item in path["edges"]],
        })
    for event in sorted(review_events, key=lambda item: item["id"]):
        graph.append({
            "@id": BASE_ID + quote(event["id"], safe=":"), "@type": "ra:ReviewEvent",
            "ra:identityKey": event["identity_key"],
            "ra:claim": {"@id": BASE_ID + quote(event["claim_id"], safe=":")},
            "ra:reviewer": event["reviewer"], "ra:action": event["action"],
            "ra:occurredAt": {"@value": event["occurred_at"], "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
            "ra:resolutionNote": event["resolution_note"],
        })
    return {
        "@context": {
            "ra": "https://religion-almanac.example/vocab/",
            "label": "http://www.w3.org/2000/01/rdf-schema#label",
        },
        "@graph": graph,
    }


def _turtle(
    nodes: list[dict[str, Any]], claims: list[dict[str, Any]], sources: list[dict[str, Any]],
    paths: list[dict[str, Any]], review_events: list[dict[str, Any]],
) -> str:
    rdf = Graph()
    rdf.bind("ra", RA)
    for node in nodes:
        subject = URIRef(BASE_ID + quote(node["id"], safe=":"))
        rdf.add((subject, RDF.type, RA[node["type"].title()]))
        rdf.add((subject, RDFS.label, Literal(node["label"])))
        rdf.add((subject, RA.identityKey, Literal(node["identity_key"])))
        rdf.add((subject, RA.status, Literal(node["status"])))
        rdf.add((subject, RA.evidenceStatus, Literal(node["evidence_status"])))
        if node["summary"]:
            rdf.add((subject, RA.summary, Literal(node["summary"])))
        for language in node["languages"]:
            rdf.add((subject, RA.language, Literal(language)))
        for name in node["name_variants"]:
            rdf.add((subject, RA.alternateName, Literal(name["value"])))
        for identifier in node["external_identifiers"]:
            identifier_node = URIRef(BASE_ID + quote(node["id"], safe=":") + "/identifier/" + quote(identifier["namespace"] + ":" + identifier["value"], safe=":"))
            rdf.add((subject, RA.externalIdentifier, identifier_node))
            rdf.add((identifier_node, RA.namespace, Literal(identifier["namespace"])))
            rdf.add((identifier_node, RA.identifierValue, Literal(identifier["value"])))
        for link in node["external_links"]:
            link_node = URIRef(BASE_ID + quote(node["id"], safe=":") + "/link/" + quote(link["label"]))
            rdf.add((subject, RA.externalLink, link_node))
            rdf.add((link_node, RDFS.label, Literal(link["label"])))
            rdf.add((link_node, RA.url, URIRef(link["url"])))
        if node["parent_id"]:
            rdf.add((subject, RA.parent, URIRef(BASE_ID + quote(node["parent_id"], safe=":"))))
        for source_id in node["source_ids"]:
            rdf.add((subject, RA.source, URIRef(BASE_ID + quote(source_id, safe=":"))))
        for source_id in node["hierarchy_evidence_source_ids"]:
            rdf.add((subject, RA.hierarchyEvidence, URIRef(BASE_ID + quote(source_id, safe=":"))))
        for assertion in node["date_assertions"]:
            date_node = URIRef(BASE_ID + quote(assertion["id"], safe=":"))
            rdf.add((date_node, RDF.type, RA.DateAssertion))
            rdf.add((date_node, RA.about, subject))
            rdf.add((date_node, RA.aspect, Literal(assertion["aspect"])))
            rdf.add((date_node, RA.yearConvention, Literal(assertion["year_convention"])))
            rdf.add((date_node, RA.precision, Literal(assertion["precision"])))
            if assertion["start_year"] is not None:
                rdf.add((date_node, RA.startYear, Literal(assertion["start_year"])))
            if assertion["end_year"] is not None:
                rdf.add((date_node, RA.endYear, Literal(assertion["end_year"])))
            if assertion["display_label"]:
                rdf.add((date_node, RA.displayLabel, Literal(assertion["display_label"])))
            if assertion["uncertainty_note"]:
                rdf.add((date_node, RA.uncertaintyNote, Literal(assertion["uncertainty_note"])))
            for source_id in assertion["evidence_source_ids"]:
                rdf.add((date_node, RA.evidence, URIRef(BASE_ID + quote(source_id, safe=":"))))
    for claim in claims:
        subject = URIRef(BASE_ID + quote(claim["id"], safe=":"))
        rdf.add((subject, RDF.type, RA.InfluenceClaim))
        rdf.add((subject, RA.subject, URIRef(BASE_ID + quote(claim["subject_id"], safe=":"))))
        rdf.add((subject, RA.object, URIRef(BASE_ID + quote(claim["object_id"], safe=":"))))
        rdf.add((subject, RA.relationType, Literal(claim["relation_type"])))
        rdf.add((subject, RA.direction, Literal(claim["direction"])))
        rdf.add((subject, RA.identityKey, Literal(claim["identity_key"])))
        rdf.add((subject, RA.rationale, Literal(claim["rationale"] or "")))
        if claim["confidence"] is not None:
            rdf.add((subject, RA.confidence, Literal(claim["confidence"])))
        if claim["consensus"] is not None:
            rdf.add((subject, RA.consensus, Literal(claim["consensus"])))
        rdf.add((subject, RA.inferred, Literal(claim["inferred"])))
        rdf.add((subject, RA.status, Literal(claim["status"])))
        rdf.add((subject, RA.evidenceStatus, Literal(claim["evidence_status"])))
        if claim["date_label"]:
            rdf.add((subject, RA.dateLabel, Literal(claim["date_label"])))
        for assertion in claim["date_assertions"]:
            date_node = URIRef(BASE_ID + quote(assertion["id"], safe=":"))
            rdf.add((date_node, RDF.type, RA.DateAssertion))
            rdf.add((date_node, RA.about, subject))
            rdf.add((date_node, RA.identityKey, Literal(f"{claim['id']}|{assertion['aspect']}")))
            rdf.add((date_node, RA.aspect, Literal(assertion["aspect"])))
            rdf.add((date_node, RA.yearConvention, Literal(assertion["year_convention"])))
            rdf.add((date_node, RA.precision, Literal(assertion["precision"])))
            if assertion["start_year"] is not None:
                rdf.add((date_node, RA.startYear, Literal(assertion["start_year"])))
            if assertion["end_year"] is not None:
                rdf.add((date_node, RA.endYear, Literal(assertion["end_year"])))
            if assertion["display_label"]:
                rdf.add((date_node, RA.displayLabel, Literal(assertion["display_label"])))
            if assertion["uncertainty_note"]:
                rdf.add((date_node, RA.uncertaintyNote, Literal(assertion["uncertainty_note"])))
            for source_id in assertion["evidence_source_ids"]:
                rdf.add((date_node, RA.evidence, URIRef(BASE_ID + quote(source_id, safe=":"))))
        for source_id in claim["evidence_source_ids"]:
            rdf.add((subject, RA.evidence, URIRef(BASE_ID + quote(source_id, safe=":"))))
    for source in sources:
        subject = URIRef(BASE_ID + quote(source["id"], safe=":"))
        rdf.add((subject, RDF.type, RA.Source))
        rdf.add((subject, RDFS.label, Literal(source["title"])))
        rdf.add((subject, RA.identityKey, Literal(source["identity_key"])))
        rdf.add((subject, RA.license, Literal(source["license"])))
        for predicate, field in ((RA.author, "author"), (RA.container, "container"),
                                 (RA.publisher, "publisher"), (RA.publicationYear, "year")):
            if source[field]:
                rdf.add((subject, predicate, Literal(source[field])))
        if source["url"]:
            rdf.add((subject, RA.url, URIRef(source["url"])))
    for path in paths:
        subject = URIRef("https://religion-almanac.example/path/" + quote(path["id"]))
        rdf.add((subject, RDF.type, RA.GuidedPath))
        rdf.add((subject, RDFS.label, Literal(path["title"])))
        rdf.add((subject, RA.introduction, Literal(path["introduction"])))
        for node_id in path["nodes"]:
            rdf.add((subject, RA.node, URIRef(BASE_ID + quote(node_id, safe=":"))))
        for claim_id in path["edges"]:
            rdf.add((subject, RA.claim, URIRef(BASE_ID + quote(claim_id, safe=":"))))
    for event in review_events:
        subject = URIRef(BASE_ID + quote(event["id"], safe=":"))
        rdf.add((subject, RDF.type, RA.ReviewEvent))
        rdf.add((subject, RA.identityKey, Literal(event["identity_key"])))
        rdf.add((subject, RA.claim, URIRef(BASE_ID + quote(event["claim_id"], safe=":"))))
        rdf.add((subject, RA.reviewer, Literal(event["reviewer"])))
        rdf.add((subject, RA.action, Literal(event["action"])))
        rdf.add((subject, RA.occurredAt, Literal(event["occurred_at"])))
        if event["resolution_note"]:
            rdf.add((subject, RA.resolutionNote, Literal(event["resolution_note"])))
    triples = sorted((subject.n3(), predicate.n3(), object_.n3()) for subject, predicate, object_ in rdf)
    return "\n".join(f"{subject} {predicate} {object_} ." for subject, predicate, object_ in triples) + "\n"


def _notice(sources: list[dict[str, Any]]) -> bytes:
    lines = ["# Source and license register", "", "License and attribution notes for sources used by this release:", ""]
    for source in sorted(sources, key=lambda item: item["id"]):
        lines.append(f"- **{source['title']}** ({source['author'] or 'author not recorded'}): {source['license']}")
        if source["url"]:
            lines.append(f"  - {source['url']}")
    lines.append("")
    return "\n".join(lines).encode("utf-8")
