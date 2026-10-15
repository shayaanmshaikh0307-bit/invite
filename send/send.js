(function () {
  "use strict";
  var API = (window.INVITE_CONFIG && window.INVITE_CONFIG.apiUrl) || "";
  var KEY_STORE = "send-key";
  var $ = function (id) { return document.getElementById(id); };
  var S = { key: null, data: null, side: "mine", tab: "send", q: "", busy: {}, errors: {} };
  var mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove("show"); }, 3200); }
  function day(iso) { if (!iso) return ""; try { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(iso)); } catch (e) { return iso.slice(0, 10); } }

  /* ------------------------------------------------------------ talking to the Sheet */
  function call(body, ms) {
    if (!API) return demoCall(body);
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 15000);
    body.action = "admin"; body.key = S.key;
    return fetch(API, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }

  function load(quiet) {
    if (!quiet) $("updated").textContent = "Loading…";
    return call({ op: "list" }).then(function (d) {
      if (!d || !d.ok) {
        if (d && d.error === "unauthorised") { store(KEY_STORE, null); showNoKey(); return; }
        throw new Error("load");
      }
      S.data = d;
      render();
      $("updated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }).catch(function () { $("updated").textContent = "Couldn't load. Check your connection and tap Refresh."; });
  }

  /* ------------------------------------------------------------ filtering */
  function mySide() { return S.data && S.data.you ? S.data.you.side : "Groom"; }
  function inSide(h) {
    if (S.side === "all") return true;
    return S.side === "mine" ? h.side === mySide() : h.side !== mySide();
  }
  function bucket(h) {
    if (h.status === "replied") return "replied";
    if (h.status === "not_sent") return "send";
    if (h.nudgeDue) return "due";
    return "waiting";
  }
  function matches(h) {
    if (!S.q) return true;
    var q = S.q.toLowerCase();
    if ((h.household + " " + h.addressee).toLowerCase().indexOf(q) >= 0) return true;
    return h.guests.some(function (g) { return g.name.toLowerCase().indexOf(q) >= 0; });
  }

  /* ------------------------------------------------------------ rendering */
  var WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.3Z"/></svg>';

  function render() {
    var d = S.data;
    var names = d.sideNames || { Bride: "Bride", Groom: "Groom" };
    var otherName = names[mySide() === "Groom" ? "Bride" : "Groom"] + "'s";
    $("otherBtn").textContent = otherName;
    $("addToggle").hidden = !(d.you && d.you.side === "Groom") || !$("addForm").hidden;
    $("addBrideLbl").textContent = names.Bride + "'s";
    $("addGroomLbl").textContent = names.Groom + "'s";
    $("who").textContent = d.you.name;
    document.querySelectorAll(".sidebar button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-side") === S.side ? "true" : "false"); });

    var sides = S.side === "all" ? ["Bride", "Groom"] : S.side === "mine" ? [mySide()] : [mySide() === "Groom" ? "Bride" : "Groom"];
    var t = { households: 0, sent: 0, replied: 0, guests: 0, attending: 0, declined: 0, awaiting: 0 };
    sides.forEach(function (s) { var x = d.totals[s]; for (var k in t) t[k] += x[k]; });
    $("stats").innerHTML =
      stat(t.attending, "Attending") + stat(t.declined, "Can't come") + stat(t.awaiting, "Awaiting") + stat(t.sent + "/" + t.households, "Invites sent");
    $("progress").textContent = t.households ? t.replied + " of " + t.households + " households have replied" : "No households yet. Add guests in the Sheet.";
    $("deadline").textContent = d.deadline ? "Replies close " + new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(new Date(d.deadline)) + (d.nudgesPaused ? " · Reminders are paused" : "") : "";

    var mine = d.households.filter(inSide);
    var counts = { send: 0, due: 0, waiting: 0, replied: 0 };
    mine.forEach(function (h) { counts[bucket(h)]++; });
    var msgs = d.messages.filter(function (m) { return S.side === "all" || (S.side === "mine" ? m.side === mySide() : m.side !== mySide()); });
    document.querySelectorAll("#tabs button").forEach(function (b) {
      var k = b.getAttribute("data-tab");
      b.setAttribute("aria-selected", k === S.tab ? "true" : "false");
      b.querySelector(".n").textContent = k === "messages" ? msgs.length : counts[k];
    });

    var hints = {
      send: "Tap WhatsApp or Text to open your messaging app with their personal message and link ready. You just press Send.",
      due: "These households haven't replied and are due a gentle reminder today.",
      waiting: "Invited, not replied yet, no reminder due today.",
      replied: "", messages: ""
    };
    $("hint").textContent = hints[S.tab];
    $("search").hidden = S.tab === "messages";

    if (S.tab === "messages") {
      $("list").innerHTML = msgs.length ? msgs.map(function (m) {
        return '<div class="msg"><div class="msg-head"><b>' + esc(m.household) + '</b><span>' + esc(day(m.at)) + "</span></div><p>" + esc(m.text) + "</p></div>";
      }).join("") : '<p class="empty">No messages yet.</p>';
      return;
    }
    var rows = mine.filter(function (h) { return bucket(h) === S.tab && matches(h); });
    rows.sort(function (a, b) { return a.household.localeCompare(b.household); });
    $("list").innerHTML = rows.length ? rows.map(card).join("") : '<p class="empty">' + (S.q ? "No matches." : { send: "Nobody left to send to.", due: "Nobody needs a reminder today.", waiting: "Nobody is waiting.", replied: "No replies yet." }[S.tab]) + "</p>";
  }

  function sideLabel(side) { var n = (S.data && S.data.sideNames) || {}; return (n[side] || side) + "'s side"; }

  function stat(v, label) { return '<div class="stat"><b>' + esc(v) + "</b><span>" + esc(label) + "</span></div>"; }

  function card(h) {
    var b = bucket(h);
    var chip = b === "replied" ? '<span class="chip replied">Replied</span>' : b === "due" ? '<span class="chip due">Reminder ' + h.nudgeStage + " due</span>" : b === "waiting" ? '<span class="chip sent">Sent ' + esc(day(h.sentAt)) + "</span>" : '<span class="chip not_sent">Not sent</span>';
    var people = h.guests.map(function (g) {
      var cls = g.response === "yes" ? "y" : g.response === "no" ? "n" : "q";
      var mark = g.response === "yes" ? "Y" : g.response === "no" ? "N" : "?";
      return '<span class="person"><span class="dot ' + cls + '" aria-label="' + (cls === "y" ? "attending" : cls === "n" ? "not attending" : "no reply") + '">' + mark + "</span>" + esc(g.name) + (g.plusOne ? " (guest)" : "") + "</span>";
    }).join("");
    var diets = h.guests.filter(function (g) { return g.response === "yes" && g.dietary; }).map(function (g) { return esc(g.name.split(" ")[0]) + ": " + esc(g.dietary); });
    var meta = [];
    if (h.sentAt && b !== "waiting") meta.push("Invited " + day(h.sentAt));
    if (h.reminders) meta.push(h.reminders + (h.reminders === 1 ? " reminder" : " reminders") + " sent");
    if (b === "waiting" && h.nextNudgeAt && !h.paused) meta.push("Next reminder due " + day(h.nextNudgeAt));
    if (h.paused && b !== "replied") meta.push("Reminders stopped for this household");
    if (h.respondedAt) meta.push("Replied " + day(h.respondedAt));

    var acts = "";
    var kind = b === "send" ? "invite" : b === "due" ? "reminder" : null;
    var busy = S.busy[h.code];
    if (kind) {
      if (h.hasPhone) {
        acts += '<button type="button" class="btn wa" data-act="open" data-kind="' + kind + '" data-ch="whatsapp" data-code="' + h.code + '"' + (busy ? " disabled" : "") + ">" + WA + "WhatsApp" + "</button>";
        acts += '<button type="button" class="btn sms" data-act="open" data-kind="' + kind + '" data-ch="sms" data-code="' + h.code + '"' + (busy ? " disabled" : "") + ">Text</button>";
      }
      acts += '<button type="button" class="btn plain" data-act="copy" data-kind="' + kind + '" data-code="' + h.code + '">Copy message</button>';
      if (!h.hasPhone && kind === "invite") acts += '<button type="button" class="btn plain" data-act="mark" data-code="' + h.code + '">Mark as sent</button>';
    }
    if ((b === "waiting" || b === "due") && h.hasPhone) {
      acts += '<button type="button" class="btn plain" data-act="open" data-kind="invite" data-ch="whatsapp" data-code="' + h.code + '">Resend invitation</button>';
    }
    if (b === "waiting" || b === "due") {
      acts += '<button type="button" class="btn plain" data-act="pause" data-code="' + h.code + '" data-paused="' + (h.paused ? "0" : "1") + '">' + (h.paused ? "Allow reminders" : "Stop reminders") + "</button>";
      if (!h.reminders) acts += '<button type="button" class="btn plain" data-act="unmark" data-code="' + h.code + '">Not actually sent</button>';
    }
    if (b === "replied") acts += '<button type="button" class="btn plain" data-act="copylink" data-code="' + h.code + '">Copy their link</button>';

    return '<article class="hh"><div class="hh-top"><div><div class="hh-name">' + esc(h.household) + '</div><div class="hh-addr">' + esc(h.addressee) +
      (S.side === "all" ? " · " + sideLabel(h.side) : "") + "</div></div>" + chip + "</div>" +
      '<div class="people">' + people + "</div>" +
      (meta.length ? '<div class="meta">' + esc(meta.join(" · ")) + "</div>" : "") +
      (!h.hasPhone && kind ? '<div class="meta">No mobile number in the Sheet. Copy the message and send it however you like, then tap Mark as sent.</div>' : "") +
      (acts ? '<div class="actions">' + acts + "</div>" : "") +
      (S.errors[h.code] ? '<div class="err">' + esc(S.errors[h.code]) + "</div>" : "") + "</article>";
  }

  /* ------------------------------------------------------------ actions */
  function find(code) { return S.data.households.filter(function (h) { return h.code === code; })[0]; }

  /* WhatsApp: the app scheme opens straight into the chat on phones; wa.me works everywhere else. */
  function appLink(h, kind, ch) {
    var L = h.links;
    if (ch === "sms") return kind === "invite" ? L.smsInvite : L.smsReminder;
    var web = kind === "invite" ? L.whatsappInvite : L.whatsappReminder;
    if (!mobile) return web;
    var m = web.match(/^https:\/\/wa\.me\/(\d+)\?text=(.*)$/);
    return m ? "whatsapp://send?phone=" + m[1] + "&text=" + m[2] : web;
  }

  var REFUSED = {
    replied: "They've just replied, so no reminder is needed.",
    paused: "Reminders are stopped for this household.",
    all_paused: "All reminders are paused in the Sheet.",
    max_reached: "They've already had the maximum number of reminders.",
    not_invited: "Their invitation hasn't been marked as sent yet."
  };

  function onOpen(btn) {
    var code = btn.getAttribute("data-code"), kind = btn.getAttribute("data-kind"), ch = btn.getAttribute("data-ch");
    var h = find(code);
    if (!h || S.busy[code]) return;
    S.busy[code] = true; delete S.errors[code]; render();
    var op = kind === "invite" ? "markSent" : "markNudged";
    call({ op: op, code: code, channel: ch }, 8000).then(function (r) {
      S.busy[code] = false;
      if (r && r.ok) {
        if (kind === "invite") { if (h.status === "not_sent") h.status = "sent"; h.sentAt = r.sentAt || h.sentAt || new Date().toISOString(); }
        else { h.reminders = r.reminders; h.nudgeDue = false; }
        render();
        window.location.href = appLink(h, kind, ch);
        return;
      }
      if (kind === "invite") { // recording failed but the invite can still go: open it and flag the gap
        S.errors[code] = "Couldn't record this as sent. Tap Refresh after sending.";
        render();
        window.location.href = appLink(h, kind, ch);
        return;
      }
      S.errors[code] = (r && REFUSED[r.error]) || "Couldn't check their status, so no reminder was opened. Try again.";
      render();
      if (r && r.error === "replied") load(true);
    }).catch(function () {
      S.busy[code] = false;
      if (kind === "invite") { S.errors[code] = "Couldn't record this as sent. Tap Refresh after sending."; render(); window.location.href = appLink(h, kind, ch); return; }
      S.errors[code] = "No connection, so no reminder was opened. Try again.";
      render();
    });
  }

  function copyText(text, done) {
    var ok = function () { toast(done); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) { toast("Couldn't copy. Long-press to copy instead."); } ta.remove();
    }
  }

  function simple(code, body, after) {
    S.busy[code] = true; render();
    call(Object.assign({ code: code }, body), 10000).then(function (r) {
      S.busy[code] = false;
      if (!r || !r.ok) { S.errors[code] = REFUSED[r && r.error] || "That didn't save. Try again."; render(); return; }
      after(r); load(true);
    }).catch(function () { S.busy[code] = false; S.errors[code] = "No connection. Try again."; render(); });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.parentNode && b.parentNode.classList && b.parentNode.classList.contains("sidebar")) { S.side = b.getAttribute("data-side"); render(); return; }
    if (b.getAttribute("role") === "tab") { S.tab = b.getAttribute("data-tab"); render(); return; }
    if (b.id === "refresh") { load(); return; }
    if (b.id === "csv") { downloadCsv(); return; }
    var act = b.getAttribute("data-act"); if (!act) return;
    var code = b.getAttribute("data-code"), h = find(code);
    if (act === "open") onOpen(b);
    if (act === "copy") copyText(b.getAttribute("data-kind") === "invite" ? h.links.inviteText : h.links.reminderText, "Message copied with their link");
    if (act === "copylink") copyText(h.links.url, "Their invitation link is copied");
    if (act === "mark") simple(code, { op: "markSent", channel: "other" }, function () { toast("Marked as sent"); });
    if (act === "unmark") simple(code, { op: "unmarkSent" }, function () { toast("Moved back to To send"); });
    if (act === "pause") simple(code, { op: "pause", paused: b.getAttribute("data-paused") === "1" }, function (r) { toast(r.paused ? "Reminders stopped for this household" : "Reminders allowed again"); });
  });
  /* ------------------------------------------------------------ adding a household (main sending key only) */
  function addErr(t) { $("addErr").textContent = t || ""; $("addErr").hidden = !t; }
  function openAdd(on) {
    $("addForm").hidden = !on;
    $("addToggle").hidden = on;
    addErr("");
    if (on) {
      $("addForm").reset();
      var mine = $("addForm").querySelector('input[name=addSide][value="' + mySide() + '"]');
      if (mine) mine.checked = true;
      $("addAddr").focus();
    }
  }
  $("addToggle").addEventListener("click", function () { openAdd(true); });
  $("addForm").addEventListener("input", function () { addErr(""); });
  $("addCancel").addEventListener("click", function () { openAdd(false); });
  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var addr = $("addAddr").value.replace(/\s+/g, " ").trim();
    var sideEl = $("addForm").querySelector("input[name=addSide]:checked");
    var names = $("addNames").value.split(/\n/).map(function (n) { return n.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    var phone = $("addPhone").value.trim();
    if (!addr) return addErr("Add the name for the envelope.");
    if (!sideEl) return addErr("Choose whose guests they are.");
    if (!names.length) return addErr("Add at least one name.");
    if (names.length > 30) return addErr("That's a lot of names for one household. Check there's one name per line.");
    if (phone && phone.replace(/\D/g, "").length < 10) return addErr("That mobile number looks too short.");
    var household = ($("addTest").checked ? "TEST " : "") + addr;
    var exists = S.data.households.some(function (h) { return h.household.toLowerCase() === household.toLowerCase(); });
    if (exists) return addErr("There's already a household with this name. To add people to it, ask Claude, or use the Sheet.");
    var plus = $("addPlus").checked ? "Y" : "";
    var rows = names.map(function (n) { return [addr, household, n, phone, sideEl.value, plus, ""]; });
    var go = $("addGo");
    go.disabled = true; go.textContent = "Adding…"; addErr("");
    call({ op: "importRows", rows: rows }, 30000).then(function (r) {
      go.disabled = false; go.textContent = "Add household";
      if (!r || !r.ok) return addErr(r && r.error === "unauthorised" ? "Only the main sending page can add households." : "That didn't save. Check your connection and try again.");
      if (r.problems && r.problems.length) return addErr("Something in that list couldn't be added (" + r.problems[0].why + "). Nothing has been sent.");
      openAdd(false);
      S.side = sideEl.value === mySide() ? "mine" : "other"; S.tab = "send"; S.q = addr; $("search").value = addr;
      toast("Added. Their invitation is ready below.");
      load(true);
    }).catch(function () { go.disabled = false; go.textContent = "Add household"; addErr("No connection. Try again."); });
  });

  $("search").addEventListener("input", function (e) { S.q = e.target.value.trim(); render(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.data) load(true); });

  function downloadCsv() {
    var rows = [["Household", "Addressed to", "Side", "Guest", "Response", "Dietary", "Invite sent", "Replied"]];
    S.data.households.forEach(function (h) {
      h.guests.forEach(function (g) {
        rows.push([h.household, h.addressee, ((S.data.sideNames || {})[h.side] || h.side), g.name + (g.plusOne ? " (guest)" : ""),
          g.response === "yes" ? "Attending" : g.response === "no" ? "Not attending" : "No reply", g.dietary, day(h.sentAt), day(h.respondedAt)]);
      });
    });
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "wedding-guests.csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  function showNoKey() { $("main").hidden = true; $("noKey").hidden = false; }

  /* ------------------------------------------------------------ local testing only */
  function demoCall(body) {
    return new Promise(function (res) {
      if (window.SendDemo) return res(window.SendDemo(body));
      var sc = document.createElement("script");
      sc.src = "../js/demo-send.js";
      sc.onload = function () { res(window.SendDemo ? window.SendDemo(body) : { ok: false, error: "unauthorised" }); };
      sc.onerror = function () { res({ ok: false, error: "unauthorised" }); };
      document.head.appendChild(sc);
    });
  }

  /* ------------------------------------------------------------ start */
  var m = location.hash.match(/k=([A-Za-z0-9]{16,64})/);
  if (m) { store(KEY_STORE, m[1]); history.replaceState(null, "", location.pathname + location.search); }
  S.key = (m && m[1]) || store(KEY_STORE);
  if (!S.key && API) { showNoKey(); return; }
  $("main").hidden = false;
  load();
})();
