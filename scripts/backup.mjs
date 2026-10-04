// Backup criptografado do banco do Projeto 41 numa pasta sincronizada com a nuvem
// (ex.: Google Drive para computador). O supervisor chama uma vez por dia.
//
//   node scripts/backup.mjs                          gera um backup agora
//   node scripts/backup.mjs --status                 mostra o último backup
//   node scripts/backup.mjs --restore <arquivo>      restaura para o banco do projeto
//        [--to <caminho>] [--force]                  (outro destino / sobrescrever)
//
// Configuração no .env:
//   PROJETO41_BACKUP_DIR       pasta de destino (ex.: G:\Meu Drive\Projeto41)
//   PROJETO41_BACKUP_PASSWORD  senha da criptografia; guarde-a também FORA do PC
//   PROJETO41_BACKUP_KEEP      quantos backups manter (padrão 30)
//
// Formato do arquivo (.sqlite.enc): "P41BAK1" + salt(16) + iv(12) + tag(16) + dados,
// AES-256-GCM com chave derivada da senha por scrypt.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const MAGIC = Buffer.from("P41BAK1");
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SQLITE_HEADER = Buffer.from("SQLite format 3");
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_NAME = /^projeto41-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sqlite\.enc$/;

// ---------- partes puras (testadas em backup.test.mjs) ----------

/** Valor de uma chave: variável de ambiente > .env > padrão. */
export function readEnvValue(envFileText, key, environment = process.env, fallback = "") {
  if (environment[key]) return environment[key];
  const line = envFileText.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
  if (!line) return fallback;
  const value = line.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  return value || fallback;
}

export function encryptBackup(plain, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(data, password) {
  if (data.length < MAGIC.length + 44 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("O arquivo não é um backup do Projeto 41");
  }
  let offset = MAGIC.length;
  const take = (size) => data.subarray(offset, (offset += size));
  const salt = take(16);
  const iv = take(12);
  const tag = take(16);
  const body = data.subarray(offset);
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(password, salt, 32, SCRYPT), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Senha errada ou arquivo corrompido");
  }
}

export function backupFileName(now = new Date()) {
  return `projeto41-${now.toISOString().slice(0, 19).replace(/:/g, "-")}Z.sqlite.enc`;
}

/** Backups a apagar para ficar com os `keep` mais recentes (o nome ordena pela data). */
export function backupsToPrune(names, keep) {
  return names
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .reverse()
    .slice(Math.max(keep, 1));
}

/** Passou um dia desde o último backup (ou nunca houve)? */
export function needsBackup(stamp, now = Date.now()) {
  const last = Date.parse(stamp?.at ?? "");
  return !Number.isFinite(last) || now - last >= DAY_MS;
}

// ---------- ambiente real ----------

const root = resolve(import.meta.dirname, "..");
const stampPath = resolve(root, "data/backup-stamp.json");

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function loadConfig() {
  const envText = readText(resolve(root, ".env"));
  return {
    directory: readEnvValue(envText, "PROJETO41_BACKUP_DIR"),
    password: readEnvValue(envText, "PROJETO41_BACKUP_PASSWORD"),
    keep: Number(readEnvValue(envText, "PROJETO41_BACKUP_KEEP", process.env, "30")) || 30,
    databasePath: resolve(root, readEnvValue(envText, "DATABASE_URL", process.env, "./data/projeto41.sqlite"))
  };
}

async function createBackup() {
  const config = loadConfig();
  if (!config.directory || !config.password) {
    console.log("Backup desligado: defina PROJETO41_BACKUP_DIR e PROJETO41_BACKUP_PASSWORD no .env.");
    return 0;
  }
  if (!existsSync(config.databasePath)) {
    console.log(`Sem banco em ${config.databasePath}: nada a copiar.`);
    return 0;
  }
  try {
    mkdirSync(config.directory, { recursive: true });
  } catch (error) {
    throw new Error(`pasta de backup inacessível (${config.directory}): o Google Drive está aberto? ${error.message}`);
  }

  // Cópia consistente com o app rodando (API de backup do SQLite, inclui o WAL).
  // Import aqui dentro: quem só usa as funções puras (o supervisor) não carrega o módulo nativo.
  const { default: Database } = await import("better-sqlite3");
  const snapshot = resolve(root, `data/backup-${process.pid}.tmp.sqlite`);
  const database = new Database(config.databasePath, { fileMustExist: true });
  try {
    await database.backup(snapshot);
  } finally {
    database.close();
  }

  const name = backupFileName();
  const target = resolve(config.directory, name);
  try {
    // grava com outro nome e renomeia: a nuvem nunca sobe um arquivo pela metade
    writeFileSync(`${target}.partial`, encryptBackup(readFileSync(snapshot), config.password));
    renameSync(`${target}.partial`, target);
  } finally {
    rmSync(snapshot, { force: true });
  }

  for (const old of backupsToPrune(readdirSync(config.directory), config.keep)) {
    rmSync(resolve(config.directory, old), { force: true });
  }
  writeFileSync(stampPath, JSON.stringify({ at: new Date().toISOString(), file: target }));
  console.log(`Backup criptografado: ${target}`);
  return 0;
}

function showStatus() {
  const config = loadConfig();
  const stamp = JSON.parse(readText(stampPath) || "null");
  console.log(`Pasta: ${config.directory || "(não definida)"}`);
  console.log(`Senha: ${config.password ? "definida" : "(não definida)"}`);
  console.log(`Último backup: ${stamp ? `${stamp.at} (${basename(stamp.file)})` : "nunca"}`);
  if (config.directory && existsSync(config.directory)) {
    const count = readdirSync(config.directory).filter((name) => BACKUP_NAME.test(name)).length;
    console.log(`Backups na pasta: ${count} (mantém ${config.keep})`);
  }
  return 0;
}

async function askPassword() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question("Senha do backup: ");
  } finally {
    prompt.close();
  }
}

async function restoreBackup(file, args) {
  const config = loadConfig();
  const target = resolve(args.to ?? config.databasePath);
  if (existsSync(target) && !args.force) {
    throw new Error(
      `${target} já existe. Pare o app (npm run serve -- --stop) e rode de novo com --force ` +
        "(o banco atual é guardado em backups/ antes de ser substituído)."
    );
  }
  const password = config.password || (await askPassword());
  const plain = decryptBackup(readFileSync(resolve(file)), password);
  if (!plain.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new Error("O conteúdo decifrado não é um banco SQLite");
  }
  if (existsSync(target)) {
    const keep = resolve(root, "backups", `${basename(target)}.antes-do-restore-${Date.now()}`);
    mkdirSync(resolve(root, "backups"), { recursive: true });
    renameSync(target, keep);
    for (const suffix of ["-wal", "-shm"]) rmSync(`${target}${suffix}`, { force: true });
    console.log(`Banco anterior guardado em ${keep}`);
  }
  // num computador novo a pasta data/ ainda não existe (o app a cria só ao subir)
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, plain);
  console.log(`Restaurado em ${target}`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (argv.includes("--status")) return showStatus();
  if (argv.includes("--restore")) {
    const file = option("--restore");
    if (!file) throw new Error("Informe o arquivo: --restore <arquivo.sqlite.enc>");
    return restoreBackup(file, { to: option("--to"), force: argv.includes("--force") });
  }
  return createBackup();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Falha no backup: ${error.message}`);
    process.exitCode = 1;
  }
}
