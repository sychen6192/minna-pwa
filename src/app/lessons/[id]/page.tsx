import { LessonDetail } from "./LessonDetail";

/** output: 'export' 動態路由:預先產出第 1–50 課的靜態頁 */
export function generateStaticParams() {
  return Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1) }));
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LessonDetail id={Number(id)} />;
}
