import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import apiRouter, { validateElectricianReport } from "../lib/routes/api.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("API integration", () => {
  const app = createTestApp();

  it("POST /api/portal/waitlist requires email", async () => {
    const res = await request(app).post("/api/portal/waitlist").send({ name: "Test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("POST /api/portal/waitlist accepts valid entry", async () => {
    const res = await request(app).post("/api/portal/waitlist").send({
      email: `test-${Date.now()}@example.com`,
      name: "Test User",
      company: "Test s.r.o.",
      source: "ci"
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeTruthy();
  });

  it("POST /api/auth/login rejects missing credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "x@test.com" });
    expect(res.status).toBe(400);
  });

  it("GET /api/catalog returns payload", async () => {
    const res = await request(app).get("/api/catalog");
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
  });

  it("POST /api/analytics/track requires auth", async () => {
    const res = await request(app).post("/api/analytics/track").send({
      events: [{ eventType: "test.event", module: "ci" }]
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/electrician/report rejects invalid JSON body shape", async () => {
    const res = await request(app).post("/api/electrician/report").send([]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON object/i);
  });

  it("POST /api/electrician/report rejects malformed audit.elements", async () => {
    const res = await request(app).post("/api/electrician/report").send({
      type: "electrician-plan",
      audit: { elements: [{ auditStatus: 42 }] }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/auditStatus/i);
  });

  it("POST /api/electrician/report rejects invalid audit.panel.verified type", async () => {
    const res = await request(app).post("/api/electrician/report").send({
      type: "electrician-plan",
      audit: { panel: [{ verified: "yes" }] }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/verified/i);
  });
});

describe("validateElectricianReport", () => {
  it("accepts a complete audit payload", () => {
    const body = validateElectricianReport({
      type: "electrician-plan",
      reportId: "rep-test",
      project: { id: "proj-1", name: "Byt 12" },
      audit: {
        version: 1,
        auditor: "Ján Novák",
        completedAt: "2026-06-28T10:00:00.000Z",
        summary: { elementsTotal: 2, elementsOk: 1, overallPct: 50, panelVerified: 1, panelTotal: 2 },
        rooms: [{ id: "r1", name: "Obývačka", total: 2, ok: 1, warn: 1, fail: 0, pending: 0, pct: 50 }],
        elements: [{
          id: "e1",
          label: "Z1",
          type: "outlet",
          room: "Obývačka",
          plannedZ: 300,
          measuredZ: 295,
          auditStatus: "ok",
          issues: [],
          note: "",
          hasPhoto: true
        }],
        panel: [{ name: "Osvetlenie", panelSlot: "FI1", panelLabel: "Osvetlenie obýv", verified: true }],
        ar3dCalib: { at: "2026-06-28T09:00:00.000Z", scale: 1.02, calibrated: true }
      }
    });
    expect(body.audit.summary.overallPct).toBe(50);
  });

  it("rejects oversized payload", () => {
    expect(() => validateElectricianReport({ type: "x" }, 9_000_000)).toThrow(/too large/i);
  });
});
