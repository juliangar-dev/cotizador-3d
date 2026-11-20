// Lector de G-code: saca los datos de los comentarios del laminador y, además,
// suma las extrusiones (E) de cada movimiento para tener un cálculo propio.
// Es código puro (sin DOM) para poder usarlo en el Web Worker y en las pruebas.

const DENSIDAD_POR_TIPO = {
  PLA: 1.24, PETG: 1.27, PET: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21,
  PA: 1.14, PC: 1.2, PVA: 1.23, HIPS: 1.04, PP: 0.9,
};

// Claves "; clave = valor" que nos interesan (Bambu Studio, OrcaSlicer, PrusaSlicer).
const CLAVES_CONFIG = new Set([
  'layer_height', 'initial_layer_print_height', 'first_layer_height',
  'filament_type', 'filament_colour', 'extruder_colour', 'filament_density',
  'filament_diameter', 'filament_settings_id', 'printer_model', 'nozzle_diameter',
  'printable_area', 'bed_shape', 'enable_prime_tower', 'wipe_tower',
  'filament used [mm]', 'filament used [g]', 'filament used [cm3]',
  'total filament used [g]', 'total filament used for wipe tower [g]',
  'estimated printing time (normal mode)', 'total layers count',
]);

/** Convierte "1d 2h 3m 4s" (o variantes) a segundos. */
export function textoATiempo(texto) {
  if (!texto) return null;
  let seg = 0;
  let encontro = false;
  const re = /(\d+(?:\.\d+)?)\s*([dhms])/gi;
  let m;
  while ((m = re.exec(texto))) {
    encontro = true;
    const v = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    seg += u === 'd' ? v * 86400 : u === 'h' ? v * 3600 : u === 'm' ? v * 60 : v;
  }
  return encontro ? seg : null;
}

function listaNumeros(valor) {
  if (valor == null) return [];
  return String(valor).split(/[;,]/).map((s) => parseFloat(s.trim().replace(/^"|"$/g, ''))).filter((n) => !Number.isNaN(n));
}

function listaTextos(valor) {
  if (valor == null) return [];
  return String(valor).split(/;/).map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s.length);
}

/** Clasifica un tipo de línea del laminador: pieza, torre o purga. */
function categoriaDeTipo(tipo) {
  const t = tipo.toLowerCase();
  if (t.includes('prime tower') || t.includes('wipe tower') || t.includes('prime-tower') || t.includes('wipe_tower')) return 'torre';
  // "Custom" es el G-code de inicio/fin: líneas de purga y limpieza de boquilla.
  if (t === 'custom') return 'purga';
  return 'pieza';
}

// Arreglo de floats que crece solo (para no usar arrays de JS con millones de números).
class Floats {
  constructor(cap = 1 << 16) { this.a = new Float32Array(cap); this.n = 0; }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a); this.a = b;
    }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  final() { return this.a.slice(0, this.n); }
}
class Bytes {
  constructor(cap = 1 << 15) { this.a = new Uint8Array(cap); this.n = 0; }
  push(v) {
    if (this.n >= this.a.length) { const b = new Uint8Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  final() { return this.a.slice(0, this.n); }
}

/**
 * Analiza el texto de un G-code.
 * @param {string} texto
 * @param {{ geometria?: boolean, alProgresar?: (fraccion:number)=>void }} opciones
 */
export function analizarGcode(texto, opciones = {}) {
  const conGeometria = opciones.geometria !== false;
  const alProgresar = opciones.alProgresar;

  const config = {};
  const meta = {}; // datos que vienen escritos en comentarios

  // Si el archivo tiene marcas de cambio de capa, las usamos; si no, separamos por Z.
  const tieneMarcasCapa = texto.includes('; CHANGE_LAYER') || texto.includes(';LAYER_CHANGE') || /\n;LAYER:-?\d/.test(texto);

  // Estado de la máquina
  let x = 0, y = 0, z = 0, e = 0;
  let posRelativa = false; // G91
  let eRelativa = false;   // M83
  let herramienta = 0;
  let avance = 1500;       // mm/min
  // Antes de la primera capa todo es secuencia de inicio (purga), salvo que el
  // archivo no tenga ninguna marca: ahí no hay forma de distinguir y todo es pieza.
  const tieneMarcasTipo = texto.includes('; FEATURE:') || texto.includes(';TYPE:');
  let categoria = tieneMarcasCapa || tieneMarcasTipo ? 'purga' : 'pieza';
  let enPurga = false;     // dentro de "; FLUSH_START" ... "; FLUSH_END"
  let enTorre = false;     // dentro de "; WIPE_TOWER_START" ... "; WIPE_TOWER_END"
  let enCambio = false;    // entre M620 y M621 (cambio de filamento en impresoras Bambu)
  let empezoImpresion = false;

  // Extrusión por herramienta: { pieza, purga, torre } en mm de filamento
  const extrusion = [];
  const sumar = (h, cat, mm) => {
    if (!extrusion[h]) extrusion[h] = { pieza: 0, purga: 0, torre: 0 };
    extrusion[h][cat] += mm;
  };

  let tiempoMovimientos = 0; // estimación propia (sin aceleraciones)
  const caja = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  const alturasCapa = []; // Z de cada capa con extrusión de pieza
  let capasMarcadas = 0;

  // Geometría para el visor
  const puntos = conGeometria ? new Floats() : null;       // 2 vértices por segmento
  const herramientas = conGeometria ? new Bytes() : null;  // herramienta por segmento
  const tiposSeg = conGeometria ? new Bytes() : null;      // 0 pieza, 1 torre, 2 purga
  const inicioCapa = [];   // índice de segmento donde arranca cada capa
  const zCapa = [];
  let segmentos = 0;
  let zCapaActual = null;
  let capaAbierta = false;

  const abrirCapa = (zNueva) => {
    if (!conGeometria) return;
    if (capaAbierta && inicioCapa.length && inicioCapa[inicioCapa.length - 1] === segmentos) {
      // capa vacía: la reemplazamos
      zCapa[zCapa.length - 1] = zNueva;
      return;
    }
    inicioCapa.push(segmentos);
    zCapa.push(zNueva);
    capaAbierta = true;
  };

  const agregarSegmento = (x1, y1, z1, x2, y2, z2) => {
    if (!conGeometria) return;
    if (!tieneMarcasCapa && (zCapaActual === null || Math.abs(z2 - zCapaActual) > 1e-4)) {
      zCapaActual = z2;
      abrirCapa(z2);
    } else if (!capaAbierta) {
      abrirCapa(z2);
    }
    puntos.push3(x1, y1, z1);
    puntos.push3(x2, y2, z2);
    herramientas.push(herramienta);
    tiposSeg.push(categoriaActual() === 'pieza' ? 0 : categoriaActual() === 'torre' ? 1 : 2);
    segmentos++;
  };

  const categoriaActual = () => (enPurga || enCambio ? 'purga' : enTorre ? 'torre' : categoria);

  const ampliarCaja = (px, py, pz) => {
    if (px < caja.minX) caja.minX = px; if (px > caja.maxX) caja.maxX = px;
    if (py < caja.minY) caja.minY = py; if (py > caja.maxY) caja.maxY = py;
    if (pz < caja.minZ) caja.minZ = pz; if (pz > caja.maxZ) caja.maxZ = pz;
  };

  const largo = texto.length;
  let pos = 0;
  let proximoAviso = 0;
  const paso = Math.max(1, Math.floor(largo / 50));

  while (pos < largo) {
    let fin = texto.indexOf('\n', pos);
    if (fin === -1) fin = largo;
    let linea = texto.slice(pos, fin);
    pos = fin + 1;

    if (alProgresar && pos >= proximoAviso) {
      alProgresar(Math.min(1, pos / largo));
      proximoAviso = pos + paso;
    }

    linea = linea.trim();
    if (!linea) continue;

    // ---------- Comentarios ----------
    if (linea.charCodeAt(0) === 59 /* ; */) {
      procesarComentario(linea);
      continue;
    }

    // ---------- Comandos ----------
    const pc = linea.indexOf(';');
    if (pc !== -1) linea = linea.slice(0, pc).trim();
    if (!linea) continue;

    const c0 = linea.charCodeAt(0);
    if (c0 === 71 /* G */) {
      const num = parseInt(linea.slice(1), 10);
      if (num === 0 || num === 1 || num === 2 || num === 3) {
        procesarMovimiento(num, linea);
      } else if (num === 90) {
        posRelativa = false;
      } else if (num === 91) {
        posRelativa = true;
      } else if (num === 92) {
        const p = leerParametros(linea);
        if (p.E !== undefined) e = p.E;
        if (p.X !== undefined) x = p.X;
        if (p.Y !== undefined) y = p.Y;
        if (p.Z !== undefined) z = p.Z;
      }
    } else if (c0 === 77 /* M */) {
      const num = parseInt(linea.slice(1), 10);
      if (num === 82) eRelativa = false;
      else if (num === 83) eRelativa = true;
      else if (linea.startsWith('M620 S')) enCambio = true;
      else if (linea.startsWith('M621 S')) enCambio = false;
    } else if (c0 === 84 /* T */) {
      const num = parseInt(linea.slice(1), 10);
      // T255 / T1000 son comandos especiales de algunas impresoras, no herramientas
      if (!Number.isNaN(num) && num < 64) herramienta = num;
    }
  }

  function leerParametros(l) {
    const p = {};
    const partes = l.split(/\s+/);
    for (let i = 1; i < partes.length; i++) {
      const s = partes[i];
      if (!s) continue;
      const letra = s[0].toUpperCase();
      const v = parseFloat(s.slice(1));
      if (!Number.isNaN(v)) p[letra] = v;
    }
    return p;
  }

  function procesarMovimiento(num, l) {
    const p = leerParametros(l);
    if (p.F !== undefined && p.F > 0) avance = p.F;

    const relXYZ = posRelativa;
    const nx = p.X !== undefined ? (relXYZ ? x + p.X : p.X) : x;
    const ny = p.Y !== undefined ? (relXYZ ? y + p.Y : p.Y) : y;
    const nz = p.Z !== undefined ? (relXYZ ? z + p.Z : p.Z) : z;

    let de = 0;
    if (p.E !== undefined) {
      if (eRelativa || posRelativa) { de = p.E; e += p.E; } else { de = p.E - e; e = p.E; }
    }

    const dx = nx - x, dy = ny - y, dz = nz - z;
    let distancia = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cat = categoriaActual();
    const seMueveXY = dx !== 0 || dy !== 0;

    if (de !== 0) sumar(herramienta, cat, de);

    if ((num === 2 || num === 3) && (p.I !== undefined || p.J !== undefined)) {
      // Arco: lo partimos en tramos rectos
      const cx = x + (p.I || 0), cy = y + (p.J || 0);
      const r = Math.hypot(x - cx, y - cy);
      let a0 = Math.atan2(y - cy, x - cx);
      let a1 = Math.atan2(ny - cy, nx - cx);
      let barrido = a1 - a0;
      if (num === 2) { if (barrido >= 0) barrido -= Math.PI * 2; } // horario
      else if (barrido <= 0) barrido += Math.PI * 2;               // antihorario
      if (Math.abs(nx - x) < 1e-9 && Math.abs(ny - y) < 1e-9) barrido = num === 2 ? -Math.PI * 2 : Math.PI * 2;
      distancia = Math.abs(barrido) * r;
      if (de > 0) {
        const tramos = Math.max(2, Math.min(48, Math.ceil(distancia / 0.8)));
        let px = x, py = y, pz = z;
        for (let i = 1; i <= tramos; i++) {
          const t = i / tramos;
          const ang = a0 + barrido * t;
          const qx = i === tramos ? nx : cx + r * Math.cos(ang);
          const qy = i === tramos ? ny : cy + r * Math.sin(ang);
          const qz = z + (nz - z) * t;
          registrarExtrusion(px, py, pz, qx, qy, qz, cat);
          px = qx; py = qy; pz = qz;
        }
      }
    } else if (de > 0 && seMueveXY) {
      registrarExtrusion(x, y, z, nx, ny, nz, cat);
    }

    if (distancia > 0 && avance > 0) tiempoMovimientos += distancia / (avance / 60);
    else if (de !== 0 && avance > 0) tiempoMovimientos += Math.abs(de) / (avance / 60);

    x = nx; y = ny; z = nz;
  }

  function registrarExtrusion(x1, y1, z1, x2, y2, z2, cat) {
    if (cat === 'pieza') {
      ampliarCaja(x1, y1, z1); ampliarCaja(x2, y2, z2);
      if (!alturasCapa.length || Math.abs(alturasCapa[alturasCapa.length - 1] - z2) > 1e-4) alturasCapa.push(z2);
    }
    // No dibujamos purgas (suelen estar fuera de la cama), sí la torre
    if (cat !== 'purga') agregarSegmento(x1, y1, z1, x2, y2, z2);
  }

  function procesarComentario(l) {
    // Marcas de capa
    if (l.startsWith('; CHANGE_LAYER') || l.startsWith(';LAYER_CHANGE') || /^;LAYER:-?\d/.test(l)) {
      capasMarcadas++;
      empezoImpresion = true;
      if (categoria === 'purga' && !enPurga) categoria = 'pieza';
      if (tieneMarcasCapa) { capaAbierta = false; abrirCapa(z); }
      return;
    }
    if (l.startsWith('; Z_HEIGHT:') || l.startsWith(';Z:')) {
      const v = parseFloat(l.split(':')[1]);
      if (!Number.isNaN(v) && zCapa.length && capaAbierta) zCapa[zCapa.length - 1] = v;
      return;
    }
    // Tipo de línea
    let tipo = null;
    if (l.startsWith('; FEATURE:')) tipo = l.slice(10).trim();
    else if (l.startsWith(';TYPE:')) tipo = l.slice(6).trim();
    if (tipo !== null) {
      empezoImpresion = true;
      categoria = categoriaDeTipo(tipo);
      return;
    }
    if (l.startsWith('; FLUSH_START')) { enPurga = true; return; }
    if (l.startsWith('; FLUSH_END')) { enPurga = false; return; }
    if (l.startsWith('; WIPE_TOWER_START') || l.startsWith('; WIPE_TOWER_FIRST_LAYER_START')) { enTorre = true; return; }
    if (l.startsWith('; WIPE_TOWER_END') || l.startsWith('; WIPE_TOWER_FIRST_LAYER_END')) { enTorre = false; return; }
    if (l.startsWith('; MACHINE_START_GCODE_END') || l.startsWith('; EXECUTABLE_BLOCK_END')) return;
    if (l.startsWith('; MACHINE_END_GCODE_START') || l.startsWith(';End of Gcode') ) { categoria = 'purga'; return; }

    // Encabezado de Bambu Studio
    if (l.startsWith('; model printing time:') || l.includes('total estimated time:')) {
      const m = l.match(/total estimated time:\s*([^;]+)/);
      if (m) meta.tiempoSeg = textoATiempo(m[1]);
      return;
    }
    if (l.startsWith('; total layer number:')) { meta.capas = parseInt(l.split(':')[1], 10); return; }
    if (l.startsWith('; total filament length [mm] :')) { meta.largosMm = listaNumeros(l.split(':')[1]); return; }
    if (l.startsWith('; total filament weight [g] :')) { meta.gramos = listaNumeros(l.split(':')[1]); return; }
    if (l.startsWith('; max_z_height:')) { meta.alturaMax = parseFloat(l.split(':')[1]); return; }
    if (l.startsWith('; filament_density:')) { if (!config.filament_density) config.filament_density = l.split(':')[1].trim(); return; }
    if (l.startsWith('; filament_diameter:')) { if (!config.filament_diameter) config.filament_diameter = l.split(':')[1].trim(); return; }

    // Cura
    if (l.startsWith(';TIME:')) { meta.tiempoSeg = parseFloat(l.slice(6)); return; }
    if (l.startsWith(';LAYER_COUNT:')) { meta.capas = parseInt(l.slice(13), 10); return; }
    if (l.startsWith(';Layer height:')) { config.layer_height = l.slice(14).trim(); return; }
    if (l.startsWith(';Filament used:')) {
      meta.largosMm = listaNumeros(l.slice(15).replace(/m/g, '')).map((v) => v * 1000);
      return;
    }

    // "; clave = valor" (bloque de configuración)
    const igual = l.indexOf(' = ');
    if (igual > 1) {
      const clave = l.slice(1, igual).trim();
      if (CLAVES_CONFIG.has(clave)) config[clave] = l.slice(igual + 3).trim();
    }
  }

  // ---------- Resultados ----------
  // Datos escritos por PrusaSlicer / OrcaSlicer al final del archivo
  if (meta.tiempoSeg == null && config['estimated printing time (normal mode)']) {
    meta.tiempoSeg = textoATiempo(config['estimated printing time (normal mode)']);
  }
  if (!meta.gramos && config['filament used [g]']) meta.gramos = listaNumeros(config['filament used [g]']);
  if (!meta.largosMm && config['filament used [mm]']) meta.largosMm = listaNumeros(config['filament used [mm]']);
  if (meta.capas == null && config['total layers count']) meta.capas = parseInt(config['total layers count'], 10);
  if (config['total filament used for wipe tower [g]']) meta.gramosTorre = parseFloat(config['total filament used for wipe tower [g]']);

  const tipos = listaTextos(config.filament_type);
  const colores = listaTextos(config.filament_colour || config.extruder_colour);
  const densidades = listaNumeros(config.filament_density);
  const diametros = listaNumeros(config.filament_diameter);

  const alturaCapa = parseFloat(config.layer_height) || estimarAlturaCapa(alturasCapa);
  const alturaPrimeraCapa = parseFloat(config.initial_layer_print_height || config.first_layer_height) || null;

  const hayCaja = Number.isFinite(caja.minX);
  const dimensiones = hayCaja
    ? { x: caja.maxX - caja.minX, y: caja.maxY - caja.minY, z: Math.max(caja.maxZ, meta.alturaMax || 0) }
    : null;

  const resultado = {
    config: {
      tipos, colores, densidades, diametros,
      impresora: (config.printer_model || '').replace(/^"|"$/g, '') || null,
      boquilla: parseFloat(config.nozzle_diameter) || null,
      areaImpresion: leerArea(config.printable_area || config.bed_shape),
      perfiles: listaTextos(config.filament_settings_id),
    },
    meta,
    calculado: {
      extrusionMm: extrusion.map((v) => v || { pieza: 0, purga: 0, torre: 0 }),
      tiempoSeg: tiempoMovimientos,
      capas: capasMarcadas || alturasCapa.length,
      alturaCapa,
      alturaPrimeraCapa,
      caja: hayCaja ? caja : null,
      dimensiones,
    },
    geometria: null,
  };

  if (conGeometria) {
    resultado.geometria = {
      puntos: puntos.final(),
      herramientas: herramientas.final(),
      tipos: tiposSeg.final(),
      inicioCapa: Uint32Array.from(inicioCapa),
      zCapa: Float32Array.from(zCapa),
      segmentos,
    };
  }
  return resultado;
}

function leerArea(valor) {
  if (!valor) return null;
  const pts = String(valor).split(',').map((p) => p.split('x').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function estimarAlturaCapa(alturas) {
  if (alturas.length < 3) return null;
  const cuenta = new Map();
  for (let i = 1; i < alturas.length; i++) {
    const d = Math.round((alturas[i] - alturas[i - 1]) * 1000) / 1000;
    if (d > 0) cuenta.set(d, (cuenta.get(d) || 0) + 1);
  }
  let mejor = null, max = 0;
  for (const [d, n] of cuenta) if (n > max) { max = n; mejor = d; }
  return mejor;
}

export function densidadPorTipo(tipo) {
  if (!tipo) return 1.24;
  const t = tipo.toUpperCase();
  for (const clave of Object.keys(DENSIDAD_POR_TIPO)) if (t.startsWith(clave)) return DENSIDAD_POR_TIPO[clave];
  return 1.24;
}

/** mm de filamento → gramos */
export function mmAGramos(mm, diametro = 1.75, densidad = 1.24) {
  const r = diametro / 2;
  return (mm * Math.PI * r * r * densidad) / 1000;
}
