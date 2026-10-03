import { describe, expect, it } from "vitest";
import { detectTarget, launchdPlist, systemdUnit, windowsCommand } from "./autostart.mjs";

describe("detectTarget", () => {
  it("maps each platform to an installer", () => {
    expect(detectTarget("win32", {})).toBe("windows");
    expect(detectTarget("darwin", {})).toBe("macos");
    expect(detectTarget("linux", {})).toBe("linux");
    expect(detectTarget("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe("wsl");
    expect(() => detectTarget("aix", {})).toThrow();
  });
});

describe("windowsCommand", () => {
  it("quotes native Windows paths with spaces", () => {
    expect(
      windowsCommand({
        target: "windows",
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        root: "C:\\Users\\me\\coding projects\\projeto-41"
      })
    ).toBe('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\coding projects\\projeto-41\\scripts\\supervisor.mjs"');
  });

  it("runs the supervisor inside the WSL distro", () => {
    expect(
      windowsCommand({
        target: "wsl",
        nodePath: "/home/me/.nvm/versions/node/v22/bin/node",
        root: "/home/me/projeto-41",
        distro: "Ubuntu"
      })
    ).toBe('wsl.exe -d Ubuntu --cd "/home/me/projeto-41" "/home/me/.nvm/versions/node/v22/bin/node" scripts/supervisor.mjs');
  });
});

describe("service definitions", () => {
  const options = { nodePath: "/usr/bin/node", root: "/srv/projeto 41" };

  it("systemd unit restarts the supervisor and starts with the session", () => {
    const unit = systemdUnit(options);
    expect(unit).toContain('ExecStart="/usr/bin/node" "/srv/projeto 41/scripts/supervisor.mjs"');
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("launchd plist keeps the supervisor alive", () => {
    const plist = launchdPlist(options);
    expect(plist).toContain("<string>/srv/projeto 41/scripts/supervisor.mjs</string>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
  });
});
