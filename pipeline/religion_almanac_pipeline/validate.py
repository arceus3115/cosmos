"""Schema and cross-record checks for canonical seed files."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from .ids import stable_id

DEFAULT_SEED = Path("data/canonical/seed.json")
DEFAULT_SCHEMA = Path("data/schemas/seed.schema.json")
DEFAULT_ALIAS_FILE = Path("data/canonical/legacy_aliases.json")
DEFAULT_ALIAS_SCHEMA = Path("data/schemas/aliases.schema.json")


class ValidationFailure(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("Canonical data validation failed:\n- " + "\n- ".join(errors))


def load_seed(path: str | Path = DEFAULT_SEED) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValidationFailure(["$: expected a JSON object"])
    return value


def _at_path(path: Any) -> str:
    parts = [str(part) for part in path]
    return "$" + ("." + ".".join(parts) if parts else "")


def validate_seed(
    seed: Mapping[str, Any], schema_path: str | Path = DEFAULT_SCHEMA,
    alias_path: str | Path = DEFAULT_ALIAS_FILE,
    alias_schema_path: str | Path = DEFAULT_ALIAS_SCHEMA,
) -> None:
    with Path(schema_path).open(encoding="utf-8") as stream:
        schema = json.load(stream)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = [
        f"{_at_path(error.absolute_path)}: {error.message}"
        for error in validator.iter_errors(seed)
    ]
    if errors:
        raise ValidationFailure(sorted(errors))

    with Path(alias_path).open(encoding="utf-8") as stream:
        aliases = json.load(stream)
    with Path(alias_schema_path).open(encoding="utf-8") as stream:
        alias_schema = json.load(stream)
    alias_validator = Draft202012Validator(alias_schema)
    errors.extend(
        f"legacy_aliases{_at_path(error.absolute_path)}: {error.message}"
        for error in alias_validator.iter_errors(aliases)
    )

    sources = seed["sources"]
    nodes = seed["nodes"]
    claims = seed["claims"]
    review_events = seed["review_events"]
    source_ids = _unique_ids(sources, "source", errors)
    node_ids = _unique_ids(nodes, "node", errors)
    claim_ids = _unique_ids(claims, "claim", errors)
    _unique_ids(review_events, "review", errors)
    _unique_identity_keys([*sources, *nodes, *claims, *review_events], errors)
    valid_alias_targets = {
        "node": node_ids, "source": source_ids, "claim": claim_ids,
    }
    for alias, target in aliases.get("aliases", {}).items():
        kind = alias.partition(":")[0]
        if target not in valid_alias_targets.get(kind, set()):
            errors.append(f"legacy_aliases.aliases.{alias}: target {target} is missing or has the wrong type")

    for record_type, records in (("source", sources), ("node", nodes), ("claim", claims), ("review", review_events)):
        for index, record in enumerate(records):
            expected = stable_id(record_type, record["identity_key"])
            if record["id"] != expected:
                errors.append(
                    f"{record_type}s[{index}].id: does not match its immutable identity_key; "
                    f"expected {expected}"
                )

    for index, source in enumerate(sources):
        if not source.get("license", "").strip():
            errors.append(f"sources[{index}].license: a source-level license note is required")

    for index, node in enumerate(nodes):
        expected_evidence_status = "sourced" if node.get("source_ids") else "unsourced"
        if node.get("evidence_status") != expected_evidence_status:
            errors.append(
                f"nodes[{index}].evidence_status: expected {expected_evidence_status} from source_ids"
            )
        parent_id = node.get("parent_id")
        if parent_id is not None and parent_id not in node_ids:
            errors.append(f"nodes[{index}].parent_id: unknown node {parent_id}")
        if parent_id is not None and node.get("hierarchy_relation") != "part_of":
            errors.append(f"nodes[{index}].hierarchy_relation: parent_id requires part_of")
        for source_id in [*node.get("source_ids", []), *node.get("hierarchy_evidence_source_ids", [])]:
            if source_id not in source_ids:
                errors.append(f"nodes[{index}]: unknown source {source_id}")
        for date_index, assertion in enumerate(node.get("date_assertions", [])):
            expected_date_id = stable_id("date", f"{node['id']}|{assertion['aspect']}")
            if assertion["id"] != expected_date_id:
                errors.append(
                    f"nodes[{index}].date_assertions[{date_index}].id: does not match its node and aspect; "
                    f"expected {expected_date_id}"
                )
            start, end = assertion.get("start_year"), assertion.get("end_year")
            if start is not None and end is not None and start > end:
                errors.append(f"nodes[{index}].date_assertions[{date_index}]: start_year exceeds end_year")
            for source_id in assertion.get("evidence_source_ids", []):
                if source_id not in source_ids:
                    errors.append(
                        f"nodes[{index}].date_assertions[{date_index}]: unknown source {source_id}"
                    )

    errors.extend(_hierarchy_cycle_errors(nodes, node_ids))

    for index, claim in enumerate(claims):
        expected_evidence_status = "sourced" if claim.get("evidence_source_ids") else "unsourced"
        if claim.get("evidence_status") != expected_evidence_status:
            errors.append(
                f"claims[{index}].evidence_status: expected {expected_evidence_status} from evidence_source_ids"
            )
        if claim.get("subject_id") not in node_ids:
            errors.append(f"claims[{index}].subject_id: unknown node {claim.get('subject_id')}")
        if claim.get("object_id") not in node_ids:
            errors.append(f"claims[{index}].object_id: unknown node {claim.get('object_id')}")
        if claim.get("subject_id") == claim.get("object_id"):
            errors.append(f"claims[{index}]: subject and object must differ")
        for source_id in claim.get("evidence_source_ids", []):
            if source_id not in source_ids:
                errors.append(f"claims[{index}]: unknown evidence source {source_id}")
        if claim.get("status") == "published" and not claim.get("evidence_source_ids"):
            errors.append(f"claims[{index}]: published claims require bibliographic evidence")
        if claim.get("confidence") in {4, 5} and not claim.get("evidence_source_ids"):
            errors.append(f"claims[{index}]: confidence 4–5 requires a scholarly citation")
        if claim.get("consensus") == "contested" and len(claim.get("evidence_source_ids", [])) < 2:
            errors.append(f"claims[{index}]: contested claims require at least two source citations")
        for date_index, assertion in enumerate(claim.get("date_assertions", [])):
            expected_date_id = stable_id("date", f"{claim['id']}|{assertion['aspect']}")
            if assertion["id"] != expected_date_id:
                errors.append(
                    f"claims[{index}].date_assertions[{date_index}].id: does not match its claim and aspect; "
                    f"expected {expected_date_id}"
                )
            start, end = assertion.get("start_year"), assertion.get("end_year")
            if start is not None and end is not None and start > end:
                errors.append(f"claims[{index}].date_assertions[{date_index}]: start_year exceeds end_year")
            for source_id in assertion.get("evidence_source_ids", []):
                if source_id not in source_ids:
                    errors.append(f"claims[{index}].date_assertions[{date_index}]: unknown source {source_id}")
        if claim.get("date_label"):
            labels = [item.get("display_label") for item in claim.get("date_assertions", [])]
            if claim["date_label"] not in labels:
                errors.append(f"claims[{index}].date_label: must match a date assertion display_label")

    claims_by_id = {claim["id"]: claim for claim in claims}
    review_counts: dict[str, set[str]] = {}
    for index, event in enumerate(review_events):
        if event["claim_id"] not in claim_ids:
            errors.append(f"review_events[{index}].claim_id: unknown claim {event['claim_id']}")
        review_counts.setdefault(event["claim_id"], set()).add(event["reviewer"])
    for index, claim in enumerate(claims):
        if claim["status"] == "published":
            reviewer_count = len(review_counts.get(claim["id"], set()))
            required = 2 if claim["consensus"] == "contested" else 1
            if reviewer_count < required:
                errors.append(
                    f"claims[{index}]: published claim requires {required} distinct reviewer(s); "
                    f"found {reviewer_count}"
                )
    for index, path in enumerate(seed.get("guided_paths", [])):
        if any(node_id not in node_ids for node_id in path.get("nodes", [])):
            errors.append(f"guided_paths[{index}].nodes: contains an unknown node ID")
        if any(claim_id not in claim_ids for claim_id in path.get("edges", [])):
            errors.append(f"guided_paths[{index}].edges: contains an unknown claim ID")
        if len(path.get("edges", [])) != len(path.get("nodes", [])) - 1:
            errors.append(f"guided_paths[{index}]: edge and node sequence lengths do not form a path")
        for position, claim_id in enumerate(path.get("edges", [])):
            claim = claims_by_id.get(claim_id)
            if claim and position + 1 < len(path.get("nodes", [])):
                pair = (path["nodes"][position], path["nodes"][position + 1])
                if pair not in {
                    (claim["subject_id"], claim["object_id"]),
                    (claim["object_id"], claim["subject_id"]),
                }:
                    errors.append(f"guided_paths[{index}].edges[{position}]: claim endpoints do not match adjacent nodes")

    if errors:
        raise ValidationFailure(sorted(errors))


def _unique_ids(records: list[dict[str, Any]], kind: str, errors: list[str]) -> set[str]:
    ids = [record.get("id") for record in records]
    seen: set[str] = set()
    duplicates: set[str] = set()
    for record_id in ids:
        if record_id in seen:
            duplicates.add(str(record_id))
        seen.add(str(record_id))
    errors.extend(f"{kind}s: duplicate ID {record_id}" for record_id in sorted(duplicates))
    return set(ids)


def _unique_identity_keys(records: list[dict[str, Any]], errors: list[str]) -> None:
    owners: dict[str, str] = {}
    for record in records:
        key = f"{record.get('id', '').split(':')[1]}:{record.get('identity_key')}"
        if key in owners and owners[key] != record.get("id"):
            errors.append(f"identity_key: duplicate key used by {owners[key]} and {record.get('id')}")
        owners[key] = record.get("id", "")


def _hierarchy_cycle_errors(nodes: list[dict[str, Any]], node_ids: set[str]) -> list[str]:
    parents = {node["id"]: node.get("parent_id") for node in nodes}
    errors: list[str] = []
    complete: set[str] = set()
    for start in sorted(node_ids):
        trail: list[str] = []
        current = start
        positions: dict[str, int] = {}
        while current is not None and current not in complete:
            if current in positions:
                cycle = trail[positions[current]:] + [current]
                errors.append("nodes.parent_id: hierarchy cycle " + " -> ".join(cycle))
                break
            positions[current] = len(trail)
            trail.append(current)
            current = parents.get(current)
        complete.update(trail)
    return errors
