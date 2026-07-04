import { z } from "zod";
import {
  db,
  ensureDefaultSettings,
  type CardRow,
  type LogRow,
  type ProgressRow,
  type SettingsRow,
} from "./db";

// 匯出 / 匯入 / 重置(DATA_MODEL §3)。
// 匯入僅驗 top-level 結構與 version;row 層級信任個人備份檔。

export const BACKUP_VERSION = 1 as const;

export interface BackupFile {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  cards: CardRow[];
  logs: LogRow[];
  progress: ProgressRow[];
  settings: SettingsRow[];
}

const BackupShape = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  cards: z.array(z.looseObject({})),
  logs: z.array(z.looseObject({})),
  progress: z.array(z.looseObject({})),
  settings: z.array(z.looseObject({})),
});

const ALL_TABLES = [db.cards, db.logs, db.progress, db.settings];

/** 匯出全部使用者資料為單一物件(logs 保留原 id,匯入後可完全還原) */
export async function exportData(now: Date = new Date()): Promise<BackupFile> {
  const [cards, logs, progress, settings] = await db.transaction("r", ALL_TABLES, () =>
    Promise.all([
      db.cards.toArray(),
      db.logs.toArray(),
      db.progress.toArray(),
      db.settings.toArray(),
    ]),
  );
  return { version: BACKUP_VERSION, exportedAt: now.toISOString(), cards, logs, progress, settings };
}

/** 驗證備份檔(version + top-level 結構),失敗丟明確錯誤;不寫入 DB(供匯入前預覽) */
export function parseBackup(raw: unknown): BackupFile {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("備份檔格式錯誤:內容不是 JSON 物件");
  }
  const version = (raw as { version?: unknown }).version;
  if (version !== BACKUP_VERSION) {
    throw new Error(`備份檔版本不符:此版本僅接受 ${BACKUP_VERSION},檔案為 ${String(version)}`);
  }
  const parsed = BackupShape.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`備份檔格式錯誤:${issue ? `${issue.path.join(".")} ${issue.message}` : "結構不符"}`);
  }
  return parsed.data as unknown as BackupFile;
}

/**
 * 匯入備份:version 相符才允許;單一 transaction 內全清後寫入
 * (中途失敗自動 rollback,不會出現「清了沒寫」的狀態)。
 */
export async function importData(raw: unknown): Promise<void> {
  const data = parseBackup(raw);

  await db.transaction("rw", ALL_TABLES, async () => {
    await Promise.all(ALL_TABLES.map((table) => table.clear()));
    await db.cards.bulkPut(data.cards);
    await db.logs.bulkPut(data.logs);
    await db.progress.bulkPut(data.progress);
    await db.settings.bulkPut(data.settings);
  });
}

/** 重置所有進度:清空四表並回填預設 settings */
export async function resetAll(): Promise<void> {
  await db.transaction("rw", ALL_TABLES, async () => {
    await Promise.all(ALL_TABLES.map((table) => table.clear()));
  });
  await ensureDefaultSettings();
}
