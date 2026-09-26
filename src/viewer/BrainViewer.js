import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Visor 3D del encéfalo. No conoce el contenido educativo: trabaja con
 * "partes" (una malla por estructura y lado) y recibe desde fuera el aspecto
 * que debe tener cada una (setAppearance).
 */
export class BrainViewer {
  constructor(container, config) {
    this.container = container;
    this.config = config;
    this.listeners = {};
    this.parts = [];
    this.partsById = new Map();
    this.unitScale = 1;
    this.explodeAmount = 0;
    this.explodeTarget = 0;
    this.needsRender = true;
    this.animating = false;
    this.cameraAnim = null;
    this.selectionColor = new THREE.Color('#0e9fb3');

    // Renderer
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.className = 'viewer-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-roledescription', 'modelo 3D interactivo');
    canvas.setAttribute('aria-label', 'Modelo 3D del encéfalo. Arrastra para rotar, rueda o pellizco para hacer zoom, clic para seleccionar. Con el teclado: flechas para rotar, + y − para zoom.');
    container.appendChild(canvas);

    // Escena, cámara y luces
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 500);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6360, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(-6, 8, 4);
    key.target.position.set(0, 0, -10);
    this.camera.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    rim.position.set(8, -3, -2);
    rim.target.position.set(0, 0, -10);
    this.camera.add(rim, rim.target);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Controles de órbita
    const controls = (this.controls = new OrbitControls(this.camera, canvas));
    controls.enableDamping = !REDUCED_MOTION;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.zoomToCursor = true;
    controls.minDistance = 6;
    controls.maxDistance = 120;
    controls.autoRotateSpeed = 1.4;
    controls.addEventListener('change', () => this.requestRender());
    controls.addEventListener('start', () => {
      this.cameraAnim = null;
      this.emit('interact');
    });

    // Planos de corte: sección configurable + línea media (para ver la cara medial)
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.section = { enabled: false, axis: 'x', value: 0.5, flip: false };
    this.midPlanes = { L: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), R: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0) };
    this.sectionHelper = this.#makeSectionHelper();
    this.scene.add(this.sectionHelper);

    this.raycaster = new THREE.Raycaster();
    this.#bindPointer(canvas);
    this.#bindKeys(canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.timer = new THREE.Timer();
    const loop = (t) => {
      requestAnimationFrame(loop);
      this.timer.update(t);
      this.#tick(Math.min(this.timer.getDelta(), 0.1));
    };
    loop();
  }

  // ------------------------------------------------------------------ eventos
  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return this;
  }
  emit(type, data) {
    (this.listeners[type] || []).forEach((fn) => fn(data));
  }
  requestRender() {
    this.needsRender = true;
  }

  // ------------------------------------------------------------------ carga
  async load(onProgress) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(this.config.url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    this.#buildParts(gltf.scene);
    this.resetView(false);
    this.emit('loaded');
  }

  /** Resuelve a qué estructura pertenece una malla del GLB. */
  #resolve(mesh) {
    const cfg = this.config;
    const names = [mesh.name, mesh.parent?.name].filter(Boolean);
    for (const n of names) if (cfg.aliases[n]) return cfg.aliases[n];
    const ud = mesh.userData?.structureId ? mesh.userData : mesh.parent?.userData;
    if (ud?.structureId) return { id: ud.structureId, side: ud.side || 'C' };
    for (const n of names) {
      const parsed = cfg.parseName(n);
      if (parsed) return parsed;
    }
    return null;
  }

  #buildParts(sceneRoot) {
    sceneRoot.updateMatrixWorld(true);
    // Lista de áreas corticales del modelo (índice → id), si el modelo la incluye
    this.areaIds = sceneRoot.userData?.areas || [];
    const t = this.config.transform || {};
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(t.rotation || [0, 0, 0]).map(THREE.MathUtils.degToRad)));
    const meshes = [];
    sceneRoot.traverse((o) => o.isMesh && meshes.push(o));

    const raw = [];
    for (const mesh of meshes) {
      const info = this.#resolve(mesh);
      if (!info) {
        console.warn(`[BrainViewer] Malla sin estructura asociada: "${mesh.name}"`);
        continue;
      }
      // Geometría en float32 con la transformación del nodo aplicada
      const src = mesh.geometry;
      const g = new THREE.BufferGeometry();
      const toFloat = (attr) => {
        const arr = new Float32Array(attr.count * 3);
        for (let i = 0; i < attr.count; i++) {
          arr[i * 3] = attr.getX(i);
          arr[i * 3 + 1] = attr.getY(i);
          arr[i * 3 + 2] = attr.getZ(i);
        }
        return new THREE.BufferAttribute(arr, 3);
      };
      g.setAttribute('position', toFloat(src.getAttribute('position')));
      if (src.getAttribute('normal')) g.setAttribute('normal', toFloat(src.getAttribute('normal')));
      if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
      const areaAttr = src.getAttribute('_area');
      if (areaAttr) {
        const area = new Uint8Array(areaAttr.count);
        for (let i = 0; i < areaAttr.count; i++) area[i] = areaAttr.getX(i);
        g.userData.area = area;
      }
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rot, mesh.matrixWorld));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      raw.push({ info, g, name: mesh.name });
    }

    // Centrado y escala común
    const box = new THREE.Box3();
    raw.forEach(({ g }) => {
      g.computeBoundingBox();
      box.union(g.boundingBox);
    });
    const center = box.getCenter(new THREE.Vector3());
    center.x = 0; // la línea media sagital se mantiene en x = 0
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.unitScale = t.fitRadius ? t.fitRadius / sphere.radius : 1;
    const fit = new THREE.Matrix4().makeScale(this.unitScale, this.unitScale, this.unitScale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

    const layerOf = {};
    for (const [layer, ids] of Object.entries(this.config.layers)) ids.forEach((id) => (layerOf[id] = layer));

    this.bounds = new THREE.Box3();
    for (const { info, g, name } of raw) {
      g.applyMatrix4(fit);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      g.computeBoundsTree();
      this.bounds.union(g.boundingBox);
      const material = this.#makeMaterial();
      const mesh = new THREE.Mesh(g, material);
      mesh.name = name;
      const part = {
        id: info.id,
        side: info.side || 'C',
        layer: layerOf[info.id] || 'deep',
        mesh,
        material,
        center: g.boundingBox.getCenter(new THREE.Vector3()),
        explodeOffset: new THREE.Vector3(),
        manualOffset: new THREE.Vector3(),
        manualTarget: new THREE.Vector3(),
        cur: { opacity: 1, color: new THREE.Color('#ddd'), emissive: 0 },
        tgt: { opacity: 1, color: new THREE.Color('#ddd'), emissive: 0, outline: false, clip: null, pickable: true },
        clipKey: '',
        outline: null,
      };
      if (g.userData.area) {
        part.area = g.userData.area;
        part.areaBorder = areaBorders(part.area, g.index);
      }
      mesh.userData.part = part;
      this.root.add(mesh);
      this.parts.push(part);
      if (!this.partsById.has(part.id)) this.partsById.set(part.id, []);
      this.partsById.get(part.id).push(part);
    }
    this.center = this.bounds.getCenter(new THREE.Vector3());
    this.radius = this.bounds.getBoundingSphere(new THREE.Sphere()).radius;
    this.#computeExplodeOffsets();
    this.setSection(this.section);
  }

  #computeExplodeOffsets() {
    const ex = this.config.explode || {};
    for (const p of this.parts) {
      const cfg = { ...ex.default, ...(ex[p.id] || {}) };
      const dir = cfg.dir ? new THREE.Vector3(...cfg.dir) : p.center.clone().sub(this.center);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      const sign = p.side === 'L' ? -1 : p.side === 'R' ? 1 : 0;
      p.explodeOffset.copy(dir.multiplyScalar(cfg.distance || 0)).add(new THREE.Vector3(sign * (cfg.lateral || 0), 0, 0)).multiplyScalar(this.unitScale);
    }
  }

  #makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6, metalness: 0, side: THREE.FrontSide });
    // Las caras traseras (visibles solo al cortar) se pintan como superficie de corte plana
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        #ifdef DOUBLE_SIDED
          if (!gl_FrontFacing) gl_FragColor = linearToOutputTexel(vec4(diffuseColor.rgb * 0.8, diffuseColor.a));
        #endif`
      );
    };
    m.customProgramCacheKey = () => 'brain-cut';
    return m;
  }

  #outlineMaterial() {
    // Contorno solo por fuera de la silueta: se dibuja donde la pieza no marcó el stencil
    const m = new THREE.MeshBasicMaterial({
      color: this.selectionColor,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        vec3 vn = normalize( normalMatrix * normal );
        mvPosition.xyz += vn * 0.0055 * -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;`
      );
    };
    m.customProgramCacheKey = () => 'brain-outline';
    return m;
  }

  // ------------------------------------------------------------------ aspecto
  /**
   * Define el aspecto objetivo de cada parte. `fn(part)` devuelve
   * { opacity, color, emissive, outline, clip: null|'L'|'R', pickable }.
   * Los cambios se animan suavemente.
   */
  setAppearance(fn) {
    for (const p of this.parts) {
      const t = fn(p);
      p.tgt.opacity = t.opacity;
      p.tgt.color.set(t.color);
      p.tgt.emissive = t.emissive || 0;
      p.tgt.outline = !!t.outline;
      p.tgt.pickable = t.pickable !== false;
      p.tgt.clip = t.clip || null;
      p.tgt.vertexColors = !!t.vertexColors && !!p.area;
    }
    this.#updateClipping();
    this.#startAnimation();
  }

  #startAnimation() {
    this.animating = true;
    this.requestRender();
  }

  #stepAppearance(dt) {
    const k = REDUCED_MOTION ? 1 : 1 - Math.exp(-dt * 11);
    let moving = false;
    for (const p of this.parts) {
      const c = p.cur, t = p.tgt;
      c.opacity += (t.opacity - c.opacity) * k;
      c.emissive += (t.emissive - c.emissive) * k;
      c.color.lerp(t.color, k);
      if (Math.abs(t.opacity - c.opacity) < 0.004) c.opacity = t.opacity;
      if (Math.abs(t.emissive - c.emissive) < 0.004) c.emissive = t.emissive;
      if (Math.abs(t.opacity - c.opacity) > 0 || Math.abs(t.emissive - c.emissive) > 0 || !colorsClose(c.color, t.color)) moving = true;
      this.#applyPart(p);
    }
    const ek = REDUCED_MOTION ? 1 : 1 - Math.exp(-dt * 6);
    this.explodeAmount += (this.explodeTarget - this.explodeAmount) * ek;
    if (Math.abs(this.explodeTarget - this.explodeAmount) < 0.001) this.explodeAmount = this.explodeTarget;
    else moving = true;
    const mk = REDUCED_MOTION ? 1 : 1 - Math.exp(-dt * 9);
    for (const p of this.parts) {
      if (p !== this.drag?.part) {
        p.manualOffset.lerp(p.manualTarget, mk);
        if (p.manualOffset.distanceToSquared(p.manualTarget) > 1e-6) moving = true;
        else p.manualOffset.copy(p.manualTarget);
      }
      p.mesh.position.copy(p.explodeOffset).multiplyScalar(this.explodeAmount).add(p.manualOffset);
    }
    return moving;
  }

  #applyPart(p) {
    const m = p.material, c = p.cur;
    const visible = c.opacity > 0.01;
    p.mesh.visible = visible;
    m.color.copy(c.color);
    if (m.vertexColors !== p.tgt.vertexColors) {
      m.vertexColors = p.tgt.vertexColors;
      m.needsUpdate = true;
    }
    m.emissive.copy(this.selectionColor).multiplyScalar(c.emissive);
    const transparent = c.opacity < 0.995;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.needsUpdate = true;
    }
    m.opacity = c.opacity;
    m.depthWrite = c.opacity > 0.55;
    const doubleSide = m.clippingPlanes?.length > 0 && !transparent;
    const side = doubleSide ? THREE.DoubleSide : THREE.FrontSide;
    if (m.side !== side) {
      m.side = side;
      m.needsUpdate = true;
    }
    const outlined = p.tgt.outline && visible && c.opacity > 0.3;
    m.stencilWrite = outlined;
    if (outlined) {
      m.stencilRef = 1;
      m.stencilFunc = THREE.AlwaysStencilFunc;
      m.stencilZPass = THREE.ReplaceStencilOp;
    }
    if (outlined) {
      if (!p.outline) {
        p.outline = new THREE.Mesh(p.mesh.geometry, this.#outlineMaterial());
        p.outline.raycast = () => {};
        p.outline.renderOrder = 2;
        p.mesh.add(p.outline);
      }
      p.outline.visible = true;
      p.outline.material.clippingPlanes = m.clippingPlanes;
    } else if (p.outline) p.outline.visible = false;
  }

  // ------------------------------------------------------------------ áreas corticales
  /**
   * Pinta los vértices de las piezas con áreas. `colorFor(areaIndex|null, part)`
   * devuelve un THREE.Color (null = superficie interna). Los bordes entre áreas
   * se oscurecen para que la parcelación se lea con claridad.
   */
  paintAreas(colorFor) {
    const c = new THREE.Color();
    for (const p of this.parts) {
      if (!p.area) continue;
      const g = p.mesh.geometry;
      let attr = g.getAttribute('color');
      if (!attr) {
        attr = new THREE.BufferAttribute(new Float32Array(p.area.length * 3), 3);
        g.setAttribute('color', attr);
      }
      const arr = attr.array;
      const cache = new Map();
      for (let v = 0; v < p.area.length; v++) {
        const idx = p.area[v];
        let base = cache.get(idx);
        if (!base) cache.set(idx, (base = colorFor(idx === 255 ? null : idx, p).clone()));
        c.copy(base);
        if (p.areaBorder[v]) c.multiplyScalar(0.62);
        arr[v * 3] = c.r;
        arr[v * 3 + 1] = c.g;
        arr[v * 3 + 2] = c.b;
      }
      attr.needsUpdate = true;
    }
    this.requestRender();
  }

  /** Vértices de un área (en las piezas indicadas): caja envolvente y ancla para la etiqueta. */
  areaRegion(areaIndex, parts) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const sum = new THREE.Vector3();
    let n = 0;
    for (const p of parts) {
      if (!p.area) continue;
      const pos = p.mesh.geometry.getAttribute('position');
      for (let i = 0; i < p.area.length; i++) {
        if (p.area[i] !== areaIndex) continue;
        v.fromBufferAttribute(pos, i).add(this.#finalOffset(p));
        box.expandByPoint(v);
        sum.add(v);
        n++;
      }
    }
    if (!n) return null;
    const centroid = sum.divideScalar(n);
    // Ancla: el vértice del área más cercano a su centroide
    let best = null, bestD = Infinity;
    for (const p of parts) {
      if (!p.area) continue;
      const pos = p.mesh.geometry.getAttribute('position');
      for (let i = 0; i < p.area.length; i++) {
        if (p.area[i] !== areaIndex) continue;
        v.fromBufferAttribute(pos, i).add(this.#finalOffset(p));
        const d = v.distanceToSquared(centroid);
        if (d < bestD) {
          bestD = d;
          best = { part: p, local: v.clone().sub(this.#finalOffset(p)) };
        }
      }
    }
    return { box, anchor: best };
  }

  /** Desplazamiento que tendrá la pieza al terminar las animaciones (explosión + arrastre). */
  #finalOffset(p) {
    return p.explodeOffset.clone().multiplyScalar(this.explodeTarget).add(p.manualTarget);
  }

  /** Encuadra una caja (coordenadas del mundo) mirando desde `dir`. */
  focusBox(box, dir) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(this.fitDistance(sphere.radius) * 1.3, this.radius * 2.4);
    this.viewFrom(dir, { target: sphere.center, distance: Math.min(distance, this.fitDistance(this.radius) * 1.1) });
  }

  // ------------------------------------------------------------------ corte
  /** axis: 'x' sagital, 'y' axial, 'z' coronal; value 0..1 a lo largo del eje. */
  setSection({ enabled, axis, value, flip }) {
    Object.assign(this.section, { enabled, axis, value, flip });
    if (!this.bounds) return;
    const i = { x: 0, y: 1, z: 2 }[axis];
    const min = this.bounds.min.getComponent(i), max = this.bounds.max.getComponent(i);
    const pos = min + (max - min) * value;
    const n = new THREE.Vector3().setComponent(i, flip ? 1 : -1);
    this.sectionPlane.normal.copy(n);
    this.sectionPlane.constant = flip ? -pos : pos;
    this.#placeSectionHelper(i, pos);
    this.#updateClipping();
    this.requestRender();
  }

  #makeSectionHelper() {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, -1, 0), new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 1, 0)]);
    const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0x0e9fb3, transparent: true, opacity: 0.55, depthTest: false }));
    line.renderOrder = 10;
    line.visible = false;
    return line;
  }

  #placeSectionHelper(i, pos) {
    const h = this.sectionHelper;
    const size = this.bounds.getSize(new THREE.Vector3()).multiplyScalar(0.58);
    const c = this.center;
    h.rotation.set(0, 0, 0);
    h.position.copy(c);
    if (i === 0) {
      h.rotation.y = Math.PI / 2;
      h.scale.set(size.z, size.y, 1);
      h.position.x = pos;
    } else if (i === 1) {
      h.rotation.x = Math.PI / 2;
      h.scale.set(size.x, size.z, 1);
      h.position.y = pos;
    } else {
      h.scale.set(size.x, size.y, 1);
      h.position.z = pos;
    }
    h.visible = this.section.enabled;
  }

  #updateClipping() {
    for (const p of this.parts) {
      const planes = [];
      if (this.section.enabled) planes.push(this.sectionPlane);
      if (p.tgt.clip) planes.push(this.midPlanes[p.tgt.clip]);
      const key = planes.map((pl) => (pl === this.sectionPlane ? 's' : pl === this.midPlanes.L ? 'L' : 'R')).join('');
      if (key !== p.clipKey) {
        p.clipKey = key;
        p.material.clippingPlanes = planes.length ? planes : null;
        p.material.needsUpdate = true;
        if (p.outline) p.outline.material.clippingPlanes = p.material.clippingPlanes;
      }
    }
    this.requestRender();
  }

  // ------------------------------------------------------------------ vista explosionada
  setExplode(amount) {
    this.explodeTarget = amount;
    this.#startAnimation();
  }

  // ------------------------------------------------------------------ desarmar (arrastrar piezas)
  /** Activa el modo en el que arrastrar una pieza la desplaza en lugar de rotar. */
  setDragMode(on) {
    this.dragMode = on;
    this.renderer.domElement.classList.toggle('is-drag-mode', on);
  }

  /** Devuelve todas las piezas movidas a mano a su posición. */
  reassemble() {
    for (const p of this.parts) p.manualTarget.set(0, 0, 0);
    this.#startAnimation();
  }

  hasMovedParts() {
    return this.parts.some((p) => p.manualTarget.lengthSq() > 1e-4);
  }

  #beginDrag(e) {
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return false;
    const group = this.dragGroup ? this.dragGroup(hit.part) : [hit.part];
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.drag = {
      part: hit.part,
      group,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
      start: hit.point.clone(),
      startOffsets: group.map((p) => p.manualTarget.clone()),
      pointerId: e.pointerId,
    };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.emit('dragstart', { part: hit.part });
    return true;
  }

  #moveDrag(e) {
    const d = this.drag;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = this.raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!point) return;
    const delta = point.sub(d.start);
    d.group.forEach((p, i) => {
      p.manualTarget.copy(d.startOffsets[i]).add(delta);
      p.manualOffset.copy(p.manualTarget);
    });
    this.#startAnimation();
  }

  #endDrag() {
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.emit('dragend', { part: d.part });
  }

  // ------------------------------------------------------------------ selección / picking
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates = this.parts.filter((p) => p.mesh.visible && p.tgt.pickable && p.cur.opacity > 0.5 && p.tgt.opacity > 0.5);
    const clipping = candidates.some((p) => p.material.clippingPlanes?.length);
    this.raycaster.firstHitOnly = !clipping;
    const hits = this.raycaster.intersectObjects(candidates.map((p) => p.mesh), false);
    for (const h of hits) {
      const part = h.object.userData.part;
      const planes = part.material.clippingPlanes || [];
      if (planes.some((pl) => pl.distanceToPoint(h.point) < 0)) continue;
      let area = null;
      if (part.area && h.face) {
        const { a, b, c } = h.face;
        const vals = [part.area[a], part.area[b], part.area[c]];
        const idx = vals[0] === vals[1] || vals[0] === vals[2] ? vals[0] : vals[1];
        area = idx === 255 ? null : idx;
      }
      return { part, point: h.point.clone(), area };
    }
    return null;
  }

  /** Punto de la superficie visible de un conjunto de partes (para anclar etiquetas). */
  anchorFor(parts) {
    const visible = parts.filter((p) => p.mesh.visible && p.cur.opacity > 0.05);
    const list = visible.length ? visible : parts;
    if (!list.length) return null;
    // Preferir la parte más cercana a la cámara
    const camPos = this.camera.position;
    const worldCenter = (p) => p.center.clone().add(p.mesh.position);
    list.sort((a, b) => worldCenter(a).distanceTo(camPos) - worldCenter(b).distanceTo(camPos));
    const part = list[0];
    const c = worldCenter(part);
    this.raycaster.set(camPos, c.clone().sub(camPos).normalize());
    this.raycaster.firstHitOnly = true;
    const hit = this.raycaster.intersectObject(part.mesh, false)[0];
    const point = hit ? hit.point : c;
    return { part, local: point.clone().sub(part.mesh.position) };
  }

  worldToScreen(v) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, behind: p.z > 1 };
  }

  // ------------------------------------------------------------------ cámara
  flyTo(position, target, duration = 750) {
    if (REDUCED_MOTION || duration <= 0) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.cameraAnim = {
      t: 0,
      duration: duration / 1000,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: position.clone(),
      toTarget: target.clone(),
    };
    this.requestRender();
  }

  viewFrom(dir, { target = this.center, distance = this.fitDistance(this.radius), duration } = {}) {
    const d = new THREE.Vector3(...dir).normalize();
    this.flyTo(target.clone().add(d.multiplyScalar(distance)), target, duration);
  }

  fitDistance(radius) {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(this.camera.aspect, 0.2);
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    return Math.max(fitH, fitW) * 1.05;
  }

  resetView(animate = true) {
    const preset = this.config.cameraPresets.inicial;
    this.viewFrom(preset.dir, { distance: this.fitDistance(this.radius * 0.92), duration: animate ? 750 : 0 });
  }

  /** Encuadra un conjunto de partes. `dir` es la dirección preferida de la cámara. */
  focusParts(parts, dir) {
    if (!parts.length) return;
    const box = new THREE.Box3();
    for (const p of parts) {
      const b = p.mesh.geometry.boundingBox.clone().translate(p.mesh.position);
      box.union(b);
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = Math.max(this.fitDistance(sphere.radius) * 1.3, this.radius * 2.4);
    this.viewFrom(dir, { target: sphere.center, distance: Math.min(distance, this.fitDistance(this.radius) * 1.1) });
  }

  /** Lado (+1 derecha, −1 izquierda) desde el que mira la cámara. */
  cameraSide() {
    return Math.sign(this.camera.position.x - this.controls.target.x) || -1;
  }

  orbit(dAzimuth, dPolar) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta += dAzimuth;
    s.phi = THREE.MathUtils.clamp(s.phi + dPolar, 0.05, Math.PI - 0.05);
    const pos = new THREE.Vector3().setFromSpherical(s).add(this.controls.target);
    this.flyTo(pos, this.controls.target.clone(), 320);
  }

  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target.clone().add(offset.setLength(len)), this.controls.target.clone(), 260);
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
    this.requestRender();
  }

  /**
   * Espacio (px) tapado por paneles superpuestos en la parte inferior. El centro
   * de la imagen se desplaza hacia arriba para que el modelo quede visible.
   */
  setBottomInset(px) {
    if (this.bottomInset === px) return;
    this.bottomInset = px;
    this.resize();
  }

  // ------------------------------------------------------------------ bucle
  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const inset = Math.min(this.bottomInset || 0, h * 0.7);
    this.camera.aspect = w / h;
    if (inset > 0) this.camera.setViewOffset(w, h, 0, inset / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  #tick(dt) {
    if (this.cameraAnim) {
      const a = this.cameraAnim;
      a.t = Math.min(a.t + dt / a.duration, 1);
      const e = easeInOut(a.t);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      // Interpolación esférica alrededor del objetivo para evitar atravesar el modelo
      const fromOff = a.fromPos.clone().sub(a.fromTarget);
      const toOff = a.toPos.clone().sub(a.toTarget);
      const len = THREE.MathUtils.lerp(fromOff.length(), toOff.length(), e);
      const q = new THREE.Quaternion().setFromUnitVectors(fromOff.clone().normalize(), toOff.clone().normalize());
      const dir = fromOff.normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
      this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(len));
      if (a.t >= 1) {
        this.cameraAnim = null;
        this.emit('cameraend');
      }
      this.needsRender = true;
    }
    if (this.controls.update(dt)) this.needsRender = true;
    if (this.controls.autoRotate) this.needsRender = true;
    if (this.animating) {
      this.animating = this.#stepAppearance(dt);
      this.needsRender = true;
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
      this.emit('render');
    }
  }

  // ------------------------------------------------------------------ entrada
  #bindPointer(canvas) {
    let down = null;
    let hoverQueued = null;
    // En modo desarmar, arrastrar sobre una pieza la mueve (se captura antes que OrbitControls)
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (this.dragMode && e.button === 0 && this.#beginDrag(e)) e.stopImmediatePropagation();
      },
      { capture: true }
    );
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) this.#moveDrag(e);
    });
    canvas.addEventListener('pointercancel', () => this.drag && this.#endDrag());
    canvas.addEventListener('pointerup', (e) => {
      if (this.drag) this.#endDrag();
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (down.button === 0 && moved < 6 && performance.now() - down.t < 600) {
        const hit = this.pick(e.clientX, e.clientY);
        this.emit('pick', { hit, multi: e.ctrlKey || e.metaKey || e.shiftKey, x: e.clientX, y: e.clientY });
      }
      down = null;
    });
    canvas.addEventListener('dblclick', (e) => {
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.emit('dblpick', { hit });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      if (hoverQueued) {
        hoverQueued = { x: e.clientX, y: e.clientY };
        return;
      }
      hoverQueued = { x: e.clientX, y: e.clientY };
      requestAnimationFrame(() => {
        const { x, y } = hoverQueued;
        hoverQueued = null;
        this.emit('hover', { hit: this.pick(x, y), x, y });
      });
    });
    canvas.addEventListener('pointerleave', () => this.emit('hover', { hit: null }));
  }

  #bindKeys(canvas) {
    const step = THREE.MathUtils.degToRad(15);
    canvas.addEventListener('keydown', (e) => {
      const map = {
        ArrowLeft: () => this.orbit(-step, 0),
        ArrowRight: () => this.orbit(step, 0),
        ArrowUp: () => this.orbit(0, -step),
        ArrowDown: () => this.orbit(0, step),
        '+': () => this.zoom(0.8),
        '=': () => this.zoom(0.8),
        '-': () => this.zoom(1.25),
      };
      if (map[e.key]) {
        e.preventDefault();
        map[e.key]();
      }
    });
  }
}

function colorsClose(a, b) {
  return Math.abs(a.r - b.r) < 0.002 && Math.abs(a.g - b.g) < 0.002 && Math.abs(a.b - b.b) < 0.002;
}

/** Marca los vértices de triángulos que cruzan una frontera entre áreas. */
function areaBorders(area, index) {
  const border = new Uint8Array(area.length);
  if (!index) return border;
  const idx = index.array;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (area[a] !== area[b] || area[a] !== area[c]) border[a] = border[b] = border[c] = 1;
  }
  return border;
}
