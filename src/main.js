import './styles.css';
import { BrainViewer } from './viewer/BrainViewer.js';
import { MODEL_CONFIG } from './data/modelConfig.js';
import { STRUCTURE_BY_ID } from './data/structures.js';
import { createStore, INITIAL_STATE } from './app/store.js';
import { buildAppearance, pathologyRoles } from './app/appearance.js';
import { PATHOLOGY_BY_ID } from './data/pathologies.js';
import { initPathologyList } from './ui/pathologies.js';
import { AREA_BY_ID, areaName } from './data/areas.js';
import { initAreaList } from './ui/areas.js';
import { NATURAL } from './data/palettes.js';
import { Color } from 'three';
import { initStructureList } from './ui/structureList.js';
import { initInfoPanel } from './ui/infoPanel.js';
import { initToolbar } from './ui/toolbar.js';
import { initLabels } from './ui/labels.js';
import { initOrientation } from './ui/orientation.js';
import { initLegend } from './ui/legend.js';
import { initQuiz, newQuestion } from './ui/quiz.js';

const $ = (sel) => document.querySelector(sel);
const store = createStore(INITIAL_STATE);
const viewer = new BrainViewer($('#viewport'), MODEL_CONFIG);
const labels = initLabels($('#labels'), viewer);
// Paneles desplegables (lista lateral) y ficha inferior (teléfonos): ver styles.css
const hasDrawer = () => window.matchMedia('(max-width: 1100px)').matches;
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ índice estructura → piezas 3D
const partsCache = new Map();
function partsOf(id) {
  if (partsCache.has(id)) return partsCache.get(id);
  const s = STRUCTURE_BY_ID[id];
  let parts = [];
  if (s?.side) parts = viewer.parts.filter((p) => p.side === s.side);
  else {
    parts = [...(viewer.partsById.get(id) || [])];
    for (const m of s?.members || []) parts.push(...partsOf(m));
  }
  parts = [...new Set(parts)];
  partsCache.set(id, parts);
  return parts;
}
const focusView = (id) => {
  const v = MODEL_CONFIG.focusViews[id] || MODEL_CONFIG.focusViews.default;
  return Array.isArray(v) ? { dir: v } : v;
};

// ------------------------------------------------------------------ acciones de la aplicación
const app = {
  store,
  viewer,
  partsOf,

  select(id, { focus = false, fromList = false, multi = false, hit = null } = {}) {
    const s = store.get();
    if (s.mode !== 'explore') return;
    let selection = [id];
    if (multi) selection = s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [id, ...s.selection];
    const patch = { selection, pathology: null, area: null, ...restoreReveal(s) };
    if (fromList) {
      // Seleccionar desde la lista garantiza que la estructura sea visible
      const own = partsOf(id);
      patch.hidden = (patch.hidden ?? s.hidden).filter((h) => !partsOf(h).some((p) => own.includes(p)));
      if (s.isolate) {
        const iso = new Set(s.isolate.flatMap(partsOf));
        if (!own.every((p) => iso.has(p))) patch.isolate = null;
      }
      const hemi = patch.hemisphere ?? s.hemisphere;
      if (hemi !== 'both' && own.every((p) => p.side !== 'C' && p.side !== hemi)) patch.hemisphere = 'both';
    }
    store.set(patch);
    updateLabel(hit);
    if (selection[0]) announce(`Seleccionado: ${STRUCTURE_BY_ID[selection[0]].name}`);
    if (focus && selection[0]) app.focus(selection[0]);
    if (hasDrawer() && selection.length) document.body.classList.remove('show-left');
  },

  clearSelection() {
    store.set({ selection: [] });
    labels.hide();
  },

  focus(id) {
    const fv = focusView(id);
    const s = store.get();
    if (fv.hemisphere && s.hemisphere === 'both' && !STRUCTURE_BY_ID[id].side) store.set({ hemisphere: fv.hemisphere });
    const all = partsOf(id);
    const visible = all.filter((p) => p.tgt.opacity > 0.05);
    const parts = visible.length ? visible : all;
    const dir = [...fv.dir];
    // Estructuras bilaterales: mirar desde el lado en el que está la cámara (o el visible)
    const sides = new Set(parts.map((p) => p.side));
    if (!fv.hemisphere && !STRUCTURE_BY_ID[id].side) {
      let side = viewer.cameraSide();
      if (sides.has('L') && !sides.has('R')) side = -1;
      if (sides.has('R') && !sides.has('L')) side = 1;
      dir[0] = Math.abs(dir[0]) * side;
    }
    viewer.focusParts(parts, dir);
  },

  isHiddenByGroup(id) {
    const s = store.get();
    const own = partsOf(id);
    if (!own.length) return false;
    const hidden = new Set(s.hidden.filter((h) => h !== id).flatMap(partsOf));
    if (s.hemisphere !== 'both') own.filter((p) => p.side !== 'C' && p.side !== s.hemisphere).forEach((p) => hidden.add(p));
    if (s.isolate) {
      const iso = new Set(s.isolate.flatMap(partsOf));
      own.filter((p) => !iso.has(p)).forEach((p) => hidden.add(p));
    }
    return own.every((p) => hidden.has(p));
  },

  toggleHidden(id) {
    const s = store.get();
    if (s.hidden.includes(id)) return store.set({ hidden: s.hidden.filter((h) => h !== id) });
    if (app.isHiddenByGroup(id)) {
      // Estaba oculta por un grupo o por el aislamiento: mostrarla
      const own = partsOf(id);
      const patch = { hidden: s.hidden.filter((h) => !partsOf(h).some((p) => own.includes(p))) };
      if (s.isolate) patch.isolate = [...s.isolate, id];
      if (s.hemisphere !== 'both' && own.every((p) => p.side !== 'C' && p.side !== s.hemisphere)) patch.hemisphere = 'both';
      return store.set(patch);
    }
    store.set({ hidden: [...s.hidden, id] });
    announce(`${STRUCTURE_BY_ID[id].name} oculto`);
  },

  toggleIsolate(id) {
    const s = store.get();
    const on = s.isolate?.length === 1 && s.isolate[0] === id;
    store.set({ isolate: on ? null : [id], hidden: on ? s.hidden : s.hidden.filter((h) => h !== id) });
    if (!on) {
      if (!s.selection.includes(id)) app.select(id);
      app.focus(id);
    }
  },

  showAll() {
    store.set({ hidden: [], isolate: null, hemisphere: 'both', category: null, depth: 0, view: store.get().view === 'interna' ? 'anatomica' : store.get().view });
    announce('Se muestran todas las estructuras');
  },

  hideSelection() {
    const s = store.get();
    if (!s.selection.length) return;
    store.set({ hidden: [...new Set([...s.hidden, ...s.selection])], selection: [] });
    labels.hide();
  },

  isolateSelection() {
    const s = store.get();
    if (!s.selection.length) return;
    store.set({ isolate: [...s.selection] });
    app.focus(s.selection[0]);
  },

  setView(view) {
    const s = store.get();
    const patch = { view, category: null };
    if (view !== 'areas') Object.assign(patch, { area: null }, restoreReveal(s));
    else patch.pathology = null;
    if (view === 'interna') patch.depth = s.depth > 0 ? s.depth : 0.75;
    else patch.depth = 0;
    if (view === 'explodida') {
      patch.explode = 1;
      zoomForExplode(1);
    } else if (s.view === 'explodida') patch.explode = 0;
    store.set(patch);
  },

  setDepth(depth) {
    const s = store.get();
    let view = s.view;
    if (depth > 0 && (view === 'anatomica' || view === 'explodida')) view = 'interna';
    if (depth === 0 && view === 'interna') view = 'anatomica';
    store.set({ depth, view });
  },

  setCategory(category) {
    store.set({ category, pathology: null, area: null });
    if (category) announce(`Función resaltada: ${category}`);
  },

  // ---------------------------------------------------------------- patologías
  setPathology(id) {
    const s = store.get();
    store.set({
      pathology: id, selection: [], category: null, area: null, areaReveal: [], isolate: null, hidden: [], hemisphere: 'both',
      depth: 0, view: s.view === 'interna' || s.view === 'limbica' ? 'anatomica' : s.view,
    });
    labels.hide();
    if (!id) return;
    announce(`Patología: ${PATHOLOGY_BY_ID[id].name}`);
    if (hasDrawer()) document.body.classList.remove('show-left');
    app.focusPathology();
  },

  /** Encuadra las estructuras principalmente afectadas (del lado afectado si está lateralizada). */
  focusPathology() {
    const p = PATHOLOGY_BY_ID[store.get().pathology];
    if (!p) return;
    const roles = pathologyRoles(p, partsOf);
    const principal = [...roles].filter(([, r]) => r === 'principal').map(([part]) => part);
    const first = p.affected.find((a) => a.role === 'principal');
    const dir = [...focusView(first.id).dir];
    const sides = new Set(p.affected.filter((a) => a.role === 'principal').map((a) => a.side).filter(Boolean));
    const side = sides.size === 1 ? ([...sides][0] === 'L' ? -1 : 1) : viewer.cameraSide();
    if (!focusView(first.id).hemisphere) dir[0] = Math.abs(dir[0]) * side;
    viewer.focusParts(principal, dir);
    pathologyLabelPending = true;
    // Por si la cámara no llega a animarse (p. ej. con movimiento reducido)
    setTimeout(() => {
      if (!pathologyLabelPending) return;
      pathologyLabelPending = false;
      updatePathologyLabel();
    }, 900);
  },

  // ---------------------------------------------------------------- áreas corticales
  /** Selecciona un área cortical. `hit` (clic) fija el lado y el punto de la etiqueta. */
  selectArea(id, { focus = false, hit = null } = {}) {
    const s = store.get();
    if (!id) {
      store.set({ area: null, ...restoreReveal(s) });
      return labels.hide();
    }
    const area = AREA_BY_ID[id];
    const side = hit ? hit.part.side : area.lateral?.side || (viewer.cameraSide() < 0 ? 'L' : 'R');
    store.set({
      ...restoreReveal(s),
      area: id, areaSide: side, selection: [], pathology: null, category: null,
      view: 'areas', depth: 0, areaLevels: s.areaLevels.includes(area.level) ? s.areaLevels : [...s.areaLevels, area.level],
    });
    announce(`Área: ${areaName(area, side)}`);
    if (hasDrawer() && !hit) document.body.classList.remove('show-left');
    if (hit) labels.show({ part: hit.part, local: hit.point.clone().sub(hit.part.mesh.position) }, areaName(area, side), area.short);
    if (focus) app.focusArea(id);
    else if (!hit) updateAreaLabel();
  },

  /** Encuadra un área; puede mostrar un solo hemisferio o desarmar para verla. */
  focusArea(id) {
    const area = AREA_BY_ID[id];
    if (!area) return;
    const v = MODEL_CONFIG.areaViews[id] || MODEL_CONFIG.areaViews.default;
    const cfg = Array.isArray(v) ? { dir: v } : v;
    let s = store.get();
    if (cfg.hemisphere && s.hemisphere !== cfg.hemisphere) store.set({ hemisphere: cfg.hemisphere, areaSide: cfg.hemisphere });
    if (cfg.reveal) {
      // Ocultar los lóbulos que tapan el área y mostrar solo su hemisferio
      const side = s.areaSide || 'L';
      const reveal = cfg.reveal.filter((r) => !s.hidden.includes(r));
      store.set({ hidden: [...s.hidden, ...reveal], areaReveal: reveal, hemisphere: side, explode: 0 });
    } else if (s.hidden.includes(area.lobe)) store.set({ hidden: s.hidden.filter((h) => h !== area.lobe) });
    s = store.get();
    const side = cfg.hemisphere || s.areaSide || 'L';
    const region = viewer.areaRegion(viewer.areaIds.indexOf(id), viewer.parts.filter((p) => p.side === side));
    if (!region) return;
    const dir = [...cfg.dir];
    if (!cfg.hemisphere) dir[0] = Math.abs(dir[0]) * (side === 'L' ? -1 : 1);
    viewer.focusBox(region.box, dir);
    areaLabelPending = true;
    setTimeout(() => areaLabelPending && updateAreaLabel(), 1200);
  },

  setAreaLevels(areaLevels) {
    const s = store.get();
    const hideArea = s.area && !areaLevels.includes(AREA_BY_ID[s.area].level);
    store.set({ areaLevels, ...(hideArea ? { area: null } : {}) });
    if (hideArea) labels.hide();
  },

  setHemisphere(hemisphere) {
    store.set({ hemisphere });
  },

  setExplode(explode, { keepView = false } = {}) {
    const s = store.get();
    let view = s.view;
    if (explode > 0 && view === 'anatomica') view = 'explodida';
    if (explode === 0 && view === 'explodida') view = 'anatomica';
    if (!keepView && explode > 0 && s.explode === 0) zoomForExplode(explode);
    store.set({ explode, view });
  },

  setDragMode(dragMode) {
    store.set({ dragMode });
    if (dragMode) announce('Mover piezas activado: arrastra una estructura para sacarla');
  },

  reassemble() {
    viewer.reassemble();
    store.set({ explode: 0, view: store.get().view === 'explodida' ? 'anatomica' : store.get().view });
  },

  setSection(patch) {
    store.set({ section: { ...store.get().section, ...patch } });
  },

  applyPreset(key) {
    const p = MODEL_CONFIG.cameraPresets[key];
    if (p.hemisphere) store.set({ hemisphere: p.hemisphere });
    const s = store.get();
    viewer.viewFrom(p.dir, { distance: viewer.fitDistance(viewer.radius * (1 + 0.5 * s.explode)) });
  },

  resetAll() {
    store.set({
      selection: [], hidden: [], isolate: null, category: null, pathology: null, area: null, areaReveal: [], hemisphere: 'both',
      explode: 0, dragMode: false, depth: 0, view: 'anatomica', autoRotate: false,
      section: { ...INITIAL_STATE.section },
    });
    labels.hide();
    viewer.reassemble();
    viewer.resetView();
  },

  // ---------------------------------------------------------------- modo Estudiar
  setMode(mode) {
    if (mode === 'study') return app.startStudy();
    store.set({ mode: 'explore', quiz: null, hemisphere: 'both' });
    labels.hide();
    viewer.resetView();
  },

  startStudy(setId = 'todas') {
    viewer.reassemble();
    if (isPhone()) document.body.classList.add('sheet-expanded');
    const q = newQuestion(setId);
    store.set({
      mode: 'study', selection: [], hidden: [], isolate: null, category: null, pathology: null, area: null, explode: 0, dragMode: false,
      depth: 0, view: 'anatomica', section: { ...INITIAL_STATE.section }, autoRotate: false,
      hemisphere: questionHemisphere(q),
      quiz: { ...q, set: setId, score: { right: 0, total: 0 } },
    });
    labels.hide();
    app.focusQuizTarget();
  },

  nextQuestion(setId, reset = false) {
    const prev = store.get().quiz || {};
    const set = setId || prev.set || 'todas';
    const q = newQuestion(set, prev);
    const hemisphere = questionHemisphere(q);
    store.set({ hemisphere, quiz: { ...q, set, score: reset || !prev.score ? { right: 0, total: 0 } : prev.score } });
    labels.hide();
    app.focusQuizTarget();
  },

  focusQuizTarget() {
    const q = store.get().quiz;
    if (!q) return;
    // En las preguntas de patologías no se señala la estructura antes de responder
    if (q.kind === 'pathology' && !q.answer) return viewer.resetView();
    const fv = focusView(q.current);
    const parts = partsOf(q.current).filter((p) => store.get().hemisphere === 'both' || p.side !== (store.get().hemisphere === 'L' ? 'R' : 'L'));
    const dir = [...fv.dir];
    if (!fv.hemisphere) dir[0] = Math.abs(dir[0]) * -1;
    viewer.focusParts(parts, dir);
  },

  onQuizAnswered() {
    const q = store.get().quiz;
    const s = STRUCTURE_BY_ID[q.current];
    if (q.kind === 'pathology') app.focusQuizTarget();
    const a = viewer.anchorFor(partsOf(q.current));
    if (a) labels.show(a, s.name, s.short);
    announce(q.answer === q.current ? 'Respuesta correcta' : `Respuesta incorrecta. Era ${s.name}`);
  },
};

/** Deshace el ocultamiento temporal de lóbulos hecho para mostrar un área. */
function restoreReveal(s) {
  if (!s.areaReveal?.length) return {};
  return { hidden: s.hidden.filter((h) => !s.areaReveal.includes(h)), areaReveal: [], hemisphere: 'both' };
}

function questionHemisphere(q) {
  return q.kind === 'pathology' ? 'both' : focusView(q.current).hemisphere || 'both';
}

function zoomForExplode(amount) {
  const t = viewer.controls.target;
  const dir = viewer.camera.position.clone().sub(t).normalize();
  viewer.viewFrom(dir.toArray(), { target: viewer.center, distance: viewer.fitDistance(viewer.radius * (1 + 0.55 * amount)) });
}

// ------------------------------------------------------------------ etiqueta 3D
let labelFromClick = false;
function updateLabel(hit) {
  const id = store.get().selection[0];
  if (!id) return labels.hide();
  const s = STRUCTURE_BY_ID[id];
  const own = partsOf(id);
  if (hit && own.includes(hit.part)) {
    labelFromClick = true;
    labels.show({ part: hit.part, local: hit.point.clone().sub(hit.part.mesh.position) }, s.name, s.short);
  } else {
    labelFromClick = false;
    const a = viewer.anchorFor(own);
    a ? labels.show(a, s.name, s.short) : labels.hide();
  }
}
let areaLabelPending = false;
function updateAreaLabel() {
  areaLabelPending = false;
  const s = store.get();
  const area = AREA_BY_ID[s.area];
  if (!area) return;
  const region = viewer.areaRegion(viewer.areaIds.indexOf(s.area), viewer.parts.filter((p) => p.side === (s.areaSide || 'L')));
  if (region?.anchor) labels.show(region.anchor, areaName(area, s.areaSide), area.short);
}

let pathologyLabelPending = false;
function updatePathologyLabel() {
  const p = PATHOLOGY_BY_ID[store.get().pathology];
  if (!p) return;
  const roles = pathologyRoles(p, partsOf);
  const principal = [...roles].filter(([, r]) => r === 'principal').map(([part]) => part);
  const a = viewer.anchorFor(principal);
  const names = p.affected.filter((x) => x.role === 'principal').map((x) => STRUCTURE_BY_ID[x.id].name);
  if (a) labels.show(a, p.name, `Afectación principal: ${names.join(', ')}`);
}
viewer.on('cameraend', () => {
  const s = store.get();
  if (s.mode !== 'explore') return;
  if (s.area && areaLabelPending) updateAreaLabel();
  else if (s.pathology && pathologyLabelPending) {
    pathologyLabelPending = false;
    updatePathologyLabel();
  } else if (s.selection[0] && !labelFromClick) updateLabel(null);
});

// ------------------------------------------------------------------ eventos del visor
viewer.on('pick', ({ hit, multi }) => {
  const s = store.get();
  if (s.mode !== 'explore') return;
  if (!hit) {
    if (!multi) app.clearSelection();
    return;
  }
  // En la vista por áreas, un clic sobre la corteza selecciona el área
  if (s.view === 'areas' && hit.area != null && !multi) {
    const id = viewer.areaIds[hit.area];
    if (AREA_BY_ID[id]) return app.selectArea(id, { hit });
  }
  app.select(hit.part.id, { multi, hit });
});
viewer.on('dblpick', ({ hit }) => store.get().mode === 'explore' && app.focus(hit.part.id));
viewer.on('dragstart', ({ part }) => {
  if (store.get().selection[0] !== part.id) app.select(part.id);
});
viewer.on('dragend', () => updateLabel(null));
viewer.on('hover', ({ hit, x, y }) => {
  const s = store.get();
  if (s.mode !== 'explore' || !hit) return labels.tip(0, 0, null);
  const area = s.view === 'areas' && hit.area != null ? AREA_BY_ID[viewer.areaIds[hit.area]] : null;
  labels.tip(x, y, area ? areaName(area, hit.part.side) : STRUCTURE_BY_ID[hit.part.id]?.name);
});
viewer.renderer.domElement.addEventListener('pointerdown', () => $('#hint')?.classList.add('is-gone'), { once: true });
viewer.dragGroup = (part) => [part];
if (import.meta.env.DEV) window.__app = app;

// ------------------------------------------------------------------ interfaz
const renderList = initStructureList($('#panel-left'), app);
const renderInfo = initInfoPanel($('#info'), app);
const renderQuiz = initQuiz($('#info'), app);
const renderToolbar = initToolbar($('#controls'), app);
const renderLegend = initLegend($('#legend'), app);
const renderPathologies = initPathologyList($('#pane-pathologies'), app);
const renderAreas = initAreaList($('#pane-areas'), app);

/** Colorea la corteza por áreas según los niveles visibles y el área seleccionada. */
let lastPaint = '';
const WHITE = new Color('#ffffff');
const OFF = new Color('#e8e0d9');
function paintAreas(s) {
  if (s.view !== 'areas') return;
  const key = `${s.area}|${s.areaSide}|${s.areaLevels.join()}`;
  if (key === lastPaint) return;
  lastPaint = key;
  const cache = new Map();
  viewer.paintAreas((idx, part) => {
    if (idx == null) return new Color(NATURAL[part.id] || '#dddddd');
    const area = AREA_BY_ID[viewer.areaIds[idx]];
    if (!area || !s.areaLevels.includes(area.level)) return OFF;
    const selected = s.area === area.id && (!s.areaSide || part.side === s.areaSide);
    const k = `${area.id}|${s.area && !selected}`;
    if (!cache.has(k)) {
      const c = new Color(area.color);
      if (s.area && !selected) c.lerp(WHITE, 0.6);
      cache.set(k, c);
    }
    return cache.get(k);
  });
}
initOrientation($('#orientation'), viewer);

const viewButtons = [...document.querySelectorAll('[data-view]')];
viewButtons.forEach((b) => b.addEventListener('click', () => app.setView(b.dataset.view)));
$('#view-select').addEventListener('change', (e) => app.setView(e.target.value));
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => app.setMode(b.dataset.mode)));

// Paneles desplegables en pantallas pequeñas
$('#btn-left').addEventListener('click', () => document.body.classList.toggle('show-left'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('show-left'));
$('#sheet-handle').addEventListener('click', () => {
  document.body.classList.toggle('sheet-expanded');
  renderChrome(store.get());
});

function renderChrome(s) {
  viewButtons.forEach((b) => b.setAttribute('aria-checked', b.dataset.view === s.view));
  $('#view-select').value = s.view;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === s.mode));
  document.body.classList.toggle('is-study', s.mode === 'study');
  document.body.classList.toggle('has-selection', s.mode === 'study' || s.selection.length > 0 || !!s.pathology || !!s.area);
  $('#btn-left').setAttribute('aria-expanded', document.body.classList.contains('show-left'));
  $('#sheet-handle').setAttribute('aria-expanded', document.body.classList.contains('sheet-expanded'));
  const sel = s.mode === 'study' ? 'Estudiar' : s.pathology ? PATHOLOGY_BY_ID[s.pathology].name : s.area ? areaName(AREA_BY_ID[s.area], s.areaSide) : s.selection[0] ? STRUCTURE_BY_ID[s.selection[0]].name : 'Información';
  $('#sheet-title').textContent = sel;
  updateInset();
}

/** En móvil, la ficha inferior tapa parte del visor: se desplaza el encuadre. */
function updateInset() {
  const b = document.body.classList;
  const panel = $('#panel-right');
  let inset = 0;
  if (window.matchMedia('(max-width: 760px)').matches && b.contains('has-selection')) inset = b.contains('sheet-expanded') ? panel.offsetHeight : 56;
  viewer.setBottomInset(inset);
}
window.addEventListener('resize', updateInset);

let loaded = false;
store.subscribe((s) => {
  if (!loaded) return;
  viewer.setAppearance(buildAppearance(s, { partsOf, parts: viewer.parts }));
  viewer.setExplode(s.explode);
  viewer.setDragMode(s.dragMode && s.mode === 'explore');
  viewer.setSection(s.section);
  viewer.setAutoRotate(s.autoRotate);
  renderChrome(s);
  renderList(s);
  s.mode === 'study' ? renderQuiz(s) : renderInfo(s);
  renderToolbar(s);
  renderLegend(s);
  renderPathologies(s);
  renderAreas(s);
  paintAreas(s);
  // Si la pieza que ancla la etiqueta deja de verse, buscar otro anclaje
  const a = labels.anchor;
  if (s.mode === 'explore' && a && a.part.tgt.opacity === 0 && s.selection[0]) {
    labelFromClick = false;
    requestAnimationFrame(() => updateLabel(null));
  }
});

// ------------------------------------------------------------------ teclado
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const s = store.get();
  if (e.key === 'Escape') {
    document.body.classList.remove('show-left');
    if (s.mode === 'explore') {
      if (s.pathology) app.setPathology(null);
      if (s.area) app.selectArea(null);
      app.clearSelection();
    }
    return;
  }
  if (s.mode !== 'explore') return;
  const k = e.key.toLowerCase();
  if (k === 'h') app.hideSelection();
  else if (k === 'i') app.isolateSelection();
  else if (k === 'r') app.resetAll();
  else if (k === 'e') app.setExplode(s.explode > 0 ? 0 : 1);
  else if (k === 'f' && s.selection[0]) app.focus(s.selection[0]);
});

function announce(text) {
  const el = $('#sr-status');
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = text));
}

// ------------------------------------------------------------------ carga
const loader = $('#loader');
viewer
  .load((f) => {
    loader.querySelector('.bar span').style.width = `${Math.round(f * 100)}%`;
  })
  .then(() => {
    loaded = true;
    store.set({});
    loader.classList.add('is-done');
    setTimeout(() => loader.remove(), 500);
  })
  .catch((err) => {
    console.error(err);
    loader.querySelector('p').textContent = 'No se pudo cargar el modelo 3D. Comprueba la conexión o que tu navegador admita WebGL.';
    loader.classList.add('is-error');
  });
