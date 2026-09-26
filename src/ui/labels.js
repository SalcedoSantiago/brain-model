/**
 * Etiqueta 3D conectada a la estructura seleccionada + tooltip de hover.
 * Se dibujan en una capa HTML sobre el lienzo, por lo que nunca quedan ocultas
 * detrás del modelo; la etiqueta se desplaza hacia el exterior del encuadre.
 */
export function initLabels(layer, viewer) {
  layer.innerHTML = `
    <svg class="label-lines" aria-hidden="true"><line /><circle r="4.5" /></svg>
    <div class="label3d" hidden><strong></strong><span></span></div>
    <div class="hover-tip" hidden role="tooltip"></div>`;
  const svg = layer.querySelector('svg');
  const line = svg.querySelector('line');
  const dot = svg.querySelector('circle');
  const box = layer.querySelector('.label3d');
  const tip = layer.querySelector('.hover-tip');
  let anchor = null;

  function update() {
    if (!anchor || !anchor.part.mesh.visible) {
      box.hidden = true;
      svg.style.display = 'none';
      return;
    }
    const world = anchor.local.clone().add(anchor.part.mesh.position);
    const s = viewer.worldToScreen(world);
    const w = layer.clientWidth, h = layer.clientHeight;
    if (s.behind || s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50) {
      box.hidden = true;
      svg.style.display = 'none';
      return;
    }
    box.hidden = false;
    svg.style.display = '';
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let dx = s.x - w / 2, dy = s.y - h / 2;
    const len = Math.hypot(dx, dy);
    if (len < 30) [dx, dy] = [1, -0.7];
    const n = Math.hypot(dx, dy);
    const nx = dx / n, ny = dy / n;
    const reach = Math.min(110, Math.max(60, w * 0.08));
    const right = nx >= 0;
    let left = s.x + nx * reach + (right ? 0 : -bw);
    let top = s.y + ny * reach * 0.8 - bh / 2;
    // Evitar la barra de controles inferior
    const dock = document.querySelector('.controls-dock');
    const layerTop = layer.getBoundingClientRect().top;
    const bottomLimit = dock ? Math.min(h, dock.getBoundingClientRect().top - layerTop - 8) : h - 10;
    left = Math.min(Math.max(left, 10), w - bw - 10);
    top = Math.min(Math.max(top, 10), bottomLimit - bh);
    box.style.transform = `translate(${left}px, ${top}px)`;
    const ex = left + (right ? 0 : bw), ey = top + bh / 2;
    line.setAttribute('x1', s.x);
    line.setAttribute('y1', s.y);
    line.setAttribute('x2', ex);
    line.setAttribute('y2', ey);
    dot.setAttribute('cx', s.x);
    dot.setAttribute('cy', s.y);
  }
  viewer.on('render', update);

  return {
    show(a, title, sub) {
      anchor = a;
      box.querySelector('strong').textContent = title;
      const span = box.querySelector('span');
      span.textContent = sub || '';
      span.hidden = !sub;
      update();
    },
    hide() {
      anchor = null;
      update();
    },
    get anchor() {
      return anchor;
    },
    tip(x, y, text) {
      if (!text) {
        tip.hidden = true;
        return;
      }
      const r = layer.getBoundingClientRect();
      tip.textContent = text;
      tip.hidden = false;
      tip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 16}px)`;
    },
  };
}
