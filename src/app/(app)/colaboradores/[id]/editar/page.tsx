import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession, can } from "@/lib/auth";
import { Page, Flash } from "@/components/ui";
import { EmployeeForm } from "../../EmployeeForm";
import { atualizarColaborador } from "../../actions";

export const dynamic = "force-dynamic";

export default async function Editar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> }) {
  const s = await requireSession(); if (!can.editar(s)) redirect("/colaboradores");
  const { id } = await params; const { erro } = await searchParams;
  const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.id, Number(id)));
  if (!emp) notFound();
  return (
    <Page title={emp.nome} sub="Editar cadastro">
      <Flash erro={erro} />
      <EmployeeForm s={s} emp={emp} action={atualizarColaborador} />
    </Page>
  );
}
