import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.react-router/**',
      'references/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['frontend/vite.config.ts', 'frontend/react-router.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'frontend/app/**/*.server.{ts,tsx}',
      'frontend/app/**/.server/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'frontend/app/**/*.client.{ts,tsx}',
      'frontend/app/**/.client/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['frontend/app/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh.plugin,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowCompoundComponents: true,
        },
      ],
    },
  },
  {
    files: ['frontend/app/routes/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowCompoundComponents: true,
          allowExportNames: ['loader', 'action', 'links'],
        },
      ],
    },
  },
);
