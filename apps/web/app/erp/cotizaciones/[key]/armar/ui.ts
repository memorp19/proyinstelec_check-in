/**
 * Las clases que se repiten en la pantalla del cotizador.
 *
 * Están aquí y no sueltas en cada componente porque son el sistema de diseño
 * del ERP aplicado: el día que cambie el borde o el foco, cambia en un lugar.
 */

export const input =
  "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none focus:border-blue";

/** Para cantidades y costos: alineado a la derecha, que es como se leen. */
export const inputNum = `${input} text-right`;

export const btnPrimary =
  "bg-blue text-white font-mono text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-40 active:scale-[0.97] transition-transform min-h-tap";
export const btnGhost =
  "font-mono text-[10px] text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-lg px-3 py-1.5 transition-colors min-h-tap";
export const btnPeligro =
  "font-mono text-[10px] text-danger/70 hover:text-danger border border-danger/20 hover:border-danger/50 rounded-lg px-3 py-1.5 transition-colors min-h-tap";

export const tarjeta = "bg-white/5 border border-white/10 rounded-xl";
export const etiqueta = "font-mono text-[9px] text-white/40 uppercase tracking-widest";

/** Un importe como se lee en la pantalla: 1,046,113.00 */
export const pesos = (n: number): string =>
  n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const conMoneda = (n: number, moneda: string): string => `$${pesos(n)} ${moneda}`;

/**
 * Un número tecleado. El campo vacío NO es cero: es "todavía no".
 *
 * Importa en los costos: un concepto sin costo capturado y uno que de verdad
 * cuesta cero no son lo mismo, y el motor avisa del segundo.
 */
export const aNumero = (v: string): number | null => {
  const t = v.trim().replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
