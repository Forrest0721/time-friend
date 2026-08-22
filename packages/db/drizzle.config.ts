import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  casing: "snake_case",
  strict: true,
});
