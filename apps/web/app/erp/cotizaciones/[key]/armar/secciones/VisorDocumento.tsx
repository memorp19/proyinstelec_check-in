"use client";

import { btnGhost, etiqueta, tarjeta } from "../ui";

export interface DocumentoGenerado {
  nombre: string;
  docDriveId: string;
  pdfDriveId: string;
  pdfUrl: string;
  carpetaUrl: string;
  fecha: string;
  avisos: string[];
}

/**
 * El documento recién generado, para mirarlo antes de mandarlo.
 *
 * El PDF se enseña con el visor de Drive y no descargándolo: así se ve el
 * documento **tal como está en la carpeta**, que es el que se le va a adjuntar
 * al cliente. Un PDF descargado aparte podría ser otro y nadie lo notaría.
 *
 * Los avisos van arriba del visor a propósito. Son cosas como «falta el lugar
 * de entrega: sale como ⟨falta⟩», y leerlas **después** de haber ojeado el
 * documento es leerlas cuando ya se decidió que estaba bien.
 */
export function VisorDocumento({
  documento,
  onCerrar,
  onRegenerar,
  generando,
}: {
  documento: DocumentoGenerado;
  onCerrar: () => void;
  onRegenerar: () => void;
  generando: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-navy/90 backdrop-blur-sm overflow-y-auto">
      <div className="max-w-4xl mx-auto my-6 bg-navy border border-white/20 rounded-xl">
        <div className="sticky top-0 bg-navy/95 backdrop-blur border-b border-white/10 px-5 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className={etiqueta}>Cotización generada</p>
            <p className="font-mono text-sm text-white truncate">{documento.nombre}</p>
          </div>
          <button className={btnGhost} onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        <div className="p-5 space-y-4">
          {documento.avisos.length > 0 && (
            <ul className="space-y-1">
              {documento.avisos.map((a, i) => (
                <li key={i} className="font-body text-xs text-amber bg-amber/15 rounded-lg px-3 py-2">
                  {a}
                </li>
              ))}
            </ul>
          )}

          <div className={`${tarjeta} overflow-hidden`}>
            {/* `/preview` y no `/view`: el segundo se niega a salir dentro de
                un iframe y la persona vería un recuadro vacío. */}
            <iframe
              src={`https://drive.google.com/file/d/${documento.pdfDriveId}/preview`}
              title={documento.nombre}
              className="w-full h-[70vh] bg-white/5"
              allow="autoplay"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 min-w-[200px] font-body text-xs text-white/40">
              Con fecha {documento.fecha}. Queda en la carpeta de la cotización; al mandarla a
              revisión es el que se adjunta.
            </p>
            <a className={btnGhost} href={documento.pdfUrl} target="_blank" rel="noreferrer">
              Abrir en Drive
            </a>
            <a className={btnGhost} href={documento.carpetaUrl} target="_blank" rel="noreferrer">
              Ver la carpeta
            </a>
            {/* Rehacerlo desde aquí, sin cerrar: es lo que se quiere después
                de corregir un hueco que acaba de salir en los avisos. */}
            <button className={btnGhost} disabled={generando} onClick={onRegenerar}>
              {generando ? "Generando…" : "Volver a generar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
