"use client";

import { todayInFactoryTimeZone } from "@/server/shared/factory-local-time";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import {
  emptyJournalLine,
  JournalLinesEditor,
  journalLinesPayload,
  type JournalLine,
} from "@/components/accounting/account-lines-editor";
import {
  backfillAccountingAction,
  createAccountingAccountAction,
  createAccountingPeriodAction,
  postManualJournalAction,
  reverseManualJournalAction,
  setAccountingAccountActiveAction,
  setAccountingPeriodStatusAction,
  updateAccountMappingAction,
  updateAccountingSettingsAction,
} from "@/app/(erp)/accounting/actions";

// UX-6: a <form action={fn}> is reset by React after the action settles, which snaps a
// controlled <select> back to the option it was first rendered with. Submitting through
// onSubmit dispatches the same action without the automatic reset, so the chosen value stays.
function submitWithoutReset(event: FormEvent<HTMLFormElement>, action: (form: FormData) => void) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  startTransition(() => action(form));
}

export function AccountingPeriodForm() {
  const [state, action, pending] = useActionState(createAccountingPeriodAction, undefined);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-4">
      <input className="rounded border px-3 py-2" name="name" placeholder="Period name" required />
      <input className="rounded border px-3 py-2" name="startDate" type="date" required />
      <input className="rounded border px-3 py-2" name="endDate" type="date" required />
      <button className="rounded bg-[var(--accent)] px-3 py-2 text-white" disabled={pending}>
        Create period
      </button>
      {state && !state.ok ? (
        <p className="text-sm text-red-700 md:col-span-4">{state.message}</p>
      ) : null}
    </form>
  );
}

export function ManualJournalForm({
  accounts,
  defaultDate,
}: {
  accounts: readonly {
    id: string;
    code: string;
    name: string;
    isControl: boolean;
    postingAllowed: boolean;
    active: boolean;
  }[];
  defaultDate: string;
}) {
  const [lines, setLines] = useState<JournalLine[]>(() => [emptyJournalLine(), emptyJournalLine()]);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof postManualJournalAction>> | undefined,
      form: FormData,
    ) => {
      const result = await postManualJournalAction(previous, form);
      if (result.ok) {
        // Clear the entry so the same journal is not posted twice by re-submitting.
        setLines([emptyJournalLine(), emptyJournalLine()]);
        setFormKey((key) => key + 1);
      }
      return result;
    },
    undefined,
  );
  const usable = accounts.filter(
    (account) => account.active && account.postingAllowed && !account.isControl,
  );
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3" key={formKey}>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm font-medium">
            Journal date
            <input
              className="mt-1 block min-h-11 w-full rounded border px-3 py-2"
              defaultValue={defaultDate}
              name="date"
              type="date"
              required
            />
          </label>
          <label className="text-sm font-medium">
            Journal memo
            <input
              className="mt-1 block min-h-11 w-full rounded border px-3 py-2"
              name="description"
              required
            />
          </label>
        </div>
        <input name="lines" type="hidden" value={journalLinesPayload(lines)} />
        <JournalLinesEditor accounts={usable} lines={lines} onChange={setLines} />
        <p className="text-xs text-[var(--muted)]">
          Each line needs one positive debit or credit, and total debits must equal total credits.
          Control accounts (receivables, payables, inventory) are posted only by their source
          documents.
        </p>
        <button
          className="min-h-11 rounded bg-[var(--accent)] px-3 py-2 text-white"
          disabled={pending}
        >
          {pending ? "Posting…" : "Post manual journal"}
        </button>
      </form>
      {state ? <ActionFeedback message={state.message} ok={state.ok} /> : null}
    </div>
  );
}

export function AccountingSettingsForm({
  purchaseTaxTreatment,
}: {
  purchaseTaxTreatment: "RECOVERABLE" | "CAPITALIZE" | "EXPENSE" | "NOT_CONFIGURED";
}) {
  const [value, setValue] = useState(purchaseTaxTreatment);
  const [state, action, pending] = useActionState(updateAccountingSettingsAction, undefined);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => submitWithoutReset(event, action)}
    >
      <label className="text-sm" htmlFor="purchaseTaxTreatment">
        Purchase tax treatment
      </label>
      <select
        className="rounded border px-3 py-2"
        id="purchaseTaxTreatment"
        name="purchaseTaxTreatment"
        onChange={(event) => setValue(event.target.value as typeof value)}
        value={value}
      >
        <option value="NOT_CONFIGURED">Not configured</option>
        <option value="RECOVERABLE">Recoverable</option>
        <option value="CAPITALIZE">Capitalize</option>
        <option value="EXPENSE">Expense</option>
      </select>
      <button className="rounded bg-[var(--accent)] px-3 py-2 text-white" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </button>
      {state ? <ActionFeedback className="w-full" message={state.message} ok={state.ok} /> : null}
    </form>
  );
}

export function AccountingPeriodStatusForm({
  periodId,
  status,
}: {
  periodId: string;
  status: "OPEN" | "CLOSED";
}) {
  const [state, action, pending] = useActionState(setAccountingPeriodStatusAction, undefined);
  const next = status === "OPEN" ? "CLOSED" : "OPEN";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="periodId" type="hidden" value={periodId} />
      <input name="status" type="hidden" value={next} />
      {next === "OPEN" ? (
        <input
          className="rounded border px-2 py-1 text-xs"
          name="reason"
          placeholder="Reason required to reopen"
          required
        />
      ) : null}
      <button className="text-[var(--accent)]" disabled={pending}>
        {next === "CLOSED" ? "Run close checklist & close" : "Reopen"}
      </button>
      {state && !state.ok ? (
        <span className="ml-2 text-xs text-red-700">{state.message}</span>
      ) : null}
    </form>
  );
}

export function AccountingMappingForm({
  mappingKey,
  accountId,
  accounts,
}: {
  mappingKey: string;
  accountId: string;
  accounts: readonly {
    id: string;
    code: string;
    name: string;
    active: boolean;
    postingAllowed: boolean;
  }[];
}) {
  const [value, setValue] = useState(accountId);
  const [state, action, pending] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof updateAccountMappingAction>> | undefined,
      form: FormData,
    ) => {
      const result = await updateAccountMappingAction(previous, form);
      // A rejected mapping leaves the saved account in place, so show that again.
      if (!result.ok) setValue(accountId);
      return result;
    },
    undefined,
  );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => submitWithoutReset(event, action)}
    >
      <input name="mappingKey" type="hidden" value={mappingKey} />
      <span className="w-52 text-xs">{mappingKey}</span>
      <select
        className="min-w-64 rounded border px-2 py-1 text-sm"
        name="accountId"
        onChange={(event) => setValue(event.target.value)}
        value={value}
      >
        {accounts
          .filter((account) => account.active && account.postingAllowed)
          .map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
            </option>
          ))}
      </select>
      <button className="text-sm text-[var(--accent)]" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state ? (
        <span className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function AccountingBackfillForm() {
  const [state, action, pending] = useActionState(
    async () => backfillAccountingAction(),
    undefined,
  );
  return (
    <form action={action}>
      <button className="rounded bg-[var(--accent)] px-3 py-2 text-white" disabled={pending}>
        Run idempotent accounting backfill
      </button>
      {state && !state.ok ? <p className="mt-2 text-sm text-red-700">{state.message}</p> : null}
    </form>
  );
}

export function ManualJournalReversalForm({ journalId }: { journalId: string }) {
  const [state, action, pending] = useActionState(reverseManualJournalAction, undefined);
  return (
    <form action={action} className="mt-4 grid gap-2 md:grid-cols-[1fr_2fr_auto] md:items-end">
      <input name="journalId" type="hidden" value={journalId} />
      <label className="text-sm font-medium">
        Reversal date
        <input
          className="mt-1 block min-h-11 w-full rounded border px-3 py-2"
          defaultValue={todayInFactoryTimeZone()}
          name="date"
          type="date"
          required
        />
      </label>
      <label className="text-sm font-medium">
        Reason for reversal
        <input
          className="mt-1 block min-h-11 w-full rounded border px-3 py-2"
          name="reason"
          required
        />
      </label>
      <button className="min-h-11 rounded bg-red-700 px-3 py-2 text-white" disabled={pending}>
        Reverse journal
      </button>
      {state ? (
        <ActionFeedback className="md:col-span-3" message={state.message} ok={state.ok} />
      ) : null}
    </form>
  );
}

export function AccountingAccountStatusForm({
  accountId,
  active,
}: {
  accountId: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(setAccountingAccountActiveAction, undefined);
  return (
    <form action={action} className="inline">
      <input name="accountId" type="hidden" value={accountId} />
      <input name="active" type="hidden" value={String(!active)} />
      <button className="text-[var(--accent)]" disabled={pending}>
        {active ? "Deactivate" : "Reactivate"}
      </button>
      {state && !state.ok ? (
        <span className="ml-2 text-xs text-red-700">{state.message}</span>
      ) : null}
    </form>
  );
}

export function AccountingAccountForm({
  accounts,
}: {
  accounts: readonly { id: string; code: string; name: string; accountType: string }[];
}) {
  const [state, action, pending] = useActionState(createAccountingAccountAction, undefined);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-3">
      <input className="rounded border px-3 py-2" name="code" placeholder="Account code" required />
      <input className="rounded border px-3 py-2" name="name" placeholder="Account name" required />
      <select className="rounded border px-3 py-2" defaultValue="ASSET" name="accountType">
        <option value="ASSET">Asset</option>
        <option value="LIABILITY">Liability</option>
        <option value="EQUITY">Equity</option>
        <option value="REVENUE">Revenue</option>
        <option value="EXPENSE">Expense</option>
      </select>
      <input className="rounded border px-3 py-2" name="subtype" placeholder="Subtype (optional)" />
      <select className="rounded border px-3 py-2" defaultValue="" name="parentAccountId">
        <option value="">No parent account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} — {account.name}
          </option>
        ))}
      </select>
      <input name="postingAllowed" type="hidden" value="false" />
      <input name="isControl" type="hidden" value="false" />
      <div className="flex items-center gap-4 text-sm">
        <label>
          <input defaultChecked name="postingAllowed" type="checkbox" value="true" /> Posting
          allowed
        </label>
        <label>
          <input name="isControl" type="checkbox" value="true" /> Control account
        </label>
      </div>
      <button className="rounded bg-[var(--accent)] px-3 py-2 text-white" disabled={pending}>
        Create account
      </button>
      {state ? (
        <ActionFeedback className="md:col-span-3" message={state.message} ok={state.ok} />
      ) : null}
    </form>
  );
}
