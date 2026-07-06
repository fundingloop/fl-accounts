/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // FL Accounts brand
        navy: { DEFAULT: "#012E41", soft: "#0A3E54" },
        teal: { DEFAULT: "#2BA99F", dark: "#1E8B82", soft: "#E6F4F3" },
      },
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
