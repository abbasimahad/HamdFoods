import { LoadingState } from "@/components/ui/loading-state";
import { ResponsiveContainer } from "@/components/ui/responsive-container";

export default function Loading() {
  return (
    <ResponsiveContainer>
      <LoadingState />
    </ResponsiveContainer>
  );
}
