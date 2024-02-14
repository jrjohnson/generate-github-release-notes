'use strict';

module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: ['eslint:recommended'],
  env: {
    node: true,
  },
  rules: {},
  overrides: [
    {
      // test files
      files: ['test/**/*-test.js'],
      env: {
        mocha: true,
      },
      plugins: [
        "mocha"
      ],
    },
  ],
};
