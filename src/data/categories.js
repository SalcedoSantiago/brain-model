/**
 * Categorías funcionales para filtrar y estudiar estructuras.
 * El color se usa en la "Vista funcional" y al resaltar una categoría.
 */
export const CATEGORIES = [
  { id: 'memoria', name: 'Memoria', color: '#d4a21c', description: 'Codificar, almacenar y recuperar información.' },
  { id: 'emociones', name: 'Emociones', color: '#d0463f', description: 'Valorar la relevancia emocional de los estímulos y regular las respuestas afectivas.' },
  { id: 'lenguaje', name: 'Lenguaje', color: '#2f6fbf', description: 'Comprender y producir lenguaje oral y escrito.' },
  { id: 'atencion', name: 'Atención', color: '#8a5cc7', description: 'Seleccionar la información relevante y mantener el foco.' },
  { id: 'percepcion', name: 'Percepción', color: '#1f9a8a', description: 'Organizar e interpretar la información sensorial.' },
  { id: 'movimiento', name: 'Movimiento', color: '#e0782f', description: 'Planificar, ejecutar y coordinar acciones motoras.' },
  { id: 'aprendizaje', name: 'Aprendizaje', color: '#5a9e3f', description: 'Modificar la conducta a partir de la experiencia.' },
  { id: 'regulacion_hormonal', name: 'Regulación hormonal', color: '#c9609f', description: 'Control neuroendocrino y homeostasis del organismo.' },
  { id: 'sueno', name: 'Sueño', color: '#3f4f9e', description: 'Regular el ciclo sueño-vigilia y el nivel de alerta.' },
  { id: 'procesamiento_sensorial', name: 'Procesamiento sensorial', color: '#2b9bc4', description: 'Recibir y transmitir la información de los sentidos.' },
  { id: 'funciones_ejecutivas', name: 'Funciones ejecutivas', color: '#7a5436', description: 'Planificar, inhibir, tomar decisiones y adaptar la conducta a metas.' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
