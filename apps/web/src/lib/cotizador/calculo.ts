/**
 * El motor de cálculo del cotizador.
 *
 * Puro: recibe lo capturado y devuelve números. No toca la base, no lee el
 * catálogo y no consulta el tipo de cambio — todo eso entra como dato.
 *
 * El orden de las operaciones es parte de la regla, no un detalle: cambiarlo
 * cambia los centavos, y los centavos son lo que el cliente ya tiene en un PDF
 * firmado.
 */
import type {
  Concepto,
  ConceptoCalculado,
  EntradaCotizacion,
  Esfuerzo,
  Gasto,
  GastoCalculado,
  Partida,
  PartidaCalculada,
  ResultadoCotizacion,
} from "./tipos";

/** IVA vigente. Una constante con nombre, no un 0.16 suelto en una fórmula. */
export const IVA = 0.16;

/** Nodos que cubre el costo base de un estudio, cuando no se configura otro. */
export const BASE_NODOS_POR_OMISION = 10;

/**
 * Redondeo a dos decimales, aplicado en CADA paso.
 *
 * No es cosmético. Redondear solo al final da diferencias de centavos contra
 * lo que el cliente ya recibió, y una cotización que no cuadra con su PDF no
 * sirve para cobrar.
 */
export function redondear(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Se redondea la MAGNITUD y se reaplica el signo: `Math.round` de JavaScript
  // manda el medio hacia +infinito, así que -2.675 daría -2.67 mientras 2.675
  // da 2.68. En dinero el medio se aleja de cero, en los dos sentidos.
  //
  // El +EPSILON corrige el caso en que el binario deja el valor un ulp por
  // debajo del medio centavo: 2.675 se guarda como 2.67499999999999982.
  const signo = n < 0 ? -1 : 1;
  const redondeado = (signo * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
  // `-0` existe en JavaScript y no es igual a `0` para `Object.is`, que es lo
  // que usan las aserciones de los tests.
  return redondeado === 0 ? 0 : redondeado;
}

/**
 * Horas y costo de un estudio por esfuerzo.
 *
 * `horas = horas/día × días/semana × ingenieros × semanas`
 *
 * Exige los cinco parámetros. Si falta alguno devuelve null y el concepto cae
 * a costo fijo: inventar un valor por omisión produciría un precio que nadie
 * puede explicar.
 */
export function costoPorEsfuerzo(e: Esfuerzo): { horas: number; costo: number } | null {
  const { horasPorDia, diasPorSemana, ingenieros, semanas, tarifaHora } = e;
  if (!horasPorDia || !diasPorSemana || !semanas || !tarifaHora) return null;
  const ings = ingenieros || 1;
  const horas = horasPorDia * diasPorSemana * ings * semanas;
  return { horas, costo: redondear(horas * tarifaHora) };
}

/**
 * El importe de un concepto: `costo × cantidad × (1 + utilidad%)`, convertido
 * a la moneda de la cotización si su costo viene en otra.
 */
function calcularConcepto(
  c: Concepto,
  monedaCotizacion: string,
  tipoCambio: number | null,
  baseNodosPorOmision: number,
  avisos: string[],
): ConceptoCalculado {
  const cantidad = Number(c.cantidad) || 0;
  const utilidad = 1 + (Number(c.utilidadPct) || 0) / 100;
  const etiqueta = c.codigo || c.descripcion || "(sin código)";

  // El tipo de cambio solo entra si el costo viene en otra moneda.
  const monedaCosto = c.monedaCosto ?? monedaCotizacion;
  let factorMoneda = 1;
  if (monedaCosto !== monedaCotizacion) {
    if (!tipoCambio) {
      avisos.push(
        `El concepto "${etiqueta}" tiene su costo en ${monedaCosto} y la cotización cierra en ` +
          `${monedaCotizacion}, pero no hay tipo de cambio. Se tomó como 0.`,
      );
      factorMoneda = 0;
    } else {
      factorMoneda = monedaCosto === "USD" ? tipoCambio : 1 / tipoCambio;
    }
  }

  const esf = c.esfuerzo ? costoPorEsfuerzo(c.esfuerzo) : null;

  if (esf) {
    const costoEstudio = redondear(esf.costo * utilidad * factorMoneda);
    const nodos = Number(c.esfuerzo?.nodos) || 0;
    if (nodos) {
      const base = Number(c.esfuerzo?.baseNodos) || baseNodosPorOmision;
      return {
        codigo: c.codigo,
        descripcion: c.descripcion,
        cantidad,
        unidad: c.unidad,
        costoUnitario: costoEstudio,
        importe: redondear((costoEstudio / base) * nodos),
        forma: "NODOS",
        horas: esf.horas,
      };
    }
    return {
      codigo: c.codigo,
      descripcion: c.descripcion,
      cantidad,
      unidad: c.unidad,
      costoUnitario: costoEstudio,
      importe: redondear(costoEstudio * (cantidad || 1)),
      forma: "ESFUERZO",
      horas: esf.horas,
    };
  }

  if (c.esfuerzo) {
    avisos.push(
      `El estudio "${etiqueta}" no trae todos los parámetros de esfuerzo ` +
        "(horas/día, días/semana, semanas y tarifa); se cotizó con su costo fijo.",
    );
  }

  const costo = Number(c.costo) || 0;
  if (costo === 0) {
    avisos.push(`El concepto "${etiqueta}" tiene costo 0.`);
  }
  const unitario = redondear(costo * utilidad * factorMoneda);
  return {
    codigo: c.codigo,
    descripcion: c.descripcion,
    cantidad,
    unidad: c.unidad,
    costoUnitario: unitario,
    importe: redondear(unitario * cantidad),
    forma: "FIJO",
  };
}

/** El importe de un gasto, en la moneda de los gastos. */
function calcularGasto(g: Gasto, monedaGastos: string, avisos: string[]): GastoCalculado {
  const cantidad = Number(g.cantidad) || 0;
  const costo = Number(g.costo) || 0;
  const utilidad = 1 + (Number(g.utilidadPct) || 0) / 100;
  const etiqueta = g.codigo || g.descripcion || "(sin código)";

  if (costo === 0) avisos.push(`El gasto "${etiqueta}" tiene costo 0.`);
  if (g.monedaCosto && g.monedaCosto !== monedaGastos) {
    avisos.push(
      `El gasto "${etiqueta}" dice estar en ${g.monedaCosto} y los gastos se llevan en ` +
        `${monedaGastos}. Se tomó como ${monedaGastos}.`,
    );
  }

  return {
    codigo: g.codigo,
    descripcion: g.descripcion,
    cantidad,
    importe: redondear(costo * cantidad * utilidad),
    destino: g.destino ?? "GENERAL",
  };
}

/**
 * Reparte un total entre partidas, con la última absorbiendo la diferencia del
 * redondeo.
 *
 * Sin eso, la suma de lo repartido no cuadra con el total y el documento
 * muestra dos números distintos para lo mismo.
 */
function repartir(total: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];
  const suma = pesos.reduce((s, p) => s + p, 0);
  const partes =
    suma > 0
      ? pesos.map((p) => redondear((total * p) / suma))
      : pesos.map(() => redondear(total / pesos.length));
  const repartido = partes.reduce((s, p) => s + p, 0);
  const sobra = redondear(total - repartido);
  if (sobra !== 0) partes[partes.length - 1] = redondear(partes[partes.length - 1] + sobra);
  return partes;
}

export function calcularCotizacion(entrada: EntradaCotizacion): ResultadoCotizacion {
  const avisos: string[] = [];
  const moneda = entrada.moneda;
  const monedaGastos = entrada.monedaGastos ?? moneda;
  const tipoCambio = entrada.tipoCambio?.valor && entrada.tipoCambio.valor > 0
    ? entrada.tipoCambio.valor
    : null;
  const reparto = entrada.reparto ?? "IGUAL";
  const asesoriaPct = Number(entrada.asesoriaPct) || 0;
  const baseNodos = entrada.baseNodosPorOmision || BASE_NODOS_POR_OMISION;

  if (entrada.tipoCambio?.origen === "PREFERENTE" && !entrada.tipoCambio.motivo?.trim()) {
    avisos.push("El tipo de cambio preferente no trae motivo. Sin él nadie puede revisarlo.");
  }
  if (asesoriaPct > 100) {
    avisos.push(`El ${asesoriaPct} % de asesoría parece demasiado. Revísalo.`);
  }

  // ── 1. Los conceptos de cada partida ────────────────────────────────────────
  const partidas = entrada.partidas.map((p: Partida, i): PartidaCalculada => {
    const conceptos = p.conceptos.map((c) =>
      calcularConcepto(c, moneda, tipoCambio, baseNodos, avisos),
    );
    const costoConceptos = redondear(conceptos.reduce((s, c) => s + c.importe, 0));
    if (conceptos.length === 0) {
      avisos.push(`La partida ${p.orden ?? i + 1} no tiene conceptos.`);
    }
    if (!p.titulo?.trim()) {
      avisos.push(`La partida ${p.orden ?? i + 1} no tiene título. Es lo que lee el cliente.`);
    }
    return {
      id: p.id,
      orden: p.orden ?? i + 1,
      titulo: p.titulo,
      cantidad: Number(p.cantidad) || 0,
      unidad: p.unidad,
      conceptos,
      costoConceptos,
      gastoAsignado: 0,
      costoTotal: 0,
      asesoria: 0,
      ajuste: redondear(Number(p.ajuste) || 0),
      total: 0,
      precioUnitario: 0,
      importe: 0,
    };
  });
  const porId = new Map(partidas.map((p) => [p.id, p]));

  // ── 2. Los gastos, en SU moneda ─────────────────────────────────────────────
  const gastos = (entrada.gastos ?? []).map((g) => calcularGasto(g, monedaGastos, avisos));
  const totalGastos = redondear(gastos.reduce((s, g) => s + g.importe, 0));

  // Los que van a una partida concreta no se reparten: se cargan enteros.
  const asignadoDirecto = new Map<string, number>();
  let poolGeneral = 0;
  for (const g of gastos) {
    if (g.destino === "GENERAL") {
      poolGeneral = redondear(poolGeneral + g.importe);
      continue;
    }
    const destino = g.destino.partida;
    if (!porId.has(destino)) {
      avisos.push(
        `El gasto "${g.codigo ?? g.descripcion ?? ""}" apunta a la partida "${destino}", ` +
          "que no existe. Se repartió entre las generales.",
      );
      poolGeneral = redondear(poolGeneral + g.importe);
      continue;
    }
    asignadoDirecto.set(destino, redondear((asignadoDirecto.get(destino) ?? 0) + g.importe));
  }

  // ── 3. El reparto de los generales, ANTES de convertir ─────────────────────
  const reciben = partidas.filter(
    (p) => entrada.partidas.find((e) => e.id === p.id)?.recibeGastosGenerales !== false,
  );
  if (poolGeneral > 0 && reciben.length === 0) {
    avisos.push("Hay gastos generales y ninguna partida los recibe. Quedaron sin repartir.");
  }

  const repartoGeneral = new Map<string, number>();
  if (poolGeneral > 0 && reciben.length > 0) {
    let partes: number[];
    if (reparto === "PROPORCIONAL") {
      partes = repartir(poolGeneral, reciben.map((p) => p.costoConceptos));
    } else if (reparto === "MANUAL") {
      partes = reciben.map((p) =>
        redondear(Number(entrada.partidas.find((e) => e.id === p.id)?.gastoManual) || 0),
      );
      const asignado = redondear(partes.reduce((s, x) => s + x, 0));
      if (asignado !== poolGeneral) {
        avisos.push(
          `Los gastos repartidos a mano suman ${asignado.toFixed(2)} y el total es ` +
            `${poolGeneral.toFixed(2)}. Faltan ${redondear(poolGeneral - asignado).toFixed(2)}.`,
        );
      }
    } else {
      partes = repartir(poolGeneral, reciben.map(() => 1));
    }
    reciben.forEach((p, i) => repartoGeneral.set(p.id, partes[i]));
  }

  // ── 4. Y ahora sí, la conversión ───────────────────────────────────────────
  const convertir = (monto: number): number => {
    if (monedaGastos === moneda || monto === 0) return monto;
    if (!tipoCambio) return 0;
    return redondear(monedaGastos === "USD" ? monto * tipoCambio : monto / tipoCambio);
  };
  if (monedaGastos !== moneda && !tipoCambio && (poolGeneral > 0 || asignadoDirecto.size > 0)) {
    avisos.push(
      `Los gastos están en ${monedaGastos} y la cotización cierra en ${moneda}. ` +
        "Sin tipo de cambio no se pueden repartir: quedaron fuera.",
    );
  }

  for (const p of partidas) {
    const general = repartoGeneral.get(p.id) ?? 0;
    const directo = asignadoDirecto.get(p.id) ?? 0;
    p.gastoAsignado = redondear(convertir(general) + convertir(directo));
    p.costoTotal = redondear(p.costoConceptos + p.gastoAsignado);
  }

  // ── 5. La asesoría: UN porcentaje, repartido en proporción al costo ────────
  // Siempre proporcional, sin importar cómo se repartieron los gastos. Es lo
  // que reproduce la práctica manual de poner el mismo % a cada partida: un
  // porcentaje plano sobre cada base es idéntico a repartir el total en
  // proporción a esas bases.
  const baseAsesoria = redondear(partidas.reduce((s, p) => s + p.costoTotal, 0));
  if (asesoriaPct > 0 && baseAsesoria > 0) {
    const total = redondear(baseAsesoria * (asesoriaPct / 100));
    partidas.forEach((p) => {
      p.asesoria = redondear((total * p.costoTotal) / baseAsesoria);
    });
  }

  // ── 6. El total de cada partida y lo que ve el cliente ─────────────────────
  for (const p of partidas) {
    p.total = redondear(p.costoTotal + p.asesoria + p.ajuste);
    p.precioUnitario = p.cantidad > 0 ? redondear(p.total / p.cantidad) : 0;
    // El importe se recompone desde el unitario redondeado: el cliente multiplica
    // lo que ve, y el subtotal tiene que dar lo mismo que él saca con su
    // calculadora.
    p.importe = redondear(p.precioUnitario * p.cantidad);
  }

  const subtotal = redondear(partidas.reduce((s, p) => s + p.importe, 0));
  const iva = redondear(subtotal * IVA);

  return {
    moneda,
    partidas,
    gastos,
    costoTotal: redondear(partidas.reduce((s, p) => s + p.costoTotal, 0)),
    totalGastos,
    asesoriaPct,
    asesoria: redondear(partidas.reduce((s, p) => s + p.asesoria, 0)),
    subtotal,
    iva,
    total: redondear(subtotal + iva),
    avisos,
  };
}
