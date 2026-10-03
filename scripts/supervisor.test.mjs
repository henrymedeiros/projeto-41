import { describe, expect, it } from "vitest";
import {
  buildRuntimeEnvironment,
  isAlive,
  nextBackoff,
  planPreparation,
  readPort,
  readPreviewPort
} from "./supervisor.mjs";

describe("readPort", () => {
  it("prefers the environment, then .env, then 3001", () => {
    expect(readPort("PORT=4000", { PORT: "5000" })).toBe(5000);
    expect(readPort("# comment\nPORT=4000\nTZ=x", {})).toBe(4000);
    expect(readPort('PORT="4100"', {})).toBe(4100);
    expect(readPort("", {})).toBe(3001);
  });
});

describe("readPreviewPort", () => {
  it("prefers the environment, then .env, then 4141", () => {
    expect(readPreviewPort("PROJETO41_PREVIEW_PORT=4200", { PROJETO41_PREVIEW_PORT: "4300" })).toBe(4300);
    expect(readPreviewPort("PORT=3001\nPROJETO41_PREVIEW_PORT='4200'", {})).toBe(4200);
    expect(readPreviewPort("PORT=3001", {})).toBe(4141);
  });

  it("is turned off by 0", () => {
    expect(readPreviewPort("PROJETO41_PREVIEW_PORT=0", {})).toBeNull();
    expect(readPreviewPort("", { PROJETO41_PREVIEW_PORT: "0" })).toBeNull();
  });
});

describe("buildRuntimeEnvironment", () => {
  it("puts the active Node installation first in PATH", () => {
    expect(
      buildRuntimeEnvironment("/home/user/.nvm/versions/node/v22.12.0/bin/node", { PATH: "/usr/bin" }, ":").PATH
    ).toBe("/home/user/.nvm/versions/node/v22.12.0/bin:/usr/bin");
    expect(buildRuntimeEnvironment("/opt/node/bin/node", {}, ":").PATH).toBe("/opt/node/bin");
  });
});

describe("planPreparation", () => {
  const current = { head: "b", lock: "l1" };

  it("does nothing when the build matches the current commit and lockfile", () => {
    expect(
      planPreparation({ hasNodeModules: true, hasBuild: true, stamp: { head: "b", lock: "l1" }, current })
    ).toEqual({ install: false, build: false });
  });

  it("rebuilds when the commit changes", () => {
    expect(
      planPreparation({ hasNodeModules: true, hasBuild: true, stamp: { head: "a", lock: "l1" }, current })
    ).toEqual({ install: false, build: true });
  });

  it("reinstalls and rebuilds when the lockfile changes or node_modules is missing", () => {
    expect(
      planPreparation({ hasNodeModules: true, hasBuild: true, stamp: { head: "b", lock: "l0" }, current })
    ).toEqual({ install: true, build: true });
    expect(
      planPreparation({ hasNodeModules: false, hasBuild: true, stamp: { head: "b", lock: "l1" }, current })
    ).toEqual({ install: true, build: true });
  });

  it("builds a fresh checkout with no stamp", () => {
    expect(planPreparation({ hasNodeModules: true, hasBuild: false, stamp: null, current })).toEqual({
      install: false,
      build: true
    });
  });

  it("outside git, only builds when the build is missing", () => {
    const noGit = { head: null, lock: "l1" };
    expect(
      planPreparation({ hasNodeModules: true, hasBuild: true, stamp: { head: null, lock: "l1" }, current: noGit })
    ).toEqual({ install: false, build: false });
    expect(
      planPreparation({ hasNodeModules: true, hasBuild: false, stamp: { head: null, lock: "l1" }, current: noGit })
    ).toEqual({ install: false, build: true });
  });
});

describe("nextBackoff", () => {
  it("doubles from 2s up to 60s", () => {
    expect(nextBackoff(0)).toBe(2_000);
    expect(nextBackoff(2_000)).toBe(4_000);
    expect(nextBackoff(40_000)).toBe(60_000);
    expect(nextBackoff(60_000)).toBe(60_000);
  });
});

describe("isAlive", () => {
  it("treats ESRCH as dead and EPERM as alive", () => {
    const err = (code) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(isAlive(123, () => true)).toBe(true);
    expect(isAlive(123, err("ESRCH"))).toBe(false);
    expect(isAlive(123, err("EPERM"))).toBe(true);
    expect(isAlive(null, () => true)).toBe(false);
  });
});
