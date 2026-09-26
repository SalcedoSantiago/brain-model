import * as THREE from 'three';

const AXES = [
  { dir: [0, 0, 1], label: 'Ant', name: 'anterior' },
  { dir: [0, 0, -1], label: 'Post', name: 'posterior' },
  { dir: [0, 1, 0.02], label: 'Sup', name: 'superior' },
  { dir: [0, -1, 0.02], label: 'Inf', name: 'inferior' },
  { dir: [-1, 0, 0], label: 'Izq', name: 'izquierda' },
  { dir: [1, 0, 0], label: 'Der', name: 'derecha' },
];

/** Indicador de orientación anatómica; clic en un eje para mirar desde ese lado. */
export function initOrientation(el, viewer) {
  el.innerHTML = `<svg viewBox="-50 -50 100 100" role="group" aria-label="Orientación anatómica">
    ${AXES.map((a, i) => `<g class="axis" data-i="${i}" tabindex="0" role="button" aria-label="Ver desde ${a.name}"><line x1="0" y1="0" /><circle r="11" /><text dy="3.5">${a.label}</text></g>`).join('')}
  </svg>`;
  const groups = [...el.querySelectorAll('.axis')];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();

  viewer.on('render', () => {
    q.copy(viewer.camera.quaternion).invert();
    const items = AXES.map((a, i) => {
      v.set(...a.dir).normalize().applyQuaternion(q);
      return { i, x: v.x * 32, y: -v.y * 32, z: v.z };
    });
    items.sort((a, b) => a.z - b.z);
    const svg = el.firstElementChild;
    for (const it of items) {
      const g = groups[it.i];
      g.querySelector('line').setAttribute('x2', it.x);
      g.querySelector('line').setAttribute('y2', it.y);
      g.querySelector('circle').setAttribute('cx', it.x);
      g.querySelector('circle').setAttribute('cy', it.y);
      g.querySelector('text').setAttribute('x', it.x);
      g.querySelector('text').setAttribute('y', it.y);
      g.classList.toggle('back', it.z < -0.2);
      svg.appendChild(g);
    }
  });

  const go = (g) => viewer.viewFrom(AXES[g.dataset.i].dir, { target: viewer.controls.target.clone(), distance: viewer.camera.position.distanceTo(viewer.controls.target) });
  el.addEventListener('click', (e) => {
    const g = e.target.closest('.axis');
    if (g) go(g);
  });
  el.addEventListener('keydown', (e) => {
    const g = e.target.closest('.axis');
    if (g && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      go(g);
    }
  });
}
