export default defineNuxtConfig({
  srcDir: '.',
  components: [{ path: 'components', pathPrefix: false }],
  modules: ['@pinia/nuxt'],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
  },
  css: ['~/assets/css/main.css'],
})
