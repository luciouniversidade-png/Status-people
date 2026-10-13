# STATUS ONE — Pessoas, Matrículas, Atendimento, Governança, Financeiro, Operações, Estratégia e Command Center

Sistema do Colégio Status com os módulos e o painel executivo no mesmo login, mesmas unidades e mesma auditoria: **Pessoas** (DOM-05 completo), **Matrículas 2027** (DOM-03), **Atendimento e retenção da família** (DOM-12, com o **Radar da família**), **Governança e POPs** (DOM-07), **Financeiro** (DOM-04 — camada de gestão sobre o ActiveSoft), **Operações** (com portaria e segurança, mapa de salas, contratos e licenças), **Estratégia** (DOM-08, com a **gestão estratégica** completa), **Solicitações e aprovações**, **Privacidade (LGPD)** e **Canal de ética**, **Comunicação** e **Command Center** (DOM-14 — visão única da Direção). No celular, o ONE instala como app e manda as notificações. Versão atual: **v22** (esquema do banco 22.0).

## O que chegou na v22

Nove recursos que os ERPs escolares maiores (TOTVS Educacional e similares) oferecem e que cabiam no ONE, sem invadir o que ficou fora por decisão: **Rematrícula por link**, **Substituição de professor**, **Mapa de salas e reservas**, **Portaria e segurança**, **Privacidade (LGPD)**, **Canal de ética**, **Central de solicitações com aprovação**, **Contratos de fornecedores e licenças** e o **ONE no celular** (app instalável + notificações). Continuam fora do ONE, em código: CRM de leads individuais, o acadêmico (notas, frequência, diário, grade de aulas do aluno, biblioteca, processo seletivo) e a ampliação do Financeiro (faturamento, cobrança, contabilidade, folha). O que é feito pela família (portal dos pais, agendamento, autorização de passeio) fica na **Agenda Eletrônica**, com o ONE como retaguarda; enfermaria e saúde do aluno só depois, com desenho próprio de LGPD.

## Rematrícula por link (v22)

A família faz a rematrícula pelo celular, sem login, a partir de um link individual; a secretaria acompanha tudo num painel (`Matrículas → Rematrícula`).

- **Contrato do ano** (`Rematrícula → Contrato`): a instalação cria um **rascunho com o aviso [RASCUNHO]** — enquanto o aviso estiver no texto, a publicação é bloqueada (cole o contrato oficial revisado pela assessoria jurídica). Variáveis preenchidas para cada família: `{aluno} {responsavel} {serie} {turma} {turno} {unidade} {ano} {integral} {data}`. Versões: publicar uma nova não altera os aceites já feitos (cada família fica com a versão que aceitou). Só Direção/RH editam e publicam.
- **Painel**: todos os alunos atuais com a situação — sem link, link gerado, enviado, **abriu e não concluiu**, reserva (aguardando o financeiro), matriculado, recusou, link expirado, concluinte (sem próxima série) — e o percentual de rematrícula feita. **Gerar links em lote** respeita unidade e série filtradas e nunca gera para quem já tem reserva, link ativo, recusou ou é concluinte. **WhatsApp** com o texto pronto (ou envio direto pela API oficial, se configurada); o histórico de mensagens guarda o convite com o **link mascarado** (quem tem o link age em nome da família). Copiar link e CSV com os links só para quem reserva vagas.
- **Na casa da família** (`/rematricula/<link>`, celular): 1) confere os dados do responsável financeiro; 2) escolhe a turma da **série seguinte** entre as que têm vaga (na mesma unidade; se a unidade não oferece a série, as da rede) e, se quiser, o **Integral** no contraturno; 3) lê o contrato já preenchido e aceita com **nome completo e CPF** (confere com o cadastro; 5 tentativas erradas bloqueiam por 15 minutos); 4) responde às **autorizações de imagem** (cada uma separada; desmarcada = negada, com registro). A vaga é conferida de novo no aceite, com trava contra lotação simultânea; o aceite grava versão, hash do texto, data, IP e navegador; a família recebe o comprovante para imprimir.
- **Não vai continuar**: a família escolhe o motivo (lista) e pode comentar; abre-se automaticamente um **pedido de saída no Atendimento**, com o protocolo de retenção, atribuído à carteira. Com CPF no cadastro, a recusa também exige o CPF.
- A **confirmação final continua no financeiro** (ActiveSoft): a reserva fica com "contrato ✓, aguardando o financeiro" e vence no prazo configurado.
- **Rotina diária**: expira links vencidos; avisa a carteira (ou o comercial da unidade) quando a família abriu e não concluiu em 2 dias e quando o link vai vencer sem ser aberto. Pré-visualização do link no WhatsApp/Telegram não conta como "abriu".
- Configuração (`Configurações`): validade do link (30 dias), prazo da reserva criada pelo aceite (30 dias), Integral só no contraturno, dias para o lembrete e o texto do convite.

## Substituição de professor (v22)

Quem falta, quais aulas ficam descobertas e quem cobre — com aceite do professor pelo celular e crédito no banco de horas (`Pessoas → Substituição de professores`).

- **Grade horária**: aulas por professor, dia, horário, turma, disciplina e sala; cadastro na tela ou **importação colando do Excel** (`professor;unidade;dia;inicio;fim;turma;disciplina`) — tudo ou nada: professor desconhecido, choque de horário ou unidade fora do escopo barram o arquivo inteiro. Aula com histórico é retirada da grade, não apagada.
- **Ausências**: a coordenação registra (dia, período até 31 dias ou parte do dia); o professor avisa pelo celular (de hoje em diante) e a coordenação recebe alerta; **férias e afastamentos aprovados viram ausência sozinhos** (e saem se o afastamento for cancelado); feriados e dias sem aula não geram aulas a cobrir.
- **Quadro do dia**: aulas a cobrir com **sugestões ordenadas** — livre no horário, já está na escola no turno, mesma disciplina, menos coberturas no mês — e os motivos de quem não pode (quem falta, afastado, aula própria no horário, já cobre outra aula, desligado, outra unidade). **Convidar** (o professor aceita ou recusa com motivo pelo celular) ou **designar** direto; "sem professor" com a solução adotada (atividade orientada, junção de turmas, turma dispensada, outra); reabrir.
- **Realizada → banco de horas**: a aula dada vira crédito de horas de quem cobriu (pendente ou já aprovado, conforme a configuração), uma única vez. Ninguém se designa nem confirma a própria cobertura; professor não apaga ausência passada nem a de hoje com colega já cobrindo.
- **Minhas substituições** (professor): convites, coberturas combinadas, grade, avisos de ausência e horas cobertas. **Histórico** com quem mais cobriu e ausências por motivo; CSV.
- **Rotina**: aulas sem professor hoje (alerta) e amanhã, e coberturas a confirmar — para coordenação e direção da unidade.

## Mapa de salas e reservas (v22)

- **Espaços** por unidade (sala, laboratório, quadra, auditório, biblioteca, brinquedoteca, refeitório, equipamento), com capacidade informada ou calculada pela área (m² por aluno configurável, padrão 1,2).
- **Mapa de salas × turno** do ano letivo (`Operações → Mapa de salas e reservas`): que turma ocupa cada sala, alunos × vagas × lugares, alertas (vagas acima da capacidade, alunos acima da capacidade, duas turmas na mesma sala e turno) e turmas sem sala. A página da turma (Matrículas) mostra a sala e avisa quando as vagas passam da capacidade.
- **Reservas** de laboratório, quadra, auditório e equipamentos, na semana de cada espaço: sem conflito com outras reservas **nem com as aulas fixas da grade** (ex.: Educação Física na quadra); repetição semanal tudo ou nada; trava contra reservas simultâneas; cancela quem reservou, operações ou a gestão (uma ocorrência ou a série dali em diante). Professores reservam pelo celular.

## Portaria e segurança (v22)

- **Visitantes e prestadores** (`Operações → Portaria e segurança`): entrada e saída, crachá, empresa, quem visita e documento mascarado. Nome e documento são **apagados automaticamente** depois do prazo de guarda (padrão 180 dias); o registro de que houve a visita fica.
- **Quem pode buscar cada aluno** (ficha do aluno): autorizados (com validade opcional) e **restrições** (ex.: decisão judicial) — restrição só pela coordenação ou direção, com a base registrada.
- **Saída antecipada**: a portaria confere nome e documento na lista; **restrição bloqueia sempre**; pessoa fora da lista só com exceção justificada da coordenação/direção; tudo registrado com hora e quem liberou.
- **Simulados e emergências**: cenários (incêndio, vazamento de gás, abrigo no local, temporal, pane elétrica…), **chamada por grupo** no ponto de encontro (turmas, equipe da unidade e visitantes presentes), tempo de evacuação × meta (5 min), feridos e não localizados (alerta imediato na emergência real), entrega dos alunos às famílias registrada; falhas encontradas viram ação no plano de ação.
- **Brigada**: brigadistas por unidade, função, treinamento e validade (12 meses), mínimo por unidade (padrão 2).
- **Rotina e Command Center**: brigada vencendo ou abaixo do mínimo, unidade sem simulado no período (6 meses), evento esquecido aberto e emergência real em andamento.

## Privacidade — LGPD (v22)

- **Encarregado (DPO) e prazos** (`Governança → Privacidade (LGPD)`): nome e contato do encarregado aparecem no portal; tratam privacidade a Direção, o RH e o encarregado (pode ter perfil Leitura).
- **Portal do titular** (`/privacidade`, sem login): pedido de confirmação e acesso, correção, anonimização/eliminação, portabilidade, informação sobre compartilhamento ou revogação de consentimento, com **protocolo e código** para acompanhar. Prazo de resposta configurável (até 15 dias), identidade conferida quando o pedido exige, resposta registrada.
- **Autorizações de imagem e divulgação**: finalidades com texto versionado (redes sociais, materiais da escola, divulgação de conquistas); registro e **revogação** (avisa o marketing); **lista para fotos** de cada turma (quem pode e quem não pode aparecer); cobertura por finalidade. Coletadas também no aceite da rematrícula.
- **Incidentes de segurança**: ciência (no horário da escola), categorias de dados, crianças envolvidas, dados sensíveis; **prazo de comunicação em dias úteis** (3, em dobro para pequeno porte — Res. CD/ANPD nº 15/2024), pulando fins de semana e feriados; decidir não comunicar exige justificativa e é proibido com risco relevante; encerrar exige avaliação e comunicação registradas; **registro que não pode ser apagado** e evidências que não podem ser removidas; avisos sem o conteúdo do incidente.
- **Rotina**: pedidos vencendo ou vencidos e prazo da ANPD — para Direção, RH e encarregado, sem dados pessoais no aviso.

## Canal de ética (v22) — Lei 14.457/2022

- **Canal público** `/etica` (link e QR code para imprimir no painel): relato **anônimo** ou identificado (opcional), sem login e sem registro do endereço de rede; **protocolo e código** para acompanhar e conversar com o comitê sem se identificar.
- **Comitê de triagem** definido pela Direção (padrão: a Direção). **Quem é citado no relato fica impedido** de vê-lo — o cálculo se repete a cada acesso, então quem entra no comitê depois também é barrado; cada membro pode se declarar impedido; marcar outra pessoa ou liberar um homônimo é da Direção; nunca fica um relato sem ninguém para tratar (Direção e, por fim, RH assumem).
- **Triagem e apuração** com prazos (5 e 60 dias, configuráveis), gravidade, responsável, notas internas, mensagens para quem relatou, conclusão com resultado e medidas e retorno a quem relatou; arquivamento só com motivo. Relato de proteção à criança destaca o **dever de comunicar o Conselho Tutelar** (ECA).
- **Sigilo**: avisos e celular sem o conteúdo; cada leitura de relato fica na auditoria (sem o texto); relatório agregado sem conteúdo para a Direção/CIPA; relato não pode ser apagado; contra robôs, até 5 relatos por hora da mesma origem (contados só em memória) e 10 mensagens por hora por relato.
- **Regras de conduta** publicadas com ciência obrigatória (comunicado) e **treinamento anual** obrigatório no Academy.

## Central de solicitações e aprovações (v22)

- **Formulários por tipo** (`Solicitações e aprovações`): reembolso de despesa, pedido de compra, passeio ou evento, declaração e material já vêm prontos; Direção/RH criam outros num editor de linhas (campos de texto, texto longo, número, valor, data, seleção, sim/não; perfis que podem abrir; etapas por perfil ou por pessoa, com **alçada por valor** — ex.: "Direção acima de R$ 1.000").
- **Aprovação pelo celular**: as etapas seguem em ordem; o aprovador aprova, devolve para ajuste ou rejeita (com motivo); **ninguém aprova o próprio pedido**; devolvida, a pessoa ajusta e reenvia (a alçada é recalculada); comentários, comprovantes anexados, prazo por etapa com alerta; painel para Direção, RH, Financeiro e diretor da unidade; CSV. O pagamento continua no financeiro (fora do ONE).

## Contratos de fornecedores e licenças (v22)

- **Contratos** (`Operações → Contratos de fornecedores`): fornecedor, objeto, abrangência (rede ou unidade), valores, vigência, renovação (automática, negociada, sem renovação), **aviso prévio**, índice e data do **reajuste**, responsável e anexos (contrato assinado, aditivos). Alertas aos 60 e 30 dias do fim, no **prazo para avisar a não renovação**, no reajuste e no vencimento; renovação cria um novo período e guarda o anterior; encerramento com motivo; valor mensal comprometido.
- **Licenças, alvarás e laudos**: **matriz por unidade** (alvará, AVCB, licença sanitária, ato autorizativo, laudos elétrico e de SPDA, caixa d'água, controle de pragas, extintores, acessibilidade, seguro) com a situação de cada documento — em dia, vence em breve, vencida, não se aplica (justificado) ou não cadastrada; renovação com histórico; evidência anexada.
- **Quem vê**: contratos — Direção, Financeiro, Operações, RH, diretor da unidade (os da unidade e os da rede, sem editar os da rede) e Leitura; licenças — os mesmos, sem o Financeiro. Coordenação, comercial e colaboradores não veem (nem no menu).

## ONE no celular — app e notificações (v22)

- **App instalável** (PWA): no Android, Chrome → menu ⋮ → **Instalar app**; no iPhone, Safari → **Compartilhar → Adicionar à Tela de Início** (iOS 16.4 ou mais novo). Ícone próprio, tela cheia e uma página amigável quando falta internet. Nada do sistema fica guardado no aparelho.
- **Notificações no celular** (`Minha conta → App no celular e notificações`): ativar por aparelho, testar, escolher "só o que pede ação e alertas" (padrão) ou "todos os avisos"; lista de aparelhos com **remover** (celular trocado ou perdido); **Sair** desliga os avisos naquele aparelho.
- O que já aparece no sino pode chegar ao celular: convites de cobertura, aprovações, emergência e não localizados, rematrícula, prazos de contratos, licenças, solicitações, privacidade e ética (sem conteúdo).
- **Segurança**: o servidor só envia para os serviços de notificação dos navegadores (Google, Mozilla, Microsoft, Apple), com conteúdo cifrado de ponta a ponta (padrão Web Push); usuário desativado não recebe; as chaves (VAPID) são geradas e guardadas no banco na primeira vez (ou definidas por `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) e a chave privada nunca aparece em tela nem em exportação.

## Integrações e revisão de segurança (v22)

- **Rotina diária** (`/api/tarefas`) com todos os avisos acima, cada um com chave própria (rodar de novo no mesmo dia não duplica) e cada bloco isolado; limite de execução de 60 s para hospedagens serverless.
- **Command Center**: alertas de emergência real em andamento, aulas sem professor hoje e amanhã, licenças vencidas e vencendo, contratos, brigada, simulado, rematrícula e solicitações atrasadas; **privacidade e ética só para Direção/RH, só em contagem**; o Modo TV nunca mostra os sensíveis.
- **Exportações CSV** novas: rematrícula (com links), coberturas, contratos, licenças, solicitações e autorizações de imagem. Diagnóstico do banco com as áreas novas.
- **Duas revisões independentes de código** (24 achados corrigidos e cobertos por teste): impedimento no canal de ética recalculado a cada acesso; contratos e licenças com as mesmas regras nas telas, no menu e nos anexos; limite de tentativas de CPF fora do alcance do formulário de login; transações sem consultas paralelas (o sistema não trava com muitos acessos ao mesmo tempo — testado com 10 reservas simultâneas); brigada e coberturas sempre conferidas pela unidade do registro; horário dos incidentes no fuso da escola; mensagens de erro das páginas públicas assinadas (um link forjado não exibe texto de terceiros numa página oficial); comprovantes de protocolo saem da tela com "Anotei"; destinos de volta só internos.

## Gestão estratégica (v21)

Do "o que a escola decidiu fazer" ao "está acontecendo?": identidade, mapa, indicadores, OKRs, projetos, plano de ação e rituais de gestão no mesmo lugar, com a **saúde estratégica** calculada por regras visíveis. Menu **Estratégia**: Painel estratégico · Identidade · Mapa estratégico · Indicadores · OKRs · Projetos · Plano de ação · Rituais de gestão · Marketing e captação · Relatório executivo · Assistente IA.

- **Saúde estratégica (0–100)**: média ponderada de cinco componentes — progresso dos OKRs (peso 25), indicadores no alvo e com medição em dia (25), projetos sem risco alto e sem marco atrasado (15), ações do plano em dia (20) e rituais de gestão em dia (15). Componente sem base de cálculo **sai da conta e o peso é redistribuído** (a tela mostra o peso efetivo de cada um); indicador nunca medido fica fora da conta e vira alerta — não vira zero. Faixas: ≥ 75 boa · ≥ 50 atenção · abaixo crítica. Pesos, faixas e tolerâncias em `Configurações → Estratégia`.
- **O que pede atenção**: alertas por regra explícita — ritual atrasado, ata pendente, ação vencida ou bloqueada, indicador fora do alvo, indicador sem medição no período, KR manual sem check-in há 30 dias, objetivo sem KR, identidade não publicada, perspectiva sem objetivo. Painel com perspectivas, indicadores fora do alvo, ações vencidas/bloqueadas, rituais, maturidade dos processos e o que já existia (OKRs, projetos, marcos).
- **Identidade institucional** (`Estratégia → Identidade`): missão, visão, propósito, **valores com a prática observável de cada um**, proposta de valor, posicionamento e horizonte. Versionada: rascunho → vigente → arquivada; só publica com missão, visão e a prática de todos os valores. A instalação cria o rascunho com os 7 valores do Colégio Status (Verdade, Afetividade, Motivação, Criatividade, Segurança, Aprendizagem, Confiança). Só Direção/RH editam e publicam.
- **Mapa estratégico** (`Estratégia → Mapa`): objetivos do ciclo em 5 perspectivas — Financeira, Famílias e alunos, Processos internos, Pessoas e cultura, Aprendizado e inovação. A perspectiva vem do pilar (configurável) ou é definida no objetivo. **Relações de causa e efeito** ("contribui para") entre objetivos do mesmo ciclo; relação inversa e ciclo indireto (A → B → C → A) são recusados. Cada objetivo mostra no mapa a perspectiva, as relações, os indicadores e as ações ligadas.
- **Indicadores** (`Estratégia → Indicadores`): biblioteca com código, perspectiva, área, abrangência (rede ou unidade), unidade de medida, direção (maior é melhor, menor é melhor, faixa), **meta e limite de atenção** com o farol escrito por extenso (ex.: "No alvo: ≥ 85% · atenção: ≥ 75% · fora do alvo: < 75%"), frequência, responsável pela medição e objetivo ligado. Três tipos: **manual** (medição pelo responsável, Direção/RH ou diretor da unidade; correção substitui o valor e o anterior fica na auditoria), **lido do sistema** (22 métricas — ocupação, rematrícula, inadimplência, NPS, retenção, turnover, eNPS, absenteísmo, treinamentos, sucessores, ciência de POPs, SLA, vistorias, candidatos/reservas/matrículas novas do mês, jornada da família, contato recente, ações e rituais em dia; grava o mês atual e, nas contagens mensais, o mês anterior fechado) e **calculado** (numerador ÷ denominador × fator, mês a mês — sem medição ou divisor zero vira "sem base", com o motivo). Série de 13 meses com gráfico, meta e farol de cada ponto; "medição em dia" pela frequência; **importação** colando do Excel ou enviando a planilha (código ou nome; AAAA-MM, MM/AAAA ou data); exportação CSV. A instalação cria **16 indicadores sugeridos, todos lidos do sistema**, um conjunto por perspectiva, com metas sugeridas para a Direção ajustar.
- **Plano de ação 5W2H** (`Estratégia → Plano de ação`): o quê, por quê, onde (unidade/local), quando (início e prazo), quem, como e quanto (custo previsto e real), ligado a objetivo, indicador, projeto ou reunião. Fluxo: a fazer → em andamento → concluída **com evidência** (concluir não comprova o resultado: acompanhe o indicador) · **bloqueada com o que falta e de quem depende** (bloqueio institucional não conta como atraso de quem executa e avisa quem criou) · cancelada com justificativa. Vencida = passou do prazo sem estar bloqueada. Histórico de cada ação (situações, prazos, responsáveis); filtros "vencidas", "bloqueadas", "só as minhas"; exportação CSV. Perfis de unidade criam e veem só a própria unidade (e as da rede).
- **Rituais de gestão** (`Estratégia → Rituais`): reuniões com cadência (diária em dias úteis, semanal, quinzenal, mensal… anual), dono, participantes, pauta padrão, indicadores e objetivos revisados. Cinco **modelos** prontos (abertura do dia da unidade, coordenação semanal, comitê mensal da rede, revisão trimestral, planejamento anual). **Pauta automática** da próxima reunião: encaminhamentos em aberto, indicadores do ritual com farol, objetivos e KRs, decisões com revisão nos próximos 30 dias e a pauta padrão. **Registro da reunião**: presentes, pauta, ata, decisões (uma por linha → **Decision Log** da Governança) e até 6 encaminhamentos com responsável e prazo (→ **plano de ação**, com aviso ao responsável); a foto dos indicadores fica guardada na reunião; a próxima data é calculada pela cadência. Cancelamento exige motivo. Ritual atrasado (além da tolerância) e ata pendente viram alerta; **aderência** = realizadas ÷ esperadas nos últimos 90 dias (ritual novo: sem base). Registram o dono, os participantes, o diretor da unidade e a Direção/RH.
- **Maturidade dos processos**: cada POP recebe nível cumulativo 1–5 — inicial (rascunho) → documentado (vigente) → gerenciado (dono e ciência de toda a equipe) → medido (indicador definido) → controlado (controle e revisão em dia) — e o percentual dos 6 critérios; média por área no painel.
- **Marketing e captação** (`Estratégia → Marketing`): quanto custa trazer uma família, **só com números agregados por mês e canal — nenhum lead individual (não é CRM)**. Investimento mensal por canal (indicação, site, redes sociais, visita, outros — os mesmos canais da origem do candidato em Matrículas) × funil do cadastro: candidatos do mês (sem rematrícula; alunos importados da rede ficam de fora), famílias que reservaram e matrículas novas confirmadas (primeira matrícula do aluno). **Custo por candidato (CPL)**, **custo por matrícula (CAC)**, conversão e reserva → matrícula por canal e na rede, com tendência de 6 meses; sem investimento ou divisor zero = "sem base". Na visão de uma unidade, o gasto da rede não é dividido pelos candidatos da unidade. Comercial e Direção/RH registram o investimento do mês (campo vazio não vira zero).
- **Relatório executivo** (`Estratégia → Relatório executivo`): o mês em uma página para imprimir ou salvar em PDF — resumo para a Direção, saúde estratégica, identidade, indicadores do mês por perspectiva, OKRs, projetos, ações vencidas/bloqueadas e concluídas no mês, reuniões e decisões do mês, captação e alertas.
- **Assistente IA** (opcional, `AI_API_KEY`): rascunhos de leitura executiva, pauta do comitê, prioridades da semana e lacunas de medição. Recebe só os **fatos agregados do painel** (a tela mostra exatamente quais), **sem nomes de famílias ou colaboradores**; toda afirmação cita o fato de origem [E…] e citações inexistentes são removidas e sinalizadas; o rascunho é revisado e aprovado (ou descartado) pela Direção e não altera nenhum dado. Sem a chave, nada é gerado nem simulado. Fica registrado em `Governança → Agentes de IA` como piloto N1.
- **Command Center e Modo TV** ganham a saúde estratégica, indicadores no alvo, ações vencidas/bloqueadas e rituais em dia (a TV só com números agregados).
- **Rotina diária** (`/api/tarefas`) passa a ler os indicadores do sistema e avisar: ritual hoje (dono e participantes), ritual atrasado, ata pendente, ação vencendo em 2 dias, ação vencida, ação bloqueada há mais de 7 dias (quem criou), medição pendente do indicador manual (responsável, uma vez por mês), próximo passo combinado com a família vencido e etapas da jornada vencendo ou atrasadas (responsável da carteira). Cada aviso tem chave própria: rodar de novo não duplica.
- **Quem faz o quê**: identidade, mapa, indicadores da rede e parâmetros — Direção/RH (o diretor define indicadores e posiciona objetivos da própria unidade); ações e rituais — todos os perfis de gestão, cada um no seu escopo; medições — o responsável pelo indicador, o diretor da unidade e a Direção/RH; leitura — todos os perfis de equipe (comercial, financeiro, operações e leitura passam a abrir a Estratégia, que o menu já mostrava). Telas de detalhe conferem a unidade no servidor (acesso por endereço de outra unidade = página não encontrada).

## Radar da família (v21)

Acompanhamento do relacionamento com as famílias que já estudam na rede (`Atendimento → Radar da família`), sem virar CRM: não há lead nem funil de vendas — só a carteira de famílias atuais, a jornada do ano e as interações.

- **Carteira por responsável**: Direção, RH, diretor ou gestor distribuem as famílias (uma a uma na ficha do aluno ou em lote no radar); o responsável recebe aviso. Responsável de outra unidade, candidato e perfil sem atendimento são recusados; cada mudança fica na auditoria. Filtros "minha carteira" e "sem responsável".
- **Segmento por regra explícita**: **risco** = pedido de saída em aberto ou pontuação de risco alta; **atenção** = algum sinal de risco, caso com prazo vencido ou próximo passo combinado com a família vencido; **saudável** = nenhum desses sinais. A pontuação é a mesma de "Famílias em risco" (cada ponto com o motivo). **Jornada atrasada é obrigação da escola**: aparece para quem cuida da carteira, mas não rebaixa a família.
- **Precisa de atenção hoje**: pedido de saída, risco alto, caso vencido e próximo passo vencido, nessa ordem, com o botão de registrar interação.
- **Interações**: data, tipo (ligação, mensagem, reunião, visita, evento), canal, resumo, **percepção da família** (positiva, neutra, negativa — negativa avisa o responsável da carteira) e **próximo passo combinado com data**. A interação pode cumprir uma etapa da jornada.
- **Jornada da família no ano**: etapas com prazo (padrão: boas-vindas, conversa de adaptação, reunião de pais do 1º bimestre, pesquisa do 1º semestre, conversa de rematrícula, pesquisa do 2º semestre), configuráveis por Direção/RH em linhas "Nome | DD/MM"; progresso por etapa no radar; desfazer etapa só Direção, RH ou diretor da unidade.
- **Números do radar**: famílias ativas, saudáveis, em atenção, em risco, pedidos de saída, sem rematrícula, sem contato há mais de N dias (padrão 60), jornada atrasada, NPS dos últimos 180 dias e indicações do ano; **voz da família** só com pesquisas identificadas (resposta anônima nunca aparece com nome).
- **Indicação**: na ficha do candidato, a família da rede que indicou (lista com os alunos atuais); sem origem definida, a origem passa a ser Indicação e conta no funil de captação; a ficha de quem indicou mostra quem ela trouxe. Indicação recíproca e a si mesmo são recusadas.
- **Ficha do aluno** ganha o cartão "Relacionamento e jornada da família" (segmento, carteira, último contato, próximo passo, jornada do ano, interações). Exportação CSV do radar respeitando o escopo da unidade.

## Ajustes gerais (v21)

- **Celular**: em todas as telas, tabelas largas rolam dentro do próprio cartão em vez de alargar a página (antes várias telas — Command Center, ficha do aluno, listas — ficavam mais largas que a tela do celular).
- **Escopo**: "sinais de risco" da família passam a conferir a unidade de quem altera; o diagnóstico do banco mostra as áreas novas (gestão estratégica, radar, OKRs e projetos, matrículas).
- **Conferências no servidor**: ações, indicadores e rituais só se ligam a objetivos, indicadores, projetos e pessoas da rede ou da mesma unidade (responsável precisa estar ativo e na equipe); pauta automática e foto dos indicadores mostram a cada pessoa só o seu escopo; lotes — carteira de famílias, investimentos do mês, reunião com decisões e encaminhamentos — são gravados por inteiro ou nada; registrar uma reunião antiga esquecida não volta a próxima data do ritual; a rotina diária isola cada bloco de avisos (uma falha não impede os demais).
- **Hospedagem**: os avisos informativos do PostgreSQL ("já existe, pulando") não poluem mais o log; a leitura dos indicadores do sistema acontece no máximo uma vez por hora por escopo, mesmo quando todas as métricas estão sem dados.

## Painel do Colaborador e Desempenho V2 (v20)

O desempenho deixa de ser só uma nota: o sistema ajuda a deixar claro o que se espera de cada função, acompanhar o trabalho durante o período, registrar evidências e transformar a avaliação em desenvolvimento verificável. Ciclos criados no formato antigo (competências + Nine Box) continuam funcionando; ciclos com **modelo por família** usam o fluxo abaixo.

- **Painel do Colaborador** (`Colaboradores → ficha → Painel`, ou **Meu painel** para o próprio colaborador): cabeçalho, **próxima ação** de quem está vendo, resumo, desempenho do ciclo, perfil comportamental, situação do desenvolvimento, matriz Atitudes × Resultados, prioridades e evolução. Abas: Visão geral · Expectativas · Metas e evidências · Acompanhamento · Avaliações · Competências · Feedbacks · PDI · Prática docente (professores e coordenação) · Carreira · Histórico. Sem CPF nem salário. Acesso validado no servidor: o próprio colaborador, o gestor direto (só a equipe vinculada), o diretor da unidade e o RH/Direção.
- **Expectativas por cargo** (`Desempenho → Expectativas`): finalidade, responsabilidades, entregas, competências com **nível requerido**, comportamentos observáveis, evidências adequadas e condições necessárias para o trabalho. Perfis versionados (rascunho → vigente → arquivado); ao publicar, cada colaborador do cargo recebe aviso e registra **ciência** (ciência não é concordância).
- **Modelos de avaliação por família** (`Desempenho → Modelos`): a instalação cria um **modelo sugerido em rascunho** para cada família de cargos; o RH revisa critérios, rubricas por nível (1–5), evidência esperada e pesos, e aprova. Só modelo aprovado entra em ciclo; ao sair do planejamento, o modelo **congela** (mudança = nova versão). **Nota composta** (R × A) só quando o modelo declara a finalidade; sem isso, o resultado é o perfil por eixo e critério. Faixas da matriz e da nota final são configuradas e versionadas.
- **Ciclo em 7 fases** (planejamento → acompanhamento → avaliação → calibração → feedback → conclusão → arquivado), uma por vez, com justificativa para voltar. Avaliações geradas por família com **registro da unidade, cargo e gestor da época** — mudança de lotação não altera avaliações antigas nem abre acesso a elas. **Ciclo piloto** mostra tempo de preenchimento, cobertura de evidências, qualidade dos feedbacks, cumprimento de acordos e aplicação do desenvolvimento.
- **Metas com regra explícita**: tipo (operacional, melhoria, aprendizagem, exploratória, coletiva), regra de leitura (maior é melhor, menor é melhor, faixa, sim/não, marcos), situação inicial, esperado, fonte, prazo e regra de interpretação obrigatória. Nunca há "resultado ÷ meta" automático. Exploratória, de aprendizagem e coletiva não viram nota individual; conversão em nota só com tabela aprovada **antes** do ciclo, e apenas sugere nota ao avaliador. Alterar meta com o ciclo em andamento exige justificativa e preserva a original.
- **Acompanhamento contínuo**: atualização curta de andamento (pelo colaborador) e reunião de acompanhamento, sem nota — o que avançou, evidência, bloqueio, apoio, próximo compromisso, compromissos do colaborador e do gestor com prazo e cumprimento. Periodicidade sugerida por família (configurável).
- **Evidências** com natureza (entrega verificável, observação direta, relato, indicador, autoavaliação, contexto), data do fato, fonte, contexto, limitações e visibilidade (padrão: visível ao colaborador). O colaborador **contesta ou complementa**; evidência que apoia mais de um critério é sinalizada (possível dupla contagem). Volume de anexos não soma pontos.
- **Avaliação por critérios**: nota 1–5 com evidência, **não observado** (reduz a cobertura, nunca vira zero) e **N/A** com justificativa e aprovação do RH. Cobertura mínima por eixo (padrão 50% do peso); sem base suficiente, a alçada **encerra como inconclusiva**, sem nota e sem caráter negativo. Memória de cálculo sempre visível. Painel de **qualidade da avaliação**: período observado, evidências por natureza, critérios sem evidência, textos genéricos, divergência ≥ 2 pontos com a autoavaliação, contestações. Trava de versão: duas pessoas não sobrescrevem a mesma avaliação.
- **Calibração e publicação**: só a alçada (RH/Direção); exige justificativa **e** evidência; notas originais preservadas; ninguém calibra nem publica a própria avaliação. Colaborador só vê o resultado depois de publicado; registra ciência ou **contesta**, com resposta registrada. Autoavaliação é perspectiva separada e não entra no cálculo.
- **Múltiplas fontes (opcional por ciclo)**: pares e liderados convidados pelo avaliador ou RH, com a oportunidade de observação registrada; cada grupo é agregado à parte e só aparece com o **mínimo de respondentes** (padrão 3). Quem foi convidado responde em **Contribuições** (qualquer perfil, inclusive colaborador).
- **PDI em três trilhas**: execução das ações, **aplicação no trabalho** e **resultado observado**, registradas separadamente. Ações com compromissos do colaborador e do gestor, recursos, tempo e forma de acompanhamento. Estados de espera (**aguardando apoio institucional, oportunidade ou observação**) não contam como atraso do colaborador e avisam a gestão. Conclusão com evidência vai para validação do gestor. Até 3 prioridades ativas (configurável); pontos fortes podem ser aprofundados e compartilhados. **Plano formal de melhoria** é fluxo próprio (RH, Direção ou diretor da unidade), com expectativas, apoio, prazo final e manifestação do colaborador.
- **Necessidades e encaminhamentos**: cada necessidade recebe uma hipótese (conhecimento, prática, processo, recurso, dependência de outra área, contexto) e um destino — PDI individual, melhoria de processo (abre em Governança), formação coletiva (vai ao Academy), apoio da liderança ou infraestrutura (abre chamado em Operações). Processo, recurso ou dependência **não viram PDI individual**.
- **Prática docente**: planejamento da observação → observação por rubrica (sem dados de estudantes) → devolutiva e foco escolhidos em conjunto → aplicação → nova observação. Formativa e formal são diferentes; só a formal, se definido antes, pode compor a avaliação.
- **Carreira e sucessão**: requisitos da função atual × registros em ciclos publicados, pontos fortes e aspectos a desenvolver, oportunidades internas (vagas abertas), **interesses declarados pelo próprio colaborador** (não se presume que todos queiram liderar). Sucessão por função específica, com requisitos, evidências, lacunas e revisão — sem índice genérico de "potencial".
- **Visão geral** (`Desempenho`): próxima ação por perfil, filtros (ciclo, unidade, área, cargo, gestor, estado), indicadores sempre com o denominador, lista clicável, critérios com mais notas 1–2, ações bloqueadas por motivo, equipes que precisam de apoio no processo (não é ranking), práticas para compartilhar e qualidade do processo por avaliador.
- **Liderança e encaminhamentos** (`Desempenho → Liderança`): radar das **obrigações de gestão** de cada equipe — expectativas alinhadas, acompanhamento em dia, devolutivas feitas, desenvolvimento aplicado e avaliações com evidência — e a lista de encaminhamentos. Não avalia o gestor pela média das notas da equipe.
- **Preparação de avaliadores** (`Desempenho → Avaliadores`): casos simulados respondidos individualmente; depois o avaliador vê a referência e a distribuição do grupo; a discussão vira ajuste de rubrica, não correção automática de notas.
- **Perfil comportamental (DISC)**: só resultado de instrumento identificado, com escala e limitações; apoio a conversas — **não altera nota, matriz, promoção ou liderança**.
- **IA como apoio** (opcional, variável `AI_API_KEY`): rascunhos de síntese, pauta, feedback, sugestões de desenvolvimento e pendências, **com fonte citada** em cada afirmação, filtrados pelo que o usuário já pode ver; o texto passa por revisão humana e nunca atribui nota, publica ou sugere decisão de emprego. Sem a chave, a tela informa que o recurso está indisponível (nada é simulado).
- **Exportação**: `Painel → Exportar CSV do ciclo` (`/api/export/avaliacoes?ciclo=`) calcula tudo pelo mesmo motor das telas, respeitando o escopo de quem exporta.
- **Rotina diária** (`/api/tarefas`) passa a avisar: prazo de avaliação próximo, ação de PDI atrasada, ação aguardando validação, resultado publicado sem ciência há 7 dias, compromisso de acompanhamento vencido e encaminhamento atrasado.

## Governança de IA, Modo TV e formação exigida por cargo (v20)

- **Agentes de IA** (`Governança → Agentes de IA`): inventário de cada agente que apoia a operação — função, ferramenta, área, cargo que apoia, **dono humano obrigatório**, dados que acessa, **limites**, nível de autonomia (N0 consulta · N1 rascunho revisado · N2 executa com aprovação · N3 rotina com log e auditoria) e data de revisão. Agentes com dados de estudantes, saúde ou documentos pessoais ficam em N0/N1. Os agentes aparecem no **Organograma**, ao lado do cargo que apoiam, em outra cor; revisão vencida gera alerta no Command Center.
- **Modo TV** (`/tv`): tela cheia do Command Center para a sala da direção — saúde geral, domínios e alertas, atualizando a cada 5 minutos no horário escolar (6h–20h) e a cada 30 minutos fora dele, só com dados agregados (valores financeiros ficam ocultos na TV). Para uma tela fixa sem login, defina `TV_TOKEN` e abra `/tv?token=SEU_TV_TOKEN` (opcional `&unidade=ID`).
- **Formação exigida por cargo** (`Configurações → Cargos`): informe a formação exigida e o documento que a comprova (ex.: profissional de apoio escolar). Quem ocupa o cargo sem o documento entregue e válido aparece em **Documentos** e gera alerta no Command Center.

## Módulo Operações e manutenção

- **Chamados / ordens de serviço** — qualquer usuário abre (colaborador em autoatendimento inclusive, só na própria unidade); tipo (corretiva, preventiva, melhoria, limpeza, TI, segurança), prioridade com **SLA** (urgente 4 h, alta 24 h, normal 72 h, baixa 10 dias), ambiente, ativo relacionado, responsável, fornecedor, custo previsto e real, evidência, linha do tempo; concluído pede **avaliação do solicitante** (1–5).
- **Ativos e patrimônio** — cadastro e importação CSV por unidade e ambiente, categoria, valor, garantia (alerta 60 dias), **preventiva a cada N dias** com alerta de vencimento e abertura da OS em um clique; concluir a preventiva atualiza o ativo; ativo com chamado aberto fica "em manutenção".
- **Vistorias** — checklists por tipo de ambiente (sala de aula, banheiro, pátio, cozinha, segurança predial — editáveis em Configurações), conformidade por vistoria e por ambiente, e **um chamado automático para cada item não conforme** (itens de segurança entram como prioridade alta).
- **Fornecedores** — cadastro com histórico de OS, custo no ano e avaliação média.
- **Painel** — abertos, SLA vencido, concluídos e tempo médio, preventivas vencidas, custo no mês/ano, conformidade das vistorias, garantias vencendo, satisfação; por tipo e por unidade.
- Perfil **Operações** (módulo completo); gestão também por Direção, RH, diretores e gestores.

## Módulo Estratégia e projetos (DOM-08)

- **OKRs por ciclo** (padrão 2027): objetivos com pilar, dono e abrangência; 2–4 **resultados-chave** com valor inicial, meta, direção (subir/descer) e progresso calculado. KR pode ter **fonte automática** — 22 métricas que o sistema já mede (ocupação 2027, NPS, retenção, inadimplência, régua pendente, turnover, eNPS, absenteísmo, conformidade de treinamento, bench strength, Process Health, ciência de POPs, SLA de chamados, vistorias e, na v21, rematrícula, candidatos/reservas/matrículas novas do mês, jornada da família, contato recente, ações e rituais em dia) — e se atualiza a cada abertura; ou é manual, com **check-ins** (valor, confiança baixa/média/alta, comentário) do dono.
- **OKRs 2027 sugeridos** já carregados a partir do plano de capacidade e dos indicadores do sistema (5 objetivos, 13 KRs) — a Direção edita, apaga ou substitui.
- **Portfólio de projetos**: dono, unidade, objetivo servido, prioridade, prazo, orçamento × gasto, **marcos** com prazo (atrasados em vermelho), **riscos** (probabilidade × impacto), **status report** periódico (feito · próximo · riscos · saúde no rumo/atenção/em risco); projeto em andamento sem status report há 14 dias vira alerta.
- Painel: progresso do ciclo, KRs com confiança baixa, projetos em risco, marcos atrasados, orçamento; card de estratégia no **Command Center**.
- Quem define OKRs: Direção, RH (diretor: da própria unidade). Quem faz check-in e status report: o dono e os gestores. Todos leem.

## Comunicação, anexos e notificações (v19)

**Comunicação (DOM-13)**
- **Comunicados internos**: mural da equipe por público (toda a rede, uma unidade ou um perfil), fixado no topo, com prazo e **ciência obrigatória** ("Li e estou ciente"); RH/Direção veem quantos deram ciência. Publicar gera notificação para o público.
- **Mensagens às famílias e à equipe**: modelos por categoria (cobrança, matrícula, atendimento, pedagógico, RH, geral) com variáveis `{responsavel} {aluno} {valor} {data} {competencia} {turma} {protocolo} {unidade}`; envio por **WhatsApp** — com a API oficial configurada (`WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`, Meta Cloud API) envia direto; sem API, gera o link `wa.me` com o texto pronto para enviar do celular e marcar como enviada — ou por **e-mail** (Resend). Tudo fica no histórico com quem enviou, canal, situação e o registro de origem (caso, título, aluno).
- Botões de mensagem já embutidos: **Inadimplência** (cobrança por família, com modelo escolhido pelo atraso), **Caso de atendimento** (retorno à família) e **Ficha do aluno**.

**Anexos (DOM-15)**: qualquer registro pode receber arquivos (PDF, imagem, Word, Excel, texto; até 8 MB, guardados no próprio banco): ficha do colaborador, aluno, caso, chamado, projeto, POP. Download só para quem tem acesso ao registro (escopo por unidade; colaborador só à própria ficha e a seus chamados). Toda inclusão e remoção fica na auditoria.

**Notificações (DOM-15)**: sino no topo com contagem, página `/notificacoes`, e avisos gerados por eventos — comunicado publicado, chamado/caso atribuído, chamado ou caso urgente (diretor da unidade), pedido de férias, exceção, desconto acima da alçada e requisição de vaga aguardando aprovação. A rotina diária `GET /api/tarefas?token=SETUP_TOKEN` (agende no Railway Cron ou em qualquer serviço de cron, 1× por dia) expira reservas, escalona SLAs vencidos, expira exceções, gera alertas de prazo (SLA, chamados fora do prazo, documentos vencendo, pendências de aprovação) e, com Resend configurado, envia o **resumo diário por e-mail** a cada usuário.

## Importação de planilhas (v18)

- Todas as telas de importação (colaboradores, alunos, banco de horas, títulos, caixa, ativos, candidatos, pesquisas, inadimplência) aceitam **enviar o arquivo** (.xlsx, .xls, .csv, .txt) ou **colar as células copiadas do Excel**.
- Separador reconhecido automaticamente: tabulação (cópia do Excel), ponto e vírgula (CSV brasileiro) ou vírgula. CSV salvo em ANSI (padrão do Excel em português) é lido corretamente.
- Cabeçalhos com acento, maiúsculas e variações são aceitos: Admissão, E-mail, Vínculo, Jornada (min/dia), Data de admissão, Celular, Função…
- Planilha Excel: a primeira aba é lida; células de data viram DD/MM/AAAA; unidade aceita nome ou código (CAR, TVM1, TVM2, CUL).

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
**v22:** basta publicar o código (inclua a pasta `public`, nova nesta versão: ícones, app e notificações). Na primeira subida o servidor cria as 26 tabelas novas e a coluna `classes.space_id`, e carrega o que os módulos precisam para começar: as finalidades das autorizações de imagem, os 5 tipos de solicitação e o **contrato de rematrícula em rascunho**. Nada do que já existe é alterado. Depois, uma vez:
1. `Matrículas → Rematrícula → Contrato`: cole o contrato oficial (sem o aviso de rascunho) e publique; então gere os links.
2. `Governança → Privacidade (LGPD)`: encarregado (DPO), prazos e textos das autorizações de imagem.
3. `Governança → Canal de ética`: comitê, prazos; imprima o **QR code** do canal, publique as regras de conduta (ciência obrigatória) e crie o treinamento anual.
4. `Operações → Mapa de salas`: cadastre os espaços e ligue as turmas às salas; `Pessoas → Substituição de professores → Grade horária`: importe a grade.
5. `Operações → Portaria e segurança`: brigada de cada unidade; `Licenças e alvarás`: documentos de cada unidade; `Contratos de fornecedores`: contratos vigentes.
6. Cada pessoa ativa as notificações no celular em `Minha conta`. Variáveis novas, todas opcionais: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (sem elas, as chaves são geradas e guardadas no banco).
As páginas públicas novas (`/etica`, `/privacidade`, `/rematricula/<link>`) abrem sem login; o resto continua exigindo login. A rotina diária (`/api/tarefas`) é a mesma de antes e já inclui os avisos novos.

**v21:** basta publicar o código. Na primeira subida, o servidor cria as tabelas novas (identidade, indicadores, plano de ação, rituais, reuniões, interações e jornada das famílias, rascunhos do assistente) e as colunas novas (carteira e indicação no aluno, perspectiva no objetivo, reunião de origem na decisão), cria a **identidade em rascunho** com os 7 valores, os **16 indicadores sugeridos** (lidos do sistema) e registra o Assistente estratégico no inventário de agentes de IA. Nada do que já existe é alterado ou apagado.

**A partir da v20.2 a atualização do banco é automática:** ao publicar uma versão nova, na primeira vez que o servidor sobe o sistema compara o banco com o que o código precisa e aplica sozinho o que faltar (tabelas, colunas, índices e dados-base, como os modelos de avaliação sugeridos em rascunho — revise e aprove em `Desempenho → Modelos` antes de abrir um ciclo). Não é mais preciso abrir `/api/setup` a cada atualização. Para desligar: variável `AUTO_MIGRAR=0`.

- **Aviso e botão:** se algo ficar pendente, Direção e RH veem no topo de qualquer tela o aviso "banco de dados desatualizado" com o botão **Atualizar banco agora**.
- **Diagnóstico:** `Configurações → Banco de dados` compara o código com o banco real e mostra, por área, as tabelas e colunas que faltam e as instruções que não puderam ser aplicadas, com o erro.
- **Uma falha não trava o resto:** cada instrução é aplicada separadamente. Um dado antigo incompatível (ex.: registros duplicados impedindo um índice único) vira uma pendência listada; corrigido o dado, é só aplicar de novo.
- **Tela de erro do sistema:** em vez da página branca "Application error: a server-side exception has occurred", a tela mostra o código do erro e o caminho da correção. Variáveis novas, todas opcionais: `TV_TOKEN` (tela fixa do Modo TV), `AI_API_KEY` e `AI_MODEL` (apoio de IA no desempenho).

Substitua os arquivos no GitHub (ou rode `railway up` de novo, se usou Railway). A partir da v20.2 o banco se atualiza sozinho; abrir `https://SEU-ENDERECO/api/setup?token=SEU_SETUP_TOKEN` continua funcionando como alternativa manual: isso cria as tabelas novas (por exemplo, as do módulo de Matrículas) e carrega a grade 2027, sem tocar nos dados que já existem.

### Se aparecer "Application error: a server-side exception has occurred" em várias telas
Quase sempre é código novo publicado com o banco ainda no esquema antigo: as telas que usam tabelas ou colunas novas quebram e as outras funcionam. Na v20.2 isso se corrige sozinho na subida do servidor; se persistir, entre como Direção/RH e use **Configurações → Banco de dados → Aplicar atualizações do banco**. As pendências listadas ali indicam exatamente o que falta.

### Se a Vercel mostrar "This Deployment is paused by the owner" (503 · DEPLOYMENT_PAUSED)
O sistema não quebrou e **nenhum dado se perde**: os dados ficam no banco (Neon), não na Vercel. A Vercel suspendeu a hospedagem. Causas mais comuns: limite mensal do plano gratuito (Hobby) estourado, limite de gastos configurado no plano pago, pausa manual ou uso fora das regras do plano — o plano Hobby é só para uso pessoal e não comercial, e um sistema de gestão da escola é uso institucional. A Vercel manda um e-mail explicando o motivo.
1. Abra o e-mail da Vercel e o painel do projeto em vercel.com.
2. Se aparecer **"Paused — Upgrade to resume service"**: assine o plano **Pro** (volta na hora) ou migre para outra hospedagem. Ficar no Hobby exige esperar a janela de 30 dias baixar do limite e pedir o desbloqueio em vercel.com/help.
3. Se o projeto foi pausado manualmente ou por limite de gastos (Pro): **Settings → Resume** ou ajuste o limite em **Spend Management**.
4. Use **um único endereço oficial** (Vercel Pro ou Railway), apontando para o mesmo banco Neon, e remova a cópia que não for usada.
A v20.1 desliga o carregamento antecipado de links (prefetch): antes, cada tela aberta chamava o servidor uma vez para cada link visível do menu. Isso reduz bastante o consumo de execuções e CPU em qualquer hospedagem.

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

Estratégia (v21): todos os perfis de equipe leem; identidade, mapa, indicadores da rede e parâmetros são da Direção/RH (diretor: indicadores e objetivos da própria unidade); ações e rituais são criados por todos os perfis de gestão no seu escopo; medição de indicador é do responsável, do diretor da unidade e da Direção/RH (investimento em captação também do Comercial). Radar da família: atendem Direção, RH, diretor, gestor e Comercial; distribuem a carteira Direção, RH, diretor e gestor; configuram a jornada Direção/RH.

v22: **Rematrícula** — painel e links para quem reserva vagas (Direção, RH, diretor, gestor, comercial); contrato só Direção/RH. **Substituição de professor** — coordenação (gestor, diretor da unidade, Direção, RH) registra ausências, distribui e confirma coberturas; professor responde convites e avisa ausência; leitura consulta. **Espaços** — operações e gestão cadastram e ligam turmas às salas; todos reservam (leitura não). **Portaria** — perfis configuráveis (padrão: Direção, RH, diretor, gestor, operações, comercial); restrição de retirada e exceções só coordenação/direção. **Privacidade** — Direção, RH e o encarregado. **Canal de ética** — só o comitê (sem os impedidos) e a Direção/RH configuram. **Solicitações** — todos abrem (conforme o tipo); decide quem está na etapa. **Contratos** — Direção, Financeiro, Operações, RH, diretor da unidade (leitura consulta); **licenças** — os mesmos, sem o Financeiro.

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

Testes de ponta a ponta (servidor em `next start -p 3100`, Python 3 + `requests`): `python3 scripts/e2e.py` (Pessoas), `python3 scripts/e2e_matriculas.py` (Matrículas) `python3 scripts/e2e_ponto.py` (Ponto; gere antes as planilhas de teste com `node scripts/make_planilha_teste.js`) `python3 scripts/e2e_atendimento.py` (Atendimento) `python3 scripts/e2e_governanca.py` (Governança), `python3 scripts/e2e_talento.py` (Cargos/Desempenho/Recrutamento) `python3 scripts/e2e_clima_academy.py` (Clima/Academy) `python3 scripts/e2e_sucessao_analytics.py` (Sucessão/Analytics), `python3 scripts/e2e_gestao.py` (Gestão estratégica: identidade, mapa, indicadores, plano de ação, rituais, saúde, marketing, assistente, rotina), `python3 scripts/e2e_radar.py` (Radar da família), v22: `e2e_rematricula.py`, `e2e_cobertura.py`, `e2e_espacos.py`, `e2e_portaria.py`, `e2e_privacidade_etica.py`, `e2e_solicitacoes.py`, `e2e_rotina_v22.py` (rotina e Command Center) e `e2e_pwa.py` (app e notificações no navegador real, com Playwright; suba o servidor com `NODE_TLS_REJECT_UNAUTHORIZED=0 PUSH_HOSTS_EXTRA=localhost`, só para o teste, porque o serviço de notificação de teste é local) — e os demais `scripts/e2e_*.py`. Testes unitários dos cálculos: `npx tsx scripts/test_avaliacao.ts` (motor de avaliação) e `npx tsx scripts/test_gestao.ts` (farol, razões, períodos, rituais, aderência, saúde estratégica, maturidade, funil, jornada, segmento e prompt do assistente).

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
src/lib/gestao-calc.ts   cálculos puros da gestão (farol, razões, períodos, cadência e aderência de rituais, saúde estratégica, maturidade, funil, jornada, segmento) — testados em scripts/test_gestao.ts
src/lib/gestao-estrategica.ts indicadores (série, farol, leitura do sistema), identidade, maturidade, painel e alertas, pauta automática, plano de ação, marketing
src/lib/metricas-extra.ts métricas novas lidas do sistema (rematrícula, funil de captação por origem, jornada, contato, ações e rituais em dia)
src/lib/radar-familia.ts radar da família (carteira, segmento, atenção hoje, jornada, voz) e relacionamento na ficha do aluno
src/lib/gestao-rotina.ts avisos diários da gestão e do radar (chamados por /api/tarefas)
src/lib/ia-estrategia.ts · ia-estrategia-prompt.ts fatos do painel e prompt do assistente estratégico (citações conferidas)
src/app/(app)/estrategia/{identidade,mapa,indicadores,acoes,rituais,reunioes,marketing,relatorio,assistente}  telas da gestão estratégica · gestao-actions.ts
src/app/(app)/atendimento/radar · radar-actions.ts  Radar da família
src/lib/rematricula.ts · src/app/rematricula/[token] · src/app/(app)/matriculas/rematricula   rematrícula por link (contrato, painel, página da família)
src/lib/cobertura.ts · src/app/(app)/cobertura/{,minha,grade,historico}   substituição de professor (grade, ausências, sugestões, banco de horas)
src/lib/espacos.ts · src/app/(app)/operacoes/espacos/{,reservas,cadastro}   mapa de salas e reservas
src/lib/seguranca.ts · src/app/(app)/operacoes/seguranca/{,brigada,emergencias}   portaria, retirada de alunos, simulados, brigada
src/lib/privacidade.ts · src/app/privacidade · src/app/(app)/governanca/privacidade   LGPD (portal do titular, autorizações, incidentes)
src/lib/etica.ts · src/app/etica · src/app/(app)/governanca/etica   canal de ética (impedimentos recalculados a cada acesso)
src/lib/solicitacoes.ts · src/app/(app)/solicitacoes   central de solicitações e aprovações
src/lib/contratos.ts · src/app/(app)/operacoes/{contratos,licencas}   contratos de fornecedores, licenças e alvarás
src/lib/push.ts · src/app/api/push · public/{sw.js,manifest.webmanifest,offline.html,icons}   app instalável e notificações no celular
src/lib/rotina-v22.ts · alertas-v22.ts · export-v22.ts · limite.ts · aviso.ts   rotina diária, alertas do Command Center, CSVs, limite anônimo e erros assinados das páginas públicas
src/lib/avaliacao.ts     motor de avaliação (cálculo por eixo, cobertura, N/A, não observado, faixas, metas, fontes, PDI) — testado em scripts/test_avaliacao.ts
src/lib/avaliacao-server.ts único ponto de cálculo usado por telas, ações e exportações
src/lib/desenvolvimento.ts acesso por escopo (próprio, gestor da equipe, unidade, RH), perfil vigente do cargo, alertas diários do desempenho
src/lib/ia-desempenho.ts  prompts com fontes citáveis, validação da resposta, chamada opcional (AI_API_KEY)
src/app/(app)/desempenho/{modelos,expectativas,lideranca,treinamento,ciclos,avaliacoes}  telas do desempenho V2
src/app/(app)/colaboradores/[id]/painel  Painel do Colaborador · src/app/(app)/contribuicoes  respostas de múltiplas fontes
src/app/(app)/governanca/agentes  inventário de agentes de IA · src/app/tv  Modo TV do Command Center
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

Modelo de dados: `companies`, `units`, `positions`, `employees`, `users`, `leave_requests`, `hour_entries`, `processes` + `process_items`, `documents`, `audit_log`, `settings`, `login_attempts`; Matrículas: `grades`, `classes`, `students`, `enrollments`, `waitlist`; Ponto: `schedules`, `calendar_days`, `timesheet_days`, `import_batches`; Atendimento: `cases`, `case_events`, `surveys`; Governança: `procedures`, `procedure_versions`, `procedure_acks`, `exceptions`, `controls`, `control_runs`, `nonconformities`, `decisions`; Talento: `salary_grades`, `salary_history`, `perf_cycles`, `perf_reviews`, `perf_goals`, `perf_checkins`, `requisitions`, `candidates`, `applications`, `application_events`; Clima/Academy: `climate_surveys`, `climate_responses`, `climate_actions`, `courses`, `training_progress`, `training_sessions`, `session_attendance`, `training_needs`; Sucessão/Analytics: `critical_positions`, `successors`, `talent_reviews`, `talent_review_items`, `ai_log`; Financeiro: `receivables`, `collection_actions`, `agreements`, `agreement_installments`, `discounts`, `tuition_prices`, `cash_entries`, `cash_balances`, `budgets`; Command Center: `health_snapshots`, `exec_pending`; Operações: `assets`, `work_orders`, `work_order_events`, `inspections`, `suppliers`; Estratégia: `objectives`, `key_results`, `kr_checkins`, `projects`, `milestones`, `project_updates`, `project_risks`; Gestão estratégica (v21): `strategy_identity`, `objective_links`, `indicators`, `indicator_values`, `action_plans`, `rituals`, `ritual_meetings`, `strategy_ai_drafts`; Radar da família (v21): `family_contacts`, `family_journey` (e `students.carteira_user_id`, `students.indicado_por_id`); v22: `rematricula_links`, `contract_templates`, `teacher_slots`, `cover_absences`, `cover_assignments`, `spaces`, `space_bookings` (e `classes.space_id`), `visits`, `pickup_authorizations`, `early_departures`, `brigade_members`, `emergency_events`, `emergency_checks`, `emergency_failures`, `consent_purposes`, `consents`, `privacy_requests`, `privacy_incidents`, `ethics_reports`, `ethics_messages`, `request_types`, `requests`, `request_events`, `contracts`, `licenses`, `push_subscriptions`. Tudo em português nos rótulos, inglês nos nomes técnicos — seguindo o Bloco 15 do STATUS ONE.

---

## 6. O que fica para a próxima versão

- Exportar o **plano de cargos e salários completo em Excel** (fatores, ranking de cargos, tabelas por grupo, curva e enquadramentos) a partir do módulo Cargos e Salários.
- Integração direta com o relógio de ponto (REP) e escalas rotativas.
- Folha de pagamento e eSocial (DOM-06) — por decisão, fora desta versão; a integração é com o contador/sistema atual.
- CRM de captação (leads individuais), acadêmico (notas, frequência, diário, grade de aulas do aluno, biblioteca, processo seletivo) e ampliação do Financeiro (faturamento, cobrança, contabilidade, folha) — fora do STATUS ONE por decisão; o sistema cobre matrículas e rematrícula, retenção, relacionamento com as famílias atuais e o custo de captação em números agregados.
- Portal dos pais, agendamento pelos pais e autorização de passeio pela família — na **Agenda Eletrônica**, com o ONE como retaguarda (o passeio já tem a aprovação interna na central de solicitações).
- Enfermaria e saúde do aluno — depois do bloco de privacidade, com desenho próprio de LGPD (dado de saúde é sensível).

Segredos (`AUTH_SECRET`, `SETUP_TOKEN`, senha do banco) nunca devem ser enviados por mensagem nem colocados no GitHub. O arquivo `.env` está no `.gitignore` por isso.
