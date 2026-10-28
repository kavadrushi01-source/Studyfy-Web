import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // **/scripts/**: dev-only capture/maintenance utilities run with node
    // directly (Node globals, ESM) — not shipped source.
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/build/**", "**/coverage/**", "**/scripts/**"],
  },
);
