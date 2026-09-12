export type SelectOption = {
  value: string;
  label: string;
  keywords?: string;
};

export function filterSelectOptions(
  options: readonly SelectOption[],
  query: string,
): readonly SelectOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) =>
    `${option.label} ${option.keywords ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
}

export function nextActiveOptionIndex(
  current: number,
  direction: "first" | "last" | "next" | "previous",
  count: number,
): number {
  if (count <= 0) return -1;
  if (direction === "first") return 0;
  if (direction === "last") return count - 1;
  if (direction === "next") return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

export type SingleFlightGuard = {
  enter(): boolean;
  leave(): void;
  active(): boolean;
};

export function createSingleFlightGuard(): SingleFlightGuard {
  let inFlight = false;
  return {
    enter: () => {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    leave: () => {
      inFlight = false;
    },
    active: () => inFlight,
  };
}

export function createLineKey(): string {
  return globalThis.crypto.randomUUID();
}
