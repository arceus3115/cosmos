"""Stable identifiers derived from frozen, namespaced identity keys."""

from __future__ import annotations

import hashlib


def stable_id(kind: str, identity_key: str) -> str:
    """Return the persistent ID for a record's immutable identity key."""
    digest = hashlib.sha256(f"{kind}\0{identity_key}".encode("utf-8")).hexdigest()[:24]
    return f"ra:{kind}:{digest}"
