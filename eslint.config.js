import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/server/drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Reine JavaScript-Hilfsskripte laufen in Node. In den TypeScript-Dateien
    // übernimmt das die tsconfig, hier braucht ESLint die Globals ausgeschrieben.
    files: ['**/*.mjs', '**/scripts/**'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // packages/core wandert unverändert in die spätere iOS-App. Alles, was es dort
    // nicht gibt, wird hier hart verboten — die tsconfig lässt DOM-Typen zu, weil
    // fetch und FormData gebraucht werden, aber der Rest bleibt tabu.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'packages/core muss plattformneutral bleiben.' },
        { name: 'document', message: 'packages/core muss plattformneutral bleiben.' },
        { name: 'localStorage', message: 'packages/core muss plattformneutral bleiben.' },
        { name: 'navigator', message: 'packages/core muss plattformneutral bleiben.' },
        { name: 'process', message: 'packages/core muss plattformneutral bleiben.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'Kein Node-Builtin in core.' },
          ],
        },
      ],
    },
  },
)
