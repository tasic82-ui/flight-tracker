'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('ft_token') || crypto.randomUUID(),
  subscription: null,
  vapidKey: null,
  map: null,
  marker: null,
  currentFlight: null,
  pollInterval: null,
  trackedFlights: JSON.parse(localStorage.getItem('ft_tracked') || '[]'),
  pushReady: false,
};
localStorage.setItem('ft_token', state.token);

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const searchInput = $('search-input');
const searchBtn   = $('search-btn');
const flightCard  = $('flight-card');
const mapContainer = $('map-container');
const trackedList = $('tracked-list');
const toastEl     = $('toast');
const loadingEl   = $('loading');

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
  const map = {
    active: 'status--active', landed: 'status--landed',
    cancelled: 'status--cancelled', diverted: 'status--diverted'
  };
  return map[s] || 'status--scheduled';
}

// ─── MAP ──────────────────────────────────────────────────────────────────────
function initMap(lat, lon, heading) {
  if (!state.map) {
    mapContainer.style.display = 'block';
    state.map = L.map('map', { zoomControl: true, attributionControl: false }).setView([lat, lon], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(state.map);
  }
  const icon = L.divIcon({
    className: '',
    html: `<div class="plane-icon" style="transform:rotate(${heading || 0}deg)">✈</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16],
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

// ─── RENDER CARD ──────────────────────────────────────────────────────────────
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
    etaBadge = mta > 0
      ? `<div class="eta-badge">🛬 Sletanje za <strong>${mta} min</strong></div>`
      : `<div class="eta-badge eta-badge--now">🛬 Sleće svakog trenutka</div>`;
  }

  let delayBadge = '';
  if (arr.delay_min > 15) {
    delayBadge = `<div class="delay-badge">⏰ Kašnjenje: ${arr.delay_min} min</div>`;
  }

  let positionBlock = '';
  if (position) {
    positionBlock = `
      <div class="pos-block">
        <div class="pos-row"><span>📍 Pozicija</span><span>${position.latitude?.toFixed(4)}° / ${position.longitude?.toFixed(4)}°</span></div>
        ${position.altitude ? `<div class="pos-row"><span>⬆ Visina</span><span>${position.altitude.toLocaleString()} ft</span></div>` : ''}
        ${position.velocity ? `<div class="pos-row"><span>💨 Brzina</span><span>${position.velocity} kn</span></div>` : ''}
      </div>`;
  }

  // Push status indicator
  const pushStatus = state.pushReady
    ? `<span style="color:#22c55e;font-size:11px">🔔 Push aktivan</span>`
    : `<span style="color:#f59e0b;font-size:11px">⚠️ Push nije aktivan</span>`;

  flightCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="flight-number">${info.flight_number}</div>
        <div class="airline">${info.airline}</div>
      </div>
      <div class="status-badge ${statusClass(info.status)}">${statusLabel(info.status)}</div>
    </div>
    ${etaBadge}${delayBadge}
    <div class="route-row">
      <div class="airport">
        <div class="iata">${dep.iata || '—'}</div>
        <div class="airport-name">${dep.airport || ''}</div>
        <div class="time-label">Polazak</div>
        <div class="time">${formatTime(dep.actual || dep.scheduled)}</div>
        ${dep.gate ? `<div class="gate">Gate ${dep.gate}</div>` : ''}
      </div>
      <div class="route-line">
        <div class="route-dot"></div><div class="route-dash"></div>
        <span class="plane-mid">✈</span>
        <div class="route-dash"></div><div class="route-dot"></div>
      </div>
      <div class="airport airport--right">
        <div class="iata">${arr.iata || '—'}</div>
        <div class="airport-name">${arr.airport || ''}</div>
        <div class="time-label">Dolazak</div>
        <div class="time">${formatTime(arr.estimated || arr.scheduled)}</div>
        ${arr.gate ? `<div class="gate">Gate ${arr.gate}</div>` : ''}
      </div>
    </div>
    ${positionBlock}
    <div class="card-footer">
      <div>
        <div class="updated">Ažurirano: ${new Date(updated).toLocaleTimeString('sr-RS')}</div>
        <div style="margin-top:3px">${pushStatus}</div>
      </div>
      <button id="track-btn-inner" class="track-btn ${isTracked ? 'track-btn--active' : ''}" data-flight="${info.flight_number}">
        ${isTracked ? '🔔 Praćenje aktivno' : '🔕 Prati let'}
      </button>
    </div>
  `;
  flightCard.style.display = 'block';

  if (position?.latitude && position?.longitude) {
    initMap(position.latitude, position.longitude, position.heading);
  } else {
    hideMap();
  }

  document.getElementById('track-btn-inner').addEventListener('click', () => {
    toggleTrack(info.flight_number);
  });
}

// ─── PUSH INIT — robustna verzija ─────────────────────────────────────────────
async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push not supported');
    return false;
  }

  try {
    // 1. Registruj SW
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('SW registered');

    // 2. Čekaj da SW bude aktivan
    await navigator.serviceWorker.ready;
    console.log('SW ready');

    // 3. Uzmi VAPID ključ sa servera
    const keyRes = await fetch('/api/vapid-public-key');
    const keyData = await keyRes.json();
    if (!keyData.key) {
      console.error('No VAPID key from server');
      return false;
    }
    state.vapidKey = keyData.key;
    console.log('VAPID key received');

    // 4. Traži dozvolu eksplicitno
    const perm = await Notification.requestPermission();
    console.log('Notification permission:', perm);
    if (perm !== 'granted') {
      toast('Dozvoli notifikacije u podešavanjima browsera', 'warning');
      return false;
    }

    // 5. Proveri da li već postoji subscription
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      state.subscription = existing;
      state.pushReady = true;
      console.log('Existing subscription found');
      return true;
    }

    // 6. Kreiraj novi subscription
    state.subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.vapidKey),
    });
    state.pushReady = true;
    console.log('Push subscription created');
    return true;

  } catch (e) {
    console.error('Push init failed:', e);
    return false;
  }
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

function startPolling(flightNum) {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.pollInterval = setInterval(async () => {
    try {
      const r = await fetch(`/api/flight/${flightNum}`);
      const data = await r.json();
      renderCard(data);
    } catch {}
  }, 30000);
}

// ─── TRACK / UNTRACK ──────────────────────────────────────────────────────────
async function toggleTrack(flightNum) {
  const isTracked = state.trackedFlights.includes(flightNum);

  if (isTracked) {
    // Untrack
    await fetch('/api/untrack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flight_number: flightNum, token: state.token }),
    });
    state.trackedFlights = state.trackedFlights.filter(f => f !== flightNum);
    toast(`Prestao da pratiš ${flightNum}`, 'info');
    localStorage.setItem('ft_tracked', JSON.stringify(state.trackedFlights));
    renderTrackedList();
    if (state.currentFlight === flightNum) {
      const r = await fetch(`/api/flight/${flightNum}`);
      renderCard(await r.json());
    }
    return;
  }

  // Track — osiguraj push subscription
  if (!state.pushReady) {
    toast('Inicijalizujem push notifikacije...', 'info');
    const ok = await initPush();
    if (!ok) {
      toast('Nije moguće aktivirati notifikacije. Proveri dozvole u Chrome.', 'error');
      return;
    }
  }

  // Registruj na serveru
  const res = await fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flight_number: flightNum,
      subscription: state.subscription,
      token: state.token,
    }),
  });
  const result = await res.json();

  if (result.ok) {
    state.trackedFlights.push(flightNum);
    localStorage.setItem('ft_tracked', JSON.stringify(state.trackedFlights));
    toast(`Pratiš ${flightNum} 🔔 — dobijaćeš notifikacije`, 'success');

    // Test push odmah
    setTimeout(async () => {
      const testRes = await fetch('/api/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: state.subscription }),
      });
      const testData = await testRes.json();
      if (!testData.ok) {
        toast('Push test nije prošao — proveri VAPID ključeve', 'error');
      }
    }, 1000);

  } else {
    toast('Greška pri registraciji trackinga', 'error');
  }

  renderTrackedList();
  if (state.currentFlight === flightNum) {
    const r = await fetch(`/api/flight/${flightNum}`);
    renderCard(await r.json());
  }
}

// ─── TRACKED LIST ─────────────────────────────────────────────────────────────
function renderTrackedList() {
  if (!state.trackedFlights.length) {
    trackedList.innerHTML = '<div class="tracked-empty">Nema praćenih letova</div>';
    return;
  }
  trackedList.innerHTML = state.trackedFlights.map(f => `
    <div class="tracked-item">
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

// Inicijalizuj push u pozadini odmah na startu
initPush().then(ok => {
  console.log('Push init result:', ok);
  if (ok) toast('Notifikacije aktivne ✅', 'success');
});
