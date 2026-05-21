/* =========================================================
   Fire, Weather, and the Systems Between
   - Live data: NASA GIBS (WMS), NIFC (ArcGIS), NOAA NWS
   - Stack: vanilla JS + Leaflet, no build step
   ========================================================= */

(() => {

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const fmtAcres = (a) => a == null ? '—' : (a >= 1000 ? `${(a/1000).toFixed(1)}k ac` : `${Math.round(a)} ac`);
const fmtPct = (p) => (p == null ? '—' : `${Math.round(p)}%`);
const isoDay = (d) => d.toISOString().slice(0, 10);
const subDays = (base, n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return d; };
const dayName = (date, today) => {
  const diff = Math.round((today - date) / (1000*60*60*24));
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return `${diff} days ago`;
};

// ---------- state ----------
const TODAY = new Date(new Date().toISOString().slice(0,10) + 'T00:00:00Z'); // UTC midnight
const DAYS_BACK = 6;
let selectedDayOffset = 0;     // 0 = today, 6 = oldest
let selectedItem = null;        // currently locked selection (clicked)
let currentLens = 'explorer';
let playing = false;
let playTimer = null;

// ---------- map ----------
const map = L.map('map', {
  center: [36, -98],
  zoom: 4,
  worldCopyJump: true,
  zoomControl: true,
  attributionControl: true,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  attribution: '',
  subdomains: 'abcd',
  maxZoom: 19,
  pane: 'shadowPane',
  opacity: 0.6,
}).addTo(map);

// ---------- GIBS thermal anomaly WMS (raster, scrubbable) ----------
const gibsLayers = {};  // cache by date

function gibsLayerFor(dateStr) {
  if (gibsLayers[dateStr]) return gibsLayers[dateStr];
  const layer = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
    layers: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
    format: 'image/png',
    transparent: true,
    time: dateStr,
    version: '1.1.1',
    attribution: 'NASA GIBS VIIRS NOAA-20 thermal anomalies',
    opacity: 0.9,
  });
  gibsLayers[dateStr] = layer;
  return layer;
}

let currentGibs = null;
function showGibsFor(dateStr) {
  const next = gibsLayerFor(dateStr);
  if (currentGibs === next) return;
  if (currentGibs) map.removeLayer(currentGibs);
  next.addTo(map);
  currentGibs = next;
}

// ---------- NIFC active US incidents ----------
const NIFC_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
let incidentLayer = L.layerGroup().addTo(map);
let incidentData = [];

function radiusForAcres(a) {
  if (!a || a < 1) return 4;
  // log scaling: 1ac → 4px, 100 → 8, 10k → 13, 100k → 16
  return Math.min(20, 4 + Math.log10(a) * 2.6);
}

async function loadIncidents() {
  const params = new URLSearchParams({
    where: 'ActiveFireCandidate=1',
    outFields: 'IncidentName,IncidentSize,DiscoveryAcres,PercentContained,POOState,FireDiscoveryDateTime,FireCause,IncidentTypeCategory,IncidentManagementOrganization,InitialLatitude,InitialLongitude,UniqueFireIdentifier,IncidentComplexityLevel,FireBehaviorGeneral,GACC',
    resultRecordCount: '2000',
    f: 'json',
  });
  const res = await fetch(`${NIFC_URL}?${params}`);
  const json = await res.json();
  incidentData = (json.features || [])
    .map(f => f.attributes)
    .filter(a => a.InitialLatitude && a.InitialLongitude && Math.abs(a.InitialLatitude) <= 90);

  incidentLayer.clearLayers();
  for (const inc of incidentData) {
    const acres = inc.IncidentSize ?? inc.DiscoveryAcres ?? 0;
    const m = L.circleMarker([inc.InitialLatitude, inc.InitialLongitude], {
      radius: radiusForAcres(acres),
      color: '#ffffff',
      weight: 1,
      fillColor: '#ff6b35',
      fillOpacity: 0.78,
    });
    m.bindTooltip(
      `<strong>${inc.IncidentName ?? 'Unnamed'}</strong><br>${fmtAcres(acres)} · ${fmtPct(inc.PercentContained)} contained`,
      { className: 'fire-tooltip', sticky: true }
    );
    m.on('mouseover', () => showDetail({ kind: 'incident', data: inc }, false));
    m.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      showDetail({ kind: 'incident', data: inc }, true);
    });
    incidentLayer.addLayer(m);
  }

  $('#stat-incidents').textContent = incidentData.length.toLocaleString();
  const biggest = incidentData.reduce((a, b) => (a.IncidentSize ?? 0) > (b.IncidentSize ?? 0) ? a : b, {});
  $('#stat-biggest').textContent = biggest.IncidentName
    ? `${biggest.IncidentName} (${fmtAcres(biggest.IncidentSize)})`
    : '—';
}

// ---------- NOAA red-flag warnings + fire weather watches ----------
const NOAA_URL = 'https://api.weather.gov/alerts/active?event=Red%20Flag%20Warning,Fire%20Weather%20Watch,Extreme%20Fire%20Danger';
let warningLayer = L.layerGroup().addTo(map);
let warningData = [];

async function loadWarnings() {
  const res = await fetch(NOAA_URL, {
    headers: { 'Accept': 'application/geo+json' },
  });
  const json = await res.json();
  warningData = json.features || [];

  warningLayer.clearLayers();
  let rendered = 0;
  for (const f of warningData) {
    if (!f.geometry) continue;
    const isRedFlag = f.properties.event === 'Red Flag Warning';
    const layer = L.geoJSON(f, {
      style: {
        color: isRedFlag ? '#f4a261' : '#e9c46a',
        weight: 1,
        fillColor: isRedFlag ? '#f4a261' : '#e9c46a',
        fillOpacity: 0.18,
        dashArray: isRedFlag ? null : '4 4',
      },
    });
    layer.on('mouseover', (e) => { e.target.setStyle({ fillOpacity: 0.35 }); showDetail({ kind: 'warning', data: f.properties }, false); });
    layer.on('mouseout',  (e) => { e.target.setStyle({ fillOpacity: 0.18 }); });
    layer.on('click', (ev) => { L.DomEvent.stopPropagation(ev); showDetail({ kind: 'warning', data: f.properties }, true); });
    warningLayer.addLayer(layer);
    rendered++;
  }

  // Count unique zones across all warnings (each warning can affect multiple zones)
  $('#stat-warnings').textContent = warningData.length.toLocaleString();
}

// ---------- detail panel + lens switcher ----------
const NARRATIVES = {
  explorer: {
    title: 'The big picture',
    body: `
      <div class="narrative-block">
        Every orange glow on the map is a satellite reading hot enough to almost certainly be a fire,
        a flare, or a freshly burned scar — captured by VIIRS sensors aboard NOAA-20, twice a day, 375m resolution.
      </div>
      <div class="narrative-block">
        The dots layered on top are <strong>managed US incidents</strong> — fires with names, perimeters,
        and crews. The amber shading shows where the National Weather Service has declared today's atmosphere
        already <em>primed</em> to burn: dry air, fast winds, low humidity.
      </div>
      <div class="narrative-block">
        Pull the scrubber backwards. You're looking at <strong>where the planet was on fire</strong> on that day.
        Now ask: what was the weather, the wind, the rainfall <em>three days before</em>? That's the system.
      </div>`,
  },
  firefighter: {
    title: 'Tactical view',
    body: `
      <div class="narrative-block">
        Red-flag zones forecast the conditions you already know mean trouble:
        <strong>RH below 15%, sustained winds above 20 mph, fuels critically dry.</strong>
        Cross-reference them with the incident dots — a small fire inside a red-flag zone deserves
        more pre-positioned resources than the acreage alone suggests.
      </div>
      <div class="narrative-block">
        Hover an incident for its complexity level, current containment, and fire behavior summary
        as reported to ICS-209.
      </div>`,
  },
  climatologist: {
    title: 'Climate signal',
    body: `
      <div class="narrative-block">
        The thermal-anomaly heatmap is dense where fuels are dry and ignitions cluster.
        Scrub through the last week to see <strong>movement</strong> — the way the heat travels
        with the jet stream and the diurnal cycle. That motion is the system you're really watching.
      </div>
      <div class="narrative-block">
        Red-flag warnings concentrate where the seasonal drought signal meets a synoptic-scale wind event.
        Their footprint is a real-time map of where the <em>climatology has already failed</em> the landscape.
      </div>`,
  },
  resident: {
    title: 'If you live near one',
    body: `
      <div class="narrative-block">
        Click a fire near you to see its <strong>containment status, cause, and how long it's been burning</strong>.
        Hover the amber zones to read the actual NWS warning text — they include specific impacts and recommended actions.
      </div>
      <div class="narrative-block">
        Worth knowing: containment percent is <em>not</em> how much has burned, it's the share of the perimeter
        crews believe will hold. A 5% contained fire in a red-flag zone tomorrow morning is the one to watch tonight.
      </div>`,
  },
};

function setLens(lens) {
  currentLens = lens;
  document.querySelectorAll('.lens').forEach(b => b.classList.toggle('active', b.dataset.lens === lens));
  if (!selectedItem) renderDefault();
  else showDetail(selectedItem, true); // re-render under new lens
}

function renderDefault() {
  const n = NARRATIVES[currentLens] || NARRATIVES.explorer;
  $('#detail').innerHTML = `
    <h2 id="panel-title">${n.title}</h2>
    <div id="panel-body">${n.body}</div>
    <p class="muted" style="margin-top:14px">Hover or click a fire, a warning zone, or scrub the timeline to dig in.</p>
  `;
}

function clearPreview() { if (!selectedItem) renderDefault(); else showDetail(selectedItem, true); }

function showDetail(item, lock) {
  if (lock) selectedItem = item;
  if (item.kind === 'incident') renderIncident(item.data);
  else if (item.kind === 'warning') renderWarning(item.data);
}

function renderIncident(inc) {
  const acres = inc.IncidentSize ?? inc.DiscoveryAcres ?? 0;
  const discovered = inc.FireDiscoveryDateTime ? new Date(inc.FireDiscoveryDateTime) : null;
  const daysBurning = discovered ? Math.max(0, (Date.now() - discovered.getTime()) / (1000*60*60*24)) : null;
  const containment = inc.PercentContained;
  const isHot = (acres > 1000) && (containment == null || containment < 25);
  // Per-lens framing
  const lensFraming = {
    explorer:      `An active wildland fire incident currently being managed.`,
    firefighter:   `Complexity ${inc.IncidentComplexityLevel ?? '—'}. GACC: ${inc.GACC ?? '—'}. Behavior: ${inc.FireBehaviorGeneral ?? 'not reported'}.`,
    climatologist: `Burning ${daysBurning != null ? daysBurning.toFixed(1) + ' days' : '—'} in ${inc.POOState?.replace('US-','') ?? '—'}. Cause class: ${inc.FireCause ?? '—'}.`,
    resident:      `${inc.PercentContained != null ? fmtPct(inc.PercentContained) + ' contained.' : 'Containment not yet reported.'} ${isHot ? 'Conditions remain dynamic — monitor local alerts.' : ''}`,
  };
  $('#detail').innerHTML = `
    <h2>${inc.IncidentName ?? 'Unnamed incident'}</h2>
    <div>
      ${isHot ? '<span class="pill hot">active &amp; growing</span>' : '<span class="pill">managed</span>'}
      <span class="pill">${inc.POOState?.replace('US-','') ?? '—'}</span>
      <span class="pill">${inc.IncidentTypeCategory ?? '—'}</span>
    </div>
    <p style="margin-top:10px">${lensFraming[currentLens]}</p>
    <dl class="kv">
      <dt>Size</dt><dd>${fmtAcres(acres)}</dd>
      <dt>Contained</dt><dd>${fmtPct(containment)}</dd>
      <dt>Discovered</dt><dd>${discovered ? discovered.toUTCString().slice(5,16) : '—'}</dd>
      <dt>Cause</dt><dd>${inc.FireCause ?? '—'}</dd>
      <dt>Management</dt><dd>${inc.IncidentManagementOrganization ?? 'local'}</dd>
      <dt>Fire ID</dt><dd style="font-size:11px">${inc.UniqueFireIdentifier ?? '—'}</dd>
    </dl>
    <div class="source">Source: NIFC WFIGS Current Incident Locations · live</div>
  `;
}

function renderWarning(w) {
  const start = w.onset ? new Date(w.onset) : null;
  const end   = w.expires ? new Date(w.expires) : null;
  const lensFraming = {
    explorer:      `An active fire-weather alert issued by ${w.senderName ?? 'NWS'}.`,
    firefighter:   `Severity ${w.severity ?? '—'}, urgency ${w.urgency ?? '—'}. Pre-position resources accordingly.`,
    climatologist: `${w.event} — a real-time observation of climatology already failing locally.`,
    resident:      w.instruction || 'Follow local guidance; outdoor burning typically prohibited under this alert.',
  };
  // Compress description: strip extra whitespace
  const desc = (w.description || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  $('#detail').innerHTML = `
    <h2>${w.event ?? 'Fire weather alert'}</h2>
    <div>
      <span class="pill hot">${w.severity ?? '—'}</span>
      <span class="pill">${w.certainty ?? '—'}</span>
      <span class="pill">${w.urgency ?? '—'}</span>
    </div>
    <p style="margin-top:10px">${lensFraming[currentLens]}</p>
    <dl class="kv">
      <dt>Areas</dt><dd>${w.areaDesc ?? '—'}</dd>
      <dt>In effect</dt><dd>${start ? start.toUTCString().slice(5,22) : '—'}</dd>
      <dt>Expires</dt><dd>${end ? end.toUTCString().slice(5,22) : '—'}</dd>
    </dl>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">${desc}${desc.length === 600 ? '…' : ''}</p>
    <div class="source">Source: NOAA NWS api.weather.gov · live</div>
  `;
}

// ---------- time scrubber ----------
function applyDayOffset(offset) {
  selectedDayOffset = offset;
  const date = subDays(TODAY, offset);
  const dateStr = isoDay(date);
  showGibsFor(dateStr);
  const label = dayName(date, TODAY);
  $('#day-label').textContent = label;
  $('#day-label').classList.toggle('today', offset === 0);
  $('#stat-date').textContent = label;
}

function setupScrubber() {
  // slider value: 0 = oldest (6 days ago), max = today. We invert.
  const slider = $('#day');
  slider.min = 0; slider.max = DAYS_BACK; slider.step = 1; slider.value = DAYS_BACK; // today
  slider.addEventListener('input', e => applyDayOffset(DAYS_BACK - Number(e.target.value)));

  // ticks
  const ticks = $('#day-ticks');
  ticks.innerHTML = '';
  for (let i = 0; i <= DAYS_BACK; i++) ticks.appendChild(document.createElement('span'));

  $('#play').addEventListener('click', togglePlay);
}

function togglePlay() {
  playing = !playing;
  $('#play').classList.toggle('playing', playing);
  if (playing) {
    playTimer = setInterval(() => {
      let v = Number($('#day').value);
      v = (v + 1) > DAYS_BACK ? 0 : v + 1;
      $('#day').value = v;
      applyDayOffset(DAYS_BACK - v);
    }, 900);
  } else if (playTimer) { clearInterval(playTimer); playTimer = null; }
}

// ---------- lens switcher wiring ----------
document.querySelectorAll('.lens').forEach(btn => {
  btn.addEventListener('click', () => setLens(btn.dataset.lens));
});

// click on map (not on a feature) clears selection
map.on('click', (e) => {
  // Only clear if the click didn't hit a marker/polygon (Leaflet fires both, but we check originalEvent target)
  if (e.originalEvent.target.classList.contains('leaflet-container')) {
    selectedItem = null;
    renderDefault();
  }
});

// ---------- boot ----------
async function boot() {
  setupScrubber();
  applyDayOffset(0); // today
  renderDefault();

  try {
    await Promise.allSettled([loadIncidents(), loadWarnings()]);
  } catch (err) {
    console.error('Data load error', err);
  }
  $('#loading').classList.add('done');
}

boot();

})();
