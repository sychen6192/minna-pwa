import { render, screen } from "@testing-library/react";
import { Heatmap, heatLevel } from "./Heatmap";

describe("heatLevel", () => {
  it("固定分級:0 / 1–4 / 5–9 / 10–19 / 20+", () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(4)).toBe(1);
    expect(heatLevel(5)).toBe(2);
    expect(heatLevel(9)).toBe(2);
    expect(heatLevel(10)).toBe(3);
    expect(heatLevel(19)).toBe(3);
    expect(heatLevel(20)).toBe(4);
    expect(heatLevel(100)).toBe(4);
  });
});

describe("Heatmap", () => {
  // 2026-07-01 是週三 → 週一起算需 2 格前置空白
  const data = [
    { date: "2026-07-01", count: 0 },
    { date: "2026-07-02", count: 3 },
    { date: "2026-07-03", count: 12 },
  ];

  it("每個資料點一格,title 帶日期與次數(hover tooltip)", () => {
    render(<Heatmap data={data} />);

    expect(screen.getByTitle("2026-07-01:0 次複習")).toBeInTheDocument();
    expect(screen.getByTitle("2026-07-02:3 次複習")).toBeInTheDocument();
    expect(screen.getByTitle("2026-07-03:12 次複習")).toBeInTheDocument();
  });

  it("依週一對齊補前置空白格(aria-hidden)", () => {
    const { container } = render(<Heatmap data={data} />);

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it("強度以 data-level 標記", () => {
    render(<Heatmap data={data} />);

    expect(screen.getByTitle("2026-07-01:0 次複習").dataset.level).toBe("0");
    expect(screen.getByTitle("2026-07-02:3 次複習").dataset.level).toBe("1");
    expect(screen.getByTitle("2026-07-03:12 次複習").dataset.level).toBe("3");
  });
});
