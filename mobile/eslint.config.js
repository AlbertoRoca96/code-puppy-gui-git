const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  ...expoConfig,
  {
    rules: {
      'sort-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  prettierConfig,
]);
