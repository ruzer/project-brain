import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      complexity: ["warn", 12],
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }]
    }
  }
];
