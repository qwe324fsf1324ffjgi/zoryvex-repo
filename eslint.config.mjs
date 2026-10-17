import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.terraform/**',
      '**/package-lock.json',
      // Authenticated probes against the deployed test environment. They
      // hold a live session cookie, so they are written outside version
      // control and are never part of the shipped source; linting a
      // throwaway script fails the gate for the product it was probing.
      '.tmp-e2e/**',
      // Agent worktrees: full copies of this repository checked out under
      // .claude/ while a background task runs. They are git-ignored, so
      // nothing in them is ever committed, but ESLint walked into one and
      // reported 84 errors against a second copy of files that lint cleanly
      // here. Every rule below is scoped by `files` patterns that match just
      // as happily two directories deeper, so the copy has to be excluded
      // rather than out-configured. Same reason `.prettierignore` excludes it.
      '**/.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['packages/local-adapters/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Playwright specs run in Node but write page.evaluate() callbacks that
    // execute in-browser and reference window/document — both global sets
    // are legitimately needed in the same file.
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/web-safe-shell/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      // Raw apostrophes/quotes in JSX text are valid and safe; this rule is
      // purely cosmetic and hurts readability of marketing copy at scale.
      'react/no-unescaped-entities': 'off',
      // This app's local adapters (packages/local-adapters) read/write
      // localStorage, which React has no visibility into. Loading that
      // external state into React state via `useEffect(() => setX(...), [])`
      // on mount is exactly the pattern this rule's own message describes as
      // correct ("subscribe to an external system, call setState when it
      // changes") — there's no props/state derivation being duplicated
      // here, just a one-time read of a non-reactive store. A full
      // useSyncExternalStore rewrite would need the adapters to emit
      // change events, which they deliberately don't (mutations call an
      // explicit `refresh()` in the same component instead).
      'react-hooks/set-state-in-effect': 'off',
      // The "assign a ref during render" pattern (`ref.current = latestFn`)
      // used by useDebouncedAutosave is the standard "latest ref" technique
      // for giving a setTimeout callback access to a fresh closure without
      // adding it to an effect's dependency array (which would reset the
      // debounce timer on every keystroke). Deliberate, not a bug.
      'react-hooks/refs': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
];
