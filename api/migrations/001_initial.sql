-- Religion Almanac PostgreSQL read model, schema version 1.
-- Apply once to the target database. Candidate staging is separate from public tables.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_releases (
    singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
    dataset_release TEXT NOT NULL,
    canonical_checksum TEXT NOT NULL CHECK (canonical_checksum ~ '^[0-9a-f]{64}$'),
    node_count INTEGER NOT NULL CHECK (node_count >= 0),
    claim_count INTEGER NOT NULL CHECK (claim_count >= 0),
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sources (
    id TEXT PRIMARY KEY CHECK (id ~ '^ra:source:[0-9a-f]{24}$'),
    identity_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT,
    container TEXT,
    publisher TEXT,
    publication_year TEXT,
    url TEXT,
    license TEXT NOT NULL CHECK (btrim(license) <> ''),
    status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed', 'published', 'prototype'))
);

CREATE TABLE nodes (
    id TEXT PRIMARY KEY CHECK (id ~ '^ra:node:[0-9a-f]{24}$'),
    identity_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('tradition', 'text', 'story', 'work', 'motif', 'figure', 'place', 'period')),
    label TEXT NOT NULL CHECK (btrim(label) <> ''),
    summary TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed', 'published', 'prototype')),
    parent_id TEXT REFERENCES nodes(id) DEFERRABLE INITIALLY DEFERRED,
    hierarchy_relation TEXT CHECK (hierarchy_relation IS NULL OR hierarchy_relation = 'part_of'),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('sourced', 'unsourced')),
    name_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
    languages TEXT[] NOT NULL DEFAULT '{}',
    external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    CHECK ((parent_id IS NULL) = (hierarchy_relation IS NULL))
);

CREATE TABLE node_names (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    value TEXT NOT NULL CHECK (btrim(value) <> ''),
    language TEXT,
    script TEXT,
    role TEXT NOT NULL CHECK (role IN ('preferred', 'alternate', 'transliteration', 'historical')),
    PRIMARY KEY (node_id, value, role)
);

CREATE TABLE external_identifiers (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (node_id, namespace, value),
    UNIQUE (namespace, value)
);

CREATE TABLE node_sources (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id),
    role TEXT NOT NULL CHECK (role IN ('citation', 'hierarchy_evidence')),
    PRIMARY KEY (node_id, source_id, role)
);

CREATE TABLE influence_claims (
    id TEXT PRIMARY KEY CHECK (id ~ '^ra:claim:[0-9a-f]{24}$'),
    identity_key TEXT NOT NULL UNIQUE,
    subject_id TEXT NOT NULL REFERENCES nodes(id),
    object_id TEXT NOT NULL REFERENCES nodes(id),
    relation_type TEXT NOT NULL CHECK (relation_type IN ('direct_textual_dependence', 'shared_source', 'motif_parallel', 'oral_diffusion', 'polemical_adaptation', 'reception_commentary', 'tradition_lineage')),
    direction TEXT NOT NULL CHECK (direction IN ('certain', 'probable', 'unknown')),
    confidence SMALLINT CHECK (confidence BETWEEN 1 AND 5),
    consensus TEXT CHECK (consensus IN ('consensus', 'majority', 'contested', 'fringe')),
    rationale TEXT,
    date_label TEXT,
    inferred BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed', 'published', 'prototype')),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('sourced', 'unsourced')),
    CHECK (subject_id <> object_id)
);

CREATE TABLE claim_sources (
    claim_id TEXT NOT NULL REFERENCES influence_claims(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id),
    locator TEXT NOT NULL DEFAULT '',
    note TEXT,
    PRIMARY KEY (claim_id, source_id, locator)
);

CREATE TABLE date_assertions (
    id TEXT PRIMARY KEY CHECK (id ~ '^ra:date:[0-9a-f]{24}$'),
    node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    claim_id TEXT REFERENCES influence_claims(id) ON DELETE CASCADE,
    aspect TEXT NOT NULL,
    start_year INTEGER CHECK (start_year IS NULL OR start_year <> 0),
    end_year INTEGER CHECK (end_year IS NULL OR end_year <> 0),
    year_convention TEXT NOT NULL CHECK (year_convention = 'historical_bce_ce'),
    precision TEXT NOT NULL CHECK (precision IN ('exact', 'approximate', 'century', 'period', 'unknown')),
    display_label TEXT,
    uncertainty_note TEXT,
    CHECK ((node_id IS NOT NULL)::integer + (claim_id IS NOT NULL)::integer = 1),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

CREATE TABLE date_assertion_sources (
    date_assertion_id TEXT NOT NULL REFERENCES date_assertions(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id),
    PRIMARY KEY (date_assertion_id, source_id)
);

CREATE TABLE review_events (
    id TEXT PRIMARY KEY CHECK (id ~ '^ra:review:[0-9a-f]{24}$'),
    identity_key TEXT NOT NULL UNIQUE,
    claim_id TEXT NOT NULL REFERENCES influence_claims(id) ON DELETE CASCADE,
    reviewer TEXT NOT NULL,
    action TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    resolution_note TEXT
);

CREATE TABLE guided_paths (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    introduction TEXT NOT NULL
);

CREATE TABLE guided_path_nodes (
    path_id TEXT NOT NULL REFERENCES guided_paths(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    node_id TEXT NOT NULL REFERENCES nodes(id),
    PRIMARY KEY (path_id, position),
    UNIQUE (path_id, node_id)
);

CREATE TABLE guided_path_claims (
    path_id TEXT NOT NULL REFERENCES guided_paths(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    claim_id TEXT NOT NULL REFERENCES influence_claims(id),
    PRIMARY KEY (path_id, position),
    UNIQUE (path_id, claim_id)
);

CREATE TABLE normalized_candidates (
    candidate_id TEXT PRIMARY KEY CHECK (candidate_id ~ '^[0-9a-f]{24}$'),
    source_url TEXT NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL,
    upstream_version TEXT,
    normalized_checksum TEXT NOT NULL CHECK (normalized_checksum ~ '^[0-9a-f]{64}$'),
    license TEXT,
    connector_version TEXT NOT NULL,
    normalization_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'quarantined')),
    normalized_records JSONB NOT NULL,
    CHECK (status <> 'candidate' OR (license IS NOT NULL AND btrim(license) <> ''))
);

CREATE INDEX idx_nodes_parent ON nodes(parent_id);
CREATE INDEX idx_nodes_type_status ON nodes(type, status);
CREATE INDEX idx_node_names_value ON node_names(value);
CREATE INDEX idx_external_identifiers_value ON external_identifiers(namespace, value);
CREATE INDEX idx_claim_endpoints ON influence_claims(subject_id, object_id, relation_type);
CREATE INDEX idx_claim_sources_source ON claim_sources(source_id);
CREATE INDEX idx_date_assertions_range ON date_assertions(start_year, end_year);
CREATE INDEX idx_candidates_status ON normalized_candidates(status, retrieved_at DESC);

CREATE FUNCTION enforce_hierarchy_acyclic() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cycle_found BOOLEAN;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    WITH RECURSIVE ancestors(id, parent_id, visited) AS (
        SELECT n.id, n.parent_id, ARRAY[n.id]
        FROM nodes n WHERE n.id = NEW.parent_id
        UNION ALL
        SELECT parent.id, parent.parent_id, ancestors.visited || parent.id
        FROM nodes parent JOIN ancestors ON parent.id = ancestors.parent_id
        WHERE NOT parent.id = ANY(ancestors.visited)
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;
    IF cycle_found THEN
        RAISE EXCEPTION 'hierarchy cycle detected for node %', NEW.id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER nodes_hierarchy_acyclic
AFTER INSERT OR UPDATE ON nodes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_hierarchy_acyclic();

CREATE FUNCTION enforce_claim_evidence_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    affected_claim_id TEXT;
    claim_status TEXT;
    consensus_level TEXT;
    citation_count INTEGER;
    reviewer_count INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'influence_claims' THEN
        IF TG_OP = 'DELETE' THEN
            affected_claim_id := OLD.id;
        ELSE
            affected_claim_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            affected_claim_id := OLD.claim_id;
        ELSE
            affected_claim_id := NEW.claim_id;
        END IF;
    END IF;
    SELECT status, consensus INTO claim_status, consensus_level
    FROM influence_claims WHERE id = affected_claim_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO citation_count FROM claim_sources WHERE claim_id = affected_claim_id;
    IF claim_status = 'published' AND citation_count < 1 THEN
        RAISE EXCEPTION 'published claim % requires at least one citation', affected_claim_id USING ERRCODE = '23514';
    END IF;
    IF consensus_level = 'contested' AND citation_count < 2 THEN
        RAISE EXCEPTION 'contested claim % requires at least two citations', affected_claim_id USING ERRCODE = '23514';
    END IF;
    SELECT count(DISTINCT reviewer) INTO reviewer_count
    FROM review_events WHERE claim_id = affected_claim_id;
    IF claim_status = 'published' AND consensus_level = 'contested' AND reviewer_count < 2 THEN
        RAISE EXCEPTION 'published contested claim % requires two distinct reviewers', affected_claim_id USING ERRCODE = '23514';
    ELSIF claim_status = 'published' AND reviewer_count < 1 THEN
        RAISE EXCEPTION 'published claim % requires a reviewer event', affected_claim_id USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER claims_evidence_check
AFTER INSERT OR UPDATE ON influence_claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_claim_evidence_rules();

CREATE CONSTRAINT TRIGGER claim_sources_evidence_check
AFTER INSERT OR UPDATE OR DELETE ON claim_sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_claim_evidence_rules();

CREATE CONSTRAINT TRIGGER review_events_claim_check
AFTER INSERT OR UPDATE OR DELETE ON review_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_claim_evidence_rules();

INSERT INTO schema_migrations(version) VALUES ('001_initial') ON CONFLICT DO NOTHING;
