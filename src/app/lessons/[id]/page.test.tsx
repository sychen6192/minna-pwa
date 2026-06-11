import { generateStaticParams } from "./page";

describe("第 N 課頁面 generateStaticParams", () => {
  it("產出第 1–50 課共 50 筆", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(50);
    expect(params[0]).toEqual({ id: "1" });
    expect(params[49]).toEqual({ id: "50" });
  });
});
