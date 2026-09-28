import { QuizRunner } from "./QuizRunner";

/** output: 'export' 動態路由:預先產出第 1–50 課的測驗頁 */
export function generateStaticParams() {
  return Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1) }));
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // key:「下一課測驗 →」在同一路由間切換時重新掛載,作答狀態不沿用
  return <QuizRunner key={id} id={Number(id)} />;
}
