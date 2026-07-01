import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated + build output — not ours to lint.
  { ignores: ["dist", "src/api/schema.d.ts", "test-results", "playwright-report"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
