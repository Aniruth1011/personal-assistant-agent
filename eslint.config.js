import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["node_modules/**", "**/dist/**", "coverage/**", ".runtime/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
