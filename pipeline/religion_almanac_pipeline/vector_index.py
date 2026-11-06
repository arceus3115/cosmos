"""Provider-neutral seam for similarity candidates; never writes canonical claims."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, Sequence


@dataclass(frozen=True)
class VectorDocument:
    record_id: str
    text_checksum: str
    vector: Sequence[float]
    model_version: str
    source_ids: Sequence[str]


@dataclass(frozen=True)
class VectorHit:
    record_id: str
    similarity: float


class CandidateVectorStore(Protocol):
    """Adapter implemented by a future pgvector or external-provider integration."""

    def upsert(self, documents: Sequence[VectorDocument]) -> None:
        """Index rebuildable representations of approved input records."""

    def query(self, vector: Sequence[float], *, limit: int) -> Sequence[VectorHit]:
        """Return discovery matches only; similarity is not a scholarly claim."""


@dataclass(frozen=True)
class SimilarityCandidate:
    subject_id: str
    object_id: str
    similarity: float
    input_record_ids: Sequence[str]
    model_version: str
    generated_at: datetime
    source_ids: Sequence[str]


def candidate_from_hit(
    subject_id: str,
    hit: VectorHit,
    *,
    model_version: str,
    generated_at: datetime,
    subject_source_ids: Sequence[str],
    hit_source_ids: Sequence[str],
) -> SimilarityCandidate:
    """Create review metadata for a match without assigning a relation type or status."""
    return SimilarityCandidate(
        subject_id=subject_id,
        object_id=hit.record_id,
        similarity=hit.similarity,
        input_record_ids=(subject_id, hit.record_id),
        model_version=model_version,
        generated_at=generated_at,
        source_ids=tuple(sorted(set(subject_source_ids) | set(hit_source_ids))),
    )
