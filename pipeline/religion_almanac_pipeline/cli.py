"""Command-line entry points for the Religion Almanac data pipeline."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .build import build_artifacts
from .ingestion import Provenance, now_utc, stage_normalized_records
from .proposals import (
    DEFAULT_PROPOSAL_SCHEMA,
    ProposalFailure,
    apply_proposal,
    load_proposal,
    validate_proposal,
)
from .validate import DEFAULT_SCHEMA, DEFAULT_SEED, ValidationFailure, load_seed, validate_seed


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ra-pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="validate a canonical JSON seed")
    validate.add_argument("--seed", default=str(DEFAULT_SEED))
    validate.add_argument("--schema", default=str(DEFAULT_SCHEMA))

    validate_proposal_parser = subparsers.add_parser(
        "validate-proposal", help="validate a curator add-record proposal"
    )
    validate_proposal_parser.add_argument("proposal")
    validate_proposal_parser.add_argument("--seed", default=str(DEFAULT_SEED))
    validate_proposal_parser.add_argument("--proposal-schema", default=str(DEFAULT_PROPOSAL_SCHEMA))
    validate_proposal_parser.add_argument("--seed-schema", default=str(DEFAULT_SCHEMA))

    apply_proposal_parser = subparsers.add_parser(
        "apply-proposal", help="preview or apply a proposal to the canonical seed"
    )
    apply_proposal_parser.add_argument("proposal")
    apply_proposal_parser.add_argument("--seed", default=str(DEFAULT_SEED))
    apply_proposal_parser.add_argument("--proposal-schema", default=str(DEFAULT_PROPOSAL_SCHEMA))
    apply_proposal_parser.add_argument("--seed-schema", default=str(DEFAULT_SCHEMA))
    apply_proposal_parser.add_argument("--apply", action="store_true", help="write the canonical seed")
    apply_proposal_parser.add_argument(
        "--revalidate", action="store_true",
        help="acknowledge a stale base release after reviewing against the current seed",
    )

    build = subparsers.add_parser("build", help="write static and linked-data release artifacts")
    build.add_argument("--seed", default=str(DEFAULT_SEED))
    build.add_argument("--output", default="exports/current")
    build.add_argument("--include-prototype", action="store_true", help="include prototype records in a dev build")

    stage = subparsers.add_parser("stage", help="stage already-normalized candidate records")
    stage.add_argument("--records", required=True, help="JSON array of normalized records")
    stage.add_argument("--source-url", required=True)
    stage.add_argument("--license", default=None)
    stage.add_argument("--upstream-version", default=None)
    stage.add_argument("--connector-version", required=True)
    stage.add_argument("--normalization-version", required=True)
    stage.add_argument("--output", default="data/candidates")

    load = subparsers.add_parser("load", help="replace the PostgreSQL read model from canonical JSON")
    load.add_argument("--seed", default=str(DEFAULT_SEED))
    load.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    return parser


def main() -> None:
    args = _parser().parse_args()
    try:
        if args.command == "validate":
            seed = load_seed(args.seed)
            validate_seed(seed, args.schema)
            print(f"Valid: {args.seed}")
        elif args.command == "build":
            seed = load_seed(args.seed)
            manifest = build_artifacts(seed, args.output, include_prototype=args.include_prototype)
            print(json.dumps(manifest, indent=2, ensure_ascii=False))
        elif args.command == "validate-proposal":
            proposal = load_proposal(args.proposal)
            warnings = validate_proposal(
                proposal, seed_path=args.seed,
                proposal_schema_path=args.proposal_schema, seed_schema_path=args.seed_schema,
            )
            for warning in warnings:
                print(f"Warning: {warning}", file=sys.stderr)
            print(f"Valid proposal: {args.proposal}")
        elif args.command == "apply-proposal":
            proposal = load_proposal(args.proposal)
            diff, warnings = apply_proposal(
                proposal, args.seed, apply=args.apply, revalidate=args.revalidate,
                proposal_schema_path=args.proposal_schema, seed_schema_path=args.seed_schema,
            )
            for warning in warnings:
                print(f"Warning: {warning}", file=sys.stderr)
            if diff:
                print(diff, end="")
            else:
                print("No canonical changes")
            if args.apply:
                print(f"Applied proposal {proposal['proposal_id']} to {args.seed}", file=sys.stderr)
        elif args.command == "stage":
            records = json.loads(Path(args.records).read_text(encoding="utf-8"))
            if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
                raise ValueError("--records must contain a JSON array of objects")
            provenance = Provenance(
                source_url=args.source_url, license=args.license,
                connector_version=args.connector_version,
                normalization_version=args.normalization_version,
                retrieved_at=now_utc(), upstream_version=args.upstream_version,
            )
            path = stage_normalized_records(records, provenance, args.output)
            print(path)
        elif args.command == "load":
            if not args.database_url:
                raise ValueError("pass --database-url or set DATABASE_URL")
            from .load_postgres import load_postgres

            seed = load_seed(args.seed)
            validate_seed(seed)
            counts = load_postgres(seed, args.database_url)
            print(json.dumps({"loaded": args.seed, "counts": counts}, indent=2))
    except (ProposalFailure, ValidationFailure, ValueError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
