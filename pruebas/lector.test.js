// Pruebas del lector. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { procesarArchivo } from '../src/lector/procesar.js';
import { analizarGcode, textoATiempo } from '../src/lector/gcode.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const datos = (n) => join(aqui, 'datos', n);
const leer = (n) => new Uint8Array(readFileSync(datos(n)));
const cerca = (a, b, tol, msj) => assert.ok(Math.abs(a - b) <= tol, `${msj}: ${a} vs ${b}`);

test('convierte textos de tiempo', () => {
  assert.equal(textoATiempo('1h 2m 3s'), 3723);
  assert.equal(textoATiempo('27m 57s'), 1677);
  assert.equal(textoATiempo('1d 0h 0m 10s'), 86410);
});

test('jarrón de dos colores: separa pieza, purga y torre por filamento', () => {
  const esperado = JSON.parse(readFileSync(datos('jarron-dos-colores.esperado.json'), 'utf8'));
  const g = analizarGcode(readFileSync(datos('jarron-dos-colores.gcode'), 'utf8'));
  esperado.extrusion.forEach((e, i) => {
    const c = g.calculado.extrusionMm[i];
    cerca(c.pieza, e.pieza, 0.01, `pieza T${i}`);
    cerca(c.purga, e.purga, 0.01, `purga T${i}`);
    cerca(c.torre, e.torre, 0.01, `torre T${i}`);
  });
  assert.equal(g.calculado.capas, esperado.capas);
  assert.equal(g.calculado.alturaCapa, esperado.alturaCapa);
  cerca(g.calculado.dimensiones.x, esperado.dimensiones.x, 0.01, 'ancho');
  cerca(g.calculado.dimensiones.z, esperado.dimensiones.z, 0.01, 'alto');
  assert.equal(g.geometria.inicioCapa.length, esperado.capas);

  const { placas } = procesarArchivo(leer('jarron-dos-colores.gcode'));
  const r = placas[0].resumen;
  assert.equal(r.filamentos.length, 2);
  assert.deepEqual(r.filamentos.map((f) => f.tipo), ['PLA', 'PETG']);
  assert.deepEqual(r.filamentos.map((f) => f.color), ['#1F6F6B', '#E9B44C']);
  assert.equal(r.tiempoFuente, 'calculado');
  assert.ok(r.tiempoSeg > 0);
  assert.ok(r.desperdicioGramos > 0);
});

test('G-code sin comentarios: calcula todo sumando E', () => {
  const esperado = JSON.parse(readFileSync(datos('sin-comentarios.esperado.json'), 'utf8'));
  const { placas } = procesarArchivo(leer('sin-comentarios.gcode'));
  const r = placas[0].resumen;
  assert.equal(r.filamentos.length, 1);
  assert.equal(r.capas, esperado.capas);
  cerca(r.alturaCapa, esperado.alturaCapa, 1e-6, 'altura de capa');
  cerca(r.filamentos[0].metros * 1000, esperado.extrusionTotal, 0.01, 'filamento total');
  cerca(r.dimensiones.x, esperado.dimensiones.x, 0.01, 'ancho');
  cerca(r.dimensiones.z, esperado.dimensiones.z, 0.01, 'alto');
});

// Si hay archivos en ejemplos-privados/ (no se suben al repo), los probamos también.
const privados = join(aqui, '..', 'ejemplos-privados');
if (existsSync(privados)) {
  for (const nombre of readdirSync(privados).filter((n) => /\.(gcode|3mf)$/i.test(n))) {
    test(`archivo privado de ejemplo: ${nombre}`, () => {
      const { placas } = procesarArchivo(new Uint8Array(readFileSync(join(privados, nombre))));
      assert.ok(placas.length > 0);
      for (const p of placas) {
        const r = p.resumen;
        assert.ok(r.tiempoSeg > 0, 'tiempo');
        assert.ok(r.capas > 0, 'capas');
        assert.ok(r.filamentos.length > 0, 'filamentos');
        for (const f of r.filamentos) {
          assert.ok(f.gramos > 0, 'gramos');
          // lo calculado sumando E no debería alejarse mucho de los metadatos
          if (f.fuente === 'metadatos') cerca(f.gramosCalculados, f.gramos, f.gramos * 0.1, 'gramos calculados vs metadatos');
        }
        assert.ok(p.geometria.segmentos > 0, 'geometría');
      }
    });
  }
}
