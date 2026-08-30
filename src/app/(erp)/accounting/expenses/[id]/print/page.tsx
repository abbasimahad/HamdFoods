import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounting.view");
  const expense = await prisma.expenseVoucher.findUnique({
    where: { id: (await params).id },
    include: {
      treasuryAccount: true,
      lines: { include: { expenseAccount: true }, orderBy: { position: "asc" } },
    },
  });
  if (!expense) notFound();
  return (
    <main className="mx-auto max-w-3xl p-8 print:max-w-none print:p-0">
      <h1 className="text-2xl font-semibold">Expense Voucher {expense.number}</h1>
      <p className="mt-2">Date: {expense.expenseDate.toISOString().slice(0, 10)}</p>
      <p>Paid from: {expense.treasuryAccount.name}</p>
      <p>Payee: {expense.payee ?? "—"}</p>
      <p>Description: {expense.description}</p>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-2 text-left">Expense account</th>
            <th className="p-2 text-left">Description</th>
            <th className="p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expense.lines.map((line) => (
            <tr className="border-b" key={line.id}>
              <td className="p-2">
                {line.expenseAccount.code} — {line.expenseAccount.name}
              </td>
              <td className="p-2">{line.description}</td>
              <td className="p-2 text-right">{line.amount.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-right font-semibold">Total: {expense.totalAmount.toString()}</p>
    </main>
  );
}
