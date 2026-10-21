// Flat ESLint config (ESLint 9) for the whole monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/release/**',
      '**/dist-electron/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/storybook-static/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.config.{js,ts,cjs,mjs}',
      '**/.storybook/**',
      '**/scripts/**',
      '**/tools/**',
      // Illustrative REST contract only (ts-nocheck'd); real contract is the typed repository.
      '**/msw-handlers.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // The sparkle / magic-wand glyph reads as AI-generated filler. Owner rule:
      // never in any Stratemark UI. Use a plain, meaningful icon or no icon.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              importNames: [
                'Sparkles', 'Sparkle', 'SparklesIcon', 'SparkleIcon', 'LucideSparkles', 'LucideSparkle',
                'WandSparkles', 'WandSparklesIcon', 'LucideWandSparkles', 'Wand2', 'Wand2Icon', 'LucideWand2',
                'Wand', 'WandIcon', 'LucideWand',
              ],
              message: 'No sparkle or magic-wand icons in Stratemark. Use a plain icon that says what the button does, or none.',
            },
          ],
          patterns: [
            {
              group: ['lucide-react/**/sparkle*', 'lucide-react/**/wand*', 'lucide-react/**/*-sparkles*'],
              message: 'No sparkle or magic-wand icons in Stratemark.',
            },
          ],
        },
      ],
    },
  },
);
