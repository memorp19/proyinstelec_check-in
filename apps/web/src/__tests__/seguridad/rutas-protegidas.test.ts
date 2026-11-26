/**
 * Toda ruta de `app/api` exige sesión y permiso antes de tocar nada.
 *
 * Es el equivalente, en el ERP nuevo, de las «funciones públicas sin permiso»
 * de la revisión del 17 nov (A3, A6, A8, M13, B2 y B10): en Apps Script
 * cualquier función sin `_` final se podía llamar desde el navegador, y la
 * protección dependía de que cada una se acordara de revisar el permiso.
 * Aquí pasa lo mismo con las rutas, porque el middleware no las cubre (su
 * `matcher` no incluye `/api`): cada ruta se protege sola.
 *
 * La prueba no lee el código: **llama** a cada método exportado de cada
 * `route.ts` que encuentra en el disco, de modo que una ruta nueva queda
 * cubierta sin que nadie tenga que acordarse de agregarla.
 *
 * - **Sin sesión**: tiene que contestar 401 o 403.
 * - **Con sesión pero sin ningún permiso**, con rol `campo` y con rol
 *   `cliente`: también 401 o 403.
 * - En los dos casos, **sin tocar nada antes**: ni la base, ni Google (Drive,
 *   Docs, correo), ni la red. Una ruta que consulta y después rechaza ya
 *   filtró algo, o ya escribió.
 *
 * Las excepciones van abajo, con su porqué. Una excepción que ya no existe
 * hace fallar la prueba: la lista no puede quedarse con rutas viejas.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

// ── Lo que una ruta no debe tocar antes de revisar quién llama ────────────────

const tocado = vi.hoisted(() => [] as string[]);

vi.mock("@/src/auth", () => ({
  auth: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/src/db", () => ({
  getDb: () => {
    tocado.push("la base");
    throw new Error("La ruta consultó la base antes de revisar la sesión y el permiso");
  },
  _resetDb: () => {},
}));

vi.mock("@/src/lib/google-auth", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/google-auth")>()),
  autenticar: async () => {
    tocado.push("Google");
    throw new Error("La ruta pidió credenciales de Google antes de revisar la sesión y el permiso");
  },
}));

vi.mock("@/src/lib/correo", async (importarReal) => ({
  ...(await importarReal<typeof import("@/src/lib/correo")>()),
  enviarCorreo: async () => {
    tocado.push("el correo");
    throw new Error("La ruta mandó un correo antes de revisar la sesión y el permiso");
  },
}));

import { auth } from "@/src/auth";
/** `auth()` está sobrecargada en Auth.js v5; el cast deja usarla como mock simple. */
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

// ── Las excepciones ───────────────────────────────────────────────────────────

/**
 * Rutas que NO piden un permiso del catálogo, con el porqué.
 *
 * - `nada`: ni sesión. No se llaman en esta prueba.
 * - `sesion`: piden sesión y actúan **solo sobre los datos de quien llama**.
 *   Se prueba que sin sesión contesten 401 sin tocar nada.
 *
 * Agregar una ruta aquí es una decisión de seguridad: va con su porqué y,
 * si deja algo abierto, con su entrada en `docs/seguridad-erp.md`.
 */
const EXCEPCIONES: Record<string, { exige: "nada" | "sesion"; porque: string }> = {
  "auth/[...nextauth]": {
    exige: "nada",
    porque: "Es el inicio de sesión mismo (Auth.js): no puede pedir una sesión que todavía no existe.",
  },
  jornada: {
    exige: "sesion",
    porque:
      "El check-in de campo: ficha quien llama, a su nombre. Un temporal solo ficha en sus " +
      "proyectos asignados, y eso lo revisa la ruta contra la base.",
  },
  "jornada/[jornadaId]": {
    exige: "sesion",
    porque: "El check-out: cierra solo una jornada de quien llama (403 si es de otro).",
  },
  "perfil/actualizar": {
    exige: "sesion",
    porque: "Cambia el apodo de quien llama, y nada más.",
  },
  "perfil/completar": {
    exige: "sesion",
    porque:
      "El alta de un temporal: es justo lo que hace quien todavía no tiene permisos. " +
      "Solo con el perfil incompleto (409 si ya está completo).",
  },
  "perfil/foto": {
    exige: "sesion",
    porque: "La foto de perfil de quien llama; el nombre del archivo lo pone el servidor.",
  },
  "perfil/jornadas": {
    exige: "sesion",
    porque: "Las jornadas de quien llama en un proyecto; nunca las de otro.",
  },
  upload: {
    exige: "sesion",
    porque:
      "La foto del check-in y del check-out de quien llama. Pide sesión porque los temporales " +
      "entran con cualquier cuenta de Google, y además perfil completo, activo y rol campo o " +
      "admin, leídos de la base. La carpeta la decide el servidor: el proyecto (si puede " +
      "fichar en él, o el de su jornada), la fecha y la hora de México, y su nombre " +
      "(docs/seguridad-erp.md §3.4; prueba en api/upload.test.ts).",
  },
};

// ── Las rutas, como están en el disco ─────────────────────────────────────────

const RAIZ_API = fileURLToPath(new URL("../../../app/api", import.meta.url));
const METODOS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** `cotizaciones/[key]/enviar`, relativo a `app/api`, con `/` aunque sea Windows. */
function rutasEn(carpeta: string): string[] {
  const fuera: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const completo = path.join(carpeta, nombre);
    if (statSync(completo).isDirectory()) fuera.push(...rutasEn(completo));
    else if (nombre === "route.ts" || nombre === "route.tsx") {
      fuera.push(path.relative(RAIZ_API, carpeta).split(path.sep).join("/"));
    }
  }
  return fuera.sort();
}

const RUTAS = rutasEn(RAIZ_API);

/** Un valor de prueba para cada segmento dinámico: `[key]` → `key`. */
const VALORES: Record<string, string> = {
  key: "450-2026",
  folio: "OT450260",
  id: "id-de-prueba",
  contactoId: "contacto-de-prueba",
  jornadaId: "jornada-de-prueba",
};

function parametrosDe(ruta: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [, nombre] of ruta.matchAll(/\[([^\]]+)\]/g)) {
    if (!(nombre in VALORES)) {
      throw new Error(
        `La ruta ${ruta} usa [${nombre}]: agrega un valor de prueba para él en VALORES.`,
      );
    }
    params[nombre] = VALORES[nombre];
  }
  return params;
}

function peticion(ruta: string, metodo: string): NextRequest {
  const url = `http://localhost/api/${ruta.replace(/\[([^\]]+)\]/g, (_, n: string) => VALORES[n] ?? n)}`;
  const conCuerpo = metodo !== "GET" && metodo !== "HEAD";
  return new NextRequest(url, {
    method: metodo,
    ...(conCuerpo ? { body: "{}", headers: { "content-type": "application/json" } } : {}),
  });
}

type Manejador = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;
const modulos = new Map<string, Partial<Record<(typeof METODOS)[number], Manejador>>>();

function metodosDe(ruta: string): Array<[string, Manejador]> {
  const m = modulos.get(ruta) ?? {};
  return METODOS.filter((x) => typeof m[x] === "function").map((x) => [x, m[x]!]);
}

/** Llama a la ruta y dice qué contestó y qué tocó, sin dejar que una excepción la esconda. */
async function llamar(ruta: string, metodo: string, manejador: Manejador) {
  tocado.length = 0;
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await manejador(peticion(ruta, metodo), { params: parametrosDe(ruta) });
    status = res.status;
  } catch (e) {
    error = (e as Error).message;
  }
  return { status, error, tocado: [...tocado] };
}

// ── Sesiones ──────────────────────────────────────────────────────────────────

const sinPermisos = (rol: "campo" | "cliente") => ({
  user: {
    id: "usuario-de-prueba",
    email: "alguien@ejemplo.test",
    name: "Usuario de prueba",
    rol,
    tipo: rol === "cliente" ? "cliente" : "planta",
    es_super_admin: false,
    perfil_completo: true,
    odoo_sync: false,
    permisos: [],
  },
  expires: "2099-01-01T00:00:00.000Z",
});

const RECHAZO = [401, 403];

/** Primero lo que tocó, que es lo que más dice; luego si reventó; luego el estado. */
function esRechazoLimpio(
  r: { status: number | null; error: string | null; tocado: string[] },
  quien: string,
) {
  expect(r.tocado, `${quien} tocó ${r.tocado.join(" y ")} antes de rechazar`).toEqual([]);
  expect(r.error, `${quien} reventó en lugar de rechazar`).toBeNull();
  expect(RECHAZO, `${quien} contestó ${r.status} en lugar de 401 o 403`).toContain(r.status);
}

// ── Las pruebas ───────────────────────────────────────────────────────────────

const fetchOriginal = globalThis.fetch;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    tocado.push("la red");
    throw new Error("La ruta salió a la red antes de revisar la sesión y el permiso");
  });
  for (const ruta of RUTAS) {
    if (EXCEPCIONES[ruta]?.exige === "nada") continue;
    const archivo = path.join(RAIZ_API, ruta, "route.ts");
    modulos.set(ruta, await import(/* @vite-ignore */ archivo));
  }
}, 120_000);

afterAll(() => {
  vi.stubGlobal("fetch", fetchOriginal);
});

beforeEach(() => {
  mockAuth.mockReset();
});

describe("las rutas de app/api", () => {
  it("se encuentran en el disco (si esto falla, la prueba no está viendo nada)", () => {
    expect(RUTAS.length).toBeGreaterThan(30);
    expect(RUTAS).toContain("erp/cotizaciones/[key]/aprobar");
  });

  it("cada excepción es de una ruta que todavía existe", () => {
    const viejas = Object.keys(EXCEPCIONES).filter((r) => !RUTAS.includes(r));
    expect(viejas, "Quita de EXCEPCIONES las rutas que ya no existen").toEqual([]);
  });

  it("cada excepción dice por qué", () => {
    for (const [ruta, { porque }] of Object.entries(EXCEPCIONES)) {
      expect(porque.length, `La excepción ${ruta} no explica por qué`).toBeGreaterThan(20);
    }
  });

  it("toda ruta exporta al menos un método", () => {
    const vacias = RUTAS.filter((r) => EXCEPCIONES[r]?.exige !== "nada" && metodosDe(r).length === 0);
    expect(vacias).toEqual([]);
  });
});

describe.each(RUTAS.filter((r) => EXCEPCIONES[r]?.exige !== "nada"))("/api/%s", (ruta) => {
  it("sin sesión, rechaza sin tocar nada", async () => {
    mockAuth.mockResolvedValue(null);
    for (const [metodo, manejador] of metodosDe(ruta)) {
      esRechazoLimpio(await llamar(ruta, metodo, manejador), `${metodo} /api/${ruta} sin sesión`);
    }
  });

  if (EXCEPCIONES[ruta]?.exige === "sesion") return;

  it.each(["campo", "cliente"] as const)(
    "con sesión de rol %s y sin ningún permiso, rechaza sin tocar nada",
    async (rol) => {
      mockAuth.mockResolvedValue(sinPermisos(rol));
      for (const [metodo, manejador] of metodosDe(ruta)) {
        esRechazoLimpio(
          await llamar(ruta, metodo, manejador),
          `${metodo} /api/${ruta} con rol ${rol} y sin permisos`,
        );
      }
    },
  );
});
