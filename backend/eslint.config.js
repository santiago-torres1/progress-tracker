// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ESLint requires this file to have a default export.
export default defineConfig(
  { ignores: ['dist/', 'coverage/'] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers stringify predictably; banning them in templates only adds String() noise.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Plain JS config files are not part of the TS project; lint them without type info.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Last: turn off stylistic rules that would fight Prettier.
  prettier,
);
