// Lector de proyectos .gcode.3mf (Bambu Studio / OrcaSlicer).
// El 3mf es un zip: adentro están el G-code de cada placa y los metadatos del laminado.
import { unzipSync, strFromU8 } from 'fflate';

const RE_GCODE_PLACA = /^Metadata\/plate_(\d+)\.gcode$/;

/** Devuelve true si los bytes empiezan como un zip ("PK"). */
export function esZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Abre el zip y devuelve las placas que tienen G-code.
 * Sólo descomprime lo necesario (no toca el modelo 3D ni otros datos del proyecto).
 */
export function leerTresMf(bytes) {
  const archivos = unzipSync(bytes, {
    filter: (f) => RE_GCODE_PLACA.test(f.name)
      || f.name === 'Metadata/slice_info.config'
      || /^Metadata\/plate_\d+\.(json|png)$/.test(f.name),
  });

  const sliceInfo = archivos['Metadata/slice_info.config']
    ? leerSliceInfo(strFromU8(archivos['Metadata/slice_info.config']))
    : [];

  const placas = [];
  for (const nombre of Object.keys(archivos)) {
    const m = nombre.match(RE_GCODE_PLACA);
    if (!m) continue;
    const indice = parseInt(m[1], 10);
    let json = null;
    const crudoJson = archivos[`Metadata/plate_${indice}.json`];
    if (crudoJson) {
      try { json = JSON.parse(strFromU8(crudoJson)); } catch { json = null; }
    }
    placas.push({
      indice,
      gcode: archivos[nombre],
      miniatura: archivos[`Metadata/plate_${indice}.png`] || null,
      info: sliceInfo.find((p) => p.indice === indice) || null,
      json,
    });
  }
  placas.sort((a, b) => a.indice - b.indice);
  return placas;
}

function atributos(texto) {
  const res = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(texto))) res[m[1]] = m[2];
  return res;
}

/** Lee Metadata/slice_info.config: tiempo, peso y filamento usado por placa. */
export function leerSliceInfo(xml) {
  const placas = [];
  const rePlaca = /<plate>([\s\S]*?)<\/plate>/g;
  let mp;
  while ((mp = rePlaca.exec(xml))) {
    const cuerpo = mp[1];
    const meta = {};
    const reMeta = /<metadata\s+key="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
    let mm;
    while ((mm = reMeta.exec(cuerpo))) meta[mm[1]] = mm[2];

    const filamentos = [];
    const reFil = /<filament\s([^>]*?)\/>/g;
    let mf;
    while ((mf = reFil.exec(cuerpo))) {
      const a = atributos(mf[1]);
      filamentos.push({
        id: parseInt(a.id, 10),
        tipo: a.type || null,
        color: a.color || null,
        metros: parseFloat(a.used_m),
        gramos: parseFloat(a.used_g),
        paraPieza: a.used_for_object !== 'false',
        paraSoporte: a.used_for_support === 'true',
      });
    }
    placas.push({
      indice: parseInt(meta.index, 10),
      tiempoSeg: meta.prediction ? parseFloat(meta.prediction) : null,
      gramos: meta.weight ? parseFloat(meta.weight) : null,
      soportes: meta.support_used === 'true',
      filamentos,
    });
  }
  return placas;
}
