// Testes unitários da v24.1 (carga inicial): férias quitadas antes do sistema. Uso: npx tsx scripts/test_v24_1.ts
import { periodosFerias } from "../src/lib/utils";

let n = 0;
function ok(cond: boolean, msg: string) { if (!cond) { console.error("FALHOU:", msg); process.exit(1); } n++; console.log("ok -", msg); }

const ADM = "2015-02-03", HOJE = "2026-10-17";
{ // sem quitação: todos os períodos desde a admissão entram na conta (antigos sem férias lançadas aparecem vencidos)
  const ps = periodosFerias(ADM, [], HOJE);
  ok(ps.length === 12 && ps[0].inicio === "2015-02-03" && ps[0].fim === "2016-02-02", "doze períodos desde 2015, o primeiro de 03/02/2015 a 02/02/2016");
  ok(ps.filter(p => p.status === "VENCIDO").length === 10, "sem histórico, dez períodos antigos aparecem vencidos (risco de dobra falso)");
  ok(ps[10].status === "ABERTO" && ps[11].status === "EM_AQUISICAO", "o período 2025/2026 está aberto e o 2026/2027 em aquisição");
}
{ // quitadas até o fim de um período: ele e os anteriores ficam quitados; o seguinte segue aberto
  const ps = periodosFerias(ADM, [], HOJE, "2025-02-02");
  ok(ps.filter(p => p.status === "QUITADO").length === 10 && ps.slice(0, 10).every(p => p.saldo === 0 && p.usados === 30), "quitadas até 02/02/2025: os dez períodos encerrados até a data ficam quitados (saldo 0)");
  ok(ps[10].status === "ABERTO" && ps[10].saldo === 30, "o período 03/02/2025–02/02/2026 continua aberto com 30 dias");
  ok(ps.every(p => p.status !== "VENCIDO"), "nenhum período vencido depois da quitação");
}
{ // data no meio de um período: só os encerrados até a data contam como quitados
  const ps = periodosFerias(ADM, [], HOJE, "2024-06-30");
  ok(ps[8].fim === "2024-02-02" && ps[8].status === "QUITADO", "período encerrado em 02/02/2024 (antes da data) fica quitado");
  ok(ps[9].fim === "2025-02-02" && ps[9].status === "VENCIDO", "período encerrado em 02/02/2025 (depois da data) não é quitado — segue a regra normal");
}
{ // férias aprovadas continuam valendo nos períodos não quitados
  const ps = periodosFerias(ADM, [{ periodoRef: "2025-02-03", dias: 20 }], HOJE, "2025-02-02");
  ok(ps[10].usados === 20 && ps[10].saldo === 10 && ps[10].status === "ABERTO", "20 dias aprovados no período 2025/2026 deixam saldo de 10");
  const ps2 = periodosFerias(ADM, [{ periodoRef: "2025-02-03", dias: 30 }], HOJE, "2025-02-02");
  ok(ps2[10].status === "QUITADO", "30 dias aprovados quitam o período normalmente");
}
{ // quitação anterior à admissão não muda nada; posterior a hoje não quita período em aquisição
  ok(JSON.stringify(periodosFerias(ADM, [], HOJE, "2010-01-01")) === JSON.stringify(periodosFerias(ADM, [], HOJE)), "data anterior à admissão não tem efeito");
  const ps = periodosFerias("2026-03-01", [], HOJE, "2026-12-31");
  ok(ps.length === 1 && ps[0].status === "EM_AQUISICAO", "período em aquisição não fica quitado (termina depois da data informada)");
}
console.log(`\n${n} testes ok`);
