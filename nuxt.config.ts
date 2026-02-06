export default defineNuxtConfig({
  modules: ['@pinia/nuxt'],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
  },
  css: ['~/assets/css/main.css'],
})
