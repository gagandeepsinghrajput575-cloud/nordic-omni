/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Neutralise the framework defaults so no Tailwind colour can leak into the
    // monochrome system: the preflight placeholder ink and the ring colour both
    // shipped blue/grey literals into the compiled bundle.
    extend: {
      colors: {
        // Any `*-gray-*`, `*-blue-*` etc. resolve to the neutral scale rather
        // than to Tailwind's chromatic palette.
        blue: { 500: '#ffffff' },
        gray: { 400: '#a1a1aa' },
      },
      placeholderColor: {
        DEFAULT: '#a1a1aa',
      },
      ringColor: {
        DEFAULT: 'rgba(255, 255, 255, 0.25)',
      },
    },
  },
  plugins: [],
};
