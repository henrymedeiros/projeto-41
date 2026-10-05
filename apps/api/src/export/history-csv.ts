type HistorySnapshot = { date: string; totalBrl: number; payload: Record<string, number> };

const HEADER = ["date", "total_brl", "daily_change"];

// Snapshots must come in ascending date order (as db.snapshots.list returns them).
// daily_change is a ratio vs. the previous snapshot (0.012 = +1.2%); category columns
// are the union of payload keys in first-seen order, left empty where a day lacks one.
export function buildHistoryCsv(snapshots: HistorySnapshot[]): string {
  const categories = [...new Set(snapshots.flatMap((snapshot) => Object.keys(snapshot.payload)))];
  const rows = snapshots.map((snapshot, index) => {
    const previous = snapshots[index - 1];
    const change = previous && previous.totalBrl > 0 ? snapshot.totalBrl / previous.totalBrl - 1 : 0;
    const values = categories.map((category) => {
      const value = snapshot.payload[category];
      return value === undefined ? "" : roundMoney(value);
    });
    return [snapshot.date, roundMoney(snapshot.totalBrl), roundRatio(change), ...values].map(csvCell).join(",");
  });
  return [[...HEADER, ...categories].map(csvCell).join(","), ...rows].join("\r\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
