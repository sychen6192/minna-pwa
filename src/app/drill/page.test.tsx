import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting, type CardRow } from "@/lib/db";
import type { Lesson } from "@/schemas/lesson";
import { clearDrillState } from "./drillState";
import DrillPage from "./page";

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

const L14: Lesson = {
  id: 14,
  title: "第14課",
  vocab: [
    {
      id: "L14-V001",
      ruby: [{ b: "書", r: "か" }, { b: "きます" }],
      kana: "かきます",
      meaning: "寫",
      pos: "動I",
    },
    {
      id: "L14-V002",
      ruby: [{ b: "駅", r: "えき" }],
      kana: "えき",
      meaning: "車站",
      pos: "名",
    },
  ],
  grammar: [],
  dialogues: [],
};

const L20: Lesson = {
  id: 20,
  title: "第20課",
  vocab: [
    {
      id: "L20-V001",
      ruby: [{ b: "静", r: "しず" }, { b: "か［な］" }],
      kana: "しずか［な］",
      meaning: "安靜",
      pos: "な形",
    },
  ],
  grammar: [],
  dialogues: [],
};

/** 其他課:只有名詞(不出題) */
function filler(id: number): Lesson {
  const lid = `L${String(id).padStart(2, "0")}`;
  return {
    id,
    title: `第${id}課`,
    vocab: [
      {
        id: `${lid}-V001`,
        ruby: [{ b: "本", r: "ほん" }],
        kana: "ほん",
        meaning: "書",
        pos: "名",
      },
    ],
    grammar: [],
    dialogues: [],
  };
}

const defaultLessons = (id: number) =>
  Promise.resolve(id === 14 ? L14 : id === 20 ? L20 : filler(id));
const getLesson = vi.fn(defaultLessons);
vi.mock("@/lib/content", () => ({ getLesson: (id: number) => getLesson(id) }));

// 只替換 speak;speechText 等用真實實作
const speak = vi.fn();
vi.mock("@/lib/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts")>()),
  speak: (text: string) => speak(text),
}));

function card(cardId: string, lessonId: number): CardRow {
  return {
    cardId,
    lessonId,
    type: "vocab",
    due: Date.now(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 0,
  };
}

beforeEach(async () => {
  clearDrillState();
  speak.mockClear();
  getLesson.mockImplementation(defaultLessons);
  await Promise.all([
    db.cards.clear(),
    db.logs.clear(),
    db.progress.clear(),
    db.settings.clear(),
  ]);
  // 按鈕名稱只含表面文字(不含 furigana 的讀音),便於以名稱找選項
  await setSetting("furigana", "hide");
  window.history.replaceState(null, "", "/drill");
  // 出題順序固定(Fisher–Yates 與形的平手選擇皆取第一個)
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rangeSelect = () => screen.findByRole("combobox", { name: "範圍" });

/**
 * 含 ruby 的按鈕名稱:jsdom 把 <ruby> 當成非行內元素,名稱會在漢字段前後多出空白(「書 いて」),
 * 比對時忽略字與字之間的空白
 */
function ruby(text: string): RegExp {
  return new RegExp(`^${[...text].join("\\s*")}$`);
}

/** 設定畫面:只留某組中名稱在 keep 內的形(其餘按下的 chip 點掉) */
async function onlyForms(
  user: ReturnType<typeof userEvent.setup>,
  group: RegExp,
  keep: string[],
) {
  const chips = within(screen.getByRole("group", { name: group })).getAllByRole(
    "button",
  );
  for (const chip of chips) {
    if (
      chip.getAttribute("aria-pressed") === "true" &&
      !keep.includes(chip.textContent ?? "")
    ) {
      await user.click(chip);
    }
  }
}

/** 等出題池載入(開始鈕可按)後開始 */
async function start(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole("button", { name: /開始練習/ });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("DrillPage 設定:範圍", () => {
  it("預設為卡片中最大的課號(讀 db.cards)", async () => {
    await db.cards.bulkAdd([
      card("L05-V001", 5),
      card("L22-V003", 22),
      card("L22-V003@r", 22),
    ]);
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("22");
    expect(
      screen.getByRole("heading", { name: "活用練習" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("預設為已加入複習的最後一課。"),
    ).toBeInTheDocument();
  });

  it("沒有卡片:預設第 1–14 課並說明", async () => {
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    expect(
      screen.getByText(/還沒有加入複習的單字,先以第 1–14 課為範圍/),
    ).toBeInTheDocument();
  });

  it("?upto= 優先於卡片(課程頁的連結);可以 −/+ 與選單調整,調整後不再顯示預設說明", async () => {
    await db.cards.add(card("L30-V001", 30));
    window.history.replaceState(null, "", "/drill?upto=17");
    const user = userEvent.setup();
    render(<DrillPage />);
    const select = await rangeSelect();
    expect(select).toHaveValue("17");
    expect(screen.queryByText(/預設為/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "範圍增加一課" }));
    expect(select).toHaveValue("18");
    // 範圍寫回網址(返回本頁、重新整理時一致)
    expect(window.location.search).toBe("?upto=18");
    await user.selectOptions(select, "第 1–3 課");
    expect(select).toHaveValue("3");
    // 第 1–3 課:沒有任何活用形,不能開始
    expect(
      await screen.findByText("第 4 課起才有可練習的活用形。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /開始練習/ })).toBeDisabled();
  });

  it("只開放範圍內已導入的形;未導入的形 disabled 並標示「第 N 課學」", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    render(<DrillPage />);
    await rangeSelect();
    const verbs = screen.getByRole("group", { name: /^動詞/ });
    const te = within(verbs).getByRole("button", { name: "て形" });
    expect(te).toBeEnabled();
    expect(te).toHaveAttribute("aria-pressed", "true");
    const nai = within(verbs).getByRole("button", { name: /ない形/ });
    expect(nai).toBeDisabled();
    expect(nai).toHaveAttribute("aria-pressed", "false");
    expect(nai).toHaveTextContent("第 17 課學");
    expect(
      within(verbs).getByRole("button", { name: /辞書形/ }),
    ).toHaveTextContent("第 18 課學");
    // 範圍內沒有形容詞(第 1–14 課的教材只有 書きます):形容詞的形不可選
    const adjs = screen.getByRole("group", { name: /^形容詞/ });
    await waitFor(() => expect(adjs).toHaveAccessibleName("形容詞 0 個"));
    for (const chip of within(adjs).getAllByRole("button"))
      expect(chip).toBeDisabled();
  });

  it("取消全部的形:不能開始並提示", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, []);
    expect(await screen.findByText("請至少選一種形。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /開始練習/ })).toBeDisabled();
  });
});

describe("DrillPage 作答", () => {
  it("選擇題答對:回饋、正解、朗讀、文法連結;結果頁", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);

    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
    expect(screen.getByText("寫")).toBeInTheDocument();
    const options = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(options.sort()).toEqual(
      ["書いて", "書きて", "書って", "書んで"].sort(),
    );

    await user.click(screen.getByRole("button", { name: ruby("書いて") }));
    const status = screen.getByRole("status");
    expect(within(status).getByText("答對 ✓")).toBeInTheDocument();
    expect(
      within(status).getByRole("link", { name: "看文法:第 14 課" }),
    ).toHaveAttribute("href", "/lessons/14#L14-G03");
    // 作答後焦點移到下一步
    expect(screen.getByRole("button", { name: "看結果" })).toHaveFocus();
    await user.click(
      within(status).getByRole("button", { name: "播放 かいて 的發音" }),
    );
    expect(speak).toHaveBeenCalledWith("かいて");

    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(screen.getByRole("heading", { name: "練習完成" })).toHaveFocus();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("全部答對 🎉")).toBeInTheDocument();
  });

  it("選擇題答錯:標出正解與所選,回饋列正解;結果頁列錯題、再練一次與換範圍", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);

    await user.click(screen.getByRole("button", { name: ruby("書きて") }));
    expect(screen.getByText("答錯 ✗")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ruby("書きて") })).toHaveClass(
      "border-destructive",
    );
    expect(screen.getByRole("button", { name: ruby("書いて") })).toHaveClass(
      "border-success",
    );
    expect(screen.getByRole("status")).toHaveTextContent("答錯 ✗書いて");

    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "錯題(1)" }),
    ).toBeInTheDocument();
    const row = screen.getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("書きます→的正解是書いて");
    expect(row).toHaveTextContent("て形");
    expect(row).toHaveTextContent("你的答案:書きて");
    expect(
      within(row).getByRole("link", { name: "看文法:第 14 課" }),
    ).toHaveAttribute("href", "/lessons/14#L14-G03");

    await user.click(screen.getByRole("button", { name: "再練一次" }));
    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
    expect(screen.queryByText("答錯 ✗")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ruby("書いて") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    await user.click(screen.getByRole("button", { name: "換範圍" }));
    // 按鈕已卸載:焦點移到設定畫面的標題(不掉到 body)
    expect(screen.getByRole("heading", { name: "活用練習" })).toHaveFocus();
    // 設定保留(只勾了て形)
    const verbs = screen.getByRole("group", { name: /^動詞/ });
    expect(
      within(verbs).getByRole("button", { name: "否定(丁寧)" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("輸入題:羅馬字作答", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["否定(丁寧)", "て形"]);
    await start(user);

    // 第 1 題選擇題(否定(丁寧)),第 2 題輸入題(て形)
    expect(screen.getByText("否定(丁寧)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ruby("書きません") }));
    await user.click(screen.getByRole("button", { name: "下一題" }));

    expect(screen.getByText("第 2 / 2 題")).toBeInTheDocument();
    // 換題後焦點移到題幹(螢幕閱讀器先念題目)
    expect(document.activeElement).toHaveTextContent("書きます寫→改成て形");
    const input = screen.getByRole("textbox", { name: "輸入て形的假名" });
    await user.type(input, "kaite");
    await user.click(screen.getByRole("button", { name: "作答" }));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();
    expect(input).toBeDisabled();
  });

  it("輸入題答錯:列出正解與你的答案", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["否定(丁寧)", "て形"]);
    await start(user);
    await user.click(screen.getByRole("button", { name: ruby("書きません") }));
    await user.click(screen.getByRole("button", { name: "下一題" }));

    await user.type(screen.getByRole("textbox"), "かきて{Enter}");
    expect(screen.getByText("答錯 ✗")).toBeInTheDocument();
    expect(screen.getByText("你的答案:")).toHaveTextContent("你的答案:かきて");
  });

  it("な形容詞否定:輸入「では」亦判為對,並說明「じゃ/では」皆可", async () => {
    window.history.replaceState(null, "", "/drill?upto=20");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, []);
    await onlyForms(user, /^形容詞/, ["て形", "否定(普通)"]);
    await start(user);

    // 第 1 題:静か → て形(選擇題;「静かで」只是基底 + 一個假名,不出輸入題)
    await user.click(screen.getByRole("button", { name: ruby("静かで") }));
    await user.click(screen.getByRole("button", { name: "下一題" }));

    // 第 2 題:静か → 否定(普通)(輸入題)
    await user.type(screen.getByRole("textbox"), "shizuka dewa nai");
    await user.click(screen.getByRole("button", { name: "作答" }));
    const status = screen.getByRole("status");
    expect(within(status).getByText("答對 ✓")).toBeInTheDocument();
    expect(status).toHaveTextContent("「じゃ」也可以說「では」");
    // 普通形:另附規則所在的文法點(第 8 課)
    expect(
      within(status).getByRole("link", { name: "看文法:第 20 課" }),
    ).toHaveAttribute("href", "/lessons/20#L20-G01");
    expect(
      within(status).getByRole("link", { name: "活用規則:第 8 課" }),
    ).toHaveAttribute("href", "/lessons/8#L08-G02");
  });

  it("普通形答錯:結果頁的錯題也附「活用規則」連結", async () => {
    window.history.replaceState(null, "", "/drill?upto=20");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, []);
    await onlyForms(user, /^形容詞/, ["否定(普通)"]);
    await start(user);

    await user.click(screen.getByRole("button", { name: ruby("静かくない") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    const row = screen.getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("你的答案:静かくない");
    expect(
      within(row).getByRole("link", { name: "看文法:第 20 課" }),
    ).toHaveAttribute("href", "/lessons/20#L20-G01");
    expect(
      within(row).getByRole("link", { name: "活用規則:第 8 課" }),
    ).toHaveAttribute("href", "/lessons/8#L08-G02");
  });

  it("来る:選項只差讀音,furigana 設定為隱藏時選項、正解與錯題的作答仍顯示讀音", async () => {
    const L05: Lesson = {
      ...filler(5),
      vocab: [
        {
          id: "L05-V002",
          ruby: [{ b: "来", r: "き" }, { b: "ます" }],
          kana: "きます",
          meaning: "來",
          pos: "動III",
        },
      ],
    };
    getLesson.mockImplementation((id: number) =>
      Promise.resolve(id === 5 ? L05 : filler(id)),
    );
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);

    // 題幹照設定(不顯示讀音);選項一律帶讀音、彼此可區分
    expect(screen.getByText("來").previousElementSibling).toHaveTextContent(
      /^来ます$/,
    );
    const options = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(options.sort()).toEqual(
      ["来きって", "来きて", "来くて", "来こて"].sort(),
    );
    const kote = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "来こて");
    if (!kote) throw new Error("找不到 来(こ)て");
    await user.click(kote);
    expect(screen.getByRole("status")).toHaveTextContent("答錯 ✗来きて");

    await user.click(screen.getByRole("button", { name: "看結果" }));
    const row = screen.getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("的正解是来きて");
    expect(row).toHaveTextContent("你的答案:来こて");
  });

  it("題目照全域 furigana 設定顯示讀音", async () => {
    await setSetting("furigana", "show");
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);
    expect(document.querySelector("rt")).toHaveTextContent("か");
  });
});

describe("DrillPage 狀態", () => {
  it("不寫入 SRS/DB:練完一回合後卡片、紀錄、進度皆不變", async () => {
    await db.cards.add(card("L14-V001", 14));
    const cards = await db.cards.toArray();
    const user = userEvent.setup();
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);
    await user.click(screen.getByRole("button", { name: ruby("書きて") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(
      screen.getByRole("heading", { name: "練習完成" }),
    ).toBeInTheDocument();

    expect(await db.cards.toArray()).toEqual(cards);
    expect(await db.logs.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
  });

  it("從「看文法」連結返回(重新掛載):接續同一題與作答結果", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    const { unmount } = render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["否定(丁寧)", "て形"]);
    await start(user);
    await user.click(screen.getByRole("button", { name: ruby("書きました") }));
    expect(screen.getByText("答錯 ✗")).toBeInTheDocument();

    unmount(); // 點「看文法」離開本頁
    render(<DrillPage />); // 瀏覽器返回(網址仍為 ?upto=14)
    expect(await screen.findByText("第 1 / 2 題")).toBeInTheDocument();
    expect(screen.getByText("答錯 ✗")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一題" })).toHaveFocus();
  });

  it("調整過範圍後離開再返回:網址已是新範圍,仍接續", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    await user.click(screen.getByRole("button", { name: "範圍增加一課" }));
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);
    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
    unmount();

    render(<DrillPage />);
    expect(await screen.findByText("第 1 / 1 題")).toBeInTheDocument();
  });

  it("沒有進行中的回合:重新進入時重新推算預設範圍(加入卡片後不再是第 14 課與「還沒有」說明)", async () => {
    const { unmount } = render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    unmount();

    await db.cards.add(card("L30-V001", 30));
    render(<DrillPage />);
    await waitFor(async () => expect(await rangeSelect()).toHaveValue("30"));
    expect(
      screen.getByText("預設為已加入複習的最後一課。"),
    ).toBeInTheDocument();
  });

  it("練完一回合後重新進入:回到設定畫面(勾選的形保留);從結果頁的「看文法」返回則仍是結果頁", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    const first = render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);
    await user.click(screen.getByRole("button", { name: ruby("書きて") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    expect(
      screen.getByRole("heading", { name: "練習完成" }),
    ).toBeInTheDocument();
    first.unmount();

    // 再從課程頁的「活用練習」進入:設定畫面
    const second = render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    expect(screen.queryByText("練習完成")).not.toBeInTheDocument();
    const verbs = screen.getByRole("group", { name: /^動詞/ });
    expect(
      within(verbs).getByRole("button", { name: "否定(丁寧)" }),
    ).toHaveAttribute("aria-pressed", "false");

    // 再練一回合,從結果頁的「看文法」離開再返回:接續結果頁
    await start(user);
    await user.click(screen.getByRole("button", { name: ruby("書きて") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    const link = within(screen.getAllByRole("listitem")[0]).getByRole("link", {
      name: "看文法:第 14 課",
    });
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom 不做頁面導覽
    await user.click(link);
    second.unmount();

    // StrictMode(dev)重跑掛載 effect 時結果一致
    const third = render(
      <StrictMode>
        <DrillPage />
      </StrictMode>,
    );
    expect(
      await screen.findByRole("heading", { name: "練習完成" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();

    // 返回後有了新的操作(再練一次)再離開:不再視為從「看文法」返回
    await user.click(screen.getByRole("button", { name: "再練一次" }));
    await user.click(screen.getByRole("button", { name: ruby("書きて") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    third.unmount();
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    expect(screen.queryByText("練習完成")).not.toBeInTheDocument();
  });

  it("以不同的 ?upto= 進入:不接續,回到該範圍的設定", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    const { unmount } = render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["て形"]);
    await start(user);
    unmount();

    window.history.replaceState(null, "", "/drill?upto=20");
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("20");
  });
});
