// Formatos de números para Argentina.
const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const decimal1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const decimal2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export const plata = (n) => moneda.format(Number.isFinite(n) ? n : 0);
export const gramos = (n) => `${decimal1.format(n || 0)} g`;
export const metros = (n) => `${decimal2.format(n || 0)} m`;
export const mm = (n) => decimal1.format(n || 0);
export const numero = (n) => entero.format(n || 0);
export const porcentaje = (n) => `${entero.format(n || 0)}%`;
export const altura = (n) => (n ? `${decimal2.format(n)} mm` : '—');

export function tiempo(seg) {
  if (!Number.isFinite(seg) || seg <= 0) return '—';
  const totalMin = Math.round(seg / 60);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d) return `${d} d ${h} h ${m} min`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
