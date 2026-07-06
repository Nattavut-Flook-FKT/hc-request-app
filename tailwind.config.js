/** @type {import('tailwindcss').Config} */
import tailwindcssAnimate from 'tailwindcss-animate'

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // FKT DS font — Noto Sans Thai (DS typography · 400/700)
      fontFamily: {
        sans: ['"Noto Sans Thai"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // FKT Design System palette — 12 families × 11 stops (01-colors.md)
      // blue/yellow/orange/teal/purple/pink/red override Tailwind defaults → ใส่ครบ 11 stop กันหน้าอื่นพัง
      colors: {
        neutral: {
          50: '#F8F9FA', 100: '#E6E9EB', 200: '#C2C5C8', 300: '#A7ACAF', 400: '#8C9296',
          500: '#71787D', 600: '#565E64', 700: '#464C51', 800: '#363B3F', 900: '#26292C', 950: '#161719',
        },
        'dark-green': {
          50: '#F0FAF8', 100: '#C8E6E0', 200: '#A0D1C7', 300: '#78BDAF', 400: '#50A996',
          500: '#28947E', 600: '#008065', 700: '#006D56', 800: '#005A47', 900: '#004637', 950: '#003328',
        },
        'green-fresh': {
          50: '#F0FAF6', 100: '#CCF5E5', 200: '#99EBCC', 300: '#66E0B2', 400: '#33D698',
          500: '#19D28A', 600: '#00CE7C', 700: '#00B56D', 800: '#009157', 900: '#006E42', 950: '#004A2C',
        },
        blue: {
          50: '#E8F0FC', 100: '#D1E1F9', 200: '#A3C3F4', 300: '#76A5ED', 400: '#4A88E5',
          500: '#2B73DD', 600: '#1E60D0', 700: '#1850AB', 800: '#143F85', 900: '#0F2E60', 950: '#0A2145',
        },
        red: {
          50: '#FEF5F5', 100: '#FEEBEB', 200: '#FCD3D3', 300: '#F9A7A7', 400: '#F77B7B',
          500: '#F65858', 600: '#F53939', 700: '#D13131', 800: '#AD2828', 900: '#892020', 950: '#651717',
        },
        yellow: {
          50: '#FFFBF0', 100: '#FFF7D6', 200: '#FFEFAD', 300: '#FFE585', 400: '#FFDB5C',
          500: '#FFD74E', 600: '#FFD340', 700: '#D9B336', 800: '#B3942D', 900: '#8C7423', 950: '#66551A',
        },
        orange: {
          50: '#FFF9F5', 100: '#FFE1CC', 200: '#FFC8A3', 300: '#FFB07B', 400: '#FF9752',
          500: '#FF7F29', 600: '#FF6600', 700: '#DF5900', 800: '#C04D00', 900: '#A04000', 950: '#803300',
        },
        teal: {
          50: '#F4FBFB', 100: '#EAF7F8', 200: '#D2EFEF', 300: '#B9E6E7', 400: '#A2DDE0',
          500: '#96D7D9', 600: '#8BD2D4', 700: '#75B4B6', 800: '#5F9294', 900: '#497072', 950: '#344F51',
        },
        purple: {
          50: '#F5F3FC', 100: '#E9E5F9', 200: '#D2CAF4', 300: '#B8ACEE', 400: '#9D8DE8',
          500: '#846EE5', 600: '#6B4FE0', 700: '#5A3FC4', 800: '#46309E', 900: '#312178', 950: '#1E1452',
        },
        pink: {
          50: '#FFFAFB', 100: '#FFE1E8', 200: '#FFC9D4', 300: '#FFB0C1', 400: '#FF97AD',
          500: '#FF7F9A', 600: '#FF6686', 700: '#E05673', 800: '#C04760', 900: '#A1374C', 950: '#812739',
        },
        brown: {
          50: '#FBFAF6', 100: '#F9F5EB', 200: '#FAF0DC', 300: '#F3E2C3', 400: '#ECCF9E',
          500: '#E1B775', 600: '#D29C4F', 700: '#B87F3D', 800: '#936231', 900: '#6D4825', 950: '#452E18',
        },
        lime: {
          50: '#FDFFEF', 100: '#F9FFD1', 200: '#F3FE9E', 300: '#ECFB56', 400: '#D4E640',
          500: '#B6C82E', 600: '#97A91D', 700: '#7A8A13', 800: '#5E6A0B', 900: '#424B06', 950: '#262C02',
        },
        banana: {
          50: '#FEFEE8', 100: '#FDFCC6', 200: '#FBF991', 300: '#FAF86D', 400: '#FAF657',
          500: '#FFF53E', 600: '#E0D726', 700: '#A8A11F', 800: '#7D7713', 900: '#524E08', 950: '#323005',
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
