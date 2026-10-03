// Faz o Projeto 41 subir sozinho ao entrar no sistema (via scripts/supervisor.mjs).
//
//   npm run autostart              instala e já inicia
//   npm run autostart -- --remove  desinstala e encerra
//
// Windows (nativo ou com o projeto dentro do WSL): atalho na pasta Inicializar e na
// Área de Trabalho (este abre o navegador). Linux: serviço systemd do usuário.
// macOS: LaunchAgent.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_NAME = "projeto41";
export const LAUNCHD_LABEL = "com.projeto41.supervisor";

// ---------- partes puras (testadas em autostart.test.mjs) ----------

/** Onde instalar: "windows", "wsl", "linux" ou "macos". */
export function detectTarget(platform = process.platform, environment = process.env) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return environment.WSL_DISTRO_NAME ? "wsl" : "linux";
  throw new Error(`Sistema não suportado: ${platform}.`);
}

/** Linha de comando (vista pelo Windows) que inicia o supervisor. */
export function windowsCommand({ target, nodePath, root, distro }) {
  if (target === "wsl") {
    return `wsl.exe -d ${distro} --cd "${root}" "${nodePath}" scripts/supervisor.mjs`;
  }
  return `"${nodePath}" "${root}\\scripts\\supervisor.mjs"`;
}

export function systemdUnit({ nodePath, root }) {
  return [
    "[Unit]",
    "Description=Projeto 41",
    "After=network-online.target",
    "",
    "[Service]",
    `WorkingDirectory=${root}`,
    `ExecStart="${nodePath}" "${root}/scripts/supervisor.mjs"`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}

const xml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function launchdPlist({ nodePath, root }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(`${root}/scripts/supervisor.mjs`)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
}

// ---------- instalação ----------

const root = resolve(import.meta.dirname, "..");

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} terminou com código ${result.status}.`);
  }
}

function stopSupervisor() {
  sh(process.execPath, [resolve(root, "scripts/supervisor.mjs"), "--stop"], { allowFailure: true });
}

function toWindowsPath(path) {
  return execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
}

function windows(target, remove) {
  const fromWsl = target === "wsl";
  const script = resolve(root, "windows/autostart.ps1");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fromWsl ? toWindowsPath(script) : script];
  if (remove) {
    stopSupervisor();
    sh("powershell.exe", [...args, "-Remove"]);
    return;
  }
  const command = windowsCommand({
    target,
    nodePath: process.execPath,
    root,
    distro: process.env.WSL_DISTRO_NAME
  });
  const logo = resolve(root, "apps/web/public/logo.png");
  // em base64: a linha de comando tem aspas e espaços que não sobrevivem como argumento
  const encoded = Buffer.from(command, "utf8").toString("base64");
  sh("powershell.exe", [...args, "-CommandBase64", encoded, "-LogoPath", fromWsl ? toWindowsPath(logo) : logo]);
}

function linux(remove) {
  const unitPath = resolve(homedir(), ".config/systemd/user", `${SERVICE_NAME}.service`);
  if (remove) {
    sh("systemctl", ["--user", "disable", "--now", SERVICE_NAME], { allowFailure: true });
    rmSync(unitPath, { force: true });
    sh("systemctl", ["--user", "daemon-reload"]);
    console.log("Serviço removido.");
    return;
  }
  mkdirSync(resolve(unitPath, ".."), { recursive: true });
  writeFileSync(unitPath, systemdUnit({ nodePath: process.execPath, root }));
  sh("systemctl", ["--user", "daemon-reload"]);
  sh("systemctl", ["--user", "enable", "--now", SERVICE_NAME]);
  console.log(`Serviço instalado: ${unitPath}`);
  console.log("Para subir mesmo sem login: sudo loginctl enable-linger $USER");
}

function macos(remove) {
  const plistPath = resolve(homedir(), "Library/LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  sh("launchctl", ["unload", plistPath], { allowFailure: true, stdio: "ignore" });
  if (remove) {
    rmSync(plistPath, { force: true });
    console.log("LaunchAgent removido.");
    return;
  }
  mkdirSync(resolve(plistPath, ".."), { recursive: true });
  writeFileSync(plistPath, launchdPlist({ nodePath: process.execPath, root }));
  sh("launchctl", ["load", "-w", plistPath]);
  console.log(`LaunchAgent instalado: ${plistPath}`);
}

function main() {
  const remove = process.argv.includes("--remove");
  const target = detectTarget();
  if (target === "windows" || target === "wsl") windows(target, remove);
  else if (target === "linux") linux(remove);
  else macos(remove);
  if (!remove) console.log("Projeto 41 em http://127.0.0.1:3001 (ou na PORT do .env). Log: data/projeto41.log");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
