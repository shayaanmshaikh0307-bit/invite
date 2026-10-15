/* Fills the floral slots on the card. Three sources:
   painted     – the generated watercolour PNG/WebP in art/florals/painted/
   custom      – your licensed PNGs dropped into art/custom/ (see README)
   svg         – SVG-filter watercolour drawn in the browser (fallback)
   placeholder – clean flat shapes, for layout work                        */
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var PALETTE = ["#C99260", "#EDB38E", "#C46A4C", "#EEC4B6", "#F2D6BF", "#D9927F"];

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function picture(base, widthPx) {
    var pic = document.createElement("picture");
    var src = document.createElement("source");
    src.type = "image/webp";
    src.srcset = base + "-800.webp 800w, " + base + ".webp 1500w";
    src.sizes = Math.round(widthPx) + "px";
    var img = document.createElement("img");
    img.src = base + "-800.png";
    img.alt = "";
    img.decoding = "async";
    pic.appendChild(src);
    pic.appendChild(img);
    return pic;
  }

  function customImg(slot, fallbackBase, widthPx) {
    var img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.src = "art/custom/floral-" + slot + ".png";
    img.onerror = function () { img.replaceWith(picture(fallbackBase, widthPx)); };
    return img;
  }

  // One cluster of 4-petal florets drawn as SVG paths.
  function clusterPaths(g, r, cx, cy, rx, ry, n, size, opacity) {
    for (var i = 0; i < n; i++) {
      var a = r() * Math.PI * 2, d = Math.sqrt(r());
      var x = cx + Math.cos(a) * d * rx, y = cy + Math.sin(a) * d * ry;
      var col = PALETTE[Math.floor(r() * PALETTE.length)];
      var rot = r() * 90;
      var s = size * (0.75 + r() * 0.5);
      var f = el("g", { transform: "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ") rotate(" + rot.toFixed(0) + ")" });
      for (var k = 0; k < 4; k++) {
        var p = el("path", {
          d: "M0 0 C " + (s * 0.15) + " " + (-s * 0.55) + ", " + (s * 0.95) + " " + (-s * 0.6) + ", " + s + " 0 C " + (s * 0.95) + " " + (s * 0.6) + ", " + (s * 0.15) + " " + (s * 0.55) + ", 0 0Z",
          transform: "rotate(" + (k * 90) + ")",
          fill: col, "fill-opacity": opacity
        });
        f.appendChild(p);
      }
      g.appendChild(f);
    }
  }

  function leaf(g, x, y, ang, len, w, col, op) {
    g.appendChild(el("path", {
      d: "M0 0 Q " + len * 0.5 + " " + -w + " " + len + " 0 Q " + len * 0.5 + " " + w + " 0 0Z",
      transform: "translate(" + x + " " + y + ") rotate(" + ang + ")",
      fill: col, "fill-opacity": op
    }));
  }

  function svgFlorals(slot, seed, watercolour) {
    var r = rng(seed);
    var svg = el("svg", { viewBox: "0 0 1000 1000", "aria-hidden": "true" });
    var g = el("g");
    if (watercolour) {
      var id = "wc" + seed;
      var defs = el("defs");
      var f = el("filter", { id: id, x: "-10%", y: "-10%", width: "120%", height: "120%" });
      f.appendChild(el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.035", numOctaves: "3", seed: String(seed % 97), result: "noise" }));
      f.appendChild(el("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: "16", xChannelSelector: "R", yChannelSelector: "G", result: "disp" }));
      f.appendChild(el("feGaussianBlur", { in: "disp", stdDeviation: "1.4", result: "soft" }));
      f.appendChild(el("feGaussianBlur", { in: "disp", stdDeviation: "5", result: "wide" }));
      // soft − wide boosts pigment where the wash meets dry paper: a wet edge
      f.appendChild(el("feComposite", { in: "soft", in2: "wide", operator: "arithmetic", k1: "0", k2: "1.7", k3: "-0.7", k4: "0" }));
      defs.appendChild(f);
      svg.appendChild(defs);
      g.setAttribute("filter", "url(#" + id + ")");
    }
    var op = watercolour ? 0.42 : 0.55;
    leaf(g, 640, 210, 160, 300, 70, "#B9B297", op * 0.8);
    leaf(g, 860, 430, 110, 280, 64, "#A8A085", op * 0.8);
    clusterPaths(g, r, 860, 170, 250, 220, 30, 62, op);
    clusterPaths(g, r, 930, 560, 130, 120, 12, 52, op);
    clusterPaths(g, r, 560, 80, 130, 100, 10, 50, op);
    if (slot === "bottom-left") g.setAttribute("transform", "rotate(180 500 500)");
    svg.appendChild(g);
    return svg;
  }

  function fill(mode, cardWidth) {
    var slots = document.querySelectorAll(".floral");
    for (var i = 0; i < slots.length; i++) {
      var node = slots[i];
      var slot = node.getAttribute("data-slot");
      var base = "art/florals/painted/floral-" + slot;
      var w = cardWidth * (node.classList.contains("floral-back") ? 0.42 : 0.66);
      var child;
      if (mode === "svg") child = svgFlorals(slot, slot === "top-right" ? 11 + i : 29 + i, true);
      else if (mode === "placeholder") child = svgFlorals(slot, slot === "top-right" ? 11 + i : 29 + i, false);
      else if (mode === "custom") child = customImg(slot, base, w);
      else child = picture(base, w);
      node.replaceChildren(child);
    }
    var stamp = document.querySelector(".stamp-flower");
    if (stamp) stamp.setAttribute("href", "art/florals/painted/stamp-floral-240.png");
  }

  window.InviteFlorals = { fill: fill };
})();
