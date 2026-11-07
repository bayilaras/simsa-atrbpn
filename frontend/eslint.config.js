import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Deployment checks emit additional dist-* bundles; lint maintained source
  // rather than parsing their generated/minified vendor copies.
  globalIgnores(['dist', 'dist-*', 'dev-dist', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      // React Compiler rules keep their preset severity. Violations that 7.1
      // found in existing components are frozen per file in
      // eslint-suppressions.json, so only new ones fail. After fixing one, run
      // `npx eslint . --prune-suppressions`.
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^[A-Z_]',
      }],
    },
  },
])
