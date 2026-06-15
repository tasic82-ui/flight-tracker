'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('ft_token') || crypto.randomUUID(),
  subscription: null,
  vapidKey: null,
  map: null,
  marker: null,
  planePath: null,
  currentFlight: null,
  pollInterval: null,
  trackedFlights: JSON.parse(localStorage.getItem('ft_tracked') || '[]'),
};
localStorage.setItem('ft_token', state.token);

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const searchInput  = $('search-input');
const searchBtn    = $('search-btn');
const flightCard   = $('flight-card');
const mapContainer = $('map-container');
const trackBtn     = $('track-btn');
const trackedList  = $('tracked-list');
const toastEl      = $('toast');
const loadingEl    = $('loading');

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast toast--${type} toast--show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('toast--show'), 3500);
}

// ─── LOADING ──────────────────────────────────────────────────────────────────
function setLoading(on) {
  loadingEl.style.display = on ? 'flex' : 'none';
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

function statusLabel(s) {
  const map = {
    scheduled: '🕐 Zakazan',
    active:    '✈️ U letu',
    landed:    '🛬 Sleteo',
    cancelled: '❌ Otkazan',
    diverted:  '⚠️ Preusmeren',
    unknown:   '❓ Nepoznat',
  };
  return map[s] || s;
}

function statusClass(s) {
  const map = { active: 'status--active', landed: 'status--landed', cancelled: 'status--cancelled', diverted: 'status--diverted' };
  return map[s] || 'status--scheduled';
}

// ─── MAP ──────────────────────────────────────────────────────────────────────
function initMap(lat, lon, heading) {
  if (!state.map) {
    mapContainer.style.display = 'block';
    state.map = L.map('map', { zoomControl: true, attributionControl: false }).setView([lat, lon], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(state.map);
  }

  const icon = L.divIcon({
    className: '',
    html: `<div class="plane-icon" style="transform:rotate(${heading || 0}deg)">✈</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  if (state.marker) {
    state.marker.setLatLng([lat, lon]);
    state.marker.setIcon(icon);
  } else {
    state.marker = L.marker([lat, lon], { icon }).addTo(state.map);
  }

  state.map.panTo([lat, lon], { animate: true });
}

function hideMap() {
  mapContainer.style.display = 'none';
  if (state.map) { state.map.remove(); state.map = null; state.marker = null; }
}

// ─── RENDER FLIGHT CARD ───────────────────────────────────────────────────────
function renderCard(data) {
  const { info, position, updated } = data;

  if (!info) {
    flightCard.innerHTML = `<div class="card-empty">Let nije pronađen. Proveri broj leta.</div>`;
    flightCard.style.display = 'block';
    hideMap();
    return;
  }

  const dep = info.departure;
  const arr = info.arrival;
  const mta = info.minutes_to_arrival;
  const isTracked = state.trackedFlights.includes(info.flight_number);

  let etaBadge = '';
  if (mta !== null && mta !== undefined && info.status === 'active') {
    if (mta > 0) {
      etaBadge = `<div class="eta-badge">🛬 Sletanje za <strong>${mta} min</strong></div>`;
    } else {
      etaBadge = `<div class="eta-badge eta-badge--now">🛬 Sleće svakog trenutka</div>`;
    }
  }

  let delayBadge = '';
  if (arr.delay_min > 15) {
    delayBadge = `<div class="delay-badge">⏰ Kašnjenje: ${arr.delay_min} min</div>`;
  }

  let positionBlock = '';
  if (position) {
    positionBlock = `
      <div class="pos-row">
        <span>📍 Pozicija</span>
        <span>${position.latitude?.toFixed(4)}° / ${position.longitude?.toFixed(4)}°</span>
      </div>
      ${position.altitude ? `<div class="pos-row"><span>⬆ Visina</span><span>${position.altitude.toLocaleString()} ft</span></div>` : ''}
      ${position.velocity ? `<div class="pos-row"><span>💨 Brzina</span><span>${position.velocity} kn</span></div>` : ''}
    `;
  }

  flightCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="flight-number">${info.flight_number}</div>
        <div class="airline">${info.airline}</div>
      </div>
      <div class="status-badge ${statusClass(info.status)}">${statusLabel(info.status)}</div>
    </div>

    ${etaBadge}
    ${delayBadge}

    <div class="route-row">
      <div class="airport">
        <div class="iata">${dep.iata || '—'}</div>
        <div class="airport-name">${dep.airport || ''}</div>
        <div class="time-label">Polazak</div>
        <div class="time">${formatTime(dep.actual || dep.scheduled)}</div>
        ${dep.gate ? `<div class="gate">Gate ${dep.gate}</div>` : ''}
      </div>
      <div class="route-line">
        <div class="route-dot"></div>
        <div class="route-dash"></div>
        <span class="plane-mid">✈</span>
        <div class="route-dash"></div>
        <div class="route-dot"></div>
      </div>
      <div class="airport airport--right">
        <div class="iata">${arr.iata || '—'}</div>
        <div class="airport-name">${arr.airport || ''}</div>
        <div class="time-label">Dolazak</div>
        <div class="time">${formatTime(arr.estimated || arr.scheduled)}</div>
        ${arr.gate ? `<div class="gate">Gate ${arr.gate}</div>` : ''}
      </div>
    </div>

    ${positionBlock ? `<div class="pos-block">${positionBlock}</div>` : ''}

    <div class="card-footer">
      <div class="updated">Ažurirano: ${new Date(updated).toLocaleTimeString('sr-RS')}</div>
      <button id="track-btn" class="track-btn ${isTracked ? 'track-btn--active' : ''}" data-flight="${info.flight_number}">
        ${isTracked ? '🔔 Praćenje aktivno' : '🔕 Prati let'}
      </button>
    </div>
  `;

  flightCard.style.display = 'block';

  // Map
  if (position && position.latitude && position.longitude) {
    initMap(position.latitude, position.longitude, position.heading);
  } else {
    hideMap();
  }

  // Track button
  document.getElementById('track-btn').addEventListener('click', () => {
    toggleTrack(info.flight_number);
  });
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
async function searchFlight(flightNum) {
  if (!flightNum.trim()) return;
  setLoading(true);
  flightCard.style.display = 'none';
  try {
    const r = await fetch(`/api/flight/${flightNum.trim().toUpperCase()}`);
    const data = await r.json();
    state.currentFlight = flightNum.toUpperCase();
    renderCard(data);
    startPolling(flightNum.toUpperCase());
  } catch (e) {
    toast('Greška pri preuzimanju podataka.', 'error');
  } finally {
    setLoading(false);
  }
}

// ─── POLLING ──────────────────────────────────────────────────────────────────
function startPolling(flightNum) {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.pollInterval = setInterval(async () => {
    try {
      const r = await fetch(`/api/flight/${flightNum}`);
      const data = await r.json();
      renderCard(data);
    } catch {}
  }, 30000); // refresh UI every 30s
}

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const keyRes  = await fetch('/api/vapid-public-key');
    const keyData = await keyRes.json();
    state.vapidKey = keyData.key;

    if (!state.vapidKey || state.vapidKey === '') return;

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;

    state.subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(state.vapidKey),
    });

    toast('Push notifikacije aktivirane ✅', 'success');
  } catch (e) {
    console.warn('Push init failed:', e);
  }
}

// ─── TRACK / UNTRACK ─────────────────────────────────────────────────────────
async function toggleTrack(flightNum) {
  if (!state.subscription) {
    toast('Dozvoli notifikacije da bi pratio let.', 'warning');
    await initPush();
    if (!state.subscription) return;
  }

  const isTracked = state.trackedFlights.includes(flightNum);

  if (isTracked) {
    await fetch('/api/untrack', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ flight_number: flightNum, token: state.token }),
    });
    state.trackedFlights = state.trackedFlights.filter(f => f !== flightNum);
    toast(`Prestao da pratiš ${flightNum}`, 'info');
  } else {
    await fetch('/api/track', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        flight_number: flightNum,
        subscription:  state.subscription,
        token:         state.token,
      }),
    });
    state.trackedFlights.push(flightNum);
    toast(`Pratiš ${flightNum} 🔔`, 'success');
  }

  localStorage.setItem('ft_tracked', JSON.stringify(state.trackedFlights));
  renderTrackedList();

  // Re-render card to update button
  if (state.currentFlight === flightNum) {
    const r = await fetch(`/api/flight/${flightNum}`);
    const data = await r.json();
    renderCard(data);
  }
}

// ─── TRACKED LIST ─────────────────────────────────────────────────────────────
function renderTrackedList() {
  if (!state.trackedFlights.length) {
    trackedList.innerHTML = '<div class="tracked-empty">Nema praćenih letova</div>';
    return;
  }
  trackedList.innerHTML = state.trackedFlights.map(f => `
    <div class="tracked-item" data-flight="${f}">
      <span>✈️ ${f}</span>
      <div class="tracked-actions">
        <button class="btn-sm btn-view" data-flight="${f}">Prikaži</button>
        <button class="btn-sm btn-remove" data-flight="${f}">✕</button>
      </div>
    </div>
  `).join('');

  trackedList.querySelectorAll('.btn-view').forEach(b =>
    b.addEventListener('click', () => {
      searchInput.value = b.dataset.flight;
      searchFlight(b.dataset.flight);
    })
  );
  trackedList.querySelectorAll('.btn-remove').forEach(b =>
    b.addEventListener('click', () => toggleTrack(b.dataset.flight))
  );
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
searchBtn.addEventListener('click', () => searchFlight(searchInput.value));
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchFlight(searchInput.value); });

renderTrackedList();
initPush();
