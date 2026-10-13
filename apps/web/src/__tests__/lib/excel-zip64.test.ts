import { describe, it, expect } from "vitest";
import { LibroExcel } from "@/src/lib/excel";

/**
 * Un ZIP con solo su registro final (EOCD), para poder tocar los dos campos
 * que delatan un ZIP64 sin fabricar un archivo de 4 GiB.
 *
 * El EOCD mide 22 bytes: firma, cuatro campos de dos bytes, el número de
 * entradas, el tamaño del índice, su posición y la longitud del comentario.
 */
function eocd({ entradas, posicion }: { entradas: number; posicion: number }): Buffer {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(entradas, 8);
  buf.writeUInt16LE(entradas, 10);
  buf.writeUInt32LE(0, 12);
  buf.writeUInt32LE(posicion, 16);
  buf.writeUInt16LE(0, 20);
  return buf;
}

describe("la guarda de ZIP64", () => {
  /**
   * Cuando un ZIP pasa de 65 535 entradas o de 4 GiB, esos campos se quedan en
   * sus máximos y los de verdad viven en un bloque aparte que este lector no
   * mira. Sin la guarda, el error saldría después y en otro lado —"la hoja
   * COSTOS no tiene datos"—, que es la peor manera de enterarse.
   */
  it("avisa cuando el número de entradas está saturado", () => {
    expect(() => LibroExcel.desdeBuffer(eocd({ entradas: 0xffff, posicion: 0 })))
      .toThrow(/ZIP64/);
  });

  it("avisa cuando la posición del índice está saturada", () => {
    expect(() => LibroExcel.desdeBuffer(eocd({ entradas: 1, posicion: 0xffffffff })))
      .toThrow(/ZIP64/);
  });

  it("y dice qué hacer", () => {
    expect(() => LibroExcel.desdeBuffer(eocd({ entradas: 0xffff, posicion: 0 })))
      .toThrow(/Vuelve a guardarlo desde Excel/);
  });

  /**
   * Un ZIP corriente no se topa con la guarda: pasa de largo y falla más
   * adelante por lo que de verdad le falta —aquí, la hoja—, no por ZIP64.
   */
  it("un ZIP corriente no la activa", () => {
    const libro = LibroExcel.desdeBuffer(eocd({ entradas: 0, posicion: 0 }));
    expect(() => libro.filas("COSTOS")).toThrow(/La hoja "COSTOS" no existe/);
  });

  it("lo que ni siquiera es un ZIP se sigue diciendo como antes", () => {
    expect(() => LibroExcel.desdeBuffer(Buffer.from("esto no es un xlsx")))
      .toThrow(/no es un \.xlsx válido/);
  });
});
