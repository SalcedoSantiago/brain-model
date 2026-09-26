/**
 * Configuración del modelo 3D.
 *
 * Todo lo que depende del archivo GLB concreto está aquí. Para sustituir el
 * modelo por uno anatómico de mayor precisión basta con:
 *   1. Copiar el nuevo GLB en /public/models/ y actualizar `url`.
 *   2. Indicar cómo se llaman sus mallas: añadir entradas a `aliases`
 *      (nombre de malla → { id, side }) o usar la convención `<id>__<L|R|C>`,
 *      o bien incluir `extras: { structureId, side }` en cada nodo.
 *   3. Ajustar `transform` si el modelo usa otra orientación o unidades.
 * El contenido educativo (src/data/structures.js) no necesita cambios.
 */
export const MODEL_CONFIG = {
  url: `${import.meta.env.BASE_URL}models/brain.glb`,

  /**
   * Transformación aplicada al modelo completo para llevarlo a la convención
   * de la app: +X = derecha del sujeto, +Y = superior, +Z = anterior.
   * rotation en grados (Euler XYZ); `fitRadius` reescala el modelo para que su
   * esfera envolvente tenga ese radio.
   */
  transform: { rotation: [0, 0, 0], fitRadius: 10 },

  /** Correspondencias explícitas nombre de malla → estructura (para otros modelos). */
  aliases: {
    // 'Left_Hippocampus': { id: 'hipocampo', side: 'L' },
  },

  /** Convención de nombres del modelo incluido. */
  parseName(name) {
    const m = /^(.+?)__(L|R|C)$/.exec(name);
    return m ? { id: m[1], side: m[2] } : null;
  },

  /**
   * Capa anatómica de cada estructura: determina qué se oculta en la vista
   * interna y qué se vuelve translúcido al seleccionar algo profundo.
   *   cortex → superficie; white → sustancia blanca; deep → estructuras internas.
   */
  layers: {
    cortex: ['lobulo_frontal', 'lobulo_parietal', 'lobulo_temporal', 'lobulo_occipital', 'insula', 'giro_cingulado'],
    white: ['sustancia_blanca'],
    deep: ['cuerpo_calloso', 'fornix', 'talamo', 'hipotalamo', 'hipocampo', 'amigdala', 'nucleo_caudado', 'putamen', 'globo_palido', 'mesencefalo', 'protuberancia', 'bulbo_raquideo'],
    base: ['cerebelo'],
  },

  /**
   * Vista explosionada: desplazamiento máximo (cm) y dirección opcional. Sin
   * dirección se usa la que va del centro del encéfalo al centro de la malla.
   * `lateral` añade separación hacia el lado de la malla.
   */
  explode: {
    default: { distance: 1.2, lateral: 0.6 },
    lobulo_frontal: { distance: 5.6, lateral: 2.2 },
    lobulo_parietal: { distance: 5.6, lateral: 2.2 },
    lobulo_temporal: { distance: 5.4, lateral: 3.6 },
    lobulo_occipital: { distance: 5.6, lateral: 2.2 },
    insula: { distance: 3.4, dir: [1, 0, 0], lateral: 2.4 },
    giro_cingulado: { distance: 4.4, dir: [0, 1, 0.1], lateral: 1.4 },
    // Se queda en su sitio y se vuelve translúcida al desarmar (ver appearance.js)
    sustancia_blanca: { distance: 0.6, dir: [0, 1, 0], lateral: 1.2 },
    cuerpo_calloso: { distance: 3.2, dir: [0, 1, 0] },
    fornix: { distance: 1.8, dir: [0, 1, -0.3], lateral: 0.8 },
    talamo: { distance: 0.6, dir: [0, 0.3, 0], lateral: 1.2 },
    hipotalamo: { distance: 1.0, dir: [0, -0.4, 1] },
    hipocampo: { distance: 1.4, dir: [0, -0.6, 0], lateral: 2.2 },
    amigdala: { distance: 1.4, dir: [0, -0.3, 0.6], lateral: 2.2 },
    nucleo_caudado: { distance: 1.2, dir: [0, 0.6, 0.4], lateral: 1.8 },
    putamen: { distance: 0.6, lateral: 3.0 },
    globo_palido: { distance: 0.4, lateral: 2.2 },
    mesencefalo: { distance: 1.0, dir: [0, -1, 0] },
    protuberancia: { distance: 2.2, dir: [0, -1, 0.2] },
    bulbo_raquideo: { distance: 3.4, dir: [0, -1, 0] },
    cerebelo: { distance: 4.6, dir: [0, -0.6, -1], lateral: 1.2 },
  },

  /**
   * Dirección preferida de la cámara (desde el centro de la estructura) al
   * enfocar una estructura. Para estructuras bilaterales se refleja al lado
   * visible. [x, y, z] en la convención de la app, o { dir, hemisphere } si
   * hace falta mostrar un solo hemisferio.
   */
  focusViews: {
    default: [-0.8, 0.45, 0.55],
    lobulo_frontal: [-0.6, 0.45, 0.8],
    lobulo_parietal: [-0.6, 0.75, -0.3],
    lobulo_temporal: [-1, -0.1, 0.25],
    lobulo_occipital: [-0.45, 0.3, -1],
    insula: [-1, 0.1, 0.1],
    // La cara medial solo se ve ocultando el otro hemisferio
    giro_cingulado: { dir: [1, 0.3, 0.1], hemisphere: 'L' },
    cuerpo_calloso: [-0.6, 0.8, 0.35],
    hipocampo: [-0.85, -0.35, 0.4],
    amigdala: [-0.8, -0.25, 0.6],
    hipotalamo: [-0.6, -0.5, 0.7],
    mesencefalo: [-0.6, -0.1, 0.8],
    protuberancia: [-0.55, -0.15, 0.9],
    bulbo_raquideo: [-0.6, -0.1, 0.8],
    tronco_encefalico: [-0.6, -0.15, 0.8],
    cerebelo: [-0.55, -0.1, -0.85],
    hemisferio_izquierdo: [-1, 0.35, 0.3],
    hemisferio_derecho: [1, 0.35, 0.3],
  },

  /** Vistas predefinidas de la cámara. */
  cameraPresets: {
    inicial: { dir: [-0.8, 0.38, 0.48], label: 'Vista inicial' },
    lateral_izq: { dir: [-1, 0.05, 0.02], label: 'Lateral izquierda' },
    lateral_der: { dir: [1, 0.05, 0.02], label: 'Lateral derecha' },
    anterior: { dir: [0, 0.1, 1], label: 'Anterior' },
    posterior: { dir: [0, 0.1, -1], label: 'Posterior' },
    superior: { dir: [0, 1, 0.02], label: 'Superior' },
    inferior: { dir: [0, -1, 0.02], label: 'Inferior (basal)' },
    medial: { dir: [1, 0.08, 0.02], label: 'Medial (hemisferio izquierdo)', hemisphere: 'L' },
  },
};
