module.exports = {
  // Stop ESLint ascending past the project. Without this the lint result depends on what
  // happens to sit in an ancestor directory, which is not a property a gate should have: a
  // checkout nested inside another repository (a git worktree under `.claude/worktrees/`, for
  // one) loads BOTH configs and fails with "couldn't determine the plugin @typescript-eslint
  // uniquely" — an error about the checkout's location rather than about the code.
  root: true,
  parser: '@typescript-eslint/parser', // Specifies the ESLint parser
  plugins: ['@typescript-eslint'],
  extends: [
    'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint/eslint-plugin
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  parserOptions: {
    project: './tsconfig.json',
    ecmaVersion: 2018, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module', // Allows for the use of imports
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'off',
  },
};
