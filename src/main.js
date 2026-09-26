import './styles.css';
import { BrainViewer } from './viewer/BrainViewer.js';
import { MODEL_CONFIG } from './data/modelConfig.js';
import { STRUCTURE_BY_ID } from './data/structures.js';
import { createStore, INITIAL_STATE } from './app/store.js';
import { buildAppearance } from './app/appearance.js';
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
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

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
    const patch = { selection };
    if (fromList) {
      // Seleccionar desde la lista garantiza que la estructura sea visible
      const own = partsOf(id);
      patch.hidden = s.hidden.filter((h) => !partsOf(h).some((p) => own.includes(p)));
      if (s.isolate) {
        const iso = new Set(s.isolate.flatMap(partsOf));
        if (!own.every((p) => iso.has(p))) patch.isolate = null;
      }
      if (s.hemisphere !== 'both' && own.every((p) => p.side !== 'C' && p.side !== s.hemisphere)) patch.hemisphere = 'both';
    }
    store.set(patch);
    updateLabel(hit);
    if (selection[0]) announce(`Seleccionado: ${STRUCTURE_BY_ID[selection[0]].name}`);
    if (focus && selection[0]) app.focus(selection[0]);
    if (isMobile() && selection.length) document.body.classList.remove('show-left');
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
    store.set({ category });
    if (category) announce(`Función resaltada: ${category}`);
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
      selection: [], hidden: [], isolate: null, category: null, hemisphere: 'both',
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
    if (isMobile()) document.body.classList.add('sheet-expanded');
    const q = newQuestion(setId);
    store.set({
      mode: 'study', selection: [], hidden: [], isolate: null, category: null, explode: 0, dragMode: false,
      depth: 0, view: 'anatomica', section: { ...INITIAL_STATE.section }, autoRotate: false,
      hemisphere: focusView(q.current).hemisphere || 'both',
      quiz: { ...q, set: setId, score: { right: 0, total: 0 } },
    });
    labels.hide();
    app.focusQuizTarget();
  },

  nextQuestion(setId, reset = false) {
    const prev = store.get().quiz || {};
    const set = setId || prev.set || 'todas';
    const q = newQuestion(set, prev.current);
    const hemisphere = focusView(q.current).hemisphere || 'both';
    store.set({ hemisphere, quiz: { ...q, set, score: reset || !prev.score ? { right: 0, total: 0 } : prev.score } });
    labels.hide();
    app.focusQuizTarget();
  },

  focusQuizTarget() {
    const q = store.get().quiz;
    if (!q) return;
    const fv = focusView(q.current);
    const parts = partsOf(q.current).filter((p) => store.get().hemisphere === 'both' || p.side !== (store.get().hemisphere === 'L' ? 'R' : 'L'));
    const dir = [...fv.dir];
    if (!fv.hemisphere) dir[0] = Math.abs(dir[0]) * -1;
    viewer.focusParts(parts, dir);
  },

  onQuizAnswered() {
    const q = store.get().quiz;
    const s = STRUCTURE_BY_ID[q.current];
    const a = viewer.anchorFor(partsOf(q.current));
    if (a) labels.show(a, s.name, s.short);
    announce(q.answer === q.current ? 'Respuesta correcta' : `Respuesta incorrecta. Era ${s.name}`);
  },
};

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
viewer.on('cameraend', () => {
  const s = store.get();
  if (s.mode === 'explore' && s.selection[0] && !labelFromClick) updateLabel(null);
});

// ------------------------------------------------------------------ eventos del visor
viewer.on('pick', ({ hit, multi }) => {
  const s = store.get();
  if (s.mode !== 'explore') return;
  if (!hit) {
    if (!multi) app.clearSelection();
    return;
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
  labels.tip(x, y, STRUCTURE_BY_ID[hit.part.id]?.name);
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
  document.body.classList.toggle('has-selection', s.mode === 'study' || s.selection.length > 0);
  $('#btn-left').setAttribute('aria-expanded', document.body.classList.contains('show-left'));
  $('#sheet-handle').setAttribute('aria-expanded', document.body.classList.contains('sheet-expanded'));
  const sel = s.selection[0] ? STRUCTURE_BY_ID[s.selection[0]].name : s.mode === 'study' ? 'Estudiar' : 'Información';
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
    if (s.mode === 'explore') app.clearSelection();
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
