"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { exportData, importData, parseBackup, resetAll, type BackupFile } from "@/lib/backup";
import { getAllSettings, setSetting, type Settings } from "@/lib/db";

type Notice = { kind: "success" | "error"; text: string } | null;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-medium text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm text-neutral-700">
      {label}
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  // 匯入 / 重置後 bump,讓表單以新值重掛(欄位為 uncontrolled + defaultValue)
  const [formEpoch, setFormEpoch] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function reloadSettings() {
    setSettings(await getAllSettings());
    setFormEpoch((epoch) => epoch + 1);
  }

  useEffect(() => {
    void getAllSettings().then(setSettings);
  }, []);

  function updateNumber(key: "newPerDay" | "maxReviewsPerDay", rawValue: string) {
    const value = Number(rawValue);
    if (rawValue === "" || !Number.isInteger(value) || value < 0) return;
    void setSetting(key, value);
  }

  async function handleExport() {
    try {
      const backup = await exportData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `minna-backup-${backup.exportedAt.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ kind: "success", text: "已產生備份檔並開始下載。" });
    } catch (err) {
      setNotice({ kind: "error", text: `匯出失敗:${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // 同一檔案可重選
    setPendingImport(null);
    setNotice(null);
    if (!file) return;
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      setPendingImport(backup);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) return;
    try {
      await importData(pendingImport);
      setPendingImport(null);
      await reloadSettings();
      setNotice({ kind: "success", text: "匯入完成,資料已覆蓋。" });
    } catch (err) {
      setNotice({ kind: "error", text: `匯入失敗:${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleConfirmReset() {
    await resetAll();
    setConfirmingReset(false);
    await reloadSettings();
    setNotice({ kind: "success", text: "已重置所有進度。" });
  }

  if (!settings) {
    return <p className="p-6 text-center text-sm text-neutral-500">載入中…</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">設定</h1>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 text-sm ${
            notice.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-sky-200 bg-sky-50 text-sky-700"
          }`}
        >
          {notice.text}
        </p>
      )}

      <SectionCard title="學習設定">
        <div key={formEpoch} className="flex flex-col divide-y divide-neutral-100">
          <FieldRow label="每日新卡上限">
            <input
              type="number"
              min={0}
              aria-label="每日新卡上限"
              defaultValue={settings.newPerDay}
              onChange={(e) => updateNumber("newPerDay", e.target.value)}
              className="w-20 rounded border border-neutral-300 px-2 py-1 text-right"
            />
          </FieldRow>
          <FieldRow label="每日複習上限">
            <input
              type="number"
              min={0}
              aria-label="每日複習上限"
              defaultValue={settings.maxReviewsPerDay}
              onChange={(e) => updateNumber("maxReviewsPerDay", e.target.value)}
              className="w-20 rounded border border-neutral-300 px-2 py-1 text-right"
            />
          </FieldRow>
          <FieldRow label="TTS 發音">
            <input
              type="checkbox"
              aria-label="TTS 發音"
              defaultChecked={settings.ttsEnabled}
              onChange={(e) => void setSetting("ttsEnabled", e.target.checked)}
              className="h-4 w-4 accent-sky-600"
            />
          </FieldRow>
          <FieldRow label="Furigana 預設">
            <select
              aria-label="Furigana 預設"
              defaultValue={settings.furigana}
              onChange={(e) => void setSetting("furigana", e.target.value as Settings["furigana"])}
              className="rounded border border-neutral-300 px-2 py-1"
            >
              <option value="show">顯示</option>
              <option value="hide">隱藏</option>
            </select>
          </FieldRow>
        </div>
      </SectionCard>

      <SectionCard title="資料管理">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-700">匯出全部學習資料為 JSON 檔。</p>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="shrink-0 rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              匯出備份
            </button>
          </div>

          <div className="border-t border-neutral-100 pt-3">
            <label className="flex items-center justify-between gap-3 text-sm text-neutral-700">
              從備份檔還原(覆蓋現有資料)。
              <input
                type="file"
                accept="application/json,.json"
                aria-label="選擇備份檔"
                onChange={(e) => void handleFileChange(e)}
                className="max-w-48 text-xs"
              />
            </label>
            {pendingImport && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>
                  備份內容:{pendingImport.cards.length} 張卡片・{pendingImport.logs.length}{" "}
                  筆複習紀錄・匯出於 {pendingImport.exportedAt.slice(0, 10)}。 匯入將
                  <strong>清除並覆蓋</strong>目前全部資料。
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    className="rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmImport()}
                    className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
                  >
                    確認覆蓋
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-neutral-100 pt-3">
            {confirmingReset ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p>將刪除全部卡片、複習紀錄與進度,此動作無法復原。確定要重置嗎?</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                    className="rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmReset()}
                    className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
                  >
                    確定重置
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-700">清除所有進度,回到初始狀態。</p>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                  className="shrink-0 rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  重置所有進度
                </button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
