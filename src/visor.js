// Visor 3D de los recorridos de extrusión, capa por capa.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute,
  LineSegments, LineBasicMaterial, GridHelper, Color, Vector3, Group,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const FONDO = 0xe8ebe9;

/** Ajusta un color para que se vea sobre el fondo claro (el blanco se vuelve gris, el negro se aclara un poco). */
function colorVisible(hex) {
  const c = new Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const max = 0.72, min = 0.12;
  if (lum > max) c.multiplyScalar(max / lum);
  else if (lum < min) c.lerp(new Color(1, 1, 1), (min - lum) / (1 - lum));
  return c;
}

export function crearVisor(contenedor) {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(FONDO);
  contenedor.innerHTML = '';
  contenedor.appendChild(renderer.domElement);

  const escena = new Scene();
  const camara = new PerspectiveCamera(40, 1, 0.1, 5000);
  const controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = false;
  controles.addEventListener('change', dibujar);

  let grupo = null;
  let lineas = null;
  let inicioCapa = null;
  let segmentos = 0;
  let capa = 1;
  let solo = false;

  const redimensionar = () => {
    const w = contenedor.clientWidth || 300;
    const h = contenedor.clientHeight || 300;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
    dibujar();
  };
  const observador = new ResizeObserver(redimensionar);
  observador.observe(contenedor);

  function dibujar() {
    renderer.render(escena, camara);
  }

  /**
   * @param {object} geo geometría del lector
   * @param {{indice:number,color:string}[]} filamentos
   * @param {{x:number,y:number,z:number}|null} dimensiones
   * @param {{minX:number,maxX:number,minY:number,maxY:number}|null} area cama de la impresora
   */
  function mostrar(geo, filamentos, area) {
    if (grupo) {
      escena.remove(grupo);
      grupo.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    grupo = new Group();
    inicioCapa = geo.inicioCapa;
    segmentos = geo.segmentos;

    // Centro de la pieza (en coordenadas de la impresora)
    const p = geo.puntos;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
    for (let i = 0; i < segmentos; i++) {
      if (geo.tipos[i] !== 0) continue;
      for (let k = 0; k < 2; k++) {
        const j = i * 6 + k * 3;
        const x = p[j], y = p[j + 1], z = p[j + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    // Posiciones: G-code (X, Y, Z arriba) → three.js (X, Y arriba, -Z)
    const pos = new Float32Array(segmentos * 6);
    for (let i = 0; i < segmentos * 2; i++) {
      pos[i * 3] = p[i * 3] - cx;
      pos[i * 3 + 1] = p[i * 3 + 2];
      pos[i * 3 + 2] = -(p[i * 3 + 1] - cy);
    }

    // Colores: color del filamento, sombreado según la dirección del tramo
    // (da sensación de volumen) y una capa sí y otra no un poco más oscura.
    const paleta = [];
    for (const f of filamentos) paleta[f.indice] = colorVisible(f.color);
    const gris = new Color(0x9aa29e);
    const col = new Float32Array(segmentos * 6);
    const luzX = 0.6, luzY = 0.8;
    let capaIdx = 0;
    const c = new Color();
    for (let i = 0; i < segmentos; i++) {
      while (capaIdx + 1 < inicioCapa.length && inicioCapa[capaIdx + 1] <= i) capaIdx++;
      const base = paleta[geo.herramientas[i]] || gris;
      c.copy(base);
      if (geo.tipos[i] === 1) c.lerp(gris, 0.55); // torre de purga, más apagada
      const j = i * 6;
      const dx = p[j + 3] - p[j], dy = p[j + 4] - p[j + 1];
      const largo = Math.hypot(dx, dy) || 1;
      // normal del tramo en el plano XY
      const sombra = 0.62 + 0.38 * Math.abs((-dy / largo) * luzX + (dx / largo) * luzY);
      const factor = sombra * (capaIdx % 2 ? 0.94 : 1);
      col[j] = col[j + 3] = c.r * factor;
      col[j + 1] = col[j + 4] = c.g * factor;
      col[j + 2] = col[j + 5] = c.b * factor;
    }

    const geometria = new BufferGeometry();
    geometria.setAttribute('position', new BufferAttribute(pos, 3));
    geometria.setAttribute('color', new BufferAttribute(col, 3));
    lineas = new LineSegments(geometria, new LineBasicMaterial({ vertexColors: true }));
    grupo.add(lineas);

    // Cama: grilla del tamaño de la impresora (o un poco más grande que la pieza)
    const ancho = area ? Math.max(area.maxX - area.minX, area.maxY - area.minY) : Math.max(maxX - minX, maxY - minY) * 2 + 20;
    const divisiones = Math.max(4, Math.round(ancho / 10));
    const grilla = new GridHelper(ancho, divisiones, 0xc3c9c6, 0xd3d8d5);
    if (area) grilla.position.set((area.minX + area.maxX) / 2 - cx, -0.01, -((area.minY + area.maxY) / 2 - cy));
    grupo.add(grilla);

    escena.add(grupo);

    // Cámara: en diagonal, encuadrando todo lo que se dibuja (pieza y torre)
    let aMinX = Infinity, aMaxX = -Infinity, aMinZ = Infinity, aMaxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
      if (z < aMinZ) aMinZ = z; if (z > aMaxZ) aMaxZ = z;
    }
    const tam = Math.max(aMaxX - aMinX, aMaxZ - aMinZ, maxZ, 10);
    const objetivo = new Vector3((aMinX + aMaxX) / 2, maxZ / 2, (aMinZ + aMaxZ) / 2);
    controles.target.copy(objetivo);
    camara.near = tam / 100;
    camara.far = tam * 60;
    camara.position.set(objetivo.x + tam * 0.9, objetivo.y + tam * 0.8, objetivo.z + tam * 1.3);
    camara.updateProjectionMatrix();
    controles.update();

    capa = inicioCapa.length;
    aplicarRango();
    redimensionar();
  }

  function aplicarRango() {
    if (!lineas || !inicioCapa.length) return;
    const n = inicioCapa.length;
    const k = Math.min(Math.max(capa, 1), n);
    const fin = k < n ? inicioCapa[k] : segmentos;
    const ini = solo ? inicioCapa[k - 1] : 0;
    lineas.geometry.setDrawRange(ini * 2, (fin - ini) * 2);
    dibujar();
  }

  return {
    mostrar,
    totalCapas: () => (inicioCapa ? inicioCapa.length : 0),
    ponerCapa(n) { capa = n; aplicarRango(); },
    soloCapa(v) { solo = v; aplicarRango(); },
    destruir() {
      observador.disconnect();
      controles.dispose();
      renderer.dispose();
    },
  };
}
