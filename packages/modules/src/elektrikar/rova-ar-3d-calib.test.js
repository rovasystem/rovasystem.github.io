/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import {
  resolvePxPerMeter,
  computeScale,
  computeRotation,
  planToWorldFromCalib,
  buildSavedCalib,
  wizardStepTitle,
  wizardStepMessage
} from "./rova-ar-3d-calib.js";

describe("resolvePxPerMeter", () => {
  it("returns valid pxPerMeter when set", () => {
    expect(resolvePxPerMeter(120)).toBe(120);
  });

  it("falls back to 100 and warns when null", () => {
    const warn = vi.fn();
    expect(resolvePxPerMeter(null, warn)).toBe(100);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pxPerMeter"));
  });

  it("falls back when zero or negative", () => {
    expect(resolvePxPerMeter(0)).toBe(100);
    expect(resolvePxPerMeter(-5)).toBe(100);
  });
});

describe("computeScale", () => {
  it("matches AR distance to plan distance in meters", () => {
    const scale = computeScale(0, 0, 200, 0, 0, 0, 2, 0, 100);
    expect(scale).toBeCloseTo(1);
  });

  it("scales when AR distance differs from plan", () => {
    const scale = computeScale(0, 0, 100, 0, 0, 0, 3, 0, 100);
    expect(scale).toBeCloseTo(3);
  });

  it("returns 1 when plan distance is too small", () => {
    expect(computeScale(0, 0, 0.5, 0, 0, 0, 5, 0, 100)).toBe(1);
  });
});

describe("computeRotation", () => {
  it("is zero when plan and AR align on +X", () => {
    const rot = computeRotation(0, 0, 100, 0, 0, 0, 1, 0);
    expect(rot).toBeCloseTo(0);
  });

  it("matches 90° turn in XZ plane", () => {
    const rot = computeRotation(0, 0, 0, -100, 0, 0, 0, 1);
    expect(rot).toBeCloseTo(0);
  });

  it("detects plan vs AR angle offset", () => {
    const rot = computeRotation(0, 0, 100, 0, 0, 0, 0, 1);
    expect(rot).toBeCloseTo(-Math.PI / 2);
  });
});

describe("planToWorldFromCalib", () => {
  const cal = {
    ax: 1,
    ay: 0,
    az: 2,
    planX1: 100,
    planY1: 100,
    scale: 1,
    rot: 0,
    pxPerMeter: 100
  };

  it("returns origin for plan anchor with height in meters on Y", () => {
    expect(planToWorldFromCalib(cal, 100, 100, 250)).toEqual([1, 0.25, 2]);
  });

  it("offsets in plan X as world X when rot=0", () => {
    const [x, y, z] = planToWorldFromCalib(cal, 200, 100, 0);
    expect(x).toBeCloseTo(2);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(2);
  });

  it("uses pxPerMeter fallback when null", () => {
    const warn = vi.fn();
    const c = { ...cal, pxPerMeter: null };
    const [x] = planToWorldFromCalib(c, 200, 100, 0);
    expect(x).toBeCloseTo(2);
    resolvePxPerMeter(null, warn);
    expect(warn).toHaveBeenCalled();
  });

  it("returns zero baseline without calib", () => {
    expect(planToWorldFromCalib(null, 50, 50, 1000)).toEqual([0, 1, 0]);
  });
});

describe("buildSavedCalib", () => {
  it("persists only serializable fields", () => {
    const saved = buildSavedCalib({
      ax: 0,
      ay: 0.1,
      az: 0,
      planX1: 10,
      planY1: 20,
      scale: 1.5,
      rot: 0.2,
      pxPerMeter: 100,
      at: "2026-06-28T12:00:00.000Z",
      bx: 99,
      planX2: 800
    });
    expect(saved).toEqual({
      ax: 0,
      ay: 0.1,
      az: 0,
      planX1: 10,
      planY1: 20,
      scale: 1.5,
      rot: 0.2,
      pxPerMeter: 100,
      at: "2026-06-28T12:00:00.000Z"
    });
  });
});

describe("wizard UX texts", () => {
  it("exports step titles and messages", () => {
    expect(wizardStepTitle(1)).toContain("Krok 1");
    expect(wizardStepMessage(2)).toMatch(/druhý bod/i);
  });
});

describe("RovaAr3dCalib API", () => {
  it("applySavedCalib loads project calib and planToWorld works", async () => {
    await import("./rova-ar-3d-calib.js");
    const api = globalThis.RovaAr3dCalib;
    const project = {
      ar3dCalib: {
        ax: 0,
        ay: 0,
        az: 0,
        planX1: 0,
        planY1: 0,
        scale: 2,
        rot: 0,
        pxPerMeter: 100,
        at: "2026-01-01T00:00:00.000Z"
      }
    };
    expect(api.applySavedCalib(project)).toBe(true);
    expect(api.isReady()).toBe(true);
    const w = api.planToWorld(100, 0, 500);
    expect(w[0]).toBeCloseTo(2);
    expect(w[1]).toBeCloseTo(0.5);
    expect(w[2]).toBeCloseTo(0);
  });
});
