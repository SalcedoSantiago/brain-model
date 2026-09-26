import { STRUCTURES, STRUCTURE_BY_ID, LIST_SECTIONS, KIND_LABELS } from '../data/structures.js';
import { CATEGORIES, CATEGORY_BY_ID } from '../data/categories.js';
import { colorFor } from '../app/appearance.js';
import { ICONS } from './icons.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Panel izquierdo: lista de estructuras y filtros por función. */
export function initStructureList(root, app) {
  root.innerHTML = `
    <div class="panel-tabs" role="tablist" aria-label="Navegación">
      <button role="tab" id="tab-structures" aria-controls="pane-structures" aria-selected="true" class="panel-tab">Estructuras</button>
      <button role="tab" id="tab-functions" aria-controls="pane-functions" aria-selected="false" class="panel-tab" tabindex="-1">Funciones</button>
      <button role="tab" id="tab-pathologies" aria-controls="pane-pathologies" aria-selected="false" class="panel-tab" tabindex="-1">Patologías</button>
    </div>
    <div id="pane-structures" role="tabpanel" aria-labelledby="tab-structures" class="panel-pane">
      <label class="search">
        ${ICONS.search}
        <input type="search" placeholder="Buscar estructura o palabra clave" aria-label="Buscar estructura" autocomplete="off" />
      </label>
      <div class="list-hint">Clic para seleccionar · ${ICONS.eye.replace('width="18" height="18"', 'width="14" height="14"')} mostrar/ocultar · ${ICONS.target.replace('width="18" height="18"', 'width="14" height="14"')} aislar</div>
      <div class="structure-sections"></div>
    </div>
    <div id="pane-functions" role="tabpanel" aria-labelledby="tab-functions" class="panel-pane" hidden>
      <p class="pane-intro">Elige una función para resaltar en el modelo las estructuras que participan en ella.</p>
      <div class="category-list" role="list"></div>
      <div class="category-detail"></div>
    </div>
    <div id="pane-pathologies" role="tabpanel" aria-labelledby="tab-pathologies" class="panel-pane" hidden></div>`;

  const tabs = [...root.querySelectorAll('[role=tab]')];
  const panes = {
    'tab-structures': root.querySelector('#pane-structures'),
    'tab-functions': root.querySelector('#pane-functions'),
    'tab-pathologies': root.querySelector('#pane-pathologies'),
  };
  const selectTab = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      panes[t.id].hidden = !on;
    });
  };
  tabs.forEach((t) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const step = e.key === 'ArrowRight' ? 1 : tabs.length - 1;
        const next = tabs[(tabs.indexOf(t) + step) % tabs.length];
        selectTab(next);
        next.focus();
      }
    });
  });
  app.showFunctionsTab = () => selectTab(tabs[1]);
  app.showPathologiesTab = () => selectTab(tabs[2]);

  // ---------------------------------------------------------------- estructuras
  const sectionsEl = root.querySelector('.structure-sections');
  const search = root.querySelector('input[type=search]');

  const row = (id, depth = 0) => {
    const s = STRUCTURE_BY_ID[id];
    return `
      <li class="srow" data-id="${id}" style="--depth:${depth}">
        <button class="srow-main" data-act="select" title="${KIND_LABELS[s.kind]}">
          <span class="swatch" aria-hidden="true"></span>
          <span class="srow-name">${s.name}</span>
        </button>
        <button class="icon-btn sm" data-act="toggle" aria-label="Ocultar ${s.name}" title="Mostrar / ocultar">${ICONS.eye}</button>
        <button class="icon-btn sm" data-act="isolate" aria-label="Aislar ${s.name}" title="Aislar">${ICONS.target}</button>
      </li>
      ${s.nest ? s.members.map((m) => row(m, depth + 1)).join('') : ''}`;
  };
  sectionsEl.innerHTML = LIST_SECTIONS.map(
    (sec) => `
      <section class="list-section">
        <h3 class="list-title">${sec.title}</h3>
        <ul class="srows">${sec.ids.map((id) => row(id)).join('')}</ul>
      </section>`
  ).join('');

  sectionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.srow').dataset.id;
    const act = btn.dataset.act;
    if (act === 'select') app.select(id, { focus: true, fromList: true, multi: e.ctrlKey || e.metaKey || e.shiftKey });
    if (act === 'toggle') app.toggleHidden(id);
    if (act === 'isolate') app.toggleIsolate(id);
  });

  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    root.querySelectorAll('.srow').forEach((li) => {
      const s = STRUCTURE_BY_ID[li.dataset.id];
      const hay = norm([s.name, ...s.keywords, KIND_LABELS[s.kind]].join(' '));
      li.hidden = q && !hay.includes(q);
    });
    root.querySelectorAll('.list-section').forEach((sec) => {
      sec.hidden = [...sec.querySelectorAll('.srow')].every((li) => li.hidden);
    });
  });

  // ---------------------------------------------------------------- funciones
  const catList = root.querySelector('.category-list');
  const catDetail = root.querySelector('.category-detail');
  const membersOf = (catId) => STRUCTURES.filter((s) => s.categories.includes(catId) && !s.members && !s.side);
  catList.innerHTML = CATEGORIES.map(
    (c) => `
      <button class="cat-btn" role="listitem" data-cat="${c.id}" aria-pressed="false" style="--cat:${c.color}">
        <span class="cat-dot" aria-hidden="true"></span>
        <span class="cat-name">${c.name}</span>
        <span class="cat-count">${membersOf(c.id).length}</span>
      </button>`
  ).join('');
  catList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) app.setCategory(app.store.get().category === b.dataset.cat ? null : b.dataset.cat);
  });
  catDetail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) app.select(b.dataset.id, { focus: true, fromList: true });
    if (e.target.closest('[data-clear]')) app.setCategory(null);
  });

  // ---------------------------------------------------------------- sincronización
  let lastCat;
  return function render(state) {
    const hidden = new Set(state.hidden);
    const iso = new Set(state.isolate || []);
    const sel = new Set(state.selection);
    root.querySelectorAll('.srow').forEach((li) => {
      const id = li.dataset.id;
      const s = STRUCTURE_BY_ID[id];
      const isHidden = hidden.has(id) || app.isHiddenByGroup(id);
      li.classList.toggle('is-hidden', isHidden);
      li.classList.toggle('is-selected', sel.has(id));
      li.classList.toggle('is-isolated', iso.has(id));
      li.querySelector('[data-act=select]').setAttribute('aria-current', sel.has(id) ? 'true' : 'false');
      const tBtn = li.querySelector('[data-act=toggle]');
      tBtn.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
      tBtn.setAttribute('aria-label', `${isHidden ? 'Mostrar' : 'Ocultar'} ${s.name}`);
      tBtn.setAttribute('aria-pressed', isHidden);
      const iBtn = li.querySelector('[data-act=isolate]');
      iBtn.setAttribute('aria-pressed', iso.has(id));
      iBtn.setAttribute('aria-label', `${iso.has(id) ? 'Dejar de aislar' : 'Aislar'} ${s.name}`);
      const leafs = s.side ? ['lobulo_frontal', 'lobulo_parietal', 'lobulo_temporal'] : s.members ? s.members.slice(0, 3).map(firstLeaf) : [id];
      const colors = leafs.map((l) => colorFor(l, state.view));
      li.querySelector('.swatch').style.background = colors.length > 1 ? `linear-gradient(135deg, ${colors.join(', ')})` : colors[0];
    });

    root.querySelectorAll('.cat-btn').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cat === state.category));
    if (state.category !== lastCat) {
      lastCat = state.category;
      const c = CATEGORY_BY_ID[state.category];
      catDetail.innerHTML = c
        ? `<div class="cat-detail" style="--cat:${c.color}">
            <div class="cat-detail-head"><h3>${c.name}</h3><button class="text-btn" data-clear>Quitar filtro</button></div>
            <p>${c.description}</p>
            <p class="muted small">Estructuras resaltadas en el modelo:</p>
            <ul class="cat-members">${membersOf(c.id).map((s) => `<li><button class="link-btn" data-id="${s.id}">${s.name}</button></li>`).join('')}</ul>
            <p class="muted small">Participar en una función no significa ser su única responsable: las funciones dependen de redes de estructuras.</p>
          </div>`
        : '';
    }
  };
}

function firstLeaf(id) {
  const s = STRUCTURE_BY_ID[id];
  return s.members ? firstLeaf(s.members[0]) : id;
}
