import { generateStaticParams } from "./page";

describe("測驗頁 generateStaticParams", () => {
  it("產出第 1–50 課共 50 筆", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(50);
    expect(params[0]).toEqual({ id: "1" });
    expect(params[49]).toEqual({ id: "50" });
  });
});
