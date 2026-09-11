import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['node_modules/', 'dist/', 'release/', '.test-data/', '.husky/_/']),
  {
    files: ['**/*.{js,cjs,mjs,ts}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/monitor/**/*.ts',
      'src/tests/**/*.ts',
      'scripts/**/*.cjs',
      '*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
