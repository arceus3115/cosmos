"""Normalized-only source staging with provenance and idempotent reruns."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from jsonschema import Draft202012Validator, FormatChecker

from .build import stable_json


class NormalizedConnector(Protocol):
    name: str
    version: str
    normalization_version: str

    def fetch_normalized(self) -> list[dict[str, Any]]:
        """Fetch, parse, and normalize a source without returning raw payloads."""


@dataclass(frozen=True)
class Provenance:
    source_url: str
    license: str | None
    connector_version: str
    normalization_version: str
    retrieved_at: str
    upstream_version: str | None = None


def stage_normalized_records(
    records: list[dict[str, Any]],
    provenance: Provenance,
    output_dir: str | Path = "data/candidates",
) -> Path:
    _reject_raw_payload_fields(records)
    normalized_bytes = stable_json(records)
    checksum = hashlib.sha256(normalized_bytes).hexdigest()
    identity = "\0".join([
        provenance.source_url, checksum, provenance.connector_version,
        provenance.normalization_version, provenance.license or "", provenance.upstream_version or "",
    ])
    candidate_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    license_note = (provenance.license or "").strip()
    lowered_license = license_note.casefold()
    licensed = bool(license_note) and not any(
        marker in lowered_license for marker in ("unknown", "to be confirmed", "unverified")
    )
    payload = {
        "candidate_id": candidate_id,
        "status": "candidate" if licensed else "quarantined",
        "provenance": asdict(provenance),
        "normalized_checksum": checksum,
        "records": records,
    }
    schema_path = Path("data/schemas/candidate.schema.json")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    errors = Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(payload)
    messages = [f"candidate: {error.message}" for error in errors]
    if messages:
        raise ValueError("Invalid normalized candidate:\n- " + "\n- ".join(messages))
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{candidate_id}.json"
    if target.exists():
        existing = json.loads(target.read_text(encoding="utf-8"))
        if existing.get("normalized_checksum") == checksum:
            return target
    target.write_bytes(stable_json(payload))
    return target


def _reject_raw_payload_fields(value: Any, path: str = "records") -> None:
    forbidden = {"raw", "raw_payload", "upstream_payload", "snapshot"}
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).casefold() in forbidden:
                raise ValueError(f"{path}.{key}: raw source payloads are not retained")
            _reject_raw_payload_fields(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_raw_payload_fields(child, f"{path}[{index}]")


def now_utc() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
