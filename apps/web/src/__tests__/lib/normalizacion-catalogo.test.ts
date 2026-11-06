import { describe, it, expect } from "vitest";
import {
  corregirCliente,
  corregirContacto,
  normalizarDeCliente,
  normalizarDeContacto,
  planearLimpieza,
  type FilaNormalizable,
} from "@/src/lib/normalizacion-catalogo";

/** Datos inventados: el catálogo real no entra al repositorio. */

const cliente = (id: string, texto: string, normalizadoActual: string): FilaNormalizable => ({
  id,
  texto,
  normalizadoActual,
});

const contacto = (
  id: string,
  texto: string,
  normalizadoActual: string,
  grupo = "cli-1",
): FilaNormalizable => ({ id, texto, normalizadoActual, grupo });

describe("planearLimpieza · razones sociales", () => {
  it("corrige la que está en mayúsculas con su sufijo legal", () => {
    const plan = planearLimpieza(
      [
        cliente("c1", "Aceros del Norte S.A. de C.V.", "ACEROS DEL NORTE S.A. DE C.V."),
        cliente("c2", "Minera Sur", "minera sur"),
      ],
      normalizarDeCliente,
    );
    expect(plan.correctas).toBe(1);
    expect(plan.correcciones).toEqual([
      {
        id: "c1",
        texto: "Aceros del Norte S.A. de C.V.",
        antes: "ACEROS DEL NORTE S.A. DE C.V.",
        despues: "aceros del norte",
      },
    ]);
    expect(plan.choques).toEqual([]);
  });

  it("una columna vacía también se corrige", () => {
    const plan = planearLimpieza([cliente("c1", "Minera Sur", "")], normalizarDeCliente);
    expect(plan.correcciones[0].despues).toBe("minera sur");
  });

  /**
   * Dos filas que al limpiarse quedan iguales no son un problema de la
   * limpieza: ya eran duplicados, y la columna sucia los tenía escondidos.
   */
  it("detecta el duplicado que la columna sucia escondía", () => {
    const plan = planearLimpieza(
      [
        cliente("c1", "Aceros del Norte S.A. de C.V.", "ACEROS DEL NORTE S.A. DE C.V."),
        cliente("c2", "ACEROS DEL NORTE, S.A. DE C.V.", "aceros del norte"),
      ],
      normalizarDeCliente,
    );
    expect(plan.choques).toEqual([
      {
        valor: "aceros del norte",
        filas: [
          { id: "c1", texto: "Aceros del Norte S.A. de C.V." },
          { id: "c2", texto: "ACEROS DEL NORTE, S.A. DE C.V." },
        ],
      },
    ]);
  });

  // Una fila que ya estaba bien puede ser con la que choque otra al limpiarse,
  // así que el choque se mide sobre el resultado y no sobre lo que cambia.
  it("el choque cuenta aunque una de las dos ya estuviera correcta", () => {
    const plan = planearLimpieza(
      [
        cliente("c1", "Minera Sur", "minera sur"),
        cliente("c2", "MINERA SUR S.A. de C.V.", "MINERA SUR S.A. DE C.V."),
      ],
      normalizarDeCliente,
    );
    expect(plan.correcciones).toHaveLength(1);
    expect(plan.choques).toHaveLength(1);
  });
});

describe("planearLimpieza · nombres de contacto", () => {
  it("corrige el nombre en mayúsculas y con acentos", () => {
    const plan = planearLimpieza(
      [contacto("p1", "Alberto Díaz", "ALBERTO DÍAZ")],
      normalizarDeContacto,
    );
    expect(plan.correcciones[0]).toMatchObject({ antes: "ALBERTO DÍAZ", despues: "alberto diaz" });
  });

  it("quita el título al normalizar", () => {
    const plan = planearLimpieza(
      [contacto("p1", "ING. Juana Pérez", "ING. JUANA PÉREZ")],
      normalizarDeContacto,
    );
    expect(plan.correcciones[0].despues).toBe("juana perez");
  });

  // La llave es única por cliente, no en toda la tabla: dos personas con el
  // mismo nombre en empresas distintas no chocan.
  it("el mismo nombre en dos clientes distintos no es un choque", () => {
    const plan = planearLimpieza(
      [
        contacto("p1", "Juana Pérez", "JUANA PÉREZ", "cli-1"),
        contacto("p2", "Juana Pérez", "JUANA PÉREZ", "cli-2"),
      ],
      normalizarDeContacto,
    );
    expect(plan.correcciones).toHaveLength(2);
    expect(plan.choques).toEqual([]);
  });

  it("el mismo nombre dentro del mismo cliente sí es un choque", () => {
    const plan = planearLimpieza(
      [
        contacto("p1", "Juana Pérez", "JUANA PÉREZ"),
        contacto("p2", "ING. Juana Perez", "ing juana perez"),
      ],
      normalizarDeContacto,
    );
    expect(plan.choques).toMatchObject([{ valor: "juana perez", grupo: "cli-1" }]);
    expect(plan.choques[0].filas).toHaveLength(2);
  });

  it("una fila sin texto normalizable no entra a los choques", () => {
    const plan = planearLimpieza(
      [contacto("p1", "   ", ""), contacto("p2", "  ", "")],
      normalizarDeContacto,
    );
    expect(plan.choques).toEqual([]);
  });
});

describe("las sentencias", () => {
  const sqlFalso = (p: TemplateStringsArray, ...v: unknown[]) =>
    p.reduce((acc, parte, i) => acc + parte + (i < v.length ? JSON.stringify(v[i]) : ""), "");

  it("cada una toca su tabla y su columna, por id", () => {
    expect(corregirCliente(sqlFalso, { id: "c1", despues: "minera sur" })).toContain(
      "UPDATE clientes SET razon_normalizada",
    );
    expect(corregirContacto(sqlFalso, { id: "p1", despues: "juana perez" })).toContain(
      "UPDATE contactos SET nombre_normalizado",
    );
    expect(corregirContacto(sqlFalso, { id: "p1", despues: "x" })).toContain('WHERE id = "p1"');
  });
});
