/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["DM Serif Display", "Georgia", "serif"],
        body: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "Consolas", "monospace"],
      },
      colors: {
        brass: { DEFAULT: "#c9a94e", light: "#d4b85c", dark: "#b8982f" },
        "slate-blue": "#6775a0",
        "signal-red": "#c45252",
        surface: {
          base: "#06070a",
          raised: "#0c0e14",
          DEFAULT: "#12151c",
          hover: "#181c26",
        },
      },
    },
  },
  plugins: [],
};
