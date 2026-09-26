import { CATEGORIES, CATEGORY_BY_ID } from '../data/categories.js';
import { STRUCTURE_BY_ID } from '../data/structures.js';
import { LOBES, LIMBIC } from '../data/palettes.js';

/** Leyenda de colores del modo de visualización activo. */
export function initLegend(el, app) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) app.select(b.dataset.id, { focus: true, fromList: true });
    const c = e.target.closest('[data-cat]');
    if (c) app.setCategory(c.dataset.cat);
  });
  let last = '';
  return function render(s) {
    const key = `${s.mode}|${s.view}|${s.category}`;
    if (key === last) return;
    last = key;
    let title = '', items = [];
    if (s.mode !== 'explore') items = [];
    else if (s.category) {
      const c = CATEGORY_BY_ID[s.category];
      title = `Función: ${c.name}`;
      items = [{ color: c.color, label: 'Estructuras que participan' }];
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
          .map((i) => `<li><button ${i.id ? `data-id="${i.id}"` : i.cat ? `data-cat="${i.cat}"` : 'disabled'}><span class="lg-dot" style="background:${i.color}"></span>${i.label}</button></li>`)
          .join('')}</ul>${s.view === 'funcional' && !s.category ? '<p>Color según la función principal; la mayoría de estructuras participan en varias.</p>' : ''}`
      : '';
  };
}
