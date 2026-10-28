// v26 · aderência com evidências e shortlist sugerida (a decisão é sempre humana e fica registrada)
import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { Card, Btn, Field, Select, Textarea, Input } from "@/components/ui";
import { ETAPA_LABEL } from "@/lib/talento";
import { fmtDataHora } from "@/lib/utils";
import { criteriosParaTexto, VEREDITO_LABEL, DECISAO_LABEL, faixaFit, type Criterio } from "@/lib/recrutamento-fit";
import type { LinhaRanking } from "@/lib/recrutamento-ranking";
import { salvarCriteriosFit, calcularAderencia, decidirShortlist } from "../../fit-actions";

const cor = (s: number | null) => s == null ? "bg-slate-300" : s >= 80 ? "bg-ok" : s >= 60 ? "bg-acao" : s >= 40 ? "bg-aviso" : "bg-erro";
const corV: Record<string, string> = { ATENDE: "text-ok", PARCIAL: "text-aviso", NAO_EVIDENCIADO: "text-slate-500" };
const icone: Record<string, string> = { ATENDE: "✔", PARCIAL: "◐", NAO_EVIDENCIADO: "○" };

export function Aderencia({ rid, criterios, editados, ranking, podeAgir, iaLigada, cfg, etapas }: { rid: number; criterios: Criterio[]; editados: boolean; ranking: LinhaRanking[]; podeAgir: boolean; iaLigada: boolean; cfg: { tamanhoShortlist: number; minimoSugestao: number; usarIA: boolean; pesoObrigatorio: number; pesoDesejavel: number }; etapas: string[] }) {
  const calculados = ranking.filter(r => r.score !== null); const sugeridos = ranking.filter(r => r.sugerido);
  const chave = criterios.map(c => `${c.tipo}:${c.texto}`).sort().join("|"); const desatualizada = (r: LinhaRanking) => !!r.detalhes && r.detalhes.map(d => `${d.tipo}:${d.criterio}`).sort().join("|") !== chave;
  const nDesat = ranking.filter(desatualizada).length;
  return (
    <Card title={<span id="aderencia">Aderência e shortlist sugerida</span>} actions={podeAgir ? <div className="flex flex-wrap gap-1">
      <form action={calcularAderencia}><input type="hidden" name="requisitionId" value={rid} /><input type="hidden" name="modo" value="REGRAS" /><Btn small kind="ghost">Calcular por regras</Btn></form>
      {cfg.usarIA && <form action={calcularAderencia}><input type="hidden" name="requisitionId" value={rid} /><input type="hidden" name="modo" value="IA" /><span title={iaLigada ? "A IA aponta o trecho que comprova cada critério; o sistema confere o trecho e calcula a nota" : "IA não configurada (AI_API_KEY) — o cálculo será feito por regras"}><Btn small>{iaLigada ? "Calcular com IA" : "Calcular com IA (sem chave: regras)"}</Btn></span></form>}
    </div> : undefined}>
      <div className="mb-3 rounded-md bg-mist p-2 text-[11px] leading-relaxed text-slate-600">O sistema <b>sugere</b>, quem decide é você: nenhum candidato muda de etapa sem um clique registrado, e contrariar a sugestão pede uma frase de justificativa. A nota vem dos critérios da vaga (obrigatório pesa {cfg.pesoObrigatorio}, desejável {cfg.pesoDesejavel}) e cada “atende” mostra o trecho do currículo que comprova. Idade, estado civil, filhos, religião, raça/cor, gênero, saúde, deficiência, foto, endereço e documentos são retirados do texto antes da análise.</div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-navy">Critérios{editados ? "" : " (lidos dos requisitos)"}:</span>
        {criterios.length ? criterios.map(c => <span key={c.id} title={`termos: ${c.termos.join(", ")}`} className={`rounded-full border px-2 py-0.5 ${c.tipo === "OBRIGATORIO" ? "border-navy/30 bg-white text-navy" : "border-line bg-white text-slate-600"}`}>{c.tipo === "OBRIGATORIO" ? "●" : "○"} {c.texto}</span>) : <span className="text-erro">nenhum — escreva os requisitos ou cadastre os critérios</span>}
        {podeAgir && <Modal label="Editar critérios" kind="link" title="Critérios de aderência da vaga"><form action={salvarCriteriosFit} className="space-y-2"><input type="hidden" name="requisitionId" value={rid} />
          <p className="text-xs text-slate-600">Um critério por linha. Linhas começando com <b>Desejável:</b> pesam metade. Depois dos dois-pontos, as palavras que comprovam o critério no currículo: <b>vírgula</b> = todas precisam aparecer; <b>barra</b> = qualquer uma serve (professor/docente).</p>
          <Textarea name="criterios" className="min-h-[180px] font-mono !text-xs" defaultValue={criteriosParaTexto(criterios)} placeholder={"Licenciatura em Matemática: licenciatura, matemática\nExperiência em sala de aula: professor/docente/regente\nDesejável: Fundamental II: fundamental ii/6º ano/9º ano"} />
          <p className="text-[11px] text-slate-500">Deixe vazio para voltar a usar o texto dos requisitos da vaga. Depois de salvar, recalcule a aderência.</p><Btn small>Salvar critérios</Btn></form></Modal>}
      </div>
      {ranking.length === 0 ? <p className="text-sm text-slate-500">Nenhum candidato em processo.</p> : <>
        <p className="mb-2 text-xs text-slate-600">{calculados.length} de {ranking.length} candidatura(s) com aderência calculada · <b>{sugeridos.length}</b> sugerida(s) para avançar (até {cfg.tamanhoShortlist}, aderência ≥ {cfg.minimoSugestao}% e todos os obrigatórios comprovados).{nDesat > 0 && <span className="font-medium text-aviso"> {nDesat} calculada(s) com critérios antigos — recalcule.</span>}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line text-left text-xs text-slate-500"><th className="py-1.5 pr-2">#</th><th className="pr-2">Candidato</th><th className="pr-2">Etapa</th><th className="pr-2">Aderência</th><th className="pr-2">Critérios</th><th className="pr-2">Decisão</th></tr></thead>
          <tbody>{ranking.map(r => <tr key={r.application_id} className={`border-b border-line align-top ${r.sugerido ? "bg-[#f3f8fd]" : ""}`}>
            <td className="py-2 pr-2 text-xs text-slate-500">{r.posicao}{r.sugerido && <div className="mt-0.5 whitespace-nowrap rounded bg-acao px-1 text-[10px] font-semibold text-white">sugerido</div>}</td>
            <td className="py-2 pr-2"><Link className="font-medium text-acao" href={`/recrutamento/candidatos/${r.candidate_id}`}>{r.nome}</Link>{!r.tem_texto && <div className="text-[11px] text-aviso">sem currículo em texto</div>}</td>
            <td className="py-2 pr-2 text-xs">{ETAPA_LABEL[r.etapa] ?? r.etapa}</td>
            <td className="py-2 pr-2">{r.score === null ? <span className="text-xs text-slate-500">não calculada</span> : <div className="w-28"><div className="flex items-baseline justify-between"><b className="text-navy">{r.score}%</b><span className="text-[10px] text-slate-500">{faixaFit(r.score)}</span></div>{desatualizada(r) && <div className="text-[10px] font-medium text-aviso">critérios mudaram</div>}<div className="mt-0.5 h-1.5 rounded bg-slate-100"><div className={`h-1.5 rounded ${cor(r.score)}`} style={{ width: `${r.score}%` }} /></div><div className="mt-0.5 text-[10px] text-slate-500">{r.metodo === "IA" ? "IA · trechos conferidos" : "regras"} · {fmtDataHora(r.calculado_em)}</div></div>}</td>
            <td className="py-2 pr-2 text-xs">{r.detalhes ? <details><summary className="cursor-pointer"><span className="text-ok">{r.atende}/{r.total} atendidos</span>{r.faltando ? <span className="text-erro"> · {r.faltando} obrigatório(s) não comprovado(s)</span> : ""}</summary>
              <ul className="mt-1 space-y-1">{r.detalhes.map(d => <li key={d.id}><span className={corV[d.veredito]}>{icone[d.veredito]} {VEREDITO_LABEL[d.veredito]}</span> — <b>{d.criterio}</b>{d.tipo === "DESEJAVEL" ? " (desejável)" : ""}{d.evidencia && <div className="ml-4 border-l-2 border-line pl-2 italic text-slate-600">“{d.evidencia}” <span className="not-italic text-slate-400">· {d.fonte}</span></div>}{d.nota && <div className="ml-4 text-[10px] text-slate-400">{d.nota}</div>}</li>)}</ul>
              {(r.mascarados ?? 0) > 0 && <p className="mt-1 text-[10px] text-slate-400">{r.mascarados} frase(s) com dado sensível retiradas antes da análise.</p>}</details> : "—"}</td>
            <td className="py-2 pr-2 text-xs">{r.decisao && <div className="mb-1 text-slate-600"><b className="font-medium text-navy">{DECISAO_LABEL[r.decisao]}</b><span className="block text-[10px] leading-tight">{r.decisao_nome} · {fmtDataHora(r.decisao_em)}</span></div>}
              {podeAgir && <Modal label="Decidir" title={`Decidir — ${r.nome}`} kind={r.sugerido ? "primary" : "ghost"}><form action={decidirShortlist} className="space-y-2"><input type="hidden" name="applicationId" value={r.application_id} />
                <p className="rounded-md bg-mist p-2 text-xs">{r.score === null ? "Sem aderência calculada." : `Aderência ${r.score}% · ${r.posicao}º da lista · `}{r.sugerido ? <b className="text-acao">o sistema sugere avançar</b> : r.score !== null ? <span>{r.faltando ? "há obrigatório não comprovado" : `abaixo de ${cfg.minimoSugestao}% ou fora dos ${cfg.tamanhoShortlist} primeiros`} — não está entre os sugeridos</span> : null}</p>
                <Field label="Decisão"><Select name="decisao" defaultValue={r.sugerido ? "AVANCAR" : "RESERVAR"}><option value="AVANCAR">Avançar para {ETAPA_LABEL[etapas[etapas.indexOf(r.etapa) + 1]] ?? "a próxima etapa"}</option><option value="RESERVAR">Reservar (fica no banco de talentos)</option><option value="REPROVAR">Reprovar</option></Select></Field>
                <Field label="Motivo (se reprovar)"><Input name="motivo" placeholder="ex.: sem a formação exigida" /></Field>
                <Field label={r.sugerido ? "Justificativa (obrigatória se reprovar)" : "Justificativa (obrigatória se avançar)"}><Textarea name="justificativa" className="min-h-[50px]" placeholder="Uma frase — fica registrada na linha do tempo da vaga" /></Field>
                <Btn small>Registrar decisão</Btn></form></Modal>}</td>
          </tr>)}</tbody></table></div></>}
    </Card>
  );
}
