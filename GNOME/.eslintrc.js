module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',

    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
        'prettier/@typescript-eslint',
        'plugin:prettier/recommended',
    ],

    rules: {
        semi: ['error', 'never'],
        'no-debugger': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-misused-new': 'off',
        '@typescript-eslint/triple-slash-reference': 'off',
        // For Gjs
        'camelcase': 'off',
        '@typescript-eslint/camelcase': 'off'
    }
};