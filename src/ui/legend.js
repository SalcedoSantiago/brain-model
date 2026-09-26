import { CATEGORIES, CATEGORY_BY_ID } from '../data/categories.js';
import { STRUCTURE_BY_ID } from '../data/structures.js';
import { LOBES, LIMBIC, PATHOLOGY_PRINCIPAL, PATHOLOGY_RELATED } from '../data/palettes.js';
import { PATHOLOGY_BY_ID } from '../data/pathologies.js';
import { AREA_LEVELS } from '../data/areas.js';

/** Leyenda de colores del modo de visualización activo. */
export function initLegend(el, app) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) app.select(b.dataset.id, { focus: true, fromList: true });
    const c = e.target.closest('[data-cat]');
    if (c) app.setCategory(c.dataset.cat);
    const l = e.target.closest('[data-level]');
    if (l) {
      // Mostrar u ocultar un nivel (siempre queda al menos uno visible)
      const levels = app.store.get().areaLevels;
      const next = levels.includes(l.dataset.level) ? levels.filter((x) => x !== l.dataset.level) : [...levels, l.dataset.level];
      if (next.length) app.setAreaLevels(next);
    }
  });
  let last = '';
  return function render(s) {
    const key = `${s.mode}|${s.view}|${s.category}|${s.pathology}|${s.areaLevels.join()}`;
    if (key === last) return;
    last = key;
    let title = '', items = [];
    if (s.mode !== 'explore') items = [];
    else if (s.pathology) {
      title = PATHOLOGY_BY_ID[s.pathology].name;
      items = [
        { color: PATHOLOGY_PRINCIPAL, label: 'Afectación principal' },
        { color: PATHOLOGY_RELATED, label: 'Afectación relacionada' },
      ];
    } else if (s.category) {
      const c = CATEGORY_BY_ID[s.category];
      title = `Función: ${c.name}`;
      items = [{ color: c.color, label: 'Estructuras que participan' }];
    } else if (s.view === 'areas') {
      title = 'Áreas corticales';
      items = AREA_LEVELS.map((l) => ({ level: l.id, color: l.color, label: l.name, off: !s.areaLevels.includes(l.id) }));
    } else if (s.view === 'lobulos') {
      title = 'Lóbulos';
      items = Object.entries(LOBES).map(([id, color]) => ({ id, color, label: STRUCTURE_BY_ID[id].name }));
    } else if (s.view === 'limbica') {
      title = 'Sistema límbico';
      items = Object.entries(LIMBIC).map(([id, color]) => ({ id, color, label: STRUCTURE_BY_ID[id].name }));
    } else if (s.view === 'funcional') {
      title = 'Función principal';
      items = CATEGORIES.map((c) => ({ cat: c.id, color: c.color, label: c.name }));
    }
    el.hidden = !items.length;
    el.innerHTML = items.length
      ? `<h3>${title}</h3><ul>${items
          .map((i) => `<li><button ${i.id ? `data-id="${i.id}"` : i.cat ? `data-cat="${i.cat}"` : i.level ? `data-level="${i.level}"${i.off ? ' class="is-off"' : ''}` : 'disabled'}><span class="lg-dot" style="background:${i.color}"></span>${i.label}</button></li>`)
          .join('')}</ul>${s.view === 'areas' && !s.pathology && !s.category ? '<p>Haz clic en la corteza para ver cada área. Los bordes oscuros marcan los límites.</p>' : ''}${s.view === 'funcional' && !s.category && !s.pathology ? '<p>Color según la función principal; la mayoría de estructuras participan en varias.</p>' : ''}`
      : '';
  };
}
