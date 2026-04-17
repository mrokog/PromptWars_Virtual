/**
 * @fileoverview StadiumIQ — Main application orchestrator.
 * Integrates all modules: data store, crowd engine, auth, a11y,
 * notifications, venue map, and SPA router.
 * @module app
 * @version 1.0.0
 */

'use strict';

import { CrowdEngine }       from './crowd.js';
import { dataStore }         from './realtime.js';
import { authManager }       from './auth.js';
import { a11yManager }       from './accessibility.js';
import { notifManager }      from './notifications.js';
import { VenueMap, NAVIGATION_DESTINATIONS, computeRoute, buildGoogleMapsUrl } from './maps.js';
import { sanitize, formatNumber, formatWait, formatCurrency, debounce, sleep } from './utils.js';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function setText(el, text) {
  const node = typeof el === 'string' ? $(el) : el;
  if (node) node.textContent = text;
}

function show(el) { (typeof el === 'string' ? $(el) : el)?.removeAttribute('hidden'); }
function hide(el) { (typeof el === 'string' ? $(el) : el)?.setAttribute('hidden', ''); }

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
const state = {
  currentView:       'dashboard',
  zones:             [],
  densityMap:        {},
  match:             {},
  crowdWorker:       null,
  crowdEngine:       new CrowdEngine({ smoothingWindow: 3 }), // main-thread fallback
  venueMap:          null,
  unsubscribers:     [],
  releaseFocusTrap:  null,

  // Cart
  cart: {
    items: [], // [{ item, quantity }]
    get total() { return this.items.reduce((s, i) => s + i.item.price * i.quantity, 0); },
    get count() { return this.items.reduce((s, i) => s + i.quantity, 0); },
  },

  // Navigation view state
  navigate: {
    fromId:   'my-seat',
    toId:     null,
    route:    null,
  },

  // Food view state
  food: {
    activeStand:    null,
    activeCategory: 'all',
    menu:           [],
  },
};

// ---------------------------------------------------------------------------
// 1. Web Worker setup
// ---------------------------------------------------------------------------
function initCrowdWorker() {
  if (!window.Worker) return; // fallback to main-thread CrowdEngine

  try {
    state.crowdWorker = new Worker('./workers/crowd-worker.js');

    state.crowdWorker.addEventListener('message', ({ data }) => {
      const { type, payload, error } = data;
      if (error) { console.error('[CrowdWorker]', error); return; }

      switch (type) {
        case 'RESULT_COMPUTE':
          state.densityMap = payload;
          renderDensityUpdates();
          break;
        case 'RESULT_AGGREGATE':
          updateAggregateMetrics(payload);
          break;
      }
    });

    state.crowdWorker.addEventListener('error', (e) => {
      console.warn('[CrowdWorker] Error — falling back to main thread:', e.message);
      state.crowdWorker = null;
    });
  } catch (e) {
    console.warn('[CrowdWorker] Unavailable, using main thread.');
  }
}

function computeDensities(zones) {
  if (state.crowdWorker) {
    state.crowdWorker.postMessage({ type: 'COMPUTE', payload: { zones } });
    state.crowdWorker.postMessage({ type: 'AGGREGATE', payload: { zones } });
  } else {
    // Main-thread fallback
    const densityMap = {};
    for (const zone of zones) {
      densityMap[zone.id] = state.crowdEngine.computeDensity(zone);
    }
    state.densityMap = densityMap;
    renderDensityUpdates();
    updateAggregateMetrics(state.crowdEngine.aggregateStats(zones));
  }
}

// ---------------------------------------------------------------------------
// 2. SPA Router
// ---------------------------------------------------------------------------
function navigate(viewId) {
  if (state.currentView === viewId) return;

  const prev = $(`#view-${state.currentView}`);
  const next = $(`#view-${viewId}`);

  if (prev) {
    prev.classList.remove('active');
    prev.setAttribute('hidden', '');
  }
  if (next) {
    next.removeAttribute('hidden');
    requestAnimationFrame(() => next.classList.add('active'));
    // Move focus to main content for keyboard/screen-reader users
    a11yManager.moveFocus('#main-content');
  }

  // Update nav ARIA
  $$('.nav-item').forEach((btn) => {
    const active = btn.dataset.view === viewId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
    btn.querySelector('.nav-icon-wrap')?.classList.toggle('active', active);
  });

  state.currentView = viewId;

  // View-specific setup on first visit
  if (viewId === 'map')      initMapView();
  if (viewId === 'navigate') initNavigateView();
  if (viewId === 'food')     initFoodView();
}

// ---------------------------------------------------------------------------
// 3. Dashboard updates
// ---------------------------------------------------------------------------
function renderDensityUpdates() {
  const { zones, densityMap } = state;
  if (!zones.length || !Object.keys(densityMap).length) return;

  // Update venue map heat-layer
  state.venueMap?.updateZoneData(zones, densityMap);

  // Update zone list if on dashboard or map
  if (state.currentView === 'dashboard') renderZoneList();
}

function updateAggregateMetrics(stats) {
  if (!stats) return;

  // Open gates (simple random sim between 4-6)
  setText('#metric-gates', `${stats.openGates ?? '4'}/6`);

  // Avg wait — derived from density
  const avgWait = Math.round(2 + (stats.avgScore / 100) * 8);
  const waitEl  = $('#metric-wait');
  if (waitEl) {
    waitEl.textContent = `${avgWait} min`;
    waitEl.classList.add('tick-update');
    waitEl.addEventListener('animationend', () => waitEl.classList.remove('tick-update'), { once: true });
  }

  // Overall crowd %
  setText('#metric-crowd', `${Math.round(stats.fillPercent ?? stats.avgScore)}%`);

  // Total people
  setText('#metric-people', formatNumber(stats.totalOccupancy ?? 41240));
}

function renderZoneList() {
  const list = $('#zone-list');
  if (!list) return;

  const { zones, densityMap } = state;

  // Only show stand-type zones in dashboard summary
  const standZones = zones.filter((z) => z.type === 'stand');

  list.innerHTML = '';
  list.classList.add('anim-stagger');

  for (const zone of standZones) {
    const density = densityMap[zone.id];
    if (!density) continue;

    const item    = document.createElement('div');
    item.className = 'zone-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', density.ariaLabel);
    item.tabIndex = 0;

    const dot  = document.createElement('span');
    dot.className = 'zone-dot';
    dot.style.background = density.hex;

    const name = document.createElement('span');
    name.className = 'zone-name';
    name.textContent = zone.name;

    const barWrap = document.createElement('div');
    barWrap.className = 'zone-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'zone-bar';
    bar.style.width = `${density.score}%`;
    bar.style.background = density.hex;
    barWrap.appendChild(bar);

    const score = document.createElement('span');
    score.className = 'zone-score';
    score.textContent = `${density.score}%`;

    const wait = document.createElement('span');
    wait.className = 'zone-wait';
    wait.textContent = density.waitMinutes > 0 ? `${density.waitMinutes}m wait` : '';

    item.append(dot, name, barWrap, score, wait);
    item.addEventListener('click',   () => navigate('map'));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') navigate('map'); });

    list.appendChild(item);
  }
}

function updateScoreTicker(match) {
  if (!match) return;
  const scoreEl = $('#score-display');
  const teamA = $('#team-a');
  const teamB = $('#team-b');

  if (teamA) teamA.textContent = match.homeTeam;
  if (teamB) teamB.textContent = match.awayTeam;

  if (scoreEl) {
    const newScore = `${match.homeScore} — ${match.awayScore}`;
    if (scoreEl.textContent !== newScore) {
      scoreEl.textContent = newScore;
      // Flash effect for goal
      $('#score-ticker')?.classList.add('goal-flash');
      setTimeout(() => $('#score-ticker')?.classList.remove('goal-flash'), 1500);
    }
  }
  if ($('#score-period')) $('#score-period').textContent = match.period;
}

function renderMatchHistory(history) {
  const list = $('#match-history-list');
  if (!list) return;
  list.innerHTML = '';
  
  if (!history || history.length === 0) {
    list.innerHTML = '<span style="color:var(--color-text-muted);">No recent encounters found.</span>';
    return;
  }

  history.forEach(match => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.padding = 'var(--space-2)';
    item.style.background = 'var(--color-surface-raised)';
    item.style.borderRadius = 'var(--radius-sm)';
    item.innerHTML = `
      <div style="font-size: var(--text-sm); font-weight: var(--weight-bold);">${match.title}</div>
      <div style="font-size: var(--text-xs); color: var(--color-text-secondary); display:flex; justify-content:space-between;">
        <span>📅 ${match.date}</span>
        <span>🏟️ ${match.venue}</span>
      </div>
    `;
    list.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// 4. Map view
// ---------------------------------------------------------------------------
let _mapInitialized = false;

function initMapView() {
  if (_mapInitialized) return;
  _mapInitialized = true;

  const container = $('#venue-map-container');
  if (!container) return;

  state.venueMap = new VenueMap(container, {
    onZoneClick: (zoneId, density) => showZoneDetail(zoneId, density),
  });
  state.venueMap.init();

  // Apply latest data immediately
  if (state.zones.length) {
    state.venueMap.updateZoneData(state.zones, state.densityMap);
  }

  // Filter chips
  $$('#view-map .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#view-map .chip').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-selected', 'false'); });
      chip.classList.add('active');
      chip.setAttribute('aria-selected', 'true');
      state.venueMap?.setFilter(chip.dataset.filter);
    });
  });
}

function showZoneDetail(zoneId, density) {
  const zone   = state.zones.find((z) => z.id === zoneId);
  if (!zone || !density) return;

  const panel  = $('#zone-detail-panel');
  if (!panel) return;

  // Build detail panel content safely (no innerHTML with user data)
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'zone-detail-header';

  const nameEl = document.createElement('h2');
  nameEl.className = 'zone-detail-name';
  nameEl.id = 'zone-detail-title';
  nameEl.textContent = zone.name;

  const badge = document.createElement('span');
  badge.className = 'crowd-badge';
  badge.dataset.level = density.level;
  badge.textContent = density.level.charAt(0).toUpperCase() + density.level.slice(1);

  header.append(nameEl, badge);

  // Stats
  const statsGrid = document.createElement('div');
  statsGrid.className = 'zone-detail-stats';

  const statsData = [
    { value: `${density.score}%`,           label: 'Density'  },
    { value: formatWait(density.waitMinutes), label: 'Est. Wait' },
    { value: formatNumber(zone.occupancy),   label: 'People'   },
  ];

  for (const s of statsData) {
    const stat = document.createElement('div');
    stat.className = 'zone-stat';
    const val = document.createElement('span');
    val.className = 'zone-stat-value';
    val.textContent = s.value;
    const lbl = document.createElement('span');
    lbl.className = 'zone-stat-label';
    lbl.textContent = s.label;
    stat.append(val, lbl);
    statsGrid.appendChild(stat);
  }

  // Recommendation
  const rec = document.createElement('div');
  rec.className = 'zone-detail-recommendation';
  rec.setAttribute('role', 'note');
  rec.textContent = `💡 ${density.recommendation}`;

  // Actions
  const actions = document.createElement('div');
  actions.className = 'zone-detail-actions';

  const navigateBtn = document.createElement('button');
  navigateBtn.className = 'btn-primary';
  navigateBtn.textContent = 'Navigate Here';
  navigateBtn.addEventListener('click', () => {
    state.navigate.toId = zoneId;
    navigate('navigate');
    buildRoute();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-secondary';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    hide(panel);
    a11yManager.moveFocus('#venue-map-container');
  });

  actions.append(navigateBtn, closeBtn);
  panel.append(header, statsGrid, rec, actions);

  show(panel);
  panel.classList.add('anim-slide-up');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  a11yManager.announcePolite(density.ariaLabel);
}

// ---------------------------------------------------------------------------
// 5. Navigate view
// ---------------------------------------------------------------------------
let _navigateInitialized = false;

function initNavigateView() {
  if (_navigateInitialized) return;
  _navigateInitialized = true;

  const input = $('#route-to');
  if (!input) return;

  // Populate suggestions
  const sugList = $('#route-suggestions');

  function renderSuggestions(query = '') {
    if (!sugList) return;
    const q = query.toLowerCase().trim();
    const filtered = NAVIGATION_DESTINATIONS.filter((d) =>
      d.label.toLowerCase().includes(q) || d.hint.toLowerCase().includes(q)
    );

    sugList.innerHTML = '';
    if (!filtered.length || !query) { hide(sugList); return; }
    show(sugList);

    for (const dest of filtered) {
      const li = document.createElement('li');
      li.className = 'suggestion-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      const icon = document.createElement('span');
      icon.className = 'suggestion-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = iconForZoneId(dest.id);

      const label = document.createElement('span');
      label.className = 'suggestion-label';
      label.textContent = dest.label;

      const hint = document.createElement('span');
      hint.className = 'suggestion-hint';
      hint.textContent = dest.hint;

      li.append(icon, label, hint);
      li.addEventListener('click', () => {
        input.value = dest.label;
        state.navigate.toId = dest.id;
        hide(sugList);
        input.setAttribute('aria-expanded', 'false');
        buildRoute();
      });
      sugList.appendChild(li);
    }
  }

  input.addEventListener('input', debounce((e) => renderSuggestions(e.target.value), 200));
  input.addEventListener('focus', () => { if (input.value) renderSuggestions(input.value); });
  input.addEventListener('blur',  () => setTimeout(() => hide(sugList), 150));

  // Keyboard nav in suggestions
  input.addEventListener('keydown', (e) => {
    const items = [...sugList.querySelectorAll('.suggestion-item')];
    const focused = sugList.querySelector('[aria-selected="true"]');
    const idx = items.indexOf(focused);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      focused?.setAttribute('aria-selected', 'false');
      next?.setAttribute('aria-selected', 'true');
      next?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      focused?.setAttribute('aria-selected', 'false');
      prev?.setAttribute('aria-selected', 'true');
      prev?.focus();
    }
    if (e.key === 'Escape') { hide(sugList); input.setAttribute('aria-expanded', 'false'); }
  });

  // Open Google Maps button
  $('#open-google-maps-btn')?.addEventListener('click', () => {
    const toLabel = NAVIGATION_DESTINATIONS.find((d) => d.id === state.navigate.toId)?.label ?? 'Destination';
    const url = buildGoogleMapsUrl('Stand A, Wankhede Stadium', toLabel, a11yManager.getPrefs().mobilityMode);
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

function buildRoute() {
  const { fromId, toId } = state.navigate;
  if (!toId) return;

  const routeOptions = $('#route-options');
  const routeCards   = $('#route-cards');

  if (!routeOptions || !routeCards) return;

  // Standard route
  const standard   = computeRoute(fromId, toId, false);
  // Accessible route
  const accessible  = computeRoute(fromId, toId, true);

  routeCards.innerHTML = '';
  show(routeOptions);

  const routeDefs = [
    { label: 'Fastest Route', badge: 'fastest', badgeText: 'Fastest', data: standard   },
    { label: 'Accessible Route', badge: 'accessible', badgeText: '♿ Accessible', data: accessible },
  ];

  for (const rd of routeDefs) {
    const card = document.createElement('div');
    card.className = 'route-card anim-fade-in';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${rd.label}: ${rd.data.estimatedMinutes} minutes, ${rd.data.distanceM}m`);

    const headerEl = document.createElement('div');
    headerEl.className = 'route-card-header';

    const typeEl = document.createElement('div');
    typeEl.className = 'route-type';

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = rd.badge === 'fastest' ? '🚶' : '♿';

    const typeName = document.createElement('span');
    typeName.textContent = rd.label;

    const badge = document.createElement('span');
    badge.className = `route-badge ${rd.badge}`;
    badge.textContent = rd.badgeText;

    typeEl.append(icon, typeName);
    headerEl.append(typeEl, badge);

    const meta = document.createElement('div');
    meta.className = 'route-meta';

    const timeItem = document.createElement('div');
    timeItem.className = 'route-meta-item';
    const timeVal = document.createElement('span');
    timeVal.className = 'route-meta-value';
    timeVal.textContent = `${rd.data.estimatedMinutes} min`;
    const timeLbl = document.createElement('span');
    timeLbl.className = 'route-meta-label';
    timeLbl.textContent = 'Est. Time';
    timeItem.append(timeVal, timeLbl);

    const distItem = document.createElement('div');
    distItem.className = 'route-meta-item';
    const distVal = document.createElement('span');
    distVal.className = 'route-meta-value';
    distVal.textContent = `${rd.data.distanceM}m`;
    const distLbl = document.createElement('span');
    distLbl.className = 'route-meta-label';
    distLbl.textContent = 'Distance';
    distItem.append(distVal, distLbl);

    meta.append(timeItem, distItem);

    const steps = document.createElement('div');
    steps.className = 'route-steps';
    for (const step of rd.data.steps) {
      const stepEl = document.createElement('div');
      stepEl.className = 'route-step';
      stepEl.textContent = step;
      steps.appendChild(stepEl);
    }

    card.append(headerEl, meta, steps);
    card.addEventListener('click', () => {
      $$('.route-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      // Draw on venue map
      state.venueMap?.drawRoute(fromId, toId);
      a11yManager.announcePolite(`Route selected: ${rd.data.estimatedMinutes} minutes`);
    });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') card.click(); });

    routeCards.appendChild(card);
  }
}

function iconForZoneId(id) {
  if (id.startsWith('food-'))  return '🍔';
  if (id.startsWith('rest-'))  return '🚻';
  if (id.startsWith('aid-'))   return '➕';
  if (id.startsWith('gate-'))  return '🚪';
  return '📍';
}

// ---------------------------------------------------------------------------
// 6. Food view
// ---------------------------------------------------------------------------
let _foodInitialized = false;

function initFoodView() {
  if (_foodInitialized) return;
  _foodInitialized = true;

  const menu = dataStore.getMenu();
  state.food.menu = menu;

  // Populate stand tabs
  const standSelector = $('#stand-selector');
  if (!standSelector) return;

  const stands = [...new Set(menu.map((item) => item.stand))];
  const standNames = {
    'food-n1': 'Concession N1',
    'food-n2': 'Concession N2',
    'food-s1': 'Concession S1',
    'food-s2': 'Concession S2',
    'food-e1': 'Concession E1',
    'food-w1': 'Concession W1',
  };

  state.food.activeStand = stands[0];

  for (const standId of stands) {
    const tab = document.createElement('button');
    tab.className = `stand-tab ${standId === stands[0] ? 'active' : ''}`;
    tab.dataset.stand = standId;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(standId === stands[0]));
    tab.setAttribute('aria-label', `${standNames[standId] ?? standId}. Wait time: loading`);

    const name = document.createElement('span');
    name.className = 'stand-tab-name';
    name.textContent = standNames[standId] ?? standId;

    const waitChip = document.createElement('span');
    waitChip.className = 'stand-wait-chip';
    waitChip.dataset.stand = standId;

    const density = state.densityMap[standId];
    if (density) {
      waitChip.textContent = `~${density.waitMinutes}m`;
      waitChip.style.background = density.hex + '30';
      waitChip.style.color = density.hex;
    } else {
      waitChip.textContent = '—';
      tab.style.color = 'var(--color-text-muted)';
    }

    tab.append(name, waitChip);
    tab.addEventListener('click', () => {
      $$('.stand-tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      state.food.activeStand = standId;
      renderMenu();
    });

    standSelector.appendChild(tab);
  }

  // Category chips
  $$('#view-food .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#view-food .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.food.activeCategory = chip.dataset.category;
      renderMenu();
    });
  });

  renderMenu();
}

function renderMenu() {
  const grid   = $('#menu-grid');
  if (!grid) return;

  const { activeStand, activeCategory, menu } = state.food;
  const filtered = menu.filter((item) =>
    item.stand === activeStand &&
    (activeCategory === 'all' || item.category === activeCategory)
  );

  grid.innerHTML = '';

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.setAttribute('style', 'grid-column: span 2;');
    empty.innerHTML = `<span class="empty-state-icon">🍽️</span><p>No items in this category at this stand.</p>`;
    grid.appendChild(empty);
    return;
  }

  grid.classList.add('anim-stagger');

  for (const item of filtered) {
    const card = document.createElement('div');
    card.className = 'menu-item';
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `${item.name}, $${item.price.toFixed(2)}. Tap to add to cart.`);

    if (item.popular) {
      const pop = document.createElement('span');
      pop.className = 'popular-tag';
      pop.textContent = '🔥 Popular';
      pop.setAttribute('aria-label', 'Popular item');
      card.appendChild(pop);
    }

    const emoji = document.createElement('span');
    emoji.className = 'menu-item-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = item.emoji;

    const name = document.createElement('p');
    name.className = 'menu-item-name';
    name.textContent = item.name;

    const price = document.createElement('p');
    price.className = 'menu-item-price';
    price.textContent = formatCurrency(item.price);

    const addBtn = document.createElement('button');
    addBtn.className = 'menu-item-add';
    addBtn.setAttribute('aria-label', `Add ${item.name} to cart`);
    addBtn.setAttribute('aria-live', 'polite');
    addBtn.textContent = '+';

    card.append(emoji, name, price, addBtn);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(item);
      addBtn.textContent = '✓';
      setTimeout(() => { addBtn.textContent = '+'; }, 800);
    });
    card.addEventListener('click', () => addToCart(item));

    grid.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// 7. Cart
// ---------------------------------------------------------------------------
function addToCart(item) {
  const existing = state.cart.items.find((i) => i.item.id === item.id);
  if (existing) existing.quantity++;
  else state.cart.items.push({ item, quantity: 1 });
  updateCartUI();
  a11yManager.announcePolite(`${item.name} added to cart. ${state.cart.count} items total.`);
}

function removeFromCart(itemId, all = false) {
  const idx = state.cart.items.findIndex((i) => i.item.id === itemId);
  if (idx === -1) return;
  if (all || state.cart.items[idx].quantity <= 1) {
    state.cart.items.splice(idx, 1);
  } else {
    state.cart.items[idx].quantity--;
  }
  updateCartUI();
}

function updateCartUI() {
  const count = state.cart.count;
  const total = state.cart.total;

  const fab = $('#cart-btn');
  if (fab) {
    if (count > 0) {
      show(fab);
      fab.setAttribute('aria-label', `View cart, ${count} item${count > 1 ? 's' : ''}, ${formatCurrency(total)}`);
      fab.classList.add('cart-pop');
      fab.addEventListener('animationend', () => fab.classList.remove('cart-pop'), { once: true });
    } else {
      hide(fab);
    }
    setText('#cart-count-badge', count);
    setText('#cart-total', formatCurrency(total));
  }

  // Update drawer if open
  renderCartDrawer();
}

function renderCartDrawer() {
  const list = $('#cart-items');
  if (!list) return;

  list.innerHTML = '';

  if (!state.cart.items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<span class="empty-state-icon">🛒</span><p>Your cart is empty</p>`;
    list.appendChild(empty);
    setText('#cart-total-amount', '$0.00');
    const orderBtn = $('#place-order-btn');
    if (orderBtn) orderBtn.disabled = true;
    return;
  }

  for (const { item, quantity } of state.cart.items) {
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.setAttribute('role', 'listitem');

    const emoji = document.createElement('span');
    emoji.className = 'cart-item-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = item.emoji;

    const info = document.createElement('div');
    info.className = 'cart-item-info';

    const name = document.createElement('p');
    name.className = 'cart-item-name';
    name.textContent = item.name;

    const price = document.createElement('p');
    price.className = 'cart-item-price';
    price.textContent = formatCurrency(item.price * quantity);

    info.append(name, price);

    const controls = document.createElement('div');
    controls.className = 'cart-qty-controls';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'qty-btn';
    minusBtn.setAttribute('aria-label', `Remove one ${item.name}`);
    minusBtn.textContent = '−';
    minusBtn.addEventListener('click', () => removeFromCart(item.id));

    const qty = document.createElement('span');
    qty.className = 'qty-value';
    qty.textContent = quantity;

    const plusBtn = document.createElement('button');
    plusBtn.className = 'qty-btn';
    plusBtn.setAttribute('aria-label', `Add another ${item.name}`);
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => addToCart(item));

    controls.append(minusBtn, qty, plusBtn);
    row.append(emoji, info, controls);
    list.appendChild(row);
  }

  setText('#cart-total-amount', formatCurrency(state.cart.total));
  const orderBtn = $('#place-order-btn');
  if (orderBtn) orderBtn.disabled = false;
}

// Handle order placement
function handlePlaceOrder() {
  const btn = $('#place-order-btn');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = 'Placing Order…';

  setTimeout(() => {
    state.cart.items = [];
    updateCartUI();
    closeDrawer('cart');
    notifManager.showToast({
      type: 'success',
      title: 'Order Placed!',
      body: 'Your order is being prepared. Estimated: 8–12 min.',
      timestamp: Date.now(),
    });
    a11yManager.announcePolite('Order placed successfully. Your food will be ready in 8 to 12 minutes.');
    btn.textContent = 'Place Order';
    btn.disabled = false;
  }, 1500);
}

// ---------------------------------------------------------------------------
// 8. Drawers
// ---------------------------------------------------------------------------
function openDrawer(id) {
  const drawer   = $(`#${id}-drawer`);
  const backdrop = $('#drawer-backdrop');
  if (!drawer || !backdrop) return;

  show(drawer);
  show(backdrop);
  requestAnimationFrame(() => {
    drawer.classList.add('open');
    backdrop.classList.add('visible');
  });

  drawer.setAttribute('aria-hidden', 'false');
  state.releaseFocusTrap = a11yManager.trapFocus(drawer);

  backdrop.addEventListener('click', () => closeDrawer(id), { once: true });
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(id); }, { once: true });

  if (id === 'cart') renderCartDrawer();
}

function closeDrawer(id) {
  const drawer   = $(`#${id}-drawer`);
  const backdrop = $('#drawer-backdrop');
  if (!drawer) return;

  drawer.classList.remove('open');
  backdrop?.classList.remove('visible');
  drawer.setAttribute('aria-hidden', 'true');

  state.releaseFocusTrap?.();
  state.releaseFocusTrap = null;

  setTimeout(() => {
    hide(drawer);
    if (backdrop?.querySelectorAll('.drawer.open').length === 0) hide(backdrop);
  }, 300);
}

// ---------------------------------------------------------------------------
// 9. Notifications
// ---------------------------------------------------------------------------
function renderNotifications(alerts) {
  const list   = $('#notification-list');
  const badge  = $('#notification-badge');

  const unread = alerts.filter((a) => !a.read).length;
  const btn    = $('#notification-btn');

  if (badge) {
    badge.textContent = unread;
    badge.hidden = unread === 0;
  }
  if (btn) btn.setAttribute('aria-label', `Notifications${unread > 0 ? `, ${unread} unread` : ''}`);

  if (!list) return;
  list.innerHTML = '';

  if (!alerts.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🔔</span><p>No notifications yet</p></div>';
    return;
  }

  for (const alert of alerts) {
    const item = document.createElement('div');
    item.className = `notif-item ${alert.read ? '' : 'unread'}`;
    item.setAttribute('role', 'listitem');
    item.tabIndex = 0;

    const iconEl = document.createElement('span');
    iconEl.className = 'notif-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = { info: 'ℹ️', warning: '⚠️', success: '✅', danger: '🚨' }[alert.type] ?? 'ℹ️';

    const body = document.createElement('div');
    body.className = 'notif-body';

    const title = document.createElement('p');
    title.className = 'notif-title';
    title.textContent = alert.title;

    const msg = document.createElement('p');
    msg.className = 'notif-msg';
    msg.textContent = alert.body;

    body.append(title, msg);

    const time = document.createElement('span');
    time.className = 'notif-time';
    const mins = Math.round((Date.now() - alert.timestamp) / 60000);
    time.textContent = mins < 1 ? 'now' : `${mins}m ago`;

    item.append(iconEl, body, time);
    item.addEventListener('click', () => { dataStore.markAlertRead(alert.id); item.classList.remove('unread'); });

    list.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// 10. Auth
// ---------------------------------------------------------------------------
function initAuth() {
  state.unsubscribers.push(
    authManager.onAuthStateChanged((user) => {
      const signedIn  = $('#auth-signed-in');
      const signedOut = $('#auth-signed-out');

      if (user) {
        signedIn?.classList.remove('hidden');
        signedOut?.classList.add('hidden');

        const avatar = $('#user-avatar');
        if (avatar && user.photoURL) {
          avatar.src = user.photoURL;
          avatar.alt = `Profile picture for ${sanitize(user.displayName)}`;
        }
        setText('#user-display-name', user.displayName);
        setText('#user-email', user.email);

        if (user.ticket) {
          setText('#ticket-section', user.ticket.section);
          setText('#ticket-row',     user.ticket.row);
          setText('#ticket-seat',    user.ticket.seat);
          setText('#ticket-gate',    user.ticket.gate);
        }

        // Update greeting
        setText('.greeting-title', `Welcome, ${user.displayName.split(' ')[0]}!`);

        a11yManager.announcePolite(`Signed in as ${user.displayName}`);
      } else {
        signedIn?.classList.add('hidden');
        signedOut?.classList.remove('hidden');
      }
    }),
  );

  // Google sign-in button
  $('#google-signin-btn')?.addEventListener('click', async () => {
    const btn = $('#google-signin-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await authManager.signInWithGoogle();
    } catch (e) {
      console.error('Sign-in failed:', e);
      notifManager.showToast({ type: 'danger', title: 'Sign-in failed', body: 'Please try again.', timestamp: Date.now() });
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" aria-hidden="true" width="18" height="18"> Sign in with Google`;
    }
  });

  // Sign out
  $('#signout-btn')?.addEventListener('click', async () => {
    await authManager.signOut();
    a11yManager.announcePolite('Signed out successfully');
  });
}

// ---------------------------------------------------------------------------
// 11. Accessibility settings
// ---------------------------------------------------------------------------
function initSettings() {
  const prefs = a11yManager.getPrefs();

  const toggleMap = [
    { id: 'toggle-light-theme',   pref: 'lightTheme',   fn: (v) => a11yManager.setLightTheme(v)      },
    { id: 'toggle-high-contrast', pref: 'highContrast', fn: (v) => a11yManager.setHighContrast(v)    },
    { id: 'toggle-reduce-motion', pref: 'reduceMotion', fn: (v) => a11yManager.setReduceMotion(v)    },
    { id: 'toggle-mobility',      pref: 'mobilityMode', fn: (v) => a11yManager.setMobilityMode(v)    },
    { id: 'toggle-large-text',    pref: 'largeText',    fn: (v) => a11yManager.setLargeText(v)       },
  ];

  for (const { id, pref, fn } of toggleMap) {
    const btn = $(`#${id}`);
    if (!btn) continue;

    // Set initial state
    const initial = prefs[pref] ?? false;
    btn.setAttribute('aria-checked', String(initial));

    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      fn(next);
    });
  }

  // Notification preference toggles (UI only in demo)
  ['toggle-score-alerts', 'toggle-crowd-alerts', 'toggle-order-alerts'].forEach((id) => {
    const btn = $(`#${id}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
    });
  });
}

// ---------------------------------------------------------------------------
// 12. Alert banner
// ---------------------------------------------------------------------------
$('#alert-banner-close')?.addEventListener('click', () => notifManager.hideBanner());

// ---------------------------------------------------------------------------
// 13. Data subscription & simulation
// ---------------------------------------------------------------------------
function subscribeToData() {
  // Zone data
  state.unsubscribers.push(
    dataStore.subscribe('zones', (zones) => {
      state.zones = zones;
      computeDensities(zones);
    }),
  );

  // Match data
  state.unsubscribers.push(
    dataStore.subscribe('match', (match) => {
      state.match = match;
      updateScoreTicker(match);
    }),
  );

  // Match History
  state.unsubscribers.push(
    dataStore.subscribe('history', (history) => {
      renderMatchHistory(history);
    }),
  );

  // Alerts
  state.unsubscribers.push(
    dataStore.subscribe('alerts', (alerts) => {
      renderNotifications(alerts);

      // Show toast for newest unread alert
      const newest = alerts.find((a) => !a.read && Date.now() - a.timestamp < 10000);
      if (newest) {
        notifManager.showToast(newest);
        if (newest.type === 'danger') {
          notifManager.showBanner(newest.body, 'danger');
          a11yManager.announceAssertive(newest.body);
        }
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// 14. Quick actions
// ---------------------------------------------------------------------------
function initQuickActions() {
  $('#action-find-seat')?.addEventListener('click', () => navigate('navigate'));

  $('#action-nearest-food')?.addEventListener('click', () => {
    const rec = state.crowdEngine.getRecommendation(state.zones, 'concession', {
      mobilityMode: a11yManager.getPrefs().mobilityMode,
    });
    if (rec) {
      notifManager.showToast({
        type: 'info',
        title: 'Recommended: ' + rec.zone.name,
        body:  rec.reason,
        timestamp: Date.now(),
      });
      a11yManager.announcePolite(rec.reason);
    }
    navigate('food');
  });

  $('#action-nearest-restroom')?.addEventListener('click', () => {
    const rec = state.crowdEngine.getRecommendation(state.zones, 'restroom', {
      mobilityMode: a11yManager.getPrefs().mobilityMode,
    });
    if (rec) {
      state.navigate.toId = rec.zone.id;
      notifManager.showToast({
        type: 'info',
        title: 'Recommended: ' + rec.zone.name,
        body:  rec.reason,
        timestamp: Date.now(),
      });
      a11yManager.announcePolite(rec.reason);
    }
    navigate('navigate');
  });

  $('#action-emergency')?.addEventListener('click', () => {
    a11yManager.announceAssertive('Emergency services. Please remain calm and follow venue staff instructions.');
    notifManager.showBanner('🚨 Please remain calm and follow venue staff directions.', 'danger');
    notifManager.showToast({
      type: 'danger',
      title: 'Emergency',
      body: 'Contact nearest First Aid station or call 911.',
      timestamp: Date.now(),
    });
  });
}

// ---------------------------------------------------------------------------
// 15. Boot sequence
// ---------------------------------------------------------------------------
async function boot() {
  const overlay = $('#loading-overlay');

  // Initialize accessibility manager first (applies saved prefs)
  a11yManager.init();
  notifManager.init();

  // Start crowd worker
  initCrowdWorker();

  // Set up data subscriptions and start simulation
  subscribeToData();
  dataStore.startSimulation();

  // Wire authManager
  initAuth();
  initSettings();
  initQuickActions();

  // Bottom nav
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  // Event Selection Simulation
  $('#event-selector')?.addEventListener('change', (e) => {
    const sport = e.target.value;
    const txt = $('#event-selector').options[$('#event-selector').selectedIndex].text;
    notifManager.showToast({ type: 'info', title: 'Event Switched', body: `Now viewing: ${txt}`, timestamp: Date.now() });
    a11yManager.announcePolite(`Event context changed to ${sport}`);

    dataStore.setSport(sport);
    if (state.venueMap) {
      state.venueMap.setVenueLayout(sport);
    }

    const transitMetro = $('#transit-metro');
    const transitRideshare = $('#transit-rideshare');
    const transitParking = $('#transit-parking');
    
    if (sport === 'cricket') {
      if (transitMetro) transitMetro.textContent = 'Churchgate Station (400m)';
      if (transitRideshare) transitRideshare.textContent = 'Gate B / Marine Drive';
      if (transitParking) { transitParking.textContent = 'Lot 2 is 90% Full'; transitParking.style.color = 'var(--color-warning)'; }
    } else if (sport === 'football') {
      if (transitMetro) transitMetro.textContent = 'Salt Lake Sector V (1.2km)';
      if (transitRideshare) transitRideshare.textContent = 'Gate 1 / VIP Road';
      if (transitParking) { transitParking.textContent = 'Lot 1 is Open'; transitParking.style.color = 'var(--color-success)'; }
    } else if (sport === 'badminton') {
      if (transitMetro) transitMetro.textContent = 'Indraprastha Metro (800m)';
      if (transitRideshare) transitRideshare.textContent = 'Main Entrance';
      if (transitParking) { transitParking.textContent = 'Lot A is 40% Full'; transitParking.style.color = 'var(--color-success)'; }
    } else if (sport === 'tennis') {
      if (transitMetro) transitMetro.textContent = 'Cubbon Park Station (500m)';
      if (transitRideshare) transitRideshare.textContent = 'Kanteerava Gate';
      if (transitParking) { transitParking.textContent = 'Lot C is Full'; transitParking.style.color = 'var(--color-danger)'; }
    }
  });

  // Notification drawer
  $('#notification-btn')?.addEventListener('click', () => openDrawer('notification'));
  $('#notif-drawer-close')?.addEventListener('click', () => closeDrawer('notification'));
  $('#mark-all-read-btn')?.addEventListener('click', () => {
    dataStore.markAllAlertsRead();
    a11yManager.announcePolite('All notifications marked as read');
  });

  // Cart drawer
  $('#cart-btn')?.addEventListener('click', () => openDrawer('cart'));
  $('#cart-drawer-close')?.addEventListener('click', () => closeDrawer('cart'));
  $('#place-order-btn')?.addEventListener('click', handlePlaceOrder);

  // Simulate loading completion
  await sleep(1800);

  if (overlay) {
    overlay.classList.add('fade-out');
    overlay.addEventListener('transitionend', () => overlay.classList.add('hidden'), { once: true });
  }

  // Announce app ready
  a11yManager.announcePolite('SportsVilla loaded. Live match in progress. Navigate using the bottom tabs.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', boot);
