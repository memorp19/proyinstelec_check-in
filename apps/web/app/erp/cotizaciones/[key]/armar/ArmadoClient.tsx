"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calcularCotizacion,
  entradaDeArmado,
  type Armado,
  type Desfase,
  type ResultadoCotizacion,
  type ServicioCatalogo,
} from "@/src/lib/cotizador";
import { Partidas } from "./secciones/Partidas";
import { Gastos } from "./secciones/Gastos";
import { MonedaYAsesoria } from "./secciones/MonedaYAsesoria";
import { Condiciones } from "./secciones/Condiciones";
import { Documento } from "./secciones/Documento";
import { Totales } from "./secciones/Totales";
import { ActualizarPrecios } from "./secciones/ActualizarPrecios";
import { VistaPrevia } from "./secciones/VistaPrevia";
import { btnGhost, btnPrimary, etiqueta, tarjeta } from "./ui";

// ── Lo que manda la API ───────────────────────────────────────────────────────

interface Cot {
  numero: number;
  anio: number;
  version: number;
  folio: string;
  cliente: string;
  titulo: string;
  estatus: string;
  elaboro: string;
}

interface Respuesta {
  cotizacion: Cot;
  armado: Armado;
  desfases: Desfase[];
  avisos: string[];
  llenadoAutomatico: Array<"contacto" | "textos">;
  congelado: { total: string; letra: string; congeladoAt: string } | null;
  actualizadoEn: string | null;
  acceso: { puedeVer: boolean; puedeEditar: boolean; motivo: string };
  catalogo: ServicioCatalogo[];
}

type Guardado =
  | { estado: "limpio"; hora: string | null }
  | { estado: "pendiente" }
  | { estado: "guardando" }
  | { estado: "error"; motivo: string }
  | { estado: "conflicto" };

/** Lo que se espera a que la gente deje de teclear antes de guardar. */
const ESPERA_AUTOGUARDADO_MS = 2500;

const hora = () => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

export function ArmadoClient({
  cotKey,
  version,
  abrirVistaPrevia = false,
}: {
  cotKey: string;
  version: number;
  /** Se llega desde el botón de la tarjeta: abre directo la vista previa. */
  abrirVistaPrevia?: boolean;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [armado, setArmado] = useState<Armado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<Guardado>({ estado: "limpio", hora: null });
  const [enviando, setEnviando] = useState(false);
  const [resultadoEnvio, setResultadoEnvio] = useState<{ total: number; letra: string; avisos: string[] } | null>(null);
  const [verPrecios, setVerPrecios] = useState(false);
  const [verPrevia, setVerPrevia] = useState(abrirVistaPrevia);

  /**
   * La marca de tiempo del último guardado aceptado. Va en una ref y no en el
   * estado porque el temporizador del autoguardado la lee cuando dispara, y
   * con estado se quedaría con la de cuando se programó.
   */
  const actualizadoEn = useRef<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carga ───────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/erp/cotizaciones/${cotKey}/armado?version=${version}`);
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error ?? "No se pudo cargar");
      setDatos(cuerpo);
      setArmado(cuerpo.armado);
      actualizadoEn.current = cuerpo.actualizadoEn;
      setGuardado({ estado: "limpio", hora: null });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [cotKey, version]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ── Totales en vivo ─────────────────────────────────────────────────────────
  /**
   * Se calculan **en la pantalla**, con el mismo motor que usa el congelado.
   * Es lo que convierte el cotizador en una herramienta de decisión: se ve el
   * efecto de mover una cantidad antes de guardar nada. Y como el motor es
   * puro, los números son los mismos que saldrán al congelar.
   */
  const resultado: ResultadoCotizacion | null = useMemo(
    () => (armado ? calcularCotizacion(entradaDeArmado(armado)) : null),
    [armado],
  );

  // ── Autoguardado ────────────────────────────────────────────────────────────
  const guardar = useCallback(
    async (actual: Armado) => {
      setGuardado({ estado: "guardando" });
      try {
        const r = await fetch(`/api/erp/cotizaciones/${cotKey}/armado`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ armado: actual, actualizadoEn: actualizadoEn.current }),
        });
        const cuerpo = await r.json();
        if (r.status === 409) {
          setGuardado({ estado: "conflicto" });
          return;
        }
        if (!r.ok) throw new Error(cuerpo.error ?? "No se pudo guardar");
        actualizadoEn.current = cuerpo.actualizadoEn;
        setGuardado({ estado: "limpio", hora: hora() });
      } catch (e) {
        setGuardado({ estado: "error", motivo: (e as Error).message });
      }
    },
    [cotKey],
  );

  /** Cada cambio reprograma el guardado: se guarda cuando se deja de teclear. */
  const cambiar = useCallback(
    (siguiente: Armado) => {
      setArmado(siguiente);
      if (!datos?.acceso.puedeEditar) return;
      setGuardado({ estado: "pendiente" });
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => void guardar(siguiente), ESPERA_AUTOGUARDADO_MS);
    },
    [datos?.acceso.puedeEditar, guardar],
  );

  // Lo que esté pendiente al salir de la pantalla se guarda ya.
  useEffect(() => {
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, []);

  const guardarYa = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (armado) await guardar(armado);
  }, [armado, guardar]);

  // ── Mandar a revisión, desde la vista previa ────────────────────────────────
  /**
   * Dos caminos, y el que se toma depende de si hay algo que congelar.
   *
   * Con partidas, la ruta del cotizador: calcula, congela y manda. Sin ellas
   * —las que se cargaron del control de 2026 nunca pasaron por aquí— la ruta
   * de siempre, que solo cambia el estatus. Congelar una cotización vacía
   * guardaría un total de cero y lo daría por bueno.
   */
  const mandarARevision = useCallback(async () => {
    if (!armado) return;
    setEnviando(true);
    setError(null);
    try {
      const sinArmado = armado.partidas.length === 0;
      if (!sinArmado) await guardarYa();

      const ruta = sinArmado
        ? `/api/erp/cotizaciones/${cotKey}/revision`
        : `/api/erp/cotizaciones/${cotKey}/armado/revision`;

      const r = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const cuerpo = await r.json();
      if (!r.ok) throw new Error(cuerpo.error ?? "No se pudo mandar a revisión");

      setVerPrevia(false);
      setResultadoEnvio({
        total: cuerpo.total ?? 0,
        letra: cuerpo.letra ?? "",
        avisos: cuerpo.avisos ?? [],
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }, [armado, cargar, cotKey, guardarYa, version]);

  // ── Dibujo ──────────────────────────────────────────────────────────────────
  if (cargando) {
    return <p className="p-6 font-mono text-sm text-white/40">Cargando la cotización…</p>;
  }
  if (error && !datos) {
    return <p className="p-6 font-mono text-sm text-danger">{error}</p>;
  }
  if (!datos || !armado || !resultado) return null;

  const { cotizacion, acceso, catalogo, desfases, congelado } = datos;
  const soloLectura = !acceso.puedeEditar;

  return (
    <main className="min-h-screen bg-navy text-white pb-24">
      {/* Encabezado */}
      <header className="sticky top-0 z-20 bg-navy/95 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <a href="/erp/cotizaciones" className={btnGhost}>
            ← Cotizaciones
          </a>
          <div className="flex-1 min-w-[200px]">
            <p className="font-mono text-sm text-white">{cotizacion.folio}</p>
            <p className="font-body text-xs text-white/50 truncate">
              {cotizacion.cliente} · {cotizacion.titulo}
            </p>
          </div>
          <EstadoGuardado guardado={guardado} soloLectura={soloLectura} onRecargar={cargar} />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {soloLectura && (
          <div className={`${tarjeta} p-4 bg-amber/10 border-amber/30`}>
            <p className={etiqueta}>Solo lectura</p>
            <p className="font-body text-sm text-amber mt-1">{acceso.motivo}</p>
          </div>
        )}

        {congelado && (
          <div className={`${tarjeta} p-4`}>
            <p className={etiqueta}>Importes congelados</p>
            <p className="font-mono text-sm text-white mt-1">
              ${Number(congelado.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ·{" "}
              {new Date(congelado.congeladoAt).toLocaleString("es-MX")}
            </p>
            <p className="font-body text-xs text-white/50 mt-1">{congelado.letra}</p>
            <p className="font-body text-xs text-white/40 mt-2">
              Es lo que se guardó al mandarla a revisión. Lo de abajo se recalcula al vuelo: si no
              coinciden, el catálogo cambió desde entonces y el documento sigue valiendo el congelado.
            </p>
          </div>
        )}

        {datos.avisos.length > 0 && (
          <div className={`${tarjeta} p-4 bg-amber/10 border-amber/30`}>
            {datos.avisos.map((a, i) => (
              <p key={i} className="font-body text-xs text-amber">
                {a}
              </p>
            ))}
          </div>
        )}

        {desfases.length > 0 && (
          <ActualizarPrecios
            abierto={verPrecios}
            onAbrir={() => setVerPrecios(true)}
            onCerrar={() => setVerPrecios(false)}
            desfases={desfases}
            cotKey={cotKey}
            version={version}
            soloLectura={soloLectura}
            onAplicado={cargar}
          />
        )}

        <Partidas
          armado={armado}
          resultado={resultado}
          catalogo={catalogo}
          soloLectura={soloLectura}
          onCambio={cambiar}
        />

        <Gastos armado={armado} resultado={resultado} catalogo={catalogo} soloLectura={soloLectura} onCambio={cambiar} />

        <MonedaYAsesoria armado={armado} resultado={resultado} soloLectura={soloLectura} onCambio={cambiar} />

        <Totales armado={armado} resultado={resultado} />

        <Condiciones armado={armado} soloLectura={soloLectura} onCambio={cambiar} />

        <Documento
          armado={armado}
          cliente={cotizacion.cliente}
          titulo={cotizacion.titulo}
          soloLectura={soloLectura}
          llenadoAutomatico={datos.llenadoAutomatico ?? []}
          onCambio={cambiar}
        />

        {/* El último paso: leer lo que se va a mandar */}
        {!soloLectura && (
          <div className={`${tarjeta} p-4 flex flex-wrap items-center gap-4`}>
            <div className="flex-1 min-w-[240px]">
              <p className={etiqueta}>Vista previa</p>
              <p className="font-body text-xs text-white/50 mt-1">
                Lo que va a ver el cliente. Desde ahí se manda a revisión, y ahí es donde los
                importes se congelan.
              </p>
            </div>
            <p className="font-mono text-sm text-white">
              ${resultado.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })} {resultado.moneda}
            </p>
            <button className={btnPrimary} onClick={() => setVerPrevia(true)}>
              Vista previa
            </button>
          </div>
        )}

        {verPrevia && (
          <VistaPrevia
            armado={armado}
            resultado={resultado}
            cliente={cotizacion.cliente}
            titulo={cotizacion.titulo}
            folio={cotizacion.folio}
            sinArmado={armado.partidas.length === 0}
            enviando={enviando}
            error={error}
            onCerrar={() => setVerPrevia(false)}
            onMandar={() => void mandarARevision()}
          />
        )}

        {resultadoEnvio && (
          <div className={`${tarjeta} p-4 bg-green/10 border-green/30`}>
            <p className="font-mono text-sm text-green">
              Congelada en ${resultadoEnvio.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
            </p>
            <p className="font-body text-xs text-white/60 mt-1">{resultadoEnvio.letra}</p>
            {resultadoEnvio.avisos.map((a, i) => (
              <p key={i} className="font-body text-xs text-amber mt-1">
                {a}
              </p>
            ))}
          </div>
        )}

        {error && <p className="font-mono text-xs text-danger">{error}</p>}

      </div>
    </main>
  );
}

// ── El indicador de guardado ──────────────────────────────────────────────────

function EstadoGuardado({
  guardado,
  soloLectura,
  onRecargar,
}: {
  guardado: Guardado;
  soloLectura: boolean;
  onRecargar: () => void;
}) {
  if (soloLectura) return <span className="font-mono text-[10px] text-white/30">Solo lectura</span>;

  if (guardado.estado === "conflicto") {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-danger">
          Alguien más la guardó mientras editabas
        </span>
        <button className={btnGhost} onClick={onRecargar}>
          Recargar
        </button>
      </div>
    );
  }
  if (guardado.estado === "error") {
    return <span className="font-mono text-[10px] text-danger">No se guardó: {guardado.motivo}</span>;
  }
  if (guardado.estado === "guardando") {
    return <span className="font-mono text-[10px] text-white/40">Guardando…</span>;
  }
  if (guardado.estado === "pendiente") {
    return <span className="font-mono text-[10px] text-amber">Sin guardar</span>;
  }
  return (
    <span className="font-mono text-[10px] text-white/40">
      {guardado.hora ? `Guardado a las ${guardado.hora}` : "Sin cambios"}
    </span>
  );
}
