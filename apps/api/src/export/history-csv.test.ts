import { describe, expect, it } from "vitest";
import { buildHistoryCsv } from "./history-csv.js";

describe("buildHistoryCsv", () => {
  it("renders one row per snapshot with daily change and a column per category", () => {
    const csv = buildHistoryCsv([
      { date: "2026-06-09", totalBrl: 1000, payload: { crypto: 600, b3: 400 } },
      { date: "2026-06-10", totalBrl: 1100.456, payload: { crypto: 700.456, b3: 400 } }
    ]);

    expect(csv.split("\r\n")).toEqual([
      "date,total_brl,daily_change,crypto,b3",
      "2026-06-09,1000,0,600,400",
      "2026-06-10,1100.46,0.100456,700.46,400"
    ]);
  });

  it("unions categories across snapshots and leaves missing ones empty", () => {
    const csv = buildHistoryCsv([
      { date: "2026-06-09", totalBrl: 500, payload: { crypto: 500 } },
      { date: "2026-06-10", totalBrl: 800, payload: { crypto: 500, "custom:ouro": 300 } }
    ]);

    expect(csv.split("\r\n")).toEqual([
      "date,total_brl,daily_change,crypto,custom:ouro",
      "2026-06-09,500,0,500,",
      "2026-06-10,800,0.6,500,300"
    ]);
  });

  it("uses zero daily change when the previous total is zero", () => {
    const csv = buildHistoryCsv([
      { date: "2026-06-09", totalBrl: 0, payload: {} },
      { date: "2026-06-10", totalBrl: 100, payload: {} }
    ]);

    expect(csv.split("\r\n")).toEqual(["date,total_brl,daily_change", "2026-06-09,0,0", "2026-06-10,100,0"]);
  });

  it("returns only the header when there is no history", () => {
    expect(buildHistoryCsv([])).toBe("date,total_brl,daily_change");
  });
});
