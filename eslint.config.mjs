import { createConfigForNuxt } from '@nuxt/eslint-config'

export default createConfigForNuxt().append({
  ignores: ['.nuxt/**', '.output/**', 'dist/**', 'node_modules/**'],
})
