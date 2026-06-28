/**
 * ROVA Elektrikár — 3D AR režim (ARCore + WebGL).
 * Paralelný k existujúcemu 2D overlay — prepínanie tlačidlom v AR záložke.
 */
(function () {
  "use strict";

  let plugin = null;
  let active = false;
  let raf = 0;
  let gl = null;
  let prog = null;
  let buf = null;
  let uVpLoc = null;
  let uColorLoc = null;
  let calStep = 0;
  let cal = null;
  let tapHandler = null;
  let resizeHandler = null;

  let layers = {
    routes: true,
    elements: true,
    penetrations: true,
    conduit: true
  };

  /** @type {{ lineGroups: { color: number[], positions: Float32Array }[], pointGroups: { color: number[], positions: Float32Array, size: number }[] }} */
  let geom = { lineGroups: [], pointGroups: [] };

  const COLORS = {
    power: [0.12, 0.61, 1, 0.9],
    light: [1, 0.85, 0.29, 0.9],
    data: [0.38, 0.96, 1, 0.9],
    ground: [0.22, 0.92, 0.66, 0.9],
    conduit: [0.68, 0.8, 0.9, 0.85],
    element: [1, 0.75, 0.29, 1],
    pen: [1, 0.33, 0.44, 1]
  };

  const ROUTE_H_MM = { power: 250, light: 260, data: 250, ground: 60 };

  async function getPlugin() {
    if (plugin) return plugin;
    try {
      const cap = window.Capacitor;
      if (!cap?.isNativePlatform?.()) return null;
      plugin = cap.Plugins?.RovaArCore || cap.registerPlugin?.("RovaArCore");
      return plugin || null;
    } catch (_) {
      return null;
    }
  }

  function project() {
    return window.RovaElektrikar?.state?.project;
  }

  function setMsg(html, show) {
    const msg = document.getElementById("elkArMsg");
    if (!msg) return;
    msg.style.display = show === false ? "none" : "";
    if (html != null) msg.innerHTML = html;
  }

  function setCalibUi(text) {
    const el = document.getElementById("elkAr3dCalib");
    if (el) el.textContent = text || "";
  }

  async function syncDisplayGeometry() {
    const stage = document.getElementById("elkArStage");
    const p = await getPlugin();
    if (!stage || !p) return;
    const rect = stage.getBoundingClientRect();
    await p.setDisplayGeometry({
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rotation: screen.orientation?.angle ? Math.round(screen.orientation.angle) : 0
    });
  }

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function initGl() {
    const canvas = document.getElementById("elkAr3dCanvas");
    if (!canvas) return false;
    gl = canvas.getContext("webgl", { alpha: true, antialias: true });
    if (!gl) return false;
    const vs = compileShader(
      gl.VERTEX_SHADER,
      `
      attribute vec3 aPos;
      uniform mat4 uVp;
      uniform float uPointSize;
      void main() {
        gl_Position = uVp * vec4(aPos, 1.0);
        gl_PointSize = uPointSize;
      }
    `
    );
    const fs = compileShader(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      uniform vec4 uColor;
      void main() { gl_FragColor = uColor; }
    `
    );
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    buf = gl.createBuffer();
    uVpLoc = gl.getUniformLocation(prog, "uVp");
    uColorLoc = gl.getUniformLocation(prog, "uColor");
    gl.useProgram(prog);
    gl.enableVertexAttribArray(0);
    return true;
  }

  async function resizeGl() {
    const canvas = document.getElementById("elkAr3dCanvas");
    const stage = document.getElementById("elkArStage");
    if (!canvas || !stage || !gl) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
    await syncDisplayGeometry();
  }

  function mulMat4(a, b, out) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[j * 4 + i] =
          a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      }
    }
    return out;
  }

  function mvpFromFrame(frame) {
    const vp = new Float32Array(16);
    mulMat4(new Float32Array(frame.projectionMatrix), new Float32Array(frame.viewMatrix), vp);
    return vp;
  }

  function planToWorld(ix, iy, heightMm) {
    const ext = window.RovaAr3dCalib?.planToWorld;
    if (typeof ext === "function") return ext(ix, iy, heightMm);
    if (!cal) return [0, heightMm / 1000, 0];
    const ppm = cal.pxPerMeter || 100;
    const dx = (ix - cal.planX1) / ppm;
    const dz = (iy - cal.planY1) / ppm;
    const c = Math.cos(cal.rot);
    const s = Math.sin(cal.rot);
    const sx = dx * cal.scale;
    const sz = dz * cal.scale;
    const wx = cal.ax + sx * c - sz * s;
    const wz = cal.az + sx * s + sz * c;
    return [wx, heightMm / 1000, wz];
  }

  function colorKey(col) {
    return col.map((v) => v.toFixed(3)).join(",");
  }

  function pushLine(map, col, ax, ay, az, bx, by, bz) {
    const k = colorKey(col);
    let g = map.get(k);
    if (!g) {
      g = { color: col.slice(), verts: [] };
      map.set(k, g);
    }
    g.verts.push(ax, ay, az, bx, by, bz);
  }

  function pushBoxLines(map, col, cx, cy, cz, half) {
    const h = half;
    const x0 = cx - h;
    const x1 = cx + h;
    const y0 = cy - h;
    const y1 = cy + h;
    const z0 = cz - h;
    const z1 = cz + h;
    const edges = [
      [x0, y0, z0, x1, y0, z0],
      [x1, y0, z0, x1, y1, z0],
      [x1, y1, z0, x0, y1, z0],
      [x0, y1, z0, x0, y0, z0],
      [x0, y0, z1, x1, y0, z1],
      [x1, y0, z1, x1, y1, z1],
      [x1, y1, z1, x0, y1, z1],
      [x0, y1, z1, x0, y0, z1],
      [x0, y0, z0, x0, y0, z1],
      [x1, y0, z0, x1, y0, z1],
      [x1, y1, z0, x1, y1, z1],
      [x0, y1, z0, x0, y1, z1]
    ];
    for (const e of edges) pushLine(map, col, e[0], e[1], e[2], e[3], e[4], e[5]);
  }

  function pushPoint(map, col, x, y, z) {
    const k = colorKey(col);
    let g = map.get(k);
    if (!g) {
      g = { color: col.slice(), verts: [] };
      map.set(k, g);
    }
    g.verts.push(x, y, z);
  }

  function mapToLineGroups(map) {
    const out = [];
    for (const g of map.values()) {
      if (!g.verts.length) continue;
      out.push({ color: g.color, positions: new Float32Array(g.verts) });
    }
    return out;
  }

  function mapToPointGroups(map, size) {
    const out = [];
    for (const g of map.values()) {
      if (!g.verts.length) continue;
      out.push({ color: g.color, positions: new Float32Array(g.verts), size });
    }
    return out;
  }

  function rebuildGeometry() {
    const p = project();
    if (!p || !cal) {
      geom = { lineGroups: [], pointGroups: [] };
      return;
    }

    const lineMap = new Map();
    const pointMap = new Map();
    const boxMap = new Map();

    if (layers.routes || layers.conduit) {
      p.routes.forEach((r) => {
        const isConduit = r.install === "conduit";
        if (!layers.routes && !(layers.conduit && isConduit)) return;
        const h = ROUTE_H_MM[r.type] || 250;
        const col =
          layers.conduit && isConduit ? COLORS.conduit : COLORS[r.type] || COLORS.power;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = planToWorld(r.pts[i][0], r.pts[i][1], h);
          const b = planToWorld(r.pts[i + 1][0], r.pts[i + 1][1], h);
          pushLine(lineMap, col, a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      });
    }

    if (layers.elements || layers.penetrations) {
      p.elements.forEach((e) => {
        const isPen = e.type === "penetration";
        if (isPen && !layers.penetrations) return;
        if (!isPen && !layers.elements) return;
        const w = planToWorld(e.x, e.y, e.z || 0);
        if (isPen) {
          pushBoxLines(boxMap, COLORS.pen, w[0], w[1], w[2], 0.06);
        } else {
          pushPoint(pointMap, COLORS.element, w[0], w[1], w[2]);
          pushBoxLines(boxMap, COLORS.element, w[0], w[1], w[2], 0.035);
        }
      });
    }

    const lineGroups = mapToLineGroups(lineMap).concat(mapToLineGroups(boxMap));
    const pointGroups = mapToPointGroups(pointMap, 14);

    geom = { lineGroups, pointGroups };
  }

  function drawLineGroups(mvp) {
    if (!geom.lineGroups.length) return;
    gl.uniformMatrix4fv(uVpLoc, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const g of geom.lineGroups) {
      gl.bufferData(gl.ARRAY_BUFFER, g.positions, gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(uColorLoc, g.color);
      gl.drawArrays(gl.LINES, 0, g.positions.length / 3);
    }
  }

  function drawPointGroups(mvp) {
    if (!geom.pointGroups.length) return;
    const uPointSize = gl.getUniformLocation(prog, "uPointSize");
    gl.uniformMatrix4fv(uVpLoc, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const g of geom.pointGroups) {
      gl.bufferData(gl.ARRAY_BUFFER, g.positions, gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(uColorLoc, g.color);
      gl.uniform1f(uPointSize, g.size);
      gl.drawArrays(gl.POINTS, 0, g.positions.length / 3);
    }
  }

  function renderFrame(frame) {
    if (!gl || !prog) return;
    const mvp = mvpFromFrame(frame);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    drawLineGroups(mvp);
    drawPointGroups(mvp);
  }

  async function frameLoop() {
    if (!active) return;
    const p = await getPlugin();
    if (!p || !gl) {
      raf = requestAnimationFrame(frameLoop);
      return;
    }
    try {
      const frame = await p.getFrameData();
      renderFrame(frame);
    } catch (_) {}
    raf = requestAnimationFrame(frameLoop);
  }

  async function onTap(ev) {
    if (!active || calStep > 2) return;
    const p = await getPlugin();
    const stage = document.getElementById("elkArStage");
    if (!p || !stage) return;
    const rect = stage.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    try {
      const { hits } = await p.hitTest({ x, y });
      if (!hits?.length) {
        setMsg("Nenašla sa plocha. Namier na podlahu alebo stenu a skús znova.", true);
        return;
      }
      const hit = hits[0];
      if (calStep === 0) {
        cal = {
          ax: hit.pose.tx,
          ay: hit.pose.ty,
          az: hit.pose.tz,
          planX1: 0,
          planY1: 0,
          bx: null,
          bz: null,
          planX2: null,
          planY2: null,
          scale: 1,
          rot: 0,
          pxPerMeter: project()?.pxPerMeter || 100
        };
        const proj = project();
        if (proj?.plan) {
          cal.planX1 = proj.plan.w * 0.1;
          cal.planY1 = proj.plan.h * 0.1;
        }
        await p.createAnchor({ pose: hit.pose });
        calStep = 1;
        setMsg("<b>Krok 2/2:</b> Ťukni na druhý roh miestnosti na <b>podlahe</b> (pre mierku).", true);
        setCalibUi("Kalibrácia: bod 1 hotový");
        return;
      }
      if (calStep === 1) {
        cal.bx = hit.pose.tx;
        cal.by = hit.pose.ty;
        cal.bz = hit.pose.tz;
        const proj = project();
        if (proj?.plan) {
          cal.planX2 = proj.plan.w * 0.9;
          cal.planY2 = proj.plan.h * 0.9;
        } else {
          cal.planX2 = 800;
          cal.planY2 = 600;
        }
        const ppm = cal.pxPerMeter || 100;
        const planD = Math.hypot(cal.planX2 - cal.planX1, cal.planY2 - cal.planY1) / ppm;
        const arD = Math.hypot(cal.bx - cal.ax, cal.bz - cal.az);
        cal.scale = planD > 0.01 ? arD / planD : 1;
        const planA = Math.atan2(cal.planX2 - cal.planX1, -(cal.planY2 - cal.planY1));
        const arA = Math.atan2(cal.bx - cal.ax, cal.bz - cal.az);
        cal.rot = arA - planA;
        calStep = 2;
        rebuildGeometry();
        setMsg("3D plán ukotvený. Choď po miestnosti a porovnaj s 2D režimom.", false);
        setCalibUi("Kalibrácia hotová · plán v 3D");
        if (proj) {
          proj.ar3dCalib = { ...cal, at: new Date().toISOString() };
          try {
            if (window.RovaElektrikar?.state) {
              localStorage.setItem("rova.elektrikar.project.v2", JSON.stringify(proj));
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      setMsg("ARCore chyba: " + (e?.message || e), true);
    }
  }

  async function startVideoFallback() {
    const video = document.getElementById("elkArVideo");
    if (!video || video.srcObject) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
    } catch (_) {}
  }

  function setLayers(next) {
    if (!next || typeof next !== "object") return;
    layers = { ...layers, ...next };
    rebuildGeometry();
  }

  async function enter() {
    const p = await getPlugin();
    if (!p) {
      setMsg("3D režim vyžaduje <b>Android appku</b> s ARCore. Na webe používaj 2D režim.", true);
      return false;
    }
    const { supported } = await p.isSupported();
    if (!supported) {
      setMsg("Toto zariadenie nepodporuje ARCore (Google Play Services for AR).", true);
      return false;
    }

    document.getElementById("elkArCanvas")?.classList.add("elk-ar-hide");
    document.getElementById("elkAr3dCanvas")?.classList.remove("elk-ar-hide");
    document.querySelector(".elk-ar-2d-only")?.classList.add("elk-ar-hide");

    await startVideoFallback();
    await p.startSession();
    await syncDisplayGeometry();
    if (!initGl()) {
      setMsg("WebGL nie je dostupný.", true);
      return false;
    }
    await resizeGl();

    const saved = project()?.ar3dCalib;
    if (saved?.ax != null && saved?.scale) {
      cal = { ...saved };
      calStep = 2;
      setCalibUi("Kalibrácia načítaná z projektu");
      rebuildGeometry();
      setMsg("3D režim — plán z poslednej kalibrácie.", false);
    } else {
      calStep = 0;
      cal = null;
      setCalibUi("Kalibrácia: čaká na bod 1");
      setMsg("<b>Krok 1/2:</b> Ťukni na <b>roh miestnosti na podlahe</b> (ukotvenie plánu).", true);
    }

    const stage = document.getElementById("elkArStage");
    tapHandler = (ev) => onTap(ev);
    stage?.addEventListener("click", tapHandler);
    resizeHandler = () => {
      resizeGl();
    };
    window.addEventListener("resize", resizeHandler);

    stage?.classList.add("elk-ar-3d-active");

    active = true;
    frameLoop();
    return true;
  }

  async function exit() {
    active = false;
    cancelAnimationFrame(raf);
    raf = 0;
    const stage = document.getElementById("elkArStage");
    stage?.classList.remove("elk-ar-3d-active");
    if (tapHandler) stage?.removeEventListener("click", tapHandler);
    tapHandler = null;
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;

    document.getElementById("elkArCanvas")?.classList.remove("elk-ar-hide");
    document.getElementById("elkAr3dCanvas")?.classList.add("elk-ar-hide");
    document.querySelectorAll(".elk-ar-2d-only").forEach((el) => el.classList.remove("elk-ar-hide"));

    const p = await getPlugin();
    if (p) {
      try {
        await p.stopSession();
      } catch (_) {}
    }
    gl = null;
    prog = null;
    buf = null;
    calStep = 0;
    setMsg(null, false);
    setCalibUi("");
    window.__rovaElkAr?.drawArLoop?.();
  }

  function isActive() {
    return active;
  }

  window.RovaAr3d = {
    enter,
    exit,
    isActive,
    rebuildGeometry,
    setLayers,
    syncDisplayGeometry
  };
})();
