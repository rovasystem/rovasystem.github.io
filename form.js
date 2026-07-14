(function () {
  const config = window.ROVA_WAITLIST || {};
  const form = document.getElementById("waitlistForm");
  const statusEl = document.getElementById("formStatus");
  const submitBtn = document.getElementById("submitBtn");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const utmFields = { utm_source: "utmSource", utm_medium: "utmMedium", utm_campaign: "utmCampaign" };
  Object.entries(utmFields).forEach(([param, id]) => {
    const target = document.getElementById(id);
    if (target && params.get(param)) target.value = params.get(param);
  });

  if (!params.get("utm_source") && document.referrer.includes("instagram")) {
    const src = document.getElementById("utmSource");
    if (src) src.value = "instagram";
  }

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = "form-status" + (type ? " " + type : "");
  }

  function buildPayload() {
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.consent) return null;
    const now = new Date().toISOString();
    return {
      name: data.name?.trim(),
      email: data.email?.trim(),
      company: data.company?.trim() || "",
      phone: data.phone?.trim() || "",
      segment: data.segment || "",
      note: data.note?.trim() || "",
      source: data.source || "instagram-waitlist",
      utm_source: data.utm_source || "",
      utm_medium: data.utm_medium || "",
      utm_campaign: data.utm_campaign || "",
      consentAt: now,
      createdAt: now
    };
  }

  async function submitToApi(payload) {
    const url = (config.apiUrl || "").trim();
    if (!url) return false;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res.ok;
  }

  async function submitToFormSubmit(payload) {
    const email = (config.email || "").trim();
    if (!email) return false;

    const body = new FormData();
    body.append("name", payload.name);
    body.append("email", payload.email);
    body.append("company", payload.company);
    body.append("phone", payload.phone);
    body.append("segment", payload.segment);
    body.append("message", [
      payload.note,
      "",
      "Source: " + payload.source,
      "UTM: " + [payload.utm_source, payload.utm_medium, payload.utm_campaign].filter(Boolean).join(" / ") || "—",
      "Time: " + payload.createdAt
    ].join("\n"));
    body.append("_subject", "ROVA Waitlist — " + (payload.company || payload.name));
    body.append("_captcha", "false");
    body.append("_template", "table");
    body.append("_next", new URL("thank-you.html", window.location.href).href);

    const res = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(email), {
      method: "POST",
      headers: { Accept: "application/json" },
      body
    });
    const json = await res.json().catch(() => ({}));
    return res.ok && json.success !== false;
  }

  function saveLocal(payload) {
    const key = "rova.waitlist.drafts";
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    list.unshift(payload);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.consent?.checked) {
      setStatus("Consent is required before submitting.", "err");
      return;
    }

    const payload = buildPayload();
    if (!payload?.name || !payload.email) {
      setStatus("Please enter your name and email.", "err");
      return;
    }

    submitBtn.disabled = true;
    setStatus("Sending…");

    try {
      if (await submitToApi(payload)) {
        window.location.href = "thank-you.html";
        return;
      }
      if (await submitToFormSubmit(payload)) {
        window.location.href = "thank-you.html";
        return;
      }
      saveLocal(payload);
      setStatus("Could not send online. Your details were saved locally — email us at " + (config.email || "rova.system.solutions@gmail.com") + ".", "err");
    } catch (_) {
      saveLocal(payload);
      setStatus("Something went wrong. Please try again or contact us directly.", "err");
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
