"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { exportData, importData, parseBackup, resetAll, type BackupFile } from "@/lib/backup";
import { getAllSettings, setSetting, type Settings } from "@/lib/db";
import { ensureReverseCards } from "@/lib/srs";

type Notice = { kind: "success" | "error"; text: string } | null;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

// 輸入框/下拉選單字級 16px(text-base):小於 16px 時 iOS Safari 在 focus 時會放大頁面且不縮回
const NUMBER_INPUT = "h-9 w-20 rounded border border-input bg-transparent px-2 text-right text-base";
const SELECT = "h-9 rounded border border-input bg-transparent px-2 text-base";

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // 整列為 label:點列上任何位置即操作欄位(checkbox 本身只有 16px),列高 ≥ 44px
    <label className="flex min-h-11 items-center justify-between gap-3 py-1.5 text-sm">
      {label}
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  // 匯入後 bump,讓表單以新值重掛(欄位為 uncontrolled + defaultValue;重置不動設定)
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

  function updateNumber(
    key: "newPerDay" | "maxReviewsPerDay" | "dailyGoal",
    rawValue: string,
  ) {
    const value = Number(rawValue);
    if (rawValue === "" || !Number.isInteger(value) || value < 0) return;
    void setSetting(key, value);
  }

  // 開啟回想方向卡:立即為已加入的字補上回想卡(關閉不刪除既有卡)
  async function handleReverseToggle(checked: boolean) {
    await setSetting("reverseCards", checked);
    if (checked) {
      const added = await ensureReverseCards();
      setNotice({
        kind: "success",
        text:
          added > 0
            ? `已為 ${added} 個既有單字補上回想方向卡。`
            : "已開啟;之後新增的單字會一併建立回想方向卡。",
      });
    } else {
      setNotice({ kind: "success", text: "已關閉;既有的回想卡不會刪除,仍會出現在複習中。" });
    }
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
    setNotice({ kind: "success", text: "已重置所有進度;設定維持不變。" });
  }

  if (!settings) {
    return <Loading className="p-6" />;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">設定</h1>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 text-sm ${
            notice.kind === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {notice.text}
        </p>
      )}

      <SectionCard title="學習設定">
        <div key={formEpoch} className="flex flex-col divide-y divide-border">
          <FieldRow label="每日新卡上限">
            <input
              type="number"
              min={0}
              aria-label="每日新卡上限"
              defaultValue={settings.newPerDay}
              onChange={(e) => updateNumber("newPerDay", e.target.value)}
              className={NUMBER_INPUT}
            />
          </FieldRow>
          <FieldRow label="每日複習上限">
            <input
              type="number"
              min={0}
              aria-label="每日複習上限"
              defaultValue={settings.maxReviewsPerDay}
              onChange={(e) => updateNumber("maxReviewsPerDay", e.target.value)}
              className={NUMBER_INPUT}
            />
          </FieldRow>
          <FieldRow label="每日目標張數">
            <input
              type="number"
              min={0}
              aria-label="每日目標張數"
              defaultValue={settings.dailyGoal}
              onChange={(e) => updateNumber("dailyGoal", e.target.value)}
              className={NUMBER_INPUT}
            />
          </FieldRow>
          <FieldRow label="TTS 發音">
            <input
              type="checkbox"
              aria-label="TTS 發音"
              defaultChecked={settings.ttsEnabled}
              onChange={(e) => void setSetting("ttsEnabled", e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </FieldRow>
          <FieldRow label="回想方向卡(中→日)">
            <input
              type="checkbox"
              aria-label="回想方向卡"
              defaultChecked={settings.reverseCards}
              onChange={(e) => void handleReverseToggle(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </FieldRow>
          <FieldRow label="目標保留率(FSRS)">
            <select
              aria-label="目標保留率"
              defaultValue={String(settings.desiredRetention)}
              onChange={(e) => void setSetting("desiredRetention", Number(e.target.value))}
              className={SELECT}
            >
              <option value="0.8">80%(複習較少)</option>
              <option value="0.85">85%</option>
              <option value="0.9">90%(建議)</option>
              <option value="0.95">95%</option>
              <option value="0.97">97%(複習最多)</option>
            </select>
          </FieldRow>
          <FieldRow label="Furigana 預設">
            <select
              aria-label="Furigana 預設"
              defaultValue={settings.furigana}
              onChange={(e) => void setSetting("furigana", e.target.value as Settings["furigana"])}
              className={SELECT}
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
            <p className="text-sm">匯出全部學習資料為 JSON 檔。</p>
            <Button size="sm" onClick={() => void handleExport()}>
              匯出備份
            </Button>
          </div>

          <div className="border-t border-border pt-3">
            <label className="flex items-center justify-between gap-3 text-sm">
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
              <div className="mt-3 rounded-lg border border-warning-accent/40 bg-warning-accent/10 p-3 text-sm text-warning">
                <p>
                  備份內容:{pendingImport.cards.length} 張卡片・{pendingImport.logs.length}{" "}
                  筆複習紀錄・匯出於 {pendingImport.exportedAt.slice(0, 10)}。 匯入將
                  <strong>清除並覆蓋</strong>目前全部資料。
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingImport(null)}
                    className="font-normal text-foreground"
                  >
                    取消
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void handleConfirmImport()}>
                    確認覆蓋
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border pt-3">
            {confirmingReset ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p>
                  將刪除全部卡片、複習紀錄與進度(設定會保留),此動作無法復原。確定要重置嗎?
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingReset(false)}
                    className="font-normal text-foreground"
                  >
                    取消
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void handleConfirmReset()}>
                    確定重置
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  清除所有卡片與複習紀錄
                  <span className="block text-xs text-muted-foreground">設定會保留</span>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingReset(true)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 active:bg-destructive/10"
                >
                  重置所有進度
                </Button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
