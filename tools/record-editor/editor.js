/* Local curator editor. It reads release data and only exports proposal files. */
(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const STORAGE_KEY = "religion-almanac-add-record-drafts-v1";
  const CURRENT_KEY = "religion-almanac-add-record-current-v1";
  const apiBase = ($('meta[name="almanac-api-base"]')?.content || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const typeNames = { tradition: "Tradition", text: "Text", story: "Story", work: "Work" };
  const allowedParentTypes = {
    tradition: ["tradition"], text: ["tradition", "text"],
    story: ["tradition", "text"], work: ["tradition", "text"]
  };
  const nameRoles = ["alternate", "transliteration", "historical"];
  const relationTypes = [
    ["direct_textual_dependence", "Direct textual dependence"],
    ["shared_source", "Shared source"], ["motif_parallel", "Motif parallel"],
    ["oral_diffusion", "Oral diffusion"], ["polemical_adaptation", "Polemical adaptation"],
    ["reception_commentary", "Reception / commentary"], ["tradition_lineage", "Tradition lineage"]
  ];
  const dateAspects = [
    ["historical_scope", "Historical scope"], ["textual_formation", "Textual formation"],
    ["surviving_witness", "Surviving witness"], ["composition_or_publication", "Composition or publication"],
    ["first_performance", "First performance"], ["narrative_attestation", "Narrative attestation"],
    ["other", "Other / explain in note"]
  ];
  let graph = null;
  let nodesById = new Map();
  let draftId = "";
  let state = newDraftState();

  function randomHex(bytes = 12) {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return [...buffer].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  async function stableId(kind, identityKey) {
    const input = new TextEncoder().encode(`${kind}\0${identityKey}`);
    const digest = await crypto.subtle.digest("SHA-256", input);
    const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    return `ra:${kind}:${hex.slice(0, 24)}`;
  }

  function newDraftState() {
    return {
      mode: "new", type: "text", label: "", identityKey: "", identityType: "", identityDisambiguator: "", summary: "", languagesText: "",
      classificationUncertain: false, parentId: "", nameVariants: [], dates: [],
      externalIdentifiers: [], externalLinks: [], selectedSources: [], newSources: [],
      newSourceForm: {}, claims: [], duplicateOverrideReason: "", note: "",
      possibleDuplicate: false, duplicateMatches: [], currentStep: 0, aliasTargetId: "", aliasValue: "",
      aliasLanguage: "", aliasScript: "", aliasRole: "alternate", aliasNamespace: "",
      aliasIdentifier: "", aliasReason: "", baseRelease: "", baseChecksum: ""
    };
  }

  function loadDrafts() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch { return {}; }
  }

  function persistDraft() {
    if (!draftId) return;
    state.updatedAt = new Date().toISOString();
    try {
      const drafts = loadDrafts();
      drafts[draftId] = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
      localStorage.setItem(CURRENT_KEY, draftId);
      $("#savedStatus").textContent = `Saved locally · ${new Date().toLocaleTimeString()}`;
      renderDraftPicker();
    } catch {
      $("#savedStatus").textContent = "Browser storage is unavailable; export your proposal before closing.";
    }
  }

  function restoreDraft(id) {
    const saved = loadDrafts()[id];
    if (!saved) return false;
    draftId = id;
    state = { ...newDraftState(), ...saved };
    renderAll();
    persistCurrentId();
    return true;
  }

  function persistCurrentId() {
    try { localStorage.setItem(CURRENT_KEY, draftId); } catch { /* The status message will explain export. */ }
  }

  function createDraft() {
    draftId = randomHex();
    state = newDraftState();
    if (graph) {
      state.baseRelease = graph.dataset_release || "unknown";
      state.baseChecksum = graph.canonical_checksum || "";
    }
    renderAll();
    persistDraft();
  }

  function duplicateDraft() {
    if (state.mode !== "new") return;
    const duplicated = JSON.parse(JSON.stringify(state));
    duplicated.identityKey = "";
    duplicated.identityType = "";
    duplicated.recordId = "";
    duplicated.identityDisambiguator = "";
    duplicated.claims = (duplicated.claims || []).map(claim => ({ ...claim, identityKey: "" }));
    duplicated.currentStep = 0;
    draftId = randomHex();
    state = duplicated;
    renderAll();
    persistDraft();
  }

  function renderDraftPicker() {
    const select = $("#draftPicker");
    const drafts = loadDrafts();
    select.replaceChildren();
    const ids = Object.keys(drafts).sort((a, b) => (drafts[b].updatedAt || "").localeCompare(drafts[a].updatedAt || ""));
    ids.forEach(id => {
      const option = document.createElement("option");
      option.value = id;
      const item = drafts[id];
      option.textContent = `${item.label || "Untitled"} · ${typeNames[item.type] || "Draft"} · ${id.slice(0, 6)}`;
      select.append(option);
    });
    if (!ids.includes(draftId)) {
      const option = document.createElement("option");
      option.value = draftId;
      option.textContent = "Current unsaved draft";
      select.append(option);
    }
    select.value = draftId;
    $("#deleteDraftButton").disabled = ids.length === 0;
    $("#duplicateDraftButton").disabled = state.mode !== "new";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function setStatus(message, stateName = "ready") {
    const status = $("#connectionStatus");
    status.textContent = message;
    status.dataset.state = stateName;
  }

  async function getJson(path) {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { Accept: "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
    return body;
  }

  async function connectGraph() {
    try {
      graph = await getJson("/v1/graph");
      nodesById = new Map(graph.nodes.map(node => [node.id, node]));
      if (!state.baseRelease) state.baseRelease = graph.dataset_release || "unknown";
      if (!state.baseChecksum) state.baseChecksum = graph.canonical_checksum || "";
      setStatus(`Connected to ${graph.dataset_release} · release ${graph.release_id}`, "ready");
      renderParentOptions();
      renderAll();
      persistDraft();
    } catch (error) {
      setStatus(`Graph unavailable: ${error.message}. Start the API and reload this page.`, "error");
      $("#nextButton").disabled = true;
      $("#validateExportButton").disabled = true;
    }
  }

  function renderAll() {
    $("#recordForm").dataset.mode = state.mode;
    $$("input[name='recordType']").forEach(input => {
      input.checked = input.value === state.type;
    });
    $("#preferredLabel").value = state.label || "";
    $("#identityDisambiguator").value = state.identityDisambiguator || "";
    $("#identityDisambiguator").disabled = Boolean(state.identityKey);
    $("#classificationUncertain").checked = Boolean(state.classificationUncertain);
    $("#summary").value = state.summary || "";
    $("#summaryCount").textContent = `${(state.summary || "").length} / 1000`;
    $("#languages").value = state.languagesText || "";
    $("#duplicateReason").value = state.duplicateOverrideReason || "";
    $("#curatorNote").value = state.note || "";
    $("#identityKeyDisplay").textContent = state.identityKey || "Set when this draft is first saved";
    $("#identityLockWarning").hidden = !state.identityKey || !state.identityType || state.identityType === state.type;
    $("#identityQuery").value = state.identityQuery || state.label || "";
    $("#aliasValue").value = state.aliasValue || "";
    $("#aliasLanguage").value = state.aliasLanguage || "";
    $("#aliasScript").value = state.aliasScript || "";
    $("#aliasRole").value = state.aliasRole || "alternate";
    $("#aliasNamespace").value = state.aliasNamespace || "";
    $("#aliasIdentifier").value = state.aliasIdentifier || "";
    $("#aliasReason").value = state.aliasReason || "";
    $("#sourceTitle").value = state.newSourceForm.title || "";
    $("#sourceAuthor").value = state.newSourceForm.author || "";
    $("#sourceContainer").value = state.newSourceForm.container || "";
    $("#sourcePublisher").value = state.newSourceForm.publisher || "";
    $("#sourceYear").value = state.newSourceForm.year || "";
    $("#sourceUrl").value = state.newSourceForm.url || "";
    $("#sourceLicense").value = state.newSourceForm.license || "";
    renderStep();
    renderGuidance();
    renderParentOptions();
    renderNames();
    renderDates();
    renderIdentifiers();
    renderLinks();
    renderSources();
    renderClaims();
    renderAliasPanel();
    renderPreview();
    renderDraftPicker();
  }

  function renderStep() {
    state.currentStep = Math.min(3, Math.max(0, Number(state.currentStep) || 0));
    $$("[data-step-panel]").forEach(panel => { panel.hidden = Number(panel.dataset.stepPanel) !== state.currentStep; });
    $$("#stepNav [data-go-step]").forEach(button => {
      if (Number(button.dataset.goStep) === state.currentStep) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    $("#backButton").disabled = state.currentStep === 0 || state.mode === "update";
    $("#nextButton").hidden = state.currentStep === 3 || state.mode === "update";
    $("#validateExportButton").hidden = state.currentStep !== 3;
    $("#stepLabel").textContent = `Step ${state.currentStep + 1} of 4`;
  }

  function renderGuidance() {
    const guidance = {
      tradition: "Describe the historical scope of this tradition. Note internal diversity and porous boundaries. Use a parent only for an explicit hierarchy.",
      text: "Name the textual corpus, collection, or source text. Put scope, version, or layer in the summary when it matters; use a date aspect to say whether a date describes formation or a surviving witness.",
      story: "Name the narrative or episode as a subject that may appear in multiple texts or retellings. Keep it distinct from a specific textual witness or authored adaptation; use narrative attestation for dates when relevant.",
      work: "Describe the authored, performed, or adapted work and its role in reception. Put creator, attribution, and form in the summary; distinguish composition, first performance, and publication dates."
    };
    const changed = state.identityType && state.identityType !== state.type
      ? "Classification changed after the identity key was set. Review summary, parent, and date aspects; the record ID stays the same. " : "";
    $("#typeGuidance").textContent = changed + (guidance[state.type] || guidance.text);
    $("#identityLockWarning").hidden = !state.identityKey || !state.identityType || state.identityType === state.type;
  }

  function renderParentOptions() {
    const select = $("#parentId");
    if (!select) return;
    const current = state.parentId || "";
    select.replaceChildren(new Option("No parent", ""));
    const allowed = new Set(allowedParentTypes[state.type] || ["tradition", "text"]);
    for (const node of graph?.nodes || []) {
      if (!allowed.has(node.type)) continue;
      select.append(new Option(`${node.label} · ${typeNames[node.type] || node.type}`, node.id));
    }
    select.value = current;
  }

  function rowHeader(title, index, collection) {
    return `<div class="row-top"><span>${escapeHtml(title)} ${index + 1}</span><button class="remove-row" type="button" data-remove-row="${collection}" data-index="${index}">Remove</button></div>`;
  }

  function renderNames() {
    const root = $("#nameRows");
    root.innerHTML = state.nameVariants.map((item, index) => `<div class="repeat-row">${rowHeader("Name", index, "nameVariants")}<div class="two-columns">
      <label><span class="field-label">Written form</span><input data-list="nameVariants" data-index="${index}" data-key="value" value="${escapeHtml(item.value)}" maxlength="240" /></label>
      <label><span class="field-label">Language</span><input data-list="nameVariants" data-index="${index}" data-key="language" value="${escapeHtml(item.language)}" maxlength="80" /></label>
      <label><span class="field-label">Script</span><input data-list="nameVariants" data-index="${index}" data-key="script" value="${escapeHtml(item.script)}" maxlength="80" /></label>
      <label><span class="field-label">Role</span><select data-list="nameVariants" data-index="${index}" data-key="role">${nameRoles.map(role => `<option value="${role}" ${item.role === role ? "selected" : ""}>${role[0].toUpperCase()}${role.slice(1)}</option>`).join("")}</select></label>
      </div></div>`).join("");
  }

  function renderDates() {
    const root = $("#dateRows");
    const sourceOptions = getSourceOptions();
    root.innerHTML = state.dates.map((item, index) => `<div class="repeat-row date-row">${rowHeader("Date assertion", index, "dates")}
      <div class="three-columns"><label><span class="field-label">Aspect</span><select data-list="dates" data-index="${index}" data-key="aspect">${dateAspects.map(([value, label]) => `<option value="${value}" ${item.aspect === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label><span class="field-label">Start year</span><input type="number" data-list="dates" data-index="${index}" data-key="start" value="${escapeHtml(item.start)}" placeholder="Open" /></label>
      <label><span class="field-label">End year</span><input type="number" data-list="dates" data-index="${index}" data-key="end" value="${escapeHtml(item.end)}" placeholder="Open" /></label></div>
      <div class="date-bottom"><label><span class="field-label">Precision</span><select data-list="dates" data-index="${index}" data-key="precision">${["exact", "approximate", "century", "period", "unknown"].map(value => `<option value="${value}" ${item.precision === value ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}</select></label>
      <label><span class="field-label">Display label</span><input data-list="dates" data-index="${index}" data-key="displayLabel" value="${escapeHtml(item.displayLabel)}" placeholder="For example, c. 500 BCE" maxlength="160" /></label></div>
      <label><span class="field-label">Uncertainty note</span><textarea data-list="dates" data-index="${index}" data-key="uncertaintyNote" rows="2" maxlength="1000">${escapeHtml(item.uncertaintyNote)}</textarea></label>
      <label><span class="field-label">Date evidence</span><select class="evidence-select" multiple size="${Math.min(4, Math.max(2, sourceOptions.length))}" data-list="dates" data-index="${index}" data-key="evidenceIds">${sourceOptions.map(source => `<option value="${source.id}" ${item.evidenceIds.includes(source.id) ? "selected" : ""}>${escapeHtml(source.title)}</option>`).join("")}</select></label>
      </div>`).join("");
  }

  function renderIdentifiers() {
    $("#identifierRows").innerHTML = state.externalIdentifiers.map((item, index) => `<div class="repeat-row">${rowHeader("Identifier", index, "externalIdentifiers")}<div class="two-columns">
      <label><span class="field-label">Namespace</span><input data-list="externalIdentifiers" data-index="${index}" data-key="namespace" value="${escapeHtml(item.namespace)}" maxlength="100" placeholder="wikidata" /></label>
      <label><span class="field-label">Value</span><input data-list="externalIdentifiers" data-index="${index}" data-key="value" value="${escapeHtml(item.value)}" maxlength="240" /></label>
      </div><button type="button" class="outline-button" data-check-identifier="${index}">Check this ID</button><div class="inline-status" id="identifierMatch-${index}" role="status"></div></div>`).join("");
  }

  function renderLinks() {
    $("#linkRows").innerHTML = state.externalLinks.map((item, index) => `<div class="repeat-row">${rowHeader("Link", index, "externalLinks")}<div class="two-columns">
      <label><span class="field-label">Label</span><input data-list="externalLinks" data-index="${index}" data-key="label" value="${escapeHtml(item.label)}" maxlength="120" /></label>
      <label><span class="field-label">URL</span><input type="url" data-list="externalLinks" data-index="${index}" data-key="url" value="${escapeHtml(item.url)}" maxlength="1000" placeholder="https://…" /></label>
      </div></div>`).join("");
  }

  function getSourceOptions() {
    return [...state.selectedSources, ...state.newSources].filter((source, index, values) =>
      values.findIndex(value => value.id === source.id) === index
    );
  }

  function renderSources() {
    const root = $("#selectedSources");
    const selected = getSourceOptions();
    if (!selected.length) {
      root.innerHTML = '<p class="field-help">No sources attached yet. Unsourced drafts can be reviewed, but cannot be published.</p>';
      return;
    }
    root.innerHTML = selected.map(source => `<div class="selected-card"><div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.author || "No author")} · ${escapeHtml(source.year || source.publication_year || "n.d.")} · ${source.isNew ? "NEW PROPOSAL" : escapeHtml(source.id)}</small><small>${escapeHtml(source.license || "")}</small></div><button type="button" class="remove-row" data-remove-source="${source.id}">Remove</button></div>`).join("");
  }

  function renderClaims() {
    const nodes = (graph?.nodes || []).filter(node => node.id !== (state.recordId || ""));
    $("#claimRows").innerHTML = state.claims.map((claim, index) => `<div class="repeat-row claim-row">${rowHeader("Influence claim", index, "claims")}
      <div class="claim-fields">
        <label><span class="field-label">Relationship type</span><select data-list="claims" data-index="${index}" data-key="relationType">${relationTypes.map(([value, label]) => `<option value="${value}" ${claim.relationType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label><span class="field-label">Other record</span><select data-list="claims" data-index="${index}" data-key="otherId"><option value="">Choose a record</option>${nodes.map(node => `<option value="${node.id}" ${claim.otherId === node.id ? "selected" : ""}>${escapeHtml(node.label)} · ${typeNames[node.type] || node.type}</option>`).join("")}</select></label>
        <label><span class="field-label">Direction</span><select data-list="claims" data-index="${index}" data-key="newIsSubject"><option value="true" ${claim.newIsSubject ? "selected" : ""}>New record → other record</option><option value="false" ${!claim.newIsSubject ? "selected" : ""}>Other record → new record</option></select></label>
        <label><span class="field-label">Direction certainty</span><select data-list="claims" data-index="${index}" data-key="direction"><option value="certain" ${claim.direction === "certain" ? "selected" : ""}>Certain</option><option value="probable" ${claim.direction === "probable" ? "selected" : ""}>Probable</option><option value="unknown" ${claim.direction === "unknown" ? "selected" : ""}>Unknown</option></select></label>
        <label><span class="field-label">Confidence</span><select data-list="claims" data-index="${index}" data-key="confidence"><option value="" ${claim.confidence === null ? "selected" : ""}>Not rated</option>${[1, 2, 3, 4, 5].map(value => `<option value="${value}" ${Number(claim.confidence) === value ? "selected" : ""}>${value} / 5</option>`).join("")}</select></label>
        <label><span class="field-label">Consensus</span><select data-list="claims" data-index="${index}" data-key="consensus">${["consensus", "majority", "contested", "fringe"].map(value => `<option value="${value}" ${claim.consensus === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label><span class="field-label">Date / period label</span><input data-list="claims" data-index="${index}" data-key="dateLabel" value="${escapeHtml(claim.dateLabel || "")}" maxlength="160" placeholder="Optional; for example, late antiquity" /></label>
      </div>
      <label><span class="field-label">Rationale</span><textarea data-list="claims" data-index="${index}" data-key="rationale" rows="2" maxlength="1000">${escapeHtml(claim.rationale)}</textarea></label>
      <label><span class="field-label">Evidence sources</span><select class="evidence-select" multiple size="${Math.min(4, Math.max(2, getSourceOptions().length))}" data-list="claims" data-index="${index}" data-key="evidenceIds">${getSourceOptions().map(source => `<option value="${source.id}" ${claim.evidenceIds.includes(source.id) ? "selected" : ""}>${escapeHtml(source.title)}</option>`).join("")}</select></label>
      ${claim.evidenceIds.length ? "" : '<p class="claim-note">No evidence selected. This draft claim cannot be published without supporting sources.</p>'}
      </div>`).join("");
  }

  function renderAliasPanel() {
    const panel = $("#aliasPanel");
    panel.hidden = state.mode !== "update";
    if (state.mode === "update") {
      const target = nodesById.get(state.aliasTargetId);
      $("#aliasTarget").innerHTML = target
        ? `${escapeHtml(target.label)} <small>${escapeHtml(typeNames[target.type] || target.type)} · ${escapeHtml(target.id)}</small>`
        : "Selected canonical record is unavailable in this release.";
      $("#nextButton").hidden = true;
    }
  }

  function setStep(step) {
    state.currentStep = step;
    renderStep();
    if (step === 3) renderPreview();
    persistDraft();
    const heading = $(`[data-step-panel="${step}"] h2`);
    heading?.focus?.({ preventScroll: true });
  }

  function showErrors(targetSelector, messages) {
    const box = $(targetSelector);
    box.replaceChildren();
    if (!messages.length) { box.hidden = true; return; }
    const list = document.createElement("ul");
    messages.forEach(message => {
      const item = document.createElement("li");
      item.textContent = message;
      list.append(item);
    });
    box.append(list);
    box.hidden = false;
    box.focus?.();
  }

  function validateStep(step) {
    const errors = [];
    if (step === 0) {
      if (state.mode === "update") {
        if (!state.aliasValue.trim() && !state.aliasIdentifier.trim()) errors.push("Enter a missing name or external identifier.");
        if (!state.aliasReason.trim()) errors.push("Explain why this name or identifier belongs to the selected record.");
        showErrors("#identityErrors", errors);
        return errors;
      }
      if (!Object.hasOwn(typeNames, state.type)) errors.push("Choose Tradition, Text, Story, or Work.");
      if (!state.label.trim()) errors.push("Enter a preferred label.");
      if (!graph?.canonical_checksum) errors.push("The active graph release did not provide a canonical checksum.");
      const normalizedLabel = state.label.normalize("NFC").trim().toLocaleLowerCase();
      const sameIdentity = (state.duplicateMatches || []).some(id => {
        const node = nodesById.get(id);
        return node && node.type === state.type && node.label.normalize("NFC").trim().toLocaleLowerCase() === normalizedLabel;
      });
      if (sameIdentity && !state.identityDisambiguator.trim()) {
        errors.push("A same-type record with this exact label already exists. Add a stable identity disambiguator or propose a name/identifier update to the existing record.");
      }
      showErrors("#identityErrors", errors);
      return errors;
    }
    if (step === 1) {
      if (!state.summary.trim()) errors.push("Add a neutral summary.");
      if (state.summary.length > 1000) errors.push("Keep the summary within 1,000 characters.");
      if (state.parentId) {
        const parent = nodesById.get(state.parentId);
        const allowed = allowedParentTypes[state.type] || ["tradition", "text"];
        if (parent && !allowed.includes(parent.type)) errors.push(`A ${state.type} cannot be part of a ${parent.type} under the current hierarchy rules.`);
      }
      for (const [index, date] of state.dates.entries()) {
        const start = date.start === "" ? null : Number(date.start);
        const end = date.end === "" ? null : Number(date.end);
        if (start === 0 || end === 0) errors.push(`Date ${index + 1}: historical year zero is not used.`);
        if (start !== null && end !== null && start > end) errors.push(`Date ${index + 1}: start year must be earlier than or equal to end year.`);
        if (!date.aspect) errors.push(`Date ${index + 1}: choose what the date describes.`);
      }
      const aspects = state.dates.map(item => item.aspect);
      if (new Set(aspects).size !== aspects.length) errors.push("Use a different date aspect for each assertion; this release allows one date per aspect.");
      showErrors("#describeErrors", errors);
      return errors;
    }
    if (step === 2) {
      for (const [index, source] of state.newSources.entries()) {
        if (!source.license?.trim()) errors.push(`New source ${index + 1}: add its license or terms.`);
        if (/unknown|unverified|to be confirmed|\btbd\b/i.test(source.license || "")) errors.push(`New source ${index + 1}: resolve the license or terms before proposing it.`);
      }
      for (const [index, item] of state.externalIdentifiers.entries()) {
        if (Boolean(item.namespace.trim()) !== Boolean(item.value.trim())) errors.push(`Identifier ${index + 1}: enter both namespace and value.`);
      }
      for (const [index, link] of state.externalLinks.entries()) {
        if (Boolean(link.label.trim()) !== Boolean(link.url.trim())) errors.push(`External link ${index + 1}: enter both label and URL.`);
        else if (link.url && !validUrl(link.url)) errors.push(`External link ${index + 1}: enter a valid absolute URL.`);
      }
      for (const [index, claim] of state.claims.entries()) {
        if (!claim.otherId) errors.push(`Claim ${index + 1}: choose the other record.`);
        if (claim.otherId && claim.otherId === state.recordId) errors.push(`Claim ${index + 1}: the endpoints must differ.`);
      }
      showErrors("#sourceErrors", errors);
      return errors;
    }
    if (step === 3) {
      if (state.mode === "new" && state.possibleDuplicate && !state.duplicateOverrideReason.trim()) errors.push("Explain why you are continuing despite the possible duplicate match.");
      if (state.mode === "update" && (!state.aliasValue.trim() && !state.aliasIdentifier.trim())) errors.push("Add a name or identifier to the record change.");
      if (state.mode === "update" && !state.aliasReason.trim()) errors.push("Explain why this change belongs to the selected record.");
      showErrors("#reviewErrors", errors);
      return errors;
    }
    return errors;
  }

  function validUrl(value) {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol); }
    catch { return false; }
  }

  function renderPreview() {
    const root = $("#recordPreview");
    root.replaceChildren();
    if (state.mode === "update") {
      const target = nodesById.get(state.aliasTargetId);
      const main = document.createElement("div");
      main.className = "preview-main";
      main.innerHTML = `<span class="item-type">Existing record update · ${escapeHtml(typeNames[target?.type] || target?.type || "Record")}</span><h3></h3><p></p>`;
      main.querySelector("h3").textContent = target?.label || "Unknown record";
      main.querySelector("p").textContent = state.aliasReason || "No reason provided.";
      root.append(main,
        previewCell("New name", state.aliasValue || "None"),
        previewCell("New identifier", state.aliasIdentifier ? `${state.aliasNamespace}: ${state.aliasIdentifier}` : "None"),
        previewCell("Does not assert", "A new entity or a scholarly influence claim."));
      renderReviewFlags();
      return;
    }
    const main = document.createElement("div");
    main.className = "preview-main";
    const type = document.createElement("span");
    type.className = "item-type";
    type.textContent = `${typeNames[state.type] || "Record"} · DRAFT`;
    const heading = document.createElement("h3"); heading.textContent = state.label || "Untitled record";
    const summary = document.createElement("p"); summary.textContent = state.summary || "No summary yet.";
    main.append(type, heading, summary);
    root.append(main);
    const parent = nodesById.get(state.parentId);
    const sourceSummary = getSourceOptions().map(source =>
      `${source.title}${source.author ? ` — ${source.author}` : ""}${source.container ? ` · ${source.container}` : ""}${source.publisher ? ` · ${source.publisher}` : ""}${source.year || source.publication_year ? ` · ${source.year || source.publication_year}` : ""}${source.url ? ` · ${source.url}` : ""} · ${source.license || "license/terms not listed"} · ${source.id}`
    ).join("; ") || "No bibliographic source attached; draft is unsourced.";
    const dateSummary = state.dates.map(date => {
      const evidence = date.evidenceIds.map(id => getSourceOptions().find(source => source.id === id)?.title || id);
      return `${formatDateLabel(date)} · precision ${date.precision}${date.uncertaintyNote ? ` · uncertainty: ${date.uncertaintyNote}` : ""}${evidence.length ? ` · evidence: ${evidence.join(", ")}` : " · no date evidence selected"}`;
    }).join("; ") || "No date assertions";
    const claimSummary = state.claims.map(claim => {
      const other = nodesById.get(claim.otherId)?.label || "Other record not selected";
      const direction = claim.newIsSubject ? `${state.label || "New record"} → ${other}` : `${other} → ${state.label || "New record"}`;
      const evidence = claim.evidenceIds.map(id => getSourceOptions().find(source => source.id === id)?.title || id);
      return `${claim.relationType}: ${direction}; ${claim.direction} direction; confidence ${claim.confidence || "not rated"}; ${claim.consensus}; ${claim.dateLabel || "no date label"}; rationale: ${claim.rationale || "none"}; evidence: ${evidence.join(", ") || "none"}`;
    }).join("; ") || "No influence claims proposed";
    root.append(
      previewCell("Context / part of", parent?.label || "No parent selected"),
      previewCell("Languages", (state.languagesText || "Not specified").split(",").map(value => value.trim()).filter(Boolean).join(", ") || "Not specified"),
      previewCell("Dates, uncertainty & evidence", dateSummary),
      previewCell("Bibliography & license/terms", sourceSummary),
      previewCell("Other names", state.nameVariants.filter(item => item.value.trim()).map(item => `${item.value}${item.language ? ` [${item.language}]` : ""}${item.script ? ` (${item.script})` : ""} · ${item.role}`).join("; ") || "None"),
      previewCell("External identifiers", canonicalExternalIds().map(item => `${item.namespace}:${item.value}`).join("; ") || "None"),
      previewCell("External links", canonicalLinks().map(item => `${item.label}: ${item.url}`).join("; ") || "None"),
      previewCell("Influence claims & evidence", claimSummary),
      previewCell("Does not assert", state.claims.length ? "A parent choice is not an influence claim; each listed claim needs its own review." : "No transmission or influence relationship."));
    renderReviewFlags();
  }

  function reviewWarnings() {
    const warnings = [];
    if (state.classificationUncertain) warnings.push("Record type is marked uncertain and needs reviewer confirmation.");
    if (state.possibleDuplicate) warnings.push("Name or identifier search found possible matches; the curator's distinction reason is included for review.");
    if (state.mode === "new" && getSourceOptions().length === 0) warnings.push("This node has no bibliographic source and will remain an unsourced draft.");
    for (const [index, date] of state.dates.entries()) {
      const labelYear = (date.displayLabel || "").match(/\b(\d{1,5})\s*(BCE|BC|CE|AD)\b/i);
      if (labelYear) {
        const expected = /BCE|BC/i.test(labelYear[2]) ? -Number(labelYear[1]) : Number(labelYear[1]);
        const lower = date.start === "" ? null : Number(date.start);
        const upper = date.end === "" ? null : Number(date.end);
        if ((lower !== null && expected < lower) || (upper !== null && expected > upper)) {
          warnings.push(`Date ${index + 1}: display label may conflict with numeric bounds; check the year and range.`);
        }
      }
    }
    for (const [index, claim] of state.claims.entries()) {
      if (!claim.evidenceIds.length) warnings.push(`Claim ${index + 1} has no evidence and cannot be published in this state.`);
      if (claim.consensus === "contested" && claim.evidenceIds.length < 2) warnings.push(`Contested claim ${index + 1} needs at least two citations and distinct reviewers before publication.`);
    }
    return [...new Set(warnings)];
  }

  function renderReviewFlags() {
    const root = $("#reviewFlags");
    if (!root) return;
    root.replaceChildren();
    const warnings = reviewWarnings();
    root.hidden = warnings.length === 0;
    if (!warnings.length) return;
    const heading = document.createElement("strong");
    heading.textContent = "Reviewer flags";
    const list = document.createElement("ul");
    warnings.forEach(warning => { const item = document.createElement("li"); item.textContent = warning; list.append(item); });
    root.append(heading, list);
  }

  function previewCell(label, value) {
    const cell = document.createElement("div"); cell.className = "preview-cell";
    const title = document.createElement("span"); title.textContent = label;
    const content = document.createElement("strong"); content.textContent = value;
    cell.append(title, content); return cell;
  }

  function formatDateLabel(date) {
    const year = value => value === "" ? null : Number(value);
    const start = year(date.start), end = year(date.end);
    const format = value => value === null ? "open" : `${Math.abs(value)} ${value < 0 ? "BCE" : "CE"}`;
    if (start === null && end === null) return `${date.aspect}: date unknown`;
    const bounds = start === end ? format(start) : `${format(start)}–${format(end)}`;
    return date.displayLabel ? `${date.displayLabel} · numeric bounds ${bounds}` : bounds;
  }

  async function showNodeDetails(node) {
    const root = $("#matchDetails");
    root.replaceChildren();
    root.hidden = false;
    const loading = document.createElement("p");
    loading.className = "field-help";
    loading.textContent = `Loading current details for ${node.label}…`;
    root.append(loading);
    try {
      const result = await getJson(`/v1/nodes/${encodeURIComponent(node.id)}`);
      const current = result.node;
      root.replaceChildren();
      const heading = document.createElement("h3"); heading.textContent = `${current.label} · ${typeNames[current.type] || current.type}`;
      const summary = document.createElement("p"); summary.textContent = current.summary || "No summary is recorded.";
      const metadata = document.createElement("p");
      const parent = nodesById.get(current.parent_id);
      metadata.textContent = `${current.status} · ${current.id}${parent ? ` · part of ${parent.label}` : " · no parent"}`;
      const names = document.createElement("p");
      names.textContent = `Other names: ${(result.names || []).map(item => `${item.value}${item.language ? ` [${item.language}]` : ""}`).join("; ") || "none"}`;
      const identifiers = document.createElement("p");
      identifiers.textContent = `External identifiers: ${(result.external_identifiers || []).map(item => `${item.namespace}:${item.value}`).join("; ") || "none"}`;
      const dates = document.createElement("p");
      dates.textContent = `Dates: ${(result.date_assertions || []).map(item => `${item.display_label || item.aspect}${item.uncertainty_note ? ` · ${item.uncertainty_note}` : ""}`).join("; ") || "none"}`;
      const sources = document.createElement("p");
      sources.textContent = `Sources: ${(result.sources || []).map(item => `${item.title}${item.license ? ` (${item.license})` : ""}`).join("; ") || "none"}`;
      root.append(heading, summary, metadata, names, identifiers, dates, sources);
    } catch (error) {
      root.replaceChildren();
      const message = document.createElement("p");
      message.className = "field-help";
      message.textContent = `Could not load current record details: ${error.message}`;
      root.append(message);
    }
  }

  function addRow(collection) {
    const defaults = {
      nameVariants: { value: "", language: "", script: "", role: "alternate" },
      dates: { aspect: state.type === "tradition" ? "historical_scope" : state.type === "story" ? "narrative_attestation" : state.type === "work" ? "composition_or_publication" : "textual_formation", start: "", end: "", precision: "unknown", displayLabel: "", uncertaintyNote: "", evidenceIds: [] },
      externalIdentifiers: { namespace: "", value: "" },
      externalLinks: { label: "", url: "" }
    };
    if (!defaults[collection]) return;
    state[collection].push(defaults[collection]);
    persistDraft(); renderAll();
  }

  async function searchNodes(query) {
    const status = $("#matchStatus");
    const results = $("#matchList");
    const value = query.trim();
    results.replaceChildren();
    $("#matchDetails").replaceChildren();
    $("#matchDetails").hidden = true;
    if (!value) { status.textContent = "Enter a name or identifier to search."; return; }
    status.textContent = "Searching the active release…";
    try {
      const result = await getJson(`/v1/search?q=${encodeURIComponent(value)}&limit=12`);
      if (!result.results.length) { status.textContent = "No exact or likely name/identifier matches in this release."; state.possibleDuplicate = false; state.duplicateMatches = []; persistDraft(); return; }
      status.textContent = `${result.results.length} possible match${result.results.length === 1 ? "" : "es"}. Similarity is a review prompt, not evidence of identity.`;
      state.possibleDuplicate = true;
      state.duplicateMatches = [...new Set(result.results.map(match => match.node_id))];
      for (const match of result.results) {
        const node = nodesById.get(match.node_id);
        if (!node) continue;
        const card = document.createElement("article"); card.className = "match-card";
        const description = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = node.label;
        const dates = (node.dates || []).map(item => item.label).filter(Boolean).join(" · ") || "Dates not listed";
        const parent = nodesById.get(node.parent_id);
        const detail = document.createElement("small");
        const matched = match.matched_identifier
          ? `${match.matched_identifier.namespace}:${match.matched_identifier.value}`
          : `Matched name: ${match.matched_name || value}`;
        detail.textContent = `${typeNames[node.type] || node.type} · ${dates} · ${parent ? `part of ${parent.label}` : "top level"} · ${matched}`;
        description.append(title, detail);
        const actions = document.createElement("div"); actions.className = "match-actions";
        const open = document.createElement("button"); open.type = "button"; open.textContent = "Open in Explore";
        open.addEventListener("click", () => window.open(`http://127.0.0.1:5173/#node=${encodeURIComponent(node.id)}`, "_blank", "noopener"));
        const detailsButton = document.createElement("button"); detailsButton.type = "button"; detailsButton.textContent = "View current details";
        detailsButton.addEventListener("click", () => showNodeDetails(node));
        const update = document.createElement("button"); update.type = "button"; update.textContent = "Propose missing name / ID";
        update.addEventListener("click", () => startAliasProposal(node));
        actions.append(detailsButton, open, update); card.append(description, actions); results.append(card);
      }
      persistDraft();
    } catch (error) {
      status.textContent = `Search failed: ${error.message}. The absence of results cannot be confirmed.`;
      status.dataset.state = "error";
    }
  }

  function startAliasProposal(node) {
    state.mode = "update";
    state.aliasTargetId = node.id;
    state.aliasValue = "";
    state.aliasNamespace = "";
    state.aliasIdentifier = "";
    state.aliasReason = "";
    state.currentStep = 0;
    renderAll();
    $("#aliasValue").focus();
    persistDraft();
  }

  function cancelAliasProposal() {
    state.mode = "new";
    state.aliasTargetId = "";
    state.currentStep = 0;
    renderAll();
    persistDraft();
  }

  async function searchSources() {
    const root = $("#sourceMatches"); root.replaceChildren();
    const query = $("#sourceSearch").value.trim();
    const status = document.createElement("p"); status.className = "field-help"; status.textContent = "Searching the active release…"; root.append(status);
    try {
      const result = await getJson(`/v1/sources?q=${encodeURIComponent(query)}&limit=30`);
      root.replaceChildren();
      if (!result.results.length) { root.innerHTML = '<p class="field-help">No sources matched. Add a bibliographic source below if needed.</p>'; return; }
      for (const item of result.results) {
        const alreadySelected = getSourceOptions().some(source => source.id === item.id);
        const card = document.createElement("article"); card.className = "match-card";
        const description = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = item.title;
        const detail = document.createElement("small"); detail.textContent = `${item.author || "No author"} · ${item.publication_year || "n.d."} · ${item.license || "License not listed"}`;
        description.append(title, detail);
        const button = document.createElement("button"); button.type = "button"; button.textContent = alreadySelected ? "Added" : "Add source"; button.disabled = alreadySelected;
        button.addEventListener("click", () => {
          state.selectedSources.push({ id: item.id, title: item.title, author: item.author, container: item.container,
            publisher: item.publisher, year: item.publication_year, url: item.url, license: item.license, status: item.status });
          state.selectedSources = state.selectedSources.filter((source, index, values) => values.findIndex(other => other.id === source.id) === index);
          persistDraft(); renderSources(); renderDates(); renderClaims();
          button.textContent = "Added"; button.disabled = true;
        });
        card.append(description, button); root.append(card);
      }
    } catch (error) {
      root.replaceChildren(); const message = document.createElement("p"); message.className = "field-help";
      message.textContent = `Source search failed: ${error.message}. You can still add a bibliographic source if you know its license/terms.`; root.append(message);
    }
  }

  async function addNewSource() {
    const form = state.newSourceForm;
    const title = (form.title || "").trim();
    const license = (form.license || "").trim();
    if (!title || !license) { showErrors("#sourceErrors", ["A new source needs a title and license/terms."]); return; }
    if (/unknown|unverified|to be confirmed|\btbd\b/i.test(license)) {
      showErrors("#sourceErrors", ["Resolve the source license/terms before adding it."]); return;
    }
    if (form.url && !validUrl(form.url)) { showErrors("#sourceErrors", ["Source URL must be an absolute HTTP or HTTPS link."]); return; }
    const identityKey = `source|${(form.author || "").trim()}|${title}|${(form.container || "").trim()}|${(form.publisher || "").trim()}|${(form.year || "").trim()}|${(form.url || "").trim()}`;
    const source = {
      id: await stableId("source", identityKey), identity_key: identityKey, title,
      author: (form.author || "").trim() || null, container: (form.container || "").trim() || null,
      publisher: (form.publisher || "").trim() || null, year: (form.year || "").trim() || null,
      url: (form.url || "").trim() || null, license, status: "draft", isNew: true
    };
    const collision = getSourceOptions().find(item => item.id === source.id);
    if (collision) { showErrors("#sourceErrors", ["This source identity already appears in the proposal."]); return; }
    delete source.isNew;
    state.newSources.push({ ...source, isNew: true });
    state.newSourceForm = {};
    ["#sourceTitle", "#sourceAuthor", "#sourceContainer", "#sourcePublisher", "#sourceYear", "#sourceUrl", "#sourceLicense"].forEach(selector => { $(selector).value = ""; });
    $("#newSourceForm")?.reset?.();
    persistDraft(); renderSources(); renderDates(); renderClaims(); showErrors("#sourceErrors", []);
  }

  async function searchIdentifier(index) {
    const item = state.externalIdentifiers[index];
    const status = $(`#identifierMatch-${index}`);
    if (!item?.namespace.trim() || !item?.value.trim()) { status.textContent = "Enter both the namespace and value first."; return; }
    status.textContent = "Checking the active release…";
    try {
      const result = await getJson(`/v1/search?q=${encodeURIComponent(`${item.namespace}:${item.value}`)}&limit=10`);
      const matches = result.results.filter(record => record.matched_identifier?.namespace.toLowerCase() === item.namespace.trim().toLowerCase()
        && record.matched_identifier?.value === item.value.trim());
      if (matches.length) {
        state.possibleDuplicate = true;
        status.textContent = `Already assigned to ${matches.map(match => match.label).join(", ")}. Choose “Propose missing name / ID” from the matched record or explain why this is distinct.`;
        persistDraft();
      } else status.textContent = "No exact identifier match in this release.";
    } catch (error) { status.textContent = `Identifier lookup failed: ${error.message}.`; }
  }

  async function checkIdentifiersBeforeExport() {
    const errors = [];
    for (const identifier of canonicalExternalIds()) {
      const query = `${identifier.namespace}:${identifier.value}`;
      try {
        const result = await getJson(`/v1/search?q=${encodeURIComponent(query)}&limit=10`);
        const match = result.results.find(item => item.matched_identifier &&
          item.matched_identifier.namespace.toLowerCase() === identifier.namespace.toLowerCase() &&
          item.matched_identifier.value === identifier.value);
        if (match) errors.push(`${query} is already assigned to ${match.label} (${match.node_id}). Use that record's missing-name/ID proposal if this is the same entity.`);
      } catch (error) {
        errors.push(`Could not check ${query} against the active release: ${error.message}. Resolve the lookup before export.`);
      }
    }
    return errors;
  }

  function canonicalNames() {
    return state.nameVariants.filter(item => item.value.trim()).map(item => ({
      value: item.value.trim(), language: item.language.trim() || null, script: item.script.trim() || null, role: item.role
    }));
  }

  function canonicalExternalIds() {
    return state.externalIdentifiers.filter(item => item.namespace.trim() && item.value.trim()).map(item => ({
      namespace: item.namespace.trim(), value: item.value.trim()
    }));
  }

  function canonicalLinks() {
    return state.externalLinks.filter(item => item.label.trim() && item.url.trim()).map(item => ({ label: item.label.trim(), url: item.url.trim() }));
  }

  async function buildCanonicalRecord() {
    if (!state.identityKey) {
      const disambiguator = state.identityDisambiguator.trim();
      state.identityKey = `node|${state.type}|${state.label.normalize("NFC").trim()}${disambiguator ? `|${disambiguator.normalize("NFC")}` : ""}`;
      state.identityType = state.type;
      $("#identityKeyDisplay").textContent = state.identityKey;
    }
    const id = await stableId("node", state.identityKey);
    state.recordId = id;
    const selected = getSourceOptions();
    const sourceIds = selected.map(source => source.id);
    const dates = [];
    for (const item of state.dates) {
      if (!item.aspect) continue;
      dates.push({
        id: await stableId("date", `${id}|${item.aspect}`), aspect: item.aspect,
        start_year: item.start === "" ? null : Number(item.start),
        end_year: item.end === "" ? null : Number(item.end), year_convention: "historical_bce_ce",
        precision: item.precision, display_label: item.displayLabel.trim() || null,
        uncertainty_note: item.uncertaintyNote.trim() || null,
        evidence_source_ids: [...new Set(item.evidenceIds)]
      });
    }
    return {
      id, identity_key: state.identityKey, type: state.type, label: state.label.normalize("NFC").trim(),
      name_variants: canonicalNames(), summary: state.summary.trim() || null, status: "draft",
      parent_id: state.parentId || null, hierarchy_relation: state.parentId ? "part_of" : null,
      hierarchy_evidence_source_ids: state.parentId ? sourceIds : [],
      evidence_status: sourceIds.length ? "sourced" : "unsourced", source_ids: sourceIds,
      languages: [...new Set(state.languagesText.split(",").map(value => value.trim()).filter(Boolean))],
      external_identifiers: canonicalExternalIds(), external_links: canonicalLinks(), date_assertions: dates
    };
  }

  async function buildCanonicalClaims(record) {
    const claims = [];
    for (const item of state.claims) {
      if (!item.otherId) continue;
      const subjectId = item.newIsSubject ? record.id : item.otherId;
      const objectId = item.newIsSubject ? item.otherId : record.id;
      if (!item.identityKey) item.identityKey = `claim|${subjectId}|${item.relationType}|${objectId}|${randomHex(6)}`;
      claims.push({
        id: await stableId("claim", item.identityKey), identity_key: item.identityKey,
        subject_id: subjectId, object_id: objectId, relation_type: item.relationType,
        direction: item.direction, confidence: item.confidence === "" || item.confidence === null ? null : Number(item.confidence),
        consensus: item.consensus || null, rationale: item.rationale.trim() || null, date_label: item.dateLabel?.trim() || null,
        date_assertions: [], inferred: false, status: "draft",
        evidence_status: item.evidenceIds.length ? "sourced" : "unsourced",
        evidence_source_ids: [...new Set(item.evidenceIds)]
      });
    }
    return claims;
  }

  async function buildProposal() {
    const notes = state.mode === "update" ? {
      classification_uncertain: false,
      duplicate_override_reason: null,
      note: null,
      warnings: []
    } : {
      classification_uncertain: Boolean(state.classificationUncertain),
      duplicate_override_reason: state.duplicateOverrideReason.trim() || null,
      note: state.note.trim() || null,
      warnings: reviewWarnings()
    };
    const proposal = {
      proposal_version: "1.0.0", proposal_id: randomHex(),
      base_release: state.baseRelease || graph?.dataset_release || "unknown",
      base_checksum: state.baseChecksum || graph?.canonical_checksum || "",
      created_at: new Date().toISOString(), record: null, record_changes: [],
      sources: [], claims: [], curator_notes: notes
    };
    if (state.mode === "update") {
      const change = {
        node_id: state.aliasTargetId, add_name_variants: [], add_external_identifiers: [], reason: state.aliasReason.trim()
      };
      if (state.aliasValue.trim()) change.add_name_variants.push({
        value: state.aliasValue.trim(), language: state.aliasLanguage.trim() || null,
        script: state.aliasScript.trim() || null, role: state.aliasRole || "alternate"
      });
      if (state.aliasNamespace.trim() && state.aliasIdentifier.trim()) change.add_external_identifiers.push({
        namespace: state.aliasNamespace.trim(), value: state.aliasIdentifier.trim()
      });
      proposal.record_changes = [change];
      return proposal;
    }
    proposal.record = await buildCanonicalRecord();
    proposal.sources = state.newSources.map(({ isNew, ...source }) => source);
    proposal.claims = await buildCanonicalClaims(proposal.record);
    return proposal;
  }

  function validateProposalInBrowser(proposal) {
    const errors = [];
    if (!/^[0-9a-f]{24}$/.test(proposal.proposal_id)) errors.push("Proposal ID could not be generated.");
    if (!/^[0-9a-f]{64}$/.test(proposal.base_checksum)) errors.push("Base release checksum is missing; reconnect to the API.");
    if (proposal.record) {
      if (!proposal.record.label) errors.push("Preferred label is required.");
      if (!proposal.record.summary) errors.push("Neutral summary is required.");
      for (const [index, date] of proposal.record.date_assertions.entries()) {
        if (date.start_year === 0 || date.end_year === 0) errors.push(`Date ${index + 1} cannot use year zero.`);
        if (date.start_year !== null && date.end_year !== null && date.start_year > date.end_year) errors.push(`Date ${index + 1} has an invalid range.`);
      }
    } else if (!proposal.record_changes.length) errors.push("The proposal has no new record or record change.");
    return errors;
  }

  async function validateAndExport() {
    const steps = state.mode === "update" ? [0, 3] : [0, 1, 2, 3];
    for (const step of steps) {
      const errors = validateStep(step);
      if (errors.length) {
        state.currentStep = step;
        renderStep();
        const summary = $(`[data-step-panel="${step}"] .error-summary`);
        summary?.scrollIntoView({ block: "center" });
        return;
      }
    }
    if (state.mode === "new") {
      const identifierErrors = await checkIdentifiersBeforeExport();
      if (identifierErrors.length) {
        state.currentStep = 2;
        renderStep();
        showErrors("#sourceErrors", identifierErrors);
        $("#sourceErrors").scrollIntoView({ block: "center" });
        return;
      }
    }
    try {
      const proposal = await buildProposal();
      const structuralErrors = validateProposalInBrowser(proposal);
      if (structuralErrors.length) { showErrors("#reviewErrors", structuralErrors); return; }
      $("#proposalJson").textContent = JSON.stringify(proposal, null, 2);
      $("#proposalPreview").hidden = false;
      const blob = new Blob([`${JSON.stringify(proposal, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const label = proposal.record?.label || nodesById.get(proposal.record_changes[0]?.node_id)?.label || "record";
      anchor.href = url;
      anchor.download = `religion-almanac-proposal-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record"}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      showErrors("#reviewErrors", []);
      persistDraft();
    } catch (error) {
      showErrors("#reviewErrors", [`Could not build proposal: ${error.message}`]);
    }
  }

  function renderDraftValues() {
    renderAll();
    const target = state.mode === "update" ? nodesById.get(state.aliasTargetId) : null;
    if (target) {
      $("#aliasTarget").innerHTML = `${escapeHtml(target.label)} <small>${escapeHtml(typeNames[target.type] || target.type)} · ${escapeHtml(target.id)}</small>`;
    }
  }

  function bindEvents() {
    $("#recordForm").addEventListener("input", event => {
      const target = event.target;
      const previousLabel = state.label;
      if (target.matches("input[name='recordType']")) state.type = target.value;
      if (target.dataset.field) {
        const field = target.dataset.field;
        state[field] = target.type === "checkbox" ? target.checked : target.value;
      }
      if (target.dataset.list) {
        const list = state[target.dataset.list];
        const item = list?.[Number(target.dataset.index)];
        if (item) {
          const key = target.dataset.key;
          item[key] = target.multiple ? [...target.selectedOptions].map(option => option.value)
            : key === "newIsSubject" ? target.value === "true" : target.value;
        }
      }
      if (target.dataset.sourceForm) state.newSourceForm[target.dataset.sourceForm] = target.value;
      if (target.id.startsWith("alias")) {
        const key = ({ aliasValue: "aliasValue", aliasLanguage: "aliasLanguage", aliasScript: "aliasScript",
          aliasRole: "aliasRole", aliasNamespace: "aliasNamespace", aliasIdentifier: "aliasIdentifier",
          aliasReason: "aliasReason" })[target.id];
        if (key) state[key] = target.value;
      }
      if (target.id === "identityQuery") state.identityQuery = target.value;
      if (target.id === "preferredLabel") {
        state.label = target.value;
        if (!state.identityQuery || state.identityQuery === previousLabel) {
          state.identityQuery = target.value;
          $("#identityQuery").value = target.value;
        }
      }
      if (target.id === "identityDisambiguator") state.identityDisambiguator = target.value;
      if (target.id === "parentId") state.parentId = target.value;
      if (target.id === "summary") $("#summaryCount").textContent = `${target.value.length} / 1000`;
      if (target.id === "sourceTitle") state.newSourceForm.title = target.value;
      if (target.id === "sourceAuthor") state.newSourceForm.author = target.value;
      if (target.id === "sourceContainer") state.newSourceForm.container = target.value;
      if (target.id === "sourcePublisher") state.newSourceForm.publisher = target.value;
      if (target.id === "sourceYear") state.newSourceForm.year = target.value;
      if (target.id === "sourceUrl") state.newSourceForm.url = target.value;
      if (target.id === "sourceLicense") state.newSourceForm.license = target.value;
      if (target.matches("input[name='recordType']")) { renderGuidance(); renderParentOptions(); }
      renderPreview(); persistDraft();
    });
    $("#recordForm").addEventListener("change", event => {
      if (event.target.dataset.list) {
        const item = state[event.target.dataset.list]?.[Number(event.target.dataset.index)];
        if (item) item[event.target.dataset.key] = event.target.multiple
          ? [...event.target.selectedOptions].map(option => option.value)
          : event.target.dataset.key === "newIsSubject" ? event.target.value === "true" : event.target.value;
      }
      if (event.target.id === "parentId") state.parentId = event.target.value;
      if (event.target.matches("input[name='recordType']")) state.type = event.target.value;
      persistDraft(); renderPreview();
    });
    document.addEventListener("click", event => {
      const add = event.target.closest("[data-add-row]");
      if (add) addRow(add.dataset.addRow);
      const remove = event.target.closest("[data-remove-row]");
      if (remove) { state[remove.dataset.removeRow].splice(Number(remove.dataset.index), 1); persistDraft(); renderAll(); }
      const removeSource = event.target.closest("[data-remove-source]");
      if (removeSource) {
        const id = removeSource.dataset.removeSource;
        state.selectedSources = state.selectedSources.filter(source => source.id !== id);
        state.newSources = state.newSources.filter(source => source.id !== id);
        state.dates.forEach(date => { date.evidenceIds = date.evidenceIds.filter(value => value !== id); });
        state.claims.forEach(claim => { claim.evidenceIds = claim.evidenceIds.filter(value => value !== id); });
        persistDraft(); renderAll();
      }
      const check = event.target.closest("[data-check-identifier]");
      if (check) searchIdentifier(Number(check.dataset.checkIdentifier));
    });
    $("#searchNameButton").addEventListener("click", () => searchNodes($("#identityQuery").value));
    $("#identityQuery").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); searchNodes(event.target.value); } });
    $("#nextButton").addEventListener("click", () => {
      const errors = validateStep(state.currentStep);
      if (errors.length) { $(`[data-step-panel="${state.currentStep}"] .error-summary`)?.scrollIntoView({ block: "center" }); return; }
      if (state.currentStep === 0 && !state.identityKey) {
        const disambiguator = state.identityDisambiguator.trim();
        state.identityKey = `node|${state.type}|${state.label.normalize("NFC").trim()}${disambiguator ? `|${disambiguator.normalize("NFC")}` : ""}`;
        state.identityType = state.type;
        $("#identityKeyDisplay").textContent = state.identityKey;
      }
      if (state.currentStep === 3) return;
      setStep(state.currentStep + 1);
    });
    $("#backButton").addEventListener("click", () => setStep(Math.max(0, state.currentStep - 1)));
    $$("#stepNav [data-go-step]").forEach(button => button.addEventListener("click", () => {
      const next = Number(button.dataset.goStep);
      if (state.mode === "update" || next <= state.currentStep) setStep(next);
      else {
        for (let step = state.currentStep; step < next; step += 1) if (validateStep(step).length) return;
        setStep(next);
      }
    }));
    $("#cancelAliasButton").addEventListener("click", cancelAliasProposal);
    $("#previewAliasButton").addEventListener("click", () => {
      const errors = validateStep(0);
      if (errors.length) return;
      state.currentStep = 3; renderStep(); renderPreview(); persistDraft();
    });
    $("#searchSourceButton").addEventListener("click", searchSources);
    $("#sourceSearch").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); searchSources(); } });
    $("#addSourceButton").addEventListener("click", addNewSource);
    $("#addClaimButton").addEventListener("click", () => {
      state.claims.push({ identityKey: "", otherId: "", relationType: "direct_textual_dependence", newIsSubject: true,
        direction: "probable", confidence: "3", consensus: "majority", rationale: "", dateLabel: "", evidenceIds: [] });
      persistDraft(); renderClaims();
    });
    $("#validateExportButton").addEventListener("click", validateAndExport);
    $("#hideJsonButton").addEventListener("click", () => { $("#proposalPreview").hidden = true; });
    $("#draftPicker").addEventListener("change", event => restoreDraft(event.target.value));
    $("#newDraftButton").addEventListener("click", createDraft);
    $("#duplicateDraftButton").addEventListener("click", duplicateDraft);
    $("#deleteDraftButton").addEventListener("click", () => {
      if (!draftId || !confirm("Delete this local draft? Other saved drafts will stay in this browser.")) return;
      const drafts = loadDrafts(); delete drafts[draftId];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts)); } catch { /* reset is still available in memory */ }
      createDraft();
    });
  }

  function loadInitialDraft() {
    const drafts = loadDrafts();
    let current = "";
    try { current = localStorage.getItem(CURRENT_KEY) || ""; } catch { /* Storage is optional. */ }
    if (current && drafts[current]) { draftId = current; state = { ...newDraftState(), ...drafts[current] }; }
    else if (Object.keys(drafts).length) { draftId = Object.keys(drafts)[0]; state = { ...newDraftState(), ...drafts[draftId] }; }
    else { draftId = randomHex(); state = newDraftState(); }
  }

  loadInitialDraft();
  bindEvents();
  renderDraftValues();
  connectGraph();
})();
