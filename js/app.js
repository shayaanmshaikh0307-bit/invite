/* The invitation: envelope → card animation, card flip, RSVP sheet. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var API = window.InviteAPI;
  var store = API.store;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var els = {
    stage: $("stage"), envFace: $("envFace"), envBack: $("envBack"), envFront: $("envFront"),
    flapOpen: $("flapOpen"), flapClosed: $("flapClosed"), cardMover: $("cardMover"), flipper: $("cardFlipper"),
    cardFront: $("cardFront"), cardBack: $("cardBack"), addressee: $("addressee"),
    tapHint: $("tapHint"), replayBtn: $("replayBtn"), flipBtn: $("flipBtn"),
    rsvpBar: $("rsvpBar"), rsvpBtn: $("rsvpBtn"), sheet: $("sheet"), scrim: $("scrim"),
    sheetBody: $("sheetBody"), sheetTitle: $("sheetTitle"), sheetBack: $("sheetBack"),
    toast: $("toast"), toastMsg: $("toastMsg"), toastLink: $("toastLink"),
    notice: $("notice"), noticeTitle: $("noticeTitle"), noticeBody: $("noticeBody"), noticeRetry: $("noticeRetry"),
    loading: $("loading"), loadingText: $("loadingText"),
    topbar: $("topbar"), preview: $("preview")
  };

  var BASE = null;       // card wording, sent by the backend only with a valid code
  var C = { contactLine: "please contact the couple directly" }; // wording for the current household
  var G = null;          // geometry
  var state = {
    code: null, invite: null, opened: false, animating: false, flipped: false,
    view: "form", form: null, forceLocked: false, art: null, toastTimer: null
  };

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function setT(el, t) { el.style.transform = t; }
  // 1 = the original ~3.4s opening (+0.7s hold); 1.75 makes the whole sequence ~7.2s
  var SPEED = 1.75;
  function anim(el, frames, ms, delay, easing) {
    var a = el.animate(frames, { duration: ms * SPEED, delay: (delay || 0) * SPEED, easing: easing || "ease", fill: "both" });
    return a.finished.then(function () { return a; });
  }
  function settle(list) { list.forEach(function (a) { try { a.commitStyles(); } catch (e) {} a.cancel(); }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function safeInsets() {
    var p = document.createElement("div");
    p.style.cssText = "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(p);
    var cs = getComputedStyle(p);
    var out = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    p.remove();
    return out;
  }
  function isLocked() { return !!(state.invite && state.invite.locked); }
  function responded() { return !!(state.invite && state.invite.respondedAt); }

  /* ------------------------------------------------------------ content */
  function applyContent() {
    var nameNodes = document.querySelectorAll("[data-name]");
    for (var n = 0; n < nameNodes.length; n++) {
      var lines = String(C[nameNodes[n].getAttribute("data-name")] || "").split("\n");
      nameNodes[n].innerHTML = lines.map(function (l) { return '<span class="name-line">' + esc(l) + "</span>"; }).join("");
      nameNodes[n].classList.toggle("multi", lines.length > 1);
      nameNodes[n].setAttribute("aria-label", lines.join(" "));
    }
    var namesBox = document.querySelector(".names");
    if (namesBox) namesBox.classList.toggle("staggered", C.nameStyle === "staggered");
    var nodes = document.querySelectorAll("[data-c]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = C[nodes[i].getAttribute("data-c")] || "";
    $("pmInitials").textContent = C.postmarkInitials || "";
    $("pmPlace").textContent = C.postmarkPlace || "";
    $("pmDate").textContent = C.postmarkDate || "";

    var sched = $("schedule");
    sched.innerHTML = C.schedule.map(function (s) { return "<dt>" + esc(s.time) + "</dt><dd>" + esc(s.item) + "</dd>"; }).join("");
    $("address").textContent = C.venue.name + "\n" + C.venue.address.join(", ");
    $("directions").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(C.venue.mapsQuery);
    $("notes").textContent = C.notes || "";
    $("notesH").hidden = !C.notes;
    $("notes").hidden = !C.notes;

    $("calApple").href = API.icsUrl(state.code);
    var cal = C.calendar;
    var g = function (iso) { return iso.replace(/[-:]/g, "").replace(/\.\d+/, ""); };
    $("calGoogle").href = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(cal.title) +
      "&dates=" + g(cal.start) + "/" + g(cal.end) + "&details=" + encodeURIComponent(cal.details) + "&location=" + encodeURIComponent(cal.location);
    $("calOutlook").href = "https://outlook.live.com/calendar/0/action/compose?rru=addevent&subject=" + encodeURIComponent(cal.title) +
      "&startdt=" + encodeURIComponent(cal.start) + "&enddt=" + encodeURIComponent(cal.end) + "&location=" + encodeURIComponent(cal.location) +
      "&body=" + encodeURIComponent(cal.details);

    if (C.art && C.art.bismillah === "svg") {
      $("bismillah").innerHTML = '<img src="art/custom/bismillah.svg" alt="">';
    }
  }

  /* ------------------------------------------------------------ geometry */
  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    var ins = safeInsets();
    var barH = 60 + ins.b;
    var top = 44 + ins.t, bottom = H - barH;
    var ew = Math.min(W * 0.92, 640, (bottom - top - 90) * 1.5);
    var eh = ew / 1.5;
    var envY = (top + bottom) / 2 - H / 2 - 12;

    var peek = Math.max(22, Math.min(40, H * 0.045));
    var room = bottom - top - peek - 14;
    var ch = Math.min(room, W * 0.9 * 1.4, 1000);
    var cw = ch / 1.4;
    var cardTop = top + peek + Math.max(0, (room - ch) / 2);
    var cardY = cardTop + ch / 2 - H / 2;

    var s0 = Math.min(ew * 0.86 / ch, eh * 0.84 / cw);
    var fh = eh * 0.56;
    var es = Math.min(1, cw * 0.92 / ew);
    var tip = cardTop - peek * 0.8;
    var envFinalY = tip + fh * es + (eh * es) / 2 - H / 2;

    var cardIn = envY + eh * 0.06;
    var envTop = envY - eh / 2;
    var cardClear = envTop - (cw * s0) / 2 - eh * 0.04;

    G = { W: W, H: H, ew: ew, eh: eh, envY: envY, cw: cw, ch: ch, cardY: cardY, s0: s0, fh: fh, es: es,
          envFinalY: envFinalY, cardIn: cardIn, cardClear: cardClear };

    var r = document.documentElement.style;
    r.setProperty("--ew", ew + "px");
    r.setProperty("--eh", eh + "px");
    r.setProperty("--cw", cw + "px");
    r.setProperty("--ch", ch + "px");
    r.setProperty("--fh", fh + "px");
    r.setProperty("--u", cw / 100 + "px");
    r.setProperty("--hint-y", envY + eh / 2 + 18 + "px");
  }

  /* Both names share one size, shrunk only as far as needed for the longer one to fit the card. */
  function fitNames() {
    var box = document.querySelector(".names");
    if (!box) return;
    box.style.setProperty("--name-scale", "1");
    var avail = box.offsetWidth * 0.98, widest = 0;
    box.querySelectorAll(".name-line").forEach(function (n) { widest = Math.max(widest, n.offsetWidth); });
    if (widest > avail) box.style.setProperty("--name-scale", (avail / widest).toFixed(3));
  }

  /* resting transforms for each state */
  var T = {
    envFace: function () { return "translate3d(0," + G.envY + "px,0)"; },
    envBackFlipStart: function () { return "translate3d(0," + G.envY + "px,0) rotateY(-90deg)"; },
    envBackClosed: function () { return "translate3d(0," + G.envY + "px,0) rotateY(0deg)"; },
    envFinal: function () { return "translate3d(0," + G.envFinalY + "px,0) scale(" + G.es + ")"; },
    cardIn: function () { return "translate3d(0," + G.cardIn + "px,0) rotate(90deg) scale(" + G.s0 + ")"; },
    cardClear: function () { return "translate3d(0," + G.cardClear + "px,0) rotate(90deg) scale(" + G.s0 + ")"; },
    cardFinal: function () { return "translate3d(0," + G.cardY + "px,0) rotate(0deg) scale(1)"; }
  };

  function showClosed() {
    state.opened = false;
    els.envFace.style.visibility = "visible";
    els.envFace.style.opacity = "1";
    setT(els.envFace, T.envFace());
    [els.envBack, els.envFront].forEach(function (e) { e.style.visibility = "hidden"; e.style.opacity = "1"; setT(e, T.envBackFlipStart()); });
    els.flapClosed.style.visibility = "visible";
    setT(els.flapClosed, "perspective(900px) rotateX(0deg)");
    setT(els.flapOpen, "perspective(900px) rotateX(-90deg)");
    // all but invisible rather than hidden, so the phone has already drawn the card
    // before the opening and doesn't pause to draw it mid-animation
    els.cardMover.style.opacity = "0.001";
    els.cardMover.classList.remove("on-top");
    setT(els.cardMover, T.cardIn());
    setFlipped(false);
    els.replayBtn.hidden = true;
    els.flipBtn.hidden = true;
    els.envFace.setAttribute("tabindex", "0");
    els.tapHint.classList.remove("show");
    void els.tapHint.offsetWidth;
    els.tapHint.classList.add("show");
  }

  function showOpen() {
    state.opened = true;
    els.envFace.style.visibility = "hidden";
    els.envFace.setAttribute("tabindex", "-1");
    [els.envBack, els.envFront].forEach(function (e) { e.style.visibility = "visible"; e.style.opacity = "1"; setT(e, T.envFinal()); });
    els.flapClosed.style.visibility = "hidden";
    setT(els.flapOpen, "perspective(900px) rotateX(0deg)");
    els.cardMover.style.opacity = "1";
    els.cardMover.classList.add("on-top");
    setT(els.cardMover, T.cardFinal());
    els.replayBtn.hidden = false;
    els.flipBtn.hidden = false;
    els.tapHint.classList.remove("show");
  }

  /* ------------------------------------------------------------ the opening */
  function open() {
    if (state.opened || state.animating) return;
    state.animating = true;
    els.tapHint.classList.remove("show");

    if (reduceMotion || !els.envFace.animate) {
      var fadeOut = els.envFace.animate ? anim(els.envFace, [{ opacity: 1 }, { opacity: 0 }], 350) : Promise.resolve();
      return fadeOut.then(function (a) {
        if (a) a.cancel();
        showOpen();
        var parts = [els.cardMover, els.envBack, els.envFront];
        return Promise.all(parts.map(function (p) { return p.animate ? anim(p, [{ opacity: 0 }, { opacity: 1 }], 450) : null; }));
      }).then(function (list) { (list || []).forEach(function (a) { if (a) a.cancel(); }); finishOpen(); });
    }

    var inEase = "cubic-bezier(.55,.06,.68,.19)", outEase = "cubic-bezier(.22,.61,.36,1)", smooth = "cubic-bezier(.45,0,.2,1)";
    var done = [];

    // 0. hold on the addressed side: the envelope lifts gently off the linen so the name can be read
    var p0 = anim(els.envFace, [{ transform: T.envFace() + " scale(1)" }, { transform: T.envFace() + " scale(1.045)" }], 700, 0, "cubic-bezier(.25,.1,.25,1)")
      .then(function (a) { settle([a]); return wait(250 * SPEED); });

    // 1. turn the envelope over
    var p1 = p0.then(function () {
      return anim(els.envFace, [{ transform: T.envFace() + " scale(1.045) rotateY(0deg)" }, { transform: T.envFace() + " scale(1.01) rotateY(90deg)" }], 360, 0, inEase);
    })
      .then(function (a) {
        a.cancel();
        els.envFace.style.visibility = "hidden";
        els.envFace.setAttribute("tabindex", "-1");
        [els.envBack, els.envFront].forEach(function (e) { e.style.visibility = "visible"; });
        return Promise.all([els.envBack, els.envFront].map(function (e) {
          return anim(e, [{ transform: T.envBackFlipStart() }, { transform: T.envBackClosed() }], 330, 0, outEase);
        }));
      }).then(function (list) {
        settle(list);
        els.cardMover.style.opacity = "1"; // only once the envelope lies flat, so it can't peek out mid-turn
      });

    // 2. lift the flap (700–1350ms)
    var p2 = p1.then(function () {
      return anim(els.flapClosed, [{ transform: "perspective(900px) rotateX(0deg)" }, { transform: "perspective(900px) rotateX(90deg)" }], 300, 40, inEase);
    }).then(function (a) {
      settle([a]);
      els.flapClosed.style.visibility = "hidden";
      return anim(els.flapOpen, [{ transform: "perspective(900px) rotateX(-90deg)" }, { transform: "perspective(900px) rotateX(0deg)" }], 360, 0, outEase);
    }).then(function (a) { settle([a]); });

    // 3. the card slides up out of the pocket (1350–2200ms)
    var p3 = p2.then(function () {
      return anim(els.cardMover, [{ transform: T.cardIn() }, { transform: T.cardClear() }], 820, 0, smooth);
    }).then(function (a) { settle([a]); els.cardMover.classList.add("on-top"); });

    // 4. card turns upright and grows; 5. envelope slides away behind it
    var p4 = p3.then(function () {
      return Promise.all([
        anim(els.cardMover, [{ transform: T.cardClear() }, { transform: T.cardFinal() }], 860, 0, "cubic-bezier(.3,.05,.15,1)"),
        anim(els.envBack, [{ transform: T.envBackClosed() }, { transform: T.envFinal() }], 980, 140, smooth),
        anim(els.envFront, [{ transform: T.envBackClosed() }, { transform: T.envFinal() }], 980, 140, smooth)
      ]);
    }).then(function (list) { settle(list); });

    return p4.then(finishOpen).catch(function () { showOpen(); finishOpen(); });
  }

  function finishOpen() {
    state.animating = false;
    if (G && (G.W !== window.innerWidth || G.H !== window.innerHeight)) { layout(); fitNames(); }
    showOpen();
  }

  function replay() {
    if (state.animating) return;
    closeSheet(true);
    showClosed();
    els.tapHint.classList.remove("show");
    wait(450).then(open);
  }

  /* ------------------------------------------------------------ card flip */
  function setFlipped(on) {
    state.flipped = on;
    els.flipper.classList.toggle("flipped", on);
    els.flipBtn.textContent = on ? "Invitation" : "Details";
    els.flipBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { els.cardBack.removeAttribute("inert"); els.cardFront.setAttribute("inert", ""); }
    else { els.cardFront.removeAttribute("inert"); els.cardBack.setAttribute("inert", ""); }
    els.cardBack.setAttribute("aria-hidden", on ? "false" : "true");
    els.cardFront.setAttribute("aria-hidden", on ? "true" : "false");
  }
  function onCardTap(e) {
    if (!state.opened || state.animating) return;
    if (e.target.closest("a, button")) return;
    setFlipped(!state.flipped);
  }

  /* ------------------------------------------------------------ RSVP sheet */
  function freshForm() {
    var inv = state.invite;
    var f = { answers: {}, plusOne: { name: "", dietary: "" }, message: "", phone: inv.phone || "" };
    inv.guests.forEach(function (g) { f.answers[g.id] = { response: g.response || "", dietary: "" }; });
    if (inv.plusOne) f.plusOne = { name: inv.plusOne.name || "", dietary: inv.plusOne.dietary || "" };
    return f;
  }

  function attendingCount() {
    var inv = state.invite, n = 0;
    inv.guests.forEach(function (g) { if (g.response === "yes") n++; });
    if (inv.plusOne && inv.plusOne.name && inv.plusOne.response === "yes") n++;
    return n;
  }

  function openSheet(view) {
    if (!state.invite) return;
    state.view = view || (responded() ? "done" : isLocked() ? "locked" : "form");
    if (state.view === "form") state.form = freshForm();
    renderSheet();
    els.sheet.hidden = false;
    els.scrim.hidden = false;
    void els.sheet.offsetWidth;
    els.sheet.classList.add("open");
    els.scrim.classList.add("open");
    [els.stage, els.topbar, els.rsvpBar, els.preview].forEach(function (e) { e.setAttribute("inert", ""); });
    setTimeout(function () { els.sheetTitle.focus({ preventScroll: true }); }, 60);
  }

  function closeSheet(instant) {
    if (els.sheet.hidden) return;
    els.sheet.classList.remove("open");
    els.scrim.classList.remove("open");
    [els.stage, els.topbar, els.rsvpBar, els.preview].forEach(function (e) { e.removeAttribute("inert"); });
    var hide = function () { els.sheet.hidden = true; els.scrim.hidden = true; };
    if (instant || reduceMotion) hide(); else setTimeout(hide, 460);
    els.rsvpBtn.focus({ preventScroll: true });
  }

  function onBack() {
    if (state.view === "form" && responded()) { state.view = "done"; renderSheet(); return; }
    closeSheet();
  }

  var CHECK = '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderSheet() {
    var v = state.view;
    els.sheetTitle.textContent = "RSVP";
    if (v === "form") return renderForm();
    if (v === "done") return renderDone();
    if (v === "locked") return renderLocked();
  }

  function renderForm() {
    var inv = state.invite, f = state.form;
    var html = '<p class="lede">Please reply by ' + esc(C.rsvpDeadlineText) + ".</p>" +
      '<p class="household">' + esc(inv.addressee) + "</p>" +
      '<form id="rsvpForm" novalidate>';
    inv.guests.forEach(function (g, i) {
      var a = f.answers[g.id];
      var id = "g" + i;
      html += '<fieldset class="guest"><legend>' + esc(g.name) + "</legend>" +
        '<div class="choice" role="radiogroup" aria-label="' + esc(g.name) + '">' +
        '<input type="radio" id="' + id + 'y" name="' + id + '" value="yes" data-g="' + esc(g.id) + '"' + (a.response === "yes" ? " checked" : "") + '>' +
        '<label for="' + id + 'y">' + CHECK + "Attending</label>" +
        '<input type="radio" id="' + id + 'n" name="' + id + '" value="no" data-g="' + esc(g.id) + '"' + (a.response === "no" ? " checked" : "") + '>' +
        '<label for="' + id + 'n">' + CHECK + "Can't attend</label></div>" +
        "</fieldset>";
    });
    if (inv.plusOneAllowed) {
      var mainYes = inv.guests.some(function (g) { return f.answers[g.id].response === "yes"; });
      html += '<fieldset class="guest" id="plusOneBox"' + (mainYes ? "" : " hidden") + '><legend>Your guest</legend>' +
        '<label class="field" style="margin-top:0"><span>Your guest\'s full name (leave blank if coming alone)</span>' +
        '<input type="text" id="poName" maxlength="80" autocomplete="off" value="' + esc(f.plusOne.name) + '"></label></fieldset>';
    }
    html += '<div class="form-foot"><p class="helper" id="helper" aria-live="polite"></p>' +
      '<button type="submit" class="btn btn-fill" id="submitBtn">Send RSVP</button></div></form>';
    els.sheetBody.innerHTML = html;
    els.sheetBody.scrollTop = 0;

    var form = $("rsvpForm");
    form.addEventListener("change", onFormChange);
    form.addEventListener("input", onFormInput);
    form.addEventListener("submit", onSubmit);
    updateSubmit();
  }

  function onFormChange(e) {
    var t = e.target;
    if (t.type === "radio") {
      var gid = t.getAttribute("data-g");
      state.form.answers[gid].response = t.value;
      var diet = els.sheetBody.querySelector('[data-diet="' + gid + '"]');
      if (diet) diet.hidden = t.value !== "yes";
      var po = $("plusOneBox");
      if (po) po.hidden = !state.invite.guests.some(function (g) { return state.form.answers[g.id].response === "yes"; });
      updateSubmit();
    }
  }
  function onFormInput(e) {
    var t = e.target, f = state.form;
    if (/^g\d+d$/.test(t.id)) {
      var gid = t.closest("fieldset").querySelector("input[type=radio]").getAttribute("data-g");
      f.answers[gid].dietary = t.value;
    } else if (t.id === "poName") f.plusOne.name = t.value;
    else if (t.id === "poDiet") f.plusOne.dietary = t.value;
    else if (t.id === "fMsg") f.message = t.value;
    else if (t.id === "fPhone") f.phone = t.value;
  }
  function unanswered() {
    var f = state.form;
    return state.invite.guests.filter(function (g) { return !f.answers[g.id].response; }).length;
  }
  function updateSubmit() {
    var left = unanswered();
    var btn = $("submitBtn"), help = $("helper");
    btn.disabled = left > 0;
    help.classList.remove("error");
    help.textContent = left === 0 ? "" : left === state.invite.guests.length && left > 1
      ? "Choose Attending or Can't attend for each person."
      : left === 1 ? "1 person still needs an answer." : left + " people still need an answer.";
  }

  function onSubmit(e) {
    e.preventDefault();
    if (unanswered() > 0) return;
    var f = state.form, inv = state.invite;
    var btn = $("submitBtn"), help = $("helper");
    btn.disabled = true;
    btn.textContent = "Sending…";
    var mainYes = inv.guests.some(function (g) { return f.answers[g.id].response === "yes"; });
    var payload = {
      answers: f.answers,
      plusOne: inv.plusOneAllowed && mainYes && f.plusOne.name.trim() ? { name: f.plusOne.name.trim(), response: "yes" } : null,
      message: f.message.trim(),
      phone: f.phone.trim()
    };
    API.submitRsvp(state.code, payload, { forceLocked: state.forceLocked }).then(function (res) {
      if (!res || !res.ok) {
        btn.textContent = "Send RSVP";
        btn.disabled = false;
        help.classList.add("error");
        help.textContent = res && res.error === "closed"
          ? "RSVPs closed on " + C.rsvpDeadlineText + ". To change your reply, " + C.contactLine + "."
          : "Your RSVP wasn't sent. Check your connection and try again.";
        if (res && res.error === "closed") { state.invite.locked = true; }
        return;
      }
      inv.guests.forEach(function (g) { g.response = f.answers[g.id].response; g.dietary = f.answers[g.id].response === "yes" ? f.answers[g.id].dietary.trim() : ""; });
      inv.plusOne = payload.plusOne;
      inv.phone = payload.phone;
      inv.respondedAt = res.respondedAt;
      API.remember(state.code, inv);
      els.rsvpBtn.textContent = "View RSVP";
      state.view = "done";
      renderSheet();
      els.sheetTitle.focus({ preventScroll: true });
      showToast();
    }).catch(function () {
      btn.textContent = "Send RSVP";
      btn.disabled = false;
      help.classList.add("error");
      help.textContent = "Your RSVP wasn't sent. Check your connection and try again.";
    });
  }

  function whenText(iso) {
    var d = new Date(iso);
    try {
      var day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" }).format(d);
      var time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).format(d).replace(/\s/g, "").toLowerCase();
      return day + ", " + time;
    } catch (e) { return d.toLocaleString(); }
  }

  function peopleRows() {
    var inv = state.invite;
    var rows = inv.guests.map(function (g) {
      var yes = g.response === "yes";
      return '<div class="person"><span class="person-name">' + esc(g.name) +
        "</span>" +
        '<span class="badge ' + (yes ? "y" : "n") + '" aria-label="' + (yes ? "Attending" : "Not attending") + '">' + (yes ? "Y" : "N") + "</span></div>";
    });
    if (inv.plusOne && inv.plusOne.name) {
      rows.push('<div class="person"><span class="person-name">' + esc(inv.plusOne.name) + ' <span class="person-diet">Guest</span></span><span class="badge y" aria-label="Attending">Y</span></div>');
    }
    return '<div class="panel">' + rows.join("") + "</div>";
  }

  function renderDone() {
    var n = attendingCount(), inv = state.invite, locked = isLocked();
    els.sheetBody.innerHTML =
      '<h3 class="done-h">RSVP Complete!</h3>' +
      '<p class="done-meta">' + esc(whenText(inv.respondedAt)) + " – RSVP submitted (" + n + " attending)</p>" +
      peopleRows() +
      (locked ? '<p class="note">RSVPs closed on ' + esc(C.rsvpDeadlineText) + ". To change your reply, " + esc(C.contactLine) + ".</p>" : "") +
      (locked ? "" : '<div class="btn-row single"><button type="button" class="btn btn-line" id="changeBtn">Change RSVP</button></div>') +
      '<button type="button" class="btn btn-fill" id="doneBtn">Done</button>';
    if (!locked) $("changeBtn").onclick = function () { state.view = "form"; state.form = freshForm(); renderSheet(); };
    $("doneBtn").onclick = function () { closeSheet(); };
  }

  function renderLocked() {
    els.sheetBody.innerHTML =
      '<h3 class="done-h">RSVPs have closed</h3>' +
      '<p class="done-meta">The reply date was ' + esc(C.rsvpDeadlineText) + ".</p>" +
      '<p class="note">We didn\'t receive a reply from ' + esc(state.invite.addressee) + ". To let us know if you can come, " + esc(C.contactLine) + ".</p>" +
      '<button type="button" class="btn btn-fill" id="doneBtn">Done</button>';
    $("doneBtn").onclick = function () { closeSheet(); };
  }

  /* ------------------------------------------------------------ toast */
  function showToast() {
    var n = attendingCount();
    els.toastMsg.textContent = "✓ RSVP Submitted Successfully – " + n + " Attending in Your Group";
    els.toast.hidden = false;
    void els.toast.offsetWidth;
    els.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    els.toast.classList.remove("show");
    setTimeout(function () { if (!els.toast.classList.contains("show")) els.toast.hidden = true; }, 520);
  }

  /* ------------------------------------------------------------ notice */
  function showNotice(kind) {
    hideLoading();
    els.noticeRetry.hidden = kind !== "error";
    els.stage.hidden = true;
    els.rsvpBar.hidden = true;
    els.topbar.hidden = true;
    els.tapHint.classList.remove("show");
    if (kind === "error") {
      els.noticeTitle.textContent = "We couldn't load your invitation";
      els.noticeBody.textContent = "This is usually a weak connection. Tap Try again, or open the link again in a moment. If it keeps happening, " + C.contactLine + ".";
    } else {
      els.noticeTitle.textContent = "We couldn't open this invitation";
      els.noticeBody.textContent = "The link looks incomplete. Please open it exactly as it was sent to you, or ask whoever sent it for a fresh link.";
    }
    els.notice.hidden = false;
  }

  /* ------------------------------------------------------------ loading */
  function showLoading(text) {
    if (text) els.loadingText.textContent = text;
    els.loading.hidden = false;
  }
  function hideLoading() {
    clearTimeout(state.loadingTimer);
    els.loading.hidden = true;
  }

  /* ------------------------------------------------------------ artwork */
  /* Every image the opening uses is downloaded AND decoded before the envelope is
     shown, so nothing pops in or stutters mid-animation on a phone. Starts at once,
     in parallel with fetching the invitation. */
  var TEXTURES = ["envelope", "liner", "paper", "linen"];
  var artReady = null;
  // downloaded for certain; decoded too where the browser will do it promptly
  // (some in-app browsers only decode while drawing, so decoding is never waited on for long)
  function decodeImg(img) {
    var loaded = new Promise(function (r) {
      if (img.complete) return r();
      img.addEventListener("load", function () { r(); }, { once: true });
      img.addEventListener("error", function () { r(); }, { once: true });
    });
    return loaded.then(function () {
      if (!img.decode || !img.naturalWidth) return;
      return Promise.race([img.decode().catch(function () {}), wait(300)]);
    });
  }
  function prepareArt(mode) {
    if (!G) layout();
    window.InviteFlorals.fill(mode || "painted", G.cw);
    // the same files the stylesheet uses (WebP, or JPEG on the rare phone without WebP)
    var jobs = TEXTURES.map(function (t) {
      var i = new Image();
      i.src = "art/textures/" + t + ".webp";
      return decodeImg(i).then(function () {
        if (i.naturalWidth) return;
        var j = new Image();
        j.src = "art/textures/" + t + ".jpg";
        return decodeImg(j);
      });
    });
    document.querySelectorAll(".floral img").forEach(function (img) { jobs.push(decodeImg(img)); });
    return Promise.all(jobs);
  }
  // never hold a guest back for artwork: after the invitation arrives, wait at most this long
  function artOrTimeout(ms) { return Promise.race([artReady || Promise.resolve(), wait(ms)]); }

  /* ------------------------------------------------------------ boot */
  function show(inv) {
    state.invite = inv;
    BASE = inv.content;
    C = contentFor(BASE, inv);
    applyContent();
    els.addressee.textContent = inv.addressee;
    els.envFace.setAttribute("aria-label", "Open your invitation, addressed to " + inv.addressee);
    els.rsvpBtn.textContent = inv.respondedAt ? "View RSVP" : "RSVP";
  }

  /* A fresher copy arrived after a remembered one was shown: take its answers and
     wording without disturbing the envelope or an opening in progress. */
  function refresh(inv) {
    var same = JSON.stringify(inv.content) === JSON.stringify(BASE) && inv.addressee === state.invite.addressee && inv.side === state.invite.side;
    if (!els.sheet.hidden) { state.invite = inv; return; } // never change a form under someone's fingers
    show(inv);
    if (!same && !state.animating) { layout(); fitNames(); if (state.opened) showOpen(); }
  }

  function boot(code, opts) {
    opts = opts || {};
    state.code = code;
    state.forceLocked = !!opts.forceLocked;
    state.invite = null;
    closeSheet(true);
    hideToast();
    els.notice.hidden = true;
    els.stage.hidden = false;
    els.topbar.hidden = false;
    els.stage.style.opacity = "0";

    if (!code || !/^[A-Za-z0-9]{10,24}$/.test(code)) { showNotice("invalid"); return Promise.resolve(); }

    var remembered = API.cachedInvite(code);
    var fresh = API.getInvite(code, {
      forceLocked: state.forceLocked,
      onRetry: function () { if (!state.invite) showLoading("is taking a little longer than usual\u2026"); }
    });

    var first;
    if (remembered) {
      first = Promise.resolve(remembered);
      fresh.then(function (inv) {
        if (inv && inv.ok && state.code === code && state.invite) refresh(inv);
        else if (inv && inv.error === "not_found" && state.code === code) showNotice("invalid");
      }, function () { /* keep showing the remembered copy */ });
    } else {
      els.loadingText.textContent = "is on its way\u2026";
      clearTimeout(state.loadingTimer);
      state.loadingTimer = setTimeout(function () { showLoading(); }, 500);
      first = fresh;
    }

    return first.then(function (inv) {
      if (state.code !== code) return;
      if (!inv || !inv.ok) { showNotice(inv && inv.error === "not_found" ? "invalid" : "error"); return; }
      show(inv);
      layout();
      var mode = state.art || (C.art && C.art.florals) || "painted";
      if (mode !== "painted" || !artReady) artReady = prepareArt(mode);
      // every visit opens on the addressed envelope; the guest taps to open it
      showClosed();
      els.tapHint.classList.remove("show");
      return Promise.all([fontsReady(), artOrTimeout(3000)]).then(function () {
        if (state.code !== code) return;
        hideLoading();
        els.rsvpBar.hidden = false;
        fitNames();
        els.stage.style.opacity = "1";
        var fade = els.stage.animate ? els.stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450 }) : null;
        var hint = function () { if (!state.opened && !state.animating) { void els.tapHint.offsetWidth; els.tapHint.classList.add("show"); } };
        if (fade) fade.finished.then(hint, hint); else hint();
      });
    }).catch(function () { if (!state.invite) showNotice("error"); });
  }

  /* The household's side picks its arrival time; the server's deadline is authoritative. */
  function contentFor(base, inv) {
    var c = JSON.parse(JSON.stringify(base));
    var s = base.sides && base.sides[inv.side];
    if (s) {
      if (s.timeLine) c.timeLine = s.timeLine;
      if (s.arrivalTime) c.schedule = c.schedule.map(function (it) { return it.arrival ? { time: s.arrivalTime, item: it.item } : it; });
      if (s.calendarStart) c.calendar.start = s.calendarStart;
    }
    if (inv.deadline) c.rsvpDeadline = inv.deadline;
    if (inv.deadlineText) c.rsvpDeadlineText = inv.deadlineText;
    if (inv.contactLine) c.contactLine = inv.contactLine;
    return c;
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.race([
      Promise.all([document.fonts.load('40px "Pinyon Script"'), document.fonts.load('20px "Cormorant Garamond"'), document.fonts.load('20px "Cormorant SC"'), document.fonts.load('700 30px "Amiri Bismillah"', "\u0628\u0633\u0645")]),
      wait(1800)
    ]).catch(function () {});
  }

  /* ------------------------------------------------------------ preview controls (demo only) */
  function setupPreview() {
    if (!API.demo) return;
    els.preview.hidden = false;
    var panel = $("previewPanel"), toggle = $("previewToggle");
    toggle.onclick = function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    var mark = function (attr, val) {
      panel.querySelectorAll("[" + attr + "]").forEach(function (b) { b.setAttribute("aria-current", b.getAttribute(attr) === val ? "true" : "false"); });
    };
    panel.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var fam = API.demoCodes.family, single = API.demoCodes.single;
      var st = b.getAttribute("data-state"), art = b.getAttribute("data-art");
      if (art) {
        state.art = art; mark("data-art", art);
        window.InviteFlorals.fill(art, G.cw);
      }
      if (st) {
        mark("data-state", st);
        if (st === "fresh") { API.resetDemo(fam); store.del("opened-" + fam); boot(fam); }
        if (st === "plusone") { API.resetDemo(single); store.del("opened-" + single); boot(single); }
        if (st === "replied") { API.seedReplied(fam); store.set("opened-" + fam, "1"); boot(fam); }
        if (st === "closed") { store.set("opened-" + fam, "1"); boot(fam, { forceLocked: true }); }
        if (st === "invalid") { boot("nope"); }
        panel.hidden = true; toggle.setAttribute("aria-expanded", "false");
      }
    });
    mark("data-state", "fresh");
    mark("data-art", (C.art && C.art.florals) || "painted");
  }

  /* ------------------------------------------------------------ events */
  els.envFace.addEventListener("click", open);
  els.envFace.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  els.cardFront.addEventListener("click", onCardTap);
  els.cardBack.addEventListener("click", onCardTap);
  els.flipBtn.addEventListener("click", function () { if (state.opened) setFlipped(!state.flipped); });
  els.replayBtn.addEventListener("click", replay);
  els.rsvpBtn.addEventListener("click", function () { openSheet(); });
  els.sheetBack.addEventListener("click", onBack);
  els.scrim.addEventListener("click", function () { closeSheet(); });
  els.toastLink.addEventListener("click", function () { hideToast(); if (els.sheet.hidden) openSheet("done"); else { state.view = "done"; renderSheet(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !els.sheet.hidden) closeSheet(); });

  var resizeT;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      if (!state.invite || state.animating) return;
      layout();
      fitNames();
      if (state.opened) showOpen(); else { setT(els.envFace, T.envFace()); setT(els.cardMover, T.cardIn()); [els.envBack, els.envFront].forEach(function (e) { setT(e, T.envBackFlipStart()); }); }
    }, 120);
  });

  els.noticeRetry.addEventListener("click", function () { boot(state.code, { forceLocked: state.forceLocked }); });

  // start fetching and decoding the artwork straight away, alongside the invitation request
  try { layout(); artReady = prepareArt("painted"); } catch (e) { artReady = null; }

  API.ready.then(function () {
    setupPreview();
    var startCode = new URLSearchParams(window.location.search).get("i");
    if (!startCode && API.demo) startCode = API.demoCodes.family;
    boot(startCode);
  });

  window.__invite = { state: state, open: open, layout: function () { return G; } };
})();
