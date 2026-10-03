// Mantém o Projeto 41 rodando em modo de produção (http://127.0.0.1:PORT):
// instala dependências e compila quando preciso, reinicia o servidor se ele cair
// e, quando o código muda (git pull, checkout, commit), recompila e reinicia sozinho.
// Junto, mantém uma prévia ao vivo (Vite, http://127.0.0.1:4141) que mostra as
// mudanças do frontend ainda sem commit, falando com a mesma API.
//
//   node scripts/supervisor.mjs          roda em primeiro plano
//   node scripts/supervisor.mjs --open   idem, e abre o navegador quando estiver no ar
//   node scripts/supervisor.mjs --stop   encerra o supervisor que estiver rodando
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { delimiter as pathDelimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 3001;
const DEFAULT_PREVIEW_PORT = 4141;
const POLL_MS = Number(process.env.PROJETO41_POLL_SECONDS ?? 60) * 1_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

// ---------- partes puras (testadas em supervisor.test.mjs) ----------

/** Porta do servidor: variável de ambiente > PORT do .env > 3001. */
export function readPort(envFileText = "", environment = process.env) {
  if (environment.PORT) return Number(environment.PORT);
  const match = /^\s*PORT\s*=\s*["']?(\d+)/m.exec(envFileText);
  return match ? Number(match[1]) : DEFAULT_PORT;
}

/** Porta da prévia: variável de ambiente > PROJETO41_PREVIEW_PORT do .env > 4141; 0 desliga (null). */
export function readPreviewPort(envFileText = "", environment = process.env) {
  const match = /^\s*PROJETO41_PREVIEW_PORT\s*=\s*["']?(\d+)/m.exec(envFileText);
  const value = environment.PROJETO41_PREVIEW_PORT ?? match?.[1];
  if (value === undefined || value === "") return DEFAULT_PREVIEW_PORT;
  const port = Number(value);
  return port > 0 ? port : null;
}

/** Coloca o Node em uso na frente do PATH (o npm chamado pelo supervisor usa o mesmo Node). */
export function buildRuntimeEnvironment(nodePath, environment = process.env, delimiter = pathDelimiter) {
  const nodeDirectory = dirname(nodePath);
  const currentPath = environment.PATH ?? environment.Path ?? "";
  return {
    ...environment,
    PATH: currentPath ? `${nodeDirectory}${delimiter}${currentPath}` : nodeDirectory
  };
}

/**
 * Decide o que preparar antes de (re)iniciar o servidor.
 * `current` e `stamp` têm { head, lock }: commit do git e hash do package-lock.json
 * (head é null fora de um repositório git; aí só compila quando falta o build).
 */
export function planPreparation({ hasNodeModules, hasBuild, stamp, current }) {
  // sem registro anterior não dá pra saber se o lockfile mudou: confia no node_modules que existe
  const lockChanged = Boolean(current.lock && stamp) && stamp.lock !== current.lock;
  const headChanged = Boolean(current.head) && stamp?.head !== current.head;
  const install = !hasNodeModules || lockChanged;
  const build = install || !hasBuild || headChanged;
  return { install, build };
}

/** Espera entre reinícios do servidor depois de quedas seguidas: 2s, 4s, 8s… até 60s. */
export function nextBackoff(previousMs) {
  return previousMs ? Math.min(previousMs * 2, 60_000) : 2_000;
}

/** Processo vivo? (process.kill(pid, 0) só testa, não encerra) */
export function isAlive(pid, kill = process.kill) {
  if (!pid) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// ---------- ambiente real ----------

const root = resolve(import.meta.dirname, "..");
const dataDirectory = resolve(root, "data");
const paths = {
  log: resolve(dataDirectory, "projeto41.log"),
  lock: resolve(dataDirectory, "supervisor.lock.json"),
  stamp: resolve(dataDirectory, "build-stamp.json"),
  nodeModules: resolve(root, "node_modules"),
  build: resolve(root, "apps/web/dist/index.html"),
  packageLock: resolve(root, "package-lock.json"),
  env: resolve(root, ".env")
};
const isWindows = process.platform === "win32";
const runtimeEnvironment = buildRuntimeEnvironment(process.execPath);

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function log(message) {
  appendFileSync(paths.log, `[${new Date().toISOString()}] ${message}\n`);
}

function rotateLog() {
  try {
    if (statSync(paths.log).size > MAX_LOG_BYTES) renameSync(paths.log, `${paths.log}.old`);
  } catch {
    // ainda não existe
  }
}

function currentState() {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const head = git.status === 0 ? git.stdout.trim() : null;
  const lockText = readText(paths.packageLock);
  const lock = lockText ? createHash("sha1").update(lockText).digest("hex") : null;
  return { head, lock };
}

/** Roda um comando até o fim, com a saída no log. */
function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    log(`$ ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: root,
      env: runtimeEnvironment,
      shell: isWindows,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => appendFileSync(paths.log, chunk));
    child.stderr.on("data", (chunk) => appendFileSync(paths.log, chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`${command} ${args.join(" ")} terminou com código ${code}.`))
    );
  });
}

const envText = readText(paths.env);
const port = readPort(envText);
const appUrl = `http://127.0.0.1:${port}`;
const previewPort = readPreviewPort(envText);
const previewUrl = previewPort ? `http://127.0.0.1:${previewPort}` : null;

async function isServerReady() {
  try {
    const response = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok && (await response.json())?.ok === true;
  } catch {
    return false;
  }
}

async function waitForServer(attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isServerReady()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return false;
}

function openBrowser() {
  const [command, args] = isWindows
    ? ["cmd.exe", ["/c", "start", "", appUrl]]
    : process.env.WSL_DISTRO_NAME
      ? ["cmd.exe", ["/c", "start", "", appUrl]]
      : process.platform === "darwin"
        ? ["open", [appUrl]]
        : ["xdg-open", [appUrl]];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
}

// ---------- processos mantidos no ar ----------

let stopping = false;

/**
 * Um processo que o supervisor mantém no ar: se cair, volta depois de 2s, 4s, 8s… até 60s.
 * Um único processo (sem npm no meio): encerrar o serviço é encerrar este pid.
 */
function createService(name, url, command, args, options) {
  const service = { child: null, backoffMs: 0, healthySince: 0 };

  service.start = () => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => appendFileSync(paths.log, chunk));
    child.stderr.on("data", (chunk) => appendFileSync(paths.log, chunk));
    child.once("error", (error) => log(`${name}: ${error.message}`));
    service.child = child;
    service.healthySince = Date.now();
    writeLock();
    log(`${name} iniciado (pid ${child.pid}) em ${url}`);
    child.once("exit", (code, signal) => {
      if (service.child === child) service.child = null;
      writeLock();
      if (stopping || child.expectedExit) return;
      if (Date.now() - service.healthySince > 5 * 60_000) service.backoffMs = 0;   // ficou um bom tempo no ar: recomeça a espera
      service.backoffMs = nextBackoff(service.backoffMs);
      log(`${name} caiu (código ${code ?? signal}); reiniciando em ${service.backoffMs / 1000}s`);
      setTimeout(() => !stopping && !service.child && service.start(), service.backoffMs);
    });
  };

  service.stop = () => {
    const child = service.child;
    if (!child) return Promise.resolve();
    child.expectedExit = true;
    return new Promise((resolveStop) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.once("exit", () => {
        clearTimeout(force);
        resolveStop();
      });
      child.kill("SIGTERM");
    });
  };

  return service;
}

const server = createService("servidor", appUrl, process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: resolve(root, "apps/api"),
  env: runtimeEnvironment
});

// Vite em modo dev lendo os arquivos da pasta: mudanças sem commit aparecem na hora
const preview = previewPort
  ? createService(
      "servidor de prévia",
      previewUrl,
      process.execPath,
      [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"],
      { cwd: resolve(root, "apps/web"), env: { ...runtimeEnvironment, API_TARGET: appUrl } }
    )
  : null;

function writeLock() {
  writeFileSync(
    paths.lock,
    JSON.stringify({
      pid: process.pid,
      serverPid: server?.child?.pid ?? null,
      previewPid: preview?.child?.pid ?? null,
      port,
      previewPort
    })
  );
}

// ---------- preparação e atualização ----------

let failedHead = null;   // commit cujo build falhou: só tenta de novo quando o código mudar outra vez

async function prepare({ firstRun }) {
  const current = currentState();
  const plan = planPreparation({
    hasNodeModules: existsSync(paths.nodeModules),
    hasBuild: existsSync(paths.build),
    stamp: readJson(paths.stamp),
    current
  });
  if (!plan.build) return false;
  if (!firstRun && current.head && current.head === failedHead) return false;

  log(`código novo ou sem build (${current.head?.slice(0, 7) ?? "sem git"}): preparando`);
  try {
    if (plan.install) {
      // no Windows o módulo nativo do SQLite fica travado enquanto o servidor roda,
      // e a prévia roda de dentro do node_modules que o npm ci apaga
      await Promise.all([server.stop(), preview?.stop()]);
      await run("npm", ["ci"]);
    }
    await run("npm", ["run", "build"]);
    writeFileSync(paths.stamp, JSON.stringify(current));
    failedHead = null;
    log("build pronto");
    return true;
  } catch (error) {
    failedHead = current.head;
    log(`falha ao preparar: ${error.message} (o servidor segue com o build anterior)`);
    return plan.install;   // depois de mexer no node_modules o servidor precisa voltar de qualquer jeito
  }
}

async function checkForUpdates() {
  if (stopping) return;
  if (await prepare({ firstRun: false })) {
    await server.stop();
    if (!stopping) server.start();
    if (!stopping && preview && !preview.child) preview.start();   // parada pelo npm ci
  }
}

// ---------- linha de comando ----------

function readLock() {
  return readJson(paths.lock);
}

function stopRunning() {
  const lock = readLock();
  if (!lock || !isAlive(lock.pid)) {
    console.log("O supervisor não está rodando.");
    return;
  }
  for (const pid of [lock.serverPid, lock.previewPid, lock.pid]) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // já encerrou
      }
    }
  }
  rmSync(paths.lock, { force: true });
  console.log(`Supervisor encerrado (pid ${lock.pid}).`);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("encerrando");
  await Promise.all([server.stop(), preview?.stop()]);
  rmSync(paths.lock, { force: true });
  process.exit(0);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  mkdirSync(dataDirectory, { recursive: true });

  if (args.has("--stop")) return stopRunning();

  // uma instância só: se outra já cuida do servidor, no máximo abre o navegador
  const lock = readLock();
  if (lock && lock.pid !== process.pid && isAlive(lock.pid)) {
    if (args.has("--open") && (await waitForServer())) openBrowser();
    else console.log(`O Projeto 41 já está rodando (supervisor pid ${lock.pid}).`);
    return;
  }
  for (const pid of [lock?.serverPid, lock?.previewPid]) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, "SIGTERM");   // processo órfão de um supervisor que foi derrubado
    } catch {
      // já encerrou
    }
  }

  rotateLog();
  writeLock();
  log(`supervisor iniciado (pid ${process.pid})`);
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("exit", () => {
    if (readLock()?.pid === process.pid) rmSync(paths.lock, { force: true });
  });

  await prepare({ firstRun: true });
  server.start();
  preview?.start();
  console.log(`Projeto 41 em ${appUrl} (log: data/projeto41.log)`);
  if (previewUrl) console.log(`Prévia ao vivo (mudanças sem commit) em ${previewUrl}`);
  if (args.has("--open") && (await waitForServer())) openBrowser();

  let checking = false;
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await checkForUpdates();
    } finally {
      checking = false;
    }
  }, POLL_MS);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
