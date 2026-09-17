export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        deep: "#00002c",
        darker: "#0a0025",
        panel: "#0f0021",
        widget: "#28002b",
        overlay: "#010033",
        cyan: "#00ffff",
        pink: "#ff0080",
        lime: "#00ff55",
        yellow: "#eeff00",
        danger: "#ff0062",
        orange: "#ff7e34",
        muted: "#9b9b9b",
      },
      fontFamily: {
        sans: ["Outfit", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 18px 50px rgba(0, 0, 44, 0.55)",
      },
    },
  },
  plugins: [],
};
