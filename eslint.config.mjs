import tsParser from "@typescript-eslint/parser";

const sourceFiles = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];
const ignoredPaths = [
  "dist/**",
  "node_modules/**",
  "coverage/**",
  "build/**",
  "cache/**",
  ".cache/**",
  "tmp/**",
  ".tmp/**",
  "sample-output/**",
  "pb-output/**",
  "project-brain/pb-output/**"
];

export default [
  {
    ignores: ignoredPaths
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "valid-typeof": "error"
    }
  }
];
