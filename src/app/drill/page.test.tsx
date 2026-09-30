import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
      screen.getByRole("heading", { name: "活用・助詞練習" }),
    ).toBeInTheDocument();
    // 預設為活用練習(T11.7:同頁另有助詞搭配)
    expect(screen.getByRole("button", { name: "活用" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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

describe("DrillPage 設定:進階形(T11.5)", () => {
  const ADVANCED = [
    ["可能形", 27],
    ["意向形", 31],
    ["命令形", 33],
    ["禁止形", 33],
    ["條件形(ば)", 35],
    ["被動形", 37],
    ["使役形", 48],
  ] as const;

  /** 某組某列(基本/進階)的 chips(不含全選鈕) */
  function chipsOf(group: RegExp, level: "基本" | "進階") {
    const row = within(screen.getByRole("group", { name: group })).getByRole(
      "group",
      { name: level },
    );
    return within(row)
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"));
  }

  it("第 1–26 課:進階形 chips 全部鎖住並標示導入課;改成第 1–50 課後全部開放且勾選", async () => {
    window.history.replaceState(null, "", "/drill?upto=26");
    const user = userEvent.setup();
    render(<DrillPage />);
    const select = await rangeSelect();
    const locked = chipsOf(/^動詞/, "進階");
    expect(locked.map((c) => c.firstChild?.textContent)).toEqual(
      ADVANCED.map(([name]) => name),
    );
    locked.forEach((chip, i) => {
      expect(chip).toBeDisabled();
      expect(chip).toHaveAttribute("aria-pressed", "false");
      expect(chip).toHaveTextContent(`第 ${ADVANCED[i][1]} 課學`);
    });
    // 鎖住的列沒有全選鈕
    const advRow = within(
      screen.getByRole("group", { name: /^動詞/ }),
    ).getByRole("group", { name: "進階" });
    expect(
      within(advRow).queryByRole("button", { name: /全選/ }),
    ).not.toBeInTheDocument();
    const adjAdv = chipsOf(/^形容詞/, "進階");
    expect(adjAdv).toHaveLength(1);
    expect(adjAdv[0]).toHaveTextContent("條件形(〜ければ/〜なら)第 35 課學");
    expect(adjAdv[0]).toBeDisabled();
    // 基本形照常開放
    expect(
      chipsOf(/^動詞/, "基本").every((c) => !c.hasAttribute("disabled")),
    ).toBe(true);

    await user.selectOptions(select, "第 1–50 課");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /開始練習/ })).toBeEnabled(),
    );
    for (const chip of [
      ...chipsOf(/^動詞/, "進階"),
      ...chipsOf(/^形容詞/, "進階"),
    ]) {
      expect(chip).toBeEnabled();
      expect(chip).toHaveAttribute("aria-pressed", "true");
      expect(chip).not.toHaveTextContent(/課學/);
    }
  });

  it("每列可取消全選/全選(只作用於該列)", async () => {
    window.history.replaceState(null, "", "/drill?upto=50");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /開始練習/ })).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "取消全選:動詞・基本" }),
    );
    for (const chip of chipsOf(/^動詞/, "基本"))
      expect(chip).toHaveAttribute("aria-pressed", "false");
    for (const chip of chipsOf(/^動詞/, "進階"))
      expect(chip).toHaveAttribute("aria-pressed", "true");

    // 部分勾選時為「全選」
    await user.click(chipsOf(/^動詞/, "進階")[0]);
    await user.click(screen.getByRole("button", { name: "全選:動詞・進階" }));
    for (const chip of chipsOf(/^動詞/, "進階"))
      expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "全選:動詞・基本" }));
    for (const chip of chipsOf(/^動詞/, "基本"))
      expect(chip).toHaveAttribute("aria-pressed", "true");
    // 形容詞的進階列只有一個形:不給全選鈕
    expect(
      screen.queryByRole("button", { name: /形容詞・進階/ }),
    ).not.toBeInTheDocument();
  });
});

describe("DrillPage 作答:進階形(T11.5)", () => {
  it("可能形:題目標明答辞書形;選項含常見錯誤與易混淆的被動形;答錯連到 L27-G01", async () => {
    window.history.replaceState(null, "", "/drill?upto=50");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["可能形"]);
    await onlyForms(user, /^形容詞/, []);
    await start(user);

    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent(
      "書きます寫→改成可能形(辞書形)",
    );
    const options = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(options.sort()).toEqual(
      ["書ける", "書けれる", "書かれる", "書きられる"].sort(),
    );
    await user.click(screen.getByRole("button", { name: ruby("書かれる") }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("答錯 ✗書ける");
    expect(
      within(status).getByRole("link", { name: "看文法:第 27 課" }),
    ).toHaveAttribute("href", "/lessons/27#L27-G01");

    await user.click(screen.getByRole("button", { name: "看結果" }));
    const row = screen.getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("書きます→的正解是書ける");
    expect(row).toHaveTextContent("可能形(辞書形)");
    expect(row).toHaveTextContent("你的答案:書かれる");
  });

  it("逐(字, 形)出題:わかります 不出可能形(教材:わかる 本身即可能),仍出て形", async () => {
    const L09: Lesson = {
      ...filler(9),
      vocab: [
        {
          id: "L09-V001",
          ruby: [{ b: "わかります" }],
          kana: "わかります",
          meaning: "懂",
          pos: "動I",
        },
      ],
    };
    getLesson.mockImplementation((id: number) =>
      Promise.resolve(
        id === 9 ? L09 : id === 14 ? L14 : id === 20 ? L20 : filler(id),
      ),
    );
    window.history.replaceState(null, "", "/drill?upto=50");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    const verbGroup = screen.getByRole("group", { name: /^動詞/ });
    await waitFor(() => expect(verbGroup).toHaveAccessibleName("動詞 2 個"));
    await onlyForms(user, /^形容詞/, []);
    // 標題的字數只算勾選的形能出題者
    expect(screen.getByRole("group", { name: /^形容詞/ })).toHaveAccessibleName(
      "形容詞 0 個",
    );
    await onlyForms(user, /^動詞/, ["可能形"]);
    expect(verbGroup).toHaveAccessibleName("動詞 1 個");
    await start(user);
    // 範圍內兩個動詞,只有 書きます 有可能形
    expect(screen.getByText("第 1 / 1 題")).toBeInTheDocument();
    expect(screen.getByText("寫")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ruby("書ける") }));
    await user.click(screen.getByRole("button", { name: "看結果" }));
    await user.click(screen.getByRole("button", { name: "換範圍" }));
    // 改成只練て形(設定保留了只勾可能形)
    const verbs = screen.getByRole("group", { name: /^動詞/ });
    await user.click(within(verbs).getByRole("button", { name: "可能形" }));
    await user.click(within(verbs).getByRole("button", { name: "て形" }));
    expect(verbs).toHaveAccessibleName("動詞 2 個");
    await start(user);
    // 兩個字都出て形
    expect(screen.getByText("第 1 / 2 題")).toBeInTheDocument();
  });

  it("来る 的命令形:選項只差讀音,一律顯示讀音(来(こ)い/来(こ)ろ/来(き)ろ)", async () => {
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
    window.history.replaceState(null, "", "/drill?upto=50");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    await onlyForms(user, /^動詞/, ["命令形"]);
    await start(user);
    const options = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(options.sort()).toEqual(
      ["来こい", "来ころ", "来きろ", "来くるな"].sort(),
    );
    const koi = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "来こい");
    if (!koi) throw new Error("找不到 来(こ)い");
    await user.click(koi);
    expect(screen.getByRole("status")).toHaveTextContent("答對 ✓来こい");
    expect(
      within(screen.getByRole("status")).getByRole("link", {
        name: "看文法:第 33 課",
      }),
    ).toHaveAttribute("href", "/lessons/33#L33-G01");
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
    expect(
      screen.getByRole("heading", { name: "活用・助詞練習" }),
    ).toHaveFocus();
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

describe("DrillPage 助詞搭配(T11.7)", () => {
  const L06: Lesson = {
    id: 6,
    title: "第6課",
    vocab: [
      {
        id: "L06-V003",
        ruby: [{ b: "吸", r: "す" }, { b: "います" }],
        kana: "すいます",
        meaning: "吸〔煙〕",
        pos: "動I",
        note: "［たばこを〜］",
      },
      {
        id: "L06-V011",
        ruby: [{ b: "会", r: "あ" }, { b: "います" }],
        kana: "あいます",
        meaning: "遇見、碰見〔朋友〕",
        pos: "動I",
        note: "［友達に〜］",
      },
      {
        id: "L06-V038",
        ruby: [{ b: "宿題", r: "しゅくだい" }],
        kana: "しゅくだい",
        meaning: "作業",
        pos: "名",
        note: "〔〜を します:做作業〕",
      },
      {
        id: "L06-V050",
        ruby: [{ b: "山田", r: "やまだ" }],
        kana: "やまだ",
        meaning: "山田(姓)",
        pos: "名",
        note: "補充單字(自行練習發音)",
      },
    ],
    grammar: [],
    dialogues: [],
  };

  beforeEach(() => {
    getLesson.mockImplementation((id: number) =>
      Promise.resolve(
        id === 6 ? L06 : id === 14 ? L14 : id === 20 ? L20 : filler(id),
      ),
    );
    // 時鐘停住:換題/作答/進結果頁後的點擊防護(300ms)由 passTapGuard 明確撥過
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 把時鐘撥過點擊防護 */
  function passTapGuard() {
    vi.setSystemTime(Date.now() + 1_000);
  }

  const modeButton = (name: "活用" | "助詞") =>
    within(screen.getByRole("group", { name: "練習類型" })).getByRole(
      "button",
      { name },
    );
  const options = () =>
    within(screen.getByRole("group", { name: "選項" })).getAllByRole("button");
  const option = (particle: string) =>
    within(screen.getByRole("group", { name: "選項" })).getByRole("button", {
      name: particle,
    });

  /** 題幹(名詞（　）述語)開頭的名詞 → 正解 */
  const ANSWERS: Record<string, string> = {
    たばこ: "を",
    友達: "に",
    宿題: "を",
  };
  function currentAnswer(): string {
    const stem = (document.activeElement?.textContent ?? "").replace(
      "選出空格中的助詞:",
      "",
    );
    const key = Object.keys(ANSWERS).find((k) => stem.startsWith(k));
    if (!key) throw new Error(`不認得的題目:${stem}`);
    return ANSWERS[key];
  }

  it("分段鈕切換類型:形的 chips 換成助詞搭配說明,範圍共用;類型寫回網址", async () => {
    window.history.replaceState(null, "", "/drill?upto=14");
    const user = userEvent.setup();
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("14");
    expect(modeButton("活用")).toHaveAttribute("aria-pressed", "true");
    expect(modeButton("助詞")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: /^動詞/ })).toBeInTheDocument();

    await user.click(modeButton("助詞"));
    expect(modeButton("助詞")).toHaveAttribute("aria-pressed", "true");
    expect(modeButton("活用")).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("group", { name: /^動詞/ }),
    ).not.toBeInTheDocument();
    expect(window.location.search).toBe("?upto=14&mode=particle");
    // 範圍內的搭配:吸います、会います、宿題(補充單字不算)
    expect(
      await screen.findByRole("heading", { name: "助詞搭配 3 個" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/以教材搭配為準/)).toBeInTheDocument();
    expect(screen.getByText("友達に／と 会う")).toHaveAttribute("lang", "ja");
    // 搭配不足 10 個:全部出
    expect(
      screen.getByRole("button", { name: "開始練習(3 題)" }),
    ).toBeEnabled();
    expect(await rangeSelect()).toHaveValue("14");

    // 範圍調整後網址同時帶範圍與類型
    await user.click(screen.getByRole("button", { name: "範圍增加一課" }));
    expect(window.location.search).toBe("?upto=15&mode=particle");

    await user.click(modeButton("活用"));
    expect(window.location.search).toBe("?upto=15");
    expect(screen.getByRole("group", { name: /^動詞/ })).toBeInTheDocument();
  });

  it("?mode=particle 直接進入助詞搭配;第 6 課以前沒有搭配:不能開始並提示", async () => {
    window.history.replaceState(null, "", "/drill?upto=5&mode=particle");
    render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("5");
    expect(modeButton("助詞")).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByText("第 6 課起才有教材標註的助詞搭配。"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "助詞搭配 0 個" }),
    ).toBeInTheDocument();
    // 沒有搭配:開始鈕不標題數
    expect(screen.getByRole("button", { name: /開始練習/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /開始練習/ })).toHaveTextContent(
      /^開始練習$/,
    );
  });

  it("作答一回合:題幹、4 個選項、答對/答錯的回饋(完整搭配、朗讀、中譯);結果頁列錯題", async () => {
    window.history.replaceState(null, "", "/drill?upto=6&mode=particle");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    const startButton = await screen.findByRole("button", {
      name: "開始練習(3 題)",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await user.click(startButton);

    expect(screen.getByText("第 1 / 3 題")).toBeInTheDocument();
    expect(screen.getByText("助詞搭配")).toBeInTheDocument();
    expect(screen.getByText("教材搭配")).toBeInTheDocument();
    const seen: string[] = [];
    let wrongChoice = "";
    for (let i = 0; i < 3; i++) {
      // 換題後焦點在題幹(螢幕閱讀器先念題目)
      const stem = document.activeElement?.textContent ?? "";
      expect(stem).toMatch(/^選出空格中的助詞:.+\(空格\).+教材搭配$/);
      seen.push(stem);
      const answer = currentAnswer();
      // 4 個選項:正解恰一個、依 を・に・が・で・へ・と 的順序
      const texts = options().map((b) => b.textContent ?? "");
      expect(texts).toHaveLength(4);
      expect(texts.filter((t) => t === answer)).toHaveLength(1);
      expect(texts).toEqual(
        ["を", "に", "が", "で", "へ", "と"].filter((p) => texts.includes(p)),
      );
      for (const b of options()) expect(b).toHaveAttribute("lang", "ja");

      passTapGuard();
      const status = screen.getByRole("status");
      if (i === 0) {
        // 第 1 題答對
        await user.click(option(answer));
        expect(within(status).getByText("答對 ✓")).toBeInTheDocument();
        expect(option(answer)).toHaveClass("border-success");
      } else if (i === 1) {
        // 第 2 題答錯:標出正解與所選,附「教材搭配」的說明
        wrongChoice = texts.find((t) => t !== answer) ?? "";
        await user.click(option(wrongChoice));
        expect(within(status).getByText("答錯 ✗")).toBeInTheDocument();
        expect(option(wrongChoice)).toHaveClass("border-destructive");
        expect(option(answer)).toHaveClass("border-success");
        expect(status).toHaveTextContent(/以教材搭配為準/);
      } else {
        await user.click(option(answer));
      }
      // 作答後:空格填入正解、選項鎖住、焦點移到下一步
      expect(
        document.querySelector("[aria-hidden].border-success"),
      ).toHaveTextContent(answer);
      for (const b of options()) expect(b).toBeDisabled();
      const next = screen.getByRole("button", {
        name: i === 2 ? "看結果" : "下一題",
      });
      expect(next).toHaveFocus();
      passTapGuard();
      await user.click(next);
    }
    expect(new Set(seen).size).toBe(3);

    // 結果頁:分數、錯題(完整搭配、中譯、課、你的答案)
    expect(screen.getByRole("heading", { name: "練習完成" })).toHaveFocus();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "錯題(1)" }),
    ).toBeInTheDocument();
    const row = screen.getAllByRole("listitem")[0];
    expect(row).toHaveTextContent(/第 6 課/);
    expect(row).toHaveTextContent(`你的答案:${wrongChoice}`);

    passTapGuard();
    await user.click(screen.getByRole("button", { name: "再練一次" }));
    expect(screen.getByText("第 1 / 3 題")).toBeInTheDocument();
  });

  it("回饋:完整搭配(ruby)、朗讀用讀音、單字釋義;〔〜を します〕的中譯取 note 說明", async () => {
    await setSetting("furigana", "show");
    window.history.replaceState(null, "", "/drill?upto=6&mode=particle");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    const startButton = await screen.findByRole("button", {
      name: "開始練習(3 題)",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await user.click(startButton);

    const checked = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const answer = currentAnswer();
      const stem = document.activeElement?.textContent ?? "";
      passTapGuard();
      await user.click(option(answer));
      const status = screen.getByRole("status");
      if (stem.includes("たばこ")) {
        // 單字的 ruby 照設定顯示讀音
        expect(status).toHaveTextContent("たばこを 吸すいます");
        expect(status).toHaveTextContent("吸〔煙〕");
        await user.click(
          within(status).getByRole("button", {
            name: "播放 たばこを 吸います 的發音",
          }),
        );
        expect(speak).toHaveBeenLastCalledWith("たばこを すいます");
        checked.add("吸います");
      } else if (stem.includes("宿題")) {
        expect(status).toHaveTextContent("宿題しゅくだいを します");
        expect(status).toHaveTextContent("做作業");
        await user.click(
          within(status).getByRole("button", {
            name: "播放 宿題を します 的發音",
          }),
        );
        expect(speak).toHaveBeenLastCalledWith("しゅくだいを します");
        checked.add("宿題");
      }
      passTapGuard();
      await user.click(
        screen.getByRole("button", { name: i === 2 ? "看結果" : "下一題" }),
      );
    }
    expect(checked).toEqual(new Set(["吸います", "宿題"]));
  });

  it("雙擊防護:換題後 300ms 內點選項不作答;作答後 300ms 內點「下一題」不換題;結果頁同", async () => {
    window.history.replaceState(null, "", "/drill?upto=6&mode=particle");
    render(<DrillPage />);
    await rangeSelect();
    const startButton = await screen.findByRole("button", {
      name: "開始練習(3 題)",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);

    // 開始鈕的第二下落在選項上:不作答
    const answer = currentAnswer();
    fireEvent.click(option(answer));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    passTapGuard();
    fireEvent.click(option(answer));
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();
    // 作答後立刻再點「下一題」:不換題
    fireEvent.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 1 / 3 題")).toBeInTheDocument();

    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第 2 / 3 題")).toBeInTheDocument();
    for (let i = 1; i < 3; i++) {
      passTapGuard();
      fireEvent.click(option(currentAnswer()));
      passTapGuard();
      fireEvent.click(
        screen.getByRole("button", { name: i === 2 ? "看結果" : "下一題" }),
      );
    }
    // 結果頁:剛進入時點「再練一次」不作用
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再練一次" }));
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    passTapGuard();
    fireEvent.click(screen.getByRole("button", { name: "換範圍" }));
    // 回到設定(仍是助詞搭配),焦點在標題
    expect(
      screen.getByRole("heading", { name: "活用・助詞練習" }),
    ).toHaveFocus();
    expect(modeButton("助詞")).toHaveAttribute("aria-pressed", "true");
  });

  it("離開再返回:進行中的回合接續;課程頁的 ?upto= 連結回到活用練習,不帶參數的 /drill 沿用上次的類型", async () => {
    window.history.replaceState(null, "", "/drill?upto=6&mode=particle");
    const user = userEvent.setup();
    const first = render(<DrillPage />);
    await rangeSelect();
    const startButton = await screen.findByRole("button", {
      name: "開始練習(3 題)",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await user.click(startButton);
    passTapGuard();
    await user.click(option(currentAnswer()));
    first.unmount();

    // 從「測驗」頁的卡片進入(/drill,不帶參數):接續同一題;類型與範圍寫回網址(重新整理仍是助詞搭配)
    window.history.replaceState(null, "", "/drill");
    const second = render(<DrillPage />);
    expect(await screen.findByText("第 1 / 3 題")).toBeInTheDocument();
    expect(screen.getByText("答對 ✓")).toBeInTheDocument();
    expect(window.location.search).toBe("?upto=6&mode=particle");
    second.unmount();

    // 從課程頁的「活用練習」(?upto=6):活用練習的設定畫面
    window.history.replaceState(null, "", "/drill?upto=6");
    const third = render(<DrillPage />);
    expect(await rangeSelect()).toHaveValue("6");
    expect(modeButton("活用")).toHaveAttribute("aria-pressed", "true");
    third.unmount();

    // 切到助詞後離開,再以 /drill 進入:沿用助詞
    render(<DrillPage />);
    await rangeSelect();
    await user.click(modeButton("助詞"));
    cleanup();
    window.history.replaceState(null, "", "/drill");
    render(<DrillPage />);
    await rangeSelect();
    expect(modeButton("助詞")).toHaveAttribute("aria-pressed", "true");
    // 範圍重新推算(不寫出),類型寫回網址
    expect(window.location.search).toBe("?mode=particle");
  });

  it("不寫入 SRS/DB", async () => {
    window.history.replaceState(null, "", "/drill?upto=6&mode=particle");
    const user = userEvent.setup();
    render(<DrillPage />);
    await rangeSelect();
    const startButton = await screen.findByRole("button", {
      name: "開始練習(3 題)",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    await user.click(startButton);
    for (let i = 0; i < 3; i++) {
      passTapGuard();
      await user.click(option(currentAnswer()));
      passTapGuard();
      await user.click(
        screen.getByRole("button", { name: i === 2 ? "看結果" : "下一題" }),
      );
    }
    expect(screen.getByText("全部答對 🎉")).toBeInTheDocument();
    expect(await db.cards.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
  });
});
