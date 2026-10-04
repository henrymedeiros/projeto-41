import { describe, expect, it } from "vitest";
import {
  backupFileName,
  backupsToPrune,
  decryptBackup,
  encryptBackup,
  needsBackup,
  readEnvValue
} from "./backup.mjs";

describe("encryptBackup / decryptBackup", () => {
  const plain = Buffer.from("SQLite format 3\0 dados financeiros");

  it("round-trips with the right password and never stores the plain bytes", () => {
    const sealed = encryptBackup(plain, "senha forte");

    expect(sealed.includes(Buffer.from("dados financeiros"))).toBe(false);
    expect(decryptBackup(sealed, "senha forte")).toEqual(plain);
  });

  it("uses a fresh salt and iv on every backup", () => {
    expect(encryptBackup(plain, "x").equals(encryptBackup(plain, "x"))).toBe(false);
  });

  it("rejects a wrong password, a tampered file and a file that is not a backup", () => {
    const sealed = encryptBackup(plain, "senha forte");
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;

    expect(() => decryptBackup(sealed, "outra senha")).toThrow("Senha errada ou arquivo corrompido");
    expect(() => decryptBackup(tampered, "senha forte")).toThrow("Senha errada ou arquivo corrompido");
    expect(() => decryptBackup(Buffer.from("qualquer coisa"), "senha forte")).toThrow("não é um backup");
  });
});

describe("backupFileName / backupsToPrune", () => {
  it("names backups by UTC time so the name sorts by date", () => {
    expect(backupFileName(new Date("2026-10-04T03:55:07.123Z"))).toBe("projeto41-2026-10-04T03-55-07Z.sqlite.enc");
  });

  it("keeps the newest backups and ignores other files", () => {
    const names = [
      "projeto41-2026-10-01T00-00-00Z.sqlite.enc",
      "projeto41-2026-10-03T00-00-00Z.sqlite.enc",
      "projeto41-2026-10-02T00-00-00Z.sqlite.enc",
      "projeto41-2026-10-04T00-00-00Z.sqlite.enc.partial",
      "notas.txt"
    ];

    expect(backupsToPrune(names, 2)).toEqual(["projeto41-2026-10-01T00-00-00Z.sqlite.enc"]);
    expect(backupsToPrune(names, 0)).toEqual([
      "projeto41-2026-10-02T00-00-00Z.sqlite.enc",
      "projeto41-2026-10-01T00-00-00Z.sqlite.enc"
    ]);
  });
});

describe("needsBackup", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");

  it("backs up when there was never a backup or the last one is a day old", () => {
    expect(needsBackup(null, now)).toBe(true);
    expect(needsBackup({ at: "2026-10-03T11:59:59Z" }, now)).toBe(true);
    expect(needsBackup({ at: "2026-10-04T06:00:00Z" }, now)).toBe(false);
  });
});

describe("readEnvValue", () => {
  it("prefers the environment, then .env (quotes removed), then the fallback", () => {
    const env = 'PROJETO41_BACKUP_DIR="G:\\Meu Drive\\Projeto41"\nPROJETO41_BACKUP_KEEP=\n';

    expect(readEnvValue(env, "PROJETO41_BACKUP_DIR", {})).toBe("G:\\Meu Drive\\Projeto41");
    expect(readEnvValue(env, "PROJETO41_BACKUP_DIR", { PROJETO41_BACKUP_DIR: "D:\\b" })).toBe("D:\\b");
    expect(readEnvValue(env, "PROJETO41_BACKUP_KEEP", {}, "30")).toBe("30");
    expect(readEnvValue(env, "PROJETO41_BACKUP_PASSWORD", {})).toBe("");
  });
});
