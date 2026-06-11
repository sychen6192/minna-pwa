import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 Tailwind class（shadcn/ui 慣例 helper） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
