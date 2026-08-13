/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FFF0E5",
        pink: { 100: "#FFC0CB", 200: "#FFB6C1" },
        sage: "#B0C965",
        berry: "#9560E8",
        g2g: {
          50: "#FFF0E5",
          100: "#FFC0CB",
          500: "#B0C965",
          600: "#9560E8",
          700: "#7A45D4",
        },
        coral: { 50: "#FFC0CB", 500: "#9560E8", 600: "#7A45D4" },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        heading: ["Poppins", "sans-serif"],
      },
    },
  },
  plugins: [],
};
