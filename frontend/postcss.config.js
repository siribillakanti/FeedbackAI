import { fileURLToPath } from 'node:url'

// The config path is explicit so the build works from any working directory
// (the launch config starts Vite from the repository root).
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {}
  }
}
