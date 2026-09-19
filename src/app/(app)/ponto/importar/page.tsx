import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireStaff, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { fmtMin, hoje } from "@/lib/utils";
import { PONTO_LABEL } from "@/lib/ponto";
import type { ArquivoLido } from "@/lib/ponto-import";
import { importarPlanilhas, aplicarImportacao, descartarImportacao } from "../actions";

export const dynamic = "force-dynamic";
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export default async function Importar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!can.editar(s)) redirect("/ponto");
  const sp = await searchParams; const loteId = sp.lote ? Number(sp.lote) : null;
  if (loteId) {
    const [lote] = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, loteId)); if (!lote) redirect("/ponto/importar");
    const payload = lote.payload as { ano: number; arquivos: ArquivoLido[] };
    const emps = await sql<{ id: number; nome: string; unidade: string }[]>`SELECT e.id, e.nome, u.nome AS unidade FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao <> 'DESLIGADO' ORDER BY e.nome`;
    const sugerir = (nome: string) => { const n = norm(nome); return emps.find(e => norm(e.nome) === n) ?? emps.filter(e => norm(e.nome).startsWith(n) || n.startsWith(norm(e.nome))).length === 1 ? (emps.find(e => norm(e.nome) === n) ?? emps.filter(e => norm(e.nome).startsWith(n) || n.startsWith(norm(e.nome)))[0]) : undefined; };
    return (
      <Page title="Prévia da importação" sub={`Lote #${loteId} · ano ${payload.ano} · ${payload.arquivos.length} arquivo(s). Nada foi gravado ainda: confira, escolha o colaborador de cada planilha e confirme.`}>
        <Flash ok={sp.ok} erro={sp.erro} />
        {lote.status !== "PREVIA" && <Card className="mb-4"><p className="text-sm">Este lote já foi {lote.status === "APLICADO" ? "aplicado" : "descartado"}.</p></Card>}
        <form action={aplicarImportacao}><input type="hidden" name="lote" value={loteId} />
          <Table head={["Arquivo", "Colaborador no sistema", "Abas lidas", "Dias", "Saldo calculado", "Saldo na planilha", "Situações", "Avisos"]}>
            {payload.arquivos.map((a, i) => { const sug = sugerir(a.nomePlanilha); const cont: Record<string, number> = {}; a.dias.forEach(d => { cont[d.status] = (cont[d.status] ?? 0) + 1; }); return (
              <tr key={i} className={a.dias.length === 0 ? "opacity-60" : ""}>
                <Td><div className="font-medium">{a.arquivo}</div><div className="text-xs text-slate-500">nome lido: {a.nomePlanilha}</div></Td>
                <Td><Select name={`emp_${i}`} defaultValue={sug?.id ?? ""} className="!w-56 !py-1 !text-xs" disabled={lote.status !== "PREVIA"}><option value="">— não importar —</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome} · {e.unidade}</option>)}</Select>{!sug && a.dias.length > 0 && <div className="text-xs text-aviso">sem correspondência automática</div>}</Td>
                <Td className="text-xs">{a.abas.join(", ") || "—"}</Td><Td>{a.dias.length}</Td>
                <Td className={`tabular-nums ${a.saldoCalculado < 0 ? "text-erro" : "text-ok"}`}>{a.dias.length ? fmtMin(a.saldoCalculado) : "—"}</Td>
                <Td className="tabular-nums">{a.saldoPlanilha === null ? <span className="text-slate-400">não lido</span> : <span className={a.saldoPlanilha === a.saldoCalculado ? "text-ok" : "text-aviso"}>{fmtMin(a.saldoPlanilha)} {a.saldoPlanilha === a.saldoCalculado ? "✓" : "≠"}</span>}</Td>
                <Td className="text-xs">{Object.entries(cont).filter(([k]) => k !== "NORMAL" && k !== "DSR").map(([k, n]) => `${n} ${PONTO_LABEL[k].toLowerCase()}`).join(" · ") || "—"}</Td>
                <Td className="max-w-[260px] text-xs text-aviso">{a.avisos.join(" ")}</Td>
              </tr>); })}
          </Table>
          {lote.status === "PREVIA" && <div className="mt-4 flex flex-wrap gap-2"><Btn>Aplicar importação</Btn><Btn kind="ghost" danger formAction={descartarImportacao}>Descartar lote</Btn><span className="text-xs text-slate-500">Aplicar grava os dias na folha de ponto (origem “importado”) e gera os lançamentos do banco; dias já existentes são sobrescritos.</span></div>}
        </form>
      </Page>
    );
  }
  return (
    <Page title="Importar planilhas de ponto" sub="Lê as planilhas de banco de horas (abas JANEIRO…DEZEMBRO) e mostra uma prévia antes de gravar.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <form action={importarPlanilhas} className="space-y-3" encType="multipart/form-data">
          <Field label="Ano das planilhas"><Input name="ano" type="number" defaultValue={Number(hoje().slice(0, 4))} className="w-28" /></Field>
          <Field label="Arquivos .xlsx (até 40 por vez)"><input type="file" name="arquivos" accept=".xlsx,.xlsm" multiple required className="block text-sm" /></Field>
          <Btn>Ler planilhas</Btn>
        </form>
        <Card title="O que é lido"><ul className="space-y-2 text-sm text-slate-700">
          <li>O nome do colaborador vem do nome do arquivo (ex.: <i>MARIA SILVA_REVISADO_2026.xlsx</i>) e é casado com o cadastro; você confirma na prévia.</li>
          <li>Em cada aba de mês: data/dia, CH (carga), TRABALHADOS, POSITIVO/NEGATIVO (avulsos) e OBS (rótulos como FÉRIAS, FERIADO, DSR, RECESSO, ATEST, BC_FOLG, DISP).</li>
          <li>O saldo final da aba GERAL é comparado com o calculado — se divergir, aparece um aviso.</li>
          <li>Nada é gravado até você clicar em <b>Aplicar</b>. Modelo antigo (aba PONTO sem coluna SALDO) ainda não é lido.</li>
        </ul></Card>
      </div>
    </Page>
  );
}
