(function () {
  const config = window.ROVA_WAITLIST || {};
  const form = document.getElementById("waitlistForm");
  const statusEl = document.getElementById("formStatus");
  const submitBtn = document.getElementById("submitBtn");
  const consentEl = document.getElementById("consent");
  const formNext = document.getElementById("formNext");
  const formReplyTo = document.getElementById("formReplyTo");
  if (!form) return;

  const inbox = (config.email || "rova.system.solutions@gmail.com").trim();
  form.action = "https://formsubmit.co/" + encodeURIComponent(inbox);
  if (formNext) {
    formNext.value = new URL("thank-you.html", window.location.href).href;
  }

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

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!consentEl?.checked) {
      setStatus("Consent is required before submitting.", "err");
      return;
    }

    const name = form.name?.value?.trim();
    const email = form.email?.value?.trim();
    if (!name || !email) {
      setStatus("Please enter your name and email.", "err");
      return;
    }

    if (formReplyTo) formReplyTo.value = email;
    if (formNext) {
      formNext.value = new URL("thank-you.html", window.location.href).href;
    }

    submitBtn.disabled = true;
    setStatus("Sending…");
    form.submit();
  });
})();
