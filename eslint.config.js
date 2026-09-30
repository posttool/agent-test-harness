import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // P1: the LLM does the reasoning. No regular expressions in runtime source.
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[regex]", message: "P1: no regex in runtime code; the LLM does the reasoning." },
        { selector: "NewExpression[callee.name='RegExp']", message: "P1: no regex in runtime code; the LLM does the reasoning." },
        { selector: "CallExpression[callee.name='RegExp']", message: "P1: no regex in runtime code; the LLM does the reasoning." },
      ],
    },
  },
);
