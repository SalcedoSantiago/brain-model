import { STRUCTURES, STRUCTURE_BY_ID, PRACTICE_SETS } from '../data/structures.js';
import { CATEGORIES } from '../data/categories.js';
import { PATHOLOGIES, PATHOLOGY_BY_ID } from '../data/pathologies.js';
import { ICONS } from './icons.js';

const QUIZ_IDS = STRUCTURES.filter((s) => s.quiz).map((s) => s.id);

/** Conjuntos de práctica: los fijos + uno por categoría funcional con suficientes estructuras. */
export const ALL_SETS = [
  ...PRACTICE_SETS,
  { id: 'patologias', name: 'Patologías: ¿qué estructura se afecta?', kind: 'pathology', ids: [] },
  ...CATEGORIES.map((c) => ({ id: `cat:${c.id}`, name: `Practicar ${c.name.toLowerCase()}`, ids: QUIZ_IDS.filter((id) => STRUCTURE_BY_ID[id].categories.includes(c.id)) })).filter((s) => s.ids.length >= 2),
];

const shuffle = (a) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const quizPrincipals = (p) => p.affected.filter((a) => a.role === 'principal' && QUIZ_IDS.includes(a.id)).map((a) => a.id);

/** Nueva pregunta; `prev` es la pregunta anterior (para no repetirla). */
export function newQuestion(setId, prev = {}) {
  const set = ALL_SETS.find((s) => s.id === setId) || ALL_SETS[0];
  if (set.kind === 'pathology') {
    const eligible = PATHOLOGIES.filter((p) => quizPrincipals(p).length);
    const pool = eligible.filter((p) => p.id !== prev.pathology);
    const pathology = pick(pool.length ? pool : eligible);
    const current = pick(quizPrincipals(pathology));
    // Los distractores no pueden ser estructuras implicadas en la patología
    const involved = new Set(pathology.affected.map((a) => a.id));
    const distractors = shuffle(QUIZ_IDS.filter((id) => !involved.has(id))).slice(0, 3);
    return { kind: 'pathology', pathology: pathology.id, current, options: shuffle([current, ...distractors]), answer: null };
  }
  const previous = prev.kind === 'pathology' ? null : prev.current;
  const pool = set.ids.length > 1 ? set.ids.filter((id) => id !== previous) : set.ids;
  const current = pool[Math.floor(Math.random() * pool.length)];
  // Distractores: primero del mismo conjunto, luego del resto de estructuras
  const same = shuffle(set.ids.filter((id) => id !== current));
  const rest = shuffle(QUIZ_IDS.filter((id) => id !== current && !set.ids.includes(id)));
  const options = shuffle([current, ...[...same, ...rest].slice(0, 3)]);
  return { kind: 'structure', current, options, answer: null };
}

/** Panel del modo Estudiar. */
export function initQuiz(root, app) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const q = app.store.get().quiz;
    if (b.dataset.option && !q.answer) {
      const correct = b.dataset.option === q.current;
      app.store.set({ quiz: { ...q, answer: b.dataset.option, score: { right: q.score.right + (correct ? 1 : 0), total: q.score.total + 1 } } });
      app.onQuizAnswered();
    }
    if (b.dataset.act === 'next') app.nextQuestion();
    if (b.dataset.act === 'exit') app.setMode('explore');
    if (b.dataset.act === 'focus') app.focusQuizTarget();
    if (b.dataset.act === 'open-pathology') {
      app.setMode('explore');
      app.setPathology(q.pathology);
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.name === 'set') app.nextQuestion(e.target.value, true);
  });

  let lastKey = '';
  return function render(s) {
    if (s.mode !== 'study' || !s.quiz) return;
    const q = s.quiz;
    const key = `${q.set}|${q.pathology}|${q.current}|${q.answer}|${q.score.total}`;
    if (key === lastKey) return;
    lastKey = key;
    const target = STRUCTURE_BY_ID[q.current];
    const correct = q.answer === q.current;
    const patho = q.kind === 'pathology' ? PATHOLOGY_BY_ID[q.pathology] : null;
    root.innerHTML = `
      <div class="quiz">
        <div class="quiz-head">
          <h2 class="info-title">${ICONS.study} Estudiar</h2>
          <button class="text-btn" data-act="exit">Volver a explorar</button>
        </div>
        <label class="field">
          <span>Tema de práctica</span>
          <select name="set">${ALL_SETS.map((set) => `<option value="${set.id}" ${set.id === q.set ? 'selected' : ''}>${set.name}</option>`).join('')}</select>
        </label>
        <div class="score" aria-live="polite">
          <span><strong>${q.score.right}</strong> / ${q.score.total} aciertos</span>
          <span class="score-bar"><span style="width:${q.score.total ? (q.score.right / q.score.total) * 100 : 0}%"></span></span>
        </div>
        ${
          patho
            ? `<p class="quiz-question">¿Qué estructura se afecta principalmente en: ${patho.name}?</p>
               <p class="quiz-clue">${patho.summary}</p>
               <p class="muted small">Pista: ${patho.symptoms[0].charAt(0).toLowerCase() + patho.symptoms[0].slice(1)}.</p>`
            : `<p class="quiz-question">¿Qué estructura es esta?</p>
               <p class="muted small">La estructura aparece resaltada en naranja. Puedes rotar y hacer zoom para observarla. <button class="link-btn" data-act="focus">Volver a encuadrarla</button></p>`
        }
        <div class="options" role="group" aria-label="Opciones de respuesta">
          ${q.options
            .map((id) => {
              let cls = '';
              if (q.answer) cls = id === q.current ? 'correct' : id === q.answer ? 'wrong' : 'dim';
              return `<button class="option ${cls}" data-option="${id}" ${q.answer ? 'aria-disabled="true"' : ''}>
                <span>${STRUCTURE_BY_ID[id].name}</span>${q.answer && id === q.current ? ICONS.check : q.answer && id === q.answer ? ICONS.x : ''}
              </button>`;
            })
            .join('')}
        </div>
        ${
          q.answer
            ? patho
              ? pathologyFeedback(patho, target, correct)
              : `<div class="feedback ${correct ? 'ok' : 'ko'}" role="status">
                <p class="feedback-title">${correct ? '¡Correcto!' : `No es correcto. Es: <strong>${target.name}</strong>`}</p>
                <h3>${ICONS.anatomy} Explicación</h3>
                <p>${target.location}</p>
                <h3>${ICONS.func} Función principal</h3>
                <p>${target.function}</p>
                <h3>${ICONS.psych} Relación psicológica</h3>
                <p>${target.psychologyRelation}</p>
              </div>
              <button class="btn primary block" data-act="next">Siguiente estructura ${ICONS.right}</button>`
            : ''
        }
      </div>`;
    if (q.answer) root.querySelector('[data-act=next]').focus({ preventScroll: false });
    else root.scrollTop = 0;
  };
}

function pathologyFeedback(p, target, correct) {
  const main = p.affected.find((a) => a.id === target.id);
  const others = p.affected.filter((a) => a.id !== target.id).map((a) => `${STRUCTURE_BY_ID[a.id].name} (${a.role})`);
  return `<div class="feedback ${correct ? 'ok' : 'ko'}" role="status">
      <p class="feedback-title">${correct ? '¡Correcto!' : `No es correcto. Es: <strong>${target.name}</strong>`}</p>
      <h3>${ICONS.anatomy} Por qué</h3>
      <p>${main.note}</p>
      <h3>${ICONS.func} Mecanismo</h3>
      <p>${p.mechanism}</p>
      ${others.length ? `<h3>${ICONS.target} También implicadas</h3><p>${others.join(', ')}.</p>` : ''}
      <p class="muted small">En el modelo: rojo = afectación principal, ámbar = relacionada.</p>
      <button class="link-btn" data-act="open-pathology">Ver la ficha completa de la patología</button>
    </div>
    <button class="btn primary block" data-act="next">Siguiente pregunta ${ICONS.right}</button>`;
}
