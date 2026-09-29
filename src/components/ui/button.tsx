import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui 樣式的 Button(手寫、不含 asChild/radix Slot)。
 * 顏色只用 globals.css 的語意 token,深色模式由 token 自動切換。
 * 連結按鈕:`<Link className={buttonVariants({ variant, size, className })}>`。
 */
const variants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-transparent hover:bg-muted active:bg-muted",
        secondary:
          "bg-muted text-foreground hover:bg-muted/70 active:bg-muted/70",
        ghost: "hover:bg-muted active:bg-muted",
        link: "text-link underline underline-offset-4",
      },
      size: {
        default: "h-11 px-5 text-base",
        sm: "h-9 px-3 text-sm",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonVariantProps = VariantProps<typeof variants>;

/** 產生按鈕 class(以 tailwind-merge 合併,`className` 可覆寫 variant 的同類 utility)。 */
export function buttonVariants({
  className,
  ...props
}: ButtonVariantProps & { className?: string } = {}): string {
  return cn(variants(props), className);
}

export type ButtonProps = ComponentProps<"button"> & ButtonVariantProps;

/** 預設 `type="button"`(避免在 form 內誤觸送出);送出鈕須明寫 `type="submit"`。 */
export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
