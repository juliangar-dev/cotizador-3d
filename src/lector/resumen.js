// Junta lo que dicen los metadatos con lo que calculamos sumando extrusiones
// y arma un resumen único por placa y por filamento.
import { densidadPorTipo, mmAGramos } from './gcode.js';

const COLOR_POR_DEFECTO = '#8a8f98';

/**
 * @param {ReturnType<import('./gcode.js').analizarGcode>} g resultado del G-code
 * @param {object|null} info datos de slice_info.config de la placa (3mf)
 * @param {object|null} json datos de plate_N.json (3mf)
 */
export function armarResumen(g, info = null, json = null) {
  const { config, meta, calculado } = g;
  const avisos = [];

  // ---- Filamentos ----
  // Índices de herramienta que realmente extruyeron algo
  const usados = new Set();
  calculado.extrusionMm.forEach((v, i) => { if (v && v.pieza + v.purga + v.torre > 0.5) usados.add(i); });
  const deMeta = info?.filamentos?.filter((f) => f.gramos > 0) || [];
  deMeta.forEach((f) => usados.add(f.id - 1));
  if (meta.gramos) meta.gramos.forEach((v, i) => { if (v > 0) usados.add(i); });

  const filamentos = [...usados].sort((a, b) => a - b).map((i) => {
    const fm = deMeta.find((f) => f.id - 1 === i) || null;
    const tipo = (fm?.tipo || config.tipos[i] || config.tipos[0] || 'PLA').toUpperCase();
    const color = normalizarColor(fm?.color || (json?.filament_colors && json.filament_ids
      ? json.filament_colors[json.filament_ids.indexOf(i)] : null) || config.colores[i]);
    const densidad = config.densidades[i] || config.densidades[0] || densidadPorTipo(tipo);
    const diametro = config.diametros[i] || config.diametros[0] || 1.75;

    const e = calculado.extrusionMm[i] || { pieza: 0, purga: 0, torre: 0 };
    const pieza = Math.max(0, e.pieza), purga = Math.max(0, e.purga), torre = Math.max(0, e.torre);
    const mmCalculados = pieza + purga + torre;
    const gramosCalculados = mmAGramos(mmCalculados, diametro, densidad);

    // Totales: preferimos los metadatos del laminador; si no hay, lo calculado.
    let gramos = null, metros = null, fuente = 'calculado';
    if (fm && Number.isFinite(fm.gramos)) {
      gramos = fm.gramos; metros = Number.isFinite(fm.metros) ? fm.metros : null; fuente = 'metadatos';
    } else if (meta.gramos && Number.isFinite(meta.gramos[i]) && meta.gramos[i] > 0) {
      gramos = meta.gramos[i]; fuente = 'metadatos';
    }
    if (metros == null && meta.largosMm && Number.isFinite(meta.largosMm[i]) && meta.largosMm[i] > 0) metros = meta.largosMm[i] / 1000;
    if (gramos == null && metros != null) { gramos = mmAGramos(metros * 1000, diametro, densidad); fuente = 'metadatos'; }
    if (gramos == null) gramos = gramosCalculados;
    if (metros == null) metros = gramos / mmAGramos(1000, diametro, densidad);

    // Reparto pieza / purga / torre: proporciones de lo calculado aplicadas al total
    const base = mmCalculados > 0 ? mmCalculados : 1;
    const reparto = {
      pieza: gramos * (mmCalculados > 0 ? pieza / base : 1),
      purga: gramos * (purga / base),
      torre: gramos * (torre / base),
    };

    return {
      indice: i,
      nombre: `Filamento ${i + 1}`,
      tipo,
      color,
      gramos,
      metros,
      reparto,
      fuente,
      gramosCalculados,
      perfil: config.perfiles[i] || null,
    };
  });

  if (!filamentos.length) avisos.push('No se encontró extrusión en el archivo.');

  // ---- Tiempo ----
  let tiempoSeg = info?.tiempoSeg ?? meta.tiempoSeg ?? null;
  let tiempoFuente = 'metadatos';
  if (tiempoSeg == null || !Number.isFinite(tiempoSeg)) {
    // Sin aceleraciones el cálculo propio da de menos; lo corregimos un poco.
    tiempoSeg = calculado.tiempoSeg * 1.15;
    tiempoFuente = 'calculado';
    avisos.push('El archivo no trae el tiempo estimado: se calculó a partir de los movimientos (aproximado).');
  }

  // ---- Capas y dimensiones ----
  const capas = meta.capas || calculado.capas || 0;
  const alturaCapa = calculado.alturaCapa || (json?.bbox_objects?.[0]?.layer_height ?? null);
  const dimensiones = calculado.dimensiones;

  const totalGramos = filamentos.reduce((s, f) => s + f.gramos, 0);
  const desperdicio = filamentos.reduce((s, f) => s + f.reparto.purga + f.reparto.torre, 0);

  return {
    tiempoSeg,
    tiempoFuente,
    capas,
    alturaCapa,
    alturaPrimeraCapa: calculado.alturaPrimeraCapa,
    dimensiones,
    filamentos,
    totalGramos,
    desperdicioGramos: desperdicio,
    impresora: config.impresora,
    boquilla: config.boquilla,
    areaImpresion: config.areaImpresion,
    soportes: info?.soportes ?? null,
    avisos,
  };
}

function normalizarColor(c) {
  if (!c) return COLOR_POR_DEFECTO;
  let s = String(c).trim();
  if (!s.startsWith('#')) s = `#${s}`;
  // Algunos laminadores guardan #RRGGBBAA
  if (/^#[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 7);
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : COLOR_POR_DEFECTO;
}
