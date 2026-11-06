"""Bounded path enumeration with Pareto filtering, without a combined score."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

CONSENSUS_ORDER = {"fringe": 0, "contested": 1, "majority": 2, "consensus": 3}


def non_dominated_paths(
    node_ids: set[str],
    claims: list[dict[str, Any]],
    start: str,
    end: str,
    *,
    max_hops: int = 6,
    limit: int = 10,
    allow_reverse: bool = False,
    expansion_cap: int = 50_000,
) -> dict[str, Any]:
    """Find simple paths and return routes not dominated on independent evidence dimensions."""
    if start not in node_ids or end not in node_ids:
        return {"paths": [], "truncated": False, "enumerated_routes": 0, "expansions": 0}
    if start == end:
        return {
            "paths": [{"nodes": [start], "claim_ids": [], "steps": [],
                       "dimensions": {"hops": 0, "weakest_consensus_rank": None,
                                      "weakest_consensus_label": None, "weakest_confidence": None}}],
            "truncated": False, "enumerated_routes": 1, "expansions": 0,
        }
    adjacency: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in claims:
        if claim["subject_id"] not in node_ids or claim["object_id"] not in node_ids:
            continue
        adjacency[claim["subject_id"]].append({
            "claim": claim, "from": claim["subject_id"], "to": claim["object_id"], "reverse": False,
        })
        if allow_reverse:
            adjacency[claim["object_id"]].append({
                "claim": claim, "from": claim["object_id"], "to": claim["subject_id"], "reverse": True,
            })
    for options in adjacency.values():
        options.sort(key=lambda item: (item["to"], item["claim"]["id"], item["reverse"]))

    candidates: list[dict[str, Any]] = []
    expansions = 0

    def visit(current: str, visited: list[str], steps: list[dict[str, Any]]) -> None:
        nonlocal expansions
        if len(steps) >= max_hops or expansions >= expansion_cap:
            return
        for option in adjacency.get(current, []):
            expansions += 1
            next_id = option["to"]
            if next_id in visited:
                continue
            claim = option["claim"]
            step = {
                "claim_id": claim["id"], "subject_id": claim["subject_id"],
                "object_id": claim["object_id"], "traversed_from": option["from"],
                "traversed_to": next_id, "reverse_traversal": option["reverse"],
                "relation_type": claim["relation_type"], "direction": claim["direction"],
                "confidence": claim["confidence"], "consensus": claim["consensus"],
                "inferred": claim["inferred"], "rationale": claim["rationale"],
                "evidence_source_ids": claim["evidence_source_ids"],
                "evidence": claim.get("evidence", []),
                "date_assertions": claim.get("date_assertions", []),
            }
            next_steps = [*steps, step]
            if next_id == end:
                candidates.append(_path_result([*visited, next_id], next_steps))
                if len(candidates) >= 2_000:
                    return
            else:
                visit(next_id, [*visited, next_id], next_steps)
            if expansions >= expansion_cap or len(candidates) >= 2_000:
                return

    visit(start, [start], [])
    unique = {tuple(step["claim_id"] + (":r" if step["reverse_traversal"] else ":f") for step in item["steps"]): item for item in candidates}
    routes = list(unique.values())
    nondominated = [
        candidate for candidate in routes
        if not any(other is not candidate and _dominates(other["dimensions"], candidate["dimensions"])
                   for other in routes)
    ]
    nondominated.sort(key=lambda item: (item["dimensions"]["hops"], tuple(item["claim_ids"]), tuple(item["nodes"])))
    return {
        "paths": nondominated[:limit],
        "truncated": expansions >= expansion_cap or len(candidates) >= 2_000 or len(nondominated) > limit,
        "enumerated_routes": len(candidates),
        "expansions": expansions,
    }


def _path_result(nodes: list[str], steps: list[dict[str, Any]]) -> dict[str, Any]:
    consensus = [CONSENSUS_ORDER.get(step["consensus"], 0) for step in steps]
    confidence = [step["confidence"] or 0 for step in steps]
    weakest_consensus = min(steps, key=lambda step: CONSENSUS_ORDER.get(step["consensus"], 0))["consensus"]
    return {
        "nodes": nodes,
        "claim_ids": [step["claim_id"] for step in steps],
        "steps": steps,
        "dimensions": {
            "hops": len(steps), "weakest_consensus_rank": min(consensus, default=0),
            "weakest_consensus_label": weakest_consensus or "unknown",
            "weakest_confidence": min(confidence, default=0),
        },
    }


def _dominates(left: dict[str, int], right: dict[str, int]) -> bool:
    no_worse = (
        left["hops"] <= right["hops"]
        and left["weakest_consensus_rank"] >= right["weakest_consensus_rank"]
        and left["weakest_confidence"] >= right["weakest_confidence"]
    )
    strictly_better = (
        left["hops"] < right["hops"]
        or left["weakest_consensus_rank"] > right["weakest_consensus_rank"]
        or left["weakest_confidence"] > right["weakest_confidence"]
    )
    return no_worse and strictly_better
