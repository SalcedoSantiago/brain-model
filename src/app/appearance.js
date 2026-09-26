import { STRUCTURE_BY_ID } from '../data/structures.js';
import { CATEGORY_BY_ID } from '../data/categories.js';
import { NATURAL, LOBES, LIMBIC, GHOST_COLOR, NEUTRAL } from '../data/palettes.js';

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const mix = (a, b, t) => a + (b - a) * t;
const GHOST = 0.09;

/** Color de una estructura según el modo de visualización. */
export function colorFor(id, view) {
  if (view === 'lobulos') return LOBES[id] || NATURAL[id] || NEUTRAL;
  if (view === 'funcional') {
    const cat = STRUCTURE_BY_ID[id]?.categories?.[0];
    return cat ? CATEGORY_BY_ID[cat].color : NEUTRAL;
  }
  if (view === 'limbica') return LIMBIC[id] || NATURAL[id] || NEUTRAL;
  return NATURAL[id] || NEUTRAL;
}

/**
 * Traduce el estado de la app al aspecto de cada pieza 3D.
 * Devuelve una función part → { opacity, color, emissive, outline, clip, pickable }.
 */
export function buildAppearance(state, { partsOf, parts }) {
  if (state.mode === 'study') return buildStudyAppearance(state, partsOf);

  const hidden = new Set(state.hidden.flatMap(partsOf));
  const isolated = state.isolate ? new Set(state.isolate.flatMap(partsOf)) : null;
  const selected = new Set(state.selection.flatMap(partsOf));
  const category = state.category ? CATEGORY_BY_ID[state.category] : null;
  const limbic = new Set(STRUCTURE_BY_ID.sistema_limbico.members);
  const deepSelected = [...selected].some((p) => p.layer === 'deep');
  const isMember = (id) => !!category && !!STRUCTURE_BY_ID[id]?.categories?.includes(category.id);
  // Si la función incluye estructuras profundas, la corteza implicada se muestra translúcida
  const categoryHasDeep = !!category && parts.some((p) => p.layer === 'deep' && isMember(p.id));
  const d = state.depth;

  return (part) => {
    let color = colorFor(part.id, state.view);
    let opacity = 1;

    // Vista interna: la corteza se retira primero y después la sustancia blanca
    if (part.layer === 'cortex') opacity = mix(1, GHOST * 0.7, clamp01(d / 0.5));
    if (part.layer === 'white') opacity = d <= 0.5 ? 1 : mix(1, 0, clamp01((d - 0.5) / 0.4));

    if (state.view === 'limbica' && !limbic.has(part.id)) {
      opacity = Math.min(opacity, GHOST);
      color = GHOST_COLOR;
    }
    if (category) {
      if (isMember(part.id)) {
        color = category.color;
        const outer = part.layer === 'cortex' || part.layer === 'white';
        opacity = outer && categoryHasDeep ? 0.18 : Math.max(opacity, 0.4);
        if (!outer) opacity = 1;
      } else {
        opacity = Math.min(opacity, GHOST);
        color = GHOST_COLOR;
      }
    }
    // Al desarmar, la sustancia blanca queda translúcida para no tapar las piezas profundas
    if (part.layer === 'white' && state.explode > 0.2 && !selected.has(part)) opacity = Math.min(opacity, 0.16);
    // Rayos X: al seleccionar algo profundo, las capas externas se vuelven translúcidas
    if (state.xray && deepSelected && !selected.has(part) && (part.layer === 'cortex' || part.layer === 'white')) {
      opacity = Math.min(opacity, part.layer === 'cortex' ? GHOST : GHOST * 0.8);
    }

    const isSelected = selected.has(part);
    if (isSelected) opacity = 1;

    let visible = !hidden.has(part) && (!isolated || isolated.has(part));
    if (state.hemisphere === 'L' && part.side === 'R') visible = false;
    if (state.hemisphere === 'R' && part.side === 'L') visible = false;
    if (!visible) opacity = 0;

    return {
      opacity,
      color,
      emissive: isSelected ? 0.2 : 0,
      outline: isSelected && visible,
      pickable: opacity > 0.5,
      clip: state.hemisphere !== 'both' && part.side === 'C' ? state.hemisphere : null,
    };
  };
}

/** Modo Estudiar: la estructura preguntada se resalta; el resto da contexto. */
function buildStudyAppearance(state, partsOf) {
  const q = state.quiz;
  const target = new Set(q?.current ? partsOf(q.current) : []);
  const deep = [...target].some((p) => p.layer === 'deep');
  return (part) => {
    const isTarget = target.has(part);
    let opacity = 1;
    if (deep && !isTarget && (part.layer === 'cortex' || part.layer === 'white')) opacity = GHOST;
    if (!deep && part.layer === 'white') opacity = 0;
    if (state.hemisphere === 'L' && part.side === 'R') opacity = 0;
    if (state.hemisphere === 'R' && part.side === 'L') opacity = 0;
    return {
      opacity,
      color: isTarget ? '#f0a53a' : NATURAL[part.id] || NEUTRAL,
      emissive: isTarget ? 0.12 : 0,
      outline: isTarget && opacity > 0,
      pickable: false,
      clip: state.hemisphere !== 'both' && part.side === 'C' ? state.hemisphere : null,
    };
  };
}
