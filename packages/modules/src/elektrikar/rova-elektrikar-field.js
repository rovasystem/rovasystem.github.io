/* FIELD FEATURES — montáž, audit bytu, chráničky, schémy, AR+, rozvádzač
   Vkladá sa do hlavného IIFE modulu Elektrikár. */

const CONDUIT_SIZES = [16, 20, 25, 32];
const CONDUIT_FILL_MAX = { 16: 3, 20: 5, 25: 8, 32: 12 };
const AUDIT_ISSUES = [
  { id: "missing", label: "Chýba / neosadené" },
  { id: "wrong_height", label: "Nesprávna výška" },
  { id: "wrong_circuit", label: "Zlý okruh / istič" },
  { id: "bad_wiring", label: "Nesprávne zapojenie" },
  { id: "no_conduit", label: "Chýba chránička" },
  { id: "bad_penetration", label: "Zlý prieraz / jadro" },
  { id: "other", label: "Iný problém" }
];
const AUDIT_STATUS = {
  pending: { label: "Čaká", cls: "pending", icon: "○" },
  ok: { label: "OK", cls: "ok", icon: "✓" },
  warn: { label: "Upozornenie", cls: "warn", icon: "!" },
  fail: { label: "Chyba", cls: "fail", icon: "✕" }
};
const HEIGHT_TOL_DEFAULT = 30;

function migrateFieldData(p) {
  p.fieldPrefs = p.fieldPrefs || { arSubMode: "plan", arEngine: "2d", heightTol: HEIGHT_TOL_DEFAULT, drillPhase: "cut" };
  if (!p.fieldPrefs.arEngine) p.fieldPrefs.arEngine = "2d";
  p.auditMeta = p.auditMeta || { auditor: "", completedAt: null };
  p.elements.forEach((e) => {
    e.audit = e.audit || { status: "pending", issues: [], measuredZ: null, photo: null, note: "" };
    if (e.type === "penetration") {
      e.pen = e.pen || { diameter: 80, depth: 200, direction: "wall", wallLabel: "" };
    }
  });
  p.routes.forEach((r) => {
    r.install = r.install || ((r.type === "power" || r.type === "light") ? "conduit" : "free");
    r.conduitMm = r.conduitMm || (r.type === "light" ? 16 : 20);
  });
  p.circuits.forEach((c) => {
    c.panelSlot = c.panelSlot || "";
    c.panelLabel = c.panelLabel || "";
    c.panelVerified = !!c.panelVerified;
  });
  return p;
}

function defaultElementAudit() {
  return { status: "pending", issues: [], measuredZ: null, photo: null, note: "" };
}

function heightCheck(e) {
  const tol = P().fieldPrefs?.heightTol ?? HEIGHT_TOL_DEFAULT;
  const planned = e.z;
  const measured = e.audit?.measuredZ;
  if (measured == null || measured === "") return null;
  const diff = Math.abs(measured - planned);
  if (diff <= tol) return { ok: true, diff, tol };
  return { ok: false, diff, tol };
}

function autoAuditStatus(e) {
  if (e.audit?.issues?.length) return e.audit.issues.some((i) => i === "missing" || i === "bad_wiring") ? "fail" : "warn";
  const hc = heightCheck(e);
  if (hc && !hc.ok) return "warn";
  if (e.audit?.photo && e.status === "Hotové") return "ok";
  if (e.audit?.status === "ok" || e.audit?.status === "fail" || e.audit?.status === "warn") return e.audit.status;
  return "pending";
}

function roomAuditStats(roomId) {
  const els = P().elements.filter((e) => e.room === roomId);
  if (!els.length) return { total: 0, ok: 0, warn: 0, fail: 0, pending: 0, pct: 0 };
  const counts = { ok: 0, warn: 0, fail: 0, pending: 0 };
  els.forEach((e) => {
    const st = autoAuditStatus(e);
    counts[st] = (counts[st] || 0) + 1;
  });
  const ok = counts.ok || 0;
  const pct = Math.round((ok / els.length) * 100);
  return { total: els.length, ...counts, pct };
}

function conduitFillWarning(route) {
  if (route.install !== "conduit") return null;
  const mm = route.conduitMm || 16;
  const max = CONDUIT_FILL_MAX[mm] || 5;
  const sameConduit = P().routes.filter((r) => r.install === "conduit" && r.conduitMm === mm && r.type === route.type);
  if (sameConduit.length > max) {
    return `Chránička Ø${mm} mm: ${sameConduit.length} trás typu ${routeTypeById(route.type).name} — odporúčané max. ${max}.`;
  }
  return null;
}

function wiringSchematicHtml(e) {
  const t = typeById(e.type);
  const circ = P().circuits.find((c) => c.id === e.circuitId);
  const linkedLights = P().links.filter((l) => l.switchId === e.id).map((l) => elementById(l.lightId)).filter(Boolean);
  const linkedSwitch = P().links.find((l) => l.lightId === e.id);
  const sw = linkedSwitch ? elementById(linkedSwitch.switchId) : null;

  let svg = "";
  const wireColor = circ?.type === "light" ? "#ffd84a" : "#1e9bff";

  if (e.type === "switch" || e.type === "switch_cross") {
    const cross = e.type === "switch_cross";
    svg = `
      <svg class="elk-wiring-svg" viewBox="0 0 280 160" aria-label="Schéma vypínača">
        <text x="8" y="16" class="elk-ws-lbl">L (fáza)</text>
        <line x1="40" y1="30" x2="40" y2="130" stroke="${wireColor}" stroke-width="3"/>
        <rect x="70" y="55" width="50" height="50" rx="6" fill="none" stroke="#ffbf4a" stroke-width="2"/>
        <text x="78" y="85" fill="#ffbf4a" font-size="11">${cross ? "S/K" : "S"}</text>
        <line x1="120" y1="80" x2="200" y2="80" stroke="${wireColor}" stroke-width="3"/>
        <text x="205" y="84" class="elk-ws-lbl">→ svetlo</text>
        ${cross ? `<line x1="40" y1="50" x2="70" y2="65" stroke="#ffa724" stroke-width="2"/><line x1="40" y1="110" x2="70" y2="95" stroke="#ffa724" stroke-width="2"/><text x="8" y="54" class="elk-ws-lbl">L2</text>` : ""}
        <text x="8" y="140" class="elk-ws-lbl">N — v krabici (modrá)</text>
      </svg>`;
  } else if (e.type === "outlet" || e.type === "outlet_kit" || e.type === "outlet_400") {
    svg = `
      <svg class="elk-wiring-svg" viewBox="0 0 280 140" aria-label="Schéma zásuvky">
        <line x1="30" y1="40" x2="30" y2="100" stroke="${wireColor}" stroke-width="3"/>
        <text x="8" y="44" class="elk-ws-lbl">L</text>
        <line x1="60" y1="40" x2="60" y2="100" stroke="#62b4ff" stroke-width="3"/>
        <text x="42" y="44" class="elk-ws-lbl">N</text>
        <line x1="90" y1="40" x2="90" y2="100" stroke="#39eca9" stroke-width="3"/>
        <text x="78" y="44" class="elk-ws-lbl">PE</text>
        <rect x="110" y="50" width="60" height="40" rx="4" fill="none" stroke="#1e9bff" stroke-width="2"/>
        <text x="118" y="75" fill="#1e9bff" font-size="11">⊟</text>
        ${e.type === "outlet_400" ? `<text x="180" y="75" class="elk-ws-lbl">L1 L2 L3 N PE</text>` : ""}
      </svg>`;
  } else if (e.type === "light" || e.type === "light_wall") {
    svg = `
      <svg class="elk-wiring-svg" viewBox="0 0 280 120" aria-label="Schéma svetla">
        <line x1="30" y1="30" x2="30" y2="90" stroke="${wireColor}" stroke-width="3"/>
        <text x="8" y="34" class="elk-ws-lbl">L z vypínača</text>
        <line x1="60" y1="30" x2="60" y2="90" stroke="#62b4ff" stroke-width="3"/>
        <text x="42" y="34" class="elk-ws-lbl">N</text>
        <circle cx="140" cy="60" r="22" fill="none" stroke="#ffd84a" stroke-width="2"/>
        <text x="132" y="65" fill="#ffd84a">◎</text>
      </svg>`;
  } else if (e.type === "junction") {
    svg = `<svg class="elk-wiring-svg" viewBox="0 0 200 80"><rect x="60" y="20" width="80" height="40" rx="4" fill="none" stroke="#9b8cff" stroke-width="2"/><text x="72" y="46" fill="#9b8cff">KO/KU</text></svg>`;
  } else {
    svg = `<p class="elk-muted">Pre tento typ nie je k dispozícii štandardná schéma.</p>`;
  }

  const meta = [];
  if (circ) meta.push(`Okruh: <b>${esc(circ.name)}</b> · ${esc(circ.breaker || "—")}${circ.rcd ? " + RCD" : ""}`);
  if (circ?.panelSlot) meta.push(`Rozvádzač: <b>${esc(circ.panelSlot)}</b>${circ.panelLabel ? " · " + esc(circ.panelLabel) : ""}`);
  if (linkedLights.length) meta.push(`Ovláda: ${linkedLights.map((l) => esc(l.label)).join(", ")}`);
  if (sw) meta.push(`Vypínač: <b>${esc(sw.label)}</b>`);
  meta.push(`Výška: <b>${e.z} mm</b> (tolerancia ±${P().fieldPrefs?.heightTol ?? HEIGHT_TOL_DEFAULT} mm)`);

  const steps = wiringSteps(e);
  return `
    <div class="elk-wiring-panel">
      <h4>${t.icon} ${esc(e.label)} — schéma zapojenia</h4>
      ${meta.map((m) => `<p class="elk-wiring-meta">${m}</p>`).join("")}
      ${svg}
      ${steps.length ? `<ol class="elk-wiring-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
    </div>`;
}

function wiringSteps(e) {
  if (e.type === "switch") {
    return ["Privieď L (hnedá) na spínač.", "Z spínača vývod L na svetlo.", "N (modrá) prepoj v krabici — nepretrhavaj.", "PE (zeleno-žltá) len ak je kovové telo."];
  }
  if (e.type === "switch_cross") {
    return ["Dva vodiče L medzi spínačmi (striedavé).", "Každý spínač má spoločný L a dva vývody.", "Skontroluj, či svetlo reaguje z oboch miest."];
  }
  if (e.type === "outlet" || e.type === "outlet_kit") {
    return ["L → svorka L, N → svorka N, PE → svorka PE.", "Skontroluj dotiahnutie svoriek.", "Zásuvka 300 mm (kuchyňa 1100–1200 mm)."];
  }
  if (e.type === "light" || e.type === "light_wall") {
    return ["L z vypínača na svorku svetla.", "N priamo z okruhu.", "Ak LED s driverom — skontroluj nulový vodič."];
  }
  if (e.type === "penetration") {
    return [`Vŕtaj Ø${e.pen?.diameter || 80} mm, hĺbka cca ${e.pen?.depth || 200} mm.`, "Smer: " + (e.pen?.direction === "ceiling" ? "strop" : e.pen?.direction === "floor" ? "podlaha" : "stenou"), "Po vŕtaní vyčisti otvor pred ťahaním chráničky."];
  }
  return [];
}

function renderKontrola() {
  const p = P();
  const roomId = state.kontrolaRoom || activeRoom()?.id || p.rooms[0]?.id;
  const els = p.elements.filter((e) => !roomId || e.room === roomId);
  return `
    <div class="elk-section">
      <div class="elk-section-head">
        <h3>Kontrola montáže</h3>
        <select id="elkKontrolaRoom" class="elk-select">
          <option value="">Všetky miestnosti</option>
          ${p.rooms.map((r) => `<option value="${r.id}" ${r.id === roomId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
        </select>
      </div>
      <p class="elk-muted">Pre nového elektrikára: skontroluj každý prvok — výšku, okruh, zapojenie, foto dôkaz. Vedúci uvidí výsledok v reporte.</p>
      <div class="elk-audit-list">
        ${els.length ? els.map(renderAuditCard).join("") : `<div class="elk-empty">Žiadne prvky. Osaď ich v pláne.</div>`}
      </div>
    </div>
    <div id="elkWiringModal" class="elk-modal" hidden></div>`;
}

function renderAuditCard(e) {
  const t = typeById(e.type);
  const st = autoAuditStatus(e);
  const stMeta = AUDIT_STATUS[st] || AUDIT_STATUS.pending;
  const circ = P().circuits.find((c) => c.id === e.circuitId);
  const hc = heightCheck(e);
  const rn = P().rooms.find((r) => r.id === e.room)?.name || "—";
  return `
    <div class="elk-audit-card ${stMeta.cls}" data-audit-id="${e.id}">
      <div class="elk-audit-head">
        <span class="elk-audit-icon" style="color:${t.color}">${t.icon}</span>
        <div>
          <b>${esc(e.label)}</b>
          <small>${esc(t.name)} · ${esc(rn)} · plán ${e.z} mm</small>
        </div>
        <span class="elk-audit-badge ${stMeta.cls}">${stMeta.icon} ${stMeta.label}</span>
      </div>
      <div class="elk-audit-grid">
        <label>Zmeraná výška (mm)
          <input type="number" data-audit-z="${e.id}" step="5" value="${e.audit?.measuredZ ?? ""}" placeholder="${e.z}" />
        </label>
        <label>Stav montáže
          <select data-audit-status="${e.id}">
            ${Object.entries(AUDIT_STATUS).map(([k, v]) => `<option value="${k}" ${(e.audit?.status || "pending") === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </label>
      </div>
      ${hc ? `<p class="elk-audit-hc ${hc.ok ? "ok" : "bad"}">${hc.ok ? "✓ Výška v tolerancii" : "⚠ Odchýlka " + hc.diff + " mm (±" + hc.tol + ")"}</p>` : ""}
      <div class="elk-audit-issues">
        ${AUDIT_ISSUES.map((iss) => `<label class="elk-issue-chip"><input type="checkbox" data-audit-issue="${e.id}" value="${iss.id}" ${e.audit?.issues?.includes(iss.id) ? "checked" : ""}/> ${iss.label}</label>`).join("")}
      </div>
      <div class="elk-audit-actions">
        <button class="elk-btn sm" data-audit-schema="${e.id}">Schéma zapojenia</button>
        <label class="elk-btn sm">📷 Foto<input type="file" accept="image/*" capture="environment" data-audit-photo="${e.id}" hidden /></label>
        ${e.audit?.photo ? `<img class="elk-audit-thumb" src="${e.audit.photo}" alt="foto" />` : ""}
      </div>
      <label class="elk-audit-note">Poznámka<input data-audit-note="${e.id}" value="${esc(e.audit?.note || "")}" placeholder="Čo treba opraviť…" /></label>
    </div>`;
}

function renderAuditBytu() {
  const p = P();
  const rooms = p.rooms.map((r) => ({ room: r, stats: roomAuditStats(r.id) }));
  const totalEls = p.elements.length;
  const totalOk = p.elements.filter((e) => autoAuditStatus(e) === "ok").length;
  const overallPct = totalEls ? Math.round((totalOk / totalEls) * 100) : 0;
  const circuitsOk = p.circuits.filter((c) => c.panelSlot && c.panelVerified).length;
  return `
    <div class="elk-section">
      <h3>Audit bytu — súhrn</h3>
      <div class="elk-audit-overall ${overallPct >= 90 ? "ok" : overallPct >= 60 ? "warn" : "bad"}">
        <div><small>Celková pripravenosť</small><b>${overallPct}%</b><small>${totalOk} / ${totalEls} prvkov OK</small></div>
        <div><small>Rozvádzač overený</small><b>${circuitsOk} / ${p.circuits.length}</b><small>okruhov s potvrdeným slotom</small></div>
      </div>
      <div class="elk-audit-rooms">
        ${rooms.map(({ room, stats }) => {
          const cls = stats.pct >= 90 ? "ok" : stats.pct >= 50 ? "warn" : stats.total ? "bad" : "empty";
          return `
            <div class="elk-audit-room ${cls}">
              <h4>${esc(room.name)}</h4>
              <div class="elk-audit-room-bar"><span style="width:${stats.pct}%"></span></div>
              <small>${stats.ok} OK · ${stats.warn || 0} upoz. · ${stats.fail || 0} chýb · ${stats.pending || 0} čaká</small>
              <button class="elk-btn sm ghost" data-audit-goto="${room.id}">Kontrolovať</button>
            </div>`;
        }).join("")}
      </div>
      <div class="elk-audit-meta">
        <label>Auditor<input id="elkAuditor" value="${esc(p.auditMeta?.auditor || "")}" placeholder="Meno kontrolóra" /></label>
        <button class="elk-btn primary" data-elk="completeAudit">Uzavrieť audit bytu</button>
        <button class="elk-btn" data-elk="exportAudit">Export audit PDF / tlač</button>
      </div>
      ${renderDrillSequence()}
    </div>`;
}

function renderDrillSequence() {
  const p = P();
  const cuts = p.routes.filter((r) => r.type === "power" || r.type === "light").length;
  const pens = p.elements.filter((e) => e.type === "penetration").length;
  const routes = p.routes.length;
  const phase = P().fieldPrefs?.drillPhase || "cut";
  const phases = [
    { id: "cut", label: "1. Drážky / rezy", done: cuts > 0, count: cuts },
    { id: "pen", label: "2. Prierazy / jadrá", done: pens > 0, count: pens },
    { id: "conduit", label: "3. Chráničky", done: p.routes.some((r) => r.install === "conduit"), count: p.routes.filter((r) => r.install === "conduit").length },
    { id: "cable", label: "4. Ťahanie kábla", done: routes > 0 && p.elements.some((e) => e.status === "Hotové"), count: routes }
  ];
  return `
    <div class="elk-drill-seq">
      <h4>Postup vŕtania a montáže</h4>
      <div class="elk-drill-phases">
        ${phases.map((ph) => `<button class="elk-drill-phase ${ph.id === phase ? "active" : ""} ${ph.done ? "done" : ""}" data-drill-phase="${ph.id}">${ph.label} <small>(${ph.count})</small></button>`).join("")}
      </div>
      <p class="elk-muted">V AR režime zvýrazníš aktívnu fázu. Najprv drážky, potom prierazy, potom chráničky, nakoniec kábel.</p>
    </div>`;
}

function renderPanelMapping() {
  const p = P();
  const board = p.elements.find((e) => e.type === "board");
  return `
    <div class="elk-section elk-panel-map">
      <h3>Mapovanie rozvádzača</h3>
      <p class="elk-muted">Priraď každému okruhu pozíciu v rozvádzači (FI / istič). Nový elektrikár overí štítok vs. plán.</p>
      ${board ? `<p class="elk-muted">Rozvádzač na pláne: <b>${esc(board.label)}</b> · ${board.z} mm</p>` : `<p class="elk-warn">⚠ Osaď rozvádzač v pláne pre lepšiu orientáciu.</p>`}
      <div class="elk-panel-slots">
        ${p.circuits.length ? p.circuits.map((c) => `
          <div class="elk-panel-slot ${c.panelVerified ? "verified" : ""}">
            <b>${esc(c.name)}</b>
            <label>Slot<input data-panel-slot="${c.id}" value="${esc(c.panelSlot)}" placeholder="napr. FI-2 / B16" /></label>
            <label>Štítok<input data-panel-label="${c.id}" value="${esc(c.panelLabel)}" placeholder="Kuchyňa zásuvky" /></label>
            <label class="elk-c-rcd"><input type="checkbox" data-panel-verified="${c.id}" ${c.panelVerified ? "checked" : ""}/> Overené v teréne</label>
          </div>`).join("") : `<div class="elk-empty">Najprv vytvor okruhy.</div>`}
      </div>
    </div>`;
}

function bindKontrola() {
  const host = root();
  if (!host) return;
  document.getElementById("elkKontrolaRoom")?.addEventListener("change", (e) => {
    state.kontrolaRoom = e.target.value || null;
    render();
  });
  host.querySelectorAll("[data-audit-z]").forEach((inp) => inp.addEventListener("input", () => {
    const e = elementById(inp.dataset.auditZ);
    if (!e) return;
    e.audit.measuredZ = inp.value === "" ? null : clampNum(inp.value);
    persist();
    updateAuditCardVisual(e.id);
  }));
  host.querySelectorAll("[data-audit-status]").forEach((sel) => sel.addEventListener("change", () => {
    const e = elementById(sel.dataset.auditStatus);
    if (!e) return;
    e.audit.status = sel.value;
    persist();
    updateAuditCardVisual(e.id);
  }));
  host.querySelectorAll("[data-audit-issue]").forEach((cb) => cb.addEventListener("change", () => {
    const e = elementById(cb.dataset.auditIssue);
    if (!e) return;
    const iss = cb.value;
    if (cb.checked) { if (!e.audit.issues.includes(iss)) e.audit.issues.push(iss); }
    else e.audit.issues = e.audit.issues.filter((x) => x !== iss);
    persist();
    updateAuditCardVisual(e.id);
  }));
  host.querySelectorAll("[data-audit-note]").forEach((inp) => inp.addEventListener("input", () => {
    const e = elementById(inp.dataset.auditNote);
    if (e) { e.audit.note = inp.value; persist(); }
  }));
  host.querySelectorAll("[data-audit-photo]").forEach((inp) => inp.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    const e = elementById(inp.dataset.auditPhoto);
    if (!file || !e) return;
    const reader = new FileReader();
    reader.onload = () => { e.audit.photo = reader.result; persist(); render(); };
    reader.readAsDataURL(file);
  }));
  host.querySelectorAll("[data-audit-schema]").forEach((b) => b.addEventListener("click", () => {
    showWiringModal(elementById(b.dataset.auditSchema));
  }));
  host.querySelectorAll("[data-audit-goto]").forEach((b) => b.addEventListener("click", () => {
    state.view = "kontrola";
    state.kontrolaRoom = b.dataset.auditGoto;
    render();
  }));
  document.getElementById("elkAuditor")?.addEventListener("input", (e) => {
    P().auditMeta.auditor = e.target.value;
    persist();
  });
  host.querySelectorAll("[data-drill-phase]").forEach((b) => b.addEventListener("click", () => {
    P().fieldPrefs.drillPhase = b.dataset.drillPhase;
    persist();
    render();
  }));
  bindPanelMapping();
}

function bindPanelMapping() {
  const host = root();
  if (!host) return;
  host.querySelectorAll("[data-panel-slot]").forEach((inp) => inp.addEventListener("input", () => {
    const c = P().circuits.find((x) => x.id === inp.dataset.panelSlot);
    if (c) { c.panelSlot = inp.value; persist(); }
  }));
  host.querySelectorAll("[data-panel-label]").forEach((inp) => inp.addEventListener("input", () => {
    const c = P().circuits.find((x) => x.id === inp.dataset.panelLabel);
    if (c) { c.panelLabel = inp.value; persist(); }
  }));
  host.querySelectorAll("[data-panel-verified]").forEach((cb) => cb.addEventListener("change", () => {
    const c = P().circuits.find((x) => x.id === cb.dataset.panelVerified);
    if (c) { c.panelVerified = cb.checked; persist(); cb.closest(".elk-panel-slot")?.classList.toggle("verified", cb.checked); }
  }));
}

function updateAuditCardVisual(id) {
  const e = elementById(id);
  const card = root()?.querySelector(`[data-audit-id="${id}"]`);
  if (!e || !card) return;
  const st = autoAuditStatus(e);
  const stMeta = AUDIT_STATUS[st] || AUDIT_STATUS.pending;
  card.className = `elk-audit-card ${stMeta.cls}`;
  const badge = card.querySelector(".elk-audit-badge");
  if (badge) { badge.className = `elk-audit-badge ${stMeta.cls}`; badge.textContent = `${stMeta.icon} ${stMeta.label}`; }
}

function showWiringModal(e) {
  if (!e) return;
  let modal = document.getElementById("elkWiringModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "elkWiringModal";
    modal.className = "elk-modal";
    root()?.appendChild(modal);
  }
  modal.hidden = false;
  modal.innerHTML = `
    <div class="elk-modal-box">
      <button class="elk-modal-close" data-wiring-close>✕</button>
      ${wiringSchematicHtml(e)}
    </div>`;
  modal.querySelector("[data-wiring-close]")?.addEventListener("click", () => { modal.hidden = true; });
  modal.addEventListener("click", (ev) => { if (ev.target === modal) modal.hidden = true; });
}

function auditIssueLabels(issueIds) {
  return (issueIds || []).map((id) => AUDIT_ISSUES.find((i) => i.id === id)?.label || id);
}

function exportAuditPrint() {
  const p = P();
  const audit = buildAuditReport();
  const statusLabel = (st) => (AUDIT_STATUS[st] || AUDIT_STATUS.pending).label;
  const roomsDetail = audit.rooms.map((r) => {
    const issues = audit.elements.filter((e) => e.room === r.name && e.auditStatus !== "ok");
    return { ...r, issues };
  });
  const html = `<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8"><title>Audit — ${esc(p.name)}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:920px;margin:0 auto}
      h1{margin:0 0 8px}h2{margin:0 0 8px;font-size:18px}.meta{color:#555;margin-bottom:20px}
      .summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
      .summary div{border:1px solid #ddd;border-radius:8px;padding:12px}.summary small{display:block;color:#666}
      .summary b{font-size:22px}
      .room{border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px}
      .bad{color:#c00}.warn{color:#b45309}.ok{color:#080}.muted{color:#666;font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
      td,th{border:1px solid #ddd;padding:6px;text-align:left}th{background:#f6f6f6}
      .pct-ok{font-weight:700;color:#080}.pct-warn{font-weight:700;color:#b45309}.pct-bad{font-weight:700;color:#c00}
    </style></head><body>
    <h1>ROVA — Audit bytu</h1>
    <p class="meta"><b>${esc(p.name)}</b> · ${esc(p.address)} · Auditor: ${esc(audit.auditor || "—")} · ${new Date().toLocaleString("sk-SK")}</p>
    <div class="summary">
      <div><small>Celková pripravenosť</small><b>${audit.summary.overallPct}%</b><small>${audit.summary.elementsOk} / ${audit.summary.elementsTotal} prvkov OK</small></div>
      <div><small>Rozvádzač</small><b>${audit.summary.panelVerified} / ${audit.summary.panelTotal}</b><small>okruhov overených</small></div>
      <div><small>3D kalibrácia</small><b>${audit.ar3dCalib?.calibrated ? "Áno" : "Nie"}</b><small>${audit.ar3dCalib?.at ? esc(audit.ar3dCalib.at) : "—"}</small></div>
    </div>
    <h2>Prehľad miestností</h2>
    <table>
      <tr><th>Miestnosť</th><th>Prvkov</th><th>OK</th><th>Upoz.</th><th>Chyby</th><th>Čaká</th><th>% OK</th></tr>
      ${audit.rooms.map((r) => {
        const pctCls = r.pct >= 90 ? "pct-ok" : r.pct >= 50 ? "pct-warn" : "pct-bad";
        return `<tr>
          <td>${esc(r.name)}</td><td>${r.total}</td><td>${r.ok || 0}</td><td>${r.warn || 0}</td>
          <td>${r.fail || 0}</td><td>${r.pending || 0}</td><td class="${pctCls}">${r.pct}%</td>
        </tr>`;
      }).join("")}
    </table>
    <h2 style="margin-top:24px">Detail podľa miestností</h2>
    ${roomsDetail.map((r) => `
      <div class="room">
        <h2>${esc(r.name)} — ${r.pct}% OK</h2>
        <p class="muted">${r.ok || 0} OK · ${r.warn || 0} upozornení · ${r.fail || 0} chýb · ${r.pending || 0} čaká</p>
        ${r.issues.length ? `<table><tr><th>Prvok</th><th>Stav</th><th>Problém</th><th>Výška (plán / zmer.)</th><th>Foto</th><th>Poznámka</th></tr>
          ${r.issues.map((e) => `<tr>
            <td>${esc(e.label)}</td>
            <td class="${e.auditStatus === "fail" ? "bad" : "warn"}">${esc(statusLabel(e.auditStatus))}</td>
            <td class="bad">${esc(auditIssueLabels(e.issues).join(", ") || statusLabel(e.auditStatus))}</td>
            <td>${e.plannedZ} mm${e.measuredZ != null ? " / " + e.measuredZ + " mm" : ""}</td>
            <td>${e.hasPhoto ? "✓" : "—"}</td>
            <td>${esc(e.note || "")}</td>
          </tr>`).join("")}
        </table>` : `<p class="ok">Všetko v poriadku.</p>`}
      </div>`).join("")}
    ${audit.panel?.length ? `
      <h2 style="margin-top:24px">Rozvádzač</h2>
      <table>
        <tr><th>Okruh</th><th>Istič</th><th>Slot</th><th>Štítok</th><th>Overené</th></tr>
        ${audit.panel.map((c) => `<tr>
          <td>${esc(c.name)}</td><td>${esc(c.breaker || "—")}</td><td>${esc(c.panelSlot || "—")}</td>
          <td>${esc(c.panelLabel || "—")}</td><td class="${c.verified ? "ok" : "bad"}">${c.verified ? "✓" : "—"}</td>
        </tr>`).join("")}
      </table>` : ""}
    </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

function completeAudit() {
  P().auditMeta.completedAt = now();
  persist();
  alert("Audit bytu uzavretý. Odošli report do webu v záložke Report.");
}

function renderArFieldExtras() {
  const p = P();
  const sub = p.fieldPrefs?.arSubMode || "plan";
  const pointEl = state.arPointElementId ? elementById(state.arPointElementId) : null;
  return `
    <div class="elk-ar-row">
      <span class="elk-pal-label">AR režim</span>
      <button class="elk-pal-btn ${sub === "plan" ? "active" : ""}" data-ar-sub="plan">Celý plán</button>
      <button class="elk-pal-btn ${sub === "point" ? "active" : ""}" data-ar-sub="point">Bod na stene</button>
      <button class="elk-pal-btn ${sub === "drill" ? "active" : ""}" data-ar-sub="drill">Vrtací plán</button>
    </div>
    ${sub === "point" ? `
      <div class="elk-ar-row">
        <label class="elk-slider" style="flex:2">Prvok pri stene
          <select id="elkArPointEl" class="elk-select">
            <option value="">— vyber —</option>
            ${p.elements.filter((e) => e.type !== "penetration").map((e) => `<option value="${e.id}" ${e.id === state.arPointElementId ? "selected" : ""}>${esc(e.label)} (${typeById(e.type).name})</option>`).join("")}
          </select>
        </label>
        <button class="elk-btn sm" data-ar-measure>📏 Zmerať výšku</button>
        <button class="elk-btn sm" data-ar-schema>Schéma</button>
      </div>
      ${pointEl ? renderArPointHud(pointEl) : ""}
    ` : ""}
    ${sub === "drill" ? `<p class="elk-muted">Fáza: <b>${esc({ cut: "Drážky", pen: "Prierazy", conduit: "Chráničky", cable: "Kábel" }[p.fieldPrefs?.drillPhase] || "Drážky")}</b> — v AR vidíš len relevantné vrstvy.</p>` : ""}
    <label class="elk-slider">Tolerancia výšky (±mm)<input type="range" id="elkHeightTol" min="10" max="80" step="5" value="${p.fieldPrefs?.heightTol ?? HEIGHT_TOL_DEFAULT}"></label>`;
}

function renderArPointHud(e) {
  const hc = heightCheck(e);
  const circ = P().circuits.find((c) => c.id === e.circuitId);
  const t = typeById(e.type);
  return `
    <div class="elk-ar-point-hud">
      <div class="elk-ar-height-rail">
        <div class="elk-ar-height-fill" style="height:${Math.min(100, (e.z / 2800) * 100)}%"></div>
        <span class="elk-ar-height-mark" style="bottom:${Math.min(92, (e.z / 2800) * 100)}%">${e.z} mm</span>
      </div>
      <div class="elk-ar-point-info">
        <b style="color:${t.color}">${t.icon} ${esc(e.label)}</b>
        <p>Plán: <b>${e.z} mm</b> · ${esc(t.name)}</p>
        ${circ ? `<p>Okruh: <b>${esc(circ.name)}</b> · ${esc(circ.breaker || "—")}${circ.panelSlot ? " · " + esc(circ.panelSlot) : ""}</p>` : ""}
        ${e.audit?.measuredZ != null ? `<p class="${hc?.ok ? "elk-ok" : "elk-bad"}">Zmerané: <b>${e.audit.measuredZ} mm</b>${hc ? (hc.ok ? " ✓" : " ⚠ ±" + hc.diff) : ""}</p>` : `<p class="elk-muted">Zmeraj výšku tlačidlom alebo v Kontrole.</p>`}
      </div>
    </div>`;
}

function bindArFieldExtras() {
  const host = root();
  if (!host) return;
  host.querySelectorAll("[data-ar-sub]").forEach((b) => b.addEventListener("click", () => {
    P().fieldPrefs.arSubMode = b.dataset.arSub;
    if (b.dataset.arSub === "drill") applyDrillPhaseLayers();
    render();
  }));
  document.getElementById("elkArPointEl")?.addEventListener("change", (e) => {
    state.arPointElementId = e.target.value || null;
    render();
  });
  document.getElementById("elkHeightTol")?.addEventListener("input", (e) => {
    P().fieldPrefs.heightTol = parseInt(e.target.value, 10);
    persist();
  });
  host.querySelector("[data-ar-measure]")?.addEventListener("click", startHeightMeasure);
  host.querySelector("[data-ar-schema]")?.addEventListener("click", () => {
    const e = elementById(state.arPointElementId);
    if (e) showWiringModal(e);
  });
}

function applyDrillPhaseLayers() {
  const ph = P().fieldPrefs?.drillPhase || "cut";
  ar.layers.routes = ph === "cable" || ph === "conduit";
  ar.layers.cut = ph === "cut";
  ar.layers.penetration = ph === "pen";
  ar.layers.elements = ph !== "cut";
  ar.layers.conduit = ph === "conduit" || ph === "cable";
}

function startHeightMeasure() {
  const e = elementById(state.arPointElementId);
  if (!e) { alert("Vyber prvok pri stene."); return; }
  const stage = document.getElementById("elkArStage");
  if (!stage) return;
  const msg = document.getElementById("elkArMsg");
  if (msg) {
    msg.style.display = "";
    msg.innerHTML = "Ťukni na <b>spodok steny (podlaha)</b>, potom na <b>stred prvku</b>.";
  }
  let floorY = null;
  const handler = (ev) => {
    const rect = stage.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    if (floorY == null) {
      floorY = y;
      if (msg) msg.innerHTML = "Teraz ťukni na stred osadenia prvku (vypínač / zásuvka).";
      return;
    }
    const elY = y;
    const roomH = 2.6;
    const pxPerM = rect.height / roomH;
    const measuredMm = Math.round((floorY - elY) / pxPerM * 1000);
    if (measuredMm < 50 || measuredMm > 3500) {
      alert("Neplatná hodnota. Skús znova.");
      floorY = null;
      if (msg) msg.innerHTML = "Ťukni na spodok steny (podlaha).";
      return;
    }
    e.audit.measuredZ = measuredMm;
    persist();
    stage.removeEventListener("click", handler);
    if (msg) msg.style.display = "none";
    render();
  };
  stage.addEventListener("click", handler);
}

function drawArFieldOverlay(ctx, cw, ch, s, vs) {
  const sub = P().fieldPrefs?.arSubMode || "plan";
  const p = P();

  if (sub === "point" && state.arPointElementId) {
    const e = elementById(state.arPointElementId);
    if (e) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      drawArElement(ctx, e, s);
      const railX = cw - 36;
      ctx.fillStyle = "rgba(6,15,28,.75)";
      ctx.fillRect(railX - 8, ch * 0.08, 24, ch * 0.84);
      ctx.strokeStyle = "#39eca9";
      ctx.lineWidth = 2;
      const yMark = ch * 0.92 - (e.z / 2800) * ch * 0.84;
      ctx.beginPath();
      ctx.moveTo(railX - 20, yMark);
      ctx.lineTo(railX + 20, yMark);
      ctx.stroke();
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "600 12px Inter,Arial";
      ctx.textAlign = "right";
      ctx.fillText(`${e.z} mm`, railX - 24, yMark + 4);
      const meas = e.audit?.measuredZ;
      if (meas != null) {
        const yM = ch * 0.92 - (meas / 2800) * ch * 0.84;
        const hc = heightCheck(e);
        ctx.strokeStyle = hc?.ok ? "#22c55e" : "#ff5470";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(railX - 20, yM);
        ctx.lineTo(railX + 20, yM);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hc?.ok ? "#22c55e" : "#ff5470";
        ctx.fillText(`${meas} mm`, railX - 24, yM + 4);
      }
      ctx.restore();
    }
    return sub === "point";
  }

  if (sub === "drill") {
    const ph = P().fieldPrefs?.drillPhase || "cut";
    if (ph === "pen") {
      p.elements.filter((el) => el.type === "penetration").forEach((el) => drawArPenetrationDrill(ctx, el, s));
    }
  }
  return false;
}

function drawArPenetrationDrill(ctx, e, s) {
  drawArPenetration(ctx, e, s);
  const pen = e.pen || {};
  ctx.save();
  ctx.fillStyle = "#ff8fa3";
  ctx.font = `600 ${11 / s}px Inter,Arial`;
  ctx.textAlign = "left";
  ctx.fillText(`Ø${pen.diameter || 80} · ${pen.depth || 200}mm · ${pen.direction === "ceiling" ? "strop" : pen.direction === "floor" ? "podlaha" : "stena"}`, e.x + 22 / s, e.y + 18 / s);
  ctx.restore();
}

function drawRouteConduit(ctx, pts, color, width, conduitMm) {
  if (!pts || pts.length < 2) return;
  const off = width * 1.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  ctx.beginPath();
  pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = width * 0.4;
  ctx.setLineDash([width, width * 0.8]);
  ctx.beginPath();
  pts.forEach((pt, i) => i ? ctx.lineTo(pt[0] + off, pt[1] + off) : ctx.moveTo(pt[0] + off, pt[1] + off));
  ctx.stroke();
  ctx.fillStyle = "#aecbe6";
  ctx.font = `600 ${10}px Inter,Arial`;
  const mid = pts[Math.floor(pts.length / 2)];
  ctx.fillText(`Ø${conduitMm}`, mid[0] + off, mid[1] + off - 4);
  ctx.restore();
}

function promptRouteConduit(typeId) {
  const install = (typeId === "power" || typeId === "light") ? "conduit" : "free";
  if (install === "free") return { install: "free", conduitMm: 16 };
  const mm = parseInt(prompt("Priemer chráničky (mm): 16, 20, 25, 32", "20"), 10);
  const conduitMm = CONDUIT_SIZES.includes(mm) ? mm : 20;
  const free = confirm("Trasa v chráničke? (Zrušiť = voľné vedenie)");
  return { install: free ? "conduit" : "free", conduitMm };
}

function renderRouteEditor() {
  const r = P().routes.find((x) => x.id === state.selectedRouteId);
  if (!r) return "";
  const warn = conduitFillWarning(r);
  return `
    <div class="elk-route-editor">
      <b>Trasa — ${esc(routeTypeById(r.type).name)}</b>
      <label>Vedenie
        <select data-route-install="${r.id}">
          <option value="conduit" ${r.install === "conduit" ? "selected" : ""}>V chráničke</option>
          <option value="free" ${r.install === "free" ? "selected" : ""}>Voľné / pod omietkou</option>
        </select>
      </label>
      <label>Priemer chráničky (mm)
        <select data-route-conduit="${r.id}">
          ${CONDUIT_SIZES.map((mm) => `<option value="${mm}" ${r.conduitMm === mm ? "selected" : ""}>${mm}</option>`).join("")}
        </select>
      </label>
      ${warn ? `<p class="elk-warn">⚠ ${esc(warn)}</p>` : ""}
    </div>`;
}

function bindRouteEditor() {
  const host = root();
  if (!host) return;
  host.querySelectorAll("[data-route-install]").forEach((sel) => sel.addEventListener("change", () => {
    const r = P().routes.find((x) => x.id === sel.dataset.routeInstall);
    if (r) { r.install = sel.value; persist(); refreshRouteEditor(); drawPlan(); }
  }));
  host.querySelectorAll("[data-route-conduit]").forEach((sel) => sel.addEventListener("change", () => {
    const r = P().routes.find((x) => x.id === sel.dataset.routeConduit);
    if (r) { r.conduitMm = parseInt(sel.value, 10); persist(); refreshRouteEditor(); drawPlan(); }
  }));
}

function refreshRouteEditor() {
  const box = document.getElementById("elkRouteEditor");
  if (box) { box.innerHTML = renderRouteEditor(); bindRouteEditor(); }
}

function conduitMaterialRows() {
  const p = P();
  const byMm = {};
  p.routes.filter((r) => r.install === "conduit").forEach((r) => {
    const mm = r.conduitMm || 16;
    const len = routeLengthM(r);
    byMm[mm] = (byMm[mm] || 0) + len;
  });
  return Object.keys(byMm).sort((a, b) => a - b).map((mm) => ({
    name: `Chránička Ø${mm} mm`,
    len: round2(byMm[mm] * (1 + (clampNum(p.material.reservePct) || 0) / 100))
  }));
}

function buildAuditReport() {
  const p = P();
  const totalEls = p.elements.length;
  const totalOk = p.elements.filter((e) => autoAuditStatus(e) === "ok").length;
  const panelVerified = p.circuits.filter((c) => c.panelVerified).length;
  const report = {
    version: 1,
    auditor: p.auditMeta?.auditor || "",
    completedAt: p.auditMeta?.completedAt || null,
    summary: {
      elementsTotal: totalEls,
      elementsOk: totalOk,
      overallPct: totalEls ? Math.round((totalOk / totalEls) * 100) : 0,
      panelVerified,
      panelTotal: p.circuits.length
    },
    rooms: p.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      ...roomAuditStats(r.id)
    })),
    elements: p.elements.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      room: p.rooms.find((r) => r.id === e.room)?.name || null,
      roomId: e.room,
      plannedZ: e.z,
      measuredZ: e.audit?.measuredZ ?? null,
      auditStatus: autoAuditStatus(e),
      issues: Array.isArray(e.audit?.issues) ? [...e.audit.issues] : [],
      note: e.audit?.note || "",
      hasPhoto: !!e.audit?.photo
    })),
    panel: p.circuits.map((c) => ({
      id: c.id,
      name: c.name,
      breaker: c.breaker || "",
      panelSlot: c.panelSlot || "",
      panelLabel: c.panelLabel || "",
      verified: !!c.panelVerified
    }))
  };
  if (p.ar3dCalib && typeof p.ar3dCalib === "object") {
    report.ar3dCalib = {
      at: p.ar3dCalib.at || null,
      scale: typeof p.ar3dCalib.scale === "number" ? p.ar3dCalib.scale : null,
      calibrated: !!(p.ar3dCalib.scale && p.ar3dCalib.at)
    };
  }
  return report;
}
