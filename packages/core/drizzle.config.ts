import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  // Migrations are generated offline and checked in; no live connection needed.
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/parea' },
});
