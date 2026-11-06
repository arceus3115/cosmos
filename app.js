(() => {
  "use strict";

  const DATA = window.ALMANAC_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nodesById = new Map(DATA.nodes.map(node => [node.id, node]));
  const sourcesById = new Map(DATA.sources.map(source => [source.id, source]));
  const edgesById = new Map(DATA.edges.map(edge => [edge.id, edge]));
  const traditions = DATA.nodes.filter(node => node.type === "tradition");
  const influenceTypes = [
    ["direct_textual_dependence", "Direct textual dependence"], ["shared_source", "Shared source"],
    ["motif_parallel", "Motif parallel"], ["oral_diffusion", "Oral diffusion"],
    ["polemical_adaptation", "Polemical adaptation"], ["reception_commentary", "Reception / commentary"],
    ["tradition_lineage", "Tradition lineage"]
  ];
  const state = {
    view: "graph", selected: null, query: "", edgeType: "all",
    consensus: "all", confidence: 1, dateFrom: -3000, dateTo: 2026,
    activeTraditions: new Set(traditions.map(node => node.id)), collapsedTraditions: new Set(), pathNodes: [], pathEdges: [], pathTitle: "", pathIntro: "",
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

  function initControls() {
    const typeSelect = $("#edgeTypeFilter");
    influenceTypes.forEach(([value, label]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = label; typeSelect.append(option);
    });
    const filters = $("#traditionFilters");
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
    $("#pathFrom").value = "atrahasis-flood";
    $("#pathTo").value = "noah-flood";
    bindControls();
    syncControls();
  }

  function bindControls() {
    $$(".view-tab").forEach(button => button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.selected = null;
      state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
      renderAll(); writeUrl(true);
    }));
    $("#traditionFilters").addEventListener("change", event => {
      if (!event.target.matches("input[type=checkbox]")) return;
      event.target.checked ? state.activeTraditions.add(event.target.value) : state.activeTraditions.delete(event.target.value);
      state.selected = null; state.pathNodes = []; state.pathEdges = [];
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
        const match = getSearchMatches(state.query)[0];
        if (match) { chooseNode(match.id); $("#searchResults").hidden = true; }
      }
      if (event.key === "Escape") $("#searchResults").hidden = true;
    });
    $("#searchResults").addEventListener("click", event => {
      const button = event.target.closest("[data-search-node]");
      if (button) { chooseNode(button.dataset.searchNode); $("#searchResults").hidden = true; }
    });
    $("#resetButton").addEventListener("click", resetState);
    $$(".guide-card").forEach(button => button.addEventListener("click", () => activateGuide(button.dataset.guide)));
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
    $("#footerSourcesButton").addEventListener("click", showCitationRegister);
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

  const nodeSize = node => ({ w: node.type === "tradition" ? 166 : 170, h: node.type === "tradition" ? 52 : 48 });
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
  const edgeCurve = (from, to) => {
    const a = rectAnchor(from, to), b = rectAnchor(to, from);
    if (Math.abs(to.x - from.x) > Math.abs(to.y - from.y) * 1.3) {
      const mid = (a.x + b.x) / 2;
      return `M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`;
    }
    const mid = (a.y + b.y) / 2;
    return `M${a.x},${a.y} C${a.x},${mid} ${b.x},${mid} ${b.x},${b.y}`;
  };
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
    const edges = DATA.edges.filter(edge => activeIds.has(edge.source) && activeIds.has(edge.target) && edgePassesFilters(edge, true));
    const edgeMarkup = edges.map(edge => {
      const from = nodesById.get(edge.source), to = nodesById.get(edge.target);
      const classes = ["edge-path", edge.type, edge.direction === "unknown" ? "unknown-direction" : "", state.selected?.kind === "edge" && state.selected.id === edge.id ? "selected" : "", state.pathEdges.includes(edge.id) ? "path-highlight" : "", state.selected?.kind === "node" && ![edge.source, edge.target].includes(state.selected.id) && !state.pathEdges.length ? "dimmed" : ""].filter(Boolean).join(" ");
      const label = `${edgeLabel(edge.type)}: ${from.name} → ${to.name}. ${consensusLabel(edge.consensus)}, confidence ${edge.confidence} of 5.`;
      return `<g class="edge-group" data-edge="${html(edge.id)}"><path class="${classes}" d="${edgeCurve(from, to)}" tabindex="0" role="button" aria-label="${html(label)}"><title>${html(label)}</title></path></g>`;
    }).join("");
    const nodeMarkup = active.map(node => {
      const { w, h } = nodeSize(node); const lines = titleLines(node.name); const color = colorFor(node);
      const startY = node.y - (lines.length === 1 ? 1 : 5);
      const title = lines.map((line, index) => `<tspan x="${node.x - w / 2 + 31}" dy="${index === 0 ? 0 : 13}">${html(line)}</tspan>`).join("");
      const selectedConnections = state.selected?.kind === "node" ? DATA.edges.some(edge => isInfluence(edge) && [edge.source, edge.target].includes(state.selected.id) && [edge.source, edge.target].includes(node.id)) : false;
      const classes = ["node-group", state.selected?.kind === "node" && state.selected.id === node.id ? "selected" : "", state.pathNodes.includes(node.id) ? "path-highlight" : "", state.selected?.kind === "node" && state.selected.id !== node.id && !selectedConnections && !state.pathEdges.length ? "dimmed" : ""].filter(Boolean).join(" ");
      const label = `${node.name}, ${typeLabel(node.type)}. ${node.dates?.label || "Date uncertain"}.`;
      const icon = node.type === "tradition" ? `<circle cx="${node.x - w / 2 + 16}" cy="${node.y}" r="4.2" class="node-glyph" />` : node.type === "text" ? `<rect x="${node.x - w / 2 + 12}" y="${node.y - 4}" width="8" height="8" rx="1" class="node-glyph" />` : node.type === "story" ? `<path d="M${node.x - w / 2 + 16},${node.y - 5} l5,5 -5,5 -5,-5Z" class="node-glyph" />` : `<path d="M${node.x - w / 2 + 16},${node.y - 5} l5,5 -5,5 -5,-5Z" class="node-glyph" />`;
      const collapsed = state.collapsedTraditions.has(node.id);
      const collapse = node.type === "tradition" ? `<g data-collapse="${html(node.id)}" tabindex="0" role="button" aria-label="${collapsed ? "Expand" : "Collapse"} ${html(node.name)}"><circle class="collapse-control" cx="${node.x + w / 2 - 13}" cy="${node.y}" r="6.5" /><text class="collapse-glyph" x="${node.x + w / 2 - 13}" y="${node.y + 2.5}">${collapsed ? "+" : "−"}</text></g>` : "";
      return `<g class="${classes}" data-node="${html(node.id)}" transform="translate(0 0)" tabindex="0" role="button" aria-label="${html(label)}"><title>${html(label)}</title><rect class="node-card" x="${node.x - w / 2}" y="${node.y - h / 2}" width="${w}" height="${h}" rx="2" /><rect class="node-accent" x="${node.x - w / 2}" y="${node.y - h / 2}" width="3" height="${h}" fill="${color}" />${icon}<text class="node-title" x="0" y="${startY}">${title}</text><text class="node-subtitle" x="${node.x - w / 2 + 31}" y="${node.y + h / 2 - 8}">${tinyLabel(node.type)}</text></g>${collapse}`;
    }).join("");
    const headings = [
      [25, 40, "MESOPOTAMIAN TRADITIONS", 330], [400, 40, "JEWISH TRADITIONS", 300],
      [735, 40, "GRECO-ROMAN LITERATURE", 255], [985, 40, "EUROPEAN RETELLINGS", 160]
    ].map(([x, y, label, width]) => `<text class="group-heading" x="${x}" y="${y}">${label}</text><line class="group-rule" x1="${x}" y1="${y + 8}" x2="${x + width}" y2="${y + 8}" />`).join("");
    content.innerHTML = `${headings}${edgeMarkup}${nodeMarkup}`;
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
    if (!path) return `<div class="inspector-top"><span class="item-type">RELATIONSHIP ALMANAC</span><span class="node-id">SEED / 01</span></div><h2>Read the relationship.</h2><p class="item-summary">Select a node or connection to inspect its record, the claim, and its evidence. Each line is typed so parallels are not mistaken for transmission.</p><div class="section-caption">START WITH A GUIDED PATH</div>${DATA.guidedPaths.map(item => `<button class="related-item" data-open-guide="${html(item.id)}"><span>${html(item.title)}</span><small>Explore ↗</small></button>`).join("")}<div class="section-caption">THE SEED GRAPH</div><p class="item-summary">18 records across four literary and religious contexts. The source set is intentionally small so the evidence stays visible.</p>`;
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
    if (state.selected.kind === "edge") root.innerHTML = edgeDetail(edgesById.get(state.selected.id));
    else if (state.selected.kind === "path") root.innerHTML = pathDetail();
    else root.innerHTML = nodeDetail(nodesById.get(state.selected.id));
    bindInspectorActions(root);
  }
  function bindInspectorActions(root) {
    $$('[data-related-edge]', root).forEach(button => button.addEventListener("click", () => chooseEdge(button.dataset.relatedEdge)));
    $$('[data-open-guide]', root).forEach(button => button.addEventListener("click", () => activateGuide(button.dataset.openGuide)));
    $$('[data-run-guide]', root).forEach(button => button.addEventListener("click", () => { const path = DATA.guidedPaths.find(item => item.id === button.dataset.runGuide); if (path) { $("#pathFrom").value = path.nodes[0]; $("#pathTo").value = path.nodes.at(-1); $("#pathDialog").showModal(); runPathSearch(path.nodes[0], path.nodes.at(-1)); } }));
  }

  function chooseNode(id) {
    const node = nodesById.get(id); if (!node) return;
    state.selected = { kind: "node", id }; state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
    if (!state.activeTraditions.has(nodeParentTradition(node))) state.activeTraditions.add(nodeParentTradition(node));
    state.collapsedTraditions.delete(nodeParentTradition(node));
    renderAll(); writeUrl(true);
  }
  function toggleCollapse(id) {
    state.collapsedTraditions.has(id) ? state.collapsedTraditions.delete(id) : state.collapsedTraditions.add(id);
    renderAll(); writeUrl(true);
  }
  function chooseEdge(id) {
    const edge = edgesById.get(id); if (!edge) return;
    state.selected = { kind: "edge", id }; state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
    renderAll(); writeUrl(true);
  }
  function activateGuide(id) {
    const path = DATA.guidedPaths.find(item => item.id === id); if (!path) return;
    state.activeTraditions = new Set(traditions.map(node => node.id));
    state.collapsedTraditions.clear();
    state.edgeType = "all"; state.consensus = "all"; state.confidence = 1; state.dateFrom = -3000; state.dateTo = 2026;
    state.view = "graph"; state.selected = { kind: "path", id };
    state.pathNodes = path.nodes.slice(); state.pathEdges = path.edges.slice(); state.pathTitle = path.title; state.pathIntro = path.introduction;
    renderAll(); writeUrl(true); $("#pathFrom").value = path.nodes[0]; $("#pathTo").value = path.nodes.at(-1);
    showToast(`Showing guided path: ${path.title}`);
  }

  function getSearchMatches(query) {
    const term = normalize(query.trim()); if (!term) return [];
    return DATA.nodes.map(node => ({ node, score: Math.max(...[node.name, ...(node.names || [])].map(name => {
      const normalized = normalize(name); return normalized === term ? 3 : normalized.startsWith(term) ? 2 : normalized.includes(term) ? 1 : 0;
    })) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name)).slice(0, 6).map(item => item.node);
  }
  function renderSearch() {
    const query = state.query.trim(); const root = $("#searchResults");
    if (!query) { root.hidden = true; writeUrl(false); return; }
    const matches = getSearchMatches(query);
    root.innerHTML = matches.length ? matches.map(node => `<button class="search-result" data-search-node="${html(node.id)}"><strong>${html(node.name)}</strong><small>${html(typeLabel(node.type))} · ${html(node.dates?.label || "Undated")}</small></button>`).join("") : '<div class="search-result"><strong>No matching records</strong><small>Try another spelling or script.</small></div>';
    root.hidden = false;
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
  function runPathSearch(startId, endId) {
    const paths = findPaths(startId, endId); const root = $("#pathResults");
    if (!paths.length) { root.innerHTML = '<p class="empty-path">No supported path matches the current filters. Try widening the date or confidence range.</p>'; return; }
    root.innerHTML = paths.map((path, index) => {
      const route = path.nodes.map((id, i) => `${i ? "<span>→</span>" : ""}<button data-route-node="${html(id)}">${html(nodesById.get(id).name)}</button>`).join("");
      const edgeNotes = path.edges.map(id => edgesById.get(id)?.rationale || "").filter(Boolean);
      const evidence = [...new Set(path.edges.flatMap(id => edgesById.get(id)?.evidence || []))];
      const consensus = path.edges.length ? Math.max(...path.edges.map(id => ({ consensus: 0, majority: 1, contested: 2, fringe: 3 }[edgesById.get(id).consensus] || 0))) : 0;
      const consensusName = ["Consensus", "Majority view", "Contested", "Fringe"][consensus];
      return `<div class="path-result"><div class="path-result-head"><strong>${index === 0 ? "BEST-SUPPORTED PATH" : `ALTERNATE PATH ${index + 1}`}</strong><span class="consensus-pill ${consensusName === "Contested" || consensusName === "Fringe" ? normalize(consensusName) : ""}">${html(consensusName)}</span></div><div class="path-route">${route}</div><p class="path-result-note">${html(edgeNotes.join(" "))}</p><div class="path-citations">${evidence.map(id => { const source = citation(id); return `<a href="${html(source?.url || "#")}" target="_blank" rel="noreferrer">${html(source?.short || id)} ↗</a>`; }).join("")}</div></div>`;
    }).join("");
    $$('[data-route-node]', root).forEach(button => button.addEventListener("click", () => chooseNode(button.dataset.routeNode)));
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
      const scaleX = 1160 / rect.width, scaleY = 710 / rect.height;
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
    state.activeTraditions = new Set(params.has("traditions") ? params.get("traditions").split(",").filter(id => traditions.some(item => item.id === id)) : traditions.map(item => item.id));
    state.collapsedTraditions = new Set((params.get("collapsed") || "").split(",").filter(id => traditions.some(item => item.id === id)));
    state.query = params.get("q") || ""; $("#searchInput").value = state.query;
    const node = params.get("node"), edge = params.get("edge"), path = params.get("path");
    state.selected = node && nodesById.has(node) ? { kind: "node", id: node } : edge && edgesById.has(edge) ? { kind: "edge", id: edge } : path && DATA.guidedPaths.some(item => item.id === path) ? { kind: "path", id: path } : null;
    const guided = DATA.guidedPaths.find(item => item.id === path);
    state.pathNodes = guided?.nodes.slice() || []; state.pathEdges = guided?.edges.slice() || [];
    renderAll();
    if (state.query) renderSearch();
  }

  function resetState() {
    state.view = "graph"; state.selected = { kind: "node", id: "noah-flood" }; state.query = "";
    state.edgeType = "all"; state.consensus = "all"; state.confidence = 1; state.dateFrom = -3000; state.dateTo = 2026;
    state.activeTraditions = new Set(traditions.map(node => node.id)); state.collapsedTraditions.clear(); state.pathNodes = []; state.pathEdges = []; state.pathTitle = "";
    state.zoom = { x: 0, y: 0, scale: 1 }; $("#searchInput").value = ""; renderAll(); writeUrl(true);
  }
  async function copyShareUrl() {
    writeUrl(false);
    try { await navigator.clipboard.writeText(location.href); showToast("Share link copied. It will reopen this view."); }
    catch { showToast("View link ready in the address bar. Copy it to share."); }
  }

  function exportData(format) {
    const visible = visibleNodes(); const ids = new Set(visible.map(node => node.id));
    const edges = DATA.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edgePassesFilters(edge, true));
    const usedSourceIds = new Set(edges.flatMap(edge => edge.evidence || []));
    visible.forEach(node => (node.sources || []).forEach(id => usedSourceIds.add(id)));
    const licenses = [...usedSourceIds].map(id => ({ source: citation(id)?.title || id, license: citation(id)?.license || "Unknown" }));
    let text, mime, filename;
    if (format === "jsonld") {
      const graph = [
        ...visible.map(node => ({ "@id": `urn:religion-almanac:node:${node.id}`, "@type": "Thing", nodeType: node.type, name: node.name, alternateName: node.names || [], description: node.summary, dateRange: node.dates, inLanguage: node.languages || [], identifier: node.qid || undefined, license: DATA.meta.license })),
        ...edges.map(edge => ({ "@id": `urn:religion-almanac:claim:${edge.id}`, "@type": "urn:religion-almanac:RelationshipClaim", source: `urn:religion-almanac:node:${edge.source}`, target: `urn:religion-almanac:node:${edge.target}`, relationshipType: edge.type, direction: edge.direction, confidence: edge.confidence, consensus: edge.consensus, rationale: edge.rationale, evidence: edge.evidence.map(id => ({ "@id": citation(id)?.url, name: citation(id)?.title })), license: DATA.meta.license }))
      ];
      text = JSON.stringify({ "@context": { "@vocab": "https://schema.org/", "nodeType": "urn:religion-almanac:vocab:nodeType", "relationshipType": "urn:religion-almanac:vocab:relationshipType", "direction": "urn:religion-almanac:vocab:direction", "confidence": "urn:religion-almanac:vocab:confidence", "consensus": "urn:religion-almanac:vocab:consensus", "source": { "@id": "urn:religion-almanac:vocab:source", "@type": "@id" }, "target": { "@id": "urn:religion-almanac:vocab:target", "@type": "@id" }, "evidence": "https://schema.org/citation" }, "@graph": graph, "licenseRegister": licenses }, null, 2);
      mime = "application/ld+json"; filename = "religion-almanac.jsonld";
    } else {
      const evidenceText = ids => ids.map(id => { const source = citation(id); return source ? `${source.short}: ${source.url}` : id; }).join("; ");
      const evidenceLicenses = ids => ids.map(id => { const source = citation(id); return source ? `${source.short}: ${source.license}` : `${id}: unknown`; }).join("; ");
      const rows = [["record_type", "id", "name", "node_type", "source", "target", "edge_type", "direction", "confidence", "consensus", "summary_or_rationale", "evidence_citation_and_url", "almanac_license", "source_license_notes"]];
      visible.forEach(node => rows.push(["node", node.id, node.name, node.type, "", "", "", "", "", "", node.summary, evidenceText(node.sources || []), DATA.meta.license, evidenceLicenses(node.sources || [])]));
      edges.forEach(edge => rows.push(["edge", edge.id, "", "", nodesById.get(edge.source).name, nodesById.get(edge.target).name, edge.type, edge.direction, edge.confidence, edge.consensus, edge.rationale, evidenceText(edge.evidence), DATA.meta.license, evidenceLicenses(edge.evidence)]));
      text = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
      mime = "text/csv;charset=utf-8"; filename = "religion-almanac.csv";
    }
    const blob = new Blob([text], { type: mime }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); showToast(`${filename} exported with evidence and license notes.`);
  }

  function showCitationRegister() {
    const dialog = $("#sourcesDialog");
    if (!dialog) return;
    $("#sourceList").innerHTML = DATA.sources.map(source => `<div class="citation-card"><span class="citation-short">${html(source.short)} · ${html(source.year)}</span><a href="${html(source.url)}" target="_blank" rel="noreferrer">${html(source.title)} ↗</a><small>${html(source.author)} · ${html(source.container)} · ${html(source.publisher)}. ${html(source.license)}</small></div>`).join("");
    dialog.showModal();
  }

  initControls();
  const hasState = new URLSearchParams(location.hash.slice(1)).size > 0;
  if (hasState) restoreFromUrl(); else { renderAll(); writeUrl(false); }
})();
