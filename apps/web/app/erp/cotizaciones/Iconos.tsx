/**
 * Los íconos de los botones de la tarjeta, como SVG en línea.
 *
 * Sin librería: son nueve trazos y meter una dependencia de iconos para esto
 * costaría más que escribirlos —en peso y en una cosa más que actualizar—.
 * Siguen la forma de los de Lucide, que son los que usa el cotizador viejo, así
 * que quien venga de allá reconoce el botón antes de leerlo.
 *
 * Todos heredan el color del texto (`currentColor`) y miden 14 px, que es lo
 * que pide un botón de 10 px de tipografía.
 */

type Props = { className?: string };

const base = (className?: string) => ({
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

/** Mandar a revisión. */
export const IconoEnviar = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

/** Cotizar / ver cotización. */
export const IconoCalculadora = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect width="16" height="20" x="4" y="2" rx="2" />
    <line x1="8" x2="16" y1="6" y2="6" />
    <line x1="8" x2="8" y1="14" y2="14" />
    <line x1="12" x2="12" y1="14" y2="14" />
    <line x1="16" x2="16" y1="14" y2="14" />
    <line x1="8" x2="8" y1="18" y2="18" />
    <line x1="12" x2="12" y1="18" y2="18" />
    <line x1="16" x2="16" y1="18" y2="18" />
  </svg>
);

/** Editar los datos de la cotización. */
export const IconoLapiz = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497Z" />
    <path d="m15 5 4 4" />
  </svg>
);

/** La carpeta de Drive. */
export const IconoCarpeta = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </svg>
);

/** Nueva versión. */
export const IconoRama = ({ className }: Props) => (
  <svg {...base(className)}>
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

/** Las versiones de la cotización. */
export const IconoCapas = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m6.08 10.37-3.48 1.58a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.48-1.59" />
  </svg>
);

/** Ingresar o registrar la orden de compra. */
export const IconoPaquete = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M16 16h6" />
    <path d="M19 13v6" />
    <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l.5-.3" />
    <path d="m7.5 4.27 9 5.15" />
  </svg>
);

/** Enviar al cliente. */
export const IconoCorreo = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

/** Esperando al revisor. */
export const IconoReloj = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

/** Eliminar una cotización que nunca salió. */
export const IconoBote = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
);
