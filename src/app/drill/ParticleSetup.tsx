"use client";

import { useId } from "react";
import { PARTICLES, type ParticleItem } from "@/lib/particles";
import { CollocationCaveat } from "./ParticleQuestionView";

/** 設定畫面的助詞搭配說明(T11.7):範圍內的搭配數、題型範例與「教材搭配」的說明 */
export function ParticleSetup({
  particles,
}: {
  /** 範圍內的出題池;載入中為 null */
  particles: ParticleItem[] | null;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="px-4 pt-5">
      <h2
        id={headingId}
        className="flex items-baseline gap-2 text-sm font-medium"
      >
        助詞搭配{" "}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {particles === null ? "…" : `${particles.length} 個`}
        </span>
      </h2>
      <div className="mt-2 rounded-xl border border-border bg-card p-4 text-sm">
        <p>題目取自單字表中教材標註的搭配,例:</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
          <dt className="text-xs text-muted-foreground">單字表</dt>
          <dd lang="ja" className="text-base">
            ［たばこを〜］吸います
          </dd>
          <dt className="text-xs text-muted-foreground">題目</dt>
          <dd lang="ja" className="text-base">
            たばこ（　）吸います
          </dd>
        </dl>
        <p className="mt-2 text-muted-foreground">
          每題從 <span lang="ja">{PARTICLES.join("・")}</span> 中出 4 個選項。
        </p>
      </div>
      <CollocationCaveat className="mt-2" />
    </section>
  );
}
