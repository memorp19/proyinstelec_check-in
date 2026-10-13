/**
 * La prueba de extremo a extremo del modelo del cotizador: escribe la
 * cotización 068 en la base, la lee de vuelta, la calcula y compara el
 * resultado contra el PDF que recibió el cliente.
 *
 * El motor ya está probado en memoria (`casos-dorados.test.ts`). Lo que esto
 * añade es el viaje por la base: que las columnas `numeric` aguanten los
 * decimales, que los gastos encuentren su partida por el id, que el orden
 * sobreviva al `SELECT` y que el congelado guarde lo que se imprimió. Si el
 * total cambia un centavo, el modelo perdió algo por el camino.
 *
 * Se escribe en una cotización que no existe y nunca va a existir —**9068 del
 * año 2099**— para no tocar ningún dato real. `--limpiar` borra esa y nada más.
 *
 * NO ESCRIBE NADA POR DEFECTO. Sin `--aplicar` solo reporta.
 *
 * Uso, desde la raíz del repositorio:
 *   pnpm prueba:068                                          # qué haría
 *   pnpm prueba:068 --ensayo  --destino=ep-xxx.neon.tech     # escribe y revierte
 *   pnpm prueba:068 --aplicar --destino=ep-xxx.neon.tech     # deja la 9068/2099
 *   pnpm prueba:068 --aplicar --destino=ep-xxx.neon.tech --limpiar   # y la borra
 *
 * Variables: DATABASE_URL y, opcionalmente, PRODUCTION_DATABASE_HOST.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import {
  calcularCotizacion,
  congelar,
  CONDICIONES_POR_OMISION,
  DOCUMENTO_POR_OMISION,
  normalizarCondiciones,
  normalizarDocumento,
  entradaDesdeFilas,
  importeEnLetra,
  type FilaArmado,
  type FilaConcepto,
  type FilaGasto,
  type FilaPartida,
} from "../apps/web/src/lib/cotizador";
// El caso vive con los tests porque es su dato: un script que lo copiara
// tendría su propia versión, y dos copias del mismo caso dorado se separan.
import { ENTRADA_068, PDF_068 } from "../apps/web/src/__tests__/lib/cotizador/casos/068";
import { ejecutarLote, leerBanderas, opcion, verificarDestino } from "./guardas";

config({ path: "apps/web/.env.local" });

/** Un número y un año que no pueden chocar con nada real. */
const NUMERO = 9068;
const ANIO = 2099;
const VERSION = 0;
const FOLIO = `PCOTOP-${NUMERO}-${ANIO}`;
const USUARIO = opcion("usuario") ?? "prueba-068";

const banderas = leerBanderas();
const LIMPIAR = process.argv.includes("--limpiar");

if (!process.env.DATABASE_URL) {
  console.error("❌  Falta DATABASE_URL (apps/web/.env.local)");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const HOST = new URL(process.env.DATABASE_URL).host;

const pesos = (n: number) =>
  n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Lo que se escribe ─────────────────────────────────────────────────────────

/** Ids estables: el mismo caso escrito dos veces da los mismos renglones. */
const idPartida = (id: string) => `t068-p-${id.toLowerCase()}`;
const idConcepto = (p: string, i: number) => `t068-c-${p.toLowerCase()}-${i}`;
const idGasto = (i: number) => `t068-g-${i}`;

function borrar() {
  // El orden importa aunque haya cascada: los conceptos y los gastos cuelgan de
  // la partida, así que la partida se borra al final.
  return [
    sql`DELETE FROM cot_importes WHERE numero = ${NUMERO} AND anio = ${ANIO}`,
    sql`DELETE FROM cot_conceptos WHERE numero = ${NUMERO} AND anio = ${ANIO}`,
    sql`DELETE FROM cot_gastos    WHERE numero = ${NUMERO} AND anio = ${ANIO}`,
    sql`DELETE FROM cot_partidas  WHERE numero = ${NUMERO} AND anio = ${ANIO}`,
    sql`DELETE FROM cot_armado    WHERE numero = ${NUMERO} AND anio = ${ANIO}`,
    sql`DELETE FROM cotizaciones  WHERE numero = ${NUMERO} AND anio = ${ANIO}`,
  ];
}

function escribir() {
  const e = ENTRADA_068;
  const lote: unknown[] = [...borrar()];

  lote.push(sql`
    INSERT INTO cotizaciones
      (numero, anio, version, folio, cliente, titulo, dirigida_a, estatus, elaboro, created_by)
    VALUES
      (${NUMERO}, ${ANIO}, ${VERSION}, ${FOLIO}, ${"PRUEBA DEL COTIZADOR"},
       ${"Caso dorado 068 — prueba del modelo"}, ${"—"}, ${"PROCESO"}, ${"EAOL"}, ${USUARIO})
  `);

  lote.push(sql`
    INSERT INTO cot_armado
      (numero, anio, version, moneda, moneda_gastos, reparto_gastos, asesoria_pct, iva_pct,
       tipo_cambio, tipo_cambio_origen, tipo_cambio_motivo, condiciones, documento, created_by)
    VALUES
      (${NUMERO}, ${ANIO}, ${VERSION}, ${e.moneda}, ${e.monedaGastos ?? e.moneda},
       ${e.reparto ?? "IGUAL"}, ${e.asesoriaPct ?? 0}, ${16},
       ${e.tipoCambio?.valor ?? null}, ${e.tipoCambio?.origen ?? null},
       ${e.tipoCambio?.motivo ?? null},
       ${JSON.stringify(CONDICIONES_POR_OMISION)}, ${JSON.stringify(DOCUMENTO_POR_OMISION)},
       ${USUARIO})
  `);

  for (const p of e.partidas) {
    lote.push(sql`
      INSERT INTO cot_partidas
        (id, numero, anio, version, orden, titulo, cantidad, unidad, ajuste,
         precio_unitario_final, recibe_gastos_generales)
      VALUES
        (${idPartida(p.id)}, ${NUMERO}, ${ANIO}, ${VERSION}, ${p.orden ?? 1}, ${p.titulo ?? ""},
         ${p.cantidad}, ${p.unidad ?? "servicio"}, ${p.ajuste ?? 0},
         ${p.precioUnitarioFinal ?? null}, ${p.recibeGastosGenerales !== false})
    `);

    p.conceptos.forEach((c, i) => {
      lote.push(sql`
        INSERT INTO cot_conceptos
          (id, partida_id, numero, anio, version, codigo, descripcion_libre, cantidad,
           costo, costo_catalogo, utilidad_pct, moneda_costo, orden)
        VALUES
          (${idConcepto(p.id, i)}, ${idPartida(p.id)}, ${NUMERO}, ${ANIO}, ${VERSION},
           ${c.codigo ?? null}, ${c.descripcion ?? null}, ${c.cantidad},
           ${c.costo ?? null}, ${c.costo ?? null}, ${c.utilidadPct ?? 0},
           ${c.monedaCosto ?? null}, ${i + 1})
      `);
    });
  }

  (e.gastos ?? []).forEach((g, i) => {
    const destino = g.destino && g.destino !== "GENERAL" ? idPartida(g.destino.partida) : null;
    lote.push(sql`
      INSERT INTO cot_gastos
        (id, numero, anio, version, codigo, descripcion_libre, cantidad, costo,
         costo_catalogo, utilidad_pct, moneda_costo, destino_partida_id, orden)
      VALUES
        (${idGasto(i)}, ${NUMERO}, ${ANIO}, ${VERSION}, ${g.codigo ?? null},
         ${g.descripcion ?? null}, ${g.cantidad}, ${g.costo}, ${g.costo},
         ${g.utilidadPct ?? 0}, ${g.monedaCosto ?? null}, ${destino}, ${i + 1})
    `);
  });

  return lote;
}

// ── Lo que se lee de vuelta ───────────────────────────────────────────────────

async function releer() {
  const [armado] = (await sql`
    SELECT numero, anio, version, moneda, moneda_gastos, reparto_gastos, asesoria_pct,
           iva_pct, tipo_cambio, tipo_cambio_origen, tipo_cambio_motivo,
           condiciones, documento
      FROM cot_armado
     WHERE numero = ${NUMERO} AND anio = ${ANIO} AND version = ${VERSION}
  `) as FilaArmado[];

  if (!armado) {
    console.error(`\n❌  No hay armado para la ${NUMERO}/${ANIO} v${VERSION} en ${HOST}.\n`);
    process.exit(1);
  }

  // Sin ORDER BY: el orden lo pone `entradaDesdeFilas` con la columna `orden`,
  // y así la prueba también comprueba que lo hace.
  const partidas = (await sql`
    SELECT id, orden, titulo, descripcion, cantidad, unidad, ajuste,
           precio_unitario_final, recibe_gastos_generales, gasto_manual
      FROM cot_partidas
     WHERE numero = ${NUMERO} AND anio = ${ANIO} AND version = ${VERSION}
  `) as FilaPartida[];

  const conceptos = (await sql`
    SELECT id, partida_id, codigo, descripcion_libre, cantidad, unidad, costo,
           costo_catalogo, utilidad_pct, moneda_costo, horas_por_dia, dias_por_semana, ingenieros,
           semanas, tarifa_hora, nodos, base_nodos, orden
      FROM cot_conceptos
     WHERE numero = ${NUMERO} AND anio = ${ANIO} AND version = ${VERSION}
  `) as FilaConcepto[];

  const gastos = (await sql`
    SELECT id, codigo, descripcion_libre, cantidad, costo, costo_catalogo,
           utilidad_pct, moneda_costo, destino_partida_id, orden
      FROM cot_gastos
     WHERE numero = ${NUMERO} AND anio = ${ANIO} AND version = ${VERSION}
  `) as FilaGasto[];

  return { armado, partidas, conceptos, gastos };
}

// ── La comparación ────────────────────────────────────────────────────────────

interface Diferencia {
  que: string;
  pdf: number;
  base: number;
}

function comparar(resultado: ReturnType<typeof calcularCotizacion>): Diferencia[] {
  const fuera: Diferencia[] = [];

  for (const [id, unitario, importe] of PDF_068.partidas) {
    const p = resultado.partidas.find((x) => x.id === idPartida(id));
    if (!p) {
      fuera.push({ que: `partida ${id}`, pdf: unitario, base: 0 });
      continue;
    }
    if (p.precioUnitario !== unitario) fuera.push({ que: `${id} · unitario`, pdf: unitario, base: p.precioUnitario });
    if (p.importe !== importe) fuera.push({ que: `${id} · importe`, pdf: importe, base: p.importe });
  }
  if (resultado.subtotal !== PDF_068.subtotal) fuera.push({ que: "subtotal", pdf: PDF_068.subtotal, base: resultado.subtotal });
  if (resultado.iva !== PDF_068.iva) fuera.push({ que: "IVA", pdf: PDF_068.iva, base: resultado.iva });
  if (resultado.total !== PDF_068.total) fuera.push({ que: "total", pdf: PDF_068.total, base: resultado.total });

  return fuera;
}

// ── Ejecución ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🧪  Caso dorado 068 → cotización ${NUMERO}/${ANIO} v${VERSION}\n`);
  verificarDestino(HOST, banderas, `Este script escribe y borra la cotización ${NUMERO}/${ANIO}`);

  if (LIMPIAR && !banderas.escribe) {
    console.log(`👀  --limpiar borraría la ${NUMERO}/${ANIO} y nada más. Falta --aplicar.\n`);
    return;
  }

  if (LIMPIAR) {
    const { aplicado } = await ejecutarLote(sql, borrar(), banderas);
    console.log(
      aplicado
        ? `🧹  Borrada la ${NUMERO}/${ANIO}. No se tocó ninguna otra cotización.\n`
        : `✅  Ensayo del borrado: corrió y revirtió. La ${NUMERO}/${ANIO} sigue ahí.\n`,
    );
    return;
  }

  const lote = escribir();
  console.log(
    `📝  ${ENTRADA_068.partidas.length} partidas · ` +
      `${ENTRADA_068.partidas.reduce((s, p) => s + p.conceptos.length, 0)} conceptos · ` +
      `${(ENTRADA_068.gastos ?? []).length} gastos`,
  );
  console.log(`    ${lote.length} sentencias, en una sola transacción.\n`);

  if (!banderas.escribe) {
    console.log(
      "👀  Solo reporte: no se escribió nada.\n" +
        `    Para la prueba completa:  --aplicar --destino=${HOST}\n`,
    );
    return;
  }

  const { aplicado } = await ejecutarLote(sql, lote, banderas);
  if (!aplicado) {
    console.log(
      `✅  Ensayo correcto: las ${lote.length} sentencias se ejecutaron sin error y la\n` +
        "    transacción revirtió. No quedó nada escrito, así que no hay qué releer.\n" +
        "    Para comparar contra el PDF hace falta --aplicar.\n",
    );
    return;
  }

  // ── De vuelta desde la base ────────────────────────────────────────────────
  const filas = await releer();
  const entrada = entradaDesdeFilas(filas);

  // Los bloques de jsonb también hacen el viaje: se validan al volver, igual
  // que los validaría la pantalla.
  const crudo = filas.armado as unknown as { condiciones: unknown; documento: unknown };
  const condiciones = normalizarCondiciones(crudo.condiciones);
  const documento = normalizarDocumento(crudo.documento);
  for (const aviso of [...condiciones.avisos, ...documento.avisos]) {
    console.log(`    ⚠️  bloque del documento: ${aviso}`);
  }
  if (condiciones.valor.vigenciaDias !== CONDICIONES_POR_OMISION.vigenciaDias) {
    console.log(`    ❌ la vigencia volvió como ${condiciones.valor.vigenciaDias}`);
  }

  const resultado = calcularCotizacion(entrada);
  const letra = importeEnLetra(resultado.total);

  console.log("📊  Lo que salió de la base, contra el PDF:\n");
  console.log("    Partida                         PDF              Base");
  for (const [id, unitario] of PDF_068.partidas) {
    const p = resultado.partidas.find((x) => x.id === idPartida(id));
    const base = p ? p.precioUnitario : 0;
    const marca = base === unitario ? "  " : "❌";
    console.log(`    ${marca} ${id.padEnd(10)} ${pesos(unitario).padStart(16)} ${pesos(base).padStart(17)}`);
  }
  console.log(`\n    ${"Subtotal".padEnd(13)} ${pesos(PDF_068.subtotal).padStart(16)} ${pesos(resultado.subtotal).padStart(17)}`);
  console.log(`    ${"IVA".padEnd(13)} ${pesos(PDF_068.iva).padStart(16)} ${pesos(resultado.iva).padStart(17)}`);
  console.log(`    ${"Total".padEnd(13)} ${pesos(PDF_068.total).padStart(16)} ${pesos(resultado.total).padStart(17)}`);
  console.log(`\n    Letra: ${letra}`);
  if (letra !== PDF_068.letra) console.log(`    ❌ el PDF dice: ${PDF_068.letra}`);

  for (const aviso of resultado.avisos) console.log(`    ⚠️  ${aviso}`);

  const diferencias = comparar(resultado);
  if (diferencias.length) {
    console.log("\n❌  No cuadra con el PDF:");
    for (const d of diferencias) {
      console.log(`    ${d.que}: PDF ${pesos(d.pdf)} · base ${pesos(d.base)} (${pesos(d.base - d.pdf)})`);
    }
    console.log("\n    La 9068/2099 se queda escrita para poder mirarla. --limpiar la borra.\n");
    process.exit(1);
  }

  // ── El congelado ───────────────────────────────────────────────────────────
  const c = congelar({ numero: NUMERO, anio: ANIO, version: VERSION }, entrada, resultado, letra, USUARIO);
  await sql`
    INSERT INTO cot_importes
      (numero, anio, version, congelado_por, resultado, parametros, moneda,
       subtotal, iva, total, letra)
    VALUES
      (${c.numero}, ${c.anio}, ${c.version}, ${c.congeladoPor},
       ${JSON.stringify(c.resultado)}, ${JSON.stringify(c.parametros)}, ${c.moneda},
       ${c.subtotal}, ${c.iva}, ${c.total}, ${c.letra})
    ON CONFLICT (numero, anio, version) DO UPDATE SET
      congelado_at = now(), congelado_por = EXCLUDED.congelado_por,
      resultado = EXCLUDED.resultado, parametros = EXCLUDED.parametros,
      moneda = EXCLUDED.moneda, subtotal = EXCLUDED.subtotal,
      iva = EXCLUDED.iva, total = EXCLUDED.total, letra = EXCLUDED.letra
  `;
  // El monto de la cotización sale del congelado, y queda dicho de dónde vino.
  await sql`
    UPDATE cotizaciones
       SET monto_mxn = ${c.total}, origen_monto = ${"COTIZADOR"}, updated_at = now()
     WHERE numero = ${NUMERO} AND anio = ${ANIO} AND version = ${VERSION}
  `;

  // Y se vuelve a leer lo congelado: lo que importa es que el jsonb devuelva lo
  // mismo que se guardó, no que la escritura no haya fallado.
  const [guardado] = (await sql`
    SELECT total, letra, resultado->'partidas' AS partidas
      FROM cot_importes
     WHERE numero = ${NUMERO} AND anio = ${ANIO} AND version = ${VERSION}
  `) as Array<{ total: string; letra: string; partidas: Array<{ precioUnitario: number }> }>;

  const unitariosGuardados = guardado.partidas.map((p) => p.precioUnitario);
  const unitariosPdf = PDF_068.partidas.map(([, u]) => u);
  const congeladoCuadra =
    Number(guardado.total) === PDF_068.total &&
    guardado.letra === PDF_068.letra &&
    JSON.stringify(unitariosGuardados) === JSON.stringify(unitariosPdf);

  if (!congeladoCuadra) {
    console.log("\n❌  El congelado no devuelve lo que se calculó:");
    console.log(`    total ${guardado.total} · unitarios ${unitariosGuardados.join(", ")}\n`);
    process.exit(1);
  }

  console.log(
    `\n✅  Cuadra al centavo con el PDF, y el congelado devuelve las ${unitariosGuardados.length}\n` +
      "    partidas con el mismo precio unitario.\n" +
      `    La ${NUMERO}/${ANIO} queda escrita para que la revises. Para borrarla:\n` +
      `       pnpm prueba:068 --aplicar --destino=${HOST} --limpiar\n`,
  );
}

main().catch((err) => {
  console.error("\n❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
