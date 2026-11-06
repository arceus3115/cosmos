(() => {
  "use strict";

  const FALLBACK_DATA = window.ALMANAC_DATA;
  let DATA = FALLBACK_DATA;
  const API = window.ALMANAC_API_CLIENT;
  const GRAPH_WIDTH = 1350;
  const GRAPH_HEIGHT = 790;
  const GRAPH_GROUP_X = { mesopotamian: 130, jewish: 500, classical: 880, "early-modern": 1205 };
  const GRAPH_GROUP_NAME_X = {
    "mesopotamian traditions": 130, "jewish traditions": 500,
    "greco-roman literature": 880, "early modern europe": 1205
  };
  const GRAPH_Y_OFFSET = 24;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let nodesById = new Map();
  let sourcesById = new Map();
  let edgesById = new Map();
  let traditions = [];
  let dataMode = "fallback";
  let activeReleaseId = null;
  let searchRequest = 0;
  let latestSearchResults = [];
  let searchTimer = null;
  let selectedDetailKey = null;
  let usingArtifactDetails = false;
  const influenceTypes = [
    ["direct_textual_dependence", "Direct textual dependence"], ["shared_source", "Shared source"],
    ["motif_parallel", "Motif parallel"], ["oral_diffusion", "Oral diffusion"],
    ["polemical_adaptation", "Polemical adaptation"], ["reception_commentary", "Reception / commentary"],
    ["tradition_lineage", "Tradition lineage"]
  ];
  const state = {
    view: "graph", selected: null, query: "", edgeType: "all",
    consensus: "all", confidence: 1, dateFrom: -3000, dateTo: 2026,
    activeTraditions: new Set(), collapsedTraditions: new Set(), pathNodes: [], pathEdges: [], pathTitle: "", pathIntro: "",
    detailStatus: "idle", detailError: "",
    zoom: { x: 0, y: 0, scale: 1 }
  };
  let toastTimer;
  let dragStart = null;

  const typeLabel = type => ({ tradition: "Tradition", text: "Foundational text", story: "Story", work: "Later work" }[type] || type);
  const edgeLabel = type => (influenceTypes.find(([key]) => key === type)?.[1] || type.replaceAll("_", " "));
  const consensusLabel = value => ({ consensus: "Consensus", majority: "Majority view", contested: "Contested", fringe: "Fringe" }[value] || value);
  const html = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const nodeParentTradition = node => {
    let current = node;
    while (current && current.type !== "tradition") current = current.parent ? nodesById.get(current.parent) : null;
    return current?.id || null;
  };
  const citation = id => sourcesById.get(id);
  const visibleNodes = (respectCollapse = state.view === "graph") => DATA.nodes.filter(node => {
    if (!state.activeTraditions.has(nodeParentTradition(node))) return false;
    if (respectCollapse && node.type !== "tradition" && state.collapsedTraditions.has(nodeParentTradition(node))) return false;
    if (node.dates && (node.dates.end < state.dateFrom || node.dates.start > state.dateTo)) return false;
    return true;
  });
  const isInfluence = edge => edge.type !== "part_of";
  const edgePassesFilters = (edge, includeHierarchy = true, respectCollapse = state.view === "graph") => {
    if (!includeHierarchy && !isInfluence(edge)) return false;
    if (state.edgeType !== "all" && isInfluence(edge) && edge.type !== state.edgeType) return false;
    if (state.consensus !== "all" && isInfluence(edge) && edge.consensus !== state.consensus) return false;
    if (isInfluence(edge) && edge.confidence < state.confidence) return false;
    const from = nodesById.get(edge.source), to = nodesById.get(edge.target);
    const available = visibleNodes(respectCollapse);
    if (!from || !to || !available.some(node => node.id === from.id) || !available.some(node => node.id === to.id)) return false;
    return true;
  };
  const formatYear = year => year < 0 ? `${Math.abs(year)} BCE` : year === 0 ? "1 BCE" : `${year} CE`;
  const showToast = message => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  };

  function setDataStatus(stateName, message) {
    const status = $("#dataStatus");
    status.dataset.state = stateName;
    status.textContent = message;
  }

  function setConnectedStatus() {
    if (usingArtifactDetails) {
      setDataStatus("warning", `Using checksummed release details · PostgreSQL read model unavailable; graph, record details, and search are available · release ${activeReleaseId}`);
      return;
    }
    setDataStatus("connected", `Connected to API · release ${activeReleaseId} · details load on selection`);
  }

  window.addEventListener("almanac-read-source", event => {
    if (event.detail?.source !== "release-artifacts") return;
    usingArtifactDetails = true;
    setConnectedStatus();
  });

  function setRecordCounts() {
    $("#nodeCount").textContent = `${DATA.nodes.length} RECORD${DATA.nodes.length === 1 ? "" : "S"}`;
    const claimCount = DATA.edges.filter(isInfluence).length;
    $("#claimCount").textContent = `${claimCount} CITED CLAIM${claimCount === 1 ? "" : "S"}`;
    $("#pathCount").textContent = `${DATA.guidedPaths.length} GUIDED PATH${DATA.guidedPaths.length === 1 ? "" : "S"}`;
  }

  function dateFromAssertions(assertions = []) {
    const assertion = assertions.find(item => item.aspect === "historical_scope") || assertions[0];
    if (!assertion) return undefined;
    return {
      start: assertion.start_year ?? -3000,
      end: assertion.end_year ?? 2026,
      label: assertion.display_label || "Date uncertain",
      note: assertion.uncertainty_note || "Date range is approximate."
    };
  }

  function storeApiSource(payload) {
    const source = payload.source;
    if (!source) return;
    sourcesById.set(source.id, {
      id: source.id,
      short: source.author ? `${source.author.split(/\s+/).at(-1)}, ${source.publication_year || "n.d."}` : source.publisher || source.title,
      title: source.title,
      author: source.author || "",
      container: source.container || "",
      publisher: source.publisher || "",
      year: source.publication_year || "n.d.",
      url: source.url || "#",
      license: source.license || "License information unavailable"
    });
  }

  function applyApiNodeBundle(bundle) {
    const record = bundle.node.node;
    const node = nodesById.get(record.id);
    if (!node) return;
    node.name = record.label;
    node.summary = record.summary || "No summary has been recorded.";
    node.status = record.status;
    node.parent = record.parent_id;
    node.names = bundle.node.names.filter(item => item.role !== "preferred").map(item => item.value);
    node.languages = record.languages || [];
    node.external = record.external_links || [];
    node.qid = bundle.node.external_identifiers.find(item => item.namespace.toLowerCase().includes("wikidata"))?.value || null;
    node.sources = bundle.node.sources.map(item => item.id);
    node.dates = dateFromAssertions(bundle.node.date_assertions);
    node._apiDetailsLoaded = true;
    bundle.sources.forEach(storeApiSource);
    bundle.claims.forEach(applyApiClaimPayload);
    bundle.unavailableIds.forEach(applyFallbackSource);
  }

  function applyApiClaimPayload(payload) {
    const claim = payload.claim;
    const edge = edgesById.get(claim.id);
    if (!edge) return;
    edge.source = claim.subject_id;
    edge.target = claim.object_id;
    edge.type = claim.relation_type;
    edge.direction = claim.direction;
    edge.confidence = claim.confidence ?? 0;
    edge.consensus = claim.consensus || "contested";
    edge.rationale = claim.rationale || "No rationale has been recorded.";
    edge.date = claim.date_label || payload.date_assertions?.[0]?.display_label || "Not specified";
    edge.inferred = claim.inferred;
    edge.status = claim.status;
    edge.evidence = payload.evidence.map(item => item.id);
    edge._apiDetailsLoaded = true;
  }

  function applyFallbackSource(canonicalId) {
    const source = dataMode === "api" ? API.getFallbackSource(canonicalId) : null;
    if (source) sourcesById.set(canonicalId, { ...source, id: canonicalId });
  }

  function applyFallbackNodeDetails(canonicalId) {
    const fallback = API.getFallbackNode(canonicalId);
    const node = nodesById.get(canonicalId);
    if (!fallback || !node) return false;
    node.summary = fallback.summary;
    node.names = fallback.names || [];
    node.languages = fallback.languages || [];
    node.parent = fallback.parent ? API.toCanonical("node", fallback.parent) : null;
    node.sources = (fallback.sources || []).map(id => API.toCanonical("source", id));
    node.external = fallback.external || [];
    node.qid = fallback.qid || null;
    node.dates = fallback.dates;
    node.status = "prototype";
    node._apiDetailsLoaded = true;
    node.sources.forEach(applyFallbackSource);
    return true;
  }

  function applyFallbackClaimDetails(canonicalId) {
    const fallback = API.getFallbackEdge(canonicalId);
    const edge = edgesById.get(canonicalId);
    if (!fallback || !edge) return false;
    edge.direction = fallback.direction;
    edge.confidence = fallback.confidence;
    edge.consensus = fallback.consensus;
    edge.rationale = fallback.rationale;
    edge.date = fallback.date || "Not specified";
    edge.inferred = Boolean(fallback.inferred);
    edge.status = fallback.status || "prototype";
    edge.evidence = (fallback.evidence || []).map(id => API.toCanonical("source", id));
    edge._apiDetailsLoaded = true;
    edge.evidence.forEach(applyFallbackSource);
    return true;
  }

  function applyApiBundleSources(bundle) {
    bundle.sources.forEach(storeApiSource);
    bundle.unavailableIds.forEach(applyFallbackSource);
  }

  function loadSelectionDetails() {
    if (dataMode !== "api" || !state.selected) return;
    const selected = state.selected;
    const key = `${activeReleaseId}:${selected.kind}:${selected.id}`;
    if (selectedDetailKey === key && state.detailStatus === "ready") return;
    selectedDetailKey = key;
    state.detailStatus = "loading";
    state.detailError = "";
    renderInspector();

    let load;
    if (selected.kind === "node") {
      load = API.getNodeBundle(selected.id).then(bundle => {
        applyApiNodeBundle(bundle);
        if (bundle.unavailableIds.length) {
          setDataStatus("warning", `Some citations could not load from API release ${activeReleaseId}; local seed citations are shown where available.`);
        } else setConnectedStatus();
      });
    } else if (selected.kind === "edge") {
      const edge = edgesById.get(selected.id);
      if (!edge || edge.family === "hierarchy" || edge.type === "part_of") {
        state.detailStatus = "ready";
        renderInspector();
        return;
      }
      load = API.getClaimBundle(selected.id).then(bundle => {
        applyApiClaimPayload(bundle.claim);
        applyApiBundleSources(bundle);
        if (bundle.unavailableIds.length) {
          setDataStatus("warning", `Some citations could not load from API release ${activeReleaseId}; local seed citations are shown where available.`);
        } else setConnectedStatus();
      });
    } else if (selected.kind === "path") {
      const path = DATA.guidedPaths.find(item => item.id === selected.id);
      load = Promise.all((path?.edges || []).map(id => API.getClaimBundle(id))).then(bundles => {
        bundles.forEach(bundle => {
          applyApiClaimPayload(bundle.claim);
          applyApiBundleSources(bundle);
        });
      setConnectedStatus();
      });
    }
    if (!load) return;
    load.then(() => {
      if (selectedDetailKey !== key) return;
      state.detailStatus = "ready";
      renderInspector();
    }).catch(error => {
      if (selectedDetailKey !== key) return;
      state.detailStatus = "error";
      state.detailError = error.message;
      const usedFallback = selected.kind === "node"
        ? applyFallbackNodeDetails(selected.id)
        : selected.kind === "edge"
          ? applyFallbackClaimDetails(selected.id)
          : false;
      const hint = error.message.includes("DATABASE_URL is not configured")
        ? "Set DATABASE_URL, start PostgreSQL, then run make migrate and make load."
        : error.message.includes("has not been loaded")
          ? "Run make migrate if needed, then make load for this release."
          : error.message.includes("different releases")
            ? "Rebuild the artifacts and reload the database from the same seed."
            : error.message.includes("relational read model is unavailable")
              ? "Check DATABASE_URL and PostgreSQL connectivity."
              : "Check the API and database setup.";
      setDataStatus("warning", `API details unavailable: ${error.message} · ${hint} · release ${activeReleaseId}${usedFallback ? ` · showing bundled seed fallback (${FALLBACK_DATA.meta.version}, ${FALLBACK_DATA.meta.built})` : ""}`);
      renderInspector();
    });
  }

  function renderStartup() {
    nodesById = new Map(DATA.nodes.map(node => [node.id, node]));
    sourcesById = new Map(DATA.sources.map(source => [source.id, source]));
    edgesById = new Map(DATA.edges.map(edge => [edge.id, edge]));
    traditions = DATA.nodes.filter(node => node.type === "tradition");
    state.activeTraditions = new Set(traditions.map(node => node.id));
    state.selected = null;
    setRecordCounts();

    if (dataMode === "api") {
      setConnectedStatus();
    } else {
      setDataStatus("warning", `API unavailable at ${API.apiBase} · showing bundled fallback release ${activeReleaseId}. Start the API and reload to use live records.`);
    }

    initControls();
    const hasState = new URLSearchParams(location.hash.slice(1)).size > 0;
    if (hasState) restoreFromUrl(); else { renderAll(); writeUrl(false); }
  }

  window.addEventListener("almanac-release-change", () => {
    selectedDetailKey = null;
    location.reload();
  });

  function initControls() {
    const typeSelect = $("#edgeTypeFilter");
    influenceTypes.forEach(([value, label]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = label; typeSelect.append(option);
    });
    const filters = $("#traditionFilters");
    filters.replaceChildren();
    traditions.forEach(tradition => {
      const count = DATA.nodes.filter(node => nodeParentTradition(node) === tradition.id).length;
      const label = document.createElement("label");
      label.className = "filter-row";
      label.innerHTML = `<input type="checkbox" value="${html(tradition.id)}" checked /><span class="tradition-swatch" aria-hidden="true"></span><span>${html(tradition.name)}</span><span class="filter-count">${count}</span>`;
      filters.append(label);
    });
    const options = DATA.nodes.filter(node => node.type !== "tradition").map(node => `<option value="${html(node.id)}">${html(node.name)}</option>`).join("");
    $("#pathFrom").innerHTML = options;
    $("#pathTo").innerHTML = options;
    const firstPath = DATA.guidedPaths[0];
    $("#pathFrom").value = firstPath?.nodes[0] || DATA.nodes.find(node => node.type !== "tradition")?.id || "";
    $("#pathTo").value = firstPath?.nodes.at(-1) || DATA.nodes.find(node => node.type !== "tradition")?.id || "";
    const guideList = $("#guidedPaths");
    guideList.innerHTML = DATA.guidedPaths.map((path, index) => `<button type="button" class="guide-card" data-guide="${html(path.id)}"><span class="guide-icon ${index === 1 ? "heart" : ""}">${index === 1 ? "♡" : "≈"}</span><span><strong>${html(path.title)}</strong><small>${html(path.subtitle)}</small></span><span class="guide-arrow">↗</span></button>`).join("");
    bindControls();
    syncControls();
  }

  function bindControls() {
    $$(".view-tab").forEach(button => button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.selected = null;
      selectedDetailKey = null;
      state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
      renderAll(); writeUrl(true);
    }));
    $("#traditionFilters").addEventListener("change", event => {
      if (!event.target.matches("input[type=checkbox]")) return;
      event.target.checked ? state.activeTraditions.add(event.target.value) : state.activeTraditions.delete(event.target.value);
      state.selected = null; selectedDetailKey = null; state.pathNodes = []; state.pathEdges = [];
      renderAll(); writeUrl(true);
    });
    $("#edgeTypeFilter").addEventListener("change", () => { state.edgeType = $("#edgeTypeFilter").value; renderAll(); writeUrl(true); });
    $("#consensusFilter").addEventListener("change", () => { state.consensus = $("#consensusFilter").value; renderAll(); writeUrl(true); });
    $("#confidenceFilter").addEventListener("input", () => {
      state.confidence = Number($("#confidenceFilter").value); $("#confidenceValue").textContent = `${state.confidence} / 5`; renderAll();
    });
    $("#confidenceFilter").addEventListener("change", () => writeUrl(true));
    ["#dateFrom", "#dateTo"].forEach(selector => {
      $(selector).addEventListener("change", () => {
        state.dateFrom = Number($("#dateFrom").value) || -3000;
        state.dateTo = Number($("#dateTo").value) || 2026;
        if (state.dateFrom > state.dateTo) [state.dateFrom, state.dateTo] = [state.dateTo, state.dateFrom];
        $("#dateFrom").value = state.dateFrom; $("#dateTo").value = state.dateTo;
        renderAll(); writeUrl(true);
      });
    });
    $("#searchInput").addEventListener("input", event => { state.query = event.target.value; renderSearch(); });
    $("#searchInput").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        const match = latestSearchResults[0]?.node || nodesById.get(latestSearchResults[0]?.node_id) || getSearchMatches(state.query)[0];
        if (match) { chooseNode(match.id); $("#searchResults").hidden = true; }
      }
      if (event.key === "Escape") $("#searchResults").hidden = true;
    });
    $("#searchResults").addEventListener("click", event => {
      const button = event.target.closest("[data-search-node]");
      if (button) { chooseNode(button.dataset.searchNode); $("#searchResults").hidden = true; }
    });
    $("#resetButton").addEventListener("click", resetState);
    $("#guidedPaths").addEventListener("click", event => {
      const button = event.target.closest("[data-guide]");
      if (button) activateGuide(button.dataset.guide);
    });
    $("#pathOpenButton").addEventListener("click", () => { $("#pathDialog").showModal(); $("#pathResults").innerHTML = '<p class="empty-path">Choose two nodes to see a cited route through the graph.</p>'; });
    $("#findPathButton").addEventListener("click", () => runPathSearch($("#pathFrom").value, $("#pathTo").value));
    $("#exportMenuButton").addEventListener("click", () => { const menu = $("#exportMenu"); menu.hidden = !menu.hidden; });
    $("#exportMenu").addEventListener("click", event => {
      const button = event.target.closest("[data-export]"); if (!button) return;
      exportData(button.dataset.export); $("#exportMenu").hidden = true;
    });
    document.addEventListener("click", event => {
      if (!event.target.closest(".download-menu-wrap")) $("#exportMenu").hidden = true;
    });
    $("#shareButton").addEventListener("click", copyShareUrl);
    $("#sourcesButton").addEventListener("click", showCitationRegister);
    $("#zoomIn").addEventListener("click", () => setZoom(state.zoom.scale * 1.18));
    $("#zoomOut").addEventListener("click", () => setZoom(state.zoom.scale / 1.18));
    $("#zoomReset").addEventListener("click", resetZoom);
    bindGraphInteractions();
    document.addEventListener("keydown", event => {
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { event.preventDefault(); $("#searchInput").focus(); }
      if (event.key === "Escape") { $("#searchResults").hidden = true; $("#exportMenu").hidden = true; }
    });
    window.addEventListener("popstate", restoreFromUrl);
    window.addEventListener("hashchange", restoreFromUrl);
  }

  function syncControls() {
    $("#edgeTypeFilter").value = state.edgeType;
    $("#consensusFilter").value = state.consensus;
    $("#confidenceFilter").value = state.confidence;
    $("#confidenceValue").textContent = `${state.confidence} / 5`;
    $("#dateFrom").value = state.dateFrom; $("#dateTo").value = state.dateTo;
    $("#traditionFilters").querySelectorAll("input").forEach(input => { input.checked = state.activeTraditions.has(input.value); });
    $("#traditionCount").textContent = state.activeTraditions.size;
    $$(".view-tab").forEach(button => {
      const selected = button.dataset.view === state.view;
      button.classList.toggle("active", selected); button.setAttribute("aria-selected", String(selected));
    });
    $("#graphView").hidden = state.view !== "graph";
    $("#timelineView").hidden = state.view !== "timeline";
    $("#listView").hidden = state.view !== "list";
    const viewDetails = {
      graph: ["RELATIONSHIP MAP", "The evidence, in context"],
      timeline: ["CHRONOLOGY", "Stories across time"],
      list: ["ACCESSIBLE INDEX", "Every node, in a table"]
    }[state.view];
    $("#viewKicker").textContent = viewDetails[0]; $("#viewTitle").textContent = viewDetails[1];
    $("#legendRow").hidden = state.view !== "graph";
  }

  function renderAll() {
    syncControls();
    renderGraph();
    renderTimeline();
    renderList();
    renderInspector();
    const visible = visibleNodes();
    const connections = DATA.edges.filter(edge => isInfluence(edge) && edgePassesFilters(edge, false)).length;
    $("#resultCount").textContent = `${connections} cited connection${connections === 1 ? "" : "s"}`;
    $("#searchResults").hidden = true;
  }

  const nodeSize = node => ({ w: node.type === "tradition" ? 190 : 180, h: node.type === "tradition" ? 62 : 58 });
  function graphPosition(node) {
    const traditionId = nodeParentTradition(node);
    const root = nodesById.get(traditionId);
    const targetRootX = GRAPH_GROUP_X[traditionId] ?? GRAPH_GROUP_X[root?.legacyId]
      ?? GRAPH_GROUP_NAME_X[normalize(root?.name)];
    const shiftX = root && targetRootX != null ? targetRootX - root.x : 0;
    return { ...node, x: node.x + shiftX, y: node.y + GRAPH_Y_OFFSET };
  }
  const rectAnchor = (node, target) => {
    const size = nodeSize(node); const dx = target.x - node.x; const dy = target.y - node.y;
    if (Math.abs(dx) > Math.abs(dy) * .8) {
      const direction = Math.sign(dx) || 1;
      const ry = Math.min(size.h / 2, Math.abs(dy / (dx || 1)) * size.w / 2);
      return { x: node.x + direction * size.w / 2, y: node.y + Math.sign(dy || 1) * ry };
    }
    const direction = Math.sign(dy) || 1;
    const rx = Math.min(size.w / 2 - 5, Math.abs(dx / (dy || 1)) * size.h / 2);
    return { x: node.x + Math.sign(dx || 1) * rx, y: node.y + direction * size.h / 2 };
  };
  function edgeCurve(from, to, obstacles) {
    const a = rectAnchor(from, to), b = rectAnchor(to, from);
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const normal = { x: -dy / distance, y: dx / distance };
    const handle = Math.min(150, Math.max(38, distance * .32));
    const offsets = [0, 42, -42, 84, -84, 132, -132, 190, -190];
    let best = null;
    for (const offset of offsets) {
      const c1 = { x: a.x + dx * .32 + normal.x * offset, y: a.y + dy * .32 + normal.y * offset };
      const c2 = { x: b.x - dx * .32 + normal.x * offset, y: b.y - dy * .32 + normal.y * offset };
      // Keep the curve's handles long enough to leave and approach the card edges cleanly.
      const controlDistance = Math.hypot(c1.x - a.x, c1.y - a.y);
      if (controlDistance < handle * .45) {
        c1.x += dx / distance * handle * .45;
        c1.y += dy / distance * handle * .45;
        c2.x -= dx / distance * handle * .45;
        c2.y -= dy / distance * handle * .45;
      }
      let collisions = 0;
      for (let step = 2; step < 20; step++) {
        const t = step / 20, u = 1 - t;
        const x = u ** 3 * a.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * b.x;
        const y = u ** 3 * a.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * b.y;
        if (obstacles.some(node => {
          if (node.id === from.id || node.id === to.id) return false;
          const size = nodeSize(node);
          return x > node.x - size.w / 2 - 9 && x < node.x + size.w / 2 + 9
            && y > node.y - size.h / 2 - 9 && y < node.y + size.h / 2 + 9;
        })) collisions++;
      }
      const score = collisions * 10000 + Math.abs(offset);
      if (!best || score < best.score) best = { score, d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}` };
      if (collisions === 0 && offset === 0) break;
    }
    return best.d;
  }
  const colorFor = node => ({ clay: "#b96c50", olive: "#727b50", blue: "#66818a", rose: "#ad7866" }[node.color] || "#66818a");
  const tinyLabel = type => ({ tradition: "TRADITION", text: "TEXT", story: "STORY", work: "LATER WORK" }[type] || type.toUpperCase());
  function titleLines(name) {
    const words = name.split(/\s+/); const lines = [""];
    for (const word of words) {
      const last = lines.length - 1;
      if ((lines[last] + " " + word).trim().length > 22 && lines.length < 2) lines.push(word);
      else lines[last] = (lines[last] + " " + word).trim();
    }
    if (lines.length === 2 && lines[1].length > 23) lines[1] = lines[1].slice(0, 21) + "…";
    if (lines.length === 1 && lines[0].length > 23) lines[0] = lines[0].slice(0, 21) + "…";
    return lines;
  }

  function renderGraph() {
    const content = $("#graphContent");
    const active = visibleNodes();
    const activeIds = new Set(active.map(node => node.id));
    const positionedNodes = active.map(graphPosition);
    const positionedById = new Map(positionedNodes.map(node => [node.id, node]));
    const edges = DATA.edges.filter(edge => activeIds.has(edge.source) && activeIds.has(edge.target) && edgePassesFilters(edge, true));
    const edgeMarkup = edges.map(edge => {
      const from = positionedById.get(edge.source), to = positionedById.get(edge.target);
      const classes = ["edge-path", edge.type, edge.direction === "unknown" ? "unknown-direction" : "", state.selected?.kind === "edge" && state.selected.id === edge.id ? "selected" : "", state.pathEdges.includes(edge.id) ? "path-highlight" : "", state.selected?.kind === "node" && ![edge.source, edge.target].includes(state.selected.id) && !state.pathEdges.length ? "dimmed" : ""].filter(Boolean).join(" ");
      const label = `${edgeLabel(edge.type)}: ${from.name} → ${to.name}. ${consensusLabel(edge.consensus)}, confidence ${edge.confidence} of 5.`;
      return `<g class="edge-group" data-edge="${html(edge.id)}"><path class="${classes}" d="${edgeCurve(from, to, positionedNodes)}" tabindex="0" role="button" aria-label="${html(label)}"><title>${html(label)}</title></path></g>`;
    }).join("");
    const blobs = traditions.filter(tradition => state.activeTraditions.has(tradition.id)).map(tradition => {
      const members = positionedNodes.filter(node => nodeParentTradition(node) === tradition.id);
      if (!members.length) return "";
      const bounds = members.map(node => {
        const size = nodeSize(node);
        return { left: node.x - size.w / 2, right: node.x + size.w / 2, top: node.y - size.h / 2, bottom: node.y + size.h / 2 };
      });
      const paddingX = 16, paddingY = 18;
      const left = Math.max(8, Math.min(...bounds.map(box => box.left)) - paddingX);
      const top = Math.max(58, Math.min(...bounds.map(box => box.top)) - paddingY);
      const right = Math.min(GRAPH_WIDTH - 8, Math.max(...bounds.map(box => box.right)) + paddingX);
      const bottom = Math.min(GRAPH_HEIGHT - 20, Math.max(...bounds.map(box => box.bottom)) + paddingY);
      const focused = state.activeTraditions.size === 1 && state.activeTraditions.has(tradition.id);
      const color = colorFor(tradition);
      return `<rect class="tradition-blob ${focused ? "focused" : ""}" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="18" stroke="${color}" aria-hidden="true"><title>${html(tradition.name)} · ${members.length - 1} topics</title></rect>`;
    }).join("");
    const nodeMarkup = positionedNodes.map(node => {
      const { w, h } = nodeSize(node); const lines = titleLines(node.name); const color = colorFor(node);
      const startY = node.y - (lines.length === 1 ? 3 : 9);
      const title = lines.map((line, index) => `<tspan x="${node.x - w / 2 + 31}" dy="${index === 0 ? 0 : 15}">${html(line)}</tspan>`).join("");
      const selectedConnections = state.selected?.kind === "node" ? DATA.edges.some(edge => isInfluence(edge) && [edge.source, edge.target].includes(state.selected.id) && [edge.source, edge.target].includes(node.id)) : false;
      const classes = ["node-group", state.selected?.kind === "node" && state.selected.id === node.id ? "selected" : "", state.pathNodes.includes(node.id) ? "path-highlight" : "", state.selected?.kind === "node" && state.selected.id !== node.id && !selectedConnections && !state.pathEdges.length ? "dimmed" : ""].filter(Boolean).join(" ");
      const label = `${node.name}, ${typeLabel(node.type)}. ${node.dates?.label || "Date uncertain"}.`;
      const icon = node.type === "tradition" ? `<circle cx="${node.x - w / 2 + 16}" cy="${node.y}" r="4.2" class="node-glyph" />` : node.type === "text" ? `<rect x="${node.x - w / 2 + 12}" y="${node.y - 4}" width="8" height="8" rx="1" class="node-glyph" />` : node.type === "story" ? `<path d="M${node.x - w / 2 + 16},${node.y - 5} l5,5 -5,5 -5,-5Z" class="node-glyph" />` : `<path d="M${node.x - w / 2 + 16},${node.y - 5} l5,5 -5,5 -5,-5Z" class="node-glyph" />`;
      const collapsed = state.collapsedTraditions.has(node.id);
      const collapse = node.type === "tradition" ? `<g data-collapse="${html(node.id)}" tabindex="0" role="button" aria-label="${collapsed ? "Expand" : "Collapse"} ${html(node.name)}"><circle class="collapse-control" cx="${node.x + w / 2 - 13}" cy="${node.y}" r="6.5" /><text class="collapse-glyph" x="${node.x + w / 2 - 13}" y="${node.y + 2.5}">${collapsed ? "+" : "−"}</text></g>` : "";
      return `<g class="${classes}" data-node="${html(node.id)}" transform="translate(0 0)" tabindex="0" role="button" aria-label="${html(label)}"><title>${html(label)}</title><rect class="node-card" x="${node.x - w / 2}" y="${node.y - h / 2}" width="${w}" height="${h}" rx="2" /><rect class="node-accent" x="${node.x - w / 2}" y="${node.y - h / 2}" width="3" height="${h}" fill="${color}" />${icon}<text class="node-title" x="0" y="${startY}">${title}</text><text class="node-subtitle" x="${node.x - w / 2 + 31}" y="${node.y + h / 2 - 8}">${tinyLabel(node.type)}</text></g>${collapse}`;
    }).join("");
    content.innerHTML = `${blobs}${edgeMarkup}${nodeMarkup}`;
    $("#graphZoom").setAttribute("transform", `translate(${state.zoom.x} ${state.zoom.y}) scale(${state.zoom.scale})`);
  }

  function renderTimeline() {
    const root = $("#timelineView");
    const items = visibleNodes(false).slice().sort((a, b) => (a.dates?.start ?? Infinity) - (b.dates?.start ?? Infinity) || a.name.localeCompare(b.name));
    if (!items.length) { root.innerHTML = '<p class="empty-path">No nodes match these filters.</p>'; return; }
    const datedItems = items.filter(node => node.dates);
    if (!datedItems.length) {
      root.innerHTML = `<div class="timeline-undated"><strong>UNDATED</strong>${items.map(node => `<button data-timeline-node="${html(node.id)}">${html(node.name)}</button>`).join(" · ")}</div>`;
      $$('[data-timeline-node]', root).forEach(button => button.addEventListener("click", () => chooseNode(button.dataset.timelineNode)));
      return;
    }
    const years = datedItems.flatMap(node => [node.dates.start, node.dates.end]);
    let min = Math.min(...years), max = Math.max(...years); if (max - min < 1) max = min + 1;
    const ticks = [min, min + (max - min) / 3, min + 2 * (max - min) / 3, max].map(year => Math.round(year));
    const rows = datedItems.map(node => {
      const left = ((node.dates.start - min) / (max - min)) * 100;
      const width = Math.max(0.7, ((node.dates.end - node.dates.start) / (max - min)) * 100);
      const title = `${node.name} · ${node.dates.label}. ${node.dates.note}`;
      return `<div class="timeline-row"><div class="timeline-name" title="${html(node.name)}">${html(node.name)}</div><div class="timeline-track"><button class="timeline-bar ${node.type}" style="left:${left}%;width:${width}%" data-timeline-node="${html(node.id)}" title="${html(title)}" aria-label="${html(title)}">${width > 10 ? html(node.dates.label) : ""}<span class="timeline-uncertainty" aria-hidden="true"></span></button></div></div>`;
    }).join("");
    const undated = items.filter(node => !node.dates);
    root.innerHTML = `<div class="timeline-head">${ticks.map(year => `<span class="timeline-year">${html(formatYear(year))}</span>`).join("")}</div>${rows}${undated.length ? `<div class="timeline-undated"><strong>UNDATED</strong> ${undated.map(node => `<button data-timeline-node="${html(node.id)}">${html(node.name)}</button>`).join(" · ")}</div>` : ""}<div class="timeline-undated">Date bars show the approximate range recorded for each node. Hover or focus a bar for the uncertainty note.</div>`;
    $$("[data-timeline-node]", root).forEach(button => button.addEventListener("click", () => chooseNode(button.dataset.timelineNode)));
  }

  function renderList() {
    const root = $("#listView");
    const items = visibleNodes().slice().sort((a, b) => a.name.localeCompare(b.name));
    root.innerHTML = `<table class="index-table"><thead><tr><th scope="col">NAME</th><th scope="col">KIND</th><th scope="col">DATE</th><th scope="col">LANGUAGES</th><th scope="col">CITES</th></tr></thead><tbody>${items.map(node => {
      const count = (node.sources || []).length + DATA.edges.filter(edge => isInfluence(edge) && edge.evidence?.length && [edge.source, edge.target].includes(node.id)).length;
      return `<tr><td><button data-list-node="${html(node.id)}">${html(node.name)}</button><br /><span>${html(node.names?.slice(1, 2)[0] || "")}</span></td><td><span class="table-type">${html(typeLabel(node.type))}</span></td><td>${html(node.dates?.label || "Undated")}</td><td>${html((node.languages || []).join(", "))}</td><td>${count}</td></tr>`;
    }).join("")}</tbody></table>`;
    $$("[data-list-node]", root).forEach(button => button.addEventListener("click", () => chooseNode(button.dataset.listNode)));
  }

  function sourceCard(id) {
    const source = citation(id); if (!source) return "";
    return `<div class="citation-card"><span class="citation-short">${html(source.short)} · ${html(source.year)}</span><a href="${html(source.url)}" target="_blank" rel="noreferrer">${html(source.title)} ↗</a><small>${html(source.author)} · ${html(source.publisher)}. ${html(source.license)}</small></div>`;
  }
  function nodeDetail(node) {
    const parent = nodeParentTradition(node) && nodesById.get(nodeParentTradition(node));
    const outgoing = DATA.edges.filter(edge => isInfluence(edge) && edge.source === node.id);
    const incoming = DATA.edges.filter(edge => isInfluence(edge) && edge.target === node.id);
    const relatedEdges = [...incoming, ...outgoing];
    const sourceIds = new Set([...(node.sources || []), ...relatedEdges.flatMap(edge => edge.evidence || [])]);
    const externalLinks = [...(node.external || [])];
    if (node.qid) externalLinks.push({ label: `Wikidata item ${node.qid}`, url: `https://www.wikidata.org/wiki/${node.qid}` });
    const ext = externalLinks.map(link => `<a class="external-link" href="${html(link.url)}" target="_blank" rel="noreferrer"><span>↗</span>${html(link.label)}</a>`).join("");
    const qid = node.qid ? `<div class="fact-cell"><span>WIKIDATA</span><strong>${html(node.qid)}</strong></div>` : "";
    const details = `<div class="inspector-top"><span class="item-type"><i class="type-marker ${html(node.type)}"></i>${html(typeLabel(node.type))}</span><span class="node-id">${html(node.id)}</span></div>
      <h2>${html(node.name)}</h2><p class="item-summary">${html(node.summary)}</p>
      <div class="fact-grid"><div class="fact-cell"><span>DATE / RANGE</span><strong>${html(node.dates?.label || "Undated")}<br /><span class="date-note">${html(node.dates?.note || "Date not recorded")}</span></strong></div><div class="fact-cell"><span>LANGUAGES</span><strong>${html((node.languages || []).join(", "))}</strong></div>${qid}${parent ? `<div class="fact-cell"><span>TRADITION</span><strong>${html(parent.name)}</strong></div>` : ""}</div>
      ${ext ? `<div class="section-caption">SOURCE LINKS</div>${ext}` : ""}
      ${relatedEdges.length ? `<div class="section-caption">INFLUENCE CLAIMS <small>${relatedEdges.length} record${relatedEdges.length === 1 ? "" : "s"}</small></div>${relatedEdges.map(edge => { const other = nodesById.get(edge.source === node.id ? edge.target : edge.source); return `<button class="related-item" data-related-edge="${html(edge.id)}"><span>${edge.source === node.id ? "To" : "From"} ${html(other.name)}</span><small>${html(edgeLabel(edge.type))}</small></button>`; }).join("")}` : ""}
      ${sourceIds.size ? `<div class="section-caption">EVIDENCE & REFERENCES <small>${sourceIds.size} source${sourceIds.size === 1 ? "" : "s"}</small></div>${[...sourceIds].map(sourceCard).join("")}` : ""}`;
    return details;
  }
  function edgeDetail(edge) {
    const from = nodesById.get(edge.source), to = nodesById.get(edge.target);
    const hierarchy = edge.type === "part_of";
    const confidence = `<span class="confidence-dots" aria-label="Confidence ${edge.confidence} of 5">${[1,2,3,4,5].map(n => `<i class="${n <= edge.confidence ? "on" : ""}"></i>`).join("")}</span>`;
    return `<div class="inspector-top"><span class="item-type"><i class="type-marker ${hierarchy ? "text" : "story"}"></i>${hierarchy ? "Hierarchy link" : "Influence claim"}</span><span class="node-id">${html(edge.id)}</span></div>
      <div class="edge-ribbon ${html(edge.consensus)}">${hierarchy ? "Part of" : html(edgeLabel(edge.type))}</div>
      <h2>${html(from.name)}<br /><span class="edge-to">→ ${html(to.name)}</span></h2>
      <p class="item-summary">${hierarchy ? "A structural link placing a story inside a text or a text within a broader tradition." : "A directional scholarly claim between two records. The claim carries its own confidence and consensus label."}</p>
      <div class="fact-grid"><div class="fact-cell"><span>CONFIDENCE</span><strong>${confidence} <span class="date-note">${edge.confidence} / 5</span></strong></div><div class="fact-cell"><span>CONSENSUS</span><strong><span class="consensus-pill ${html(edge.consensus)}">${html(consensusLabel(edge.consensus))}</span></strong></div><div class="fact-cell"><span>DIRECTION</span><strong>${html(edge.direction)}</strong></div><div class="fact-cell"><span>DATE</span><strong>${html(edge.date || "Not specified")}</strong></div></div>
      <div class="claim-box">${html(edge.rationale)}</div>
      ${edge.status ? `<div class="review-note">${edge.status === "prototype" ? "Prototype seed · scholarly review not recorded" : html(edge.status)}</div>` : ""}
      <div class="section-caption">EVIDENCE <small>${edge.evidence.length} citation${edge.evidence.length === 1 ? "" : "s"}</small></div>${edge.evidence.map(sourceCard).join("")}`;
  }
  function pathDetail() {
    const path = DATA.guidedPaths.find(item => item.id === state.selected?.id);
    if (!path) return `<div class="inspector-top"><span class="item-type">RELATIONSHIP ALMANAC</span><span class="node-id">${html(activeReleaseId || "SEED / 01")}</span></div><h2>Read the relationship.</h2><p class="item-summary">Select a node or connection to inspect its record, the claim, and its evidence. Each line is typed so parallels are not mistaken for transmission.</p><div class="section-caption">START WITH A GUIDED PATH</div>${DATA.guidedPaths.map(item => `<button class="related-item" data-open-guide="${html(item.id)}"><span>${html(item.title)}</span><small>Explore ↗</small></button>`).join("")}<div class="section-caption">THE SEED GRAPH</div><p class="item-summary">${DATA.nodes.length} records across ${traditions.length} traditions. The source set is intentionally small so the evidence stays visible.</p>`;
    const steps = path.nodes.map((nodeId, index) => {
      const node = nodesById.get(nodeId); const edge = index > 0 ? edgesById.get(path.edges[index - 1]) : null;
      return `<div class="path-step"><strong>${html(node.name)}</strong>${edge ? `<small>${html(edgeLabel(edge.type))} · ${html(consensusLabel(edge.consensus))} · confidence ${edge.confidence}/5</small>` : `<small>${html(node.dates?.label || "")}</small>`}</div>`;
    }).join("");
    const citations = [...new Set(path.edges.flatMap(id => edgesById.get(id)?.evidence || []))];
    return `<div class="inspector-top"><span class="item-type"><i class="type-marker story"></i>Guided story path</span><span class="node-id">${html(path.id)}</span></div><h2>${html(path.title)}</h2><p class="item-summary">${html(path.introduction)}</p><div class="section-caption">THE ROUTE <small>${path.nodes.length} nodes · ${path.edges.length} claims</small></div>${steps}<div class="section-caption">PATH EVIDENCE</div>${citations.map(sourceCard).join("")}<button class="text-button path-action" data-run-guide="${html(path.id)}">Open path explorer ↗</button>`;
  }
  function renderInspector() {
    const root = $("#inspectorContent");
    if (!state.selected) { root.innerHTML = pathDetail(); bindInspectorActions(root); return; }
    if (dataMode === "api" && state.detailStatus === "loading" && state.selected.kind !== "path") {
      const selected = state.selected.kind === "node" ? nodesById.get(state.selected.id) : null;
      const label = selected?.name || "Connection details";
      root.innerHTML = `<div class="inspector-top"><span class="item-type">API DETAIL</span><span class="node-id">${html(activeReleaseId)}</span></div><h2>${html(label)}</h2><p class="item-summary" role="status">Loading this record, its claims, and citation details from the active release…</p>`;
      return;
    }
    if (state.selected.kind === "edge") root.innerHTML = edgeDetail(edgesById.get(state.selected.id));
    else if (state.selected.kind === "path") root.innerHTML = pathDetail();
    else root.innerHTML = nodeDetail(nodesById.get(state.selected.id));
    if (dataMode === "api" && state.detailStatus === "loading" && state.selected.kind === "path") {
      root.insertAdjacentHTML("afterbegin", `<p class="review-note" role="status">Loading claim and citation details for release ${html(activeReleaseId)}…</p>`);
    }
    if (dataMode === "api" && state.detailStatus === "error" && state.detailError) {
      root.insertAdjacentHTML("afterbegin", `<p class="api-detail-error" role="status">Live details unavailable: ${html(state.detailError)}. Showing bundled seed data for this record.</p>`);
    }
    bindInspectorActions(root);
  }
  function bindInspectorActions(root) {
    $$('[data-related-edge]', root).forEach(button => button.addEventListener("click", () => chooseEdge(button.dataset.relatedEdge)));
    $$('[data-open-guide]', root).forEach(button => button.addEventListener("click", () => activateGuide(button.dataset.openGuide)));
    $$('[data-run-guide]', root).forEach(button => button.addEventListener("click", () => { const path = DATA.guidedPaths.find(item => item.id === button.dataset.runGuide); if (path) { $("#pathFrom").value = path.nodes[0]; $("#pathTo").value = path.nodes.at(-1); $("#pathDialog").showModal(); runPathSearch(path.nodes[0], path.nodes.at(-1)); } }));
  }

  function chooseNode(id) {
    const node = nodesById.get(id); if (!node) return;
    if (node.type === "tradition") {
      const alreadyFocused = state.activeTraditions.size === 1 && state.activeTraditions.has(node.id);
      state.activeTraditions = new Set(alreadyFocused ? traditions.map(item => item.id) : [node.id]);
    }
    state.selected = { kind: "node", id }; state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
    selectedDetailKey = null; state.detailStatus = "idle"; state.detailError = "";
    if (!state.activeTraditions.has(nodeParentTradition(node))) state.activeTraditions.add(nodeParentTradition(node));
    state.collapsedTraditions.delete(nodeParentTradition(node));
    renderAll(); writeUrl(true);
    loadSelectionDetails();
  }
  function toggleCollapse(id) {
    state.collapsedTraditions.has(id) ? state.collapsedTraditions.delete(id) : state.collapsedTraditions.add(id);
    renderAll(); writeUrl(true);
  }
  function chooseEdge(id) {
    const edge = edgesById.get(id); if (!edge) return;
    state.selected = { kind: "edge", id }; state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
    selectedDetailKey = null; state.detailStatus = "idle"; state.detailError = "";
    renderAll(); writeUrl(true);
    loadSelectionDetails();
  }
  function activateGuide(id) {
    const path = DATA.guidedPaths.find(item => item.id === id); if (!path) return;
    state.activeTraditions = new Set(traditions.map(node => node.id));
    state.collapsedTraditions.clear();
    state.edgeType = "all"; state.consensus = "all"; state.confidence = 1; state.dateFrom = -3000; state.dateTo = 2026;
    state.view = "graph"; state.selected = { kind: "path", id };
    state.pathNodes = path.nodes.slice(); state.pathEdges = path.edges.slice(); state.pathTitle = path.title; state.pathIntro = path.introduction;
    selectedDetailKey = null; state.detailStatus = "idle"; state.detailError = "";
    renderAll(); writeUrl(true); $("#pathFrom").value = path.nodes[0]; $("#pathTo").value = path.nodes.at(-1);
    showToast(`Showing guided path: ${path.title}`);
    loadSelectionDetails();
  }

  function getSearchMatches(query) {
    const term = normalize(query.trim()); if (!term) return [];
    return DATA.nodes.map(node => ({ node, score: Math.max(...[node.name, ...(node.names || [])].map(name => {
      const normalized = normalize(name); return normalized === term ? 3 : normalized.startsWith(term) ? 2 : normalized.includes(term) ? 1 : 0;
    })) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name)).slice(0, 6).map(item => item.node);
  }
  function renderSearch() {
    const query = state.query.trim(); const root = $("#searchResults");
    const requestId = ++searchRequest;
    latestSearchResults = [];
    if (searchTimer) clearTimeout(searchTimer);
    if (!query) { root.hidden = true; writeUrl(false); return; }
    root.hidden = false;
    root.innerHTML = '<div class="search-result"><strong>Searching the active release…</strong></div>';
    const renderMatches = matches => {
      if (requestId !== searchRequest) return;
      latestSearchResults = matches;
      root.innerHTML = matches.length ? matches.map(item => {
        const node = item.node || nodesById.get(item.node_id);
        if (!node) return "";
        return `<button class="search-result" data-search-node="${html(node.id)}"><strong>${html(item.matched_name || node.name)}</strong><small>${html(typeLabel(node.type))} · ${html(node.dates?.label || "Undated")}</small></button>`;
      }).join("") : '<div class="search-result"><strong>No matching records</strong><small>Try another spelling or script.</small></div>';
    };
    searchTimer = setTimeout(() => {
      if (dataMode !== "api") {
        renderMatches(getSearchMatches(query).map(node => ({ node })));
        return;
      }
      API.search(query).then(payload => {
        if (payload.release_id && payload.release_id !== activeReleaseId) {
          location.reload();
          return;
        }
        setConnectedStatus();
        renderMatches(payload.results || []);
      }).catch(() => {
        if (requestId !== searchRequest) return;
        setDataStatus("warning", `Search API unavailable for release ${activeReleaseId}; using names in the bundled development index.`);
        renderMatches(getSearchMatches(query).map(node => ({ node })));
      });
    }, dataMode === "api" ? 140 : 0);
  }

  function findPaths(startId, endId) {
    if (startId === endId) return [{ nodes: [startId], edges: [], cost: 0 }];
    const adjacency = new Map();
    DATA.edges.filter(edge => edgePassesFilters(edge, false, false)).forEach(edge => {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
      const consensusPenalty = { consensus: 0, majority: .35, contested: 1.2, fringe: 2.5 }[edge.consensus] || 0;
      const directionPenalty = edge.direction === "unknown" ? .6 : edge.direction === "probable" ? .2 : 0;
      adjacency.get(edge.source).push({ edge, cost: (6 - edge.confidence) + consensusPenalty + directionPenalty + (edge.inferred ? 2 : 0) });
    });
    const results = [];
    const visit = (nodeId, visited, pathNodes, pathEdges, cost) => {
      if (pathEdges.length > 8 || results.length > 100) return;
      if (nodeId === endId) { results.push({ nodes: pathNodes.slice(), edges: pathEdges.slice(), cost }); return; }
      (adjacency.get(nodeId) || []).forEach(({ edge, cost: edgeCost }) => {
        if (visited.has(edge.target)) return;
        visited.add(edge.target); pathNodes.push(edge.target); pathEdges.push(edge.id);
        visit(edge.target, visited, pathNodes, pathEdges, cost + edgeCost);
        pathEdges.pop(); pathNodes.pop(); visited.delete(edge.target);
      });
    };
    visit(startId, new Set([startId]), [startId], [], 0);
    return results.sort((a, b) => a.cost - b.cost || a.edges.length - b.edges.length).slice(0, 3);
  }
  function renderPathResults(paths) {
    const root = $("#pathResults");
    if (!paths.length) { root.innerHTML = '<p class="empty-path">No supported path matches the current filters. Try widening the date or confidence range.</p>'; return; }
    root.innerHTML = paths.map((path, index) => {
      const route = path.nodes.map((id, i) => `${i ? "<span>→</span>" : ""}<button data-route-node="${html(id)}">${html(nodesById.get(id).name)}</button>`).join("");
      const edgeNotes = path.edges.map(id => edgesById.get(id)?.rationale || "").filter(Boolean);
      const evidence = [...new Set(path.edges.flatMap(id => edgesById.get(id)?.evidence || []))];
      const consensus = path.edges.length ? Math.max(...path.edges.map(id => ({ consensus: 0, majority: 1, contested: 2, fringe: 3 }[edgesById.get(id).consensus] || 0))) : 0;
      const consensusName = path.dimensions
        ? consensusLabel(path.dimensions.weakest_consensus_label)
        : ["Consensus", "Majority view", "Contested", "Fringe"][consensus];
      const heading = path.dimensions ? `NON-DOMINATED PATH ${index + 1}` : index === 0 ? "BEST-SUPPORTED PATH" : `ALTERNATE PATH ${index + 1}`;
      const dimensions = path.dimensions
        ? `<small>${path.dimensions.hops} hops · weakest consensus: ${html(consensusName)} · weakest confidence: ${path.dimensions.weakest_confidence}/5</small>`
        : "";
      return `<div class="path-result"><div class="path-result-head"><strong>${heading}</strong><span class="consensus-pill ${consensusName === "Contested" || consensusName === "Fringe" ? normalize(consensusName) : ""}">${html(consensusName)}</span></div>${dimensions ? `<div class="path-result-note">${dimensions}</div>` : ""}<div class="path-route">${route}</div><p class="path-result-note">${html(edgeNotes.join(" "))}</p><div class="path-citations">${evidence.map(id => { const source = citation(id); return `<a href="${html(source?.url || "#")}" target="_blank" rel="noreferrer">${html(source?.short || id)} ↗</a>`; }).join("")}</div></div>`;
    }).join("");
    $$('[data-route-node]', root).forEach(button => button.addEventListener("click", () => chooseNode(button.dataset.routeNode)));
  }

  async function runPathSearch(startId, endId) {
    const root = $("#pathResults");
    if (state.activeTraditions.size === 0) {
      renderPathResults([]);
      return;
    }
    if (dataMode !== "api") {
      renderPathResults(findPaths(startId, endId));
      return;
    }
    root.innerHTML = '<p class="empty-path" role="status">Finding cited routes in the active release…</p>';
    const activeTraditions = state.activeTraditions.size < traditions.length ? [...state.activeTraditions] : [];
    try {
      const response = await API.findPaths({
        source: startId,
        target: endId,
        relationType: state.edgeType,
        consensus: state.consensus,
        confidence: state.confidence,
        startYear: state.dateFrom,
        endYear: state.dateTo,
        traditions: activeTraditions
      });
      if (response.release_id && response.release_id !== activeReleaseId) {
        location.reload();
        return;
      }
      const paths = (response.paths || []).map(path => ({ nodes: path.nodes, edges: path.claim_ids, dimensions: path.dimensions }));
      response.paths?.forEach(path => path.steps.forEach(step => {
        const edge = edgesById.get(step.claim_id);
        if (!edge) return;
        edge.source = step.subject_id;
        edge.target = step.object_id;
        edge.type = step.relation_type;
        edge.direction = step.direction;
        edge.confidence = step.confidence ?? 0;
        edge.consensus = step.consensus || "contested";
        edge.rationale = step.rationale || "No rationale has been recorded.";
        edge.inferred = Boolean(step.inferred);
        edge.evidence = step.evidence_source_ids || [];
        edge.status = edge.status || "prototype";
        edge._apiDetailsLoaded = true;
      }));
      const sourceIds = [...new Set(response.paths.flatMap(path => path.steps.flatMap(step => step.evidence_source_ids || [])))];
      const sources = await Promise.allSettled(sourceIds.map(id => API.getSource(id)));
      sources.filter(result => result.status === "fulfilled").forEach(result => storeApiSource(result.value));
      if (sources.some(result => result.status === "rejected")) {
        setDataStatus("warning", `Some path citations are unavailable from API release ${activeReleaseId}.`);
      } else setConnectedStatus();
      renderPathResults(paths);
    } catch (error) {
      setDataStatus("warning", `Path API unavailable for release ${activeReleaseId}; using the graph's local path search.`);
      renderPathResults(findPaths(startId, endId));
    }
  }

  function bindGraphInteractions() {
    const svg = $("#graphSvg");
    svg.addEventListener("click", event => {
      const collapse = event.target.closest("[data-collapse]"); if (collapse) { toggleCollapse(collapse.dataset.collapse); return; }
      const node = event.target.closest("[data-node]"); if (node) { chooseNode(node.dataset.node); return; }
      const edge = event.target.closest("[data-edge]"); if (edge) chooseEdge(edge.dataset.edge);
    });
    svg.addEventListener("keydown", event => {
      if (!(["Enter", " "].includes(event.key))) return;
      const collapse = event.target.closest("[data-collapse]"); if (collapse) { event.preventDefault(); toggleCollapse(collapse.dataset.collapse); return; }
      const node = event.target.closest("[data-node]"); if (node) { event.preventDefault(); chooseNode(node.dataset.node); return; }
      const edge = event.target.closest("[data-edge]"); if (edge) { event.preventDefault(); chooseEdge(edge.dataset.edge); }
    });
    svg.addEventListener("pointerdown", event => {
      if (event.target.closest("[data-node], [data-edge], [data-collapse]")) return;
      dragStart = { x: event.clientX, y: event.clientY, originX: state.zoom.x, originY: state.zoom.y };
      svg.setPointerCapture(event.pointerId); svg.classList.add("dragging");
    });
    svg.addEventListener("pointermove", event => {
      if (!dragStart) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = GRAPH_WIDTH / rect.width, scaleY = GRAPH_HEIGHT / rect.height;
      state.zoom.x = dragStart.originX + (event.clientX - dragStart.x) * scaleX;
      state.zoom.y = dragStart.originY + (event.clientY - dragStart.y) * scaleY;
      $("#graphZoom").setAttribute("transform", `translate(${state.zoom.x} ${state.zoom.y}) scale(${state.zoom.scale})`);
    });
    const finishDrag = () => { const moved = Boolean(dragStart); dragStart = null; svg.classList.remove("dragging"); if (moved) writeUrl(true); };
    svg.addEventListener("pointerup", finishDrag); svg.addEventListener("pointercancel", finishDrag);
    svg.addEventListener("wheel", event => {
      event.preventDefault(); setZoom(state.zoom.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
    }, { passive: false });
  }
  function setZoom(scale) { state.zoom.scale = Math.max(.58, Math.min(2.2, scale)); renderGraph(); writeUrl(false); }
  function resetZoom() { state.zoom = { x: 0, y: 0, scale: 1 }; renderGraph(); writeUrl(false); }

  function writeUrl(push = false) {
    const params = new URLSearchParams();
    params.set("view", state.view);
    if (state.selected?.kind === "node") params.set("node", state.selected.id);
    if (state.selected?.kind === "edge") params.set("edge", state.selected.id);
    if (state.selected?.kind === "path") params.set("path", state.selected.id);
    params.set("type", state.edgeType); params.set("consensus", state.consensus); params.set("confidence", state.confidence);
    params.set("from", state.dateFrom); params.set("to", state.dateTo);
    if (state.zoom.x) params.set("x", Math.round(state.zoom.x));
    if (state.zoom.y) params.set("y", Math.round(state.zoom.y));
    if (state.zoom.scale !== 1) params.set("zoom", state.zoom.scale.toFixed(2));
    if (state.activeTraditions.size !== traditions.length) params.set("traditions", [...state.activeTraditions].join(","));
    if (state.collapsedTraditions.size) params.set("collapsed", [...state.collapsedTraditions].join(","));
    if (state.query) params.set("q", state.query);
    const url = `${location.pathname}${location.search}#${params.toString()}`;
    try {
      if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
    } catch {
      location.hash = params.toString();
    }
  }
  function restoreFromUrl() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.size) return;
    const view = params.get("view"); if (["graph", "timeline", "list"].includes(view)) state.view = view;
    state.edgeType = params.get("type") || "all"; state.consensus = params.get("consensus") || "all";
    state.confidence = Number(params.get("confidence")) || 1; state.dateFrom = Number(params.get("from")) || -3000; state.dateTo = Number(params.get("to")) || 2026;
    state.zoom = { x: Number(params.get("x")) || 0, y: Number(params.get("y")) || 0, scale: Number(params.get("zoom")) || 1 };
    const traditionId = id => dataMode === "api" ? API.toCanonical("node", id) : id;
    state.activeTraditions = new Set(params.has("traditions") ? params.get("traditions").split(",").map(traditionId).filter(id => traditions.some(item => item.id === id)) : traditions.map(item => item.id));
    state.collapsedTraditions = new Set((params.get("collapsed") || "").split(",").map(traditionId).filter(id => traditions.some(item => item.id === id)));
    state.query = params.get("q") || ""; $("#searchInput").value = state.query;
    const nodeParam = params.get("node"), edgeParam = params.get("edge"), path = params.get("path");
    const node = dataMode === "api" ? API.toCanonical("node", nodeParam) : nodeParam;
    const edge = dataMode === "api" ? API.toCanonical("claim", edgeParam) : edgeParam;
    state.selected = node && nodesById.has(node) ? { kind: "node", id: node } : edge && edgesById.has(edge) ? { kind: "edge", id: edge } : path && DATA.guidedPaths.some(item => item.id === path) ? { kind: "path", id: path } : null;
    const guided = DATA.guidedPaths.find(item => item.id === path);
    state.pathNodes = guided?.nodes.slice() || []; state.pathEdges = guided?.edges.slice() || [];
    renderAll();
    if (state.query) renderSearch();
    loadSelectionDetails();
  }

  function resetState() {
    state.view = "graph"; state.selected = null; state.query = "";
    state.edgeType = "all"; state.consensus = "all"; state.confidence = 1; state.dateFrom = -3000; state.dateTo = 2026;
    state.activeTraditions = new Set(traditions.map(node => node.id)); state.collapsedTraditions.clear(); state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
    state.zoom = { x: 0, y: 0, scale: 1 }; $("#searchInput").value = "";
    const firstPath = DATA.guidedPaths[0];
    state.selected = { kind: "node", id: firstPath?.nodes.at(-1) || DATA.nodes[0]?.id };
    selectedDetailKey = null; state.detailStatus = "idle"; state.detailError = "";
    renderAll(); writeUrl(true); loadSelectionDetails();
  }
  async function copyShareUrl() {
    writeUrl(false);
    try { await navigator.clipboard.writeText(location.href); showToast("Share link copied. It will reopen this view."); }
    catch { showToast("View link ready in the address bar. Copy it to share."); }
  }

  async function exportData(format) {
    const selectedNodes = visibleNodes();
    const ids = new Set(selectedNodes.map(node => node.id));
    const edges = DATA.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edgePassesFilters(edge, true));
    if (dataMode === "api") {
      showToast("Loading release details for export…");
      const requests = [
        ...selectedNodes.map(node => ({ kind: "node", id: node.id, promise: API.getNodeBundle(node.id) })),
        ...edges.filter(edge => edge.family !== "hierarchy").map(edge => ({ kind: "claim", id: edge.id, promise: API.getClaimBundle(edge.id) }))
      ];
      const results = await Promise.allSettled(requests.map(item => item.promise));
      if (results.some(result => result.status === "rejected")) {
        setDataStatus("warning", `Some export details are unavailable from API release ${activeReleaseId}; bundled seed details are used where available.`);
      } else setConnectedStatus();
      results.forEach((result, index) => {
        const request = requests[index];
        if (result.status === "fulfilled") {
          if (request.kind === "node") applyApiNodeBundle(result.value);
          else {
            applyApiClaimPayload(result.value.claim);
            applyApiBundleSources(result.value);
          }
        } else if (request.kind === "node") applyFallbackNodeDetails(request.id);
        else applyFallbackClaimDetails(request.id);
      });
    }
    const visible = visibleNodes();
    const visibleIds = new Set(visible.map(node => node.id));
    const visibleEdges = DATA.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target) && edgePassesFilters(edge, true));
    const usedSourceIds = new Set(visibleEdges.flatMap(edge => edge.evidence || []));
    visible.forEach(node => (node.sources || []).forEach(id => usedSourceIds.add(id)));
    const licenses = [...usedSourceIds].map(id => ({ source: citation(id)?.title || id, license: citation(id)?.license || "Unknown" }));
    let text, mime, filename;
    if (format === "jsonld") {
      const graph = [
        ...visible.map(node => ({ "@id": `urn:religion-almanac:node:${node.id}`, "@type": "Thing", nodeType: node.type, name: node.name, alternateName: node.names || [], description: node.summary, dateRange: node.dates, inLanguage: node.languages || [], identifier: node.qid || undefined, license: DATA.meta.license })),
        ...visibleEdges.map(edge => ({ "@id": `urn:religion-almanac:claim:${edge.id}`, "@type": "urn:religion-almanac:RelationshipClaim", source: `urn:religion-almanac:node:${edge.source}`, target: `urn:religion-almanac:node:${edge.target}`, relationshipType: edge.type, direction: edge.direction, confidence: edge.confidence, consensus: edge.consensus, rationale: edge.rationale, evidence: edge.evidence.map(id => ({ "@id": citation(id)?.url, name: citation(id)?.title })), license: DATA.meta.license }))
      ];
      text = JSON.stringify({ "@context": { "@vocab": "https://schema.org/", "nodeType": "urn:religion-almanac:vocab:nodeType", "relationshipType": "urn:religion-almanac:vocab:relationshipType", "direction": "urn:religion-almanac:vocab:direction", "confidence": "urn:religion-almanac:vocab:confidence", "consensus": "urn:religion-almanac:vocab:consensus", "source": { "@id": "urn:religion-almanac:vocab:source", "@type": "@id" }, "target": { "@id": "urn:religion-almanac:vocab:target", "@type": "@id" }, "evidence": "https://schema.org/citation" }, "@graph": graph, "licenseRegister": licenses }, null, 2);
      mime = "application/ld+json"; filename = "religion-almanac.jsonld";
    } else {
      const evidenceText = ids => ids.map(id => { const source = citation(id); return source ? `${source.short}: ${source.url}` : id; }).join("; ");
      const evidenceLicenses = ids => ids.map(id => { const source = citation(id); return source ? `${source.short}: ${source.license}` : `${id}: unknown`; }).join("; ");
      const rows = [["record_type", "id", "name", "node_type", "source", "target", "edge_type", "direction", "confidence", "consensus", "summary_or_rationale", "evidence_citation_and_url", "almanac_license", "source_license_notes"]];
      visible.forEach(node => rows.push(["node", node.id, node.name, node.type, "", "", "", "", "", "", node.summary, evidenceText(node.sources || []), DATA.meta.license, evidenceLicenses(node.sources || [])]));
      visibleEdges.forEach(edge => rows.push(["edge", edge.id, "", "", nodesById.get(edge.source).name, nodesById.get(edge.target).name, edge.type, edge.direction, edge.confidence, edge.consensus, edge.rationale, evidenceText(edge.evidence), DATA.meta.license, evidenceLicenses(edge.evidence)]));
      text = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
      mime = "text/csv;charset=utf-8"; filename = "religion-almanac.csv";
    }
    const blob = new Blob([text], { type: mime }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); showToast(`${filename} exported with evidence and license notes.`);
  }

  async function showCitationRegister() {
    const dialog = $("#sourcesDialog");
    if (!dialog) return;
    if (dataMode === "api") {
      const nodeResults = await Promise.allSettled(DATA.nodes.map(node => API.getNodeBundle(node.id)));
      const nodeDetailsUnavailable = nodeResults.some(result => result.status === "rejected");
      nodeResults.forEach((result, index) => {
        if (result.status === "fulfilled") applyApiNodeBundle(result.value);
        else applyFallbackNodeDetails(DATA.nodes[index].id);
      });
      const sourceIds = [...new Set([
        ...DATA.edges.flatMap(edge => edge.evidence || []),
        ...DATA.nodes.flatMap(node => node.sources || [])
      ])];
      const results = await Promise.allSettled(sourceIds.map(id => API.getSource(id)));
      results.filter(result => result.status === "fulfilled").forEach(result => storeApiSource(result.value));
      results.forEach((result, index) => { if (result.status === "rejected") applyFallbackSource(sourceIds[index]); });
      if (nodeDetailsUnavailable || results.some(result => result.status === "rejected")) {
        setDataStatus("warning", `The source register may be incomplete for API release ${activeReleaseId}.`);
      } else setConnectedStatus();
    }
    const sources = dataMode === "api" ? [...sourcesById.values()] : DATA.sources;
    $("#sourceList").innerHTML = sources.map(source => `<div class="citation-card"><span class="citation-short">${html(source.short)} · ${html(source.year)}</span><a href="${html(source.url)}" target="_blank" rel="noreferrer">${html(source.title)} ↗</a><small>${html(source.author)} · ${html(source.container)} · ${html(source.publisher)}. ${html(source.license)}</small></div>`).join("");
    dialog.showModal();
  }

  async function startApp() {
    const startup = await API.bootstrap;
    DATA = startup.data;
    dataMode = startup.mode;
    activeReleaseId = startup.releaseId;
    renderStartup();
  }

  startApp().catch(error => {
    DATA = FALLBACK_DATA;
    dataMode = "fallback";
    activeReleaseId = `bundled-${FALLBACK_DATA.meta.version}-${FALLBACK_DATA.meta.built}`;
    renderStartup();
    setDataStatus("warning", `Could not connect to the API (${error.message}) · showing bundled fallback release ${activeReleaseId}.`);
  });
})();
