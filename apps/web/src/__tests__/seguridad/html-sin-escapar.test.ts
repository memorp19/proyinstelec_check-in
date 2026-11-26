/**
 * Nada de HTML armado con texto sin escapar, fuera de los lugares permitidos.
 *
 * Es el equivalente, en el ERP nuevo, del A5 y el M10 de la revisión del 17
 * nov: en Apps Script las vistas metían en `innerHTML` el cliente, el título o
 * «Elaboró» tal como estaban en el Control, y un cliente llamado
 * `ACME<img onerror=…>` corría código con la cuenta de quien abriera el
 * buscador. React escapa solo lo que pinta; lo que se salta ese escape son
 * dos cosas, y esta prueba vigila las dos:
 *
 * 1. **Meter HTML directo en la página**: `dangerouslySetInnerHTML`,
 *    `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`. Hoy no
 *    hay ni uno, y la lista de permitidos está vacía.
 * 2. **HTML armado con plantillas de texto**, que es como se escriben los
 *    correos. En toda plantilla `` `…${x}…` `` —o concatenación con `+`— que
 *    lleve una etiqueta HTML, cada `${x}` tiene que:
 *    - pasar por `escaparHtml`, o
 *    - ser una de las funciones que devuelven HTML ya escapado
 *      (`FUNCIONES_QUE_DEVUELVEN_HTML`), cuyo cuerpo revisa esta misma prueba,
 *      o
 *    - estar en `PERMITIDAS`, con su porqué.
 *
 * La prueba lee el código con el compilador de TypeScript, no con
 * expresiones regulares: sabe qué es una plantilla, qué es un `${…}` y qué
 * función se llama. Revisa todo `app/` y `src/` salvo las pruebas.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));
const CARPETAS = ["app", "src"];
const FUERA = [path.join("src", "__tests__")];

// ── Lo permitido ──────────────────────────────────────────────────────────────

/**
 * Funciones que devuelven HTML **ya escapado**. Interpolar su resultado es
 * seguro porque sus propias plantillas pasan por esta misma prueba.
 */
const FUNCIONES_QUE_DEVUELVEN_HTML: Record<string, string> = {
  escaparHtml: "Es el escape (src/lib/correo.ts).",
  plantillaCorreo: "La plantilla de todos los correos; su cuerpo se revisa aquí.",
  filaTabla: "Un renglón de tabla de correo; escapa la etiqueta y el valor.",
  montoParaCorreo: "Renglones de importe, hechos con filaTabla.",
  recuadroDeNota: "El recuadro de la nota al revisor; escapa la nota y el nombre.",
  textoAHtml:
    "Texto tecleado con sus saltos de línea (el «Mensaje» al cliente): lo pasa por escaparHtml " +
    "y solo después agrega los <br/>.",
};

/**
 * Interpolaciones sin escapar que se aceptan, archivo por archivo, con su
 * porqué. Lo que dice PENDIENTE es deuda conocida: está en
 * `docs/seguridad-erp.md` y se quita con el PR que la cierre.
 */
const PERMITIDAS: Array<{ archivo: string; expresion: string; porque: string }> = [
  {
    archivo: "src/lib/cotizaciones-flujos.ts",
    expresion: "folio",
    porque: "El folio lo arma el sistema con números (PCOTOP-NNN-AAAA, OTnnnAAv): nadie lo teclea.",
  },
  {
    archivo: "src/lib/cotizaciones-flujos.ts",
    expresion: "urlSistema()",
    porque: "Sale de NEXTAUTH_URL, la configuración del servidor.",
  },
  {
    archivo: "src/lib/cotizaciones-flujos.ts",
    expresion: "carpetaUrl",
    porque: "El enlace de la carpeta de la OT lo devuelve Drive al crearla; no lo teclea nadie.",
  },
  {
    archivo: "src/lib/excel.ts",
    expresion: "fila[1]",
    porque: "No arma HTML: reconstruye la etiqueta <row> de un .xlsx para leerle los atributos.",
  },
  {
    archivo: "src/lib/excel.ts",
    expresion: "c[1]",
    porque: "No arma HTML: reconstruye la etiqueta <c> de un .xlsx para leerle los atributos.",
  },
  {
    archivo: "src/lib/correo.ts",
    expresion: "params.cuerpoHtml",
    porque:
      "Es HTML por contrato: cada cuerpo se arma en otro lado, y esta misma prueba revisa ese armado.",
  },
  {
    archivo: "src/lib/correo.ts",
    expresion: "url",
    porque: "La dirección del sistema: la pasa el código o sale de NEXTAUTH_URL.",
  },
];

/** Meter HTML directo en la página. Vacía a propósito: hoy no hace falta en ningún lado. */
const PERMITIDOS_HTML_DIRECTO: Record<string, string> = {};

// ── Los archivos ──────────────────────────────────────────────────────────────

function archivosEn(carpeta: string): string[] {
  const fuera: string[] = [];
  for (const nombre of readdirSync(carpeta)) {
    const completo = path.join(carpeta, nombre);
    const relativo = path.relative(RAIZ, completo);
    if (FUERA.some((f) => relativo.startsWith(f))) continue;
    if (statSync(completo).isDirectory()) fuera.push(...archivosEn(completo));
    else if (/\.(ts|tsx)$/.test(nombre) && !nombre.endsWith(".d.ts")) fuera.push(completo);
  }
  return fuera;
}

const ARCHIVOS = CARPETAS.flatMap((c) => archivosEn(path.join(RAIZ, c)));
const relativo = (archivo: string) => path.relative(RAIZ, archivo).split(path.sep).join("/");

// ── 1. HTML directo ───────────────────────────────────────────────────────────

const HTML_DIRECTO = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\s*\(/;

function htmlDirecto(): string[] {
  const hallados: string[] = [];
  for (const archivo of ARCHIVOS) {
    const nombre = relativo(archivo);
    if (nombre in PERMITIDOS_HTML_DIRECTO) continue;
    readFileSync(archivo, "utf8")
      .split("\n")
      .forEach((linea, i) => {
        if (HTML_DIRECTO.test(linea)) hallados.push(`${nombre}:${i + 1}  ${linea.trim()}`);
      });
  }
  return hallados;
}

// ── 2. Plantillas de HTML ─────────────────────────────────────────────────────

/** Una etiqueta de apertura o cierre: `<p `, `<td>`, `</div>`, `<br/>`, `<a href=`. */
const ETIQUETA = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?=[\s>/]|$)/;

interface Hallazgo {
  archivo: string;
  linea: number;
  expresion: string;
}

function textoDe(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    return n.head.text + n.templateSpans.map((s) => s.literal.text).join("");
  }
  return null;
}

const llevaEtiqueta = (n: ts.Node) => {
  const t = textoDe(n);
  return t !== null && ETIQUETA.test(t);
};

function sinEnvoltura(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

function nombreDeLaFuncion(c: ts.CallExpression): string | null {
  const f = sinEnvoltura(c.expression);
  if (ts.isIdentifier(f)) return f.text;
  if (ts.isPropertyAccessExpression(f)) return f.name.text;
  return null;
}

/** Los operandos de una cadena `a + b + c`, aplanada. */
function operandos(e: ts.Expression): ts.Expression[] {
  const x = sinEnvoltura(e);
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...operandos(x.left), ...operandos(x.right)];
  }
  return [x];
}

/**
 * Lo que no se puede meter en HTML tal cual, reducido a lo mínimo.
 *
 * De `` `${x ? folio : ""}` `` sale `folio`, no la expresión entera: así una
 * permitida se escribe como lo que es. Una plantilla **con** etiquetas no
 * aporta nada aquí porque se revisa por su cuenta; una **sin** etiquetas
 * (`` `${a} ${b}` ``) se revisa por dentro.
 */
function inseguras(e: ts.Expression): ts.Expression[] {
  const x = sinEnvoltura(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isNumericLiteral(x)) {
    return [];
  }
  if (ts.isTemplateExpression(x)) {
    return llevaEtiqueta(x) ? [] : x.templateSpans.flatMap((s) => inseguras(s.expression));
  }
  if (ts.isConditionalExpression(x)) return [...inseguras(x.whenTrue), ...inseguras(x.whenFalse)];
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) return operandos(x).flatMap(inseguras);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...inseguras(x.left), ...inseguras(x.right)];
    }
  }
  if (ts.isCallExpression(x)) {
    const nombre = nombreDeLaFuncion(x);
    if (nombre !== null && nombre in FUNCIONES_QUE_DEVUELVEN_HTML) return [];
  }
  return [x];
}

/** Cada `${…}` sin escapar dentro de HTML armado como texto en un archivo. */
function hallazgosEn(sf: ts.SourceFile, archivo: string): Hallazgo[] {
  const hallados: Hallazgo[] = [];
  const anotar = (e: ts.Expression) => {
    for (const x of inseguras(e)) {
      hallados.push({
        archivo,
        linea: sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1,
        expresion: x.getText(sf),
      });
    }
  };

  const visitar = (n: ts.Node) => {
    // `<p>${x}</p>`
    if (ts.isTemplateExpression(n) && llevaEtiqueta(n)) {
      for (const s of n.templateSpans) anotar(s.expression);
    }
    // "<p>" + x + "</p>", solo desde la punta de la cadena para no contarla dos veces
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      const partes = operandos(n);
      if (partes.some(llevaEtiqueta)) {
        // Las plantillas de la cadena se revisan por su cuenta al visitarlas.
        for (const p of partes) if (textoDe(p) === null) anotar(p);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return hallados;
}

/** Todo lo que hay en el código, sin descontar las permitidas. */
function todosLosHallazgos(): Hallazgo[] {
  return ARCHIVOS.flatMap((archivo) => {
    const fuente = readFileSync(archivo, "utf8");
    if (!fuente.includes("<")) return [];
    const sf = ts.createSourceFile(
      archivo,
      fuente,
      ts.ScriptTarget.Latest,
      true,
      archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    return hallazgosEn(sf, relativo(archivo));
  });
}

const estaPermitida = (h: Hallazgo) =>
  PERMITIDAS.some((p) => p.archivo === h.archivo && p.expresion === h.expresion);

// ── Las pruebas ───────────────────────────────────────────────────────────────

describe("HTML sin escapar", () => {
  it("revisa el código de verdad (si esto falla, la prueba no está viendo nada)", () => {
    const nombres = ARCHIVOS.map(relativo);
    expect(nombres).toContain("src/lib/correo.ts");
    expect(nombres).toContain("src/lib/cotizaciones-flujos.ts");
    expect(nombres.some((n) => n.startsWith("src/__tests__"))).toBe(false);
  });

  it("nadie mete HTML directo en la página", () => {
    expect(htmlDirecto(), "Usa JSX: React escapa lo que pinta").toEqual([]);
  });

  it("todo `${…}` dentro de HTML armado como texto va escapado", () => {
    const hallados = todosLosHallazgos()
      .filter((h) => !estaPermitida(h))
      .map((h) => `${h.archivo}:${h.linea}  \${${h.expresion}}`);
    expect(
      hallados,
      "Pásalo por escaparHtml. Si de verdad no hace falta, agrégalo a PERMITIDAS con su porqué.",
    ).toEqual([]);
  });

  it("cada permitida sigue haciendo falta", () => {
    const hallados = todosLosHallazgos();
    const sobran = PERMITIDAS.filter(
      (p) => !hallados.some((h) => h.archivo === p.archivo && h.expresion === p.expresion),
    ).map((p) => `${p.archivo} · ${p.expresion}`);
    expect(sobran, "Ya no hacen falta: quítalas de PERMITIDAS").toEqual([]);
  });

  it("cada permitida dice por qué", () => {
    for (const p of PERMITIDAS) {
      expect(p.porque.length, `${p.archivo} · ${p.expresion}`).toBeGreaterThan(20);
    }
  });

  // La prueba de la prueba: si el detector no ve esto, no ve nada.
  it("el detector encuentra lo que no va escapado, y solo eso", () => {
    const codigo = [
      "const a = `<p>${cliente}</p>`;",
      "const b = '<td>' + titulo + '</td>';",
      "const c = `<p>${escaparHtml(cliente)}</p>${filaTabla('Folio', folio)}`;",
      "const d = `<b>${x ? dirigida : ''}</b>`;",
      "const e = `<i>${`${nombre} (${iniciales})`}</i>`;",
      "const f = `${a} y ${b}`;",
      "const g = `<p>${a}</p>` + recuadroDeNota(nota, quien);",
    ].join("\n");
    const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
    expect(hallazgosEn(sf, "x.ts").map((h) => `${h.linea}:${h.expresion}`)).toEqual([
      "1:cliente",
      "2:titulo",
      "4:dirigida",
      "5:nombre",
      "5:iniciales",
      "7:a",
    ]);
  });
});
