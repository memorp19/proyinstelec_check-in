/**
 * La fecha y la hora de México, del reloj del servidor.
 *
 * Vercel corre en UTC. Con el reloj tal cual, «hoy» empieza a las 18:00 de
 * México: después de esa hora una jornada abierta en la mañana ya era «de
 * ayer», un check-in a las 9:00 se llamaba `checkin_1500`, y la foto caía en
 * la carpeta del día siguiente.
 *
 * Sin dependencias de Node ni del navegador.
 */

const ZONA = "America/Mexico_City";

const EN_MEXICO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partes(instante: Date) {
  const p = Object.fromEntries(EN_MEXICO.formatToParts(instante).map((x) => [x.type, x.value]));
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
    texto: { anio: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute },
  };
}

/** La fecha (`aaaa-mm-dd`) y la hora (`HHMM`) en México de un instante. */
export function ahoraEnMexico(ahora: Date = new Date()): { fecha: string; hhmm: string } {
  const { texto } = partes(ahora);
  return { fecha: `${texto.anio}-${texto.mes}-${texto.dia}`, hhmm: `${texto.hora}${texto.minuto}` };
}

/**
 * El instante en que empezó el día de hoy en México (las 00:00 de allá), para
 * comparar contra columnas `timestamp with time zone`.
 *
 * No supone el desfase: lo mide. México no cambia de horario desde 2022, pero
 * si algún día volviera a hacerlo, esto seguiría siendo cierto.
 */
export function inicioDelDiaEnMexico(ahora: Date = new Date()): Date {
  const p = partes(ahora);
  // Lo que marca el reloj de México, leído como si fuera UTC, menos el
  // instante real: el desfase de México en ese momento.
  const relojComoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  const desfase = relojComoUtc - Math.floor(ahora.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.anio, p.mes - 1, p.dia) - desfase);
}
