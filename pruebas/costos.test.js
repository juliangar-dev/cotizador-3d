// Pruebas del cálculo de costos. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCosto, precioPorKg } from '../src/costos.js';

const cerca = (a, b, tol, msj) => assert.ok(Math.abs(a - b) <= tol, `${msj}: ${a} vs ${b}`);

test('precio por tipo con prefijo', () => {
  const precios = { PLA: 1, 'PLA-CF': 2, Otro: 9 };
  assert.equal(precioPorKg('PLA', precios), 1);
  assert.equal(precioPorKg('PLA-CF', precios), 2);
  assert.equal(precioPorKg('PLA+', precios), 1);
  assert.equal(precioPorKg('NYLON', precios), 9);
});

test('cálculo de costo', () => {
  const c = calcularCosto({
    filamentos: [{ tipo: 'PLA', reparto: { pieza: 100, purga: 10, torre: 0 } }],
    tiempoSeg: 3600 * 2,
  }, {
    precios: { PLA: 20000 }, potenciaW: 100, tarifaKwh: 200, desgasteHora: 150, fallasPct: 10, margenPct: 50,
  });
  assert.equal(c.filamento, 2000);
  assert.equal(c.purgas, 200);
  assert.equal(c.luz, 40);
  assert.equal(c.desgaste, 300);
  cerca(c.fallas, 254, 1e-9, 'fallas');
  cerca(c.total, 2794, 1e-9, 'total');
  cerca(c.precio, 4191, 1e-9, 'precio');
});

