// Nuxt 4 turns on noUncheckedIndexedAccess. This project enables it as a separate step (README "コードの検査"),
// so it stays off here until then.
const keepIndexedAccess = { noUncheckedIndexedAccess: false }

export default defineNuxtConfig({
  srcDir: 'app/',
  serverDir: 'server/',
  compatibilityDate: '2026-09-16',
  devtools: { enabled: true },
  nitro: {
    preset: 'cloudflare_module',
    typescript: { tsConfig: { compilerOptions: keepIndexedAccess } },
  },
  css: ['~/assets/main.css'],
  typescript: {
    tsConfig: {
      compilerOptions: keepIndexedAccess,
      // useRequestFetch types its responses from the server routes, so the app check also reads server code.
      // The app tsconfig excludes server/, so the Workers types are listed in files, which exclude does not filter.
      files: ['../server/worker-runtime.d.ts', '../server/cloudflare-env.d.ts'],
    },
  },
})
