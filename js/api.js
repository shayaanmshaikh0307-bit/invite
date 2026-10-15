/* Talks to the RSVP backend. Personal details only ever come from the backend,
   and only for a valid household code. With no backend configured (local testing),
   a private demo module is loaded instead; it is never published. */
(function () {
  "use strict";

  var API_URL = (window.INVITE_CONFIG && window.INVITE_CONFIG.apiUrl) || "";

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked: fine */ } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  function getOnce(code, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(API_URL + "?i=" + encodeURIComponent(code), { method: "GET", redirect: "follow", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }
  // Reading an invitation is safe to repeat, so a slow or dropped attempt is retried.
  function realGet(code, onRetry) {
    return getOnce(code, 20000).catch(function () {
      if (onRetry) onRetry();
      return getOnce(code, 30000);
    });
  }
  function realPost(body) {
    // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
    return fetch(API_URL, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function demo() { return window.InviteDemo || null; }

  // The invitation is requested the moment this script runs, while the page is still
  // painting, rather than after everything else has loaded.
  var START = new URLSearchParams(window.location.search).get("i") || "";
  var early = null;
  if (API_URL && /^[A-Za-z0-9]{10,24}$/.test(START)) {
    early = { code: START, retried: false, onRetry: null };
    early.promise = realGet(START, function () { early.retried = true; if (early.onRetry) early.onRetry(); });
  }

  // A copy kept on the guest's own phone, so reopening their link is instant.
  // Only ever their own household's invitation; refreshed from the server every visit.
  function cacheKey(code) { return "inv-" + code; }
  function remember(code, inv) {
    if (inv && inv.ok) store.set(cacheKey(code), JSON.stringify({ at: Date.now(), inv: inv }));
    return inv;
  }
  function recall(code) {
    try {
      var c = JSON.parse(store.get(cacheKey(code)) || "null");
      return c && c.inv && c.inv.ok && Date.now() - c.at < 45 * 864e5 ? c.inv : null;
    } catch (e) { return null; }
  }

  window.InviteAPI = {
    demo: !API_URL,
    ready: API_URL ? Promise.resolve() : loadScript("js/demo.js"),
    get demoCodes() { return demo() ? demo().codes : {}; },
    resetDemo: function (code) { if (demo()) demo().reset(code); },
    seedReplied: function (code) { if (demo()) demo().seedReplied(code); },
    icsUrl: function (code) { return API_URL ? API_URL + "?i=" + encodeURIComponent(code) + "&ics=1" : "#"; },
    cachedInvite: function (code) { return API_URL ? recall(code) : null; },
    remember: function (code, inv) { if (API_URL) remember(code, inv); },
    getInvite: function (code, opts) {
      if (API_URL) {
        var p;
        if (early && early.code === code) {
          early.onRetry = opts && opts.onRetry;
          if (early.retried && early.onRetry) early.onRetry();
          p = early.promise; early = null;
        } else p = realGet(code, opts && opts.onRetry);
        return p.then(function (inv) {
          if (inv && inv.ok) remember(code, inv);
          else if (inv && inv.error === "not_found") store.del(cacheKey(code));
          return inv;
        });
      }
      return demo() ? demo().get(code, opts || {}) : Promise.resolve({ ok: false, error: "not_found" });
    },
    submitRsvp: function (code, payload, opts) {
      payload.submissionId = payload.submissionId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      if (API_URL) return realPost({ action: "rsvp", i: code, data: payload });
      return demo() ? demo().submit(code, payload, opts || {}) : Promise.resolve({ ok: false, error: "not_found" });
    },
    store: store
  };
})();
