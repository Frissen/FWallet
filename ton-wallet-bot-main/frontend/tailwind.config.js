/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Colors are RGB channels so opacity utilities (bg-ton-card/60,
        // text-ton-primary/80, …) work. Plain `var(--x)` colors silently
        // drop every `/NN` modifier in Tailwind 3.
        ton: {
          primary: 'rgb(var(--ton-primary-rgb) / <alpha-value>)',
          dark: 'rgb(var(--ton-dark-rgb) / <alpha-value>)',
          card: 'rgb(var(--ton-card-rgb) / <alpha-value>)',
          'card-hover': 'rgb(var(--ton-card-hover-rgb) / <alpha-value>)',
          border: 'rgb(var(--ton-border-rgb) / <alpha-value>)',
          muted: 'rgb(var(--ton-muted-rgb) / <alpha-value>)',
          accent: 'rgb(var(--ton-accent-rgb) / <alpha-value>)',
        },
      },
      keyframes: {
        'pin-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(8px)' },
          '60%': { transform: 'translateX(-6px)' },
          '80%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'pin-shake': 'pin-shake 0.4s',
      },
    },
  },
  plugins: [],
}
