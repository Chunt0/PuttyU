import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // schema.d.ts is generated; eslint.config.ts is loaded by ESLint (jiti), not linted.
  { ignores: ["dist", "src/api/schema.d.ts", "eslint.config.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // The typed API seam must never use `any` (ADR 0002 Gate 4).
    files: ["src/api/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);
