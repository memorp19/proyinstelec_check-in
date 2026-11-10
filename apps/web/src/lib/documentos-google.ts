/**
 * Lo único de este módulo que habla con Google.
 *
 * Cinco operaciones, ninguna con lógica de negocio. Está separado para que
 * todo lo demás —qué dice el documento, cómo se arma, en qué orden— se pueda
 * escribir y probar sin red, sin llave de cuenta de servicio y sin tocar un
 * Drive de verdad.
 *
 * Al lado de la interfaz vive la implementación real, y en los tests una falsa
 * que guarda los documentos en memoria y **registra las solicitudes que
 * recibe**, que es lo que de verdad se afirma.
 */
import { google, type docs_v1, type drive_v3 } from "googleapis";
import { ALCANCES, autenticar, enProduccion } from "./google-auth";
import { ESCRIBIR_TODAS_LAS_UNIDADES } from "./drive";
import type { DocumentoDocs, Solicitud } from "./cotizador/docs/tipos";

export interface ArchivoExportado {
  nombre: string;
  contenido: Buffer;
  mimeType: string;
}

export interface Documentos {
  /**
   * Copia la plantilla a la carpeta con ese nombre y devuelve el id de la
   * copia. La plantilla es un **Google Doc**, no el `.docx` que
   * `copiarPlantillasCotizacion` deja en la carpeta para llenar a mano.
   */
  copiarPlantilla(params: {
    plantillaId: string;
    nombre: string;
    carpetaId: string;
  }): Promise<{ id: string }>;

  /** El documento completo, como lo devuelve `documents.get`. */
  leerDocumento(id: string): Promise<DocumentoDocs>;

  /**
   * Aplica las solicitudes **en orden, en un solo `batchUpdate`**.
   *
   * En uno solo y no en varios porque la API las aplica como una unidad: si
   * una falla, no queda un documento a medio llenar con el nombre bueno.
   */
  aplicarCambios(id: string, solicitudes: Solicitud[]): Promise<void>;

  exportarPdf(params: { id: string; nombre: string }): Promise<ArchivoExportado>;

  /**
   * A la papelera, nunca borrar.
   *
   * Lo anterior se aparta **después** de tener lo nuevo (`COT_05:399-401`):
   * si algo falla a medio camino, el documento anterior sigue ahí.
   */
  moverAPapelera(id: string): Promise<void>;
}

/**
 * El error que levanta la implementación real cuando falta configuración.
 *
 * Se distingue de un fallo de red a propósito: sin la variable del entorno no
 * hay nada que reintentar, y quien lo vea en la pantalla necesita saber qué
 * configurar y no que "Google no respondió".
 */
export class FaltaConfiguracionDeDocumentos extends Error {
  constructor(variables: string[]) {
    super(
      `Falta ${variables.join(" y ")} para generar el documento. ` +
        "Mientras no esté configurado, la cotización se arma pero no se puede imprimir.",
    );
    this.name = "FaltaConfiguracionDeDocumentos";
  }
}

// ── La guarda de la carpeta ───────────────────────────────────────────────────

/** Sin acentos y en minúsculas: "PRUEBAS", "Pruebas" y "prüebas" son la misma. */
const plano = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Hasta dónde se sube buscando un ancestro que diga "prueba". */
const NIVELES_QUE_SE_MIRAN = 5;

/** `id → nombre`, para no volver a preguntar lo mismo en la misma ejecución. */
const nombresDeCarpeta = new Map<string, { nombre: string; padre: string | null }>();

export function _resetGuardaDeCarpetas() {
  nombresDeCarpeta.clear();
}

async function carpeta(drive: drive_v3.Drive, id: string) {
  const guardado = nombresDeCarpeta.get(id);
  if (guardado) return guardado;
  const res = await drive.files.get({
    fileId: id,
    fields: "name, parents",
    ...ESCRIBIR_TODAS_LAS_UNIDADES,
  });
  const dato = { nombre: res.data.name ?? "", padre: res.data.parents?.[0] ?? null };
  nombresDeCarpeta.set(id, dato);
  return dato;
}

/**
 * Fuera de producción, el ERP solo escribe en una carpeta de pruebas.
 *
 * Se mira la carpeta y **sus ancestros** porque la cotización no aterriza en
 * la raíz configurada sino en `{raíz}/{año}/{NNN-AAAA}`: pedirle a esa que se
 * llame "pruebas" rechazaría todo, y pedírselo solo a la raíz dejaría pasar
 * cualquier id que llegara por otro camino.
 *
 * Va atada al **entorno** y no al modo de autenticación: si algún día hay una
 * llave de cuenta de servicio en un `.env.local`, la guarda tiene que seguir
 * puesta justo en la máquina desde la que no se debe tocar el Drive real.
 */
export async function exigirCarpetaDePruebas(
  drive: drive_v3.Drive,
  carpetaId: string,
): Promise<void> {
  if (enProduccion()) return;

  const vistas: string[] = [];
  let id: string | null = carpetaId;

  for (let nivel = 0; nivel < NIVELES_QUE_SE_MIRAN && id; nivel++) {
    const { nombre, padre }: { nombre: string; padre: string | null } = await carpeta(drive, id);
    if (plano(nombre).includes("prueba")) return;
    vistas.push(nombre || "(sin nombre)");
    id = padre;
  }

  throw new Error(
    `Esto no es producción y la carpeta de destino no parece de pruebas: ${vistas.join(" ← ")}. ` +
      "Ninguna de ellas dice \"prueba\" en el nombre, así que no se escribe nada. " +
      "Apunta ERP_COTIZACIONES_FOLDER_ID a una carpeta de pruebas.",
  );
}

// ── La implementación real ────────────────────────────────────────────────────

async function clientes() {
  const auth = await autenticar([ALCANCES.DRIVE, ALCANCES.DOCUMENTOS]);
  return {
    drive: google.drive({ version: "v3", auth }),
    docs: google.docs({ version: "v1", auth }),
  };
}

/**
 * La implementación sobre `googleapis`.
 *
 * Cinco llamadas y ninguna decisión: todo lo que hay que pensar ya está
 * decidido en las solicitudes que recibe. Si algo de aquí necesitara una
 * condición, estaría en el sitio equivocado.
 */
export function documentosDeGoogle(): Documentos {
  return {
    async copiarPlantilla({ plantillaId, nombre, carpetaId }) {
      const { drive } = await clientes();
      // Antes de copiar, no después: una copia en la carpeta equivocada ya no
      // se deshace sola.
      await exigirCarpetaDePruebas(drive, carpetaId);

      const res = await drive.files.copy({
        fileId: plantillaId,
        requestBody: { name: nombre, parents: [carpetaId] },
        fields: "id",
        ...ESCRIBIR_TODAS_LAS_UNIDADES,
      });
      if (!res.data.id) throw new Error("Drive copió la plantilla pero no devolvió el id.");
      return { id: res.data.id };
    },

    async leerDocumento(id) {
      const { docs } = await clientes();
      const res = await docs.documents.get({ documentId: id });
      // El esquema de `tipos.ts` es un subconjunto del de Google: los campos
      // que no usamos siguen viniendo, y no estorban.
      return res.data as DocumentoDocs;
    },

    async aplicarCambios(id, solicitudes) {
      const { docs } = await clientes();
      await docs.documents.batchUpdate({
        documentId: id,
        requestBody: { requests: solicitudes as unknown as docs_v1.Schema$Request[] },
      });
    },

    async exportarPdf({ id, nombre }) {
      const { drive } = await clientes();
      // `files.export` no acepta supportsAllDrives: no crea ni modifica nada,
      // solo convierte lo que ya se puede leer.
      const res = await drive.files.export(
        { fileId: id, mimeType: "application/pdf" },
        { responseType: "arraybuffer" },
      );
      return {
        nombre: `${nombre}.pdf`,
        contenido: Buffer.from(res.data as ArrayBuffer),
        mimeType: "application/pdf",
      };
    },

    async moverAPapelera(id) {
      const { drive } = await clientes();
      await drive.files.update({
        fileId: id,
        requestBody: { trashed: true },
        ...ESCRIBIR_TODAS_LAS_UNIDADES,
      });
    },
  };
}

/** La plantilla del ERP: una COPIA de la del Apps Script, y un Google Doc. */
export function plantillaDeCotizacion(): string {
  const id = process.env.ERP_PLANTILLA_DOC_COTIZACION_ID?.trim();
  if (!id) throw new FaltaConfiguracionDeDocumentos(["ERP_PLANTILLA_DOC_COTIZACION_ID"]);
  return id;
}
