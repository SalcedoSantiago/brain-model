import { STRUCTURES, STRUCTURE_BY_ID, KIND_LABELS } from '../data/structures.js';
import { CATEGORY_BY_ID } from '../data/categories.js';
import { ICONS } from './icons.js';
import { PATHOLOGY_BY_ID } from '../data/pathologies.js';
import { pathologyCard, relatedPathologiesSection } from './pathologies.js';
import { AREA_BY_ID } from '../data/areas.js';
import { areaCard } from './areas.js';

/** Panel derecho: ficha educativa de la estructura seleccionada. */
export function initInfoPanel(root, app) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, id } = b.dataset;
    if (action === 'select') app.select(id, { focus: true, fromList: true });
    if (action === 'category') {
      app.setCategory(id);
      app.showFunctionsTab?.();
    }
    if (action === 'toggle') app.toggleHidden(id);
    if (action === 'isolate') app.toggleIsolate(id);
    if (action === 'focus') app.focus(id);
    if (action === 'clear') app.clearSelection();
    if (action === 'study') app.startStudy();
    if (action === 'pathology') app.setPathology(id);
    if (action === 'patho-focus') app.focusPathology();
    if (action === 'patho-close') app.setPathology(null);
    if (action === 'patho-structure') app.focus(id);
    if (action === 'area') app.selectArea(id, { focus: true });
    if (action === 'area-focus') app.focusArea(app.store.get().area);
    if (action === 'area-close') app.selectArea(null);
  });

  let lastKey = '';
  return function render(state) {
    if (state.mode !== 'explore') return;
    const id = state.selection[0];
    const key = `${state.pathology}|${state.area}|${state.areaSide}|${id}|${state.hidden.join()}|${(state.isolate || []).join()}|${state.selection.length}`;
    if (key === lastKey) return;
    lastKey = key;
    if (state.pathology) root.innerHTML = pathologyCard(PATHOLOGY_BY_ID[state.pathology]);
    else if (state.area) root.innerHTML = areaCard(AREA_BY_ID[state.area], state.areaSide);
    else root.innerHTML = id ? detail(STRUCTURE_BY_ID[id], state, app) : welcome();
    root.scrollTop = 0;
  };
}

function welcome() {
  return `
    <div class="info-welcome">
      <h2 class="info-title">Atlas 3D del encéfalo</h2>
      <p class="lead">Explora la anatomía del encéfalo y su relación con los procesos psicológicos.</p>
      <ol class="steps">
        <li><strong>Selecciona</strong> una estructura con un clic en el modelo o en la lista.</li>
        <li><strong>Rota</strong> arrastrando y haz <strong>zoom</strong> con la rueda o con dos dedos.</li>
        <li><strong>Desarma</strong> el cerebro con el botón ${ICONS.explode.replace('width="18" height="18"', 'width="15" height="15"')} o activa ${ICONS.hand.replace('width="18" height="18"', 'width="15" height="15"')} <em>Mover piezas</em> para sacar cada parte con el ratón o el dedo.</li>
        <li>Usa la <strong>vista interna</strong> o el <strong>corte</strong> para descubrir las estructuras profundas.</li>
        <li>En la pestaña <strong>Áreas</strong> verás la división en áreas primarias, secundarias y terciarias.</li>
        <li>En la pestaña <strong>Patologías</strong> verás qué partes del cerebro se afectan en cada enfermedad o trastorno.</li>
      </ol>
      <div class="legend-types">
        <div class="type-row"><span class="type-tag anat">${ICONS.anatomy} Anatomía</span><span>dónde está y cómo es</span></div>
        <div class="type-row"><span class="type-tag func">${ICONS.func} Función</span><span>qué se sabe que hace</span></div>
        <div class="type-row"><span class="type-tag psych">${ICONS.psych} Psicología</span><span>con qué procesos se asocia</span></div>
      </div>
      <button class="btn primary block" data-action="study">${ICONS.study} Poner a prueba lo aprendido</button>
      <p class="muted small">Modelo didáctico aproximado: respeta la topografía general, pero no reproduce un cerebro concreto.</p>
    </div>`;
}

function detail(s, state, app) {
  const hidden = state.hidden.includes(s.id) || app.isHiddenByGroup(s.id);
  const isolated = (state.isolate || []).includes(s.id);
  const parents = STRUCTURES.filter((p) => p.members?.includes(s.id));
  const extra = state.selection.length > 1 ? `<p class="multi-note">+${state.selection.length - 1} estructura(s) más seleccionada(s). Usa «Ocultar selección» o «Aislar selección» en la barra inferior.</p>` : '';
  return `
    <article class="info" aria-labelledby="info-title">
      <header class="info-head">
        <span class="kind-tag">${KIND_LABELS[s.kind]}</span>
        <h2 class="info-title" id="info-title">${s.name}</h2>
        <p class="info-short">${s.short}</p>
        <div class="info-actions">
          <button class="btn" data-action="focus" data-id="${s.id}">${ICONS.focus} Centrar</button>
          <button class="btn" data-action="toggle" data-id="${s.id}" aria-pressed="${hidden}">${hidden ? ICONS.eye + ' Mostrar' : ICONS.eyeOff + ' Ocultar'}</button>
          <button class="btn" data-action="isolate" data-id="${s.id}" aria-pressed="${isolated}">${ICONS.target} ${isolated ? 'Ver todo' : 'Aislar'}</button>
          <button class="icon-btn" data-action="clear" aria-label="Cerrar ficha" title="Cerrar ficha">${ICONS.close}</button>
        </div>
        ${extra}
      </header>

      <section class="info-block anat">
        <h3>${ICONS.anatomy} Ubicación anatómica</h3>
        <p>${s.location}</p>
        ${s.members ? `<p class="sub">Componentes:</p><div class="chips">${s.members.map((m) => `<button class="chip link" data-action="select" data-id="${m}">${STRUCTURE_BY_ID[m].name}</button>`).join('')}</div>` : ''}
        ${parents.length ? `<p class="sub">Forma parte de:</p><div class="chips">${parents.map((p) => `<button class="chip link" data-action="select" data-id="${p.id}">${p.name}</button>`).join('')}</div>` : ''}
      </section>

      <section class="info-block func">
        <h3>${ICONS.func} Función principal</h3>
        <p>${s.function}</p>
        <h4>Funciones relacionadas</h4>
        <ul>${s.relatedFunctions.map((f) => `<li>${f}</li>`).join('')}</ul>
      </section>

      <section class="info-block psych">
        <h3>${ICONS.psych} Relación con procesos psicológicos</h3>
        <p>${s.psychologyRelation}</p>
      </section>

      <section class="info-example">
        <h3>${ICONS.example} Ejemplo</h3>
        <p>${s.example}</p>
      </section>

      ${relatedPathologiesSection(s.id)}

      ${
        s.categories.length
          ? `<section class="info-section">
              <h3>Categorías funcionales</h3>
              <div class="chips">${s.categories.map((c) => `<button class="chip cat" style="--cat:${CATEGORY_BY_ID[c].color}" data-action="category" data-id="${c}">${CATEGORY_BY_ID[c].name}</button>`).join('')}</div>
            </section>`
          : ''
      }

      <section class="info-section">
        <h3>Palabras clave</h3>
        <div class="chips">${s.keywords.map((k) => `<span class="chip">${k}</span>`).join('')}</div>
      </section>

      <p class="info-note">Las funciones cerebrales dependen de redes: las funciones descritas son las principales conocidas, no exclusivas de esta estructura.</p>
    </article>`;
}
