/* Passaic River Water Watch: E. coli source map.
   Static page. NBC-01 data is a snapshot in data/nbc01-2026.json; outfalls,
   regional stations and reanalysis rainfall load live in the visitor's browser. */
(function () {
  'use strict';

  var CFG = {
    // Lower Passaic, Dundee Dam to Newark Bay, for CSOs and regional stations
    reachBox: [-74.20, 40.70, -74.08, 40.90],
    // Both banks within roughly two miles of the dock, for stormwater outfalls
    localBox: [-74.15, 40.80, -74.09, 40.86],
    csoUrl: 'https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer/0/query',
    ms4Url: 'https://mapsdep.nj.gov/arcgis/rest/services/Applications/MS4_Map/MapServer/5/query',
    wqpStations: 'https://www.waterqualitydata.us/data/Station/search',
    wqpResults: 'https://www.waterqualitydata.us/data/Result/search',
    meteo: 'https://archive-api.open-meteo.com/v1/archive',
    safe: 126, single: 235
  };
  var RAIN_BANDS = [
    { key: 'dry', label: 'Dry', range: '0 in', test: function (r) { return r < 0.005; } },
    { key: 'light', label: 'Light', range: 'up to 0.25 in', test: function (r) { return r >= 0.005 && r <= 0.25; } },
    { key: 'mod', label: 'Moderate', range: '0.26 to 0.75 in', test: function (r) { return r > 0.25 && r <= 0.75; } },
    { key: 'heavy', label: 'Heavy', range: 'over 0.75 in', test: function (r) { return r > 0.75; } }
  ];
  var TIDES = [
    { key: 'ebb', label: 'Falling tide', hint: 'water moving downstream' },
    { key: 'flood', label: 'Rising tide', hint: 'water moving upstream' },
    { key: 'slack', label: 'High slack', hint: 'little movement' }
  ];
  var RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

  var state = { data: null, modelRain: null, modelDaily: null, rainSrc: 'recorded', cso: null, ms4: null };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function geomean(a) {
    if (!a.length) return NaN;
    return Math.exp(a.reduce(function (s, v) { return s + Math.log(v); }, 0) / a.length);
  }
  function hexToRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  // Sequential colour on a log scale between the safe level and 3,000
  function colorFor(v) {
    var t = (Math.log(v) - Math.log(CFG.safe)) / (Math.log(3000) - Math.log(CFG.safe));
    t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    var i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    var a = hexToRgb(RAMP[i]), b = hexToRgb(RAMP[i + 1]);
    var c = a.map(function (x, k) { return Math.round(x + (b[k] - x) * f); });
    var lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return { bg: 'rgb(' + c.join(',') + ')', ink: lum > 0.6 ? '#0b0b0b' : '#ffffff' };
  }
  function rainOf(ev) {
    if (state.rainSrc === 'model' && state.modelRain && state.modelRain[ev.id] != null) return state.modelRain[ev.id];
    return ev.rain48_in;
  }

  /* tooltip */
  var tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.style.display = 'block';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + 'px';
    tip.style.top = Math.max(8, (y + h + 24 > window.innerHeight ? y - h - 12 : y + 16)) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }
  function bindTip(el, html) {
    el.addEventListener('mousemove', function (e) { showTip(html, e.clientX, e.clientY); });
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); showTip(html, r.left, r.bottom); });
    el.addEventListener('blur', hideTip);
  }
  function evTip(ev) {
    return '<b>' + esc(ev.id) + ', ' + esc(ev.date) + ' ' + esc(ev.time) + '</b><br>' +
      fmt(ev.ecoli) + ' CFU/100 mL (' + (ev.ecoli / CFG.safe).toFixed(1) + '× the 126 level)<br>' +
      'Rain, 48 h: ' + ev.rain48_in.toFixed(2) + ' in recorded' +
      (state.modelRain && state.modelRain[ev.id] != null ? ', ' + state.modelRain[ev.id].toFixed(2) + ' in reanalysis' : '') +
      '<br>Tide: ' + esc(ev.tide_stage) + (ev.flag ? '<br><i>' + esc(ev.flag) + '</i>' : '');
  }

  /* 1. tiles */
  function renderTiles() {
    var ev = state.data.events, vals = ev.map(function (e) { return e.ecoli; });
    var gm = geomean(vals);
    var over = vals.filter(function (v) { return v > CFG.single; }).length;
    var max = ev.reduce(function (a, b) { return b.ecoli > a.ecoli ? b : a; });
    var tiles = [
      [fmt(gm), 'season geometric mean, CFU/100 mL'],
      [(gm / CFG.safe).toFixed(1) + '×', 'the 126 CFU/100 mL recreation level'],
      [over + ' of ' + vals.length, 'samples above the 235 single-sample level'],
      [fmt(max.ecoli), 'highest reading (' + max.id + ', ' + max.date + ')']
    ];
    $('tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div>';
    }).join('');
  }

  /* 2. heatmap */
  function renderHeatmap() {
    var ev = state.data.events, hm = $('hm');
    hm.innerHTML = '';
    var add = function (cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; hm.appendChild(d); return d; };
    add('ch', '');
    RAIN_BANDS.forEach(function (b) { add('ch', '<b>' + b.label + '</b><br>' + b.range); });
    TIDES.forEach(function (t) {
      add('rh', '<b>' + t.label + '</b><span>' + t.hint + '</span>');
      RAIN_BANDS.forEach(function (b) {
        var hits = ev.filter(function (e) { return e.tide_phase === t.key && b.test(rainOf(e)); });
        if (!hits.length) { add('cell empty', 'no samples'); return; }
        var gm = geomean(hits.map(function (e) { return e.ecoli; })), c = colorFor(gm);
        var d = add('cell', '<span class="v">' + fmt(gm) + '</span><span class="n">' +
          hits.map(function (e) { return e.id; }).join(', ') + ' (n=' + hits.length + ')</span>');
        d.style.background = c.bg; d.style.color = c.ink; d.tabIndex = 0;
        d.setAttribute('aria-label', t.label + ', ' + b.label + ' rain: ' + fmt(gm) + ' CFU per 100 mL, ' + hits.length + ' samples');
        bindTip(d, '<b>' + t.label + ', ' + b.label.toLowerCase() + ' rain</b><br>' + hits.map(function (e) {
          return esc(e.id) + ' ' + esc(e.date) + ': ' + fmt(e.ecoli) + ' (' + rainOf(e).toFixed(2) + ' in)';
        }).join('<br>'));
      });
    });

    // plain-language reading of the grid, computed from the data
    var wet = ev.filter(function (e) { return rainOf(e) > 0.25; }), dry = ev.filter(function (e) { return rainOf(e) < 0.005; });
    var ebb = ev.filter(function (e) { return e.tide_phase === 'ebb'; }), fl = ev.filter(function (e) { return e.tide_phase === 'flood'; });
    var g = function (a) { return a.length ? fmt(geomean(a.map(function (e) { return e.ecoli; }))) + ' (n=' + a.length + ')' : 'no samples'; };
    $('hmNote').innerHTML = 'Geometric means: over 0.25 in of rain ' + g(wet) + ', dry ' + g(dry) +
      '; falling tide ' + g(ebb) + ', rising tide ' + g(fl) + '.' + (dry.length && Math.min.apply(null, dry.map(function (e) { return e.ecoli; })) > CFG.single
        ? ' Every dry-weather sample is still above 235, which a rain-only source would not explain.' : '') +
      (state.rainSrc === 'recorded' ? ' Weeks W09 and W10 were logged as 0.00 in without a gauge reading; switch the rainfall source to check them.' : '');
    renderEventTable();
  }

  function renderEventTable() {
    var hasModel = !!state.modelRain;
    var rows = state.data.events.map(function (e) {
      var m = hasModel && state.modelRain[e.id] != null ? state.modelRain[e.id] : null;
      var differs = m != null && Math.abs(m - e.rain48_in) >= 0.25;
      return '<tr><td>' + esc(e.id) + '</td><td>' + esc(e.date) + ' ' + esc(e.time) + '</td><td class="num">' + fmt(e.ecoli) +
        '</td><td>' + esc(e.tide_stage) + '</td><td class="num">' + e.rain48_in.toFixed(2) + '</td><td class="num' + (differs ? ' warn' : '') + '">' +
        (m == null ? 'n/a' : m.toFixed(2) + (differs ? ' ⚠' : '')) + '</td><td class="wrap">' + esc(e.rain_source) + (e.flag ? '. ' + esc(e.flag) : '') + '</td></tr>';
    }).join('');
    $('evTable').innerHTML = '<thead><tr><th>Week</th><th>Sampled</th><th class="num">E. coli, CFU/100 mL</th><th>Tide</th>' +
      '<th class="num">Rain 48 h, recorded (in)</th><th class="num">Rain 48 h, reanalysis (in)</th><th>Notes</th></tr></thead><tbody>' + rows + '</tbody>';
  }

  /* 3. timeline: two stacked panels sharing a time axis (no dual axis) */
  function renderTimeline() {
    var ev = state.data.events, W = 960, H = 380, L = 56, R = 16;
    var t0 = Date.parse('2026-08-20T00:00:00Z'), t1 = Date.parse('2026-11-12T00:00:00Z'), DAY = 864e5;
    var x = function (ms) { return L + (ms - t0) / (t1 - t0) * (W - L - R); };
    var rain = state.modelDaily || state.data.rain_gauge_daily_in;
    var usingModel = !!state.modelDaily;
    var rTop = 16, rH = 90, eTop = 140, eH = 196;
    var rMax = Math.max(1, Math.max.apply(null, Object.keys(rain).map(function (k) { return rain[k]; })));
    var ly = function (v) { return eTop + eH - (Math.log10(v) - 2) / (Math.log10(5000) - 2) * eH; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="min-width:640px;width:100%" role="img" aria-label="Daily rainfall and E. coli samples, August to November 2026">';

    // rainfall panel
    s += '<text x="' + L + '" y="' + (rTop - 4) + '">Daily rain (in)' + (usingModel ? ', Open-Meteo reanalysis' : ', project gauge') + '</text>';
    [0, rMax].forEach(function (v) {
      var y = rTop + rH - v / rMax * rH;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#e3e2dc"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
    });
    if (!usingModel) { // shade days with no gauge reading
      var gaps = [], cur = null;
      for (var t = t0; t < t1; t += DAY) {
        var k = new Date(t).toISOString().slice(0, 10), missing = !(k in rain);
        if (missing && cur == null) cur = t;
        if (!missing && cur != null) { gaps.push([cur, t]); cur = null; }
      }
      if (cur != null) gaps.push([cur, t1]);
      gaps.forEach(function (gp) {
        s += '<rect x="' + x(gp[0]) + '" y="' + rTop + '" width="' + (x(gp[1]) - x(gp[0])) + '" height="' + rH + '" fill="#f4f3ef"/>';
      });
    }
    Object.keys(rain).forEach(function (k) {
      var v = rain[k]; if (!(v > 0)) return;
      var ms = Date.parse(k + 'T00:00:00Z'), h = v / rMax * rH, bw = Math.max(2, x(ms + DAY) - x(ms) - 2);
      s += '<rect class="rb" data-k="' + k + '" x="' + (x(ms) + 1) + '" y="' + (rTop + rH - h) + '" width="' + bw + '" height="' + h + '" rx="2" fill="#86b6ef"/>';
    });

    // E. coli panel, log scale
    s += '<text x="' + L + '" y="' + (eTop - 8) + '">E. coli (CFU/100 mL, log scale)</text>';
    [100, 300, 1000, 3000].forEach(function (v) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ly(v) + '" y2="' + ly(v) + '" stroke="#eeede8"/><text x="' + (L - 6) + '" y="' + (ly(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>';
    });
    [[CFG.safe, '126 geometric-mean level'], [CFG.single, '235 single-sample level']].forEach(function (th) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ly(th[0]) + '" y2="' + ly(th[0]) + '" stroke="#7b7a74" stroke-dasharray="4 4"/>' +
        '<text x="' + (L + 4) + '" y="' + (ly(th[0]) - 4) + '">' + th[1] + '</text>';
    });
    ev.forEach(function (e, i) {
      var ms = Date.parse(e.date + 'T' + e.time + ':00Z'), cx = x(ms), cy = ly(e.ecoli);
      s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + (rTop + rH) + '" y2="' + cy + '" stroke="#d6d5cf" stroke-dasharray="2 3"/>';
      s += '<circle class="pt" data-i="' + i + '" tabindex="0" cx="' + cx + '" cy="' + cy + '" r="7" fill="' +
        (e.tide_phase === 'flood' ? '#ffffff' : '#1c5cab') + '" stroke="#1c5cab" stroke-width="2"/>';
      s += '<circle class="pt" data-i="' + i + '" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent"/>';
      s += '<text x="' + cx + '" y="' + (cy - 12) + '" text-anchor="middle">' + e.id + '</text>';
    });
    // month ticks
    ['2026-09-01', '2026-10-01', '2026-11-01'].forEach(function (d) {
      var px = x(Date.parse(d + 'T00:00:00Z'));
      s += '<line x1="' + px + '" x2="' + px + '" y1="' + (eTop + eH) + '" y2="' + (eTop + eH + 5) + '" stroke="#7b7a74"/>' +
        '<text x="' + px + '" y="' + (eTop + eH + 20) + '" text-anchor="middle">' + new Date(d + 'T12:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' 1</text>';
    });
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (eTop + eH) + '" y2="' + (eTop + eH) + '" stroke="#7b7a74"/>';
    s += '<circle cx="' + (L + 8) + '" cy="' + (H - 8) + '" r="5" fill="#1c5cab"/><text x="' + (L + 18) + '" y="' + (H - 4) + '">falling tide or slack</text>';
    s += '<circle cx="' + (L + 168) + '" cy="' + (H - 8) + '" r="5" fill="#fff" stroke="#1c5cab" stroke-width="2"/><text x="' + (L + 178) + '" y="' + (H - 4) + '">rising tide</text>';
    s += '</svg>';
    $('timeline').innerHTML = s;
    Array.prototype.forEach.call($('timeline').querySelectorAll('.pt'), function (el) { bindTip(el, evTip(ev[+el.getAttribute('data-i')])); });
    Array.prototype.forEach.call($('timeline').querySelectorAll('.rb'), function (el) {
      var k = el.getAttribute('data-k'); bindTip(el, '<b>' + k + '</b><br>' + rain[k].toFixed(2) + ' in');
    });
    $('tlNote').textContent = usingModel
      ? 'Rainfall bars are Open-Meteo gridded reanalysis for the dock location. It is a model estimate, so check it against a nearby airport gauge before quoting a number.'
      : 'Rainfall bars are the project gauge. Shaded spans have no gauge reading (before 2 September, and 19 October to 6 November).';
  }

  /* live rainfall */
  function loadRain() {
    var q = '?latitude=40.83&longitude=-74.12&start_date=2026-08-20&end_date=2026-11-10&hourly=precipitation&precipitation_unit=inch&timezone=America%2FNew_York';
    return fetch(CFG.meteo + q).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      var times = j.hourly.time, p = j.hourly.precipitation, idx = {}, daily = {};
      times.forEach(function (t, i) {
        idx[t] = i; var d = t.slice(0, 10);
        if (p[i] != null) daily[d] = (daily[d] || 0) + p[i];
      });
      var model = {};
      state.data.events.forEach(function (e) {
        var i = idx[e.date + 'T' + e.time.slice(0, 2) + ':00']; if (i == null) return;
        var sum = 0, n = 0;
        for (var k = Math.max(0, i - 47); k <= i; k++) if (p[k] != null) { sum += p[k]; n++; }
        if (n >= 40) model[e.id] = Math.round(sum * 100) / 100;
      });
      if (!Object.keys(model).length) throw new Error('no overlap');
      state.modelRain = model; state.modelDaily = daily;
      var inp = document.querySelector('input[value="model"]'); inp.disabled = false;
      $('lblModel').removeAttribute('aria-disabled'); $('modelState').textContent = '';
      renderHeatmap(); renderTimeline();
    }).catch(function () { $('modelState').textContent = '(unavailable right now)'; });
  }

  /* map */
  var map, statusEls = {};
  function chip(key, color, label) {
    var el = document.createElement('span'); el.className = 'chip';
    el.innerHTML = '<i style="background:' + color + '"></i><span>' + esc(label) + ': loading</span>';
    $('status').appendChild(el); statusEls[key] = { el: el, label: label };
  }
  function setChip(key, text, err) {
    var s = statusEls[key]; s.el.lastChild.textContent = s.label + ': ' + text; s.el.classList.toggle('err', !!err);
  }
  function arcgis(url, box, fields) {
    var q = '?f=geojson&where=1%3D1&geometry=' + box.join(',') + '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326' +
      '&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=' + fields;
    return fetch(url + q).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j.features) throw new Error('no features'); return j; });
  }
  function propTable(p, keys) {
    return keys.filter(function (k) { return p[k[0]] != null && p[k[0]] !== ''; }).map(function (k) {
      return '<b>' + k[1] + ':</b> ' + esc(p[k[0]]);
    }).join('<br>');
  }
  function distMi(lat, lon) {
    var s = state.data.station, rad = Math.PI / 180;
    var dy = (lat - s.lat) * 69.05, dx = (lon - s.lon) * 69.17 * Math.cos(s.lat * rad);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function renderNearest() {
    var rows = [];
    [['cso', 'Combined sewer overflow'], ['ms4', 'Stormwater']].forEach(function (kind) {
      (state[kind[0]] || []).forEach(function (f) {
        var c = f.geometry && f.geometry.coordinates; if (!c) return;
        var p = f.properties || {};
        rows.push({ type: kind[1], id: p.CSO_ID || p.OUTFALL_ID || p.LOCAL_ID || '', town: p.MUNICIPALITY || '',
          water: p.RECV_WATER || p.ROADNAME || '', d: distMi(c[1], c[0]), up: c[1] > state.data.station.lat });
      });
    });
    if (!rows.length) { if (state.cso !== null || state.ms4 !== null) return;
      $('nearTable').innerHTML = '<tbody><tr><td>Outfall data did not load. Try again later, or open the NJDEP links under Data sources.</td></tr></tbody>'; return; }
    rows.sort(function (a, b) { return a.d - b.d; });
    $('nearTable').innerHTML = '<thead><tr><th>Type</th><th>ID</th><th>Municipality</th><th>Receiving water or road</th><th class="num">Distance (mi)</th><th>Side</th></tr></thead><tbody>' +
      rows.slice(0, 15).map(function (r) {
        return '<tr><td>' + r.type + '</td><td>' + esc(r.id) + '</td><td>' + esc(r.town) + '</td><td>' + esc(r.water) +
          '</td><td class="num">' + r.d.toFixed(1) + '</td><td>' + (r.up ? 'upstream (north)' : 'downstream (south)') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0];
    return rows.slice(1).filter(function (r) { return r.length === head.length; }).map(function (r) {
      var o = {}; head.forEach(function (h, k) { o[h] = r[k]; }); return o;
    });
  }

  function initMap() {
    var st = state.data.station;
    map = L.map('map', { scrollWheelZoom: false }).setView([st.lat, st.lon], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    var gm = geomean(state.data.events.map(function (e) { return e.ecoli; }));
    L.circleMarker([st.lat, st.lon], { radius: 10, color: '#fff', weight: 2, fillColor: '#0b0b0b', fillOpacity: 1 })
      .bindPopup('<b>NBC-01, Nereid Boat Club dock</b><br>2026 season geometric mean: ' + fmt(gm) + ' CFU/100 mL (' +
        state.data.events.length + ' samples)<br>Position published to two decimal places.').addTo(map);
    var layers = { cso: L.layerGroup().addTo(map), ms4: L.layerGroup().addTo(map), hdg: L.layerGroup().addTo(map) };
    L.control.layers(null, { 'Combined sewer overflows': layers.cso, 'Stormwater outfalls': layers.ms4, 'Harbor Dischargers Group stations': layers.hdg }, { collapsed: window.innerWidth < 640 }).addTo(map);

    chip('cso', '#eb6834', 'Combined sewer overflows');
    chip('ms4', '#1baf7a', 'Stormwater outfalls');
    chip('hdg', '#2a78d6', 'Harbor Dischargers Group stations');

    arcgis(CFG.csoUrl, CFG.reachBox, 'CSO_ID,PERMITTEE,MUNICIPALITY,RECV_WATER,STP,CSO_STAT,DMR_URL').then(function (j) {
      state.cso = j.features;
      j.features.forEach(function (f) {
        var c = f.geometry.coordinates, p = f.properties;
        var html = '<b>Combined sewer overflow</b><br>' + propTable(p, [['CSO_ID', 'ID'], ['MUNICIPALITY', 'Municipality'], ['PERMITTEE', 'Permittee'],
          ['RECV_WATER', 'Receiving water'], ['STP', 'Treatment plant'], ['CSO_STAT', 'Status']]) +
          (/^https?:\/\//.test(p.DMR_URL || '') ? '<br><a href="' + esc(p.DMR_URL) + '" target="_blank" rel="noopener">Discharge monitoring reports</a>' : '');
        L.circleMarker([c[1], c[0]], { radius: 6, color: '#fff', weight: 2, fillColor: '#eb6834', fillOpacity: 1 }).bindPopup(html).addTo(layers.cso);
      });
      setChip('cso', j.features.length + ' in the Lower Passaic area'); renderNearest();
    }).catch(function () { setChip('cso', 'could not load from NJDEP', true); state.csoFail = true; if (state.ms4Fail) renderNearest(); });

    arcgis(CFG.ms4Url, CFG.localBox, 'OUTFALL_ID,LOCAL_ID,MUNICIPALITY,ROADNAME,OWNERTYPE,OUTFALLTYPE,ORGANIZATION').then(function (j) {
      state.ms4 = j.features;
      j.features.forEach(function (f) {
        var c = f.geometry.coordinates, p = f.properties;
        L.circleMarker([c[1], c[0]], { radius: 4, color: '#fff', weight: 1, fillColor: '#1baf7a', fillOpacity: 1 })
          .bindPopup('<b>Stormwater outfall</b><br>' + propTable(p, [['OUTFALL_ID', 'ID'], ['LOCAL_ID', 'Local ID'], ['MUNICIPALITY', 'Municipality'],
            ['ROADNAME', 'Road'], ['OWNERTYPE', 'Owner'], ['OUTFALLTYPE', 'Type'], ['ORGANIZATION', 'Organization']])).addTo(layers.ms4);
      });
      var more = j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit);
      setChip('ms4', j.features.length + (more ? '+ (list truncated by server)' : '') + ' within about 2 miles'); renderNearest();
    }).catch(function () { setChip('ms4', 'could not load from NJDEP', true); state.ms4Fail = true; if (state.csoFail) renderNearest(); });

    var bb = 'organization=NJHDG&bBox=' + CFG.reachBox.join(',');
    var names = ['Escherichia coli', 'Fecal Coliform', 'Enterococcus'];
    Promise.all([
      fetch(CFG.wqpStations + '?' + bb + '&mimeType=csv&zip=no').then(function (r) { if (!r.ok) throw new Error(); return r.text(); }),
      fetch(CFG.wqpResults + '?' + bb + names.map(function (n) { return '&characteristicName=' + encodeURIComponent(n); }).join('') +
        '&startDateLo=01-01-2010&mimeType=csv&zip=no&dataProfile=narrowResult').then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
    ]).then(function (res) {
      var stations = parseCsv(res[0]), results = parseCsv(res[1]), by = {};
      results.forEach(function (r) {
        var v = parseFloat(String(r.ResultMeasureValue).replace(/[^0-9.]/g, '')); if (!(v > 0)) return;
        var id = r.MonitoringLocationIdentifier, ch = r.CharacteristicName;
        var o = ((by[id] = by[id] || {})[ch] = by[id][ch] || { v: [], y0: 9999, y1: 0, unit: r['ResultMeasure/MeasureUnitCode'] });
        o.v.push(v); var y = +String(r.ActivityStartDate).slice(0, 4); if (y) { o.y0 = Math.min(o.y0, y); o.y1 = Math.max(o.y1, y); }
      });
      var n = 0;
      stations.forEach(function (s) {
        var lat = parseFloat(s.LatitudeMeasure), lon = parseFloat(s.LongitudeMeasure); if (!isFinite(lat) || !isFinite(lon)) return;
        var d = by[s.MonitoringLocationIdentifier] || {}, ec = d['Escherichia coli'];
        var lines = Object.keys(d).map(function (ch) {
          return esc(ch) + ': geometric mean ' + fmt(geomean(d[ch].v)) + ' ' + esc(d[ch].unit || '') + ' (n=' + d[ch].v.length + ', ' + d[ch].y0 + ' to ' + d[ch].y1 + ')';
        });
        var style = ec ? { radius: 9, color: '#fff', weight: 2, fillColor: colorFor(geomean(ec.v)).bg, fillOpacity: 1 }
          : { radius: 7, color: '#7b7a74', weight: 2, fillColor: '#fff', fillOpacity: 1 };
        L.circleMarker([lat, lon], style).bindPopup('<b>' + esc(s.MonitoringLocationName) + '</b><br>' + esc(s.MonitoringLocationIdentifier) + '<br>' +
          (lines.length ? lines.join('<br>') : 'No bacteria results since 2010 in the portal.')).addTo(layers.hdg);
        n++;
      });
      if (!n) throw new Error('none');
      setChip('hdg', n + ' stations, results since 2010');
    }).catch(function () { setChip('hdg', 'could not load from the Water Quality Portal', true); });
  }

  /* boot */
  fetch('data/nbc01-2026.json').then(function (r) { return r.json(); }).then(function (d) {
    state.data = d;
    renderTiles(); renderHeatmap(); renderTimeline();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="rainsrc"]'), function (inp) {
      inp.addEventListener('change', function () { state.rainSrc = inp.value; renderHeatmap(); });
    });
    try { initMap(); } catch (e) { $('map').textContent = 'The map could not start.'; }
    loadRain();
  }).catch(function () {
    $('tiles').innerHTML = '<p class="warn">The station data file did not load. Serve this folder over http(s) rather than opening the file directly.</p>';
  });
})();
