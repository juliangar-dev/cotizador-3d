// Web Worker: lee el archivo fuera del hilo principal para que la página no se trabe.
import { procesarArchivo, ErrorLector } from './procesar.js';

self.onmessage = (ev) => {
  const { id, buffer } = ev.data;
  try {
    const bytes = new Uint8Array(buffer);
    let ultimo = 0;
    const resultado = procesarArchivo(bytes, {
      alProgresar: (fraccion, etapa) => {
        const ahora = Date.now();
        if (ahora - ultimo > 80 || fraccion >= 1) {
          ultimo = ahora;
          self.postMessage({ id, tipo: 'progreso', fraccion, etapa });
        }
      },
    });

    // Pasamos los buffers sin copiarlos
    const transferibles = [];
    for (const p of resultado.placas) {
      if (p.geometria) {
        transferibles.push(p.geometria.puntos.buffer, p.geometria.herramientas.buffer,
          p.geometria.tipos.buffer, p.geometria.inicioCapa.buffer, p.geometria.zCapa.buffer);
      }
      if (p.miniatura) {
        p.miniatura = p.miniatura.slice();
        transferibles.push(p.miniatura.buffer);
      }
    }
    self.postMessage({ id, tipo: 'listo', resultado }, transferibles);
  } catch (err) {
    // Los errores de las librerías vienen en inglés: mostramos uno propio.
    const mensaje = err instanceof ErrorLector
      ? err.message
      : 'No se pudo leer el archivo. Revisá que esté completo y que sea un .gcode o .gcode.3mf.';
    self.postMessage({ id, tipo: 'error', mensaje });
  }
};
