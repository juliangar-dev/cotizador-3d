// Cálculo de costo y precio sugerido. Funciones puras (se prueban con npm test).

export const TIPOS_FILAMENTO = ['PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'PLA-CF', 'PETG-CF', 'PA', 'PC', 'Otro'];

/** Busca el precio por kg del tipo; si no hay uno exacto, prueba por prefijo (PLA+ → PLA). */
export function precioPorKg(tipo, precios) {
  if (!tipo) return precios.Otro ?? 0;
  if (precios[tipo] != null) return precios[tipo];
  const t = tipo.toUpperCase();
  const clave = Object.keys(precios).sort((a, b) => b.length - a.length).find((k) => t.startsWith(k.toUpperCase()));
  return clave ? precios[clave] : (precios.Otro ?? 0);
}

/**
 * @param {{ filamentos: {tipo:string, reparto:{pieza:number,purga:number,torre:number}}[], tiempoSeg:number }} impresion
 * @param {{ precios:Record<string,number>, potenciaW:number, tarifaKwh:number, desgasteHora:number, fallasPct:number, margenPct:number }} a
 */
export function calcularCosto(impresion, a) {
  let filamento = 0, purgas = 0;
  for (const f of impresion.filamentos) {
    const porGramo = precioPorKg(f.tipo, a.precios) / 1000;
    filamento += f.reparto.pieza * porGramo;
    purgas += (f.reparto.purga + f.reparto.torre) * porGramo;
  }
  const horas = (impresion.tiempoSeg || 0) / 3600;
  const luz = (a.potenciaW / 1000) * horas * a.tarifaKwh;
  const desgaste = horas * a.desgasteHora;
  const subtotal = filamento + purgas + luz + desgaste;
  const fallas = subtotal * (a.fallasPct / 100);
  const total = subtotal + fallas;
  const precio = total * (1 + a.margenPct / 100);
  return { filamento, purgas, luz, desgaste, fallas, total, precio, ganancia: precio - total, horas };
}
