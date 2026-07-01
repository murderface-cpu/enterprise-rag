import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe5ff",
          200: "#bcd1ff",
          300: "#8eb3ff",
          400: "#5a8bff",
          500: "#3563ff",
          600: "#1e44e6",
          700: "#1834b8",
          800: "#162c92",
          900: "#162a73",
        },
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dadde6",
          300: "#b8bccc",
          400: "#8b8fa3",
          500: "#5d627a",
          600: "#41465b",
          700: "#2f3344",
          800: "#1f2230",
          900: "#11131c",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;