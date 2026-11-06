/* API bootstrap and release-scoped detail cache for the browser app. */
(() => {
  "use strict";

  const fallback = window.ALMANAC_DATA;
  const apiMeta = document.querySelector('meta[name="almanac-api-base"]');
  const apiBase = (apiMeta?.content || window.ALMANAC_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const detailCache = new Map();
  let aliases = {};
  let releaseId = null;

  function toCanonical(kind, id) {
    if (!id || String(id).startsWith("ra:")) return id;
    return aliases[`${kind}:${id}`] || id;
  }

  function legacyId(kind, canonicalId) {
    const prefix = `${kind}:`;
    return Object.entries(aliases).find(([key, value]) => key.startsWith(prefix) && value === canonicalId)?.[0].slice(prefix.length) || null;
  }

  function invalidateForRelease(nextReleaseId) {
    if (releaseId && nextReleaseId && releaseId !== nextReleaseId) {
      const previousReleaseId = releaseId;
      detailCache.clear();
      releaseId = nextReleaseId;
      window.dispatchEvent(new CustomEvent("almanac-release-change", {
        detail: { previous: previousReleaseId, current: nextReleaseId }
      }));
      return;
    }
    if (nextReleaseId) releaseId = nextReleaseId;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...(options.headers || {}) },
      signal: options.signal,
      cache: "no-store"
    });
    const responseRelease = response.headers.get("X-RA-Release");
    if (responseRelease) invalidateForRelease(responseRelease);
    if (response.headers.get("X-RA-Read-Source") === "release-artifacts") {
      window.dispatchEvent(new CustomEvent("almanac-read-source", {
        detail: { source: "release-artifacts", releaseId: responseRelease || releaseId }
      }));
    }
    if (!response.ok) {
      let detail = `Request failed (${response.status})`;
      try {
        const body = await response.json();
        detail = body.detail || detail;
      } catch { /* Keep the status text when the response is not JSON. */ }
      throw new Error(detail);
    }
    return response.json();
  }

  function cached(kind, id, load) {
    const key = `${releaseId || "unversioned"}:${kind}:${id}`;
    if (!detailCache.has(key)) {
      const promise = load().catch(error => {
        detailCache.delete(key);
        throw error;
      });
      detailCache.set(key, promise);
    }
    return detailCache.get(key);
  }

  function dateForNode(dates = []) {
    const date = dates.find(item => item.aspect === "historical_scope") || dates[0];
    if (!date) return undefined;
    return {
      start: date.start_year ?? -3000,
      end: date.end_year ?? 2026,
      label: date.label || date.display_label || "Date uncertain",
      note: date.uncertainty_note || "Date range is approximate."
    };
  }

  function graphData(graph) {
    const reverseNodes = new Map(graph.nodes.map(node => [node.id, legacyId("node", node.id)]));
    const layoutById = new Map(fallback.nodes.map(node => [node.id, node]));
    const layoutByName = new Map(fallback.nodes.map(node => [node.name.normalize("NFC").toLocaleLowerCase(), node]));
    const nodes = graph.nodes.map((record, index) => {
      const legacyNodeId = reverseNodes.get(record.id);
      const layout = (legacyNodeId && layoutById.get(legacyNodeId))
        || layoutByName.get(record.label.normalize("NFC").toLocaleLowerCase());
      const column = index % 4;
      const row = Math.floor(index / 4);
      const node = {
        id: record.id,
        legacyId: legacyNodeId,
        type: record.type,
        name: record.label,
        names: layout?.names || [],
        summary: "Select this record to load its description and citations.",
        dates: dateForNode(record.dates),
        languages: [],
        parent: record.parent_id,
        sources: [],
        external: [],
        qid: null,
        x: layout?.x ?? 80 + column * 270,
        y: layout?.y ?? 130 + row * 135,
        color: layout?.color || ["clay", "olive", "blue", "rose"][column],
        status: "",
        _apiDetailsLoaded: false
      };
      return node;
    });
    const edges = graph.edges.map(record => ({
      id: record.id,
      source: record.source,
      target: record.target,
      type: record.type,
      family: record.family,
      direction: record.direction || "certain",
      confidence: record.confidence ?? 0,
      consensus: record.consensus || "consensus",
      rationale: "Select this connection to load its claim and evidence.",
      date: record.dates?.[0]?.label || "",
      inferred: record.inferred || false,
      evidence: record.evidence_source_ids || [],
      status: "",
      _apiDetailsLoaded: record.family === "hierarchy"
    }));
    return {
      meta: {
        title: "Religion Almanac",
        version: graph.dataset_release || "unknown",
        releaseId: graph.release_id || releaseId || "unknown",
        license: fallback.meta.license,
        source: "api"
      },
      nodes,
      edges,
      sources: [],
      guidedPaths: (graph.guided_paths || []).map(path => ({ ...path }))
    };
  }

  async function loadBootstrap() {
    try {
      const aliasPromise = fetch("./data/canonical/legacy_aliases.json", { headers: { Accept: "application/json" } })
        .then(response => response.ok ? response.json() : null)
        .then(payload => { aliases = payload?.aliases || {}; })
        .catch(() => { aliases = {}; });
      const graphPromise = fetchJson(`${apiBase}/v1/graph`, {
        signal: AbortSignal.timeout(5000)
      });
      const [graph] = await Promise.all([graphPromise, aliasPromise]);
      invalidateForRelease(graph.release_id || releaseId);
      return {
        mode: "api",
        releaseId,
        apiBase,
        aliases,
        data: graphData(graph)
      };
    } catch (error) {
      return {
        mode: "fallback",
        releaseId: `bundled-${fallback.meta.version}-${fallback.meta.built}`,
        apiBase,
        aliases,
        data: fallback,
        error
      };
    }
  }

  function requestCached(kind, id, path) {
    return cached(kind, id, () => fetchJson(`${apiBase}${path}`, {
      signal: AbortSignal.timeout(7000)
    }));
  }

  function getNode(id) {
    return requestCached("node", id, `/v1/nodes/${encodeURIComponent(id)}`);
  }

  function getNeighbors(id) {
    return requestCached("neighbors", id, `/v1/nodes/${encodeURIComponent(id)}/neighbors`);
  }

  function getClaim(id) {
    return requestCached("claim", id, `/v1/claims/${encodeURIComponent(id)}`);
  }

  function getSource(id) {
    return requestCached("source", id, `/v1/sources/${encodeURIComponent(id)}`);
  }

  async function getSources(ids) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const results = await Promise.allSettled(uniqueIds.map(getSource));
    return {
      sources: results.filter(result => result.status === "fulfilled").map(result => result.value),
      unavailableIds: results.flatMap((result, index) => result.status === "rejected" ? [uniqueIds[index]] : [])
    };
  }

  async function getNodeBundle(id) {
    return cached("node-bundle", id, async () => {
      const [node, neighbors] = await Promise.all([getNode(id), getNeighbors(id)]);
      const claims = await Promise.all(neighbors.claims.map(item => getClaim(item.id)));
      const sourceIds = [
        ...node.sources.map(source => source.id),
        ...claims.flatMap(result => result.evidence.map(source => source.id))
      ];
      return { node, neighbors, claims, ...(await getSources(sourceIds)) };
    });
  }

  async function getClaimBundle(id) {
    return cached("claim-bundle", id, async () => {
      const claim = await getClaim(id);
      const sourceIds = claim.evidence.map(source => source.id);
      return { claim, ...(await getSources(sourceIds)) };
    });
  }

  function search(query, limit = 6) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return fetchJson(`${apiBase}/v1/search?${params}`, {
      signal: AbortSignal.timeout(5000)
    });
  }

  function findPaths({ source, target, relationType, consensus, confidence, startYear, endYear, traditions: activeTraditions }) {
    const params = new URLSearchParams({ source, target, max_hops: "8", limit: "3" });
    if (relationType && relationType !== "all") params.append("relation_types", relationType);
    if (consensus && consensus !== "all") params.append("consensus", consensus);
    if (confidence > 1) params.set("min_confidence", String(confidence));
    if (startYear !== -3000) params.set("start_year", String(startYear));
    if (endYear !== 2026) params.set("end_year", String(endYear));
    if (activeTraditions?.length) activeTraditions.forEach(id => params.append("traditions", id));
    return fetchJson(`${apiBase}/v1/paths?${params}`, {
      signal: AbortSignal.timeout(7000)
    });
  }

  window.ALMANAC_API_CLIENT = {
    apiBase,
    bootstrap: loadBootstrap(),
    getNodeBundle,
    getClaimBundle,
    getSource,
    search,
    findPaths,
    toCanonical,
    legacyId,
    getFallbackNode(id) {
      const oldId = legacyId("node", id);
      return fallback.nodes.find(node => node.id === oldId) || null;
    },
    getFallbackEdge(id) {
      const oldId = legacyId("claim", id);
      return fallback.edges.find(edge => edge.id === oldId) || null;
    },
    getFallbackSource(id) {
      const oldId = legacyId("source", id);
      return fallback.sources.find(source => source.id === oldId) || null;
    }
  };
})();
