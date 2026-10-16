import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      /**
       * Los renglones del cotizador caben de corrido desde unos 900 px, que es
       * bastante menos que el `lg` de Tailwind (1024). Con `lg` una laptop de
       * 1366 con el navegador a media pantalla ya se apilaba sin necesidad.
       */
      screens: { ancho: "900px" },
      // ── Design tokens — mockup.html ──────────────────────────────────────
      colors: {
        blue: {
          DEFAULT: "#1A4FD8",
          dark: "#0F2E8C",
          mid: "#2563EB",
          light: "#EFF4FF",
        },
        navy: "#0A1628",
        amber: "#F59E0B",
        green: "#10B981",
        danger: "#EF4444",
      },
      fontFamily: {
        head: ["Barlow Condensed", "sans-serif"],
        body: ["Barlow", "sans-serif"],
        mono: ["Space Mono", "monospace"],
      },
      // Minimum tap target per spec (44×44px)
      minHeight: { tap: "44px" },
      minWidth: { tap: "44px" },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "14px",
        "2xl": "20px",
        phone: "40px",
      },
    },
  },
  plugins: [],
};

export default config;
