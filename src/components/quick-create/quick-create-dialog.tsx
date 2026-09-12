"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { quickCreateAction } from "@/app/(erp)/quick-create/actions";
import type {
  QuickCreateKind,
  QuickCreateOption,
  QuickCreateResult,
} from "@/modules/workflow-ux/application/quick-create-contracts";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
import { SingleFlightForm } from "@/components/ui/single-flight-form";

import { QuickCreateFields, type QuickCreateReferences } from "./quick-create-fields";

const initialState: QuickCreateResult = { ok: false, message: "" };

export function QuickCreateDialog({
  kind,
  label,
  onCreated,
  references,
}: {
  kind: QuickCreateKind;
  label: string;
  onCreated: (option: QuickCreateOption) => void;
  references?: QuickCreateReferences | undefined;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(
    async (previous: QuickCreateResult, data: FormData) => {
      const result = await quickCreateAction(previous, data);
      if (result.ok) {
        onCreated(result.option);
        formRef.current?.reset();
        setOpen(false);
        launcherRef.current?.focus();
      }
      return result;
    },
    initialState,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, mounted]);
  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  return (
    <>
      <button
        className="min-h-11 rounded-lg border border-[var(--control-border)] bg-white px-3 text-sm font-semibold text-[var(--accent)]"
        onClick={() => setOpen(true)}
        ref={launcherRef}
        type="button"
      >
        [+] {label}
      </button>
      {mounted
        ? createPortal(
            <dialog
              aria-labelledby={`quick-create-${kind}-title`}
              className="m-auto max-h-[90vh] w-[min(46rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-[var(--control-border)] bg-white p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
              onCancel={(event) => {
                event.preventDefault();
                close();
              }}
              ref={dialogRef}
            >
              <SingleFlightForm action={formAction} className="space-y-5 p-5" ref={formRef}>
                <input name="kind" type="hidden" value={kind} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Quick create
                  </p>
                  <h2 className="mt-1 text-xl font-bold" id={`quick-create-${kind}-title`}>
                    New {label}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Save this record and return to the transaction with it selected.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <QuickCreateFields kind={kind} references={references} />
                </div>
                {!state.ok ? <ActionFeedback message={state.message} /> : null}
                <FormActions
                  onCancel={close}
                  pendingLabel="Saving…"
                  submitLabel={`Save ${label}`}
                />
              </SingleFlightForm>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
