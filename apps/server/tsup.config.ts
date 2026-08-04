import { defineConfig } from 'tsup'

export default defineConfig({
  /*
   * Zwei Einstiegspunkte: Der Migrationslauf gehört mit ins Bundle, damit er in
   * Produktion vor dem Serverstart laufen kann, ohne dass tsx oder die
   * Entwicklungsabhängigkeiten im Image liegen müssen.
   *
   * Die Ablage unter dist/db/migrate.js ist kein Zufall: migrate.ts sucht den
   * Migrationsordner über import.meta.url zwei Ebenen höher — aus dist/db/ trifft
   * das genau apps/server/drizzle, wie im Quellbaum aus src/db/.
   */
  entry: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // @comatch/core ist ein Workspace-Paket und liegt in Produktion nicht als
  // eigenes node_modules-Verzeichnis vor — es muss mit hineingebündelt werden.
  noExternal: [/^@comatch\//],
})
