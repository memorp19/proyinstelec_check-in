/**
 * El tipo de cambio FIX de Banxico.
 *
 * El FIX (serie `SF43718`) es el que Banxico publica cada día hábil y el que
 * se usa para cotizar: no es el del día que se consulta, es **el del último
 * día hábil publicado**, y por eso la respuesta trae su fecha. Un viernes por
 * la tarde y un sábado devuelven el mismo número, y está bien.
 *
 * Nunca lanza. Si no hay token, si Banxico no contesta o si contesta algo que
 * no se entiende, devuelve el motivo para que la pantalla lo diga y ofrezca
 * capturarlo a mano: una cotización no se detiene porque un servicio externo
 * esté caído.
 */

/** La serie del FIX. No cambia; si cambiara, cambiaría el dato, no el código. */
const SERIE_FIX = "SF43718";
const URL_BASE = "https://www.banxico.org.mx/SieAPIRest/service/v1/series";

/** Más de esto y la pantalla se siente colgada; mejor ofrecer capturarlo. */
const TIEMPO_MAXIMO_MS = 8000;

export type TipoCambioBanxico =
  | { ok: true; valor: number; fecha: string }
  | { ok: false; motivo: string };

interface RespuestaBanxico {
  bmx?: { series?: Array<{ datos?: Array<{ fecha?: string; dato?: string }> }> };
}

/** `13/10/2026` → `2026-10-13`. Banxico lo manda en formato mexicano. */
function fechaIso(fecha: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : fecha.trim();
}

/**
 * El FIX publicado más reciente.
 *
 * El token sale de `BANXICO_TOKEN` (ver `.env.example`); se pide gratis en el
 * SIE de Banxico y es por organización, no por persona.
 */
export async function tipoDeCambioFix(): Promise<TipoCambioBanxico> {
  const token = process.env.BANXICO_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      motivo:
        "No hay token de Banxico configurado (BANXICO_TOKEN). Captura el tipo de cambio a mano.",
    };
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${URL_BASE}/${SERIE_FIX}/datos/oportuno?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      // El FIX cambia una vez al día: pedirlo de nuevo en cada tecla no sirve
      // de nada y sí carga el servicio de Banxico.
      next: { revalidate: 3600 },
    });
  } catch (err) {
    const motivo = err instanceof Error && err.name === "TimeoutError"
      ? "Banxico tardó demasiado en contestar"
      : "No se pudo conectar con Banxico";
    return { ok: false, motivo: `${motivo}. Captura el tipo de cambio a mano.` };
  }

  if (!respuesta.ok) {
    // 401 es el caso que de verdad pasa: un token vencido o mal copiado.
    const detalle = respuesta.status === 401 ? "el token no es válido" : `respondió ${respuesta.status}`;
    return { ok: false, motivo: `Banxico ${detalle}. Captura el tipo de cambio a mano.` };
  }

  let cuerpo: RespuestaBanxico;
  try {
    cuerpo = (await respuesta.json()) as RespuestaBanxico;
  } catch {
    return { ok: false, motivo: "Banxico contestó algo que no se entiende. Captura el tipo de cambio a mano." };
  }

  const dato = cuerpo.bmx?.series?.[0]?.datos?.[0];
  const valor = Number(dato?.dato);
  if (!dato || !Number.isFinite(valor) || valor <= 0) {
    return { ok: false, motivo: "Banxico no trae un valor para el FIX. Captura el tipo de cambio a mano." };
  }

  return { ok: true, valor, fecha: fechaIso(dato.fecha ?? "") };
}
