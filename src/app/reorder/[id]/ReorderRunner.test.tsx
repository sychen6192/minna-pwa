import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting } from "@/lib/db";
import { LessonSchema, type Lesson, type Sentence } from "@/schemas/lesson";
import { ReorderRunner } from "./ReorderRunner";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const getLesson = vi.fn();
vi.mock("@/lib/content", () => ({ getLesson: (id: number) => getLesson(id) }));

// 只替換 speak;speechText 等用真實實作
const speak = vi.fn();
vi.mock("@/lib/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts")>()),
  speak: (text: string) => speak(text),
}));

/** 教材實際資料(public/data)中的句子 */
function realSentence(id: string): Sentence {
  const file = join(
    process.cwd(),
    "public",
    "data",
    "lessons",
    `${id.slice(0, 3)}.json`,
  );
  const lesson = LessonSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
  const all = [
    ...lesson.grammar.flatMap((g) => g.examples),
    ...lesson.dialogues,
  ];
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
}

// L36-S06:太りましたから、|好きな|服が|着られなく|なりました。(5 塊,全部打亂)
const S06 = realSentence("L36-S06");
// L14-S15:すみませんが、|この|漢字の|読み方を|教えて|ください。(6 塊,首尾固定)
const S15 = realSentence("L14-S15");

function lessonWith(id: number, examples: Sentence[]): Lesson {
  return {
    id,
    title: `第${id}課`,
    vocab: [
      {
        id: `L${id}-V001`,
        ruby: [{ b: "服", r: "ふく" }],
        kana: "ふく",
        meaning: "衣服",
        pos: "名",
      },
    ],
    grammar: [{ id: `L${id}-G01`, pattern: "〜ように なります", examples }],
    dialogues: [],
  };
}

beforeEach(async () => {
  speak.mockClear();
  getLesson.mockResolvedValue(lessonWith(36, [S06, S15]));
  await db.settings.clear();
  // 按鈕名稱只含表面文字(不含 furigana 的讀音),便於以名稱找詞塊
  await setSetting("furigana", "hide");
  // 出題順序固定:Fisher–Yates 的 j 恆等於 i(洗牌 = 原順序);題目的打亂洗出原順序時改為左移一位
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  // 時鐘停住:換題/作答/移回後的點擊防護(300ms)由 passTapGuard 明確撥過
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 把時鐘撥過點擊防護(換題、作答、移回、進結果頁後 300ms) */
function passTapGuard() {
  vi.setSystemTime(Date.now() + 1_000);
}

/**
 * 含 ruby 的按鈕名稱:jsdom 把 <ruby> 當成非行內元素,名稱會在漢字段前後多出空白,
 * 比對時忽略字與字之間的空白
 */
function ruby(text: string): RegExp {
  const escaped = [...text].map((c) =>
    c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`^${escaped.join("\\s*")}$`);
}

const answerRow = () => screen.getByRole("list", { name: "你的答案" });
const pool = () => screen.getByRole("list", { name: "待選詞塊" });
const poolChip = (text: string) =>
  within(pool()).getByRole("button", { name: ruby(text) });
const answerChip = (text: string) =>
  within(answerRow()).getByRole("button", { name: ruby(text) });

async function place(
  user: ReturnType<typeof userEvent.setup>,
  texts: string[],
) {
  for (const t of texts) await user.click(poolChip(t));
}

const S06_ORDER = [
  "太りましたから、",
  "好きな",
  "服が",
  "着られなく",
  "なりました。",
];

describe("ReorderRunner 題目", () => {
  it("題幹為中譯;詞塊打亂後放在待選區,答案列有同數量的空格", async () => {
    render(<ReorderRunner id={36} />);
    expect(
      await screen.findByText("長胖了、喜歡的衣服都穿不下了。"),
    ).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 題")).toBeInTheDocument();
    // 打亂:左移一位(洗牌洗出原順序時)
    const names = within(pool())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      "好きな",
      "服が",
      "着られなく",
      "なりました。",
      "太りましたから、",
    ]);
    // 詞塊為日文(RubyText 標 lang="ja")
    for (const b of within(pool()).getAllByRole("button")) {
      expect(b.firstElementChild).toHaveAttribute("lang", "ja");
    }
    expect(within(answerRow()).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "確認" })).toBeDisabled();
    // 第一題在頁面載入時出現:不搶焦點
    expect(document.body).toHaveFocus();
  });

  it("點詞塊依序排入答案列,點答案列中的詞塊移回待選區", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");

    await place(user, ["太りましたから、", "好きな", "服が"]);
    expect(
      within(answerRow())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["太りましたから、", "好きな", "服が"]);
    // 排入的塊不再是待選區的按鈕(留下佔位)
    expect(within(pool()).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "確認" })).toBeDisabled();

    // 移回中間的一塊
    await user.click(answerChip("好きな"));
    expect(
      within(answerRow())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["太りましたから、", "服が"]);
    expect(poolChip("好きな")).toBeInTheDocument();
    // 焦點移到原位置的下一塊(不掉到 body)
    expect(answerChip("服が")).toHaveFocus();
  });

  it("排完才能確認;依教材順序排入 → 答對,焦點移到「下一題」", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");

    await place(user, S06_ORDER);
    const check = screen.getByRole("button", { name: "確認" });
    expect(check).toBeEnabled();
    // 最後一塊排入後焦點移到「確認」
    expect(check).toHaveFocus();
    await user.click(check);

    const status = screen.getByRole("status");
    expect(within(status).getByText("答對 ✓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一題" })).toHaveFocus();
    // 答對時也可朗讀
    await user.click(
      within(status).getByRole("button", { name: /播放例句發音/ }),
    );
    expect(speak).toHaveBeenCalledWith(
      "太りましたから、好きな 服が 着られなく なりました。",
    );
    expect(
      screen.queryByRole("list", { name: "待選詞塊" }),
    ).not.toBeInTheDocument();
  });

  it("答錯:標出位置不對的格,顯示教材原句、朗讀與「語序以教材為準」", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");

    // 好きな 與 服が 對調
    await place(user, [
      "太りましたから、",
      "服が",
      "好きな",
      "着られなく",
      "なりました。",
    ]);
    await user.click(screen.getByRole("button", { name: "確認" }));

    const status = screen.getByRole("status");
    expect(within(status).getByText("答錯 ✗")).toBeInTheDocument();
    expect(within(status).getByText("第 2、3 格位置不對")).toBeInTheDocument();
    expect(within(status).getByText("教材原句")).toBeInTheDocument();
    expect(within(status).getByText(/語序以教材為準/)).toBeInTheDocument();
    // 答案列:錯的格附文字說明(不只靠顏色)
    const row = answerRow();
    expect(within(row).getAllByText("(位置不對)")).toHaveLength(2);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "下一題" })).toHaveFocus();

    await user.click(
      within(status).getByRole("button", { name: /播放例句發音/ }),
    );
    expect(speak).toHaveBeenCalledWith(
      "太りましたから、好きな 服が 着られなく なりました。",
    );
  });

  it("略過:不必排完,顯示教材原句後進下一題", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");

    await place(user, ["好きな"]);
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "略過" }));
    const status = screen.getByRole("status");
    expect(within(status).getByText("已略過")).toBeInTheDocument();
    expect(within(status).getByText("教材原句")).toBeInTheDocument();
    expect(within(status).queryByText(/格位置不對/)).not.toBeInTheDocument();
    // 不留排到一半的答案列
    expect(
      screen.queryByRole("list", { name: "你的答案" }),
    ).not.toBeInTheDocument();

    passTapGuard();
    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(
      await screen.findByText("對不起,請你告訴我這個漢字的念法。"),
    ).toBeInTheDocument();
    // 換題後焦點移到題幹
    expect(screen.getByText("依中譯排出日文句子").parentElement).toHaveFocus();
  });

  it("6 塊以上:首尾兩塊固定在答案列兩端(不可點),只排中間", async () => {
    getLesson.mockResolvedValue(lessonWith(14, [S15]));
    const user = userEvent.setup();
    render(<ReorderRunner id={14} />);
    await screen.findByText("對不起,請你告訴我這個漢字的念法。");
    expect(screen.getByText(/首尾兩塊已固定/)).toBeInTheDocument();

    const row = answerRow();
    expect(within(row).getAllByText("(固定)")).toHaveLength(2);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(
      within(pool())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["漢字の", "読み方を", "教えて", "この"]);

    await place(user, ["この", "漢字の", "読み方を", "教えて"]);
    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(
      within(screen.getByRole("status")).getByText("答對 ✓"),
    ).toBeInTheDocument();
    // 只有一題:看結果
    expect(screen.getByRole("button", { name: "看結果" })).toBeInTheDocument();
  });

  it("鍵盤操作:排入後焦點移到下一個待選詞塊,排完移到「確認」", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");

    poolChip("着られなく").focus();
    await user.keyboard("{Enter}");
    expect(poolChip("なりました。")).toHaveFocus();
    // 待選區最後一塊:往前找
    poolChip("太りましたから、").focus();
    await user.keyboard(" ");
    expect(poolChip("なりました。")).toHaveFocus();
    // 答案列:移回最後一塊 → 焦點到前一塊
    answerChip("太りましたから、").focus();
    await user.keyboard("{Enter}");
    expect(answerChip("着られなく")).toHaveFocus();
    // 移回唯一的一塊 → 焦點到待選區中的這一塊
    passTapGuard();
    await user.keyboard("{Enter}");
    expect(poolChip("着られなく")).toHaveFocus();

    for (const t of S06_ORDER) {
      poolChip(t).focus();
      await user.keyboard("{Enter}");
    }
    expect(screen.getByRole("button", { name: "確認" })).toHaveFocus();
  });

  it("furigana 依全域設定;TTS 關閉時不渲染發音鈕", async () => {
    await setSetting("furigana", "show");
    await setSetting("ttsEnabled", false);
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");
    expect(within(pool()).getByText("ふと").tagName).toBe("RT");

    passTapGuard();
    await user.click(screen.getByRole("button", { name: "略過" }));
    expect(
      within(screen.getByRole("status")).getByText("教材原句"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /播放/ }),
    ).not.toBeInTheDocument();
  });
});

describe("ReorderRunner 雙擊防護(換題、作答、移回、進結果頁後 300ms 內的點擊忽略)", () => {
  it("確認後立刻再點(落在「下一題」上)不換題,回饋留在畫面上", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");
    await place(user, S06_ORDER);

    fireEvent.click(screen.getByRole("button", { name: "確認" }));
    fireEvent.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 1 / 2 題")).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).getByText("答對 ✓"),
    ).toBeInTheDocument();

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "下一題" }));
    expect(await screen.findByText("第 2 / 2 題")).toBeInTheDocument();
  });

  it("略過後立刻再點不換題;換題後立刻點「略過」不作用(雙擊「下一題」)", async () => {
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");
    passTapGuard();

    fireEvent.click(screen.getByRole("button", { name: "略過" }));
    fireEvent.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 1 / 2 題")).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).getByText("已略過"),
    ).toBeInTheDocument();

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "下一題" }));
    expect(await screen.findByText("第 2 / 2 題")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "略過" }));
    expect(
      within(screen.getByRole("status")).queryByText("已略過"),
    ).not.toBeInTheDocument();

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "略過" }));
    expect(
      within(screen.getByRole("status")).getByText("已略過"),
    ).toBeInTheDocument();
  });

  it("答案列:移回後立刻再點(滑到同一格的下一塊)不會連續移回", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");
    await place(user, ["太りましたから、", "好きな", "服が"]);
    const answerTexts = () =>
      within(answerRow())
        .getAllByRole("button")
        .map((b) => b.textContent);

    fireEvent.click(answerChip("太りましたから、"));
    fireEvent.click(answerChip("好きな"));
    expect(answerTexts()).toEqual(["好きな", "服が"]);

    passTapGuard();
    fireEvent.click(answerChip("好きな"));
    expect(answerTexts()).toEqual(["服が"]);
  });

  it("進結果頁後立刻再點不觸發「再練一次」與「下一課」", async () => {
    getLesson.mockResolvedValue(lessonWith(36, [S06]));
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");
    await place(user, S06_ORDER);
    await user.click(screen.getByRole("button", { name: "確認" }));
    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "看結果" }));
    await screen.findByRole("heading", { name: "練習完成" });

    fireEvent.click(screen.getByRole("button", { name: "再練一次" }));
    const next = screen.getByRole("link", { name: "下一課 →" });
    // fireEvent 回傳 false = 預設動作(連結導覽)被擋下
    expect(fireEvent.click(next)).toBe(false);
    expect(
      screen.getByRole("heading", { name: "練習完成" }),
    ).toBeInTheDocument();

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "再練一次" }));
    expect(
      await screen.findByText("長胖了、喜歡的衣服都穿不下了。"),
    ).toBeInTheDocument();
  });
});

describe("ReorderRunner 結果", () => {
  it("分數、答錯與略過的句子(教材原句與中譯)、再練一次、下一課", async () => {
    const user = userEvent.setup();
    render(<ReorderRunner id={36} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");

    // 第 1 題答錯、第 2 題略過
    await place(user, [
      "好きな",
      "太りましたから、",
      "服が",
      "着られなく",
      "なりました。",
    ]);
    await user.click(screen.getByRole("button", { name: "確認" }));
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "下一題" }));
    await screen.findByText("對不起,請你告訴我這個漢字的念法。");
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "略過" }));
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "看結果" }));

    const heading = await screen.findByRole("heading", { name: "練習完成" });
    expect(heading).toHaveFocus();
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "答錯與略過(2)" }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(
      within(items[0]).getByText("長胖了、喜歡的衣服都穿不下了。"),
    ).toBeInTheDocument();
    expect(within(items[0]).getByText("答錯")).toBeInTheDocument();
    expect(items[0].querySelector('[lang="ja"]')?.textContent).toBe(
      "太りましたから、好きな 服が 着られなく なりました。",
    );
    expect(within(items[1]).getByText("略過")).toBeInTheDocument();
    passTapGuard();
    await user.click(
      within(items[1]).getByRole("button", { name: /播放例句發音/ }),
    );
    expect(speak).toHaveBeenCalledWith(
      "すみませんが、この 漢字の 読み方を 教えて ください。",
    );

    expect(screen.getByRole("link", { name: "下一課 →" })).toHaveAttribute(
      "href",
      "/reorder/37",
    );
    expect(screen.getByRole("link", { name: "回課程" })).toHaveAttribute(
      "href",
      "/lessons/36",
    );

    // 再練一次:同一課重新出題,焦點移到題幹
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "再練一次" }));
    expect(
      await screen.findByText("長胖了、喜歡的衣服都穿不下了。"),
    ).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 題")).toBeInTheDocument();
    expect(screen.getByText("依中譯排出日文句子").parentElement).toHaveFocus();
  });

  it("全部答對;第 50 課沒有「下一課」", async () => {
    getLesson.mockResolvedValue(lessonWith(50, [S06]));
    const user = userEvent.setup();
    render(<ReorderRunner id={50} />);
    await screen.findByText("長胖了、喜歡的衣服都穿不下了。");
    await place(user, S06_ORDER);
    await user.click(screen.getByRole("button", { name: "確認" }));
    passTapGuard();
    await user.click(screen.getByRole("button", { name: "看結果" }));

    expect(await screen.findByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("全部答對 🎉")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /下一課/ }),
    ).not.toBeInTheDocument();
  });

  it("本課沒有可重組的句子:直接顯示說明", async () => {
    getLesson.mockResolvedValue(lessonWith(1, [realSentence("L14-D04")]));
    render(<ReorderRunner id={1} />);
    expect(
      await screen.findByText("本課沒有可重組的例句。"),
    ).toBeInTheDocument();
  });

  it("載入失敗:顯示錯誤訊息", async () => {
    getLesson.mockRejectedValue(new Error("斷線"));
    render(<ReorderRunner id={36} />);
    await waitFor(() =>
      expect(screen.getByText(/載入課程失敗.*斷線/)).toBeInTheDocument(),
    );
  });
});
