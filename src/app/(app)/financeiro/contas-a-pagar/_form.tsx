"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { gerarParcelas, lerValorBr, somaCentavos, fmtBr, fmtDataBr, INTERVALO_LABEL, motivoAjuste, diaDaSemana, proximoDiaUtil, type Intervalo, type OpcoesFeriado, type ParcelaGerada } from "@/lib/parcelas";
import { lerBoleto, lerChaveNFe } from "@/lib/documentos-fiscais";

/**
 * v27 · Formulário de conta a pagar (estilo XFIN): dados do documento + regra das parcelas → tabela gerada na hora,
 * editável (emissão, vencimento, competência e valor) antes de salvar. Lê a linha digitável do boleto e a chave da NF-e (DVs conferidos)
 * e preenche valor, vencimento e número. O servidor confere tudo de novo (soma, datas, alçada, orçamento, duplicidade, boleto e nota).
 */
export type OpcoesCP = {
  units: { id: number; nome: string; company_id: number | null }[]; podeRede: boolean;
  entidades: { id: number; nome: string; cnpj: string | null }[]; responsaveis: { id: number; nome: string }[];
  fornecedores: { id: number; nome: string }[];
  contratos: { id: number; supplier_id: number; fornecedor: string; objeto: string; valor_mensal: number | null; unit_id: number | null }[];
  categorias: string[]; tipos: string[]; alcada: number; aprova: boolean; feriados: OpcoesFeriado; hoje: string;
  naturezas: { codigo: string; rotulo: string; dica: string }[]; naturezasAprovam: string[];
  // v28 · plano de contas (analíticas de despesa por macrogrupo) e centros de custo
  contas: { grupo: string; contas: { id: number; codigo: string; nome: string; categoria: string | null; economico: string; centro: string; generica: boolean }[] }[];
  centros: { id: number; codigo: string; nome: string; tipo: string; unit_id: number | null }[]; exigirConta: boolean;
};
export type InicialCP = {
  unitId: string; supplierId: string; fornecedorNovo: string; contractId: string; categoria: string; tipoDocumento: string; numeroDocumento: string; emissao: string; descricao: string;
  recorrente: boolean; valor: string; parcelas: string; intervalo: Intervalo; dias: string; primeiroVencimento: string; ajustarDiaUtil: boolean; obs: string;
  companyId: string; responsavelId: string; boleto: string; chaveNfe: string; natureza: string; contaId: string; centroId: string;
};
type Linha = { parcela: number; emissao: string; vencimento: string; competencia: string; valorTxt: string; orig: string; ajustada: boolean };
const fmtNum = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paraLinha = (p: ParcelaGerada): Linha => ({ parcela: p.parcela, emissao: p.emissao, vencimento: p.vencimento, competencia: p.emissao.slice(0, 7), valorTxt: fmtNum(p.valor), orig: p.vencimentoOriginal, ajustada: p.ajustada });
const CHAVE = "one:cp-rascunho";
const GHOST = "inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-mist focus:outline-none focus-visible:ring-2 focus-visible:ring-acao/60";

export function FormContaPagar({ o, ini, action, erro }: { o: OpcoesCP; ini: InicialCP; action: (fd: FormData) => Promise<void>; erro: boolean }) {
  const [f, setF] = useState<InicialCP>(ini);
  const set = <K extends keyof InicialCP>(k: K, v: InicialCP[K]) => setF(x => ({ ...x, [k]: v }));
  const [cadastrar, setCadastrar] = useState(true); const [dupOk, setDupOk] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const valor = lerValorBr(f.valor); const n = Math.max(1, Math.min(240, Math.floor(Number(f.parcelas) || 1)));
  const chaveGen = JSON.stringify([valor, n, f.recorrente, f.primeiroVencimento, f.emissao, f.intervalo, f.dias, f.ajustarDiaUtil]);
  const gen = useMemo(() => gerarParcelas({ valor, parcelas: n, recorrente: f.recorrente, primeiroVencimento: f.primeiroVencimento, emissao: f.emissao, intervalo: f.intervalo, dias: Number(f.dias) || 30, ajustarDiaUtil: f.ajustarDiaUtil, feriados: o.feriados }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chaveGen]);
  const [linhas, setLinhas] = useState<Linha[]>(() => gen.map(paraLinha)); const [editada, setEditada] = useState(false);
  const restaurar = useRef<{ chave: string; linhas: Linha[] } | null>(null);
  useEffect(() => {
    if (restaurar.current && restaurar.current.chave === chaveGen) { setLinhas(restaurar.current.linhas); setEditada(true); restaurar.current = null; return; }
    restaurar.current = null; setLinhas(gen.map(paraLinha)); setEditada(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);
  // depois de um erro do servidor, volta exatamente o que a pessoa tinha preenchido (inclusive a tabela editada)
  useEffect(() => {
    try {
      if (!erro) { sessionStorage.removeItem(CHAVE); return; }
      const r = sessionStorage.getItem(CHAVE); if (!r) return; const d = JSON.parse(r) as { f: InicialCP; linhas: Linha[]; cadastrar: boolean };
      const k = JSON.stringify([lerValorBr(d.f.valor), Math.max(1, Math.min(240, Math.floor(Number(d.f.parcelas) || 1))), d.f.recorrente, d.f.primeiroVencimento, d.f.emissao, d.f.intervalo, d.f.dias, d.f.ajustarDiaUtil]);
      restaurar.current = { chave: k, linhas: d.linhas }; setF(d.f); setLinhas(d.linhas); setEditada(true); setCadastrar(d.cadastrar !== false);
    } catch { /* navegador sem armazenamento: segue com o formulário limpo */ }
  }, [erro]);

  const valores = linhas.map(l => lerValorBr(l.valorTxt)); const invalidas = valores.filter(v => !(v > 0)).length;
  const soma = somaCentavos(valores.filter(v => v > 0)); const dif = f.recorrente ? 0 : Math.round((valor - soma) * 100) / 100;
  const ajustadas = linhas.filter(l => l.vencimento !== l.orig).length;
  const contratos = o.contratos.filter(c => !f.supplierId || f.supplierId === "novo" || String(c.supplier_id) === f.supplierId);
  const vaiAprovar = !o.aprova && o.alcada > 0 && soma >= o.alcada - 0.005;
  const natSel = o.naturezas.find(x => x.codigo === f.natureza); const naturezaAprova = !o.aprova && o.naturezasAprovam.includes(f.natureza);
  // v28 · conta do plano: a categoria vem dela; investimento (CAPEX) puxa a natureza; o centro padrão segue a conta e a unidade
  const todasContas = o.contas.flatMap(g => g.contas.map(c => ({ ...c, grupo: g.grupo }))); const contaSel = todasContas.find(c => String(c.id) === f.contaId);
  const [centroAuto, setCentroAuto] = useState(!ini.centroId);
  const centroPadrao = (contaId: string, unitId: string) => { const c = todasContas.find(x => String(x.id) === contaId); if (!c) return "";
    const corp = o.centros.find(x => x.tipo === "CORPORATIVO"); if (c.centro === "CORPORATIVO" || !unitId) return corp ? String(corp.id) : "";
    const geral = o.centros.find(x => x.tipo === "UNIDADE" && String(x.unit_id) === unitId); return geral ? String(geral.id) : ""; };
  const escolherConta = (id: string) => { const c = todasContas.find(x => String(x.id) === id);
    setF(x => ({ ...x, contaId: id, categoria: c?.categoria ?? x.categoria, natureza: c?.economico === "CAPEX" ? "INVESTIMENTO" : x.natureza === "INVESTIMENTO" && c ? "OPERACAO" : x.natureza, centroId: centroAuto ? centroPadrao(id, x.unitId) : x.centroId })); };
  const centrosDaUnidade = o.centros.filter(c => !f.unitId || c.unit_id === null || String(c.unit_id) === f.unitId);
  const mudaLinha = (i: number, k: "vencimento" | "emissao" | "valorTxt" | "competencia", v: string) => { setLinhas(ls => ls.map((l, j) => j === i ? { ...l, [k]: v, ...(k === "emissao" && /^\d{4}-\d{2}/.test(v) && l.competencia === l.emissao.slice(0, 7) ? { competencia: v.slice(0, 7) } : {}) } : l)); setEditada(true); };
  // boleto e nota: leitura local dos dígitos (o servidor confere de novo)
  const bol = f.boleto.trim() ? lerBoleto(f.boleto, o.hoje) : null; const nfe = f.chaveNfe.trim() ? lerChaveNFe(f.chaveNfe) : null;
  const aplicarBoleto = (forcar: boolean) => { if (!bol?.ok) return; setF(x => ({ ...x, tipoDocumento: o.tipos.includes("Boleto") && (forcar || !x.numeroDocumento) ? "Boleto" : x.tipoDocumento, valor: bol.valor && (forcar || !x.valor) ? fmtNum(bol.valor) : x.valor, primeiroVencimento: bol.vencimento && (forcar || !x.primeiroVencimento) ? bol.vencimento : x.primeiroVencimento })); };
  const ultimoBoleto = useRef(""); useEffect(() => { if (bol?.ok && bol.linha !== ultimoBoleto.current) { ultimoBoleto.current = bol.linha; aplicarBoleto(false); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bol?.ok ? bol.linha : ""]);
  const ultimaNota = useRef(""); useEffect(() => { if (nfe?.ok && nfe.chave !== ultimaNota.current) { ultimaNota.current = nfe.chave; setF(x => ({ ...x, numeroDocumento: x.numeroDocumento || String(nfe.numero) })); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfe?.ok ? nfe.chave : ""]);
  const p1 = linhas[0]; const bolValorDif = bol?.ok && bol.valor !== null && p1 && Math.abs(bol.valor - lerValorBr(p1.valorTxt)) >= 0.005;
  const bolVencDif = bol?.ok && bol.vencimento && p1 && bol.vencimento !== p1.vencimento && proximoDiaUtil(bol.vencimento, o.feriados) !== p1.vencimento;
  const unidadeSel = o.units.find(u => String(u.id) === f.unitId); const entidadeDaUnidade = unidadeSel ? o.entidades.find(x => x.id === unidadeSel.company_id) : null;
  const escolherContrato = (id: string) => {
    set("contractId", id); const c = o.contratos.find(x => String(x.id) === id); if (!c) return;
    setF(x => ({ ...x, contractId: id, supplierId: String(c.supplier_id), descricao: x.descricao || c.objeto.slice(0, 300), valor: x.valor || (c.valor_mensal ? fmtNum(c.valor_mensal) : ""), recorrente: c.valor_mensal ? true : x.recorrente, intervalo: c.valor_mensal ? "MENSAL" : x.intervalo, unitId: c.unit_id ? String(c.unit_id) : x.unitId }));
  };
  const jogarDiferenca = () => { if (!linhas.length || !dif) return; const u = linhas.length - 1; const novo = Math.round((lerValorBr(linhas[u].valorTxt) + dif) * 100) / 100; if (novo > 0) mudaLinha(u, "valorTxt", fmtNum(novo)); };
  const enviar = (e: FormEvent<HTMLFormElement>) => {
    setMsg(null);
    const falha = !f.unitId && o.entidades.length && !f.companyId ? "Conta da rede: escolha a entidade (CNPJ) que paga." : bol && !bol.ok ? `Boleto: ${bol.erro}` : bolValorDif ? "O valor do boleto é diferente da 1ª parcela — confira." : bolVencDif ? "O vencimento do boleto é diferente do da 1ª parcela — use “aplicar do boleto”." : nfe && !nfe.ok ? `Chave da NF-e: ${nfe.erro}` : !f.supplierId ? "Escolha o fornecedor (ou cadastre um novo)." : f.supplierId === "novo" && f.fornecedorNovo.trim().length < 2 ? "Informe o nome do novo fornecedor."
      : !linhas.length ? "Preencha o valor, a quantidade e o 1º vencimento para gerar as parcelas." : invalidas ? `${invalidas} parcela(s) com valor inválido.`
      : linhas.some(l => !/^\d{4}-\d{2}-\d{2}$/.test(l.vencimento)) ? "Há parcela sem vencimento." : !f.recorrente && Math.abs(dif) >= 0.005 ? `A soma das parcelas (${fmtBr(soma)}) não bate com o valor total (${fmtBr(valor)}) — use “jogar a diferença na última”.` : null;
    if (falha) { e.preventDefault(); setMsg(falha); return; }
    try { sessionStorage.setItem(CHAVE, JSON.stringify({ f, linhas, cadastrar })); } catch { /* sem armazenamento */ }
  };
  const json = JSON.stringify(linhas.map((l, i) => ({ parcela: i + 1, emissao: l.emissao, vencimento: l.vencimento, competencia: l.competencia, valor: valores[i] })));

  return (
    <form action={action} onSubmit={enviar} className="space-y-4">
      <input type="hidden" name="parcelasJson" value={json} />
      <input type="hidden" name="cadastrar" value={cadastrar ? "1" : ""} />
      <section className="rounded-md border border-line bg-white">
        <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-navy">Documento</h2>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Unidade" hint={entidadeDaUnidade ? `${entidadeDaUnidade.nome}${entidadeDaUnidade.cnpj ? ` · CNPJ ${entidadeDaUnidade.cnpj}` : ""}` : undefined}><Select name="unitId" value={f.unitId} onChange={e => { const v = e.target.value; setF(x => ({ ...x, unitId: v, centroId: centroAuto ? centroPadrao(x.contaId, v) : x.centroId })); }}>{o.podeRede && <option value="">Rede (corporativo)</option>}{o.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
          {!f.unitId && o.entidades.length > 0 && <Field label="Entidade (CNPJ) que paga" hint="Conta da rede: os registros fiscais de cada CNPJ não se misturam."><Select name="companyId" value={f.companyId} onChange={e => set("companyId", e.target.value)} required><option value="">— escolha —</option>{o.entidades.map(x => <option key={x.id} value={x.id}>{x.nome}{x.cnpj ? ` · ${x.cnpj}` : ""}</option>)}</Select></Field>}
          <Field label="Fornecedor" className="lg:col-span-2"><Select name="supplierId" value={f.supplierId} onChange={e => setF(x => ({ ...x, supplierId: e.target.value, contractId: x.contractId && o.contratos.find(c => String(c.id) === x.contractId)?.supplier_id !== Number(e.target.value) ? "" : x.contractId }))} required>
            <option value="">— escolha —</option>{o.fornecedores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}<option value="novo">+ Novo fornecedor…</option></Select></Field>
          <Field label="Contrato (opcional)" hint={contratos.length ? "Preenche descrição, valor mensal e recorrência." : "Nenhum contrato vigente deste fornecedor."}><Select name="contractId" value={f.contractId} onChange={e => escolherContrato(e.target.value)}><option value="">— sem contrato —</option>{contratos.map(c => <option key={c.id} value={c.id}>{c.objeto.slice(0, 60)}{c.valor_mensal ? ` · ${fmtBr(c.valor_mensal)}/mês` : ""}</option>)}</Select></Field>
          {f.supplierId === "novo" && <div className="grid grid-cols-1 gap-2 sm:col-span-2 lg:col-span-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="Nome do novo fornecedor"><Input name="fornecedorNovo" value={f.fornecedorNovo} onChange={e => set("fornecedorNovo", e.target.value)} maxLength={160} placeholder="Razão social ou nome" /></Field>
            <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={cadastrar} onChange={e => setCadastrar(e.target.checked)} /> Cadastrar em Fornecedores</label></div>}
          <Field label="Conta do plano de contas" className="sm:col-span-2" hint={contaSel ? `${contaSel.grupo} · categoria ${contaSel.categoria}${contaSel.economico === "CAPEX" ? " · investimento (CAPEX)" : contaSel.economico === "DIVIDA" ? " · serviço da dívida" : contaSel.economico === "ADIANTAMENTO" ? " · adiantamento (fora da DRE)" : ""}${contaSel.generica ? " · conta genérica: prefira a específica" : ""}` : "A categoria do caixa, da DRE e do orçamento vem da conta."}>
            <Select name="contaId" value={f.contaId} onChange={e => escolherConta(e.target.value)} required={o.exigirConta}><option value="">— escolha a conta —</option>{o.contas.map(g => <optgroup key={g.grupo} label={g.grupo}>{g.contas.map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}</optgroup>)}</Select></Field>
          {!o.exigirConta && !f.contaId && <Field label="Categoria (sem conta)"><Select name="categoria" value={f.categoria} onChange={e => set("categoria", e.target.value)} required><option value="">— escolha —</option>{o.categorias.map(c => <option key={c} value={c}>{c}</option>)}</Select></Field>}
          <Field label="Natureza" hint={natSel ? `${natSel.dica}${o.naturezasAprovam.includes(natSel.codigo) ? " · sempre passa pela aprovação" : ""}` : undefined}><Select name="natureza" value={f.natureza} onChange={e => set("natureza", e.target.value)}>{o.naturezas.map(x => <option key={x.codigo} value={x.codigo}>{x.rotulo}</option>)}</Select></Field>
          <Field label="Centro de custo" hint={f.centroId && centroAuto ? "padrão da conta (troque se outro centro consome)" : "quem consome ou responde pelo gasto"}><Select name="centroId" value={f.centroId} onChange={e => { setCentroAuto(false); set("centroId", e.target.value); }}><option value="">— a unidade que paga —</option>{centrosDaUnidade.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}</Select></Field>
          <Field label="Tipo do documento"><Select name="tipoDocumento" value={f.tipoDocumento} onChange={e => set("tipoDocumento", e.target.value)}>{o.tipos.map(t => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Número do documento"><Input name="numeroDocumento" value={f.numeroDocumento} onChange={e => set("numeroDocumento", e.target.value)} maxLength={60} placeholder="Nota, boleto, fatura…" /></Field>
          <Field label="Data de emissão"><Input name="emissao" type="date" value={f.emissao} onChange={e => set("emissao", e.target.value)} required /></Field>
          <Field label="Responsável pela despesa"><Select name="responsavelId" value={f.responsavelId} onChange={e => set("responsavelId", e.target.value)}>{o.responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></Field>
          <Field label="Descrição" className="sm:col-span-2 lg:col-span-4"><Input name="descricao" value={f.descricao} onChange={e => set("descricao", e.target.value)} maxLength={300} required placeholder="Ex.: ALUGUEL" /></Field>
          <div className="sm:col-span-2"><Field label="Linha digitável do boleto (1ª parcela, opcional)" hint="Cole os 47 dígitos (ou 48 de conta de consumo): confere os dígitos verificadores e preenche valor e vencimento."><Input name="boleto" value={f.boleto} onChange={e => set("boleto", e.target.value)} inputMode="numeric" placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000" className="font-mono text-xs" /></Field>
            {bol && (bol.ok ? <p className="mt-1 text-xs text-ok">✓ {bol.tipo === "BANCARIO" ? `Boleto ${bol.bancoNome ?? `banco ${bol.banco}`}` : `Arrecadação · ${bol.segmento ?? "conta de consumo/tributo"}`}{bol.valor ? ` · ${fmtBr(bol.valor)}` : ""}{bol.vencimento ? ` · vence ${fmtDataBr(bol.vencimento)}` : ""} · dígitos conferidos {(bolValorDif || bolVencDif) && <button type="button" className="ml-1 text-acao underline" onClick={() => aplicarBoleto(true)}>aplicar do boleto</button>}</p>
              : <p className="mt-1 text-xs text-erro">{bol.erro}</p>)}</div>
          <div className="sm:col-span-2"><Field label="Chave de acesso da NF-e (opcional)" hint="44 posições: confere o dígito verificador e bloqueia a mesma nota em dois títulos."><Input name="chaveNfe" value={f.chaveNfe} onChange={e => set("chaveNfe", e.target.value)} placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" className="font-mono text-xs" /></Field>
            {nfe && (nfe.ok ? <p className="mt-1 text-xs text-ok">✓ {nfe.modeloNome} nº {nfe.numero.toLocaleString("pt-BR")} série {nfe.serie} · emitente {nfe.cnpjFormatado} · {nfe.uf} · {nfe.anoMes.split("-").reverse().join("/")}</p> : <p className="mt-1 text-xs text-erro">{nfe.erro}</p>)}</div>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white">
        <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-navy">Parcelas</h2>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <fieldset className="text-sm"><legend className="mb-1 font-medium text-slate-700">Recorrente</legend>
            <div className="flex gap-3 py-2"><label className="flex items-center gap-1.5"><input type="radio" name="recorrente" value="1" checked={f.recorrente} onChange={() => set("recorrente", true)} /> Sim</label><label className="flex items-center gap-1.5"><input type="radio" name="recorrente" value="0" checked={!f.recorrente} onChange={() => set("recorrente", false)} /> Não</label></div>
            <span className="block text-xs text-slate-500">{f.recorrente ? "Cada parcela tem o valor informado." : "O valor total é dividido nas parcelas."}</span></fieldset>
          <Field label={f.recorrente ? "Valor de cada parcela" : "Valor total"}><Input name="valor" inputMode="decimal" value={f.valor} onChange={e => set("valor", e.target.value)} onBlur={() => { if (valor > 0) set("valor", fmtNum(valor)); }} required placeholder="0,00" /></Field>
          <Field label="Quantidade de parcelas"><Input name="parcelas" type="number" min={1} max={240} value={f.parcelas} onChange={e => set("parcelas", e.target.value)} required /></Field>
          <Field label="Dia do primeiro vencimento"><Input name="primeiroVencimento" type="date" value={f.primeiroVencimento} onChange={e => set("primeiroVencimento", e.target.value)} required /></Field>
          <Field label="Intervalo"><Select name="intervalo" value={f.intervalo} onChange={e => set("intervalo", e.target.value as Intervalo)}>{(Object.keys(INTERVALO_LABEL) as Intervalo[]).map(k => <option key={k} value={k}>{INTERVALO_LABEL[k]}</option>)}</Select></Field>
          {f.intervalo === "DIAS" && <Field label="A cada (dias)"><Input name="dias" type="number" min={1} max={365} value={f.dias} onChange={e => set("dias", e.target.value)} /></Field>}
          <label className="flex items-start gap-1.5 text-xs sm:col-span-2 lg:col-span-5"><input type="checkbox" name="ajustarDiaUtil" value="1" checked={f.ajustarDiaUtil} onChange={e => set("ajustarDiaUtil", e.target.checked)} className="mt-0.5" /> <span>Vencimento em sábado, domingo ou feriado bancário vai para o próximo dia útil (feriados nacionais, de MS e de Campo Grande{o.feriados.carnaval !== false ? ", Carnaval" : ""}{o.feriados.corpusChristi !== false ? ", Corpus Christi" : ""}). O dia-âncora se mantém: 30/01 → 28 ou 29/02 → 30/03.</span></label>
        </div>
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-mist px-3 py-2 text-sm">
          <span><b>{fmtBr(soma)}</b> de compromisso em <b>{linhas.length}</b> parcela(s){linhas.length ? <> · {fmtDataBr(linhas[0].vencimento)} a {fmtDataBr(linhas[linhas.length - 1].vencimento)}</> : null}</span>
          {ajustadas > 0 && <span className="text-xs text-slate-600">{ajustadas} vencimento(s) levado(s) para dia útil</span>}
          {vaiAprovar ? <span className="text-xs font-medium text-aviso">Vai para aprovação: compromisso a partir de {fmtBr(o.alcada)}.</span> : naturezaAprova ? <span className="text-xs font-medium text-aviso">Vai para aprovação: {natSel?.rotulo.toLowerCase()} sempre passa pela alçada.</span> : o.aprova && soma >= o.alcada && o.alcada > 0 ? <span className="text-xs text-ok">Você tem a alçada: o título já nasce aprovado.</span> : null}
          <span className="text-xs text-slate-500">O orçamento da categoria em cada mês é conferido ao salvar.</span>
        </div>
        <div className="mx-4 mb-4 overflow-x-auto rounded-md border border-line [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[42rem] text-left text-xs sm:text-sm">
            <thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-2 font-medium">Parcela</th><th className="px-2 py-2 font-medium">Vencimento</th><th className="px-2 py-2 font-medium">Valor (R$)</th><th className="px-2 py-2 font-medium">Emissão</th><th className="px-2 py-2 font-medium">Competência</th><th className="px-2 py-2 font-medium">Observação</th></tr></thead>
            <tbody className="divide-y divide-line">
              {linhas.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Informe valor, quantidade e o dia do 1º vencimento para gerar as parcelas.</td></tr> : linhas.map((l, i) => <tr key={i}>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{i + 1}/{linhas.length}</td>
                <td className="px-2 py-1.5"><input type="date" aria-label={`Vencimento da parcela ${i + 1}`} value={l.vencimento} onChange={e => mudaLinha(i, "vencimento", e.target.value)} className="w-[7.75rem] rounded border border-line px-1.5 py-1 text-xs sm:w-[9.5rem]" /></td>
                <td className="px-2 py-1.5"><input inputMode="decimal" aria-label={`Valor da parcela ${i + 1}`} value={l.valorTxt} onChange={e => mudaLinha(i, "valorTxt", e.target.value)} onBlur={() => { const v = lerValorBr(l.valorTxt); if (v > 0) mudaLinha(i, "valorTxt", fmtNum(v)); }} className={`w-[6.5rem] rounded border px-1.5 py-1 text-right text-xs tabular-nums sm:w-[7.5rem] ${valores[i] > 0 ? "border-line" : "border-erro"}`} /></td>
                <td className="px-2 py-1.5"><input type="date" aria-label={`Emissão da parcela ${i + 1}`} value={l.emissao} onChange={e => mudaLinha(i, "emissao", e.target.value)} className="w-[7.75rem] rounded border border-line px-1.5 py-1 text-xs sm:w-[9.5rem]" /></td>
                <td className="px-2 py-1.5"><input type="month" aria-label={`Competência da parcela ${i + 1}`} value={l.competencia} onChange={e => mudaLinha(i, "competencia", e.target.value)} className="w-[9.75rem] rounded border border-line px-1.5 py-1 text-xs" /></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-slate-500">{l.vencimento !== l.orig ? (l.ajustada && l.vencimento === gen[i]?.vencimento ? `${fmtDataBr(l.orig)} cai em ${motivoAjuste(l.orig, o.feriados)} → ${diaDaSemana(l.vencimento)}` : `alterado (era ${fmtDataBr(l.orig)})`) : ""}</td>
              </tr>)}
            </tbody>
            {linhas.length > 0 && <tfoot className="bg-mist text-xs"><tr><td colSpan={2} className="px-2 py-2 text-right font-medium">Soma das parcelas</td><td className={`px-2 py-2 text-right font-semibold tabular-nums ${Math.abs(dif) >= 0.005 ? "text-erro" : ""}`}>{fmtNum(soma)}</td><td colSpan={3} className="px-2 py-2">{!f.recorrente && Math.abs(dif) >= 0.005 ? <span className="text-erro">diferença de {fmtBr(Math.abs(dif))} para o total</span> : <span className="text-ok">{f.recorrente ? "recorrente" : "bate com o total"}</span>}</td></tr></tfoot>}
          </table>
        </div>
        <div className="mx-4 mb-4 flex flex-wrap gap-2">
          <button type="button" className={GHOST} onClick={() => { setLinhas(gen.map(paraLinha)); setEditada(false); }}>Gerar de novo</button>
          {!f.recorrente && Math.abs(dif) >= 0.005 && <button type="button" className={GHOST} onClick={jogarDiferenca}>Jogar a diferença na última parcela</button>}
          {editada && <span className="self-center text-[11px] text-slate-500">Tabela editada à mão — mudar valor, quantidade, datas ou intervalo gera de novo.</span>}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4">
        <Field label="Observações (opcional)"><Textarea name="obs" value={f.obs} onChange={e => set("obs", e.target.value)} maxLength={2000} className="min-h-[60px]" /></Field>
        <label className="mt-2 flex items-center gap-1.5 text-xs"><input type="checkbox" name="duplicadoOk" value="1" checked={dupOk} onChange={e => setDupOk(e.target.checked)} /> Não é duplicado (mesmo fornecedor e documento já lançados de propósito)</label>
        {msg && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro" role="alert">{msg}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2"><Btn pendingText="Salvando…">Salvar conta a pagar</Btn><span className="text-xs text-slate-500">Baixa só com o débito do extrato; tudo fica na trilha de auditoria.</span></div>
      </section>
    </form>
  );
}
