import type { ComponentProps } from "react";

type CardProps = ComponentProps<"section">;

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--raised)] ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}
