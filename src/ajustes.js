// Valores editables del cálculo, guardados en localStorage.
import { TIPOS_FILAMENTO } from './costos.js';

const CLAVE = 'cotizador3d.ajustes.v1';

// Valores de referencia: cada uno carga los suyos.
export const AJUSTES_POR_DEFECTO = Object.freeze({
  precios: {
    PLA: 22000, PETG: 24000, TPU: 35000, ABS: 24000, ASA: 30000,
    'PLA-CF': 38000, 'PETG-CF': 40000, PA: 45000, PC: 40000, Otro: 25000,
  },
  potenciaW: 120,     // promedio de una impresora de escritorio con cama caliente
  tarifaKwh: 200,     // $/kWh
  desgasteHora: 200,  // $/h de máquina
  fallasPct: 10,
  margenPct: 50,
});

function copiaPorDefecto() {
  return JSON.parse(JSON.stringify(AJUSTES_POR_DEFECTO));
}

export function cargarAjustes() {
  const base = copiaPorDefecto();
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return base;
    const guardado = JSON.parse(crudo);
    const res = { ...base, ...guardado, precios: { ...base.precios, ...(guardado.precios || {}) } };
    for (const k of ['potenciaW', 'tarifaKwh', 'desgasteHora', 'fallasPct', 'margenPct']) {
      if (!Number.isFinite(res[k]) || res[k] < 0) res[k] = base[k];
    }
    for (const t of TIPOS_FILAMENTO) if (!Number.isFinite(res.precios[t])) res.precios[t] = base.precios[t];
    return res;
  } catch {
    return base;
  }
}

export function guardarAjustes(ajustes) {
  try { localStorage.setItem(CLAVE, JSON.stringify(ajustes)); } catch { /* modo privado o almacenamiento bloqueado */ }
}

export function borrarAjustes() {
  try { localStorage.removeItem(CLAVE); } catch { /* nada */ }
  return copiaPorDefecto();
}
