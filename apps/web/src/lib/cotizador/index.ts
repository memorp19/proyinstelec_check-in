/**
 * El motor del cotizador: cálculo, importe en letra, catálogo y el puente con
 * las filas de la base.
 *
 * Sin conexión, sin pantallas y sin consultas: hasta la conversión de filas es
 * una función pura que recibe lo que ya se leyó. Es lo que permite probarlo
 * todo contra las cotizaciones reales, al centavo.
 */
export * from "./tipos";
export * from "./calculo";
export * from "./letras";
export * from "./catalogo";
export * from "./documento";
export * from "./persistencia";
