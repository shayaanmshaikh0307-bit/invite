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

  function realGet(code) {
    return fetch(API_URL + "?i=" + encodeURIComponent(code), { method: "GET", redirect: "follow" })
      .then(function (r) { return r.json(); });
  }
  function realPost(body) {
    // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
    return fetch(API_URL, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function demo() { return window.InviteDemo || null; }

  window.InviteAPI = {
    demo: !API_URL,
    ready: API_URL ? Promise.resolve() : loadScript("js/demo.js"),
    get demoCodes() { return demo() ? demo().codes : {}; },
    resetDemo: function (code) { if (demo()) demo().reset(code); },
    seedReplied: function (code) { if (demo()) demo().seedReplied(code); },
    icsUrl: function (code) { return API_URL ? API_URL + "?i=" + encodeURIComponent(code) + "&ics=1" : "#"; },
    getInvite: function (code, opts) {
      if (API_URL) return realGet(code);
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
