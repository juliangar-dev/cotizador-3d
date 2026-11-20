// Punto de entrada del lector: recibe los bytes de un .gcode o .gcode.3mf
// y devuelve el resumen y la geometría de cada placa.
import { strFromU8 } from 'fflate';
import { analizarGcode } from './gcode.js';
import { esZip, leerTresMf } from './tres-mf.js';
import { armarResumen } from './resumen.js';

/**
 * @param {Uint8Array} bytes
 * @param {{ geometria?: boolean, alProgresar?: (f:number, etapa:string)=>void }} opciones
 */
export function procesarArchivo(bytes, opciones = {}) {
  const avisar = opciones.alProgresar || (() => {});

  if (esZip(bytes)) {
    avisar(0, 'Descomprimiendo el proyecto');
    const placas = leerTresMf(bytes);
    if (!placas.length) {
      throw new Error('El .3mf no tiene G-code. Laminá el proyecto y exportalo como "G-code 3mf" (Exportar placa laminada).');
    }
    return {
      formato: '3mf',
      placas: placas.map((p, n) => {
        const texto = strFromU8(p.gcode);
        const g = analizarGcode(texto, {
          geometria: opciones.geometria,
          alProgresar: (f) => avisar((n + f) / placas.length, `Leyendo la placa ${p.indice}`),
        });
        return {
          indice: p.indice,
          resumen: armarResumen(g, p.info, p.json),
          geometria: g.geometria,
          miniatura: p.miniatura,
        };
      }),
    };
  }

  avisar(0, 'Leyendo el G-code');
  const texto = new TextDecoder('utf-8').decode(bytes);
  if (!/^\s*[;GMT]/m.test(texto.slice(0, 5000))) {
    throw new Error('El archivo no parece un G-code.');
  }
  const g = analizarGcode(texto, { geometria: opciones.geometria, alProgresar: (f) => avisar(f, 'Leyendo el G-code') });
  return {
    formato: 'gcode',
    placas: [{ indice: 1, resumen: armarResumen(g), geometria: g.geometria, miniatura: null }],
  };
}
