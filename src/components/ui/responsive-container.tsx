import type { ReactNode } from "react";

export function ResponsiveContainer({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      {children}
    </div>
  );
}
