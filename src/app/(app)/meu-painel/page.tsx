import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

/** Atalho usado em notificações para várias pessoas: leva cada um ao próprio painel. */
export default async function MeuPainel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; if (!s.employeeId) redirect("/conta");
  const q = new URLSearchParams(Object.entries(sp).filter((x): x is [string, string] => typeof x[1] === "string")).toString();
  redirect(`/colaboradores/${s.employeeId}/painel${q ? `?${q}` : ""}`);
}
