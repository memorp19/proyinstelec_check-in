"use client";

import { useState } from "react";

/**
 * «Generar PDF»: el PDF definitivo de una versión en REVISION, desde lo
 * congelado (`/documento/definitivo`).
 *
 * Lo usan el envío al cliente —cuando dice que falta el PDF— y la bandeja del
 * revisor. Tarda unos diez segundos, así que el botón dice lo que está
 * pasando. Al terminar avisa a quien lo puso, para que vuelva a cargar.
 */
export function GenerarPdf({
  cotKey,
  version,
  className,
  onListo,
}: {
  /** `NNN-AAAA`. */
  cotKey: string;
  version: number;
  className: string;
  onListo: (pdfUrl: string) => void;
}) {
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generar() {
    setGenerando(true);
    setError(null);
    try {
      const r = await fetch(`/api/erp/cotizaciones/${cotKey}/documento/definitivo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error ?? "No se pudo generar el PDF");
      onListo(cuerpo.pdfUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button className={className} disabled={generando} onClick={() => void generar()}>
        {generando ? "Generando el PDF…" : "Generar PDF"}
      </button>
      {error && <span className="font-mono text-[10px] text-danger">{error}</span>}
    </span>
  );
}
