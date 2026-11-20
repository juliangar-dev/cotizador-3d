import './estilos.css';
import { cargarAjustes, guardarAjustes, borrarAjustes } from './ajustes.js';
import { calcularCosto, precioPorKg, TIPOS_FILAMENTO } from './costos.js';
import * as f from './formato.js';

const $ = (id) => document.getElementById(id);

const estado = {
  ajustes: cargarAjustes(),
  nombre: '',
  placas: [],
  placa: null,
  tipos: {}, // tipo elegido por el usuario para cada filamento (por índice)
  miniaturaUrl: null,
};

// ---------------- Lectura del archivo (Web Worker) ----------------
const worker = new Worker(new URL('./lector/worker.js', import.meta.url), { type: 'module' });
let pedido = 0;

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.id !== pedido) return;
  if (m.tipo === 'progreso') {
    $('progreso-barra').style.width = `${Math.round(m.fraccion * 100)}%`;
    $('progreso-texto').textContent = `${m.etapa}… ${Math.round(m.fraccion * 100)}%`;
  } else if (m.tipo === 'error') {
    terminarCarga();
    mostrarError(m.mensaje);
  } else if (m.tipo === 'listo') {
    terminarCarga();
    recibirResultado(m.resultado);
  }
};
worker.onerror = () => { terminarCarga(); mostrarError('No se pudo leer el archivo.'); };

async function leerArchivo(archivo) {
  if (!archivo) return;
  if (!/\.(gcode|gco|g|3mf)$/i.test(archivo.name)) {
    mostrarError('Elegí un archivo .gcode o .gcode.3mf.');
    return;
  }
  estado.nombre = archivo.name;
  empezarCarga();
  const buffer = await archivo.arrayBuffer();
  pedido++;
  worker.postMessage({ id: pedido, buffer }, [buffer]);
}

function empezarCarga() {
  $('error').hidden = true;
  $('progreso').hidden = false;
  $('progreso-barra').style.width = '0%';
  $('progreso-texto').textContent = 'Leyendo…';
}
function terminarCarga() { $('progreso').hidden = true; }
function mostrarError(texto) { $('error').textContent = texto; $('error').hidden = false; }

$('archivo').addEventListener('change', (e) => leerArchivo(e.target.files[0]));
const zona = $('zona');
['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('activa'); }));
['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove('activa'); }));
zona.addEventListener('drop', (e) => leerArchivo(e.dataTransfer.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

$('probar-ejemplo').addEventListener('click', async () => {
  try {
    const r = await fetch('./ejemplo-dos-colores.gcode');
    const blob = await r.blob();
    leerArchivo(new File([blob], 'ejemplo-dos-colores.gcode'));
  } catch {
    mostrarError('No se pudo cargar el ejemplo.');
  }
});

// ---------------- Resultados ----------------
function recibirResultado(resultado) {
  estado.placas = resultado.placas;
  estado.tipos = {};
  const sel = $('placa');
  sel.innerHTML = '';
  if (resultado.placas.length > 1) {
    for (const p of resultado.placas) sel.add(new Option(`Placa ${p.indice}`, String(p.indice)));
    sel.hidden = false;
  } else {
    sel.hidden = true;
  }
  $('nombre-archivo').textContent = estado.nombre;
  $('resultados').hidden = false;
  mostrarPlaca(resultado.placas[0]);
  $('impresion').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('placa').addEventListener('change', (e) => {
  const p = estado.placas.find((x) => String(x.indice) === e.target.value);
  estado.tipos = {};
  if (p) mostrarPlaca(p);
});

function mostrarPlaca(placa) {
  estado.placa = placa;
  const r = placa.resumen;

  // Miniatura del 3mf
  if (estado.miniaturaUrl) URL.revokeObjectURL(estado.miniaturaUrl);
  estado.miniaturaUrl = null;
  const img = $('miniatura');
  if (placa.miniatura) {
    estado.miniaturaUrl = URL.createObjectURL(new Blob([placa.miniatura], { type: 'image/png' }));
    img.src = estado.miniaturaUrl;
    img.hidden = false;
  } else {
    img.hidden = true;
  }

  const d = r.dimensiones;
  const filas = [
    ['Tiempo estimado', f.tiempo(r.tiempoSeg) + (r.tiempoFuente === 'calculado' ? ' (aprox.)' : '')],
    ['Filamento', `${f.gramos(r.totalGramos)} · ${f.metros(r.filamentos.reduce((s, x) => s + x.metros, 0))}`],
    ['Purgas y torre', f.gramos(r.desperdicioGramos)],
    ['Capas', f.numero(r.capas)],
    ['Altura de capa', f.altura(r.alturaCapa)],
    ['Dimensiones', d ? `${f.mm(d.x)} × ${f.mm(d.y)} × ${f.mm(d.z)} mm` : '—'],
  ];
  if (r.impresora) filas.push(['Impresora', r.impresora]);
  $('datos').innerHTML = filas.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapar(v)}</dd></div>`).join('');

  $('avisos').innerHTML = r.avisos.map((a) => `<li>${escapar(a)}</li>`).join('');

  dibujarFilamentos();
  recalcular();
  mostrarVisor(placa);
}

// ---------------- Visor 3D (se carga aparte, sólo cuando hace falta) ----------------
let visor = null;
let cargaVisor = null;

async function mostrarVisor(placa) {
  const geo = placa.geometria;
  const r = placa.resumen;
  if (!geo || !geo.segmentos) {
    $('lienzo').innerHTML = '<p class="nota">No hay recorridos para mostrar.</p>';
    return;
  }
  try {
    if (!visor) {
      cargaVisor ||= import('./visor.js');
      const { crearVisor } = await cargaVisor;
      visor ||= crearVisor($('lienzo'));
    }
  } catch {
    $('lienzo').innerHTML = '<p class="nota">Tu navegador no pudo abrir el visor 3D.</p>';
    return;
  }
  if (estado.placa !== placa) return;
  visor.mostrar(geo, r.filamentos, r.areaImpresion);
  const total = visor.totalCapas();
  const control = $('capa');
  control.max = String(total);
  control.value = String(total);
  actualizarTextoCapa();
  $('leyenda-visor').innerHTML = r.filamentos.length > 1
    ? r.filamentos.map((x) => `<li><span class="muestra" style="background:${x.color}"></span>${escapar(x.nombre)} · ${escapar(tipoDe(x))}</li>`).join('')
    : '';
}

function actualizarTextoCapa() {
  const total = Number($('capa').max);
  const n = Number($('capa').value);
  const z = estado.placa?.geometria?.zCapa?.[n - 1];
  $('capa-texto').textContent = `Capa ${f.numero(n)} de ${f.numero(total)}${Number.isFinite(z) ? ` · ${f.altura(z)}` : ''}`;
}

$('capa').addEventListener('input', (e) => {
  visor?.ponerCapa(Number(e.target.value));
  actualizarTextoCapa();
});
$('solo-capa').addEventListener('change', (e) => visor?.soloCapa(e.target.checked));

function tipoDe(fil) {
  return estado.tipos[fil.indice] || fil.tipo;
}

function dibujarFilamentos() {
  const r = estado.placa.resumen;
  const cuerpo = $('tabla-filamentos');
  cuerpo.innerHTML = '';
  for (const fil of r.filamentos) {
    const tipo = tipoDe(fil);
    const opciones = new Set([...TIPOS_FILAMENTO, tipo]);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="muestra" style="background:${fil.color}"></span>${escapar(fil.nombre)}
        <select aria-label="Tipo de ${escapar(fil.nombre)}">${[...opciones].map((t) => `<option${t === tipo ? ' selected' : ''}>${escapar(t)}</option>`).join('')}</select></td>
      <td class="num">${f.gramos(fil.reparto.pieza)}</td>
      <td class="num">${f.gramos(fil.reparto.purga + fil.reparto.torre)}</td>
      <td class="num"><strong>${f.gramos(fil.gramos)}</strong><small>${f.metros(fil.metros)}</small></td>`;
    tr.querySelector('select').addEventListener('change', (e) => {
      estado.tipos[fil.indice] = e.target.value;
      recalcular();
    });
    cuerpo.appendChild(tr);
  }
  const deMeta = r.filamentos.every((x) => x.fuente === 'metadatos');
  $('nota-filamentos').textContent = deMeta
    ? 'Totales según el laminador. El reparto entre pieza y purgas sale de sumar las extrusiones del G-code.'
    : 'Calculado sumando las extrusiones del G-code.';
}

// ---------------- Costos ----------------
const SEGMENTOS = [
  { clave: 'filamento', nombre: 'Filamento' },
  { clave: 'purgas', nombre: 'Purgas' },
  { clave: 'luz', nombre: 'Luz' },
  { clave: 'desgaste', nombre: 'Desgaste' },
  { clave: 'fallas', nombre: 'Fallas' },
];

function recalcular() {
  marcarMargen();
  if (!estado.placa) return;
  const r = estado.placa.resumen;
  const filamentos = r.filamentos.map((x) => ({ ...x, tipo: tipoDe(x) }));
  const c = calcularCosto({ filamentos, tiempoSeg: r.tiempoSeg }, estado.ajustes);

  $('precio').textContent = f.plata(c.precio);
  $('precio-detalle').textContent = `Costo ${f.plata(c.total)} · ganancia ${f.plata(c.ganancia)}`;

  const total = c.total || 1;
  const grafico = $('grafico');
  grafico.innerHTML = '';
  $('desglose').innerHTML = '';
  SEGMENTOS.forEach((s, i) => {
    const valor = c[s.clave];
    const pct = (valor / total) * 100;
    if (valor > 0) {
      const seg = document.createElement('span');
      seg.className = `seg seg-${i}`;
      seg.style.flexGrow = String(valor);
      seg.dataset.texto = `${s.nombre}: ${f.plata(valor)} (${f.porcentaje(pct)})`;
      grafico.appendChild(seg);
    }
    const li = document.createElement('li');
    li.innerHTML = `<span class="muestra seg-${i}"></span><span>${s.nombre}<small>${detalleSegmento(s.clave, c, r, filamentos)}</small></span>
      <span class="num">${f.plata(valor)}<small>${f.porcentaje(pct)}</small></span>`;
    $('desglose').appendChild(li);
  });
  const liTotal = document.createElement('li');
  liTotal.className = 'total';
  liTotal.innerHTML = `<span></span><span>Costo total</span><span class="num">${f.plata(c.total)}</span>`;
  $('desglose').appendChild(liTotal);
}

function detalleSegmento(clave, c, r, filamentos) {
  const a = estado.ajustes;
  const pieza = filamentos.reduce((s, x) => s + x.reparto.pieza, 0);
  const purga = filamentos.reduce((s, x) => s + x.reparto.purga + x.reparto.torre, 0);
  const tipos = [...new Set(filamentos.map((x) => x.tipo))];
  const precios = tipos.map((t) => `${t} ${f.plata(precioPorKg(t, a.precios))}/kg`).join(', ');
  switch (clave) {
    case 'filamento': return `${f.gramos(pieza)} · ${precios}`;
    case 'purgas': return purga > 0 ? `${f.gramos(purga)} de purgas, línea de inicio y torre` : 'Sin purgas';
    case 'luz': return `${a.potenciaW} W × ${f.tiempo(r.tiempoSeg)} × ${f.plata(a.tarifaKwh)}/kWh`;
    case 'desgaste': return `${f.plata(a.desgasteHora)}/h de máquina`;
    case 'fallas': return `${a.fallasPct}% extra sobre lo anterior`;
    default: return '';
  }
}

// Globo del gráfico (al pasar el mouse o tocar)
const globo = $('globo');
$('grafico').addEventListener('pointermove', (e) => {
  const seg = e.target.closest('.seg');
  if (!seg) { globo.hidden = true; return; }
  globo.textContent = seg.dataset.texto;
  globo.hidden = false;
  const caja = $('costo').getBoundingClientRect();
  const x = Math.min(Math.max(e.clientX - caja.left, 80), caja.width - 80);
  globo.style.left = `${x}px`;
  globo.style.top = `${e.clientY - caja.top - 44}px`;
});
$('grafico').addEventListener('pointerleave', () => { globo.hidden = true; });

// ---------------- Ajustes ----------------
const CAMPOS = ['potenciaW', 'tarifaKwh', 'desgasteHora', 'fallasPct'];

function dibujarAjustes() {
  const a = estado.ajustes;
  $('precios').innerHTML = TIPOS_FILAMENTO.map((t) => `
    <label>${t}<span class="campo-unidad"><span>$</span><input type="number" min="0" step="500" inputmode="decimal" data-tipo="${t}" value="${a.precios[t]}" /></span></label>`).join('');
  for (const c of CAMPOS) $(c).value = a[c];
  $('margen').value = a.margenPct;
}

$('precios').addEventListener('input', (e) => {
  const t = e.target.dataset.tipo;
  if (!t) return;
  const v = parseFloat(e.target.value);
  estado.ajustes.precios[t] = Number.isFinite(v) && v >= 0 ? v : 0;
  guardarYRecalcular();
});
for (const c of CAMPOS) {
  $(c).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    estado.ajustes[c] = Number.isFinite(v) && v >= 0 ? v : 0;
    guardarYRecalcular();
  });
}
$('margen').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  estado.ajustes.margenPct = Number.isFinite(v) && v >= 0 ? v : 0;
  guardarYRecalcular();
});
$('chips-margen').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-margen]');
  if (!b) return;
  estado.ajustes.margenPct = Number(b.dataset.margen);
  $('margen').value = estado.ajustes.margenPct;
  guardarYRecalcular();
});
$('restablecer').addEventListener('click', () => {
  estado.ajustes = borrarAjustes();
  dibujarAjustes();
  recalcular();
});

function marcarMargen() {
  for (const b of $('chips-margen').querySelectorAll('button')) {
    b.classList.toggle('activo', Number(b.dataset.margen) === estado.ajustes.margenPct);
  }
}

function guardarYRecalcular() {
  guardarAjustes(estado.ajustes);
  recalcular();
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

dibujarAjustes();
marcarMargen();
// Si nunca se tocaron los ajustes, se abren para que la persona cargue sus precios
try { if (!localStorage.getItem('cotizador3d.ajustes.v1')) $('ajustes-detalle').open = true; } catch { $('ajustes-detalle').open = true; }
