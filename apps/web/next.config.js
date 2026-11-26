// @ts-check
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  buildExcludes: [/middleware-manifest\.json$/],
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/proyinstelec\.com\/api\//,
      handler: "NetworkFirst",
      options: {
        cacheName: "api-cache",
        networkTimeoutSeconds: 10,
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    {
      urlPattern: /\.(?:js|css|woff2|png|jpg|svg)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
});

/**
 * Los encabezados de seguridad, en TODAS las respuestas: páginas, `/api` y
 * archivos estáticos (B11, docs/seguridad-erp.md §3.6).
 *
 * - **Que nadie meta el ERP en un marco.** Una página ajena podría mostrarlo
 *   dentro de la suya y engañar a un aprobador para que haga clic donde no
 *   ve. `frame-ancestors 'none'` es la regla moderna; `X-Frame-Options: DENY`,
 *   la que entienden los navegadores viejos. Esto decide quién puede
 *   enmarcar al ERP, no qué enmarca el ERP: el visor del PDF de Drive (un
 *   iframe nuestro hacia drive.google.com) sigue igual.
 * - **La CSP lleva solo `frame-ancestors`.** Una CSP completa (scripts,
 *   estilos, conexiones) pide inventariar todo lo que carga la app, y un
 *   error ahí rompe el inicio de sesión o la PWA. Va aparte, si se decide.
 * - **`nosniff`:** el navegador no adivina el tipo de un archivo; usa el que
 *   dice el servidor. Así una foto subida no se puede ejecutar como script.
 * - **`Referrer-Policy`:** a otros sitios solo viaja el dominio, nunca la
 *   ruta (que lleva folios y llaves). El inicio de sesión con Google no la
 *   necesita.
 *
 * La prueba es `src/__tests__/seguridad/encabezados.test.ts`.
 */
const ENCABEZADOS_DE_SEGURIDAD = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: ENCABEZADOS_DE_SEGURIDAD }];
  },
  images: {
    remotePatterns: [
      // Google profile pictures (OAuth avatar)
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Google Drive thumbnails
      { protocol: "https", hostname: "drive.google.com" },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: [
      "@aws-sdk/client-dynamodb",
      "@aws-sdk/lib-dynamodb",
      "@aws-sdk/client-ssm",
    ],
  },
};

module.exports = withPWA(nextConfig);
