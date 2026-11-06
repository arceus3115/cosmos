/**
 * One-time migration of the static browser seed into canonical backend JSON.
 * The canonical files under data/canonical are edited directly after import.
 */
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = resolve(root, "data/canonical/seed.json");
const aliasesPath = resolve(root, "data/canonical/legacy_aliases.json");
if (!process.argv.includes("--force")) {
  for (const outputPath of [canonicalPath, aliasesPath]) {
    try {
      await access(outputPath);
      throw new Error(`Refusing to overwrite ${outputPath}; pass --force only for a deliberate re-import.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
const context = { window: {} };
vm.runInNewContext(await readFile(resolve(root, "data.js"), "utf8"), context);
const prototype = context.window.ALMANAC_DATA;
const digestId = (kind, identityKey) => {
  const digest = createHash("sha256").update(`${kind}\0${identityKey}`, "utf8").digest("hex").slice(0, 24);
  return `ra:${kind}:${digest}`;
};
const parseClaimDate = label => {
  if (/^\d{3,4}$/.test(label)) {
    const year = Number(label);
    return { start_year: year, end_year: year, precision: "exact", uncertainty_note: null };
  }
  const range = label.match(/^c\.\s*(\d{3,4})[–-](\d{3,4})$/i);
  if (range) {
    return {
      start_year: Number(range[1]), end_year: Number(range[2]), precision: "approximate",
      uncertainty_note: "The source label gives an approximate interval."
    };
  }
  if (/^first millennium BCE$/i.test(label)) {
    return {
      start_year: -1000, end_year: -1, precision: "period",
      uncertainty_note: "A broad historical period; the year convention has no year zero."
    };
  }
  return {
    start_year: null, end_year: null, precision: "unknown",
    uncertainty_note: "Prototype display label retained; numeric bounds need editorial review."
  };
};
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const aliases = {};

const sourceIds = new Map(prototype.sources.map(source => {
  const identityKey = `source|${source.author || ""}|${source.title}|${source.url || ""}`;
  const id = digestId("source", identityKey);
  aliases[`source:${source.id}`] = id;
  return [source.id, id];
}));
const nodeIds = new Map(prototype.nodes.map(node => {
  const identityKey = `node|${node.type}|${node.name.normalize("NFC")}`;
  const id = digestId("node", identityKey);
  aliases[`node:${node.id}`] = id;
  return [node.id, id];
}));
const claimIds = new Map(prototype.edges.filter(edge => edge.type !== "part_of").map(edge => {
  const identityKey = `claim|${nodeIds.get(edge.source)}|${nodeIds.get(edge.target)}|${edge.type}|${edge.id}`;
  const id = digestId("claim", identityKey);
  aliases[`claim:${edge.id}`] = id;
  return [edge.id, id];
}));

const sources = prototype.sources.map(source => {
  const identityKey = `source|${source.author || ""}|${source.title}|${source.url || ""}`;
  return {
    id: sourceIds.get(source.id), identity_key: identityKey,
    title: source.title, author: source.author || null, container: source.container || null,
    publisher: source.publisher || null, year: source.year || null, url: source.url || null,
    license: source.license || null, status: "prototype"
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const hierarchyByChild = new Map(prototype.edges.filter(edge => edge.type === "part_of").map(edge => [edge.target, edge]));
const nodes = prototype.nodes.map(node => {
  const identityKey = `node|${node.type}|${node.name.normalize("NFC")}`;
  const hierarchy = hierarchyByChild.get(node.id);
  const nodeSources = (node.sources || []).map(id => sourceIds.get(id));
  const dateAspect = ({
    tradition: "historical_scope", text: "textual_formation",
    story: "narrative_attestation", work: "composition_or_publication"
  })[node.type] || "historical_scope";
  const dateAssertions = node.dates ? [{
    id: digestId("date", `${nodeIds.get(node.id)}|${dateAspect}`),
    aspect: dateAspect, start_year: node.dates.start ?? null, end_year: node.dates.end ?? null,
    year_convention: "historical_bce_ce",
    precision: node.dates.start === node.dates.end ? "exact" : "approximate",
    display_label: node.dates.label || null, uncertainty_note: node.dates.note || null,
    evidence_source_ids: nodeSources
  }] : [];
  return {
    id: nodeIds.get(node.id), identity_key: identityKey, type: node.type,
    label: node.name, name_variants: (node.names || []).filter(name => name !== node.name).map(value => ({ value, language: null, script: null, role: "alternate" })),
    summary: node.summary || null, status: "prototype",
    parent_id: node.parent ? nodeIds.get(node.parent) : null,
    hierarchy_relation: node.parent ? "part_of" : null,
    hierarchy_evidence_source_ids: hierarchy ? hierarchy.evidence.map(id => sourceIds.get(id)) : [],
    evidence_status: nodeSources.length ? "sourced" : "unsourced",
    source_ids: nodeSources,
    languages: node.languages || [],
    external_identifiers: node.qid ? [{ namespace: "wikidata", value: node.qid }] : [],
    external_links: node.external || [],
    date_assertions: dateAssertions
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const claims = prototype.edges.filter(edge => edge.type !== "part_of").map(edge => {
  const identityKey = `claim|${nodeIds.get(edge.source)}|${nodeIds.get(edge.target)}|${edge.type}|${edge.id}`;
  const evidence = (edge.evidence || []).map(id => sourceIds.get(id));
  const date = edge.date ? parseClaimDate(edge.date) : null;
  return {
    id: claimIds.get(edge.id), identity_key: identityKey,
    subject_id: nodeIds.get(edge.source), object_id: nodeIds.get(edge.target),
    relation_type: edge.type, direction: edge.direction || "unknown",
    confidence: edge.confidence ?? null, consensus: edge.consensus || null,
    rationale: edge.rationale || null, date_label: edge.date || null,
    date_assertions: date ? [{
      id: digestId("date", `${claimIds.get(edge.id)}|relationship_period`),
      aspect: "relationship_period", ...date, year_convention: "historical_bce_ce",
      display_label: edge.date, evidence_source_ids: evidence
    }] : [],
    inferred: Boolean(edge.inferred), status: "prototype",
    evidence_status: evidence.length ? "sourced" : "unsourced",
    evidence_source_ids: evidence
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const guidedPaths = (prototype.guidedPaths || []).map(path => ({
  ...path,
  nodes: path.nodes.map(id => nodeIds.get(id)),
  edges: path.edges.map(id => claimIds.get(id))
})).sort((a, b) => a.id.localeCompare(b.id));

const seed = {
  schema_version: "1.0.0",
  metadata: {
    dataset_id: "religion-almanac-seed",
    release: "prototype-01",
    year_convention: "historical_bce_ce",
    notes: "Migrated from the static prototype; records remain explicitly marked prototype."
  },
  sources, nodes, claims, review_events: [], guided_paths: guidedPaths
};

await writeFile(canonicalPath, json(seed));
await writeFile(aliasesPath, json({ aliases }));
console.log(`Imported ${nodes.length} nodes, ${claims.length} claims, ${sources.length} sources.`);
