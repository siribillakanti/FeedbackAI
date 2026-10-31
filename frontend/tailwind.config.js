// Design tokens from docs/02_ARCHITECTURE.md §9. The values live as CSS custom
// properties in src/styles/index.css; Tailwind only maps names onto them.
/** @type {import('tailwindcss').Config} */
export default {
  // relative: globs resolve from this file, not from the working directory.
  content: { relative: true, files: ['./index.html', './src/**/*.{js,jsx}'] },
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--paper) / <alpha-value>)',
        'paper-2': 'rgb(var(--paper-2) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        neutral: 'rgb(var(--neutral) / <alpha-value>)',
        negative: 'rgb(var(--negative) / <alpha-value>)',
        'negative-soft': 'rgb(var(--negative-soft) / <alpha-value>)',
        mixed: 'rgb(var(--mixed) / <alpha-value>)'
      },
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      borderRadius: {
        DEFAULT: '4px'
      },
      boxShadow: {
        pop: '0 8px 24px rgba(28, 35, 51, 0.12)'
      },
      maxWidth: {
        page: '1200px'
      },
      transitionDuration: {
        DEFAULT: '140ms'
      }
    }
  },
  plugins: []
}
