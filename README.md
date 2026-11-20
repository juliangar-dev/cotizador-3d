# Cotizador 3D

Web que calcula el costo real y el precio sugerido de una impresión 3D a partir del archivo de impresión.

## Qué hace

- Lee archivos `.gcode` y `.gcode.3mf` (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura).
- Saca el tiempo estimado, el filamento usado (gramos y metros) por cada filamento o color, la cantidad de capas, la altura de capa y las dimensiones de la pieza.
- En impresiones multicolor separa el filamento que va a la pieza del que se pierde en purgas y en la torre de purga.
- Muestra una vista 3D de los recorridos de extrusión, capa por capa, con el color de cada filamento.
- Todo corre en el navegador: el archivo no se sube a ningún servidor.

## Cómo se usa

1. Abrí la web y elegí (o arrastrá) tu archivo `.gcode` o `.gcode.3mf`. En Bambu Studio u OrcaSlicer, laminá y usá **Exportar placa laminada** para obtener el `.gcode.3mf`.
2. En **Ajustes de costo** cargá el precio por kg de tus filamentos, la potencia de tu impresora, la tarifa de luz y el desgaste por hora. Quedan guardados en tu navegador.
3. Elegí el margen de ganancia y listo: tenés el costo desglosado y el precio sugerido.

## Cómo se calcula el costo

| Concepto | Cálculo |
|---|---|
| Filamento | gramos que van a la pieza × precio por kg del tipo ÷ 1000 |
| Purgas | gramos de purgas, línea de inicio y torre × precio por kg ÷ 1000 |
| Luz | potencia promedio (W) ÷ 1000 × horas × tarifa ($/kWh) |
| Desgaste | horas × costo por hora de máquina |
| Fallas | (filamento + purgas + luz + desgaste) × porcentaje de fallas |
| **Costo total** | suma de todo lo anterior |
| **Precio sugerido** | costo total × (1 + margen de ganancia) |

Los gramos y el tiempo salen de los metadatos del laminador cuando están. Si el archivo no los trae, se calculan sumando las extrusiones (E) del G-code y los movimientos; en ese caso el tiempo es aproximado. El reparto entre pieza y purgas siempre sale de sumar las extrusiones según el tipo de línea que marca el laminador.

Valores por defecto (editables): 120 W de potencia promedio, 200 $/kWh, 200 $/h de desgaste, 10 % de fallas y 50 % de margen.

## Tecnologías

- [Vite](https://vite.dev/) para el sitio estático.
- [three.js](https://threejs.org/) para la vista 3D.
- [fflate](https://github.com/101arrowz/fflate) para abrir los `.3mf` (son zip).
- Web Worker para leer archivos grandes sin trabar la página.
- GitHub Actions para publicar en GitHub Pages.

## Cómo correrlo

Necesitás Node.js 20 o más nuevo.

```sh
npm install
npm run dev      # servidor local
npm test         # pruebas del lector y del cálculo
npm run build    # sitio listo en dist/
```

`npm run generar-ejemplo` vuelve a generar los G-code de prueba de `pruebas/datos/` y el ejemplo de `public/`.
