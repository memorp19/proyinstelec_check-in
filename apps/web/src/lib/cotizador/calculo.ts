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

/** IVA vigente, en por ciento. Una constante con nombre, no un 16 suelto. */
export const IVA_PCT = 16;
/** El mismo IVA como factor, para multiplicar. */
export const IVA = IVA_PCT / 100;

/** Nodos que cubre el costo base de un estudio, cuando no se configura otro. */
export const BASE_NODOS_POR_OMISION = 10;

/**
 * El valor como decimal exacto: `digitos × 10^exp`, con su signo.
 *
 * Parte de `String(n)`, que es la representación decimal MÁS CORTA que vuelve
 * a dar exactamente ese número. Es lo que convierte el redondeo en una
 * operación determinista: el usuario escribió `2.675` y eso es lo que se
 * redondea, no el `2.67499999999999982236…` que el binario guarda por dentro.
 */
function aDecimal(n: number): { negativo: boolean; digitos: bigint; exp: number } {
  let s = String(Math.abs(n));
  let exp = 0;

  // Notación científica: `1e-7`, `1.5e+21`.
  const e = s.indexOf("e");
  if (e >= 0) {
    exp = parseInt(s.slice(e + 1), 10);
    s = s.slice(0, e);
  }
  const punto = s.indexOf(".");
  if (punto >= 0) {
    exp -= s.length - punto - 1;
    s = s.slice(0, punto) + s.slice(punto + 1);
  }
  return { negativo: n < 0, digitos: BigInt(s), exp };
}

const DIEZ = 10n;

function potencia(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= DIEZ;
  return r;
}

/**
 * Redondeo a dos decimales, aplicado en CADA paso.
 *
 * No es cosmético: redondear solo al final da diferencias de centavos contra
 * lo que el cliente ya recibió, y una cotización que no cuadra con su PDF no
 * sirve para cobrar.
 *
 * ARITMÉTICA EXACTA, NO FLOTANTE
 * ------------------------------
 * Se pasa el valor a centavos enteros con `BigInt` y se redondea ahí. La
 * versión anterior hacía `Math.round((Math.abs(n) + Number.EPSILON) * 100)`, y
 * esa suma de un épsilon es un parche con dos agujeros: el épsilon es fijo
 * mientras el error del binario crece con la magnitud, así que acierta en
 * `2.675` y falla en `2666666.675`; y donde el binario ya estaba por encima
 * del medio centavo, empuja de más.
 *
 * Con enteros no hay nada que empujar. `BigInt` es parte del lenguaje —no
 * entra una dependencia— y aquí basta de sobra: una cotización cabe en catorce
 * dígitos y las operaciones son unas pocas por partida.
 *
 * El medio centavo **se aleja de cero** en los dos sentidos, que es la regla de
 * los importes: `2.675 → 2.68` y `-2.675 → -2.68`. `Math.round` de JavaScript
 * no sirve para esto porque manda el medio hacia +infinito.
 */
export function redondear(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n === 0) return 0;

  const { negativo, digitos, exp } = aDecimal(n);

  // El valor en centavos es `digitos × 10^(exp + 2)`.
  const k = exp + 2;
  let centavos: bigint;
  if (k >= 0) {
    // Ya es entero de centavos: no hay nada que redondear.
    centavos = digitos * potencia(k);
  } else {
    const divisor = potencia(-k);
    const q = digitos / divisor;
    const resto = digitos % divisor;
    // Medio o más sube. Como se trabaja con la magnitud, "subir" es alejarse
    // de cero.
    centavos = resto * 2n >= divisor ? q + 1n : q;
  }

  if (centavos === 0n) return 0;
  return Number(negativo ? -centavos : centavos) / 100;
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

/**
 * El importe de un gasto, en la moneda de los gastos.
 *
 * Si su costo viene en otra moneda se convierte aquí, con la misma regla que
 * los conceptos: sin tipo de cambio no se inventa uno, se toma como 0 y se
 * avisa.
 */
function calcularGasto(
  g: Gasto,
  monedaGastos: string,
  tipoCambio: number | null,
  avisos: string[],
): GastoCalculado {
  const cantidad = Number(g.cantidad) || 0;
  const costo = Number(g.costo) || 0;
  const utilidad = 1 + (Number(g.utilidadPct) || 0) / 100;
  const etiqueta = g.codigo || g.descripcion || "(sin código)";

  // Un gasto negativo no es un gasto. Un descuento al cliente se hace con el
  // ajuste de la partida, que es explícito y sale en el reporte; metido aquí
  // se repartiría entre partidas y nadie entendería de dónde salió.
  if (costo < 0 || cantidad < 0) {
    throw new Error(
      `El gasto "${etiqueta}" tiene un importe negativo. Un descuento se captura ` +
        "como ajuste negativo de la partida, no como gasto.",
    );
  }
  if (costo === 0) avisos.push(`El gasto "${etiqueta}" tiene costo 0.`);

  const monedaCosto = g.monedaCosto ?? monedaGastos;
  let factorMoneda = 1;
  if (monedaCosto !== monedaGastos) {
    if (!tipoCambio) {
      avisos.push(
        `El gasto "${etiqueta}" tiene su costo en ${monedaCosto} y los gastos se llevan en ` +
          `${monedaGastos}, pero no hay tipo de cambio. Se tomó como 0.`,
      );
      factorMoneda = 0;
    } else {
      factorMoneda = monedaCosto === "USD" ? tipoCambio : 1 / tipoCambio;
    }
  }

  return {
    codigo: g.codigo,
    descripcion: g.descripcion,
    cantidad,
    importe: redondear(costo * cantidad * utilidad * factorMoneda),
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
  // El id es la llave con la que un gasto apunta a su partida y con la que se
  // religa el armado al releerlo. Duplicado, el gasto iría a parar a cualquiera
  // de las dos y el resultado dependería del orden del arreglo.
  const vistos = new Set<string>();
  for (const p of entrada.partidas) {
    if (vistos.has(p.id)) {
      throw new Error(`Hay dos partidas con el id "${p.id}". El id tiene que ser único.`);
    }
    vistos.add(p.id);
  }

  // ── 6. Avisos sobre lo capturado ──────────────────────────────────────────
  if (asesoriaPct > 100 || asesoriaPct < 0) {
    avisos.push(
      `La asesoría es ${asesoriaPct} %, fuera del rango razonable de 0 a 100. Revísala.`,
    );
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
      ajusteDerivado: false,
      total: 0,
      precioUnitario: 0,
      importe: 0,
    };
  });
  const porId = new Map(partidas.map((p) => [p.id, p]));

  // ── 2. Los gastos, en SU moneda ─────────────────────────────────────────────
  const gastos = (entrada.gastos ?? []).map((g) =>
    calcularGasto(g, monedaGastos, tipoCambio, avisos),
  );
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
  const porIdEntrada = new Map(entrada.partidas.map((p) => [p.id, p]));
  for (const p of partidas) {
    const calculado = redondear(p.costoTotal + p.asesoria);
    const precioFinal = porIdEntrada.get(p.id)?.precioUnitarioFinal;

    // Con precio final, el ajuste se DERIVA en vez de capturarse: la
    // diferencia contra el cálculo queda a la vista en lugar de aparecer un
    // precio que nadie sabe de dónde sale.
    if (precioFinal !== undefined && precioFinal !== null && p.cantidad > 0) {
      const objetivo = redondear(Number(precioFinal) * p.cantidad);
      p.ajuste = redondear(objetivo - calculado);
      p.ajusteDerivado = true;

      // Vender por debajo del costo puede ser una decisión —entrar con un
      // cliente, cerrar un paquete— pero tiene que ser una decisión y no un
      // descuido.
      if (objetivo < p.costoTotal) {
        avisos.push(
          `La partida ${p.orden} se vendería en ${objetivo.toFixed(2)} y cuesta ` +
            `${p.costoTotal.toFixed(2)}: es una venta con pérdida de ` +
            `${redondear(p.costoTotal - objetivo).toFixed(2)}.`,
        );
      }
    }

    p.total = redondear(calculado + p.ajuste);
    p.precioUnitario = p.cantidad > 0 ? redondear(p.total / p.cantidad) : 0;
    // El importe se recompone desde el unitario redondeado: el cliente multiplica
    // lo que ve, y el subtotal tiene que dar lo mismo que él saca con su
    // calculadora.
    p.importe = redondear(p.precioUnitario * p.cantidad);
  }

  for (const p of partidas) {
    if (p.total < 0) {
      avisos.push(
        `La partida ${p.orden} cierra en ${p.total.toFixed(2)}, en negativo. ` +
          "Revisa su ajuste: una partida que resta no se le puede cobrar a nadie.",
      );
    }
  }

  const subtotal = redondear(partidas.reduce((s, p) => s + p.importe, 0));
  if (subtotal < 0) {
    avisos.push(
      `El subtotal cierra en ${subtotal.toFixed(2)}, en negativo. La cotización no es cobrable así.`,
    );
  }
  // El IVA es el de la versión: una cotización vieja se reimprime con el que
  // llevaba. Sin captura, el vigente.
  const ivaPct = entrada.ivaPct === undefined || entrada.ivaPct === null
    ? IVA_PCT
    : Number(entrada.ivaPct);
  const iva = redondear(subtotal * (ivaPct / 100));

  return {
    moneda,
    ivaPct,
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
