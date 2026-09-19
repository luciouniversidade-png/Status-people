import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0b2545", 700: "#143a66", 100: "#e8eef7" },
        ink: "#1c2430",
        mist: "#f4f6fa",
        line: "#dbe3ee",
        acao: "#1f5fa0",
        ok: "#1f7a4d",
        aviso: "#a35f00",
        erro: "#a12b2b",
      },
      fontFamily: { sans: ["var(--font-plex)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
