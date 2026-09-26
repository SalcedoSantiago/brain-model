import { ICONS } from './icons.js';

const DEG = Math.PI / 180;

/** Barra inferior de controles 3D + bandeja contextual con deslizadores. */
export function initToolbar(root, app) {
  const presets = app.viewer.config.cameraPresets;
  const btn = (act, icon, label, extra = '') => `<button class="tool" data-act="${act}" aria-label="${label}" ${extra}>${ICONS[icon]}<span aria-hidden="true">${label}</span></button>`;

  root.innerHTML = `
    <div class="tray" hidden></div>
    <div class="toolbar" role="toolbar" aria-label="Controles del modelo 3D">
      <div class="tool-group" aria-label="Rotar">
        <div class="dpad">
          <button class="tool mini" data-act="rot-left" aria-label="Rotar a la izquierda" title="Rotar a la izquierda (←)">${ICONS.left}</button>
          <div class="dpad-col">
            <button class="tool mini" data-act="rot-up" aria-label="Rotar hacia arriba" title="Rotar hacia arriba (↑)">${ICONS.up}</button>
            <button class="tool mini" data-act="rot-down" aria-label="Rotar hacia abajo" title="Rotar hacia abajo (↓)">${ICONS.down}</button>
          </div>
          <button class="tool mini" data-act="rot-right" aria-label="Rotar a la derecha" title="Rotar a la derecha (→)">${ICONS.right}</button>
        </div>
        ${btn('auto', 'rotate', 'Girar', 'aria-pressed="false" title="Rotación automática"')}
      </div>
      <div class="tool-group" aria-label="Zoom">
        ${btn('zoom-out', 'zoomOut', 'Alejar', 'title="Alejar (−)"')}
        ${btn('zoom-in', 'zoomIn', 'Acercar', 'title="Acercar (+)"')}
      </div>
      <div class="tool-group">
        <div class="menu-wrap">
          ${btn('views', 'camera', 'Vistas', 'aria-haspopup="menu" aria-expanded="false" title="Ver desde distintos ángulos"')}
          <div class="menu" role="menu" hidden>
            ${Object.entries(presets).map(([k, p]) => `<button role="menuitem" data-preset="${k}">${p.label}</button>`).join('')}
          </div>
        </div>
        ${btn('reset', 'reset', 'Restablecer', 'title="Restablecer vista y piezas (R)"')}
      </div>
      <div class="tool-group explore-only">
        ${btn('show-all', 'showAll', 'Mostrar todo', 'title="Mostrar todas las estructuras"')}
        ${btn('hide-sel', 'eyeOff', 'Ocultar selección', 'title="Ocultar lo seleccionado (H)"')}
        ${btn('isolate-sel', 'target', 'Aislar selección', 'title="Mostrar solo lo seleccionado (I)"')}
      </div>
      <div class="tool-group explore-only">
        <div class="seg" role="group" aria-label="Capas">
          <button data-act="external" aria-pressed="true">Externa</button>
          <button data-act="internal" aria-pressed="false">Interna</button>
        </div>
        ${btn('section', 'scissors', 'Corte', 'aria-pressed="false" title="Plano de corte"')}
      </div>
      <div class="tool-group accent explore-only">
        ${btn('explode', 'explode', 'Desarmar', 'aria-pressed="false" title="Separar las piezas"')}
        ${btn('drag', 'hand', 'Mover piezas', 'aria-pressed="false" title="Arrastra una estructura para sacarla"')}
      </div>
      <div class="tool-group explore-only">
        <div class="seg" role="group" aria-label="Hemisferio">
          <button data-hemi="both" aria-pressed="true">Ambos</button>
          <button data-hemi="L" aria-pressed="false" title="Hemisferio izquierdo">Izq.</button>
          <button data-hemi="R" aria-pressed="false" title="Hemisferio derecho">Der.</button>
        </div>
      </div>
    </div>`;

  const menu = root.querySelector('.menu');
  const menuBtn = root.querySelector('[data-act=views]');
  const closeMenu = () => {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) closeMenu();
  });

  root.querySelector('.toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = app.store.get();
    const v = app.viewer;
    if (b.dataset.preset) {
      closeMenu();
      return app.applyPreset(b.dataset.preset);
    }
    if (b.dataset.hemi) return app.setHemisphere(b.dataset.hemi);
    switch (b.dataset.act) {
      case 'rot-left': return v.orbit(-20 * DEG, 0);
      case 'rot-right': return v.orbit(20 * DEG, 0);
      case 'rot-up': return v.orbit(0, -15 * DEG);
      case 'rot-down': return v.orbit(0, 15 * DEG);
      case 'auto': return app.store.set({ autoRotate: !s.autoRotate });
      case 'zoom-in': return v.zoom(0.78);
      case 'zoom-out': return v.zoom(1.28);
      case 'views': {
        const open = menu.hidden;
        menu.hidden = !open;
        menuBtn.setAttribute('aria-expanded', open);
        if (open) menu.querySelector('button').focus();
        return;
      }
      case 'reset': return app.resetAll();
      case 'show-all': return app.showAll();
      case 'hide-sel': return app.hideSelection();
      case 'isolate-sel': return app.isolateSelection();
      case 'external': return app.setDepth(0);
      case 'internal': return app.setDepth(s.depth > 0 ? s.depth : 0.75);
      case 'section': return app.setSection({ enabled: !s.section.enabled });
      case 'explode': return app.setExplode(s.explode > 0 ? 0 : 1);
      case 'drag': return app.setDragMode(!s.dragMode);
    }
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    if (e.key === 'Escape') {
      closeMenu();
      menuBtn.focus();
    }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) e.preventDefault();
  });

  // ---------------------------------------------------------------- bandeja contextual
  const tray = root.querySelector('.tray');
  tray.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'explode') app.setExplode(t.value / 100, { keepView: true });
    if (t.name === 'depth') app.setDepth(t.value / 100);
    if (t.name === 'section') app.setSection({ value: t.value / 100 });
  });
  tray.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.axis) app.setSection({ axis: b.dataset.axis, value: b.dataset.axis === 'x' ? 0.5 : 0.55 });
    if (b.dataset.act === 'flip') app.setSection({ flip: !app.store.get().section.flip });
    if (b.dataset.act === 'reassemble') app.reassemble();
    if (b.dataset.act === 'drag') app.setDragMode(!app.store.get().dragMode);
    if (b.dataset.act === 'close-section') app.setSection({ enabled: false });
  });

  let trayKey = '';
  return function render(s) {
    const set = (sel, on) => root.querySelector(sel)?.setAttribute('aria-pressed', on);
    set('[data-act=auto]', s.autoRotate);
    set('[data-act=external]', s.depth === 0);
    set('[data-act=internal]', s.depth > 0);
    set('[data-act=section]', s.section.enabled);
    set('[data-act=explode]', s.explode > 0);
    set('[data-act=drag]', s.dragMode);
    root.querySelectorAll('[data-hemi]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.hemi === s.hemisphere));
    const noSel = !s.selection.length;
    root.querySelector('[data-act=hide-sel]').disabled = noSel;
    root.querySelector('[data-act=isolate-sel]').disabled = noSel;
    root.querySelector('.toolbar').classList.toggle('is-study', s.mode === 'study');

    // Bandeja: solo se reconstruye cuando cambia su estructura
    const showExplode = s.explode > 0 || s.dragMode;
    const showDepth = s.depth > 0;
    const showSection = s.section.enabled;
    const key = [showExplode, showDepth, showSection, s.section.axis, s.dragMode, s.mode].join('|');
    if (key !== trayKey) {
      trayKey = key;
      const blocks = [];
      if (s.mode === 'explore' && showExplode)
        blocks.push(`
          <div class="tray-block">
            <label class="slider"><span>Separación</span><input type="range" name="explode" min="0" max="100" value="${Math.round(s.explode * 100)}" aria-label="Separación de las piezas" /></label>
            <button class="btn sm ${s.dragMode ? 'on' : ''}" data-act="drag" aria-pressed="${s.dragMode}">${ICONS.hand} Mover piezas</button>
            <button class="btn sm" data-act="reassemble">${ICONS.assemble} Rearmar</button>
            <span class="tray-hint">${s.dragMode ? 'Arrastra cualquier estructura para sacarla del cerebro.' : 'Activa «Mover piezas» para sacarlas una a una.'}</span>
          </div>`);
      if (showDepth)
        blocks.push(`
          <div class="tray-block">
            <label class="slider"><span>Profundidad</span><input type="range" name="depth" min="0" max="100" value="${Math.round(s.depth * 100)}" aria-label="Profundidad de la vista interna" /></label>
            <span class="tray-scale"><span>Corteza</span><span>Sust. blanca</span><span>Profundas</span></span>
          </div>`);
      if (showSection)
        blocks.push(`
          <div class="tray-block">
            <div class="seg sm" role="group" aria-label="Plano de corte">
              <button data-axis="x" aria-pressed="${s.section.axis === 'x'}">Sagital</button>
              <button data-axis="z" aria-pressed="${s.section.axis === 'z'}">Coronal</button>
              <button data-axis="y" aria-pressed="${s.section.axis === 'y'}">Axial</button>
            </div>
            <label class="slider"><span>Posición</span><input type="range" name="section" min="0" max="100" value="${Math.round(s.section.value * 100)}" aria-label="Posición del plano de corte" /></label>
            <button class="icon-btn" data-act="flip" aria-label="Invertir el lado del corte" title="Invertir lado">${ICONS.flip}</button>
            <button class="icon-btn" data-act="close-section" aria-label="Quitar corte" title="Quitar corte">${ICONS.close}</button>
          </div>`);
      tray.innerHTML = blocks.join('');
      tray.hidden = !blocks.length;
    }
    const ex = tray.querySelector('input[name=explode]');
    if (ex && document.activeElement !== ex) ex.value = Math.round(s.explode * 100);
    const dp = tray.querySelector('input[name=depth]');
    if (dp && document.activeElement !== dp) dp.value = Math.round(s.depth * 100);
    const sc = tray.querySelector('input[name=section]');
    if (sc && document.activeElement !== sc) sc.value = Math.round(s.section.value * 100);
  };
}
