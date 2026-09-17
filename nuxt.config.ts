export default defineNuxtConfig({
  srcDir: 'app/',
  serverDir: 'server/',
  compatibilityDate: '2026-09-16',
  devtools: { enabled: true },
  nitro: { preset: 'cloudflare_module' },
  css: ['~/assets/main.css'],
})
