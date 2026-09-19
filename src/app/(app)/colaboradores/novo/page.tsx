import { redirect } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { Page, Flash } from "@/components/ui";
import { EmployeeForm } from "../EmployeeForm";
import { criarColaborador } from "../actions";

export const dynamic = "force-dynamic";

export default async function Novo({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireSession(); if (!can.editar(s)) redirect("/colaboradores");
  const { erro } = await searchParams;
  return (
    <Page title="Novo colaborador">
      <Flash erro={erro} />
      <EmployeeForm s={s} action={criarColaborador} novo />
    </Page>
  );
}
