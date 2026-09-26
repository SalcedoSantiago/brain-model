import { AREAS, AREA_LEVELS, LEVEL_BY_ID, areaName } from '../data/areas.js';
import { STRUCTURE_BY_ID } from '../data/structures.js';
import { ICONS } from './icons.js';

const SIDE_LABEL = { L: 'hemisferio izquierdo', R: 'hemisferio derecho' };

/** Pestaña «Áreas»: niveles jerárquicos, filtros y lista de áreas. */
export function initAreaList(pane, app) {
  pane.innerHTML = `
    <p class="pane-intro">La corteza se organiza en niveles de complejidad creciente (Luria). Elige un área o haz clic sobre la corteza en la vista por áreas.</p>
    <div class="level-filters" role="group" aria-label="Niveles visibles">
      ${AREA_LEVELS.map((l) => `<button class="level-chip" data-level="${l.id}" aria-pressed="true" style="--c:${l.color}"><span class="role-dot" style="--c:${l.color}"></span>${l.name.replace('Áreas ', '')}</button>`).join('')}
    </div>
    ${AREA_LEVELS.map(
      (l) => `
      <section class="list-section area-level" style="--c:${l.color}">
        <h3 class="list-title">${l.name} <span class="level-luria">${l.luria}</span></h3>
        <p class="level-desc">${l.description}</p>
        <ul class="area-items">
          ${AREAS.filter((a) => a.level === l.id)
            .map(
              (a) => `<li><button class="area-item" data-area="${a.id}" aria-pressed="false">
                <span class="swatch" style="background:${a.color}"></span>
                <span class="area-name">${a.name}</span>
              </button></li>`
            )
            .join('')}
        </ul>
      </section>`
    ).join('')}
    <div class="luria-laws">
      <h3>Leyes de la organización cortical (Luria)</h3>
      <ul>
        <li><strong>Jerarquía:</strong> la información pasa de las áreas primarias a las secundarias y de estas a las terciarias.</li>
        <li><strong>Especificidad decreciente:</strong> cuanto más alto el nivel, menos ligada está el área a una sola modalidad sensorial.</li>
        <li><strong>Lateralización progresiva:</strong> las diferencias entre hemisferios aumentan en las áreas secundarias y terciarias (por ejemplo, el lenguaje).</li>
      </ul>
      <p class="muted small">Las fronteras del modelo son aproximadas: en el cerebro real los límites entre áreas varían entre personas.</p>
    </div>`;

  pane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (b) return app.selectArea(app.store.get().area === b.dataset.area ? null : b.dataset.area, { focus: true });
    const l = e.target.closest('[data-level]');
    if (l) {
      const levels = app.store.get().areaLevels;
      const next = levels.includes(l.dataset.level) ? levels.filter((x) => x !== l.dataset.level) : [...levels, l.dataset.level];
      app.setAreaLevels(next.length ? next : AREA_LEVELS.map((x) => x.id));
    }
  });

  let last = '';
  return function render(s) {
    const key = `${s.area}|${s.areaLevels.join()}`;
    if (key === last) return;
    last = key;
    pane.querySelectorAll('[data-area]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.area === s.area));
    pane.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', s.areaLevels.includes(b.dataset.level)));
    pane.querySelectorAll('.area-level').forEach((sec, i) => sec.classList.toggle('is-off', !s.areaLevels.includes(AREA_LEVELS[i].id)));
  };
}

/** Ficha de un área cortical (panel derecho). */
export function areaCard(area, side) {
  const level = LEVEL_BY_ID[area.level];
  const lobe = STRUCTURE_BY_ID[area.lobe];
  const isOther = area.lateral && side && side !== area.lateral.side;
  const siblings = AREAS.filter((a) => a.level === area.level && a.id !== area.id);
  return `
    <article class="info area-card" aria-labelledby="area-title">
      <header class="info-head">
        <span class="level-badge" style="--c:${level.color}">${level.singular} · ${level.luria}</span>
        <h2 class="info-title" id="area-title">${areaName(area, side)}</h2>
        <p class="info-short">${area.short}</p>
        <p class="area-meta"><strong>Brodmann:</strong> ${area.brodmann} · <strong>Lóbulo:</strong> <button class="link-btn" data-action="select" data-id="${area.lobe}">${lobe.name}</button>${side ? ` · ${SIDE_LABEL[side]}` : ''}</p>
        <div class="info-actions">
          <button class="btn" data-action="area-focus">${ICONS.focus} Centrar</button>
          <button class="icon-btn" data-action="area-close" aria-label="Cerrar área" title="Cerrar">${ICONS.close}</button>
        </div>
      </header>

      ${area.lateral ? `<p class="evidence-note">${isOther ? area.lateral.otherNote : area.lateral.note}</p>` : ''}

      <section class="info-block anat">
        <h3>${ICONS.anatomy} Ubicación</h3>
        <p>${area.location}</p>
      </section>

      <section class="info-block func">
        <h3>${ICONS.func} Función principal</h3>
        <p>${area.function}</p>
        <h4>Funciones relacionadas</h4>
        <ul>${area.related.map((r) => `<li>${r}</li>`).join('')}</ul>
      </section>

      <section class="info-block lesion">
        <h3>${ICONS.target} Efecto de una lesión</h3>
        <p>${area.lesion}</p>
      </section>

      <section class="info-block psych">
        <h3>${ICONS.psych} Relación con la Psicología</h3>
        <p>${area.psychology}</p>
      </section>

      <section class="info-example">
        <h3>${ICONS.example} Ejemplo</h3>
        <p>${area.example}</p>
      </section>

      <section class="level-box" style="--c:${level.color}">
        <h3>¿Qué es un ${level.singular.toLowerCase()}?</h3>
        <p>${level.description}</p>
        <p><strong>Si se lesiona:</strong> ${level.lesion}</p>
      </section>

      <section class="info-section">
        <h3>Otras ${level.name.toLowerCase()}</h3>
        <div class="chips">${siblings.map((a) => `<button class="chip link" data-action="area" data-id="${a.id}">${a.name}</button>`).join('')}</div>
      </section>

      <section class="info-section">
        <h3>Palabras clave</h3>
        <div class="chips">${area.keywords.map((k) => `<span class="chip">${k}</span>`).join('')}</div>
      </section>

      <p class="info-note">Las fronteras entre áreas del modelo son aproximadas; en el cerebro real varían entre personas y se definen por su estructura celular (citoarquitectura).</p>
    </article>`;
}

