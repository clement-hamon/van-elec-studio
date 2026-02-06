export default defineNuxtConfig({
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
  },
  css: ['~/assets/css/main.css'],
})
