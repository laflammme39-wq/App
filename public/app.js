// --- State ---
let map, allLocations = [], allProducts = [], markers = {}, pendingLatLng = null, activeLocId = null;

// --- Map init ---
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([40.73, -73.99], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  map.on('click', onMapClick);
}

// --- Marker icons ---
const TYPE_CONFIG = {
  gas_station:       { color: '#faa81a', icon: '⛽', label: 'Gas Station' },
  convenience_store: { color: '#5865f2', icon: '🏪', label: 'Convenience Store' },
  smoke_shop:        { color: '#ed4245', icon: '🚬', label: 'Smoke Shop' },
};

function makeIcon(type, highlighted = false) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.gas_station;
  const size = highlighted ? 44 : 36;
  const html = `
    <div style="
      width:${size}px;height:${size}px;
      background:${cfg.color};
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      border:3px solid ${highlighted ? '#fff' : 'rgba(255,255,255,.7)'};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 12px rgba(0,0,0,.5);
    ">
      <span style="transform:rotate(45deg);font-size:${highlighted ? 18 : 15}px;line-height:1">${cfg.icon}</span>
    </div>`;
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size] });
}

// --- Data loading ---
async function loadProducts() {
  const res = await fetch('/api/products');
  allProducts = await res.json();
  populateProductFilters();
  populateReportProductDropdowns();
}

async function loadLocations() {
  const res = await fetch('/api/locations');
  allLocations = await res.json();
  renderMarkers();
  renderSidebarList();
}

function populateProductFilters() {
  const brands = [...new Set(allProducts.map(p => p.brand))].sort();
  const brandSel = document.getElementById('filter-brand');
  brandSel.innerHTML = '<option value="">All Brands</option>' +
    brands.map(b => `<option value="${b}">${b}</option>`).join('');

  const prodSel = document.getElementById('filter-product');
  prodSel.innerHTML = '<option value="">All Products</option>' +
    allProducts.map(p => `<option value="${p.id}">${p.brand} — ${p.flavor} ${p.strength}</option>`).join('');
}

function populateReportProductDropdowns() {
  const brands = [...new Set(allProducts.map(p => p.brand))].sort();
  const brandSel = document.getElementById('report-brand');
  brandSel.innerHTML = brands.map(b => `<option value="${b}">${b}</option>`).join('');
  brandSel.onchange = () => filterReportProducts();
  filterReportProducts();
}

function filterReportProducts() {
  const brand = document.getElementById('report-brand').value;
  const filtered = allProducts.filter(p => !brand || p.brand === brand);
  document.getElementById('report-product').innerHTML =
    filtered.map(p => `<option value="${p.id}">${p.flavor} ${p.strength}</option>`).join('');
}

// --- Markers ---
function renderMarkers() {
  // Remove old markers
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  const activeTypes = getActiveTypes();
  const filtered = allLocations.filter(l => activeTypes.includes(l.type));

  filtered.forEach(loc => {
    const marker = L.marker([loc.lat, loc.lng], { icon: makeIcon(loc.type) });
    const priceText = loc.min_price != null
      ? `$${loc.min_price.toFixed(2)} – $${(loc.max_price || loc.min_price).toFixed(2)}`
      : 'No prices yet';

    marker.bindPopup(`
      <div style="min-width:150px">
        <strong style="font-size:14px">${escHtml(loc.name)}</strong><br/>
        <span style="font-size:11px;opacity:.7">${TYPE_CONFIG[loc.type]?.label}</span><br/>
        <span style="font-size:13px;color:#3ba55d;font-weight:600">${priceText}</span><br/>
        <small style="opacity:.6">${loc.product_count || 0} product(s) tracked</small>
      </div>
    `, { maxWidth: 200 });

    marker.on('click', () => openDetail(loc.id));
    marker.addTo(map);
    markers[loc.id] = marker;
  });
}

function getActiveTypes() {
  return [...document.querySelectorAll('.store-type-cb:checked')].map(cb => cb.value);
}

// --- Sidebar list ---
function renderSidebarList(locs = null) {
  const list = document.getElementById('location-list');
  const items = locs || allLocations;
  document.getElementById('loc-count').textContent = items.length;

  if (!items.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No locations found.</div>';
    return;
  }

  list.innerHTML = items.map(loc => {
    const cfg = TYPE_CONFIG[loc.type] || {};
    const lowBadge = loc.min_price != null
      ? `<span class="price-badge low">from $${loc.min_price.toFixed(2)}</span>` : '';
    return `
      <div class="loc-item${loc.id === activeLocId ? ' active' : ''}" onclick="openDetail(${loc.id})">
        <div class="loc-item-name">${cfg.icon || ''} ${escHtml(loc.name)}</div>
        <div class="loc-item-type">${cfg.label || loc.type}${loc.address ? ' · ' + escHtml(loc.address) : ''}</div>
        <div class="loc-item-price">${lowBadge}</div>
      </div>`;
  }).join('');
}

// --- Detail Panel ---
async function openDetail(id) {
  activeLocId = id;
  const res = await fetch(`/api/locations/${id}`);
  if (!res.ok) return;
  const loc = await res.json();

  document.getElementById('detail-name').textContent = loc.name;
  const cfg = TYPE_CONFIG[loc.type] || {};
  document.getElementById('detail-meta').textContent =
    `${cfg.label || loc.type}${loc.address ? ' · ' + loc.address : ''}`;

  document.getElementById('detail-prices').innerHTML = loc.prices.length
    ? loc.prices.map(p => `
        <div class="price-card">
          <button class="price-card-delete" onclick="deletePrice(${p.id}, ${id})" title="Remove">✕</button>
          <div class="price-card-brand">${escHtml(p.brand)}</div>
          <div class="price-card-name">${escHtml(p.flavor)}</div>
          <div class="price-card-strength">${escHtml(p.strength)}</div>
          <div class="price-card-price">$${p.price.toFixed(2)}</div>
          <div class="price-card-time">Reported ${timeAgo(p.reported_at)} by ${escHtml(p.reported_by)}</div>
        </div>`).join('')
    : '<div class="no-prices">No prices reported yet. Be the first!</div>';

  document.getElementById('btn-delete-loc').onclick = () => deleteLocation(id);

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');

  // Fly to location
  if (markers[id]) {
    map.flyTo([loc.lat, loc.lng], 15, { animate: true, duration: 0.8 });
    markers[id].setIcon(makeIcon(loc.type, true));
    setTimeout(() => markers[id] && markers[id].setIcon(makeIcon(loc.type)), 2000);
  }

  renderSidebarList();
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  activeLocId = null;
  renderSidebarList();
}

// --- Add Location Modal ---
let addingLocation = false;

document.getElementById('fab-add').onclick = () => {
  openAddLocModal();
};

function openAddLocModal() {
  addingLocation = true;
  document.getElementById('modal-add-loc').classList.remove('hidden');
  showToast('Click map to drop a pin, or enter coords manually');
}

function closeAddLocModal() {
  addingLocation = false;
  pendingLatLng = null;
  document.getElementById('modal-add-loc').classList.add('hidden');
  document.getElementById('loc-name').value = '';
  document.getElementById('loc-address').value = '';
  document.getElementById('loc-lat').value = '';
  document.getElementById('loc-lng').value = '';
}

function onMapClick(e) {
  if (!addingLocation) return;
  pendingLatLng = e.latlng;
  document.getElementById('loc-lat').value = e.latlng.lat.toFixed(6);
  document.getElementById('loc-lng').value = e.latlng.lng.toFixed(6);
  showToast('Pin dropped! Fill in the form and click Add Store.');
}

async function submitAddLocation() {
  const name = document.getElementById('loc-name').value.trim();
  const type = document.getElementById('loc-type').value;
  const address = document.getElementById('loc-address').value.trim();
  const lat = parseFloat(document.getElementById('loc-lat').value);
  const lng = parseFloat(document.getElementById('loc-lng').value);

  if (!name) return showToast('Store name is required');
  if (isNaN(lat) || isNaN(lng)) return showToast('Please set a location on the map or enter coordinates');

  const res = await fetch('/api/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, address, lat, lng })
  });

  if (!res.ok) return showToast('Failed to add location');
  const { id } = await res.json();
  closeAddLocModal();
  await loadLocations();
  showToast('Store added!');
  openDetail(id);
}

// --- Delete Location ---
async function deleteLocation(id) {
  if (!confirm('Delete this location and all its price reports?')) return;
  await fetch(`/api/locations/${id}`, { method: 'DELETE' });
  closeDetail();
  await loadLocations();
  showToast('Location deleted');
}

// --- Report Price Modal ---
let reportingForLocId = null;

function openReportModal() {
  reportingForLocId = activeLocId;
  if (!reportingForLocId) return;
  document.getElementById('report-price').value = '';
  document.getElementById('report-user').value = '';
  document.getElementById('modal-report').classList.remove('hidden');
}

function closeReportModal() {
  document.getElementById('modal-report').classList.add('hidden');
  reportingForLocId = null;
}

async function submitReport() {
  const product_id = parseInt(document.getElementById('report-product').value);
  const price = parseFloat(document.getElementById('report-price').value);
  const reported_by = document.getElementById('report-user').value.trim() || 'Anonymous';

  if (!product_id) return showToast('Select a product');
  if (isNaN(price) || price <= 0) return showToast('Enter a valid price');

  const res = await fetch('/api/price-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_id: reportingForLocId, product_id, price, reported_by })
  });

  if (!res.ok) return showToast('Failed to submit');
  closeReportModal();
  await loadLocations();
  openDetail(reportingForLocId);
  showToast('Price reported! Thanks!');
}

// --- Delete Price ---
async function deletePrice(priceId, locId) {
  await fetch(`/api/price-reports/${priceId}`, { method: 'DELETE' });
  await loadLocations();
  openDetail(locId);
  showToast('Price removed');
}

// --- Filters ---
document.getElementById('filter-price').oninput = function () {
  document.getElementById('price-display').textContent = this.value;
};

document.getElementById('btn-search').onclick = applyFilters;
document.getElementById('btn-reset').onclick = resetFilters;

async function applyFilters() {
  const brand = document.getElementById('filter-brand').value;
  const product_id = document.getElementById('filter-product').value;
  const max_price = document.getElementById('filter-price').value;
  const activeTypes = getActiveTypes();

  const params = new URLSearchParams();
  if (brand) params.set('brand', brand);
  if (product_id) params.set('product_id', product_id);
  params.set('max_price', max_price);

  const res = await fetch(`/api/search?${params}`);
  const results = await res.json();

  // Build a map of unique location ids from results
  const matchedIds = new Set(results.map(r => r.id));
  const filtered = allLocations.filter(l => matchedIds.has(l.id) && activeTypes.includes(l.type));
  renderSidebarList(filtered);

  // Dim non-matching markers
  Object.entries(markers).forEach(([id, m]) => {
    if (matchedIds.has(parseInt(id)) && activeTypes.includes(allLocations.find(l => l.id === parseInt(id))?.type)) {
      m.setOpacity(1);
    } else {
      m.setOpacity(0.2);
    }
  });

  showToast(`${filtered.length} location(s) found`);
}

function resetFilters() {
  document.getElementById('filter-brand').value = '';
  document.getElementById('filter-product').value = '';
  document.getElementById('filter-price').value = 20;
  document.getElementById('price-display').textContent = '20';
  document.querySelectorAll('.store-type-cb').forEach(cb => cb.checked = true);
  Object.values(markers).forEach(m => m.setOpacity(1));
  renderSidebarList();
}

// Type filter checkboxes
document.querySelectorAll('.store-type-cb').forEach(cb => {
  cb.onchange = () => { renderMarkers(); renderSidebarList(); };
});

// --- Utils ---
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(dateStr) {
  if (!dateStr) return 'unknown time';
  const diff = Date.now() - new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// --- Boot ---
(async () => {
  initMap();
  await Promise.all([loadProducts(), loadLocations()]);
})();

// Append toast element
const toast = document.createElement('div');
toast.id = 'toast';
document.body.appendChild(toast);
