/**
 * La fecha y la hora de México con el reloj del servidor en UTC, que es como
 * corre Vercel. Los instantes van en UTC para que la prueba no dependa de la
 * zona de la máquina que la corre.
 */
import { describe, it, expect } from "vitest";
import { ahoraEnMexico, inicioDelDiaEnMexico } from "@/src/lib/hora-mexico";

describe("ahoraEnMexico", () => {
  it("de día: la misma fecha, seis horas menos", () => {
    expect(ahoraEnMexico(new Date("2026-11-25T15:09:00Z"))).toEqual({ fecha: "2026-11-25", hhmm: "0909" });
  });

  // El hueco de antes: en UTC ya es el día 26 y el archivo se llamaba _0030.
  it("después de las 18:00 sigue siendo el mismo día en México", () => {
    expect(ahoraEnMexico(new Date("2026-11-26T00:30:00Z"))).toEqual({ fecha: "2026-11-25", hhmm: "1830" });
  });

  // Desde 2022 México no cambia de horario: en verano también son seis horas.
  it("en verano también: sin horario de verano", () => {
    expect(ahoraEnMexico(new Date("2026-07-01T05:59:00Z"))).toEqual({ fecha: "2026-06-30", hhmm: "2359" });
  });

  it("la medianoche es 0000, no 2400", () => {
    expect(ahoraEnMexico(new Date("2026-11-25T06:00:00Z")).hhmm).toBe("0000");
  });
});

describe("inicioDelDiaEnMexico", () => {
  const MEDIANOCHE_DEL_25 = "2026-11-25T06:00:00.000Z";

  it.each([
    ["en la mañana", "2026-11-25T15:09:00Z"],
    // Después de las 18:00 de México ya es el día 26 en UTC: el día sigue siendo el 25.
    ["después de las 18:00", "2026-11-26T00:30:00Z"],
    ["un minuto antes de la medianoche", "2026-11-26T05:59:59Z"],
    ["justo a la medianoche", "2026-11-25T06:00:00Z"],
    ["con milisegundos", "2026-11-25T20:15:30.987Z"],
  ])("%s: las 00:00 de México del día 25", (_caso, ahora) => {
    expect(inicioDelDiaEnMexico(new Date(ahora)).toISOString()).toBe(MEDIANOCHE_DEL_25);
  });

  it("a la medianoche cambia de día", () => {
    expect(inicioDelDiaEnMexico(new Date("2026-11-26T06:00:00Z")).toISOString()).toBe("2026-11-26T06:00:00.000Z");
  });

  it("en verano también son seis horas", () => {
    expect(inicioDelDiaEnMexico(new Date("2026-07-01T05:59:00Z")).toISOString()).toBe("2026-06-30T06:00:00.000Z");
  });
});
