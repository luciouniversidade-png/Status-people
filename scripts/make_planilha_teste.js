// Gera uma planilha no formato das REVISADO_2026 (abas GERAL + meses) para testar o importador.
const XLSX = require("xlsx"); const fs = require("fs");
const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
function build(nome, chSemana, out) {
  const wb = XLSX.utils.book_new(); let saldo = 0; const geral = [["DATA","CH","OBS","TRABALHADOS","POSITIVO","NEGATIVO","SALDO"]];
  for (let m = 0; m < 12; m++) {
    const rows = [["FUNCIONÁRIO", nome], [], ["DATA","CH","OBS","TRABALHADOS","POSITIVO","NEGATIVO","SALDO"]];
    const nd = new Date(Date.UTC(2026, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= nd; d++) {
      const data = `${String(d).padStart(2,"0")}/${String(m+1).padStart(2,"0")}/2026`; const dow = new Date(Date.UTC(2026, m, d)).getUTCDay();
      let ch = chSemana[dow] ?? 0, obs = "", trab = ch, pos = 0, neg = 0;
      if (dow === 0 || dow === 6) { ch = 0; trab = 0; obs = "DSR"; }
      if (m === 0 && d <= 21) { obs = "FÉRIAS"; ch = 0; trab = 0; }
      if (m === 6 && d >= 13 && d <= 24 && dow !== 0 && dow !== 6) { obs = "RECESSO"; trab = 0; }           // recesso desconta
      if (m === 8 && d === 7) { obs = "FERIADO"; ch = 0; trab = 0; }
      if (m === 7 && d === 12 && dow !== 0 && dow !== 6) { pos = 60; }                                      // hora extra avulsa
      if (m === 7 && d === 6 && dow !== 0 && dow !== 6) { neg = 11; }                                       // atraso avulso
      if (m === 8 && d === 15 && dow !== 0 && dow !== 6) { obs = "ATEST"; trab = 0; }                       // atestado abonado
      const diff = (obs === "FÉRIAS" || obs === "FERIADO" || obs === "DSR" || obs === "ATEST") ? 0 : (trab - ch) + pos - neg;
      saldo += diff; rows.push([data, ch, obs, trab, pos || "", neg || "", saldo]); geral.push([data, ch, obs, trab, pos || "", neg || "", saldo]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), MESES[m] + (m === 3 ? " " : ""));
  }
  const g = XLSX.utils.aoa_to_sheet([["BANCO DE HORAS 2026", nome], [], ...geral]);
  wb.SheetNames.unshift("GERAL"); wb.Sheets["GERAL"] = g;
  XLSX.writeFile(wb, out); return saldo;
}
const s1 = build("MARIA TESTE DA SILVA", { 1: 528, 2: 528, 3: 528, 4: 528, 5: 528 }, "/tmp/MARIA TESTE DA SILVA_REVISADO_2026.xlsx");
const s2 = build("ARCIRLEY TESTE", { 1: 555, 2: 400, 3: 485, 4: 350, 5: 140 }, "/tmp/ARCIRLEY TESTE_REVISADO_2026.xlsx");
console.log(JSON.stringify({ maria: s1, arcirley: s2 }));
