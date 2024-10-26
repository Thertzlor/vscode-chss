import noAutofix from 'eslint-plugin-no-autofix';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import unicorn from 'eslint-plugin-unicorn';
import stylistic from '@stylistic/eslint-plugin';
import tsdoc from 'eslint-plugin-tsdoc';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import js from '@eslint/js';
import {FlatCompat} from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [{
  ignores: ['src/Tocket/*', 'out/**/*', 'dist/**/*']
}, ...compat.extends(
  'plugin:@typescript-eslint/eslint-recommended',
  'plugin:@typescript-eslint/recommended',
  'eslint:recommended'
), {
  plugins: {
    'no-autofix': noAutofix,
    '@typescript-eslint': typescriptEslint,
    unicorn,
    '@stylistic': stylistic,
    tsdoc
  },

  languageOptions: {
    globals: {
      ...globals.browser,
      Atomics: 'readonly',
      SharedArrayBuffer: 'readonly'
    },

    parser: tsParser,
    ecmaVersion: 6,
    sourceType: 'module',

    parserOptions: {
      project: ['./tsconfig.json'],

      ecmaFeatures: {
        modules: true
      }
    }
  },

  rules: {
    'tsdoc/syntax': 1,
    '@typescript-eslint/no-this-alias': 0,
    '@typescript-eslint/camelcase': 0,
    '@typescript-eslint/explicit-function-return-type': 0,
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/no-var-requires': 0,
    '@typescript-eslint/no-explicit-any': 0,
    '@typescript-eslint/no-inferrable-types': 0,
    '@typescript-eslint/no-non-null-assertion': 0,
    '@typescript-eslint/prefer-includes': 0,
    '@typescript-eslint/prefer-regexp-exec': 0,
    '@typescript-eslint/prefer-string-starts-ends-with': 0,
    '@typescript-eslint/no-unused-expressions': 0,
    '@typescript-eslint/triple-slash-reference': 0,
    '@typescript-eslint/ban-ts-comment': 0,
    '@typescript-eslint/no-throw-literal': 0,
    '@typescript-eslint/consistent-type-assertions': 1,
    '@typescript-eslint/no-use-before-define': 1,
    '@typescript-eslint/no-useless-constructor': 1,
    '@typescript-eslint/no-empty-function': 1,
    '@typescript-eslint/no-loop-func': 1,
    '@typescript-eslint/no-shadow': 1,
    '@/no-extra-semi': 1,
    '@typescript-eslint/no-duplicate-enum-values': 2,
    '@typescript-eslint/no-dupe-class-members': 2,
    '@typescript-eslint/no-dynamic-delete': 2,
    '@typescript-eslint/no-redeclare': 2,
    '@typescript-eslint/no-confusing-non-null-assertion': 1,
    '@typescript-eslint/no-redundant-type-constituents': 2,
    '@typescript-eslint/no-require-imports': 2,
    '@typescript-eslint/prefer-optional-chain': 1,
    '@typescript-eslint/prefer-readonly': 1,
    '@typescript-eslint/no-unsafe-declaration-merging': 2,
    '@typescript-eslint/prefer-reduce-type-parameter': 1,
    'no-autofix/@typescript-eslint/no-unnecessary-condition': 1,
    '@typescript-eslint/no-unnecessary-type-assertion': 1,
    '@typescript-eslint/no-unnecessary-type-arguments': 1,
    '@typescript-eslint/no-unnecessary-type-constraint': 1,

    '@typescript-eslint/prefer-nullish-coalescing': [1, {
      ignorePrimitives: {
        string: true
      }
    }],

    '@typescript-eslint/no-unused-vars': [1, {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }],

    'prefer-spread': 0,
    'no-undef': 0,
    'no-dupe-class-members': 0,
    'no-redeclare': 0,
    'no-empty': 1,
    'no-useless-escape': 1,
    'no-param-reassign': 1,
    'no-useless-return': 1,
    'no-var': 1,
    'object-shorthand': 1,
    'getter-return': 2,
    'for-direction': 2,
    'no-empty-character-class': 1,
    'no-duplicate-case': 'error',
    'no-dupe-keys': 2,
    'no-dupe-else-if': 2,
    'no-cond-assign': 1,
    'no-compare-neg-zero': 2,
    'no-obj-calls': 1,
    'no-invalid-regexp': 2,
    'no-misleading-character-class': 2,
    'no-setter-return': 1,
    'no-extra-boolean-cast': 1,
    'array-callback-return': 2,
    'accessor-pairs': 2,
    'block-scoped-var': 1,
    eqeqeq: 1,
    'no-extra-label': 1,
    'no-eq-null': 1,
    'no-else-return': 1,
    'no-constructor-return': 2,
    'no-constant-condition': 1,
    'guard-for-in': 1,
    'no-lone-blocks': 1,
    'wrap-iife': 1,
    radix: 1,
    'prefer-regex-literals': 1,
    'no-useless-concat': 1,
    'no-new-func': 1,
    'no-new-wrappers': 1,
    'no-multi-str': 1,
    'no-unmodified-loop-condition': 1,
    'arrow-spacing': 1,
    'no-confusing-arrow': 1,
    'symbol-description': 1,
    'prefer-template': 1,
    'prefer-arrow-callback': 1,
    'no-useless-rename': 1,
    'no-useless-computed-key': 1,
    'no-unused-vars': 0,
    'operator-assignment': 1,
    'no-prototype-builtins': 0,
    'no-lonely-if': 1,
    'no-unneeded-ternary': 1,
    'arrow-body-style': [1, 'as-needed'],
    curly: [1, 'multi-line'],

    'prefer-const': [1, {
      ignoreReadBeforeAssign: true,
      destructuring: 'all'
    }],

    '@stylistic/no-extra-semi': 0,
    '@stylistic/wrap-iife': 1,
    '@stylistic/template-curly-spacing': 1,
    '@stylistic/implicit-arrow-linebreak': 1,
    '@stylistic/array-bracket-spacing': 1,
    '@stylistic/computed-property-spacing': 1,
    '@stylistic/object-curly-spacing': 1,
    '@stylistic/comma-dangle': 1,
    '@stylistic/space-in-parens': 1,
    '@stylistic/dot-location': 1,
    '@stylistic/no-multi-spaces': 1,
    '@stylistic/arrow-spacing': 1,
    '@stylistic/no-confusing-arrow': 1,
    '@stylistic/space-unary-ops': 1,
    '@stylistic/comma-style': 1,
    '@stylistic/no-trailing-spaces': 1,
    '@stylistic/new-parens': 1,
    '@stylistic/no-whitespace-before-property': 1,
    '@stylistic/function-call-spacing': 1,
    '@stylistic/no-floating-decimal': 1,
    '@stylistic/rest-spread-spacing': 1,

    '@stylistic/type-annotation-spacing': [1, {
      before: false,
      after: false
    }],

    '@stylistic/quotes': [1, 'single'],
    '@stylistic/semi': [1, 'always'],

    '@stylistic/lines-between-class-members': [1, 'always', {
      exceptAfterSingleLine: true
    }],

    '@stylistic/keyword-spacing': [1, {
      after: true
    }],

    '@stylistic/space-before-function-paren': [1, 'never'],
    '@stylistic/arrow-parens': [1, 'as-needed'],
    '@stylistic/nonblock-statement-body-position': [1, 'beside'],

    '@stylistic/quote-props': [1, 'as-needed', {
      keywords: true,
      numbers: true
    }],

    '@stylistic/no-extra-parens': [1, 'all', {
      nestedBinaryExpressions: false,
      enforceForArrowConditionals: false,
      enforceForSequenceExpressions: false,
      enforceForNewInMemberExpressions: false,
      returnAssign: false
    }],

    '@stylistic/indent': [1, 2, {
      flatTernaryExpressions: true,
      VariableDeclarator: 'first',
      ignoreComments: true
    }],

    '@stylistic/semi-spacing': [1, {
      before: false,
      after: true
    }],

    '@stylistic/no-multiple-empty-lines': [1, {
      max: 2,
      maxBOF: 0
    }],

    '@stylistic/switch-colon-spacing': [1, {
      after: true,
      before: false
    }],

    '@stylistic/operator-linebreak': [1, 'after'],
    '@stylistic/function-paren-newline': [1, 'multiline-arguments'],

    '@stylistic/member-delimiter-style': [1, {
      singleline: {
        delimiter: 'comma',
        requireLast: false
      },

      multiline: {
        delimiter: 'comma',
        requireLast: false
      }
    }],

    '@stylistic/block-spacing': [1, 'never'],
    'unicorn/better-regex': 1,
    'unicorn/empty-brace-spaces': 1,
    'unicorn/new-for-builtins': 1,
    'unicorn/no-array-method-this-argument': 1,
    'unicorn/no-array-push-push': 1,
    'unicorn/no-useless-fallback-in-spread': 1,
    'unicorn/no-useless-length-check': 1,
    'unicorn/no-useless-undefined': 1,
    'unicorn/no-typeof-undefined': 1,
    'unicorn/prefer-optional-catch-binding': 1,
    'unicorn/template-indent': 1,
    'unicorn/throw-new-error': 2,
    'unicorn/no-zero-fractions': 1,
    'unicorn/prefer-array-some': 1,
    'unicorn/no-instanceof-array': 1,
    'unicorn/prefer-date-now': 1,
    'unicorn/no-static-only-class': 1,
    'unicorn/prefer-string-starts-ends-with': 1,
    'unicorn/prefer-string-slice': 1,
    'unicorn/no-unreadable-array-destructuring': 1,
    'unicorn/no-null': 1,
    'unicorn/no-this-assignment': 2,
    'unicorn/no-useless-spread': 1,
    'unicorn/no-array-for-each': 1,
    'unicorn/no-for-loop': 1,
    'unicorn/prefer-default-parameters': 1,
    'unicorn/consistent-function-scoping': 1,
    'unicorn/no-unnecessary-await': 1,
    'unicorn/prefer-array-flat': 1,
    'unicorn/prefer-array-flat-map': 1,
    'unicorn/prefer-array-index-of': 1,
    'unicorn/prefer-at': 1,
    'unicorn/prefer-includes': 1,
    'unicorn/prefer-negative-index': 1,
    'unicorn/prefer-regexp-test': 1,
    'unicorn/prefer-set-has': 1,
    'unicorn/prefer-set-size': 1,
    'unicorn/prefer-string-replace-all': 1,
    'unicorn/prefer-string-trim-start-end': 1,
    'unicorn/no-lonely-if': 2,
    'unicorn/prefer-spread': 1,
    'unicorn/no-new-array': 2,
    'unicorn/consistent-destructuring': 1,
    'unicorn/no-object-as-default-parameter': 2,
    'unicorn/prefer-ternary': 1,

    'unicorn/catch-error-name': [1, {
      name: 'e'
    }]
  }
}];