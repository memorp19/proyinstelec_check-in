/**
 * Carga del catálogo de clientes desde la hoja `Clientes` del control.
 *
 * Es la pieza que falta para que la carta de una cotización salga completa: el
 * importador de 2026 escribe la razón social y nada más, así que `direccion`
 * está vacía y no hay un solo contacto. De aquí salen las dos cosas.
 *
 * La regla que gobierna todo el módulo: **solo llena lo que está vacío**. Un
 * dato que ya existe y no coincide no se toca — se reporta. Lo que hay en el
 * ERP pudo corregirlo una persona después de la última carga, y una carga
 * masiva no tiene por qué saber más que ella. Para pisarlo está `sobrescribir`,
 * que es una decisión y no un efecto secundario.
 *
 * Sin base y sin red: todo entra como dato para poder probarlo entero.
 */
import { normalizarNombreContacto, normalizarRazonSocial } from "./clientes";

// ── Lo que trae la hoja ───────────────────────────────────────────────────────

/** Un renglón de la hoja `Clientes`: una persona de contacto, con su empresa. */
export interface FilaClienteExcel {
  /** Renglón en la hoja (base 1), para poder señalarlo en el reporte. */
  fila: number;
  /** `A` y `B`: ids del ERP legacy. Agrupan renglones dentro de la corrida. */
  idEmp: string;
  idCliente: string;
  razonSocial: string;
  contacto: string;
  puesto: string;
  telefono: string;
  correo: string;
  direccion: string;
}

const celda = (valores: string[], i: number) => (valores[i] ?? "").trim();

/**
 * Lee un renglón del rango `Clientes!A2:H`.
 *
 * `A=ID Emp · B=ID Cliente · C=Razón social · D=Contacto · E=Puesto ·
 *  F=Teléfono · G=Correo · H=Dirección`
 *
 * Un renglón **sin contacto pero con razón social sí se lee**, al revés que el
 * importador de Fase 1, que lo descarta. Ahí no importaba porque solo buscaba
 * personas; aquí ese renglón puede ser el único que traiga la dirección, que
 * es justo lo que este script viene a llenar.
 */
export function leerFilaCliente(fila: number, valores: string[]): FilaClienteExcel | null {
  const razonSocial = celda(valores, 2);
  if (!razonSocial) return null;
  return {
    fila,
    idEmp: celda(valores, 0),
    idCliente: celda(valores, 1),
    razonSocial,
    contacto: celda(valores, 3),
    puesto: celda(valores, 4),
    telefono: celda(valores, 5),
    correo: celda(valores, 6),
    direccion: celda(valores, 7),
  };
}

// ── Lo que ya hay en el ERP ───────────────────────────────────────────────────

export interface ContactoEnErp {
  id: string;
  nombre: string;
  nombreNormalizado: string;
  puesto: string | null;
  telefono: string | null;
  correo: string | null;
}

export interface ClienteEnErp {
  id: string;
  razonSocial: string;
  razonNormalizada: string;
  direccion: string | null;
  contactos: ContactoEnErp[];
}

// ── El plan ───────────────────────────────────────────────────────────────────

/** Un campo que estaba vacío en el ERP y se llena con lo que trae la hoja. */
export interface Lleno {
  quien: string;
  campo: string;
  valor: string;
  fila: number;
}

/** Un campo que ya tenía dato y no coincide. Se reporta; se escribe solo con `sobrescribir`. */
export interface Diferencia {
  quien: string;
  campo: string;
  enErp: string;
  enExcel: string;
  fila: number;
  /** True si esta corrida sí la va a escribir (`--sobrescribir`). */
  seEscribe: boolean;
}

export interface ContactoNuevo {
  id: string;
  clienteId: string;
  nombre: string;
  nombreNormalizado: string;
  puesto: string | null;
  telefono: string | null;
  correo: string | null;
  /** Para el reporte. */
  cliente: string;
  fila: number;
}

export interface CambioDeContacto {
  id: string;
  cliente: string;
  nombre: string;
  puesto?: string;
  telefono?: string;
  correo?: string;
}

export interface SinCliente {
  razonSocial: string;
  normalizada: string;
  filas: number[];
}

export interface Plan {
  /** Direcciones que estaban vacías (o que se pisan con `sobrescribir`). */
  direcciones: Array<{ id: string; cliente: string; direccion: string }>;
  contactosNuevos: ContactoNuevo[];
  contactosActualizados: CambioDeContacto[];
  /** Todo lo que se llena, para contarlo y enseñarlo campo por campo. */
  llenos: Lleno[];
  diferencias: Diferencia[];
  /** Razones sociales de la hoja que no existen en el ERP. No se crean. */
  sinCliente: SinCliente[];
  /** Dos renglones para la misma persona de la misma empresa: gana el primero. */
  duplicados: Array<{ quien: string; fila: number; primeraFila: number }>;
  /** Renglones sin razón social, que no son nada. */
  ignoradas: number;
}

/**
 * La parte del teléfono con la que se marca: los últimos diez dígitos.
 *
 * `+ (52) 555 110 4791` y `5551104791` son el mismo número escrito de dos
 * maneras —la lada del país la pone `presentacion.ts` al imprimir—, y marcar
 * eso como diferencia llenaría el reporte de ruido que nadie puede accionar.
 * Lo que importa es que cambie un dígito, 555 contra 556, y eso esto sí lo ve
 * porque cae dentro de los diez. Los valores se reportan tal como vienen.
 *
 * Diez porque en México el número nacional tiene diez dígitos. Si trae menos
 * —una extensión, un teléfono a medio capturar— se comparan todos los que haya.
 */
const paraMarcar = (valor: string) => {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length > 10 ? digitos.slice(-10) : digitos;
};

/** El correo se guarda en minúsculas (igual que `createContacto`), así se compara. */
const normalizarCorreo = (valor: string) => valor.trim().toLowerCase();

/** Dirección y puesto: lo que cambia de verdad, no los espacios de más. */
const aplanar = (valor: string) => valor.replace(/\s+/g, " ").trim();

function mismoValor(campo: string, a: string, b: string): boolean {
  if (campo === "teléfono") return paraMarcar(a) === paraMarcar(b);
  if (campo === "correo") return normalizarCorreo(a) === normalizarCorreo(b);
  return aplanar(a).toLowerCase() === aplanar(b).toLowerCase();
}

/** El valor tal como se va a guardar. */
function paraGuardar(campo: string, valor: string): string {
  return campo === "correo" ? normalizarCorreo(valor) : valor.trim();
}

interface Decision {
  /** El valor a escribir, o null si no se escribe nada. */
  escribir: string | null;
}

/**
 * La regla, en un solo lugar: vacío se llena, distinto se reporta, y solo se
 * pisa si alguien lo pidió.
 */
function decidir(
  campo: string,
  enErp: string | null,
  enExcel: string,
  contexto: { quien: string; fila: number; sobrescribir: boolean },
  plan: { llenos: Lleno[]; diferencias: Diferencia[] },
): Decision {
  const valor = enExcel.trim();
  if (!valor) return { escribir: null };

  const actual = (enErp ?? "").trim();
  if (!actual) {
    plan.llenos.push({ quien: contexto.quien, campo, valor, fila: contexto.fila });
    return { escribir: paraGuardar(campo, valor) };
  }

  if (mismoValor(campo, actual, valor)) return { escribir: null };

  plan.diferencias.push({
    quien: contexto.quien,
    campo,
    enErp: actual,
    enExcel: valor,
    fila: contexto.fila,
    seEscribe: contexto.sobrescribir,
  });
  return { escribir: contexto.sobrescribir ? paraGuardar(campo, valor) : null };
}

/**
 * Qué habría que escribir, sin escribir nada.
 *
 * Los clientes **no se crean**: una razón social que no está en el ERP se
 * reporta y se deja pasar. Dar de alta un cliente es una decisión con
 * consecuencias —es a quien se le factura— y la hoja de control no es
 * autoridad suficiente; además, una diferencia de escritura crearía un
 * duplicado del que ya existe.
 */
export function planearCarga(params: {
  filas: FilaClienteExcel[];
  clientes: ClienteEnErp[];
  sobrescribir?: boolean;
  /** Inyectable para que las pruebas no dependan de uuid al azar. */
  nuevoId?: () => string;
}): Plan {
  const sobrescribir = params.sobrescribir ?? false;
  const nuevoId = params.nuevoId ?? (() => crypto.randomUUID());

  const plan: Plan = {
    direcciones: [],
    contactosNuevos: [],
    contactosActualizados: [],
    llenos: [],
    diferencias: [],
    sinCliente: [],
    duplicados: [],
    ignoradas: 0,
  };

  const porNorm = new Map(params.clientes.map((c) => [c.razonNormalizada, c]));
  const sinCliente = new Map<string, SinCliente>();

  // El estado que se va acumulando a lo largo de la corrida: la hoja trae un
  // renglón por contacto, así que una misma empresa aparece varias veces y la
  // segunda tiene que ver lo que decidió la primera.
  const direccionDe = new Map<string, string | null>();
  const contactosDe = new Map<string, Map<string, { id: string; nombre: string; fila: number }>>();
  const cambiosDe = new Map<string, CambioDeContacto>();

  for (const cliente of params.clientes) {
    direccionDe.set(cliente.id, cliente.direccion);
    contactosDe.set(
      cliente.id,
      new Map(
        cliente.contactos.map((c) => [c.nombreNormalizado, { id: c.id, nombre: c.nombre, fila: 0 }]),
      ),
    );
  }

  for (const f of params.filas) {
    const norm = normalizarRazonSocial(f.razonSocial);
    if (!norm) {
      plan.ignoradas++;
      continue;
    }

    const cliente = porNorm.get(norm);
    if (!cliente) {
      const ya = sinCliente.get(norm);
      if (ya) ya.filas.push(f.fila);
      else sinCliente.set(norm, { razonSocial: f.razonSocial, normalizada: norm, filas: [f.fila] });
      continue;
    }

    // ── La dirección, que es del cliente y no de la persona ──────────────────
    const decision = decidir(
      "dirección",
      direccionDe.get(cliente.id) ?? null,
      f.direccion,
      { quien: cliente.razonSocial, fila: f.fila, sobrescribir },
      plan,
    );
    if (decision.escribir !== null) {
      direccionDe.set(cliente.id, decision.escribir);
      const yaPlaneada = plan.direcciones.find((d) => d.id === cliente.id);
      if (yaPlaneada) yaPlaneada.direccion = decision.escribir;
      else
        plan.direcciones.push({
          id: cliente.id,
          cliente: cliente.razonSocial,
          direccion: decision.escribir,
        });
    }

    if (!f.contacto) continue;

    // ── La persona ───────────────────────────────────────────────────────────
    const nombreNorm = normalizarNombreContacto(f.contacto);
    if (!nombreNorm) continue;

    const quien = `${cliente.razonSocial} · ${f.contacto}`;
    const existentes = contactosDe.get(cliente.id)!;
    const existente = existentes.get(nombreNorm);

    if (!existente) {
      const id = nuevoId();
      plan.contactosNuevos.push({
        id,
        clienteId: cliente.id,
        nombre: f.contacto,
        nombreNormalizado: nombreNorm,
        puesto: f.puesto.trim() || null,
        telefono: f.telefono.trim() || null,
        correo: normalizarCorreo(f.correo) || null,
        cliente: cliente.razonSocial,
        fila: f.fila,
      });
      // Queda registrado para que un segundo renglón de la misma persona no
      // la agregue dos veces.
      existentes.set(nombreNorm, { id, nombre: f.contacto, fila: f.fila });
      continue;
    }

    // Ya lo dio de alta esta misma corrida: es un renglón repetido en la hoja.
    if (existente.fila > 0) {
      plan.duplicados.push({ quien, fila: f.fila, primeraFila: existente.fila });
      continue;
    }

    const enErp = cliente.contactos.find((c) => c.nombreNormalizado === nombreNorm)!;
    const cambio: CambioDeContacto =
      cambiosDe.get(existente.id) ??
      ({ id: existente.id, cliente: cliente.razonSocial, nombre: enErp.nombre } as CambioDeContacto);

    const campos: Array<[string, string | null, string, keyof CambioDeContacto]> = [
      ["puesto", enErp.puesto, f.puesto, "puesto"],
      ["teléfono", enErp.telefono, f.telefono, "telefono"],
      ["correo", enErp.correo, f.correo, "correo"],
    ];

    let tocado = false;
    for (const [campo, actual, entrante, llave] of campos) {
      const d = decidir(campo, actual, entrante, { quien, fila: f.fila, sobrescribir }, plan);
      if (d.escribir !== null) {
        (cambio[llave] as string) = d.escribir;
        tocado = true;
      }
    }

    if (tocado && !cambiosDe.has(existente.id)) {
      cambiosDe.set(existente.id, cambio);
      plan.contactosActualizados.push(cambio);
    }
  }

  plan.sinCliente = [...sinCliente.values()];
  return plan;
}

// ── Las escrituras ────────────────────────────────────────────────────────────

/**
 * La forma de `sql` del driver HTTP de Neon: una etiqueta de plantilla.
 * Igual que en `importacion-2026.ts`, cada función devuelve la consulta sin
 * ejecutarla, para que el guion arme el lote y lo mande en una transacción.
 */
type ConsultaSql<T> = (plantilla: TemplateStringsArray, ...valores: unknown[]) => T;

export function actualizarDireccion<T>(
  sql: ConsultaSql<T>,
  c: { id: string; direccion: string },
): T {
  return sql`UPDATE clientes SET direccion = ${c.direccion}, updated_at = now() WHERE id = ${c.id}`;
}

/**
 * El alta de un contacto, con `ON CONFLICT` sobre el índice único
 * `(cliente_id, nombre_normalizado)`: si alguien lo agregó entre la lectura y
 * la escritura, la carga no se cae — y tampoco pisa lo que ese alguien puso,
 * que es la misma regla de todo el módulo.
 */
export function insertarContacto<T>(
  sql: ConsultaSql<T>,
  c: {
    id: string;
    clienteId: string;
    nombre: string;
    nombreNormalizado: string;
    puesto: string | null;
    telefono: string | null;
    correo: string | null;
  },
): T {
  return sql`INSERT INTO contactos (id, cliente_id, nombre, nombre_normalizado, puesto, telefono, correo)
     VALUES (${c.id}, ${c.clienteId}, ${c.nombre}, ${c.nombreNormalizado}, ${c.puesto}, ${c.telefono}, ${c.correo})
     ON CONFLICT (cliente_id, nombre_normalizado) DO NOTHING`;
}

/**
 * Actualiza solo los campos que vienen. `COALESCE` no sirve aquí: el valor
 * entrante nunca es null —solo se planean los campos que sí se escriben— y
 * `COALESCE(${null}, puesto)` dejaría el tipo sin inferir.
 */
export function actualizarContacto<T>(
  sql: ConsultaSql<T>,
  c: { id: string; puesto?: string; telefono?: string; correo?: string },
): T[] {
  const consultas: T[] = [];
  if (c.puesto !== undefined) {
    consultas.push(sql`UPDATE contactos SET puesto = ${c.puesto}, updated_at = now() WHERE id = ${c.id}`);
  }
  if (c.telefono !== undefined) {
    consultas.push(sql`UPDATE contactos SET telefono = ${c.telefono}, updated_at = now() WHERE id = ${c.id}`);
  }
  if (c.correo !== undefined) {
    consultas.push(sql`UPDATE contactos SET correo = ${c.correo}, updated_at = now() WHERE id = ${c.id}`);
  }
  return consultas;
}

/** Todas las sentencias del plan, en el orden en que tienen que ir. */
export function sentenciasDelPlan<T>(sql: ConsultaSql<T>, plan: Plan): T[] {
  return [
    ...plan.direcciones.map((d) => actualizarDireccion(sql, d)),
    ...plan.contactosNuevos.map((c) => insertarContacto(sql, c)),
    ...plan.contactosActualizados.flatMap((c) => actualizarContacto(sql, c)),
  ];
}
