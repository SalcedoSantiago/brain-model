/** Almacén de estado mínimo con suscripción. */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      subs.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const INITIAL_STATE = {
  mode: 'explore', // explore | study
  view: 'anatomica', // anatomica | lobulos | areas | interna | limbica | funcional | explodida
  selection: [], // ids seleccionados (el primero es el principal)
  hidden: [], // ids ocultos (estructuras o grupos)
  isolate: null, // ids aislados o null
  category: null, // categoría funcional resaltada
  pathology: null, // patología resaltada
  area: null, // área cortical seleccionada (vista por áreas)
  areaSide: null, // hemisferio del área seleccionada ('L' | 'R')
  areaReveal: [], // lóbulos ocultados temporalmente para ver un área
  areaLevels: ['primaria', 'secundaria', 'terciaria', 'paralimbica'], // niveles visibles
  hemisphere: 'both', // both | L | R
  explode: 0, // 0..1
  dragMode: false, // arrastrar piezas para desarmar
  depth: 0, // 0..1: capas externas que se retiran en la vista interna
  section: { enabled: false, axis: 'x', value: 0.5, flip: false },
  xray: true, // transparencia automática al seleccionar estructuras profundas
  autoRotate: false,
  quiz: null, // estado del modo Estudiar
};
