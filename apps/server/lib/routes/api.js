import { Router } from "express";
import {
  loginUser,
  registerUser,
  getSession,
  requireAuth,
  attachUser,
  requireRole,
  listUsers,
  createUser,
  serializeUser,
  loadUserWithRoles,
  hasRole
} from "../auth.js";
import {
  getOnboarding,
  saveOnboarding,
  completeOnboarding,
  getTenantConfig,
  previewPricing,
  addWaitlistEntry
} from "../tenants.js";
import { catalogPayload } from "../catalog.js";
import { getDefaultOrgId } from "../repositories/snapshot.js";
import { getPool } from "../db.js";
import {
  createNotification,
  getUserNotifications,
  markNotificationRead,
  countUnreadNotifications,
  notifyScheduleEvent,
  resolveScheduleNotifyUsers
} from "../notifications.js";
import { trackEvent, trackEventBatch, getAnalyticsSummary } from "../analytics.js";
import { readJson, writeJson, hasDatabase } from "../json-store.js";
import {
  geocodeAddress,
  getRegionProfile,
  resolveRegionFromLocation,
  saveAddress
} from "../region.js";
import { requireMobileAuth } from "../middleware/mobile-auth.js";
import { createRateLimiter, registrationAllowed, safeErrorMessage } from "../security.js";

const router = Router();

const authRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: Number(process.env.ROVA_AUTH_RATE_LIMIT || 30),
  keyFn: (req) => `auth:${req.ip || req.socket?.remoteAddress || "unknown"}`
});

function orgId(req) {
  return req.orgId || req.user?.orgId || getDefaultOrgId();
}

/* ---------- Auth ---------- */
router.post("/auth/register", authRateLimit, async (req, res) => {
  if (!registrationAllowed()) {
    return res.status(403).json({ error: "Registration is disabled" });
  }
  try {
    const result = await registerUser(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: safeErrorMessage(err, err.message) });
  }
});

router.post("/auth/login", authRateLimit, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const result = await loginUser(email, password);
    res.json({ token: result.token, user: result.user });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Invalid credentials" });
  }
});

router.get("/auth/session", async (req, res) => {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "No session" });
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: "Invalid session" });
  res.json(session);
});

router.post("/portal/waitlist", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email required" });
    const entry = await addWaitlistEntry({ ...req.body, email });
    res.status(201).json({ ok: true, id: entry.id });
  } catch (err) {
    next(err);
  }
});

router.get("/catalog", (_req, res) => {
  res.json(catalogPayload());
});

router.post("/pricing/preview", (req, res) => {
  res.json(previewPricing(req.body || {}));
});

router.get("/onboarding", requireAuth, attachUser, async (req, res, next) => {
  try {
    const data = await getOnboarding(req.user.orgId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post("/onboarding", requireAuth, attachUser, async (req, res, next) => {
  try {
    const saved = await saveOnboarding(req.user.orgId, req.body || {});
    res.json({ ok: true, data: saved });
  } catch (err) {
    next(err);
  }
});

router.post("/onboarding/complete", requireAuth, attachUser, async (req, res, next) => {
  try {
    const template = await completeOnboarding(req.user.orgId, req.body || {});
    res.json({
      ok: true,
      tenantConfig: template.tenantConfig,
      pricing: template.pricing,
      user: { ...req.user, onboardingComplete: true, tenantConfig: template.tenantConfig }
    });
  } catch (err) {
    next(err);
  }
});

router.get("/tenant/config", requireAuth, attachUser, async (req, res, next) => {
  try {
    const config = await getTenantConfig(req.user.orgId);
    res.json(config || {});
  } catch (err) {
    next(err);
  }
});

router.get("/auth/me", requireAuth, attachUser, (req, res) => {
  res.json({ user: serializeUser(req.user) });
});

router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

router.get("/users", requireAuth, attachUser, requireRole("admin", "nadriadeny", "company_boss"), async (req, res, next) => {
  try {
    const users = await listUsers(orgId(req));
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.post("/users", requireAuth, attachUser, requireRole("admin", "nadriadeny", "company_boss"), async (req, res, next) => {
  try {
    const user = await createUser(orgId(req), req.body || {});
    res.status(201).json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

/* ---------- Parties ---------- */
router.get("/parties", requireAuth, attachUser, async (req, res, next) => {
  try {
    const pool = getPool();
    const projectId = req.query.projectId;
    let q = "SELECT * FROM parties WHERE org_id = $1";
    const params = [orgId(req)];
    if (projectId) {
      q += " AND (project_id = $2 OR project_id IS NULL)";
      params.push(projectId);
    }
    q += " ORDER BY name";
    const res2 = await pool.query(q, params);
    res.json({ parties: res2.rows.map(formatParty) });
  } catch (err) {
    next(err);
  }
});

router.post("/parties", requireAuth, attachUser, requireRole("admin", "nadriadeny", "stavbyveduci"), async (req, res, next) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    const oid = orgId(req);
    const id = b.id || `party-${Date.now().toString(36)}`;

    const existing = await pool.query("SELECT org_id FROM parties WHERE id = $1", [id]);
    if (existing.rows[0] && existing.rows[0].org_id !== oid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await pool.query(
      `INSERT INTO parties (id, org_id, company_id, name, leader_user_id, member_user_ids, project_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         name = EXCLUDED.name,
         leader_user_id = EXCLUDED.leader_user_id,
         member_user_ids = EXCLUDED.member_user_ids,
         project_id = EXCLUDED.project_id,
         updated_at = NOW()
       WHERE parties.org_id = EXCLUDED.org_id`,
      [
        id,
        oid,
        b.companyId || null,
        b.name,
        b.leaderUserId || null,
        JSON.stringify(b.memberUserIds || []),
        b.projectId || null
      ]
    );
    const row = (await pool.query("SELECT * FROM parties WHERE id = $1 AND org_id = $2", [id, oid])).rows[0];
    if (!row) return res.status(403).json({ error: "Forbidden" });
    res.json({ party: formatParty(row) });
  } catch (err) {
    next(err);
  }
});

router.delete("/parties/:id", requireAuth, attachUser, requireRole("admin", "nadriadeny", "stavbyveduci"), async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM parties WHERE id = $1 AND org_id = $2", [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- Schedule workflow ---------- */
router.post("/schedule/workflow", requireAuth, attachUser, async (req, res, next) => {
  try {
    const { scheduleItem, action } = req.body || {};
    if (!scheduleItem?.id || !action) return res.status(400).json({ error: "scheduleItem and action required" });

    const user = req.user;
    let workflowStatus = scheduleItem.workflowStatus || "draft";
    const updates = { ...scheduleItem };

    if (action === "submit") {
      if (!hasRole(user, "stavbyveduci", "nadriadeny", "admin")) {
        return res.status(403).json({ error: "Cannot submit schedule" });
      }
      workflowStatus = "pending";
    } else if (action === "approve") {
      if (!hasRole(user, "nadriadeny", "admin")) {
        return res.status(403).json({ error: "Cannot approve schedule" });
      }
      workflowStatus = "approved";
      updates.approvedBy = user.id;
      updates.approvedAt = new Date().toISOString();
    } else if (action === "reject") {
      if (!hasRole(user, "nadriadeny", "admin")) {
        return res.status(403).json({ error: "Cannot reject schedule" });
      }
      workflowStatus = "draft";
    } else if (action === "publish") {
      if (!hasRole(user, "nadriadeny", "admin", "stavbyveduci")) {
        return res.status(403).json({ error: "Cannot publish schedule" });
      }
      workflowStatus = "published";
      const userIds = await resolveScheduleNotifyUsers(scheduleItem, orgId(req));
      await notifyScheduleEvent("schedule.published", scheduleItem, userIds, orgId(req));
      await trackEvent({
        orgId: orgId(req),
        userId: user.id,
        eventType: "schedule.publish",
        projectId: scheduleItem.projectId,
        module: "schedule",
        payload: { scheduleId: scheduleItem.id }
      });
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }

    updates.workflowStatus = workflowStatus;
    res.json({ scheduleItem: updates });
  } catch (err) {
    next(err);
  }
});

/* ---------- Notifications ---------- */
router.get("/notifications", requireAuth, attachUser, async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === "true";
    const items = await getUserNotifications(req.user.id, { unreadOnly });
    const unread = await countUnreadNotifications(req.user.id);
    res.json({ notifications: items, unread });
  } catch (err) {
    next(err);
  }
});

router.post("/notifications/:id/read", requireAuth, attachUser, async (req, res, next) => {
  try {
    await markNotificationRead(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- Analytics ---------- */
router.post("/analytics/event", requireAuth, attachUser, async (req, res, next) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    await trackEventBatch(events, orgId(req), req.user?.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/analytics/track", requireAuth, attachUser, async (req, res, next) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    await trackEventBatch(events, orgId(req), req.user?.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/analytics/summary", requireAuth, attachUser, requireRole("admin", "nadriadeny"), async (req, res, next) => {
  try {
    const days = Number(req.query.days || 30);
    const summary = await getAnalyticsSummary(orgId(req), days);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/* ---------- Region / address ---------- */
router.post("/region/geocode", async (req, res, next) => {
  try {
    const geo = await geocodeAddress(req.body || {});
    if (!geo) return res.status(404).json({ error: "Address not found" });
    const region = await getRegionProfile(geo.countryCode);
    res.json({ geo, region });
  } catch (err) {
    next(err);
  }
});

router.post("/region/resolve", async (req, res, next) => {
  try {
    const region = await resolveRegionFromLocation(req.body?.location);
    res.json({ region });
  } catch (err) {
    next(err);
  }
});

router.post("/addresses", requireAuth, attachUser, async (req, res, next) => {
  try {
    const result = await saveAddress(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/region/:countryCode", async (req, res, next) => {
  try {
    const region = await getRegionProfile(req.params.countryCode);
    res.json({ region });
  } catch (err) {
    next(err);
  }
});

/* ---------- Mobile reports ---------- */
router.post("/painter/report", requireMobileAuth, async (req, res, next) => {
  try {
    await ingestFieldReport("painter", req.body, req.orgId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/electrician/report", requireMobileAuth, async (req, res, next) => {
  try {
    const rawSize = Number(req.get("content-length") || 0) || JSON.stringify(req.body ?? {}).length;
    const payload = validateElectricianReport(req.body, rawSize);
    await ingestFieldReport("electrician", payload, req.orgId);
    res.json({ ok: true, reportId: payload.reportId || null, auditSummary: summarizeAudit(payload.audit) });
  } catch (err) {
    next(err);
  }
});

router.post("/inspection/report", requireMobileAuth, async (req, res, next) => {
  try {
    await ingestInspectionReport(req.body, req.orgId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/inspection/reports", requireAuth, attachUser, async (req, res, next) => {
  try {
    res.json({ reports: await listInspectionReports(orgId(req)) });
  } catch (err) {
    next(err);
  }
});

/* ---------- AI feedback & knowledge ---------- */
router.post("/ai/feedback", requireAuth, attachUser, async (req, res, next) => {
  try {
    const { question, answer, vote, trade, regionCode } = req.body || {};
    if (!question || !vote) return res.status(400).json({ error: "question and vote required" });
    const pool = getPool();
    const inserted = await pool.query(
      `INSERT INTO ai_feedback (org_id, user_id, question, answer, vote, trade, region_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [orgId(req), req.user.id, question, answer || null, vote, trade || null, regionCode || null]
    );
    if (vote === "up" && answer) {
      await pool.query(
        `INSERT INTO ai_knowledge_candidates (org_id, question, answer, trade, region_code, source_feedback_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId(req), question, answer, trade || null, regionCode || null, inserted.rows[0].id]
      );
    }
    await trackEvent({
      orgId: orgId(req),
      userId: req.user.id,
      eventType: "ai.feedback",
      module: "ai",
      payload: { vote }
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/ai/knowledge/candidates", requireAuth, attachUser, requireRole("admin", "nadriadeny"), async (req, res, next) => {
  try {
    const pool = getPool();
    const res2 = await pool.query(
      `SELECT * FROM ai_knowledge_candidates
       WHERE org_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 100`,
      [orgId(req)]
    );
    res.json({ candidates: res2.rows });
  } catch (err) {
    next(err);
  }
});

router.post("/ai/knowledge/approve", requireAuth, attachUser, requireRole("admin", "nadriadeny"), async (req, res, next) => {
  try {
    const { candidateId, approve } = req.body || {};
    const pool = getPool();
    const status = approve ? "approved" : "rejected";
    await pool.query(
      `UPDATE ai_knowledge_candidates
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3 AND org_id = $4`,
      [status, req.user.id, candidateId, orgId(req)]
    );
    if (approve) {
      const cand = (await pool.query(
        "SELECT * FROM ai_knowledge_candidates WHERE id = $1",
        [candidateId]
      )).rows[0];
      if (cand) {
        await pool.query(
          `INSERT INTO map_assets (org_id, project_id, building_id, suffix, payload, updated_at)
           VALUES ($1, 'global', 'ai', 'knowledge-corpus', $2, NOW())
           ON CONFLICT (org_id, project_id, building_id, suffix)
           DO UPDATE SET payload = map_assets.payload || $2::jsonb, updated_at = NOW()`,
          [
            orgId(req),
            JSON.stringify({
              entries: [{
                id: `kb-${candidateId}`,
                title: cand.question.slice(0, 80),
                trade: cand.trade || "all",
                keywords: cand.question.toLowerCase().split(/\s+/).slice(0, 8),
                procedure: [cand.answer],
                source: "user_feedback"
              }]
            })
          ]
        );
      }
    }
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

router.get("/ai/knowledge/corpus", requireAuth, attachUser, async (req, res, next) => {
  try {
    const pool = getPool();
    const row = (await pool.query(
      `SELECT payload FROM map_assets
       WHERE org_id = $1 AND project_id = 'global' AND building_id = 'ai' AND suffix = 'knowledge-corpus'`,
      [orgId(req)]
    )).rows[0];
    res.json(row?.payload || { entries: [] });
  } catch (err) {
    next(err);
  }
});

const ELECTRICIAN_REPORT_MAX_BYTES = Number(process.env.ROVA_ELECTRICIAN_REPORT_MAX_BYTES || 8_000_000);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function validateAuditElement(el, idx) {
  if (el == null || typeof el !== "object" || Array.isArray(el)) {
    throw badRequest(`audit.elements[${idx}] must be an object`);
  }
  if (el.auditStatus != null && typeof el.auditStatus !== "string") {
    throw badRequest(`audit.elements[${idx}].auditStatus must be a string`);
  }
  if (el.measuredZ != null && typeof el.measuredZ !== "number") {
    throw badRequest(`audit.elements[${idx}].measuredZ must be a number or null`);
  }
  if (el.issues != null && !Array.isArray(el.issues)) {
    throw badRequest(`audit.elements[${idx}].issues must be an array`);
  }
  if (el.hasPhoto != null && typeof el.hasPhoto !== "boolean") {
    throw badRequest(`audit.elements[${idx}].hasPhoto must be a boolean`);
  }
}

function validateAuditPayload(audit) {
  if (audit == null) return;
  if (typeof audit !== "object" || Array.isArray(audit)) {
    throw badRequest("audit must be an object");
  }
  if (audit.rooms != null && !Array.isArray(audit.rooms)) {
    throw badRequest("audit.rooms must be an array");
  }
  if (audit.elements != null) {
    if (!Array.isArray(audit.elements)) throw badRequest("audit.elements must be an array");
    audit.elements.forEach(validateAuditElement);
  }
  if (audit.panel != null && !Array.isArray(audit.panel)) {
    throw badRequest("audit.panel must be an array");
  }
  if (audit.panel != null) {
    audit.panel.forEach((slot, idx) => {
      if (slot == null || typeof slot !== "object" || Array.isArray(slot)) {
        throw badRequest(`audit.panel[${idx}] must be an object`);
      }
      if (slot.verified != null && typeof slot.verified !== "boolean") {
        throw badRequest(`audit.panel[${idx}].verified must be a boolean`);
      }
    });
  }
  if (audit.ar3dCalib != null && (typeof audit.ar3dCalib !== "object" || Array.isArray(audit.ar3dCalib))) {
    throw badRequest("audit.ar3dCalib must be an object");
  }
}

export function validateElectricianReport(body, rawSize = 0) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Report body must be a JSON object");
  }
  if (rawSize > ELECTRICIAN_REPORT_MAX_BYTES) {
    throw Object.assign(
      new Error(`Report payload too large (max ${ELECTRICIAN_REPORT_MAX_BYTES} bytes)`),
      { status: 413 }
    );
  }
  if (body.type != null && typeof body.type !== "string") {
    throw badRequest("type must be a string");
  }
  if (body.project != null && (typeof body.project !== "object" || Array.isArray(body.project))) {
    throw badRequest("project must be an object");
  }
  validateAuditPayload(body.audit);
  return body;
}

function summarizeAudit(audit) {
  if (!audit || typeof audit !== "object") return null;
  const summary = audit.summary || {};
  const rooms = Array.isArray(audit.rooms) ? audit.rooms.length : 0;
  const elements = Array.isArray(audit.elements) ? audit.elements.length : 0;
  const panelVerified = Array.isArray(audit.panel)
    ? audit.panel.filter((s) => s?.verified).length
    : summary.panelVerified ?? 0;
  return {
    auditor: audit.auditor || null,
    completedAt: audit.completedAt || null,
    overallPct: summary.overallPct ?? null,
    rooms,
    elements,
    panelVerified,
    hasAr3dCalib: !!audit.ar3dCalib
  };
}

async function ingestFieldReport(type, payload, orgId) {
  const pool = getPool();
  const projectId = payload?.project?.id || payload?.projectId || null;
  await pool.query(
    `INSERT INTO field_reports (org_id, type, project_id, payload) VALUES ($1, $2, $3, $4)`,
    [orgId || getDefaultOrgId(), type, projectId, JSON.stringify(payload || {})]
  );
  await trackEvent({
    orgId: orgId || getDefaultOrgId(),
    eventType: "mobile.sync",
    projectId: payload?.projectId,
    module: type,
    payload: { synced: true }
  });
}

async function ingestInspectionReport(payload, orgId) {
  const oid = orgId || getDefaultOrgId();
  if (hasDatabase()) {
    try {
      await ingestFieldReport("inspection", payload, oid);
      return;
    } catch { /* fall through to file store */ }
  }
  const key = "inspection-reports.json";
  const list = readJson(key, []);
  const id = payload?.reportId || payload?.inspection?.id || `insp-${Date.now()}`;
  const idx = list.findIndex((r) => r.reportId === id);
  const row = { reportId: id, orgId: oid, savedAt: new Date().toISOString(), payload };
  if (idx >= 0) list[idx] = row;
  else list.unshift(row);
  writeJson(key, list.slice(0, 500));
  await trackEvent({
    orgId: oid,
    eventType: "mobile.sync",
    projectId: payload?.inspection?.projectId,
    module: "inspection",
    payload: { synced: true }
  }).catch(() => {});
}

async function listInspectionReports(orgId) {
  const oid = orgId || getDefaultOrgId();
  if (hasDatabase()) {
    try {
      const pool = getPool();
      const res = await pool.query(
        `SELECT payload, created_at FROM field_reports WHERE org_id = $1 AND type = 'inspection' ORDER BY created_at DESC LIMIT 100`,
        [oid]
      );
      return res.rows.map((r) => ({ ...r.payload, savedAt: r.created_at }));
    } catch { /* file fallback */ }
  }
  return readJson("inspection-reports.json", []).filter((r) => r.orgId === oid);
}

function formatParty(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    leaderUserId: row.leader_user_id,
    memberUserIds: row.member_user_ids || [],
    projectId: row.project_id,
    updatedAt: row.updated_at
  };
}

export default router;
