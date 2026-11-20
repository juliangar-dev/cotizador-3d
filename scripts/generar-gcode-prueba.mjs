// Genera G-codes chicos de prueba (sin datos de nadie) y lo que se espera leer de ellos.
//  - pruebas/datos/jarron-dos-colores.gcode: dos filamentos, cambios con purga y torre de purga.
//  - pruebas/datos/sin-comentarios.gcode: sólo movimientos, E absoluta, sin metadatos.
// El primero también se copia a public/ como ejemplo para la web.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---------- Jarrón de dos colores ----------
function jarron() {
  const L = [];
  const capas = 40, alto = 0.2, cx = 128, cy = 128, lados = 64;
  const eMm = 0.033; // mm de filamento por mm recorrido (aprox. línea de 0.42 x 0.2)
  const esperado = { capas, alturaCapa: alto, extrusion: [{ pieza: 0, purga: 0, torre: 0 }, { pieza: 0, purga: 0, torre: 0 }] };
  let caja = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

  L.push('; generado para pruebas del Cotizador 3D');
  L.push('; filament_type = PLA;PETG');
  L.push('; filament_colour = #1F6F6B;#E9B44C');
  L.push('; filament_density = 1.24,1.27');
  L.push('; filament_diameter = 1.75,1.75');
  L.push('; layer_height = 0.2');
  L.push('; initial_layer_print_height = 0.2');
  L.push('; nozzle_diameter = 0.4');
  L.push('; printable_area = 0x0,256x0,256x256,0x256');
  L.push('G21', 'G90', 'M83', 'T0');
  // línea de purga de inicio
  L.push('; FEATURE: Custom', 'G1 Z0.3 F600', 'G1 X10 Y10 F6000', 'G1 X100 Y10 E3 F1500');
  esperado.extrusion[0].purga += 3;

  let h = 0;
  for (let c = 0; c < capas; c++) {
    const z = r3((c + 1) * alto);
    L.push(';LAYER_CHANGE', `;Z:${z}`, `G1 Z${z} F600`);
    const nueva = Math.floor(c / 5) % 2;
    if (nueva !== h) {
      // Cambio de filamento con purga
      L.push(`T${nueva}`, '; FLUSH_START', 'G1 E12 F300', 'G1 E8 F300', '; FLUSH_END');
      esperado.extrusion[nueva].purga += 20;
      h = nueva;
    }
    // Pared: polígono con radio que varía con la altura
    const radio = 12 + 4 * Math.sin((c / capas) * Math.PI);
    L.push('; FEATURE: Outer wall');
    let px = cx + radio, py = cy;
    L.push(`G1 X${r3(px)} Y${r3(py)} F9000`);
    for (let i = 1; i <= lados; i++) {
      const a = (i / lados) * Math.PI * 2;
      const nx = r3(cx + radio * Math.cos(a)), ny = r3(cy + radio * Math.sin(a));
      const d = Math.hypot(nx - px, ny - py);
      const e = r3(d * eMm);
      L.push(`G1 X${nx} Y${ny} E${e} F3000`);
      esperado.extrusion[h].pieza += e;
      caja = { minX: Math.min(caja.minX, nx), maxX: Math.max(caja.maxX, nx), minY: Math.min(caja.minY, ny), maxY: Math.max(caja.maxY, ny) };
      px = nx; py = ny;
    }
    // Retracción y vuelta (no cambia el total neto)
    L.push('G1 E-0.8 F2400', 'G1 X170 Y170 F12000', 'G1 E0.8 F2400');
    // Torre de purga: cuadrado de 10 mm
    L.push('; FEATURE: Prime tower');
    const t = [[170, 170], [180, 170], [180, 180], [170, 180], [170, 170]];
    for (let i = 1; i < t.length; i++) {
      const e = r3(10 * eMm);
      L.push(`G1 X${t[i][0]} Y${t[i][1]} E${e} F3000`);
      esperado.extrusion[h].torre += e;
    }
  }
  L.push('; FEATURE: Custom', 'G1 Z20 F600', 'M104 S0', 'M140 S0', 'M84');

  esperado.dimensiones = { x: r3(caja.maxX - caja.minX), y: r3(caja.maxY - caja.minY), z: r3(capas * alto) };
  for (const e of esperado.extrusion) for (const k of Object.keys(e)) e[k] = r3(e[k]);
  return { texto: L.join('\n') + '\n', esperado };
}

// ---------- G-code sin comentarios (E absoluta) ----------
function sinComentarios() {
  const L = ['G21', 'G90', 'M82', 'G92 E0'];
  const capas = 10, alto = 0.3;
  let e = 0;
  for (let c = 0; c < capas; c++) {
    const z = r3(0.3 + c * alto);
    L.push(`G1 Z${z} F600`, 'G1 X50 Y50 F6000');
    for (const [x, y] of [[70, 50], [70, 70], [50, 70], [50, 50]]) {
      e = r3(e + 0.8);
      L.push(`G1 X${x} Y${y} E${e} F2400`);
    }
    // retracción en absoluta
    L.push(`G1 E${r3(e - 1)} F2400`, 'G1 Z' + r3(z + 0.4), `G1 E${e} F2400`);
  }
  return {
    texto: L.join('\n') + '\n',
    esperado: { capas, alturaCapa: alto, extrusionTotal: r3(capas * 4 * 0.8), dimensiones: { x: 20, y: 20, z: r3(0.3 + (capas - 1) * alto) } },
  };
}

const salida = join(raiz, 'pruebas', 'datos');
mkdirSync(salida, { recursive: true });
mkdirSync(join(raiz, 'public'), { recursive: true });

const j = jarron();
writeFileSync(join(salida, 'jarron-dos-colores.gcode'), j.texto);
writeFileSync(join(salida, 'jarron-dos-colores.esperado.json'), JSON.stringify(j.esperado, null, 2) + '\n');
writeFileSync(join(raiz, 'public', 'ejemplo-dos-colores.gcode'), j.texto);

const s = sinComentarios();
writeFileSync(join(salida, 'sin-comentarios.gcode'), s.texto);
writeFileSync(join(salida, 'sin-comentarios.esperado.json'), JSON.stringify(s.esperado, null, 2) + '\n');

console.log('G-codes de prueba generados en pruebas/datos/ y public/');
