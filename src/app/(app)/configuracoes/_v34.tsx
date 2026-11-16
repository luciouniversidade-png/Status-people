import { Card, Field, Input, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { salvarParametrosV34 } from "./v34-actions";

/** Configurações da v34: assinaturas, ficha cadastral, Meu espaço, termômetro, escalas e estoque. */
export async function ParametrosV34() {
  const c = await getSettings(); const a = c.assinaturas, k = c.cadastro, m = c.meuEspaco, t = c.termometro, e = c.escalas, st = c.estoque;
  const chk = (nome: string, v: boolean, rot: string) => <label className="flex items-start gap-1.5 text-xs"><input type="checkbox" name={nome} value="1" defaultChecked={v} className="mt-0.5" /> {rot}</label>;
  return (
    <Card title="Autoatendimento e documentos (v34) — assinatura, cadastro, termômetro, escalas e estoque" className="mb-4"><div id="v34" />
      <details className="rounded-md border border-line bg-white"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">Parâmetros</summary>
        <form action={salvarParametrosV34} className="space-y-3 border-t border-line p-3">
          <fieldset className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Assinatura eletrônica</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Prazo padrão para assinar (dias)"><Input name="prazoDias" defaultValue={a.prazoDias} /></Field><Field label="Prazo do espelho do ponto (dias)"><Input name="espelhoPrazoDias" defaultValue={a.espelhoPrazoDias} /></Field><Field label="Lembrete antes do prazo (dias)"><Input name="lembreteDiasAntes" defaultValue={a.lembreteDiasAntes} /></Field></div></fieldset>
          <fieldset className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Ficha cadastral pelo link e pedidos do Meu espaço</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Validade do link (dias)"><Input name="conviteDias" defaultValue={k.conviteDias} /></Field><Field label="Envios por link"><Input name="maxEnviosAdmissao" defaultValue={k.maxEnviosAdmissao} /></Field><Field label="Pedidos abertos por pessoa"><Input name="maxPedidosAbertos" defaultValue={k.maxPedidosAbertos} /></Field></div></fieldset>
          <fieldset className="space-y-1.5 rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Meu espaço</legend>
            {chk("permitirAjustePonto", m.permitirAjustePonto !== false, "Pedir ajuste de ponto pelo Meu espaço")}{chk("permitirAtestado", m.permitirAtestado !== false, "Enviar atestado pelo Meu espaço (foto ou PDF, sem CID)")}{chk("mostrarEvolucaoSalarial", m.mostrarEvolucaoSalarial !== false, "Mostrar a evolução salarial da própria pessoa (valores escondidos até ela tocar)")}{chk("mostrarAniversariantes", m.mostrarAniversariantes !== false, "Mostrar aniversariantes da unidade e permitir dar parabéns (só dia e mês)")}
            <Field label="Ajuste de ponto: até quantos dias atrás"><Input name="ajustePontoDiasMax" defaultValue={m.ajustePontoDiasMax} className="sm:max-w-[10rem]" /></Field></fieldset>
          <fieldset className="space-y-1.5 rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Termômetro de humor (anônimo)</legend>
            {chk("termometroAtivo", t.ativo !== false, "Perguntar “como foi a sua semana?” no Meu espaço")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Mínimo de respostas por grupo para mostrar"><Input name="minimoGrupo" defaultValue={t.minimoGrupo} /></Field><Field label="Média que acende o alerta (1 a 5)"><Input name="alertaMedia" defaultValue={String(t.alertaMedia).replace(".", ",")} /></Field></div>
            <Field label="Fatores (um por linha, até 12)"><Textarea name="fatores" defaultValue={(t.fatores as string[]).join("\n")} className="min-h-[100px] text-xs" /></Field></fieldset>
          <fieldset className="space-y-1.5 rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Escalas</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Descanso mínimo entre jornadas (h)"><Input name="interjornadaHoras" defaultValue={e.interjornadaHoras} /></Field><Field label="Turno longo acima de (h)"><Input name="jornadaMaxHoras" defaultValue={e.jornadaMaxHoras} /></Field><Field label="Aviso de publicação (dias antes)"><Input name="diasAvisoPublicacao" defaultValue={e.diasAvisoPublicacao} /></Field></div>
            {chk("exigirFolgaSemanal", e.exigirFolgaSemanal !== false, "Alertar 7 dias seguidos sem folga (descanso semanal)")}</fieldset>
          <fieldset className="space-y-1.5 rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Estoque</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Alerta de validade de lote (dias)"><Input name="alertaValidadeDias" defaultValue={st.alertaValidadeDias} /></Field><Field label="Alerta de CA de EPI (dias)"><Input name="alertaCaDias" defaultValue={st.alertaCaDias} /></Field></div>
            <Field label="Categorias (uma por linha)"><Textarea name="categorias" defaultValue={(st.categorias as string[]).join("\n")} className="min-h-[100px] text-xs" /></Field></fieldset>
          <Btn small>Salvar parâmetros</Btn>
        </form>
      </details>
    </Card>
  );
}
