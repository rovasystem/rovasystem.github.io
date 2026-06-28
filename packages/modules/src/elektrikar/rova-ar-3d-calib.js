/**
 * ROVA Elektrikár — kalibrácia 2D plánu do ARCore sveta.
 * Wizard logika + planToWorld; HTML/DOM rieši integrátor (Agent 2).
 */

const DEFAULT_PX_PER_METER = 100;
const MIN_PLAN_DIST_M = 0.01;

/** @returns {number} */
export function resolvePxPerMeter(pxPerMeter, warn) {
  if (pxPerMeter != null && Number(pxPerMeter) > 0) return Number(pxPerMeter);
  if (typeof warn === "function") {
    warn("pxPerMeter chýba — použitý fallback 100 px/m");
  }
  return DEFAULT_PX_PER_METER;
}

/**
 * Mierka: pomer AR vzdialenosti (m) k plan vzdialenosti (m).
 */
export function computeScale(planX1, planY1, planX2, planY2, ax, az, bx, bz, pxPerMeter) {
  const ppm = resolvePxPerMeter(pxPerMeter);
  const planD = Math.hypot(planX2 - planX1, planY2 - planY1) / ppm;
  const arD = Math.hypot(bx - ax, bz - az);
  if (planD <= MIN_PLAN_DIST_M) return 1;
  return arD / planD;
}

/**
 * Rotácia v XZ rovine: rozdiel uhla plan vs AR medzi dvoma bodmi.
 */
export function computeRotation(planX1, planY1, planX2, planY2, ax, az, bx, bz) {
  const planA = Math.atan2(planX2 - planX1, -(planY2 - planY1));
  const arA = Math.atan2(bx - ax, bz - az);
  return arA - planA;
}

/** planPx → world meters; Y = heightMm/1000 */
export function planToWorldFromCalib(cal, ix, iy, heightMm) {
  if (!cal || cal.ax == null) return [0, (Number(heightMm) || 0) / 1000, 0];
  const ppm = resolvePxPerMeter(cal.pxPerMeter);
  const dx = (ix - cal.planX1) / ppm;
  const dz = (iy - cal.planY1) / ppm;
  const c = Math.cos(cal.rot || 0);
  const s = Math.sin(cal.rot || 0);
  const scale = cal.scale ?? 1;
  const sx = dx * scale;
  const sz = dz * scale;
  const wx = cal.ax + sx * c - sz * s;
  const wz = cal.az + sx * s + sz * c;
  return [wx, (Number(heightMm) || 0) / 1000, wz];
}

export function buildSavedCalib(draft) {
  return {
    ax: draft.ax,
    ay: draft.ay,
    az: draft.az,
    planX1: draft.planX1,
    planY1: draft.planY1,
    scale: draft.scale,
    rot: draft.rot,
    pxPerMeter: draft.pxPerMeter,
    at: draft.at || new Date().toISOString()
  };
}

/** UX texty pre integrátora (bez HTML). */
export function wizardStepTitle(step) {
  switch (step) {
    case 1:
      return "Krok 1/3: Ukotvenie";
    case 2:
      return "Krok 2/3: Mierka";
    case 3:
      return "Krok 3/3: Hotovo";
    default:
      return "Kalibrácia 3D plánu";
  }
}

export function wizardStepMessage(step) {
  switch (step) {
    case 1:
      return "Ťukni na roh miestnosti na podlahe (AR), potom vyber zodpovedajúci bod na 2D pláne.";
    case 2:
      return "Ťukni na druhý bod na podlahe (AR), potom vyber druhý bod na pláne pre mierku a rotáciu.";
    case 3:
      return "Kalibrácia dokončená — transformácia planPx → svet je pripravená.";
    default:
      return "";
  }
}

export function wizardNoHitMessage() {
  return "Nenašla sa plocha. Namier na podlahu alebo stenu a skús znova.";
}

export function wizardArErrorMessage(err) {
  const msg = err?.message || String(err || "neznáma chyba");
  return "ARCore chyba: " + msg;
}

export function wizardStatusLabel(step) {
  switch (step) {
    case 1:
      return "Kalibrácia: čaká na bod 1";
    case 2:
      return "Kalibrácia: bod 1 hotový";
    case 3:
      return "Kalibrácia hotová";
    default:
      return "";
  }
}

function defaultPlanPoint(project, corner) {
  const plan = project?.plan;
  if (plan?.w != null && plan?.h != null) {
    const t = corner === "second" ? 0.9 : 0.1;
    return { x: plan.w * t, y: plan.h * t };
  }
  return corner === "second" ? { x: 800, y: 600 } : { x: 80, y: 60 };
}

function createCalibApi() {
  let pluginRef = null;
  let projectRef = null;
  let callbacks = {};
  /** @type {null | object} */
  let cal = null;
  /** 0 idle, 1 need plan1, 2 need ar2, 3 need plan2, 4 ready */
  let phase = 0;
  let draft = null;

  function notifyStep(step) {
    callbacks.onStep?.(step, {
      title: wizardStepTitle(step),
      message: wizardStepMessage(step),
      status: wizardStatusLabel(step)
    });
  }

  function resetWizard() {
    phase = 0;
    draft = null;
    pluginRef = null;
    projectRef = null;
    callbacks = {};
  }

  async function handleArTap(clientX, clientY, stageEl) {
    if (!pluginRef || !stageEl || phase === 0 || phase === 4) return false;
    if (phase !== 1 && phase !== 3) return false;

    const rect = stageEl.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    try {
      const { hits } = await pluginRef.hitTest({ x, y });
      if (!hits?.length) {
        callbacks.onError?.(wizardNoHitMessage());
        return false;
      }
      const hit = hits[0];

      if (phase === 1) {
        draft = {
          ax: hit.pose.tx,
          ay: hit.pose.ty,
          az: hit.pose.tz,
          planX1: null,
          planY1: null,
          bx: null,
          by: hit.pose.ty,
          bz: null,
          planX2: null,
          planY2: null,
          scale: 1,
          rot: 0,
          pxPerMeter: projectRef?.pxPerMeter ?? null
        };
        try {
          await pluginRef.createAnchor?.({ pose: hit.pose });
        } catch (_) {}
        phase = 2;
        notifyStep(1);
        callbacks.onPlanPointRequest?.(1, (planX, planY) => {
          setPlanPoint(planX, planY);
        });
        return true;
      }

      if (phase === 3) {
        draft.bx = hit.pose.tx;
        draft.by = hit.pose.ty;
        draft.bz = hit.pose.tz;
        phase = 4;
        callbacks.onPlanPointRequest?.(2, (planX, planY) => {
          setPlanPoint(planX, planY);
        });
        return true;
      }
    } catch (e) {
      callbacks.onError?.(wizardArErrorMessage(e));
    }
    return false;
  }

  function setPlanPoint(planX, planY) {
    if (!draft) return false;

    if (phase === 2) {
      draft.planX1 = planX;
      draft.planY1 = planY;
      phase = 3;
      notifyStep(2);
      return true;
    }

    if (phase === 4 && draft.planX2 == null) {
      draft.planX2 = planX;
      draft.planY2 = planY;
      draft.scale = computeScale(
        draft.planX1,
        draft.planY1,
        draft.planX2,
        draft.planY2,
        draft.ax,
        draft.az,
        draft.bx,
        draft.bz,
        draft.pxPerMeter
      );
      draft.rot = computeRotation(
        draft.planX1,
        draft.planY1,
        draft.planX2,
        draft.planY2,
        draft.ax,
        draft.az,
        draft.bx,
        draft.bz
      );
      draft.pxPerMeter = resolvePxPerMeter(draft.pxPerMeter, (w) => callbacks.onWarning?.(w));

      const saved = buildSavedCalib(draft);
      cal = { ...saved };
      if (projectRef) {
        projectRef.ar3dCalib = saved;
        callbacks.onProjectSave?.(projectRef);
      }
      notifyStep(3);
      callbacks.onComplete?.(saved);
      phase = 0;
      draft = null;
      return true;
    }
    return false;
  }

  function startWizard(plugin, project, cbs) {
    cancel();
    if (!plugin?.hitTest) {
      cbs?.onError?.("ARCore plugin nie je k dispozícii.");
      return false;
    }
    pluginRef = plugin;
    projectRef = project;
    callbacks = cbs || {};
    cal = null;
    draft = null;
    phase = 1;
    notifyStep(1);
    return true;
  }

  function cancel() {
    resetWizard();
  }

  function isReady() {
    return cal != null && cal.ax != null && cal.scale != null;
  }

  function planToWorld(ix, iy, heightMm) {
    return planToWorldFromCalib(cal, ix, iy, heightMm);
  }

  function getCalib() {
    return cal ? { ...cal } : null;
  }

  function applySavedCalib(project) {
    const saved = project?.ar3dCalib;
    if (saved?.ax != null && saved?.scale != null) {
      cal = { ...saved };
      phase = 0;
      return true;
    }
    cal = null;
    return false;
  }

  /** Integrátor volá z click handlera na AR stage. */
  function handleTap(ev, stageEl) {
    return handleArTap(ev.clientX, ev.clientY, stageEl);
  }

  /** Automatické body na pláne ak integrátor nevolá setPlanPoint. */
  function useDefaultPlanPoint(which) {
    if (!projectRef || !draft) return false;
    const pt = defaultPlanPoint(projectRef, which === 2 ? "second" : "first");
    return setPlanPoint(pt.x, pt.y);
  }

  return {
    startWizard,
    cancel,
    isReady,
    planToWorld,
    getCalib,
    applySavedCalib,
    handleTap,
    setPlanPoint,
    useDefaultPlanPoint,
    wizardStepTitle,
    wizardStepMessage,
    wizardNoHitMessage,
    wizardArErrorMessage,
    wizardStatusLabel
  };
}

const api = createCalibApi();

if (typeof globalThis !== "undefined") {
  globalThis.RovaAr3dCalib = api;
}

export default api;
