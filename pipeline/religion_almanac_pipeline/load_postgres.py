"""Transactional replacement of the PostgreSQL read model from canonical JSON."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import create_engine, text

from .build import stable_json


_CLEAR_TABLES = (
    "data_releases, guided_path_nodes, guided_path_claims, guided_paths, date_assertion_sources, "
    "date_assertions, review_events, claim_sources, influence_claims, node_sources, "
    "external_identifiers, node_names, nodes, sources RESTART IDENTITY"
)


def load_postgres(seed: dict[str, Any], database_url: str) -> dict[str, int]:
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(f"TRUNCATE TABLE {_CLEAR_TABLES}")
            for source in seed["sources"]:
                connection.execute(text("""
                    INSERT INTO sources (id, identity_key, title, author, container, publisher,
                                         publication_year, url, license, status)
                    VALUES (:id, :identity_key, :title, :author, :container, :publisher,
                            :year, :url, :license, :status)
                """), {**source, "year": source.get("year")})

            for node in seed["nodes"]:
                connection.execute(text("""
                    INSERT INTO nodes (id, identity_key, type, label, summary, status, parent_id,
                                       hierarchy_relation, evidence_status, name_variants, languages, external_links)
                    VALUES (:id, :identity_key, :type, :label, :summary, :status, :parent_id,
                            :hierarchy_relation, :evidence_status, CAST(:name_variants AS jsonb),
                            :languages, CAST(:external_links AS jsonb))
                """), {
                    **node,
                    "name_variants": json.dumps(node["name_variants"], ensure_ascii=False),
                    "external_links": json.dumps(node["external_links"], ensure_ascii=False),
                })
                names = [{"value": node["label"], "language": None, "script": None, "role": "preferred"}]
                names.extend(node["name_variants"])
                connection.execute(text("""
                    INSERT INTO node_names (node_id, value, language, script, role)
                    VALUES (:node_id, :value, :language, :script, :role)
                """), [dict(name, node_id=node["id"]) for name in names])
                for identifier in node["external_identifiers"]:
                    connection.execute(text("""
                        INSERT INTO external_identifiers (node_id, namespace, value)
                        VALUES (:node_id, :namespace, :value)
                    """), {**identifier, "node_id": node["id"]})
                for source_id in node["source_ids"]:
                    connection.execute(text("""
                        INSERT INTO node_sources (node_id, source_id, role) VALUES (:node_id, :source_id, 'citation')
                    """), {"node_id": node["id"], "source_id": source_id})
                for source_id in node["hierarchy_evidence_source_ids"]:
                    connection.execute(text("""
                        INSERT INTO node_sources (node_id, source_id, role)
                        VALUES (:node_id, :source_id, 'hierarchy_evidence')
                    """), {"node_id": node["id"], "source_id": source_id})
                for assertion in node["date_assertions"]:
                    connection.execute(text("""
                        INSERT INTO date_assertions (id, node_id, aspect, start_year, end_year,
                            year_convention, precision, display_label, uncertainty_note)
                        VALUES (:id, :node_id, :aspect, :start_year, :end_year,
                            :year_convention, :precision, :display_label, :uncertainty_note)
                    """), {**assertion, "node_id": node["id"]})
                    for source_id in assertion["evidence_source_ids"]:
                        connection.execute(text("""
                            INSERT INTO date_assertion_sources (date_assertion_id, source_id)
                            VALUES (:date_assertion_id, :source_id)
                        """), {"date_assertion_id": assertion["id"], "source_id": source_id})

            for claim in seed["claims"]:
                connection.execute(text("""
                    INSERT INTO influence_claims (id, identity_key, subject_id, object_id, relation_type,
                        direction, confidence, consensus, rationale, date_label, inferred, status, evidence_status)
                    VALUES (:id, :identity_key, :subject_id, :object_id, :relation_type,
                        :direction, :confidence, :consensus, :rationale, :date_label, :inferred, :status, :evidence_status)
                """), claim)
                for source_id in claim["evidence_source_ids"]:
                    connection.execute(text("""
                        INSERT INTO claim_sources (claim_id, source_id, locator)
                        VALUES (:claim_id, :source_id, '')
                    """), {"claim_id": claim["id"], "source_id": source_id})
                for assertion in claim["date_assertions"]:
                    connection.execute(text("""
                        INSERT INTO date_assertions (id, claim_id, aspect, start_year, end_year,
                            year_convention, precision, display_label, uncertainty_note)
                        VALUES (:id, :claim_id, :aspect, :start_year, :end_year,
                            :year_convention, :precision, :display_label, :uncertainty_note)
                    """), {**assertion, "claim_id": claim["id"]})
                    for source_id in assertion["evidence_source_ids"]:
                        connection.execute(text("""
                            INSERT INTO date_assertion_sources (date_assertion_id, source_id)
                            VALUES (:date_assertion_id, :source_id)
                        """), {"date_assertion_id": assertion["id"], "source_id": source_id})

            for event in seed["review_events"]:
                connection.execute(text("""
                    INSERT INTO review_events (id, identity_key, claim_id, reviewer, action, occurred_at, resolution_note)
                    VALUES (:id, :identity_key, :claim_id, :reviewer, :action, :occurred_at, :resolution_note)
                """), event)

            for path in seed["guided_paths"]:
                connection.execute(text("""
                    INSERT INTO guided_paths (id, title, subtitle, introduction)
                    VALUES (:id, :title, :subtitle, :introduction)
                """), path)
                for position, node_id in enumerate(path["nodes"]):
                    connection.execute(text("""
                        INSERT INTO guided_path_nodes (path_id, position, node_id)
                        VALUES (:path_id, :position, :node_id)
                    """), {"path_id": path["id"], "position": position, "node_id": node_id})
                for position, claim_id in enumerate(path["edges"]):
                    connection.execute(text("""
                        INSERT INTO guided_path_claims (path_id, position, claim_id)
                        VALUES (:path_id, :position, :claim_id)
                    """), {"path_id": path["id"], "position": position, "claim_id": claim_id})
            actual_counts = {
                table: connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
                for table in ("sources", "nodes", "influence_claims", "date_assertions", "review_events", "guided_paths")
            }
            expected_counts = {
                "sources": len(seed["sources"]), "nodes": len(seed["nodes"]),
                "influence_claims": len(seed["claims"]),
                "date_assertions": sum(len(node["date_assertions"]) for node in seed["nodes"])
                    + sum(len(claim["date_assertions"]) for claim in seed["claims"]),
                "review_events": len(seed["review_events"]), "guided_paths": len(seed["guided_paths"]),
            }
            if actual_counts != expected_counts:
                raise RuntimeError(f"Read-model reconciliation failed: expected {expected_counts}, got {actual_counts}")
            connection.execute(text("""
                INSERT INTO data_releases (singleton_id, dataset_release, canonical_checksum, node_count, claim_count)
                VALUES (1, :dataset_release, :canonical_checksum, :node_count, :claim_count)
            """), {
                "dataset_release": seed["metadata"]["release"],
                "canonical_checksum": hashlib.sha256(stable_json(seed)).hexdigest(),
                "node_count": len(seed["nodes"]), "claim_count": len(seed["claims"]),
            })
            result = actual_counts
    finally:
        engine.dispose()
    return result
