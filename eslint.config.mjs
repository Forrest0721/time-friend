import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const webFiles = ["apps/web/**/*.{ts,tsx}"];

function scopeToWeb(configs) {
  return configs.map((config) => ({ ...config, files: webFiles }));
}

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "playwright.config.ts"],
  })),
  ...scopeToWeb(nextVitals),
  ...scopeToWeb(nextTs),
  {
    files: webFiles,
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    "**/coverage/**",
    "**/dist/**",
  ]),
]);

export default eslintConfig;
