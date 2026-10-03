// Copia o banco de produção para o banco de testes da prévia, com a produção rodando.
// Usa a API de backup do SQLite: a cópia é consistente e inclui o que ainda está no WAL
// (copiar o arquivo .sqlite direto perderia as gravações recentes).
//
//   node scripts/copy-database.mjs <origem> <destino>
//
// Roda num processo à parte: se o supervisor carregasse o better-sqlite3, o Windows
// travaria o módulo nativo e o npm ci não conseguiria substituí-lo.
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error("uso: node scripts/copy-database.mjs <origem> <destino>");
  process.exit(2);
}
if (!existsSync(source)) {
  console.log(`sem banco em ${source}: nada a copiar`);
  process.exit(0);
}

const database = new Database(source, { fileMustExist: true });
try {
  await database.backup(destination);
  console.log(`banco copiado: ${source} -> ${destination}`);
} finally {
  database.close();
}
