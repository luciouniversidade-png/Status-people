import { redirect } from "next/navigation";
import { requireMatriculas, can } from "@/lib/auth";
import { Page, Flash, Card } from "@/components/ui";
import { AlunoForm } from "../AlunoForm";
export const dynamic = "force-dynamic";
export default async function Novo({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireMatriculas(); if (!can.reservar(s)) redirect("/matriculas/alunos");
  const { erro } = await searchParams;
  return <Page title="Novo aluno / candidato"><Flash erro={erro} /><Card><AlunoForm /></Card></Page>;
}
