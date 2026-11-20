/**
 * Genera el documento y el PDF de una cotización — SIN TOCAR LA BASE.
 *
 * Es la prueba de campo de la generación: hace exactamente lo que hará la
 * ruta de la app, pero **no escribe una sola fila**. En particular no guarda
 * `doc_drive_id` ni `pdf_drive_id`: eso es trabajo de la ruta, y aquí sobra.
 * Lo único que crea está en Drive, y solo en una carpeta de pruebas.
 *
 * Uso, desde la raíz del repo:
 *   pnpm cotizacion:documento --numero=450 --anio=2026
 *   pnpm cotizacion:documento --numero=450 --anio=2026 --version=1
 *
 * Variables: DATABASE_URL (de solo lectura aquí), ERP_COTIZACIONES_FOLDER_ID,
 * ERP_PLANTILLA_DOC_COTIZACION_ID y, en desarrollo, GOOGLE_OAUTH_CLIENTE con
 * el token de `pnpm google:login`.
 *
 * Fuera de producción se niega a escribir si ni la carpeta de destino ni
 * ninguno de sus ancestros dice "prueba" en el nombre.
 */
import { config } from "dotenv";
import { google } from "googleapis";
import {
  documentosDeGoogle,
  exigirCarpetaDePruebas,
  plantillaDeCotizacion,
} from "../apps/web/src/lib/documentos-google";
import { ALCANCES, autenticar, modoDeGoogle } from "../apps/web/src/lib/google-auth";
import { generarDocumento } from "../apps/web/src/lib/cotizador/docs/generar";
import { getArmado } from "../apps/web/src/lib/cotizador-db";
import { contactoParaCarta } from "../apps/web/src/lib/clientes";
import { ensureCarpetaCotizacion, subirArchivoErp } from "../apps/web/src/lib/drive-erp";
import { opcion } from "./guardas";

config({ path: "apps/web/.env.local" });

const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Mide cuánto tarda algo y lo devuelve con el tiempo. */
async function cronometrar<T>(que: string, paso: () => Promise<T>): Promise<T> {
  const arranque = Date.now();
  const valor = await paso();
  console.log(`    ${que}: ${segundos(Date.now() - arranque)}`);
  return valor;
}

async function main() {
  const numero = Number(opcion("numero"));
  const anio = Number(opcion("anio"));
  const version = Number(opcion("version") ?? "0");

  if (!Number.isInteger(numero) || !Number.isInteger(anio)) {
    console.error("❌  Uso: pnpm cotizacion:documento --numero=450 --anio=2026 [--version=0]\n");
    process.exit(1);
  }

  console.log(`\n📄  Cotización ${numero}-${anio} v${version}`);
  console.log(`    Modo de Google: ${modoDeGoogle()}\n`);

  // ── Lo que se va a imprimir, leído de la base ───────────────────────────────
  const armado = await getArmado(numero, anio, version);
  if (!armado) {
    console.error(`❌  No existe la versión ${version} de la cotización ${numero}-${anio}.\n`);
    process.exit(1);
  }
  const { cotizacion, armado: datos, resultado } = armado;

  if (datos.partidas.length === 0) {
    console.error("❌  Esta versión no tiene partidas: no hay documento que generar.\n");
    process.exit(1);
  }

  const { empresa, contacto } = await contactoParaCarta({
    razonSocial: cotizacion.cliente,
    dirigidaA: cotizacion.dirigida_a,
  });

  console.log(`    ${cotizacion.folio} · ${cotizacion.titulo}`);
  console.log(`    ${datos.partidas.length} partida(s) · total ${resultado.total} ${resultado.moneda}\n`);

  // ── La guarda, antes de crear nada ──────────────────────────────────────────
  const raiz = process.env.ERP_COTIZACIONES_FOLDER_ID;
  if (!raiz) {
    console.error("❌  Falta ERP_COTIZACIONES_FOLDER_ID.\n");
    process.exit(1);
  }
  const auth = await autenticar([ALCANCES.DRIVE, ALCANCES.DOCUMENTOS]);
  // Se comprueba la raíz aquí y no solo al copiar: `ensureCarpetaCotizacion`
  // crea el nivel del año y el de la cotización, y esas dos carpetas vacías
  // quedarían en el Drive bueno antes de que nadie se negara a nada.
  await exigirCarpetaDePruebas(google.drive({ version: "v3", auth }), raiz);

  // ── Generar ─────────────────────────────────────────────────────────────────
  console.log("⏱️   Tiempos:");
  const carpeta = await cronometrar("carpeta de la cotización", () =>
    ensureCarpetaCotizacion(numero, anio),
  );

  const generado = await cronometrar("documento + PDF (lo que hará la ruta)", () =>
    generarDocumento(
      {
        numero,
        anio,
        version,
        cliente: cotizacion.cliente,
        titulo: cotizacion.titulo,
        armado: datos,
        calculo: resultado,
        documento: datos.documento,
        condiciones: datos.condiciones,
        direccionContacto: contacto?.direccion,
        direccionCliente: empresa?.direccion,
      },
      {
        documentos: documentosDeGoogle(),
        plantillaId: plantillaDeCotizacion(),
        carpetaId: carpeta.folderId,
        // Nada de papelera: esto es una prueba, no sustituye a lo que ya hubiera.
      },
    ),
  );

  const subido = await cronometrar("subir el PDF a Drive", () =>
    subirArchivoErp({
      folderId: carpeta.folderId,
      filename: generado.pdf.nombre,
      mimeType: generado.pdf.mimeType,
      contenido: generado.pdf.contenido,
    }),
  );

  // ── Lo que hay que mirar ────────────────────────────────────────────────────
  console.log(`\n✅  ${generado.nombre}`);
  console.log(`    ${generado.solicitudes} solicitudes en un solo lote`);
  console.log(`    Fecha del documento: ${generado.fecha}${generado.fechaEsNueva ? " (nueva)" : ""}`);
  console.log(`    PDF: ${Math.round(generado.pdf.contenido.length / 1024)} KB\n`);

  console.log("🔗  Para revisarlo:");
  console.log(`    Documento: https://docs.google.com/document/d/${generado.docId}/edit`);
  console.log(`    PDF:       ${subido.webViewLink}`);
  console.log(`    Carpeta:   ${carpeta.folderUrl}\n`);

  if (generado.avisos.length > 0) {
    console.log(`⚠️   ${generado.avisos.length} aviso(s):`);
    for (const aviso of generado.avisos) console.log(`    · ${aviso}`);
    console.log();
  } else {
    console.log("⚠️   Sin avisos.\n");
  }

  console.log("ℹ️   No se escribió nada en la base. Los archivos quedan en Drive.\n");
}

main().catch((err) => {
  console.error(`\n❌  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
