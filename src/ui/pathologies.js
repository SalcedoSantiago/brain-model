import { PATHOLOGIES, PATHOLOGY_TYPES, EVIDENCE_LABELS, pathologiesFor } from '../data/pathologies.js';
import { STRUCTURE_BY_ID } from '../data/structures.js';
import { PATHOLOGY_PRINCIPAL, PATHOLOGY_RELATED } from '../data/palettes.js';
import { ICONS } from './icons.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TYPE_NAME = Object.fromEntries(PATHOLOGY_TYPES.map((t) => [t.id, t.name]));
const SIDE_LABEL = { L: 'hemisferio izquierdo', R: 'hemisferio derecho' };
const principalNames = (p) => p.affected.filter((a) => a.role === 'principal').map((a) => STRUCTURE_BY_ID[a.id].name);

/** Ids de todos los componentes de una estructura (para buscar patologías de grupos). */
export function membersDeep(id) {
  const s = STRUCTURE_BY_ID[id];
  return (s?.members || []).flatMap((m) => [m, ...membersDeep(m)]);
}

/** Pestaña «Patologías» del panel izquierdo: buscador, filtros y lista agrupada. */
export function initPathologyList(pane, app) {
  const structureIds = [...new Set(PATHOLOGIES.flatMap((p) => p.affected.map((a) => a.id)))].sort((a, b) => STRUCTURE_BY_ID[a].name.localeCompare(STRUCTURE_BY_ID[b].name, 'es'));
  pane.innerHTML = `
    <p class="pane-intro">Elige una patología para ver en el modelo qué estructuras se afectan: <span class="role-dot" style="--c:${PATHOLOGY_PRINCIPAL}"></span> principal · <span class="role-dot" style="--c:${PATHOLOGY_RELATED}"></span> relacionada.</p>
    <label class="search">
      ${ICONS.search}
      <input type="search" name="q" placeholder="Buscar patología o síntoma" aria-label="Buscar patología" autocomplete="off" />
    </label>
    <div class="patho-filters">
      <label class="field compact">
        <span>Estructura afectada</span>
        <select name="structure">
          <option value="">Todas las estructuras</option>
          ${structureIds.map((id) => `<option value="${id}">${STRUCTURE_BY_ID[id].name}</option>`).join('')}
        </select>
      </label>
      <label class="field compact">
        <span>Tipo</span>
        <select name="type">
          <option value="">Todos los tipos</option>
          ${PATHOLOGY_TYPES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="patho-list"></div>
    <p class="muted small patho-disclaimer">Contenido educativo: no sirve para diagnosticar ni sustituye una evaluación profesional.</p>`;

  const list = pane.querySelector('.patho-list');
  const q = pane.querySelector('[name=q]');
  const fStructure = pane.querySelector('[name=structure]');
  const fType = pane.querySelector('[name=type]');

  function renderList() {
    const text = norm(q.value.trim());
    const sid = fStructure.value;
    const type = fType.value;
    const matches = PATHOLOGIES.filter((p) => {
      if (type && p.type !== type) return false;
      if (sid && !pathologiesFor(sid, membersDeep).includes(p)) return false;
      if (!text) return true;
      return norm([p.name, p.summary, ...p.keywords, ...p.symptoms, TYPE_NAME[p.type]].join(' ')).includes(text);
    });
    const active = app.store.get().pathology;
    list.innerHTML = matches.length
      ? PATHOLOGY_TYPES.filter((t) => matches.some((p) => p.type === t.id))
          .map(
            (t) => `
          <section class="list-section">
            <h3 class="list-title">${t.name}</h3>
            <ul class="patho-items">
              ${matches
                .filter((p) => p.type === t.id)
                .map(
                  (p) => `
                <li><button class="patho-item" data-patho="${p.id}" aria-pressed="${p.id === active}">
                  <span class="patho-name">${p.name}</span>
                  <span class="patho-sub">${principalNames(p).join(' · ')}</span>
                  ${p.evidence === 'asociacion' ? '<span class="evidence-mini" title="Alteraciones asociadas en estudios, no una lesión única">asociación</span>' : ''}
                </button></li>`
                )
                .join('')}
            </ul>
          </section>`
          )
          .join('')
      : '<p class="muted small">No hay patologías que coincidan con los filtros.</p>';
  }

  q.addEventListener('input', renderList);
  fStructure.addEventListener('change', renderList);
  fType.addEventListener('change', renderList);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-patho]');
    if (b) app.setPathology(app.store.get().pathology === b.dataset.patho ? null : b.dataset.patho);
  });
  /** Permite abrir la pestaña ya filtrada por una estructura. */
  app.filterPathologiesBy = (id) => {
    fStructure.value = structureIds.includes(id) ? id : '';
    renderList();
  };
  renderList();

  let last;
  return function render(s) {
    if (s.pathology === last) return;
    last = s.pathology;
    list.querySelectorAll('[data-patho]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.patho === s.pathology));
  };
}

/** Ficha de una patología (panel derecho). */
export function pathologyCard(p) {
  const affected = [...p.affected].sort((a, b) => (a.role === b.role ? 0 : a.role === 'principal' ? -1 : 1));
  return `
    <article class="info patho-card" aria-labelledby="patho-title">
      <header class="info-head">
        <span class="kind-tag">${TYPE_NAME[p.type]}</span>
        <h2 class="info-title" id="patho-title">${p.name}</h2>
        <p class="info-short">${p.summary}</p>
        <span class="evidence ${p.evidence}">${p.evidence === 'lesion' ? ICONS.anatomy : ICONS.func} ${EVIDENCE_LABELS[p.evidence]}</span>
        <div class="info-actions">
          <button class="btn" data-action="patho-focus">${ICONS.focus} Ver en el modelo</button>
          <button class="icon-btn" data-action="patho-close" aria-label="Cerrar patología" title="Cerrar">${ICONS.close}</button>
        </div>
      </header>

      ${
        p.evidence === 'asociacion'
          ? `<p class="evidence-note">Las estructuras resaltadas muestran <strong>alteraciones asociadas</strong> en estudios con grupos de personas. No son una lesión que cause el trastorno, y la neuroimagen no permite diagnosticarlo en una persona concreta.</p>`
          : ''
      }

      <section class="info-section">
        <h3>Estructuras afectadas</h3>
        <ul class="affected">
          ${affected
            .map(
              (a) => `
            <li class="affected-item">
              <span class="role-dot" style="--c:${a.role === 'principal' ? PATHOLOGY_PRINCIPAL : PATHOLOGY_RELATED}" aria-hidden="true"></span>
              <div>
                <div class="affected-head">
                  <button class="link-btn" data-action="patho-structure" data-id="${a.id}" title="Encuadrar en el modelo">${STRUCTURE_BY_ID[a.id].name}</button>
                  <span class="role-tag ${a.role}">${a.role === 'principal' ? 'Principal' : 'Relacionada'}${a.side ? ` · ${SIDE_LABEL[a.side]}` : ''}</span>
                  <button class="text-btn small" data-action="select" data-id="${a.id}">Ficha</button>
                </div>
                <p>${a.note}</p>
              </div>
            </li>`
            )
            .join('')}
        </ul>
      </section>

      <section class="info-block anat">
        <h3>${ICONS.anatomy} Causa y mecanismo</h3>
        <p>${p.mechanism}</p>
      </section>

      <section class="info-block func">
        <h3>${ICONS.func} Manifestaciones principales</h3>
        <ul>${p.symptoms.map((s) => `<li>${s}</li>`).join('')}</ul>
      </section>

      <section class="info-block psych">
        <h3>${ICONS.psych} Relevancia para la Psicología</h3>
        <p>${p.psychology}</p>
      </section>

      <section class="info-example">
        <h3>${ICONS.example} Ejemplo</h3>
        <p>${p.example}</p>
      </section>

      <section class="info-section">
        <h3>Palabras clave</h3>
        <div class="chips">${p.keywords.map((k) => `<span class="chip">${k}</span>`).join('')}</div>
      </section>

      <p class="info-note">Contenido educativo simplificado. Los síntomas varían entre personas y no sirven para diagnosticar; ante cualquier duda, consulta a un profesional sanitario.</p>
    </article>`;
}

/** Sección «Patologías relacionadas» para la ficha de una estructura. */
export function relatedPathologiesSection(structureId) {
  const list = pathologiesFor(structureId, membersDeep);
  if (!list.length) return '';
  const roleIn = (p) => {
    const ids = new Set([structureId, ...membersDeep(structureId)]);
    return p.affected.some((a) => ids.has(a.id) && a.role === 'principal') ? 'principal' : 'relacionada';
  };
  return `
    <section class="info-section">
      <h3>Patologías relacionadas</h3>
      <div class="chips">
        ${list
          .sort((a, b) => (roleIn(a) === roleIn(b) ? a.name.localeCompare(b.name, 'es') : roleIn(a) === 'principal' ? -1 : 1))
          .map((p) => `<button class="chip patho" style="--c:${roleIn(p) === 'principal' ? PATHOLOGY_PRINCIPAL : PATHOLOGY_RELATED}" data-action="pathology" data-id="${p.id}">${p.name}</button>`)
          .join('')}
      </div>
      <p class="muted small">Rojo: esta estructura es una de las principalmente afectadas. Ámbar: afectación relacionada.</p>
    </section>`;
}

