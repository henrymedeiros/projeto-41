import cron from "node-cron";
import type { AppDatabase } from "@projeto41/db";
import type { createPriceService } from "../prices/price-service.js";
import { createDailySnapshot, snapshotDate } from "../services/portfolio-service.js";

export function startScheduler(
  db: AppDatabase,
  priceService: ReturnType<typeof createPriceService>,
  timezone = "America/Fortaleza"
) {
  const recordSnapshot = () => {
    try {
      createDailySnapshot(db, snapshotDate(timezone));
    } catch (error) {
      console.error("Falha ao gravar o snapshot do dia:", error);
    }
  };
  // ao ligar: um dia em que o servidor ficou no ar já ganha registro, mesmo sem chegar às 23:59
  recordSnapshot();

  const tasks = [
    cron.schedule("*/15 * * * *", () => void priceService.runCrypto(), {
      timezone
    }),
    cron.schedule("*/30 10-18 * * 1-5", () => void priceService.runB3(), {
      timezone
    }),
    cron.schedule("0 */2 * * *", () => void priceService.runCurrency(), {
      timezone
    }),
    // de hora em hora (depois da cripto do minuto 0) e no fechamento do dia
    cron.schedule("5 * * * *", recordSnapshot, { timezone }),
    cron.schedule("59 23 * * *", recordSnapshot, { timezone })
  ];
  return () => tasks.forEach((task) => task.stop());
}
