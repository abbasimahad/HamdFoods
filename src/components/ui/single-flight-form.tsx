"use client";

import type { ComponentProps } from "react";
import { useMemo } from "react";

import { createSingleFlightGuard } from "./data-entry-state";

type FormAction = (formData: FormData) => void | Promise<void>;

export function SingleFlightForm({
  action,
  onSubmit,
  ...props
}: Omit<ComponentProps<"form">, "action"> & {
  action: FormAction;
}) {
  const guard = useMemo(() => createSingleFlightGuard(), []);
  const guardedAction: FormAction = async (formData) => {
    // Native submit acquires synchronously; direct action dispatch still gets one guarded entry.
    if (!guard.active() && !guard.enter()) return;
    try {
      await action(formData);
    } finally {
      guard.leave();
    }
  };

  function handleSubmit(event: Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0]) {
    if (!guard.enter()) event.preventDefault();
    onSubmit?.(event);
  }

  return <form action={guardedAction} onSubmit={handleSubmit} {...props} />;
}
