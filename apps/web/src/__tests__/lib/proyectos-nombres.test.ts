/**
 * Los nombres de los proyectos para la app de campo: una consulta para todos,
 * y nunca el id (un UUID) en pantalla. Todos los datos son inventados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));

import { getDb } from "@/src/db";
import { dbFalso } from "../helpers/db-falso";
import { nombresDeProyectos } from "@/src/lib/proyectos";
import { PROYECTO_SIN_NOMBRE, nombreDeProyecto, nombresDeDemo } from "@/src/lib/nombre-proyecto";

beforeEach(() => vi.clearAllMocks());

describe("nombresDeProyectos", () => {
  it("una sola consulta, sin repetidos, con el nombre y la empresa por id", async () => {
    const db = dbFalso([[{ id: "p-1", nombre: "Subestación Norte", empresa: "Cliente SA" }]]);
    vi.mocked(getDb).mockImplementation(db.getDb as never);

    const nombres = await nombresDeProyectos(["p-1", "p-1", "", "p-borrado"]);

    expect(db.metodos().filter((m) => m === "select")).toHaveLength(1);
    expect(nombres).toEqual({ "p-1": { nombre: "Subestación Norte", empresa: "Cliente SA" } });
  });

  it("sin ids no consulta", async () => {
    const db = dbFalso([]);
    vi.mocked(getDb).mockImplementation(db.getDb as never);

    expect(await nombresDeProyectos([])).toEqual({});
    expect(db.metodos()).toEqual([]);
  });
});

describe("nombreDeProyecto", () => {
  const NOMBRES = { "p-1": { nombre: "Subestación Norte", empresa: "Cliente SA" } };

  it("el nombre, por id", () => {
    expect(nombreDeProyecto(NOMBRES, "p-1")).toBe("Subestación Norte");
  });

  // Antes salía el UUID con los guiones cambiados por espacios.
  it.each([
    ["un proyecto que ya no existe", "3f2a9c1e-7b4d-4c1a-9e2f-123456789abc"],
    ["sin id", null],
  ])("%s: «Proyecto sin nombre», nunca el id", (_caso, id) => {
    expect(nombreDeProyecto(NOMBRES, id)).toBe(PROYECTO_SIN_NOMBRE);
  });

  it("los del modo demo, en la misma forma", () => {
    expect(nombresDeDemo({ "demo-norte": "Subestación Norte" })).toEqual({
      "demo-norte": { nombre: "Subestación Norte", empresa: "" },
    });
  });
});
