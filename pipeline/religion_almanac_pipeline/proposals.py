"""Validation and application of curator-created record proposals."""

from __future__ import annotations

import copy
import difflib
import hashlib
import json
import unicodedata
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from .build import stable_json
from .ids import stable_id
from .validate import DEFAULT_SCHEMA, DEFAULT_SEED, ValidationFailure, load_seed, validate_seed

DEFAULT_PROPOSAL_SCHEMA = Path("data/schemas/proposal.schema.json")


class ProposalFailure(ValueError):
    """Actionable proposal validation or application failure."""

    def __init__(self, errors: list[str], warnings: list[str] | None = None):
        self.errors = errors
        self.warnings = warnings or []
        super().__init__("Proposal cannot be processed:\n- " + "\n- ".join(errors))


def load_proposal(path: str | Path) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProposalFailure([f"{path}: {error}"]) from error
    if not isinstance(value, dict):
        raise ProposalFailure(["$: expected a JSON object"])
    return value


def canonical_checksum(seed: dict[str, Any]) -> str:
    return hashlib.sha256(stable_json(seed)).hexdigest()


def is_stale(proposal: dict[str, Any], seed: dict[str, Any]) -> bool:
    return (
        proposal.get("base_release") != seed.get("metadata", {}).get("release")
        or proposal.get("base_checksum") != canonical_checksum(seed)
    )


def _at_path(path: Any) -> str:
    parts = [str(part) for part in path]
    return "$" + ("." + ".".join(parts) if parts else "")


def _normalized_name(value: str) -> str:
    return unicodedata.normalize("NFC", value).casefold().strip()


def _duplicate_warnings(proposal: dict[str, Any], seed: dict[str, Any]) -> list[str]:
    record = proposal["record"]
    if record is None:
        warnings: list[str] = []
        nodes_by_id = {node["id"]: node for node in seed["nodes"]}
        for change_index, change in enumerate(proposal.get("record_changes", [])):
            target_id = change["node_id"]
            target = nodes_by_id.get(target_id)
            if not target:
                continue
            for name in change.get("add_name_variants", []):
                normalized = _normalized_name(name["value"])
                for existing in seed["nodes"]:
                    if existing["id"] == target_id:
                        continue
                    values = [existing["label"], *(item["value"] for item in existing.get("name_variants", []))]
                    for value in values:
                        other_normalized = _normalized_name(value)
                        if normalized == other_normalized or (
                            len(normalized) >= 5 and difflib.SequenceMatcher(
                                a=normalized, b=other_normalized
                            ).ratio() >= 0.88
                        ):
                            warnings.append(
                                f"record_changes[{change_index}].add_name_variants: "
                                f"{name['value']!r} may match {existing['type']} {value!r} ({existing['id']})"
                            )
        return sorted(set(warnings))
    existing_names: list[tuple[str, str, str]] = []
    for existing in seed["nodes"]:
        existing_names.append((existing["label"], existing["id"], existing["type"]))
        existing_names.extend(
            (item["value"], existing["id"], existing["type"])
            for item in existing.get("name_variants", [])
        )

    warnings: list[str] = []
    proposed_names = [record["label"], *(item["value"] for item in record.get("name_variants", []))]
    warned: set[tuple[str, str]] = set()
    for candidate in proposed_names:
        normalized = _normalized_name(candidate)
        if not normalized:
            continue
        for existing_name, existing_id, existing_type in existing_names:
            existing_normalized = _normalized_name(existing_name)
            pair = (normalized, existing_id)
            if pair in warned:
                continue
            ratio = difflib.SequenceMatcher(a=normalized, b=existing_normalized).ratio()
            if normalized == existing_normalized or (ratio >= 0.88 and len(normalized) >= 5):
                warnings.append(
                    f"record: name {candidate!r} may match {existing_type} "
                    f"{existing_name!r} ({existing_id}); review identity before applying"
                )
                warned.add(pair)
    return sorted(set(warnings))


def _identifier_errors(proposal: dict[str, Any], seed: dict[str, Any]) -> list[str]:
    known: dict[tuple[str, str], str] = {}
    for node in seed["nodes"]:
        for identifier in node.get("external_identifiers", []):
            key = (identifier["namespace"].strip().casefold(), identifier["value"].strip())
            known[key] = node["id"]
    errors: list[str] = []
    record = proposal.get("record")
    if record:
        for index, identifier in enumerate(record.get("external_identifiers", [])):
            key = (identifier["namespace"].strip().casefold(), identifier["value"].strip())
            existing_id = known.get(key)
            if existing_id:
                errors.append(
                    f"record.external_identifiers[{index}]: {key[0]}:{key[1]} already belongs to {existing_id}"
                )
            known[key] = record["id"]
    for change_index, change in enumerate(proposal.get("record_changes", [])):
        for identifier_index, identifier in enumerate(change.get("add_external_identifiers", [])):
            key = (identifier["namespace"].strip().casefold(), identifier["value"].strip())
            existing_id = known.get(key)
            if existing_id:
                errors.append(
                    f"record_changes[{change_index}].add_external_identifiers[{identifier_index}]: "
                    f"{key[0]}:{key[1]} already belongs to {existing_id}"
                )
            known[key] = change["node_id"]
    for index, source in enumerate(proposal.get("sources", [])):
        license_text = source.get("license", "").strip().casefold()
        if any(marker in license_text for marker in ("unknown", "unverified", "to be confirmed", "tbd")):
            errors.append(f"sources[{index}].license: resolve the license/terms before proposing this source")
    return errors


def _hierarchy_errors(proposal: dict[str, Any], seed: dict[str, Any]) -> list[str]:
    record = proposal["record"]
    if record is None:
        return []
    parent_id = record.get("parent_id")
    if parent_id is None:
        return []
    nodes = {node["id"]: node for node in seed["nodes"]}
    nodes.update({record["id"]: record})
    parent = nodes.get(parent_id)
    if not parent:
        return []  # The combined canonical validator reports the missing reference.
    allowed = {
        "tradition": {"tradition"},
        "text": {"tradition", "text"},
        "story": {"tradition", "text"},
        "work": {"tradition", "text"},
    }
    permitted = allowed.get(record["type"])
    if permitted is not None and parent["type"] not in permitted:
        return [
            f"record.parent_id: a {record['type']} may be part_of {', '.join(sorted(permitted))}; "
            f"selected parent is {parent['type']} ({parent_id})"
        ]
    return []


def validate_proposal(
    proposal: dict[str, Any],
    seed: dict[str, Any] | None = None,
    *,
    seed_path: str | Path = DEFAULT_SEED,
    proposal_schema_path: str | Path = DEFAULT_PROPOSAL_SCHEMA,
    seed_schema_path: str | Path = DEFAULT_SCHEMA,
) -> list[str]:
    """Validate a proposal against its schema and the canonical graph; return warnings."""
    seed = seed or load_seed(seed_path)
    proposal_schema = json.loads(Path(proposal_schema_path).read_text(encoding="utf-8"))
    seed_schema = json.loads(Path(seed_schema_path).read_text(encoding="utf-8"))
    registry = Registry().with_resource(seed_schema["$id"], Resource.from_contents(seed_schema))
    validator = Draft202012Validator(
        proposal_schema, registry=registry, format_checker=FormatChecker()
    )
    structural_errors = [
        f"proposal{_at_path(error.absolute_path)}: {error.message}"
        for error in validator.iter_errors(proposal)
    ]
    if structural_errors:
        raise ProposalFailure(sorted(structural_errors))

    errors: list[str] = []
    record = proposal["record"]
    if record and record["status"] != "draft":
        errors.append("record.status: proposals must create draft records")
    for index, source in enumerate(proposal["sources"]):
        if source["status"] != "draft":
            errors.append(f"sources[{index}].status: proposed sources must start as draft")
    for index, claim in enumerate(proposal["claims"]):
        if claim["status"] != "draft":
            errors.append(f"claims[{index}].status: proposed claims must start as draft")
    if record is None and (proposal["sources"] or proposal["claims"]):
        errors.append("proposal: an alias/identifier change cannot include new sources or claims")
    if record is not None and proposal["record_changes"]:
        errors.append("proposal: choose either a new record or changes to an existing record, not both")

    candidate = copy.deepcopy(seed)
    candidate["sources"].extend(proposal["sources"])
    if record:
        candidate["nodes"].append(record)
    candidate["claims"].extend(proposal["claims"])
    candidate_nodes = {node["id"]: node for node in candidate["nodes"]}
    for change_index, change in enumerate(proposal.get("record_changes", [])):
        if not change["add_name_variants"] and not change["add_external_identifiers"]:
            errors.append(f"record_changes[{change_index}]: add at least one name or external identifier")
        target = candidate_nodes.get(change["node_id"])
        if not target or change["node_id"] == (record or {}).get("id"):
            errors.append(f"record_changes[{change_index}].node_id: must reference an existing canonical node")
            continue
        existing_names = {item["value"] for item in target.get("name_variants", [])}
        for name_index, name in enumerate(change["add_name_variants"]):
            if name["value"] == target["label"] or name["value"] in existing_names:
                errors.append(
                    f"record_changes[{change_index}].add_name_variants[{name_index}]: "
                    "name already exists on the selected record"
                )
            existing_names.add(name["value"])
        target.setdefault("name_variants", []).extend(change["add_name_variants"])
        existing_identifiers = {
            (item["namespace"], item["value"])
            for item in target.get("external_identifiers", [])
        }
        for identifier_index, identifier in enumerate(change["add_external_identifiers"]):
            key = (identifier["namespace"], identifier["value"])
            if key in existing_identifiers:
                errors.append(
                    f"record_changes[{change_index}].add_external_identifiers[{identifier_index}]: "
                    "identifier already exists on the selected record"
                )
            existing_identifiers.add(key)
        target.setdefault("external_identifiers", []).extend(change["add_external_identifiers"])

    errors.extend(_identifier_errors(proposal, seed))
    errors.extend(_hierarchy_errors(proposal, seed))
    try:
        validate_seed(candidate, seed_schema_path)
    except ValidationFailure as error:
        errors.extend(f"proposal: {message}" for message in error.errors)
    if errors:
        raise ProposalFailure(sorted(set(errors)))

    warnings = _duplicate_warnings(proposal, seed)
    if proposal.get("example_only"):
        warnings.append("proposal.example_only: this synthetic example is not eligible for application")
    if is_stale(proposal, seed):
        warnings.insert(0, "proposal.base_release/base_checksum: canonical seed changed since this draft; revalidate before applying")
    if record and proposal["curator_notes"].get("classification_uncertain"):
        warnings.append("curator_notes.classification_uncertain: reviewer should confirm the selected record type")
    warnings.extend(
        f"curator_notes.warnings: {warning}"
        for warning in proposal["curator_notes"].get("warnings", [])
    )
    return warnings


def apply_proposal(
    proposal: dict[str, Any],
    seed_path: str | Path = DEFAULT_SEED,
    *,
    apply: bool = False,
    revalidate: bool = False,
    proposal_schema_path: str | Path = DEFAULT_PROPOSAL_SCHEMA,
    seed_schema_path: str | Path = DEFAULT_SCHEMA,
) -> tuple[str, list[str]]:
    """Return a unified diff, optionally applying the validated proposal to the seed."""
    if proposal.get("example_only"):
        raise ProposalFailure(["example-only proposal files cannot be applied to the canonical seed"])
    path = Path(seed_path)
    original_text = path.read_text(encoding="utf-8")
    seed = json.loads(original_text)
    all_ids = {
        item["id"]
        for key in ("sources", "nodes", "claims")
        for item in seed[key]
    }
    proposed_sources = proposal.get("sources", [])
    proposed_claims = proposal.get("claims", [])
    if not isinstance(proposed_sources, list):
        proposed_sources = []
    if not isinstance(proposed_claims, list):
        proposed_claims = []
    proposed_ids = [
        *(source.get("id") for source in proposed_sources if isinstance(source, dict)),
        *(claim.get("id") for claim in proposed_claims if isinstance(claim, dict)),
    ]
    if isinstance(proposal.get("record"), dict):
        proposed_ids.append(proposal["record"].get("id"))
    collisions = sorted(value for value in set(proposed_ids) & all_ids if value)
    if collisions:
        raise ProposalFailure([
            "proposal has already been applied or an ID collision exists: " + ", ".join(collisions)
        ])
    warnings = validate_proposal(
        proposal, seed, seed_path=seed_path,
        proposal_schema_path=proposal_schema_path,
        seed_schema_path=seed_schema_path,
    )
    duplicate_warnings = [warning for warning in warnings if "may match" in warning]
    if duplicate_warnings:
        reasons = [proposal["curator_notes"].get("duplicate_override_reason")]
        reasons.extend(change.get("reason") for change in proposal.get("record_changes", []))
        if not any(reason and reason.strip() for reason in reasons):
            raise ProposalFailure(
                ["possible duplicate match: add a curator reason before applying"], warnings
            )
    if is_stale(proposal, seed) and not revalidate:
        raise ProposalFailure([
            "proposal.base_release/base_checksum is stale; rerun after reviewing against the current seed "
            "with --revalidate"
        ], warnings)

    updated = copy.deepcopy(seed)
    updated["sources"].extend(proposal["sources"])
    if proposal["record"]:
        updated["nodes"].append(proposal["record"])
    updated["claims"].extend(proposal["claims"])
    updated_nodes = {node["id"]: node for node in updated["nodes"]}
    for change in proposal.get("record_changes", []):
        node = updated_nodes[change["node_id"]]
        node.setdefault("name_variants", []).extend(change["add_name_variants"])
        node.setdefault("external_identifiers", []).extend(change["add_external_identifiers"])
    validate_seed(updated, seed_schema_path)
    new_text = json.dumps(updated, ensure_ascii=False, indent=2) + "\n"
    diff = "".join(difflib.unified_diff(
        original_text.splitlines(keepends=True),
        new_text.splitlines(keepends=True),
        fromfile=str(path), tofile=f"{path} (proposal {proposal['proposal_id']})",
    ))
    if apply:
        path.write_text(new_text, encoding="utf-8")
    return diff, warnings
