# STATUS ONE — Pessoas, Matrículas, Atendimento, Governança, Financeiro e Command Center

Sistema do Colégio Status com cinco módulos e o painel executivo no mesmo login, mesmas unidades e mesma auditoria: **Pessoas** (DOM-05 completo), **Matrículas 2027** (DOM-03), **Atendimento e retenção da família** (DOM-12), **Governança e POPs** (DOM-07), **Financeiro** (DOM-04 — camada de gestão sobre o ActiveSoft) e **Command Center** (DOM-14 — visão única da Direção).

## Módulo Operações e manutenção

- **Chamados / ordens de serviço** — qualquer usuário abre (colaborador em autoatendimento inclusive, só na própria unidade); tipo (corretiva, preventiva, melhoria, limpeza, TI, segurança), prioridade com **SLA** (urgente 4 h, alta 24 h, normal 72 h, baixa 10 dias), ambiente, ativo relacionado, responsável, fornecedor, custo previsto e real, evidência, linha do tempo; concluído pede **avaliação do solicitante** (1–5).
- **Ativos e patrimônio** — cadastro e importação CSV por unidade e ambiente, categoria, valor, garantia (alerta 60 dias), **preventiva a cada N dias** com alerta de vencimento e abertura da OS em um clique; concluir a preventiva atualiza o ativo; ativo com chamado aberto fica "em manutenção".
- **Vistorias** — checklists por tipo de ambiente (sala de aula, banheiro, pátio, cozinha, segurança predial — editáveis em Configurações), conformidade por vistoria e por ambiente, e **um chamado automático para cada item não conforme** (itens de segurança entram como prioridade alta).
- **Fornecedores** — cadastro com histórico de OS, custo no ano e avaliação média.
- **Painel** — abertos, SLA vencido, concluídos e tempo médio, preventivas vencidas, custo no mês/ano, conformidade das vistorias, garantias vencendo, satisfação; por tipo e por unidade.
- Perfil **Operações** (módulo completo); gestão também por Direção, RH, diretores e gestores.

## Módulo Estratégia e projetos (DOM-08)

- **OKRs por ciclo** (padrão 2027): objetivos com pilar, dono e abrangência; 2–4 **resultados-chave** com valor inicial, meta, direção (subir/descer) e progresso calculado. KR pode ter **fonte automática** — 14 indicadores que o sistema já mede (ocupação 2027, NPS, retenção, inadimplência, régua pendente, turnover, eNPS, absenteísmo, conformidade de treinamento, bench strength, Process Health, ciência de POPs, SLA de chamados, vistorias) — e se atualiza a cada abertura; ou é manual, com **check-ins** (valor, confiança baixa/média/alta, comentário) do dono.
- **OKRs 2027 sugeridos** já carregados a partir do plano de capacidade e dos indicadores do sistema (5 objetivos, 13 KRs) — a Direção edita, apaga ou substitui.
- **Portfólio de projetos**: dono, unidade, objetivo servido, prioridade, prazo, orçamento × gasto, **marcos** com prazo (atrasados em vermelho), **riscos** (probabilidade × impacto), **status report** periódico (feito · próximo · riscos · saúde no rumo/atenção/em risco); projeto em andamento sem status report há 14 dias vira alerta.
- Painel: progresso do ciclo, KRs com confiança baixa, projetos em risco, marcos atrasados, orçamento; card de estratégia no **Command Center**.
- Quem define OKRs: Direção, RH (diretor: da própria unidade). Quem faz check-in e status report: o dono e os gestores. Todos leem.

## Esqueci minha senha e senha temporária (v16)

- Na tela de login há **Esqueci minha senha**. Com e-mail configurado (`RESEND_API_KEY` + `MAIL_FROM`), o usuário recebe um link de 1 hora e de uso único para criar a nova senha. Sem e-mail, o pedido aparece em **Configurações → Usuários** ("pediu nova senha") e o RH clica em **Gerar senha temporária**: a senha é mostrada uma vez para ser passada pessoalmente; no primeiro acesso o usuário é obrigado a trocá-la antes de navegar.
- A resposta da tela é sempre neutra (não revela se o e-mail existe); no máximo 3 pedidos a cada 15 minutos por conta.

## Responsividade (v16)
- Celular: menu recolhido, indicadores em duas colunas, tabelas com rolagem lateral e primeira coluna fixa.
- Formulários de ação dentro de tabelas (Editar, Decidir, Registrar contato, Presença, Check-in, Reajustar…) abrem em **janela própria** (dialog nativo), legível no PC e no celular — nada mais espremido na última coluna.
- Notebook (1024–1366 px): indicadores em 3 colunas para não estourar valores em reais.
- Feedback imediato: o link do menu mostra um giro enquanto a tela carrega e o botão mostra "Enviando…" enquanto a ação roda (evita clique duplo).
- Dependências de build (Tailwind, PostCSS, TypeScript) passaram para `dependencies`, para o deploy não quebrar quando a hospedagem instala só produção.

## Segurança e homologação (v14)

- **Falha segura**: sem `AUTH_SECRET` (≥ 32 caracteres) o sistema não aceita sessões; a instalação exige `ADMIN_PASSWORD` (≥ 10) e `SETUP_TOKEN` (≥ 16). Nada de valores padrão.
- **`/api/setup`**: na primeira execução só o token; depois exige token **e** sessão de Direção/RH. Para atualizar: entre no sistema e abra a URL de novo.
- **Verificação em duas etapas (2FA)** com aplicativo autenticador (QR code) e 8 códigos de recuperação de uso único; obrigatória para Direção, RH e Financeiro (`settings.seguranca.exigir2FA`); RH redefine em Configurações → Usuários para quem perdeu o celular.
- **Trilha de auditoria imutável** no banco (trigger bloqueia UPDATE/DELETE) e com campos sensíveis mascarados na gravação (CPF, salário, senha, data de nascimento).
- **Integridade referencial**: 60 chaves estrangeiras aplicadas de forma idempotente na atualização.
- **Suíte de segurança** `python3 scripts/e2e_seguranca.py`: setup, bloqueio por tentativas, escopo por unidade, IDOR por URL e por server action, dados sensíveis em tela/CSV/IA/auditoria, imutabilidade da auditoria, 2FA completo, concorrência na última vaga (5 × 20 simultâneas), idempotência do ponto, desativação imediata.
- **Backup**: `scripts/backup.sh` (pg_dump custom + sha256, retenção 30), `scripts/restore.sh` (para banco novo) e `scripts/drill_backup.sh` (ensaio: 100 registros → backup → apagar → restaurar → conferir checksum).
- **Carga**: `scripts/carga.py URL email senha usuários segundos` mede p50/p95/p99 e erros por tela.
- **Homologação**: `scripts/seed_homologacao.py` cria os 10 usuários fictícios por perfil; documentos `STATUS_ONE_Homologacao_GO_NO_GO` e `STATUS_ONE_Matriz_LGPD` acompanham o pacote.

## Command Center executivo

- **Health Geral** (0–100) = média ponderada dos cinco domínios — Pessoas (People Health), Processos (Process Health), Matrículas (ocupação das vagas vs meta, reservas vencendo, fila com vaga), Atendimento (SLA vencido, NPS, famílias em risco, pedidos de saída) e Financeiro (inadimplência 90 dias, régua pendente, caixa negativo, categorias acima do orçamento). Pesos e metas em Configurações (chave `commandCenter`). Cada domínio mostra os descontos com o motivo; indicadores sem dados não descontam.
- **Alertas consolidados** de todos os módulos, por severidade, cada um levando à tela certa; comparação por unidade; **tendência** com um retrato diário guardado a cada abertura.
- **Decisões pendentes da Direção** — as nove decisões humanas do Adendo v3 (DPO, AI Owner, segurança, nuvem, Lakehouse, workflows/mensageria, provedores e orçamento de IA, retenção de dados, orçamento do DOM-15) já carregadas; decidir registra automaticamente no Decision Log; adiar com novo prazo; adicionar outras.
- Impressão em uma página para a reunião semanal. Acesso: Direção, RH, Financeiro e diretores (recorte da própria unidade).

## Módulo Financeiro

Boletos, notas e contabilidade continuam no ActiveSoft e com o contador. O módulo lê exportações (CSV) e organiza a gestão:
- **Inadimplência e régua de cobrança** — importação de títulos (em aberto e recebidos; reimportar atualiza sem duplicar), **aging** (1–30, 31–60, 61–90, +90) por unidade e família, régua configurável (3d lembrete → 10d contato → 20d negociação → 45d aviso formal → 90d jurídico) mostrando em que etapa cada título deveria estar e o que está pendente, registro de cada contato com resultado, **acordos** com parcelas (baixa de parcelas; acordo cumprido quita os títulos; quebrado devolve a aberto) e alçada de desconto no acordo.
- **Descontos e bolsas com alçada** — tipo, percentual, motivo, validade; até a alçada do perfil (padrão: Comercial 10%, Diretor 20%, Financeiro 30%, Direção 100%) é concedido na hora; acima, aguarda quem tem alçada; quem solicita não aprova o próprio; relatório por tipo.
- **Receita prevista × realizada** — valores de mensalidade por unidade/série/modalidade; previsto = matriculados confirmados × valor − descontos aprovados; realizado = títulos emitidos/recebidos por competência; alerta de matriculados sem preço.
- **Fluxo de caixa consolidado** — importação de extratos/lançamentos (repetidos ignorados por hash), lançamento manual, saldo inicial por unidade e mês, entradas por forma e categoria, saídas por categoria, transferências internas fora do resultado, dia a dia.
- **Orçamento × realizado e DRE gerencial** — orçamento mensal por unidade e categoria, realizado do caixa, variação (receita < −10% e despesa > +10% em vermelho), custo de pessoal estimado (salários + encargos) e custo por aluno.
- **Painel da Direção** — inadimplência 90 dias, receita prevista, entradas, saldo, resultado, custo por aluno e alertas (inadimplência alta, ações da régua pendentes, descontos aguardando, matriculados sem preço, categoria acima do orçamento, caixa negativo).
- Perfil **Financeiro** (módulo completo) e alçada `financeiro` para importações, preços e orçamento.

## Módulo Governança e POPs

- **Biblioteca de POPs** — código, título, área, dono, objetivo, escopo, passos numerados, RACI (responsável, aprovador, consultados, informados), indicadores, link do documento. Rascunho → **publicação** por alçada vira versão numerada com histórico; nova publicação = nova versão. Revisão programada (padrão 12 meses) com alerta de vencimento. Os POPs 001–009 do Sistema Operacional Status já vêm cadastrados como rascunhos para receber o texto oficial.
- **Ciência da equipe** — todo usuário (inclusive colaborador em autoatendimento) lê o POP vigente e registra "Li e entendi"; a lista de quem deu ciência por versão é evidência de treinamento. Nova versão zera a ciência.
- **Exceções** — pedido com regra/POP, motivo padronizado, referência, impacto e validade; aprovação por alçada (quem pede não aprova); expiram sozinhas e exigem revisão; **3 exceções iguais em 90 dias** aparecem no painel como recorrentes — sinal de que a regra precisa mudar.
- **Controles** — verificações periódicas (diária a anual) com responsável, evidência e próxima data automática; atrasados em vermelho. Resultado não conforme abre **não conformidade** com prazo.
- **Não conformidades (RCA/CAPA)** — origem (controle, reclamação, auditoria, exceção recorrente), gravidade, causa raiz, ação corretiva, ação preventiva, responsável, prazo; só encerra com causa raiz, ação corretiva e **eficácia verificada**.
- **Registro de decisões** — Decision Log da Direção: contexto, decisão, alternativas descartadas, consequências, responsável, data de revisão; revogar ou substituir.
- **Process Health Score** — parte de 100 e desconta por POPs não vigentes, sem dono ou com revisão vencida, exceções expiradas sem revisão ou recorrentes, controles atrasados e não conformidades fora do prazo ou graves — com os motivos na tela.

## Módulo Atendimento e retenção da família

- **Casos** — solicitações, dúvidas, reclamações, elogios, financeiro, pedagógico e pedidos de saída; canal, responsável, prioridade e **SLA** (padrão: urgente 4 h, alta 24 h, normal 48 h, baixa 5 dias). SLA vencido escala automaticamente e aparece em vermelho. Linha do tempo com registros e contatos; reabertura.
- **Reclamações** — categoria (taxonomia editável), gravidade 1–3 (grave = urgente), checklist de **Service Recovery** e fechamento só com causa raiz e ação corretiva; satisfação (CSAT) ao fechar.
- **Pedidos de saída** — checklist do **protocolo de retenção** (7 passos, editável em Configurações) e desfecho obrigatório: família retida ou perdida (com motivo padronizado). O painel mostra a taxa de retenção do mês.
- **Pesquisas** — NPS (0–10) e CSAT (1–5) registrados manualmente ou por CSV; NPS por mês e por unidade; detratores viram sinal de risco.
- **Famílias em risco** — score transparente ("por que este score?"): pedido de saída +50, reclamação aberta +30 (grave recente +15), SLA vencido +20, NPS detrator +25, inadimplência +25 (lista importada do ActiveSoft), sem rematrícula após a data configurada +20, observação manual +15, elogio recente −10. Alto ≥ 50, médio 25–49.
- **Ficha do aluno** ganha a seção Atendimento: casos, último NPS, risco, sinais (inadimplente, observação) e abertura rápida de caso.
- Perfil **Comercial / Atendimento** acessa Matrículas e Atendimento.

## Módulo Matrículas 2027

- **Painel de vagas** — por unidade × série × turma: vagas, matriculados, reservas ativas, livres, fila e barra de ocupação; alertas de reservas vencendo e de fila com vaga disponível.
- **Turmas 2027** — grade de oferta já carregada com os quadros de capacidade de 11/08/2026 (Carandá 21 turmas/398 + 7 grupos integral/126; TV Morena I 36/866 + 7/140; Cultura 11/180 + 4/60; Ensino Médio 6/288). Total: 92 turmas, 1.732 vagas regulares e 326 do integral. RH e Direção editam vagas, turnos e situação (aberta/fechada).
- **Reservas** — reserva reduz a capacidade na hora, tem prazo (padrão 3 dias) e expira sozinha; duas reservas na última vaga, só uma passa (bloqueio no banco). Prorrogação e transferência de turma.
- **Matrícula** — só é confirmada com contrato assinado e financeiro OK, por perfil com alçada. Cancelamento exige motivo padronizado (mapa de perdas).
- **Lista de espera** — ordem de chegada por unidade e série; ao abrir uma vaga, o próximo recebe a oferta automaticamente com prazo; aceitou, vira reserva.
- **Exceção de capacidade** — matrícula acima da vaga só com justificativa e perfil autorizado (padrão: Direção); fica na auditoria.
- **Alunos e candidatos** — ficha com histórico de reservas/matrículas, importação da base atual (rematrícula) por CSV, exportação para o ActiveSoft.
- **Perfil Comercial / Secretaria** — acessa só o módulo de Matrículas.

Duas premissas registradas na carga inicial, ajustáveis em Turmas: o Ensino Médio foi cadastrado na unidade TV Morena II; as vagas por turma da Unidade Cultura foram distribuídas para fechar as 180 do documento (o quadro não trazia o detalhe por turma).

## Cargos e salários, Desempenho e Recrutamento (dentro do módulo Pessoas)

**Cargos e salários** (só RH e Direção): faixas salariais (mínimo, médio, máximo, amplitude, pontos); avaliação de cargo por 5 fatores configuráveis que sugere a faixa; tabela com ocupantes, salário médio, compa-ratio e salários fora da faixa; **alerta de equidade** quando pessoas do mesmo cargo e nível têm dispersão acima do limite (padrão 15% — Art. 461 CLT); histórico salarial por colaborador (todo reajuste registra de/para, motivo e justificativa; salário alterado na ficha também entra); reajuste coletivo (dissídio) nas faixas e, opcionalmente, em todos os salários.

**Desempenho**: ciclos com competências configuráveis; avaliações geradas para todos os ativos (avaliador = gestor da ficha); **autoavaliação** pelo colaborador; avaliação do gestor por competência + potencial (1–3) + pontos fortes/a desenvolver + **PDI** (até 3 ações com prazo, marcáveis pelo colaborador); metas do ciclo; **calibração** por alçada; **Nine Box** (desempenho × potencial) com rótulos editáveis; encerramento só sem pendências; conversas 1:1 registradas na ficha. Colaborador vê a nota após o encerramento em "Minha avaliação".

**Recrutamento e seleção**: gestor solicita a vaga (cargo, unidade, quantidade, tipo, regime, faixa, justificativa) → Direção/RH aprova e abre → pipeline por etapas (triagem, entrevista RH, teste, entrevista gestor, proposta, contratado) com **scorecard** por critério, anotações e proposta → **contratado vira pré-cadastro de colaborador** com admissão aberta, salário da proposta e histórico; vaga fecha quando atinge a quantidade. Banco de talentos com busca, origem, tags, consentimento LGPD e importação CSV; funil por etapa, origem dos contratados e tempo médio para preencher.

## Clima e eNPS e STATUS Academy (dentro do módulo Pessoas)

**Clima e eNPS**: pesquisas anônimas por **link público** (sem login; cada navegador responde uma vez), com 8 dimensões padrão em escala 1–5 + eNPS 0–10 + comentário — ou perguntas próprias. Resultados só aparecem em recortes com o **mínimo de respostas** (padrão 5): média e favorabilidade por dimensão, eNPS, mapa de calor por unidade, comentários anônimos, participação; **plano de ação** por dimensão com responsável e prazo; histórico de eNPS entre pesquisas.

**STATUS Academy**: catálogo de treinamentos (obrigatório, trilha do cargo, opcional; presencial, online, leitura ou **ciência de POP**), obrigatoriedade por todos / cargo / regime, validade para recertificação; **matriz de treinamento** com conformidade por colaborador e da rede, pendências, vencendo em 60 dias e vencidos; turmas presenciais com presença (presença = concluído); registro em lote com evidência e nota; **ciência de POP vigente conta como treinamento concluído**; LNT (necessidades levantadas por gestor, PDI, NC ou clima); "Meus treinamentos" para o colaborador; seção de treinamentos na ficha.

## Sucessão e talentos · People Analytics e IA (dentro do módulo Pessoas)

**Sucessão e talentos**: posições críticas (cargo, unidade, titular, criticidade, risco de saída, contingência) com sucessores por prontidão (pronto agora / 1–2 anos / em desenvolvimento) e plano de preparação; **bench strength** (% de posições com sucessor pronto); **bus factor** (cargos de direção/administrativos com um único ocupante, concentração de POPs e controles em uma pessoa, posições sem sucessor); **talent review** anual com sinais automáticos por pessoa (último ciclo, faixa salarial, faltas, banco, PDI, treinamentos, 1:1, tempo de casa), classificação (talento-chave, alto potencial, sólido, atenção), risco e impacto da perda, ação de retenção com responsável e prazo.

**People Analytics**: **People Health Score** por unidade e rede, explicável (turnover 12 meses, absenteísmo 90 dias, débito de banco de horas, eNPS, desempenho médio, treinamentos obrigatórios, vagas abertas — pesos e metas em Configurações); movimentação mês a mês; custo estimado de reposição; **People Risk Center** (pessoas com sinais combinados de saída, cada ponto com o motivo); **custo de pessoal** (folha estimada, salário médio, por cargo, projeção com dissídio e novas contratações — só RH e Direção).

**People AI** (opcional): assistente para RH, Direção e diretores que responde perguntas sobre os dados de pessoas em **fato · associação · hipótese · confiança · próximos passos**, sem decidir nem rotular; recebe só dados agregados e anonimizados (a tela mostra exatamente o contexto enviado); toda pergunta e resposta fica no log. Liga-se com `AI_API_KEY` (chave da Anthropic) e, opcionalmente, `AI_MODEL`.

## Sucessão e talentos · People Analytics e IA (dentro do módulo Pessoas)

**Sucessão e talentos** (RH, Direção, diretores): mapa de **posições críticas** (cargo, unidade, titular, criticidade, risco de saída, contingência de 30 dias) com **sucessores por prontidão** (pronto agora / 1–2 anos / em desenvolvimento) e plano de preparação; **bench strength** (% de posições críticas com sucessor pronto); **bus factor** — cargos de direção/administrativo com um único ocupante, pessoas que são donas de muitos POPs ou controles; **talent review** com sugestão automática vinda do Nine Box do último ciclo e dos sinais de risco, classificação final humana (talento-chave, alto potencial, sólido, atenção), risco e impacto da perda, ação de retenção com responsável e prazo.

**People Analytics**: **People Health Score** explicável por unidade e rede (turnover 12 meses, absenteísmo 90 dias, débito no banco de horas, eNPS, desempenho médio, conformidade de treinamento, vagas abertas — com metas e pesos em Configurações; indicadores sem medição não descontam); movimentação mês a mês; **custo de pessoal** estimado pelos salários cadastrados, custo de reposição e simulador de dissídio e aumento de quadro (só RH/Direção); **People Risk Center** — sinais de saída por colaborador (salário abaixo da faixa, alto desempenho sem reajuste, faltas, débito de banco, PDI atrasado, treinamento vencido, pouco tempo de casa, sem 1:1), com os motivos na tela.

**People AI**: assistente para RH/Direção/diretores que responde perguntas sobre os dados no formato do STATUS ONE (fato · associação · hipótese · confiança · próximos passos). Recebe **apenas dados agregados e anonimizados** — sem nomes, sem salários individuais, cargos com menos de 3 pessoas agregados — e a tela mostra exatamente o que é enviado. Precisa de `AI_API_KEY` (Anthropic) e opcionalmente `AI_MODEL` no servidor; sem a chave, nada sai. Toda pergunta e resposta fica registrada com quem perguntou.

## Ponto e jornada (dentro do módulo Pessoas)

- **Jornadas** — carga esperada por dia da semana com vigência (as grades de março, maio e julho viram períodos); professores com minutos de aula por dia, administrativos com 8:48 ou 4:24. Sem jornada cadastrada, vale a carga fixa da ficha de segunda a sexta.
- **Calendário institucional** — feriados, dias não letivos, recesso, férias coletivas e dispensas, por público (docentes/administrativos) e unidade. O calendário 2026 já vem carregado. Feriado, não letivo, férias coletivas e dispensa zeram a carga do dia; recesso mantém a carga e desconta se não trabalhado.
- **Folha de ponto mensal** — dia a dia com esperado, trabalhado, situação (normal, falta, atestado abonado, folga do banco, dispensa, férias, afastamento, recesso, feriado, DSR), marcações e observação. Botão para preencher o mês com jornada + calendário (cada dia fecha em zero) e ajustar só as exceções. Impressão para assinatura.
- **Integração com o banco de horas** — cada dia salvo gera (ou refaz) o lançamento correspondente: um único livro-razão, sem duplicidade. Lançamentos de quem tem alçada entram aprovados; dos demais, pendentes.
- **Importação das planilhas REVISADO_2026** — lê as abas JANEIRO…DEZEMBRO (data, CH, TRABALHADOS, POSITIVO/NEGATIVO e rótulos FÉRIAS/FERIADO/DSR/RECESSO/ATEST/BC_FOLG/DISP), compara o saldo calculado com o saldo da aba GERAL e mostra uma **prévia**; nada é gravado até você confirmar e escolher o colaborador de cada arquivo. Modelo antigo (aba PONTO, sem SALDO) ainda não é lido.

## Módulo Pessoas

Cobre as quatro unidades e as três empresas da rede em um só lugar:

- **Colaboradores** — cadastro completo, ficha 360 (dados, cargo, gestor, férias, banco de horas, documentos, histórico), importação da planilha atual por CSV.
- **Organograma** — cargos com hierarquia (os 22 cargos vigentes já vêm carregados) e ocupação por unidade.
- **Admissões e desligamentos** — checklist com prazo; o colaborador só fica *Ativo* ou *Desligado* quando o checklist é concluído.
- **Férias e afastamentos** — períodos aquisitivos calculados pela data de admissão (30 dias por ano), saldo, solicitação e aprovação por alçada, bloqueio de sobreposição e **alerta de períodos a vencer** (risco de férias em dobro, art. 137 CLT), no painel inicial e na tela de férias.
- **Banco de horas** — lançamentos em minutos (hora extra soma; atraso, falta e compensação descontam), aprovação, saldo por colaborador e da rede, **importação dos saldos atuais** direto da planilha _RESUMO.
- **Documentos** — checklist de entrega, link do arquivo (Drive) e validade com alerta de 30 dias.
- **Acessos por perfil** — Direção, RH, Diretor de unidade, Gestor, Somente leitura e **Colaborador (autoatendimento)**: o colaborador entra, vê só a própria ficha, pede férias/folgas e lança horas para aprovação. Diretor de unidade e Gestor só veem a própria unidade; salário e CPF só aparecem para RH e Direção; detalhes de afastamento por saúde idem.
- **Relatório mensal para o contador/DP** — admissões, desligamentos, férias/afastamentos e movimento do banco de horas do mês (saldo inicial, créditos, débitos, saldo final), com botão de imprimir/salvar PDF e exportação CSV.
- **Exportar** — colaboradores, banco de horas e férias em CSV (abre no Excel), respeitando o perfil de quem exporta.
- **Painel inicial** — números da rede ou da unidade, pendências de aprovação, maiores débitos do banco, aniversariantes e tempo de casa do mês, últimas ações.
- **Segurança** — senha com hash, sessão de 12 horas, 5 tentativas erradas bloqueiam o e-mail por 15 minutos, usuário desativado perde o acesso imediatamente, HTTPS pela Vercel.
- **Notificações por e-mail (opcional)** — ao configurar uma conta gratuita no Resend, aprovadores recebem e-mail de nova solicitação e quem pediu recebe a decisão. Sem configurar, tudo funciona igual, só sem e-mail.
- **Auditoria** — toda alteração registra quem, quando, o que mudou. Não pode ser editada nem apagada pela tela.
- **Configurações** — unidades, empresas, cargos, usuários, alçadas de aprovação, checklists e documentos padrão.

Tecnologia: Next.js 15 (React 19, TypeScript), PostgreSQL, Tailwind. Um único aplicativo, sem servidores extras — a forma mais simples de hospedar.

---

## 1. Colocar no ar sem programador (≈ 30 minutos)

Você vai criar duas contas gratuitas: **Neon** (banco de dados) e **Vercel** (site). Não precisa instalar nada no computador.

### Passo 1 — Banco de dados (Neon)
1. Acesse neon.tech e crie uma conta (pode entrar com Google).
2. Crie um projeto chamado `status-people`. Região: escolha a mais próxima do Brasil (ex.: `aws-sa-east-1 São Paulo`, se disponível; senão US East).
3. Na tela do projeto, clique em **Connect** e copie a **connection string** (começa com `postgresql://`). Marque a opção **Pooled connection** se aparecer.
   Guarde esse texto: é o `DATABASE_URL`.

### Passo 2 — Publicar o código (GitHub + Vercel)
1. Acesse github.com, crie uma conta e um repositório **privado** chamado `status-people`.
2. Clique em **uploading an existing file** e arraste **todo o conteúdo desta pasta** (não envie as pastas `node_modules` e `.next`, se existirem, nem o arquivo `.env`). Confirme com **Commit changes**.
3. Acesse vercel.com, crie uma conta com o GitHub e clique em **Add New → Project**. Escolha o repositório `status-people`.
4. Antes de clicar em Deploy, abra **Environment Variables** e cadastre estas quatro variáveis:

| Nome | Valor |
|---|---|
| `DATABASE_URL` | a connection string copiada do Neon |
| `AUTH_SECRET` | um texto longo e aleatório (32+ caracteres) — invente algo como uma frase sem espaços |
| `SETUP_TOKEN` | outro texto aleatório; será usado uma única vez |
| `ADMIN_PASSWORD` | a senha inicial do usuário do RH (troque depois) |

5. Clique em **Deploy**. Em 2–3 minutos a Vercel mostra o endereço do sistema (algo como `https://status-people.vercel.app`).

### Atualizando uma instalação que já existe
Substitua os arquivos no GitHub (ou rode `railway up` de novo, se usou Railway) e, depois do deploy, abra mais uma vez `https://SEU-ENDERECO/api/setup?token=SEU_SETUP_TOKEN`: isso cria as tabelas novas (por exemplo, as do módulo de Matrículas) e carrega a grade 2027, sem tocar nos dados que já existem.

### Passo 3 — Criar as tabelas e o primeiro usuário (uma vez)
Abra no navegador:

```
https://SEU-ENDERECO.vercel.app/api/setup?token=SEU_SETUP_TOKEN
```

A resposta deve ser um texto com `"ok": true`. Isso cria as tabelas, as 4 unidades, as 3 empresas, os cargos, as configurações padrão e o usuário:

- **e-mail:** `rh@colegiostatus`
- **senha:** o que você colocou em `ADMIN_PASSWORD`

### Passo 4 — Primeiro acesso
1. Entre em `https://SEU-ENDERECO.vercel.app/login`.
2. Vá em **Minha conta** e troque a senha.
3. Em **Configurações**, confira unidades, empresas (preencha os CNPJs) e cargos; crie os usuários da equipe (Direção, coordenadora de RH, diretores de unidade…).
4. Em **Colaboradores → Importar planilha**, cole a planilha atual (veja o formato abaixo). Depois complete cargo, gestor e carga horária de quem ficou pendente.
5. Saldos atuais do banco de horas: em **Banco de horas → Importar saldos da planilha**, cole duas colunas (`nome;saldo`) copiadas da planilha _RESUMO_BANCO_DE_HORAS (saldo em minutos, ex.: `-4215`, ou em `hh:mm`, ex.: `-70:15`) e informe a data do fechamento. Cada linha vira um ajuste aprovado; rodar de novo não duplica. A partir daí, só lançamentos do dia a dia.
6. Para dar acesso a um colaborador (ver a própria ficha, pedir férias, lançar horas): **Configurações → Usuários → perfil "Colaborador (autoatendimento)"**, vinculando ao cadastro dele.

Domínio próprio (ex.: `pessoas.colegiostatus.com.br`): na Vercel, **Settings → Domains**. Opcional.

E-mails de aviso (opcional): crie uma conta em resend.com, gere uma chave e cadastre na Vercel as variáveis `RESEND_API_KEY`, `MAIL_FROM` (remetente com domínio verificado) e `APP_URL` (endereço do sistema). Depois faça um novo deploy. Os usuários precisam ter e-mail real no cadastro.

---

## 2. Formato da planilha para importar (CSV)

No Excel: **Arquivo → Salvar como → CSV UTF-8 (delimitado por vírgulas)**. Abra o arquivo no Bloco de Notas, copie tudo e cole na tela **Importar planilha**.

Primeira linha = cabeçalho. Colunas aceitas (só as três primeiras são obrigatórias):

```
nome;unidade;admissao;cargo;empresa;vinculo;email;telefone;jornada_min_dia;turno
Maria da Silva;Carandá;03/08/2026;Professor;Colégio Status LTDA;CLT;maria@email;67 99999-0000;528;Matutino
João Souza;TVM1;01/02/2025;Inspetor de Alunos;;CLT;;;528;Integral
```

- `unidade`: nome (Carandá, TV Morena I, TV Morena II, Cultura) ou código (CAR, TVM1, TVM2, CUL).
- `vinculo`: CLT, HORISTA, ESTAGIARIO, PJ ou TEMPORARIO (padrão CLT).
- `jornada_min_dia`: carga diária em minutos (528 = 8h48; 264 = 4h24; professores: soma das aulas do dia).
- Linhas com erro são puladas e listadas no resumo; nada é sobrescrito. Salário e CPF não entram pela importação — cadastre na ficha, só RH/Direção enxergam.

---

## 3. Perfis e permissões

| Perfil | Vê | Faz |
|---|---|---|
| Direção / RH | tudo, todas as unidades, salário e CPF | cadastra, edita, aprova, configura, conclui admissão e desligamento |
| Diretor de unidade | só a própria unidade, sem salário/CPF | solicita e aprova férias/afastamentos e banco de horas da unidade (conforme alçadas) |
| Gestor | só a própria unidade, sem salário/CPF | solicita férias/afastamentos e lança horas (ficam pendentes de aprovação) |
| Somente leitura | conforme unidade | consulta |
| Colaborador (autoatendimento) | só a própria ficha, sem salário/CPF | pede férias e afastamentos, lança horas (ficam pendentes) |
| Comercial / Atendimento | Matrículas e Atendimento (rede ou uma unidade) | cadastra alunos, reserva vagas, opera a fila, confirma matrícula (alçada padrão), registra e conduz casos |

Regras fixas: quem solicita não aprova a própria solicitação (exceto RH/Direção); ações de desligamento e conclusão de processos são de RH/Direção; tudo vai para a auditoria.

---

## 4. Rodar no computador (opcional, para testar sem internet)

Pré-requisitos: Node.js 20+ e Docker.

```bash
cp .env.example .env         # edite os valores
docker compose up -d         # sobe um PostgreSQL local
npm install
npm run setup                # cria tabelas, dados-base e o usuário rh@colegiostatus
npm run dev                  # abre em http://localhost:3000
```

Testes de ponta a ponta (servidor em `next start -p 3100`, Python 3 + `requests`): `python3 scripts/e2e.py` (Pessoas), `python3 scripts/e2e_matriculas.py` (Matrículas) `python3 scripts/e2e_ponto.py` (Ponto; gere antes as planilhas de teste com `node scripts/make_planilha_teste.js`) `python3 scripts/e2e_atendimento.py` (Atendimento) `python3 scripts/e2e_governanca.py` (Governança), `python3 scripts/e2e_talento.py` (Cargos/Desempenho/Recrutamento) `python3 scripts/e2e_clima_academy.py` (Clima/Academy) e `python3 scripts/e2e_sucessao_analytics.py` (Sucessão/Analytics).

---

## 5. Estrutura do código

```
src/app/(app)/           páginas autenticadas (colaboradores, organograma, processos, ferias, banco-de-horas, documentos, auditoria, configuracoes, conta)
src/app/login            login
src/app/api/setup        instalação única (tabelas + dados-base)
src/app/api/export       exportações CSV (colaboradores, banco, férias, banco-mensal)
src/app/api/sair         encerra a sessão (usado quando um usuário é desativado)
src/lib/relatorio.ts     relatório mensal (movimentações, afastamentos, banco)
src/lib/matriculas.ts    capacidade, reservas com bloqueio de linha, confirmação, cancelamento, transferência, fila
src/lib/ponto.ts         jornada vigente, calendário, folha mensal e sincronização com o banco de horas
src/lib/ponto-import.ts  leitura tolerante das planilhas REVISADO (prévia antes de gravar)
src/lib/atendimento.ts   SLA, escalonamento, estatísticas e score de risco de saída
src/lib/governanca.ts    expiração de exceções, estatísticas e Process Health Score
src/lib/talento.ts       tabela de cargos, equidade, Nine Box, funil de vagas
src/lib/clima-academy.ts resultados de pesquisa com anonimato, matriz de treinamento
src/lib/talentos-analytics.ts sucessão, bus factor, sinais de risco, People Health, contexto e chamada do People AI
src/lib/financeiro.ts    aging e régua, receita prevista × realizada, caixa, orçamento/DRE, parsers de CSV
src/lib/command-center.ts Health Geral ponderado, alertas consolidados, retratos diários
src/lib/operacoes.ts     SLA de chamados, painel de operações, preventivas
src/lib/estrategia.ts    fontes automáticas de KR, progresso, portfólio
src/app/(app)/estrategia painel, OKRs, projetos
src/app/(app)/operacoes  painel, chamados, ativos, vistorias, fornecedores
src/app/(app)/command-center painel executivo e decisões pendentes
src/app/(app)/financeiro painel, inadimplência, descontos, receita, caixa, orçamento, importar
src/app/(app)/sucessao · analytics · sucessao-analytics/actions.ts
src/lib/talentos-analytics.ts sucessão, bus factor, sinais por pessoa, People Health, contexto e chamada do People AI
src/app/(app)/sucessao · analytics · talentos/actions.ts
src/app/(app)/clima · academy · clima-academy/actions.ts · src/app/pesquisa/[token] (link público)
src/app/(app)/cargos-salarios · desempenho · recrutamento · talento/actions.ts
src/app/(app)/governanca painel, POPs, exceções, controles/NCs, decisões
src/app/(app)/atendimento painel, casos, famílias em risco, pesquisas
src/app/(app)/ponto      folha mensal, jornadas, calendário, importação
src/app/(app)/matriculas painel de vagas, turmas, alunos, reservas, lista de espera, importação
src/lib/notify.ts        e-mails opcionais via Resend
src/lib/ferias.ts        alerta de períodos de férias a vencer
src/db/schema.ts         modelo de dados (Drizzle ORM)
src/db/setup.ts          SQL de criação (idempotente), cargos, checklists e documentos padrão
src/lib/auth.ts          sessão, login, perfis e escopo por unidade
src/lib/session.ts       JWT do cookie (compartilhado com o middleware)
src/lib/utils.ts         datas, férias (períodos aquisitivos), rótulos, auditoria
src/components/ui.tsx    componentes visuais
src/middleware.ts        exige login em todas as páginas
```

Modelo de dados: `companies`, `units`, `positions`, `employees`, `users`, `leave_requests`, `hour_entries`, `processes` + `process_items`, `documents`, `audit_log`, `settings`, `login_attempts`; Matrículas: `grades`, `classes`, `students`, `enrollments`, `waitlist`; Ponto: `schedules`, `calendar_days`, `timesheet_days`, `import_batches`; Atendimento: `cases`, `case_events`, `surveys`; Governança: `procedures`, `procedure_versions`, `procedure_acks`, `exceptions`, `controls`, `control_runs`, `nonconformities`, `decisions`; Talento: `salary_grades`, `salary_history`, `perf_cycles`, `perf_reviews`, `perf_goals`, `perf_checkins`, `requisitions`, `candidates`, `applications`, `application_events`; Clima/Academy: `climate_surveys`, `climate_responses`, `climate_actions`, `courses`, `training_progress`, `training_sessions`, `session_attendance`, `training_needs`; Sucessão/Analytics: `critical_positions`, `successors`, `talent_reviews`, `talent_review_items`, `ai_log`; Financeiro: `receivables`, `collection_actions`, `agreements`, `agreement_installments`, `discounts`, `tuition_prices`, `cash_entries`, `cash_balances`, `budgets`; Command Center: `health_snapshots`, `exec_pending`; Operações: `assets`, `work_orders`, `work_order_events`, `inspections`, `suppliers`; Estratégia: `objectives`, `key_results`, `kr_checkins`, `projects`, `milestones`, `project_updates`, `project_risks`. Tudo em português nos rótulos, inglês nos nomes técnicos — seguindo o Bloco 15 do STATUS ONE.

---

## 6. O que fica para a próxima versão

- Anexar arquivos direto no sistema (hoje: link do Drive).
- Integração direta com o relógio de ponto (REP) e escalas rotativas.
- Folha de pagamento e eSocial (DOM-06) — por decisão, fora desta versão; a integração é com o contador/sistema atual.
- Notificações por e-mail/WhatsApp (aprovações, vencimentos).
- Autenticação em dois fatores.

Segredos (`AUTH_SECRET`, `SETUP_TOKEN`, senha do banco) nunca devem ser enviados por mensagem nem colocados no GitHub. O arquivo `.env` está no `.gitignore` por isso.
