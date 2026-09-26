# NeuroAtlas 3D

Atlas 3D interactivo del encéfalo para estudiantes de Psicología. Permite rotar, hacer zoom, seleccionar, ocultar, aislar, **desarmar** (vista explosionada y arrastre de piezas), cortar y estudiar cada estructura con fichas educativas y un modo de práctica.

## Uso

```bash
npm install
npm run dev              # servidor de desarrollo (http://localhost:5173)
npm run build            # versión de producción en dist/
npm run generate:model   # regenera public/models/brain.glb
```

## Funciones

- **Explorar**: clic en una estructura (Ctrl/Mayús + clic para seleccionar varias), doble clic para centrarla, lista lateral con buscador, mostrar/ocultar/aislar por estructura o por grupo.
- **Desarmar**: botón *Desarmar* (separación regulable) y *Mover piezas* para sacar cualquier estructura arrastrándola con el ratón o el dedo; *Rearmar* las devuelve a su sitio.
- **Vistas**: anatómica, por lóbulos, interna (retira la corteza y la sustancia blanca por capas), límbica, funcional y desarmada.
- **Corte**: planos sagital, coronal y axial con posición regulable; las superficies de corte se muestran sólidas.
- **Hemisferios**: ambos, izquierdo o derecho (con corte en la línea media para ver la cara medial).
- **Funciones**: filtra y resalta las estructuras implicadas en memoria, emociones, lenguaje, etc.
- **Patologías**: 27 enfermedades y trastornos (neurodegenerativos, cerebrovasculares, síndromes focales, epilepsia, psiquiátricos, del neurodesarrollo…). Al elegir una, el modelo resalta en rojo las estructuras principalmente afectadas y en ámbar las relacionadas, respetando la lateralización (p. ej., afasia de Broca en el hemisferio izquierdo). Se puede filtrar por estructura afectada y cada ficha de estructura enlaza sus patologías. Se distingue entre **lesión o degeneración** y **asociación en estudios** (trastornos psiquiátricos y del neurodesarrollo).
- **Estudiar**: preguntas «¿Qué estructura es esta?» con explicación; temas por lóbulos, estructuras subcorticales, sistema límbico, tronco y cerebelo, por función, o «Patologías: ¿qué estructura se afecta?».
- Teclado: flechas (rotar), + / − (zoom), H (ocultar selección), I (aislar), E (desarmar), F (centrar), R (restablecer), Esc (deseleccionar).

## Arquitectura

```
src/
  data/
    structures.js    Contenido educativo (ubicación, función, relación psicológica, ejemplo…)
    categories.js    Categorías funcionales
    pathologies.js   Patologías: estructuras afectadas (principal / relacionada, lado), mecanismo, síntomas…
    modelConfig.js   Todo lo que depende del GLB: nombres de mallas, capas, explosión, cámaras
    palettes.js      Colores por modo de visualización
  viewer/
    BrainViewer.js   Motor 3D (three.js): carga, picking, aspecto animado, corte, explosión, arrastre
  app/
    store.js         Estado de la aplicación
    appearance.js    Reglas estado → aspecto de cada pieza 3D
  ui/                Paneles, barra de controles, etiquetas 3D, leyenda, orientación, modo Estudiar
scripts/
  generate-brain.mjs Generador procedural del modelo GLB
```

El visor no conoce el contenido educativo y el contenido no conoce el visor: se unen mediante el `id` de cada estructura.

### Sustituir el modelo 3D

El modelo incluido es **procedural y didáctico**: respeta la topografía y las proporciones generales, pero no procede de neuroimagen. Para usar un modelo anatómico de mayor precisión (por ejemplo, derivado de un atlas de resonancia):

1. Exporta un GLB con **una malla por estructura y lado**.
2. Cópialo en `public/models/` y actualiza `url` en `src/data/modelConfig.js`.
3. Relaciona sus mallas con las estructuras de una de estas formas:
   - nombres con la convención `<id>__<L|R|C>` (p. ej. `hipocampo__L`),
   - `extras: { "structureId": "hipocampo", "side": "L" }` en cada nodo,
   - o entradas en `aliases` (`'Left-Hippocampus': { id: 'hipocampo', side: 'L' }`).
4. Ajusta `transform` si el modelo usa otra orientación (la app usa +X derecha, +Y superior, +Z anterior) o escala.

Las mallas sin correspondencia se ignoran y se avisa en la consola. Los ids disponibles están en `src/data/structures.js`.

### El modelo procedural

`scripts/generate-brain.mjs` define cada estructura como un campo de distancia (SDF) y la poligoniza con *marching cubes*. Cada lóbulo es un **sólido cerrado** (hemisferio ∩ región del lóbulo ∖ sustancia blanca), de modo que las piezas encajan y conservan volumen al desarmarlas. La malla se simplifica y se comprime con meshoptimizer (`EXT_meshopt_compression` + `KHR_mesh_quantization`, ~2,3 MB).

## Nota sobre el contenido

Las fichas distinguen entre **anatomía**, **función conocida** y **asociación psicológica**, y evitan atribuir funciones exclusivas a una sola estructura: las funciones mentales dependen de redes.
