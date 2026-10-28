# STATUS ONE — Pessoas, Matrículas, Atendimento, Governança, Financeiro, Operações, Estratégia, Insights e Command Center

Sistema do Colégio Status com os módulos e o painel executivo no mesmo login, mesmas unidades e mesma auditoria: **Pessoas** (DOM-05 completo), **Matrículas 2027** (DOM-03), **Atendimento e retenção da família** (DOM-12, com o **Radar da família**), **Governança e POPs** (DOM-07), **Financeiro** (DOM-04 — camada de gestão sobre o ActiveSoft, com **orçado × realizado**), **Operações** (com portaria e segurança, mapa de salas, contratos e licenças), **Estratégia** (DOM-08, com a **gestão estratégica** completa), **Solicitações e aprovações**, **Privacidade (LGPD)** e **Canal de ética**, **Comunicação**, **ONE Insights** (Painel Executivo, central de fluxos e SLA, minhas pendências, busca e mural) e **Command Center** (DOM-14 — visão única da Direção). No celular, o ONE instala como app e manda as notificações. Versão atual: **v29** (esquema do banco 29.0) — mesclada com a obra **“STATUS ONE · A Nova Arquitetura · Edição Integral Referenciada v3”**, com a rastreabilidade de cada tela, KPI e regra em `Governança → Nova Arquitetura`.
## O que chegou na v30 — o que as plataformas de RH mostram e o ONE ainda não tinha

Pedido: "veja o que não temos e inclua", a partir de ~50 telas de plataformas de RH (SAP SuccessFactors, Workday, Oracle, HiBob, BambooHR, Rippling, ADP, Deel, Lattice, 15Five, Leapsome, Greenhouse/Gem, Lever, Personio e outras). O que o ONE já tinha (funil por vaga, aderência e shortlist, retenção e motivos, clima comparado, Payroll Bridge, custo de folha por unidade, People Analytics, Nine Box em contagens, Meu espaço, contas a pagar) ficou; entrou o que faltava. Continuam **fora, de propósito**: busca automática em LinkedIn/redes, entrevista por voz com IA e triagem conversacional (LGPD), benchmark salarial de mercado (sem fonte confiável) e garantia de reposição (coisa de agência).

### Ficha completa e quem é quem (`Pessoas → Organograma e quem é quem`, ficha, `Meu espaço`)
- **Organograma de pessoas** pelo gestor direto da ficha (equipe direta · total abaixo, busca, unidade, amplitude, sem gestor) com o painel **Quem é quem** (cargo, unidade, a quem responde, equipe, tempo de casa, **ramal** e **e-mail institucional**) — aberto a todos os logins com ficha; a pessoa pode pedir para mostrar só nome, cargo e unidade. A aba **Cargos e ocupação** (o organograma antigo) fica com a gestão.
- Ficha com **Sexo (eSocial)**, **Ramal**, **E-mail institucional**, **No quem é quem** e **Empresa (CNPJ)**; a **importação** aceita as colunas `sexo`, `ramal`, `email_institucional` e `quem_e_quem` e **completa** esses campos nas fichas que já existem (sem mexer no resto).
- **Histórico funcional**: toda edição que muda cargo, nível, unidade, CNPJ, gestor, vínculo, jornada, turno ou regime vira um fato com **data de vigência**, motivo e "foi promoção" (promoção › transferência › cargo › nível › efetivação/vínculo › gestor › jornada); **Lançar fato passado** para o que é de antes do sistema; exclusão com motivo; admissão e desligamento automáticos; a admissão gravada pelo sistema não contradiz a promoção que veio depois.
- **Formação e qualificações** (o colaborador informa no Meu espaço, o RH valida ou recusa com motivo; maior titulação validada) e **itens sob responsabilidade** (entrega pela ficha ou por `Operações → Itens com colaboradores`, ciência do termo pelo Meu espaço, devolução com condição; o **desligamento não conclui** com item pendente).
- Abrir a ficha de outra pessoa ficou restrito a RH, Direção, Direção da unidade, Coordenação e Consulta (no escopo); líderes de outras áreas abrem só a equipe direta.

### Composição e igualdade salarial (`Pessoas → Composição da equipe`, `Igualdade salarial e diversidade`)
- **Composição**: indicadores com minigráfico (quadro, contingente, destaques, tempo de casa, idade, amplitude, mulheres no quadro e na liderança), quadro por vínculo em 12 meses, movimentações por tipo e taxa de promoção, **ponte do quadro** por unidade, **titulação do corpo docente** e o **quadro numa data** — tudo reconstruído pelo histórico funcional.
- **Igualdade salarial** (Lei 14.611/2023 · CLT art. 461): mulheres no quadro e na liderança, remuneração **no mesmo cargo e nível** (grupo mínimo de 3 + 3; horistas pelo valor da hora; acima de 5% pede critério objetivo), diferença bruta, composição e liderança por unidade, e o **relatório semestral de transparência** por CNPJ com 100+ (pendência de março e setembro; registro de onde publicou; plano de ação obrigatório quando há diferença). Só RH e Direção.

### Recrutamento (`Recrutamento → Quadro de candidatos`, vaga, `Indicadores`)
- **Quadro de candidatos** de todas as vagas por etapa (parado há N d, notas 1/3, precisa de decisão, entrevista, documentos, proposta há N d, aderência · sugerido).
- **Avaliadores com notas independentes** (critérios 1–5, Forte sim/Sim/Não/Forte não, pontos fortes e de atenção; o consolidado e a divergência ≥ 2 pontos só depois de enviar; pendência com prazo; o avaliador não vê contato do candidato).
- **Vaga pausada** (sai da página, o prazo é estendido pelos dias de pausa), **proposta** com data, resposta e motivo de recusa, **experiência do candidato** (4 perguntas anônimas no portal; mínimo de 5), **contratação aos 90 dias** (o gestor dá a nota) e o **índice de qualidade da contratação** (retenção + gestor + 1ª avaliação).
- Indicadores: **saúde de cada vaga** (0–100, explicável), **projeção** de candidaturas e contratações do próximo mês, **tempo para preencher** por unidade e por cargo, propostas, experiência e qualidade.
- **Página pública de vagas** (`/vagas`, `/vagas/<vaga>`): vagas marcadas para publicar, candidatura sem login com o link pessoal do portal, limite por endereço e por hora, aviso LGPD. **Nasce desligada — só a Direção liga, depois do GO.**

### Liderança, calibração e metas
- **Pesquisa de liderança** (tipo Liderança em `Clima e eNPS`): sete dimensões sobre o gestor direto, anônima; índice de efetividade, pontos de atenção com ações sugeridas, comentários só para RH e Direção; resultado por gestor só com 5+ respostas. O gestor vê o próprio em **Minha equipe → Liderança na visão da equipe**.
- **Minha equipe → Semana da equipe**: o dia a dia do ponto de cada pessoa (✓, F, J, Fé/Fo), trabalhado × previsto, horas extras aprovadas em 8 semanas, navegação entre semanas e a última semana importada.
- **Calibração**: distribuição real × **referência** (15/70/15, sem cota), **consistência dos avaliadores** e **Nine Box com as pessoas**. **Painel de metas** (`Desempenho → Painel de metas`) com metas ligadas a objetivos e resultados-chave.

### Academy, benefícios e relatório sob medida
- **Academy**: custo por participante e da turma, instrutor, **inscrição aberta** (com ou sem aprovação do gestor, `Academy → Aprovar inscrições`), **avaliação de reação**, **certificado** com código de conferência (o RH confere na lista de participantes do curso) e o **painel de aprendizagem** (obrigatórios em dia, vencidos, horas, horas por colaborador, investimento, reação, mais concluídos e mais bem avaliados).
- **Benefícios** (`Pessoas → Benefícios`): catálogo com elegibilidade (vínculo, unidade, jornada mínima) e carência, VT com desconto de no máximo 6% (Lei 7.418/1985), dependentes, **bolsa para filho(a) aluno(a)** (mensalidade da série × %), exceção à regra com justificativa, **elegíveis sem adesão**, **movimentações do mês** (vão no pacote da folha), custo por benefício e por unidade; o desligamento encerra as adesões. **Remuneração total** estimada no Meu espaço e na ficha.
- **Relatório sob medida** (`Pessoas → Relatório sob medida`): fonte (colaboradores, férias e ausências, treinamentos, movimentações, benefícios, desempenho), colunas, filtros, agrupar/quebrar, contar/somar/média, gráfico, salvar e compartilhar, CSV — sempre com o acesso de quem monta (unidade, salário, dados pessoais; CPF nunca).
- **Nove indicadores** de capital humano no catálogo (30.0): HCROI, receita por colaborador, amplitude de controle, mulheres na liderança, qualidade da contratação, horas de treinamento por colaborador, promoções (12 meses), aceite de propostas e índice de liderança.

### Banco e testes
- Migração automática **30.0**: tabelas `employee_moves`, `employee_qualifications`, `employee_items`, `pay_transparency_reports`, `interview_feedback`, `hire_feedback`, `candidate_experience`, `public_application_log`, `training_enrollments`, `training_feedback`, `benefit_plans`, `benefit_enrollments` e `custom_reports`; colunas novas em `employees` (sexo, ramal, email_institucional, no_diretorio), `requisitions` (pausa, publicação, slug, visualizações), `applications` (etapa_desde, proposta, experiência), `climate_responses.gestor_id`, `courses` (custo, instrutor, inscrição), `training_sessions.custo`, `training_progress.certificado` e `perf_goals` (objetivo e resultado-chave). Uma vez por banco: o histórico funcional começa com admissões, desligamentos e as promoções do histórico salarial (`settings.v30_historico`), e as telas novas entram nos cargos com lista personalizada (`settings.v30_telas`).
- `scripts/e2e_v30_pessoas.py`, `e2e_v30_recrutamento.py`, `e2e_v30_desempenho_academy.py` e `e2e_v30_beneficios_relatorios.py` (28 blocos) e a regressão completa das 44 suítes. `scripts/demo_v30.py`: dados fictícios da demonstração.

## O que chegou na v29 — acesso pelo cargo (o auxiliar não vê o que o gerente vê)

Pedido da Direção e do RH: "os usuários devem ser cadastrados pelo cargo — as funcionalidades pelo cargo, não por perfil; senão eu clico pessoa por pessoa o que ela vê; o auxiliar financeiro não vê o que o gerente financeiro vê". Agora o acesso é configurado **uma vez por cargo**: quem tem o cargo entra com aquele acesso; promoveu ou mudou o cargo na ficha, o acesso muda na próxima tela; desligou, o login deixa de entrar. Nada do que cada pessoa via muda na atualização — o RH revisa com calma.

### Cargo → atuação, telas e aprovações (`Configurações → Acesso por cargo`, `/configuracoes/acessos`)
- **Atuação** (o antigo "perfil", agora do cargo): como a pessoa trabalha dentro das telas e o **alcance** (a unidade dela ou a rede). Nove atuações: Direção, RH, Direção da unidade, Coordenação, Financeiro, Comercial e atendimento, Operações e manutenção, Consulta (somente leitura) e Autoatendimento.
- **Telas**: o catálogo é o próprio menu da atuação; o cargo desmarca o que não deve ver — some do menu e o endereço passa a mostrar **Tela fora do seu acesso** (com o cargo e a quem pedir). Cargo com todas as telas recebe sozinho as telas de versões futuras. As pessoais (Início, Minha conta, Notificações, Meu espaço, Minha ficha, Minhas pendências) ficam sempre.
- **Aprovações**: as 14 aprovações (as 12 alçadas + baixa manual de contas a pagar + segundo aprovador da comunicação em massa) marcadas **cargo a cargo**, ou "seguir o padrão da atuação" (`Configurações → Aprovações — padrão de cada atuação`). **Alçada de desconto (%) por cargo** (vazio = padrão da atuação).
- **Matriz de acesso**: cargos (atuação, alcance, telas, aprovações, logins/fichas), **quem vê cada tela** (por grupo do menu), **quem aprova o quê** (grade editável com o desconto) e **fora do padrão** (exceções, substituições, contas sem ficha, fichas sem cargo). Selo **sugerida** para o cargo cuja atuação veio só do nome, até alguém confirmar.
- **Editor do cargo**: atuação (trocar mostra o catálogo antes de salvar), telas por grupo com todas/nenhuma e contador, aprovações, desconto, pessoas do cargo, **copiar de outro cargo** e **como fica o menu**. Cargo novo (`Configurações → Cargos e organograma`) já nasce com a **Atuação no sistema**.

### Usuário pela ficha
- **Novo acesso**: escolher a pessoa (ficha) e clicar em **Criar acesso** — não há perfil para escolher: atuação, telas, aprovações e unidade vêm do cargo; nome e e-mail em branco vêm da ficha; senha em branco gera uma **senha temporária** mostrada uma vez (troca obrigatória no primeiro acesso). Uma ficha, um acesso; ficha desligada não ganha acesso ativo; autoatendimento sempre com ficha.
- **Acessos em lote (pelo cargo de cada ficha)**: cada pessoa já entra com o acesso do próprio cargo (professor: autoatendimento; coordenação: a da coordenação; auxiliar financeiro: o do auxiliar). No editor do cargo, **Criar os acessos das N ficha(s) deste cargo** faz o lote só daquele cargo.
- **Ver acesso** (`/configuracoes/acessos/usuario/<id>`): o menu exato, a origem (cargo, exceção, ficha sem cargo, conta sem ficha), o que aprova, a alçada de desconto e os atalhos do celular. A ficha mostra a linha **Acesso ao sistema** (RH e Direção).
- **Exceção individual** (motivo obrigatório, à vista na Matriz e na lista, "voltar ao acesso do cargo") e **substituição temporária** (soma o acesso de outro cargo até uma data — no máximo 1 ano — e termina sozinha; "encerrar agora").
- **Conta sem ficha** para contabilidade externa, consultoria, TI e homologação: atuação, telas e aprovações na própria conta.
- **Desligamento** concluído encerra o login na hora (auditoria; a tela de entrada avisa "acesso encerrado"). **Trava de segurança**: o sistema recusa a mudança que deixaria a rede sem ninguém de RH/Direção com Configurações e Acesso por cargo.

### O que passa a respeitar o acesso do cargo
- Menu, endereço (bloqueio no servidor → `/sem-acesso`), **Início** (blocos e atalhos), **Minhas pendências**, **busca** (Ctrl+K), Pergunte ao Status, **exportações e APIs** (403) e o **Painel financeiro** (números, alertas e atalhos só das telas do cargo; sem o botão Importar para quem não tem a aprovação de títulos e orçamento).
- **Liderança fora da área de pessoas**: cargo de outra área com a aprovação de férias ou banco de horas aprova só a **própria equipe** (gestor direto na ficha) e ganha a **Minha equipe**; avisos e e-mails dos pedidos vão para a gestora direta.
- **Quem aprova**: avisos e e-mails vão para quem tem a aprovação no cargo; os textos "Aprovam:" e a alçada de desconto mostram **cargos** ("em substituição" durante a substituição; contas sem ficha pela atuação).
- **Importar títulos, preços e orçamento** exigem também a aprovação "financeiro" do cargo (o auxiliar opera, não importa nem orça).
- **Solicitações**: etapa por cargo (`Gerente financeiro | cargo Gerente Financeiro`, ou o nome exato do cargo). **Comunicados**: público **Um cargo**.
- Nomes: perfil → atuação; Diretor de unidade → Direção da unidade; Gestor → Coordenação; Somente leitura → Consulta; Colaborador → Autoatendimento; Comercial / Atendimento → Comercial e atendimento. O botão da barra de contexto virou **Padrão da atuação**.

### Banco e testes
- Migração automática **29.0**: `positions.acesso` (atuação, telas, aprovações, desconto, quem revisou), `users.acesso` (exceção ou conta sem ficha), `users.substituicao`, `users.aprova`, `users.origem_acesso`, `users.desconto_pct`, `announcements.position_id` e índices. Conversão única (`settings.acesso_v29`) **sem mudar o que cada pessoa vê**: o cargo recebe a atuação da maioria de quem já tinha login nele (ou a sugerida pelo nome, com o selo "sugerida"); quem tinha perfil diferente do cargo fica com exceção "Acesso mantido da versão anterior"; logins sem ficha viram contas sem ficha.
- A sessão é recalculada do banco a cada tela (o token só identifica a pessoa); a rotina diária (`/api/tarefas`) recalcula todos os acessos (substituições vencidas, desligamentos).
- `scripts/e2e_acesso_cargo_v29.py` (18 blocos: migração e selo "sugerida", editor do cargo, usuário pela ficha, menus e telas bloqueadas, API e exportação, painel financeiro, descontos, aprovações da equipe, troca de cargo, exceção, substituição e vencimento, desligamento, conta sem ficha e formulário antigo, trava de segurança, comunicado e etapa por cargo, matriz, rotina e auditoria). Regressão completa: **40 suítes** verdes.
- `scripts/demo_v29.py`: dados fictícios da demonstração (cargo Auxiliar Financeiro, gerente, auxiliar, tesoureiro em substituição e analista com exceção, etapa e comunicado por cargo, desconto e férias pedidos pelo auxiliar).

## O que chegou na v28 — plano de contas gerencial, centros de custo, rateio e o orçamento do ano pelo histórico

Do catálogo **“Plano de contas, centros de custo e orçamento”**: a despesa passa a ter **natureza** (a conta do plano), **centro de custo**, **comportamento** e **tipo econômico** em campos distintos; o corporativo é **rateado por critério aprovado** e cada unidade vê o seu resultado antes e depois do rateio; e o orçamento de 2027 nasce do **histórico higienizado** — volume × preço × calendário, matrículas e contratos —, com versões base, otimista e estresse aplicadas pela Direção. A categoria de sempre continua no caixa, na DRE e no orçado × realizado (cada conta aponta para a sua **categoria-ponte**): nada do que existia muda de lugar. Tudo com trilha na auditoria; alertas e pendências só com contagens; telas de exemplo com dados fictícios.

### Plano de contas gerencial (`Financeiro → Plano de contas e custos`)
- **Plano padrão de rede escolar** com 94 contas: 9 macrogrupos de saída — Pessoal, Pedagógico, Ocupação, Administrativo, Comercial, Financeiro, Tributário, Investimentos e **Não despesa** — e as Receitas; grupo → subgrupo → conta analítica (1.1.01) → subconta (1.1.01.001, criada na tela). Instalação idempotente: o que foi editado na tela nunca é sobrescrito.
- **Atributos de cada conta**: categoria-ponte, tipo econômico (OPEX, CAPEX, serviço da dívida, transferência, adiantamento, receita), fixo/variável, recorrente/eventual, controlável, custo direto (da turma) ou indireto (compartilhado), índice de reajuste (dissídio, IPCA, mensalidade, sem reajuste), o que a faz variar (alunos, receita) e o centro padrão (a unidade que paga ou o corporativo); palavras-chave para a sugestão.
- **Proteções**: conta com lançamentos não vira grupo nem troca de categoria-ponte (os relatórios antigos mudariam — crie outra e inative); conta com títulos em aberto não é inativada; grupo com contas ativas também não. Direção e Financeiro mantêm; a direção da unidade consulta; os demais não veem.
- **Painel**: saídas com conta (12 meses), uso da conta genérica contra a meta (5%), com centro de custo, saídas por macrogrupo, maiores contrapartes ainda sem conta e a árvore com o uso de cada conta (somado até o grupo). Exporta em CSV.

### Centros de custo
- **Corporativo (rede)**, **geral de cada unidade** e **segmentos** (Educação Infantil, Fundamental I e II, Ensino Médio) criados sozinhos a partir das turmas; **áreas** e **projetos** (com início, fim, orçamento e responsável) criados na tela.
- O centro decide **quem fica com o custo**: sem centro, a unidade que pagou; centro de outra unidade leva o gasto para a **unidade beneficiária**; o corporativo vai para o **rateio**.

### Classificação dos lançamentos
- **Fila de classificação** (saídas e entradas sem conta dos últimos 120 dias, com filtros) e **sugestão para cada linha**, da mais forte para a mais fraca: **regra cadastrada** → **o que já foi usado para a mesma contraparte** → palavra-chave da conta → a conta da categoria. O centro aprendido só vale na mesma unidade.
- **Aplicar de uma vez as sugestões de confiança alta**; marcar linhas e aplicar a sugestão de cada uma ou a mesma conta/centro; **“lembrar para esta contraparte”** cria a regra para as próximas. **Regras** (contraparte ou descrição que contém o padrão → conta e centro, da rede ou de uma unidade) com contagem de uso, aplicação sobre a janela e desativação.
- **No lançamento** (`Financeiro → Lançamento`): conta e centro com a sugestão do sistema, motivo e “lembrar”. **Competência fechada**: detalhar a conta dentro da mesma categoria pode; trocar de categoria, só reabrindo o mês.
- **Contas a pagar**: o título nasce com a conta do plano (a categoria vem dela; transferência e grupo recusados), centro padrão automático (conta corporativa → centro corporativo), **conta de investimento (CAPEX) vira natureza investimento**; a baixa leva conta e centro para o lançamento do caixa.

### DRE e orçado × realizado
- **O que não é despesa** sai das linhas: principal de empréstimo e adiantamentos aparecem numa linha de memória (“saídas que não são despesa”) e não entram no orçado × realizado nem no orçamento. Os juros continuam como despesa financeira.

### Resultado por unidade com rateio (`Financeiro → Resultado por unidade (rateio)`)
- Por unidade: receita, **custos diretos**, **indiretos**, **não classificados** (para ninguém confundir), resultado **antes e depois do rateio** do corporativo, margem e **custo por aluno ao mês** (direto, indireto e rateado); mês ou acumulado no ano; gráfico antes × depois; exportação em CSV.
- **Critério de rateio aprovado pela Direção**: alunos atuais, turmas do ano, colaboradores ativos, receita do período ou percentual fixo (que precisa somar 100%). O Financeiro propõe com o motivo; quem propõe não aprova; rejeitar exige motivo; a regra vale a partir do mês “desde” até outra ser aprovada. Sem regra aprovada, o rateio é **provisório por alunos** e a tela avisa. Memória do rateio com a base de cada unidade e os centavos fechando com o corporativo.

### Orçamento do ano pelo histórico (`Financeiro → Orçamento pelo histórico`)
Os quatro passos do catálogo, com o andamento de cada um no topo da tela:
1. **Higienizar a base** — reúne os três últimos anos; a base são os 12 meses completos mais recentes (os 12 anteriores ajudam a achar pares e a separar o sazonal do pico). **Fora sozinhos**: transferências entre unidades e contas, principal de dívida e adiantamentos. **Sinais para decidir**, com a sugestão do sistema: provável **duplicidade** (mesmo valor, contraparte, unidade e tipo em até 3 dias — só a cópia), **estorno/devolução** (os dois lados), **investimento** (CAPEX ou título de investimento), **gasto extraordinário** (natureza do título em contas a pagar, inclusive as parcelas), **pico fora do padrão** (muito acima da mediana da conta e sem igual no mesmo mês do ano anterior — pode ser **normalizado pela mediana**) e **evento de conta eventual** acima do valor de corte (repete no ano?). Decidir um a um ou em lote, voltar à sugestão, aceitar as sugestões de um tipo; enquanto não há decisão, vale a sugestão.
2. **Classificar e ratear** — quanto da base tem conta, conta genérica contra a meta, centro de custo e o critério de rateio aprovado, com atalho para a fila. Nada bloqueia: o que está sem conta é projetado pela categoria (com os atributos mais comuns das contas dela).
3. **Projetar os custos** — por unidade e conta: **base limpa** → **a preços de hoje** (os meses anteriores aos reajustes do ano corrente — mensalidade, dissídio — e o IPCA proporcional ao tempo) → **reajuste do ano** (mensalidade e dissídio a partir do mês de cada um; IPCA proporcional desde o fim da base) → **volume** (contas que variam com alunos seguem alunos do ano ÷ alunos atuais — o padrão é a meta de matrículas do ano; tributos e taxas de cartão seguem a receita projetada) → **sazonalidade do próprio histórico** (13º em dezembro, material em janeiro e fevereiro) → meses sem histórico de uma conta que começou no meio da base estimados pela média com o **calendário escolar** → **piso dos contratos vigentes e títulos a pagar já lançados** para o ano (o mês não fica abaixo do contratado; contrato sem histórico vira linha própria). Três versões (**base, otimista e estresse** — alunos, IPCA, dissídio e mensalidade em relação à base), resultado mês a mês, por unidade (com custo por aluno e a folha aceita como referência), **memória por conta** e o que vai para o orçamento oficial (categoria × mês). Os parâmetros ficam guardados no orçamento do ano.
4. **Governar** — a **Direção aplica** uma versão (com o critério da escolha) ao orçamento mês a mês de cada unidade e categoria; trocar de versão pede “substituir”; as unidades e o Financeiro são avisados; fotografia da aplicação e aviso quando os números mudam depois dela. Banda de tolerância, revisão mensal (pedidos de explicação acima da banda) e donos por categoria no mesmo lugar. A planilha mês a mês continua para os ajustes finos.
- **Exportação da memória** do orçamento em CSV: unidade, conta, índice, o que varia, base bruta, higienizado, normalizado, base limpa, a preços de hoje, reajuste, volume, piso, os 12 meses, total, variação e avisos.

### Alertas, pendências, menu e configurações
- **Pendências**: saídas sem conta (Financeiro e Direção), regra de rateio aguardando a Direção e, de outubro em diante, o orçamento do ano seguinte ainda não aplicado. **Command Center**: conta genérica acima da meta, saídas sem conta acima de 20% do valor em 90 dias, corporativo rateado sem critério aprovado e orçamento do próximo ano não aplicado a partir de 15/11.
- **Menu do Financeiro**: Orçamento pelo histórico, Plano de contas e custos e Resultado por unidade (rateio); atalhos no orçado × realizado e na planilha mês a mês.
- **Configurações → Plano de contas, centros de custo e orçamento** (só a Direção): conta obrigatória em contas a pagar, centro obrigatório, meta da conta genérica, janela da fila, categorias que não são despesa (Pessoal, encargos e mensalidades nunca) e os valores iniciais do orçamento pelo histórico (reajustes e meses, nivelamento, férias, cortes de pico e de evento, piso dos contratos).
- **Exportações**: plano de contas, lançamentos classificados (conta, macrogrupo, tipo econômico, custo, centro e unidade beneficiária), resultado com rateio e memória do orçamento — Direção, Financeiro e direção da unidade (só a sua).

### Banco e testes
- Migração automática 28.0: `chart_accounts` (com o plano padrão), `cost_centers`, `classification_rules`, `allocation_rules`, `budget_hygiene`, `budget_plans`; `cash_entries` e `payables` ganham conta e centro (o caixa também guarda quem classificou, quando e a origem — manual, regra, sugestão, contas a pagar); configurações `planoContas`, `orcamentoHistorico` e `dre.naoDespesa`.
- `scripts/e2e_plano_contas_v28.py` (11 blocos: preparação, plano, classificação e regras, contas a pagar, DRE, rateio, parâmetros, higienização, projeção conferida conta a conta, aplicação e pendências/alertas/configurações/exportações) — a projeção é conferida em reais (mensalidade × reajuste × alunos, dissídio a partir do mês, tributo pela receita, conta que começou no meio da base, resíduo sem conta, piso de títulos e contratos, versões).
- `scripts/demo_v28.py` abre o caixa de demonstração em contas do plano (contrapartes “(demo)”), cria regras, planta os casos da higienização, aprova o critério de rateio e aplica o orçamento de 2027; rode depois de `scripts/demo_insights.py` e `scripts/demo_v27.py`.

### Ajustes da entrega do manual v28 (sem mudança de esquema)
- **Tabelas que se ajustam à largura** (`components/AjusteTabela.tsx`): quando a tabela não cabe no cartão, os títulos das colunas quebram linha e a letra e o espaçamento diminuem (níveis 1 a 3, o 3 só no computador) antes de sobrar rolagem lateral; recalcula quando a largura muda.
- **Telas densas reorganizadas**: descontos (unidade e ano sob o aluno, validade sob o tipo, Aprovar/Rejeitar na própria situação), chamados e casos (prioridade e situação na mesma coluna, prazo em duas linhas; filtro de casos com a busca em linha própria), pesquisas de clima, faixas salariais, resultados-chave do OKR (dono e prazo juntos, números com vírgula), CIPA, resultado do contador na folha (valores sem "R$" com a unidade no título), linha do tempo da folha, planilha do orçamento, talent reviews antes do bus factor, ações da grade empilhadas, cartões de rematrícula e de retenção em duas linhas.
- **Painel do Financeiro**: atalhos para Contas a pagar e Plano de contas e alertas de parcelas vencidas sem baixa, vencendo sem programação, títulos aguardando aprovação e saídas sem conta (Direção, Financeiro e direção da unidade). Nota da Tesouraria no Cockpit atualizada.
- **Configurações**: pesos e metas do People Health com rótulos legíveis; a alçada do financeiro passa a dizer "… e plano de contas".
- **Formulários**: rótulo ou dica com "palavra" muito longa (lista de colunas de CSV, identificador) quebra depois do ponto e vírgula, sem alargar a página.
- **Mensagens de confirmação** preservadas quando o retorno tem âncora (`lib/redirecionar.ts`, usado pelas ações dos módulos).
- **Command Center**: valores grandes resumidos (R$ 1,7 mi) com o exato na dica. **Treemap**: o rótulo só aparece quando cabe no bloco.
- **Correções**: Reservar candidato (aderência) grava a etiqueta "reserva vaga #N" (coberto no `e2e_recrutamento_v26.py`); na higienização do orçamento, "fora do padrão" sem conta nem contraparte agrupa pelo histórico (sem falso positivo em receitas).

## O que chegou na v27 — contas a pagar de ponta a ponta e um RH que decide antes do prazo

Duas frentes. No **Financeiro**, contas a pagar no jeito do XFIN (documento + regra das parcelas → tabela gerada na hora e editável), com a governança do ONE e as ideias do catálogo de controladoria: alçada, dupla checagem, segregação entre aprovar e pagar, contestação, programação com borderô, natureza da despesa e reserva mínima de caixa. No **RH**, movimentação e retenção com fatores de saída, contratos com prazo, clima comparado, qualidade da contratação, funil por vaga e o painel do gestor. Tudo com trilha na auditoria; notificações e alertas só com contagens; telas de exemplo com dados fictícios.

### Contas a pagar — lançamento (`Financeiro → Contas a pagar → Nova conta a pagar`)
- **Documento**: unidade (ou Rede, escolhendo a **entidade/CNPJ que paga** — os registros fiscais não se misturam), fornecedor (ou novo, cadastrado na hora), contrato (preenche descrição, valor mensal e recorrência), plano (categoria), **natureza**, tipo e número do documento, emissão, responsável pela despesa e descrição.
- **Regra das parcelas**: recorrente (cada parcela com o valor informado) ou parcelado (o total dividido), quantidade, 1º vencimento e intervalo (semanal a anual, ou a cada N dias). Vencimento em sábado, domingo ou feriado bancário vai para o próximo dia útil — nacionais (com 20/11), Sexta-feira Santa, Carnaval, Corpus Christi e os locais de MS e Campo Grande —, mantendo o dia-âncora (30/01 → 28 ou 29/02 → 30/03).
- **Tabela gerada na hora e editável**: vencimento, valor, emissão e competência de cada parcela; observação de cada ajuste de dia útil; “gerar de novo” e “jogar a diferença na última parcela”. Se o servidor recusar, o formulário volta como estava (inclusive a tabela editada).
- **Boleto e nota conferidos**: a linha digitável (47 dígitos; 48 de conta de consumo/tributo) tem os dígitos verificadores conferidos e preenche banco, valor e vencimento; a chave da NF-e (44 posições) tem o DV conferido — inclusive CNPJ alfanumérico — e preenche o número. O mesmo boleto ou a mesma nota não entram em dois títulos; mesmo fornecedor + documento (ou valor + 1º vencimento) pede “não é duplicado”.
- **Copiar como novo** e **gerar a partir do contrato** de fornecedor (o contrato mostra as contas a pagar dele).

### Contas a pagar — aprovação, programação e baixa
- **Aprovação por motivo**: compromisso total a partir da alçada (padrão R$ 5.000; recorrente = soma das parcelas), parcela que estoura o orçado da categoria no mês (realizado + comprometido + este título), categoria sem orçamento numa unidade que orça, ou **natureza que sempre passa pela aprovação** (padrão: investimento, de qualquer valor). **Dupla checagem** a partir de R$ 100.000: duas pessoas diferentes com a alçada. Quem lança não aprova o próprio título; a mesma pessoa não aprova duas vezes.
- **Programação financeira**: parcelas aprovadas recebem data e conta (uma a uma ou em lote); a data programada vale para o caixa projetado; **borderô do dia em CSV** com a linha digitável formatada; tirar da programação devolve a parcela ao vencimento.
- **Retenção (contestação com o fornecedor)**: com motivo, a parcela sai da programação e não pode ser baixada até ser liberada.
- **Baixa só com o débito do extrato**: candidatos de 80% a 125% do valor nas contas da unidade, com juros/multa e desconto; o débito nunca serve a duas parcelas. **Sugestões automáticas** (valor exato, perto do vencimento ou da programação, par único) confirmadas em lote. **Segregação de funções**: quem aprovou o título não registra o pagamento. Baixa manual só como exceção justificada, por perfil configurado, auditada e avisada à Direção. Desfazer solta o débito, que volta a ficar livre no extrato; competência fechada trava baixar e desfazer.
- **Alterar** vencimento, valor ou competência de uma parcela (com motivo), cancelar parcela ou título, **estender a recorrência** (acima da alçada, só quem aprova).

### Contas a pagar — painel e título
- **Painel**: vencidas sem baixa, vencem hoje, próximos 7 e 30 dias, pagas no mês, aguardando aprovação; agenda de 8 semanas; **aging** (vencidas há / a vencer em); em aberto por plano; **orçado × pago × a pagar** do mês com o que está livre; despesa por competência (pago + a pagar); **natureza da despesa** (operação, investimento, extraordinária — em aberto, pago em 12 meses e aguardando aprovação); indicadores de 12 meses (pagas até o vencimento, juros e multas, prazo médio de aprovação, baixas manuais, títulos sem documento, a programar em 7 dias).
- **Abas**: Parcelas (filtros por situação, plano, natureza, busca e período; programação em lote; 100 por página), Títulos, Programação de pagamentos (por data e conta, com borderô) e Fornecedores (pago em 12 meses, últimos 30 dias × 30 anteriores, em aberto, próximo vencimento, recorrente ativo).
- **Título**: aprovação com os motivos e o andamento da dupla checagem; painel de ações da parcela em foco (baixar, programar, boleto, reter/liberar, alterar, cancelar, desfazer); parcelas com situação e pagamento; boleto, nota e comprovantes anexados; linha do tempo; dados do título (entidade/CNPJ, contrato, NF-e lida, natureza, responsável, aprovações).
- **No celular**: parcelas, títulos, programação, fornecedores e contratos com prazo dobram as colunas numa célula — sem rolagem lateral; toque no número da parcela para as ações.

### Contas a pagar — integrações
- **Caixa projetado** e **orçado do mês**: parcelas aprovadas entram na data programada (senão no vencimento; vencida e não paga: amanhã) e comprometem o orçado da categoria — sem contar duas vezes com as despesas aprovadas.
- **Reserva mínima de caixa da rede** (`Configurações → Insights`): abaixo dela no cenário pessimista, o caixa projetado avisa (com atalho para a programação de pagamentos), mostra a linha da reserva no gráfico e o Command Center alerta. 0 desliga (fica só o alerta de saldo negativo).
- **Cockpit do CFO → Tesouraria**: contas a pagar viram fonte (a vencer em 30 dias e vencidas sem baixa) na memória de cálculo.
- **Alertas e pendências**: vencidas sem baixa, vencendo sem programação, programadas e não pagas, aguardando aprovação há mais de 2 dias e retidas (Central de alertas, Command Center); “aprovar”, “a programar”, “programados para hoje” e “vencidas” em Minhas pendências.
- **Exportação**: contas a pagar em CSV (com natureza, documento, boleto, competência, programação e pagamento) e o borderô do dia.
- **Configurações → Contas a pagar** (só a Direção): alçada, dupla checagem, quem aprova, quem faz baixa manual, natureza que sempre passa pela aprovação, orçamento, segregação, dia útil, Carnaval/Corpus Christi, feriados locais, tipos de documento, aviso de vencimento e janela do extrato.

### RH
- **Movimentação e retenção** (`People Analytics → Movimentação e retenção`): quadro, entradas, saídas, rotatividade, retenção em 12 meses, quem completou 1 ano, saídas no 1º ano e liderados por gestor; **pontos quentes** por unidade (saídas acima da média, saídas no 1º ano, clima abaixo de 60% favorável); mês a mês; motivos × período anterior; saídas por tempo de casa e por gestor direto; quem saiu antes de 1 ano; onde o quadro cresceu ou encolheu (unidade e área); estrutura de liderança; PDI.
- **Fatores associados às saídas**: taxa de saída de cada grupo — unidade, área, vínculo, turno, regime, tempo de casa, idade, PDI e última avaliação — contra a taxa geral do período. Só grupos com 5 pessoas ou mais (nada identifica ninguém); associação, não causa.
- **Contratos com prazo** (`Pessoas → Contratos com prazo`): experiência 45 + 45 dias (CLT art. 445), estágio (término do TCE e limite de 2 anos — Lei 11.788/2008) e temporário (180 + 90 dias — Lei 6.019/1974). O gestor direto **recomenda** (efetivar, prorrogar, renovar, encerrar), RH/Direção/direção da unidade **decidem** com motivo antes do vencimento — nenhum contrato vira prazo indeterminado por esquecimento. Aviso configurável, pendências, alertas e “O que fazer” do gestor.
- **Minha equipe** (`/equipe`): o painel do gestor — o que fazer hoje, quem está fora, banco de horas, férias, avaliações, PDI e as datas do mês da equipe direta.
- **Clima comparado**: favorável · neutro · desfavorável por dimensão, comparado à pesquisa anterior do mesmo tipo; média com vírgula decimal.
- **Recrutamento**: **funil de cada vaga** (chegaram, saíram e tempo em cada etapa) e **qualidade da contratação** (contratados em 24 meses: quantos seguem, nota na 1ª avaliação × média da casa, por origem).

### Ideias dos catálogos (Controladoria/Contas a Pagar e RH Global)
- Entraram: despesa com fornecedor, centro de custo (plano), unidade, CNPJ e responsável; alçada antes da programação e do pagamento; matriz de alçadas com dupla checagem e segregação entre aprovar e pagar; vencimentos, atrasos, títulos contestados e pagamentos agendados; trilha completa e prevenção de pagamento duplicado; documentos fiscais, bancos e comprovantes conciliados; visão consolidada sem misturar CNPJs; recorrentes × investimentos × extraordinários; caixa projetado semanal com cenários e alerta de liquidez; indicadores com tendência e comparação com o período anterior; decisões e exceções em primeiro plano (pendências separadas do analítico); fatores de saída no estilo Visier.
- Já existiam: DRE por unidade, orçado × realizado com explicação de variações, custo por aluno, fechamento e conciliação.
- Ficaram fora (de propósito): cartões corporativos e gestão de gastos com cartão (Ramp/Brex) e pagamento automático pelo banco (o borderô sai em CSV; a baixa continua com o débito do extrato).

### Banco e testes
- Migração automática 27.0: `payables` (com `natureza`), `payable_installments`, `payable_events`, `bank_lines.payable_installment_id`, `employment_terms`, `employees.termino_contrato`; configurações `contasPagar`, `contratosPrazo`, `alcadas.contasPagar` e `fpa.reservaMinima`.
- `scripts/e2e_contas_pagar_v27.py` (16 blocos: lançamento, boleto/NF-e, aprovação e dupla checagem, baixa e sugestões, programação e borderô, retenção, competência, alertas, contrato, configurações, permissões, natureza, reserva mínima, cockpit e contratos com prazo) e `scripts/e2e_v27.py` (retenção, pontos quentes, Minha equipe, clima comparado, qualidade da contratação e funil).
- `scripts/demo_v27.py` carrega a demonstração fictícia das telas (fornecedores “(demo)”, CNPJs de exemplo); rode depois de `scripts/demo_insights.py`.
- `scripts/e2e_pwa.py` precisa de `NODE_TLS_REJECT_UNAUTHORIZED=0 PUSH_HOSTS_EXTRA=localhost` **no servidor** (serviço de push de teste com certificado próprio).

## O que chegou na v26 — recrutamento com aderência, shortlist e indicadores

O sistema **sugere**, a pessoa **decide**: nenhuma candidatura muda de etapa sem um clique registrado.

### Aderência com evidências (`Recrutamento → vaga → Aderência e shortlist sugerida`)
- Critérios da vaga lidos dos requisitos (um por linha) ou editados em **Editar critérios**: `Desejável:` pesa metade; depois dos dois-pontos, as palavras que comprovam o critério (vírgula = todas; barra = qualquer uma: `professor/docente`).
- Nota de 0 a 100 calculada pelo código, critério a critério (Atende · Parcial · Não evidenciado), sempre com o **trecho do currículo** que comprova.
- **Calcular com IA** (com `AI_API_KEY`): a IA só aponta veredito e trecho; o sistema confere se o trecho existe no texto (trecho inventado é descartado) e calcula a nota. Sem chave, cai para regras e avisa.
- Antes de qualquer análise saem do texto as frases com idade, estado civil, filhos, religião, raça/cor, gênero, gravidez, saúde, deficiência, foto, endereço e números de documento.
- Novo campo **Currículo em texto** na ficha do candidato e no cadastro pela vaga; a ficha do candidato mostra a aderência a cada vaga com os trechos.

### Shortlist com decisão humana
- Ranking: primeiro quem comprova todos os obrigatórios, depois a maior aderência. São **sugeridos** até 5 (configurável), com aderência ≥ 60%.
- **Decidir**: Avançar (próxima etapa), Reservar (fica no banco de talentos) ou Reprovar (motivo obrigatório). Avançar quem não foi sugerido, ou reprovar um sugerido, exige uma frase de justificativa — vai para a linha do tempo e para a auditoria.
- Aviso quando a aderência foi calculada com critérios antigos.

### Indicadores de recrutamento (`Recrutamento → Indicadores`)
- Vagas abertas e fora do prazo, contratações, tempo para preencher (média e mediana), % preenchidas no prazo, candidaturas por vaga, aproveitamento e quem ficou 90 dias.
- Mês a mês, funil com conversão e tempo em cada etapa, vagas abertas com prazo e previsão de preenchimento, candidaturas paradas além do prazo, origem das contratações (e quem saiu cedo), "a aderência acerta?", decisões que contrariaram a sugestão, motivos de reprovação e contratações que não ficaram.
- Prazos em `Configurações` (`recrutamento.indicadores`: triagem 3 dias, vaga 30 dias, retenção 90 dias) e regras da shortlist em `recrutamento.fit`.

### Fora de propósito (de propósito)
- Busca automática de candidatos em LinkedIn e redes (termos de uso e LGPD) e entrevista por voz conduzida por IA não foram incluídas.

### Banco e testes
- Migração automática 26.0: `requisitions.criterios_fit`, `candidates.curriculo_texto`, `application_fit`, `shortlist_decisions`.
- `scripts/e2e_recrutamento_v26.py` (aderência, IA sem chave, decisões, critérios, candidato, indicadores).

## O que chegou na v25 — o que faltava da obra, menos CRM e acadêmico

A v25 coloca no sistema o que a obra pedia e ainda estava fora ou parcial — **exceto o CRM de leads e o acadêmico transacional, que continuam no ActiveSoft por decisão**. A rastreabilidade (`Governança → Nova Arquitetura`) agora mostra **95 das 106 fichas no ar** (1 parcial, 8 fora por decisão, 2 de visão futura), **35 das 43 regras CRQ** implementadas e **35 dos 40 KPIs** calculados. Continuam fora: CRM de leads (T-016–T-020), frequência e prontuário (T-011, T-014), assinaturas digitais (T-074, depende de fornecedor), **marcação de ponto pelo celular** (T-105 — o REP-P exige registro na Portaria 671; o Secullum já cobre) e o **cálculo** da folha (segue com o contador).

### Conciliação e recebimentos (Cap. 21 · T-026, T-033, T-034, T-035, T-039 · KPI-09, KPI-10, KPI-39)

- **Contas bancárias por unidade** (`Financeiro → Conciliação → Contas`, número sempre mascarado) e **importação do extrato** em OFX ou CSV (repetido não duplica; mês fechado é recusado), opcionalmente já lançando no fluxo de caixa com a categoria sugerida (tarifa → financeiras; transferência entre contas → fora da DRE).
- **Motor de conciliação determinístico**: PIX, TED e depósito casados com as **baixas do ActiveSoft** (a quitação oficial continua lá — o ONE nunca marca título como pago) por valor, data, nome do pagador e família; **um PIX para irmãos** (2 a 4 títulos do mesmo responsável) e **boleto pelo total do dia**; confiança de 0 a 99 — a partir de 90 confirma sozinho, abaixo vai para a fila de confirmação (em lote para o normal).
- **Cartão (Cielo)**: relatório de vendas casado com o título (venda × baixa) e com o repasse no banco; **taxa praticada × contratada** por bandeira e produto (as taxas de fábrica são EXEMPLO — copie do contrato).
- **Divergências com dono, prazo e escalonamento** (`Financeiro → Divergências`): crédito sem baixa, PIX não identificado (vai para a **triagem da secretaria**, que só vê o necessário), baixa sem crédito, venda sem título, repasse sem par, taxa acima do contrato, centavos recorrentes. Pendência aberta há 15 dias escala ao gestor financeiro; 30 dias, à Direção. Resolver exige desfecho, observação e, quando é perda, evidência — perda acima de R$ 500 só a Direção assume.
- **Recebimentos do mês** (`Financeiro → Recebimentos`): previsto × recebido × conciliado por forma (PIX, boleto, cartão, dinheiro) e por unidade, com “sem fonte” e “dados parciais” quando falta extrato. **Fechamento da competência** só com o KPI-09 na meta (conciliado + explicado ÷ recebido) e trava a competência; reabrir só a Direção, com justificativa.
- Exportações: divergências, recebimentos e extrato (CSV com o recorte).

### Despesas até o pagamento (T-029 · `Financeiro → Despesas e aprovações`)

- **Política embutida**: alçada por valor nas etapas de cada tipo de solicitação; **aprovação em lote só para o normal** — sem documento anexado, acima de R$ 1.000, categoria bloqueada ou **orçamento do mês estourado** (contando o que já foi aprovado e não pago) viram exceção, com o motivo à vista e decisão item a item. Ninguém aprova o próprio pedido; cada decisão fica na linha do tempo e na auditoria (lote inclusive).
- **“Paga” só com o débito do extrato**: o Financeiro escolhe o débito de mesmo valor (a partir de 7 dias antes da aprovação, sem reuso); o lançamento do caixa é **reclassificado para a categoria do tipo**, com trilha; competência fechada bloqueia pagar e desfazer. Aba **A pagar** e alerta no painel financeiro para aprovada há mais de 7 dias.
- **Pagamento programado** entra no **caixa projetado** na data (sem data, amanhã), abatendo o orçamento da categoria no mês — sem contar duas vezes.
- Tela T-029: **treemap do OPEX** do mês (área = valor, cor = execução do orçamento, toque leva aos lançamentos), estados submetido → aprovado → pago, fila com as exceções, a pagar e **contratos recorrentes com o próximo marco** (limite do aviso, reajuste, fim).

### Grade dos professores com vigência e auditoria do ponto (T-053, T-050 · CRQ-TMP-V3-01)

- **Grade com vigência por unidade** (`Pessoas → Grade dos professores`): rascunho → validação → ativação (a vigência anterior termina na véspera). Na grade em vigor, corrigir turma, disciplina ou sala edita direto; **mudar professor, dia ou horário vale a partir de hoje** (o sistema cria o ajuste — o passado fica como era). Vigência com início no passado só com justificativa e com os meses do ponto abertos. Validação: professor em dois lugares ao mesmo tempo (inclusive em outra unidade) e sala dupla **bloqueiam**; duração fora de 45/50/60 min **avisa**. **Comparador** entre vigências (o que entrou, saiu e mudou, CH antes → depois) e visões por professor, turma e sala. Substituição e mapa de salas usam a grade **vigente na data**.
- **Importação em duas etapas**: lê e valida tudo; depois a coordenação **confirma o de-para de cada nome** (também o nome igual — nunca automático; lição dos dois “Carol”).
- **CH pela grade a partir da vigência**: por turno, do início da primeira aula ao fim da última — **janela conta, almoço não, plantão conta**; aulas em duas unidades somam. O RH marca quem recebe (a grade informa carga de aulas, não de contrato); a jornada anterior termina na véspera; **mês fechado não muda**. “Recalcular dias lançados” refaz a CH e o banco de horas só nos meses abertos. Jornada que cobre mês fechado não é editada nem excluída.
- **Auditoria do ponto** (`Pessoas → Auditoria do ponto`): o espelho importado do Secullum confrontado dia a dia com a CH da jornada/grade — **atraso** (entrada depois do início), **saída antecipada**, déficit, **hora extra**, **erro de marcação** (número ímpar), dia sem marcação, trabalho em dia sem jornada, **CH do relógio ≠ jornada** e **atestado sem documento**; tolerância de 10 min no dia (CLT art. 58). Aceitar vira lançamento para aprovação (lote só para o normal), **devolver ao relógio** (a reimportação corrigida resolve), corrigir a CH do dia, **anexar atestado** (só o documento, nunca CID; restrito ao RH e à Direção). Resumo por colaborador, planilha CSV e as abertas entram nas pendências do fechamento do mês.

### Portal do colaborador (T-104 · `Meu espaço`)

- A home pessoal de quem tem ficha (colaborador entra direto nela): **jornada e aulas do dia**, **espelho do mês** com marcações (e CSV), saldo e lançamentos do banco, **férias** (períodos, saldo, prazo para tirar) com **pedido de férias e de folga do banco** na alçada normal, minhas solicitações (com “a pagar/paga”), documentos e ciências pendentes, holerites arquivados, pedido de declaração e **atualização do próprio contato** (telefone, e-mail, endereço, contato de emergência) com trilha. Só dados próprios.

### Portal do candidato (T-106 · `/candidatura/<link>`)

- **Link pessoal por candidatura** gerado pelo RH na ficha do candidato (o token fica só como hash; validade; gerar de novo revoga o anterior). O candidato vê **vaga e etapa** (nunca notas internas, scorecard ou proposta), **envia os documentos pedidos** (PDF/JPG/PNG; o RH confere ou pede outro arquivo com o motivo), **escolhe um dos horários de entrevista oferecidos**, troca **mensagens registradas** na linha do tempo, **retira a candidatura** ou **pede a exclusão dos dados** — que entra como pedido de titular (LGPD) com a identidade confirmada pelo link. Documentos restritos ao RH; avisos ao RH sem dado do candidato.

### Comunicação em massa e revisão de POP (CRQ-COM-V3-01, CRQ-PRJ-V3-03)

- **Comunicado para 20 pessoas ou mais** e **envio em massa para lista** (`Comunicação → Envio em massa`: famílias por unidade, série, turma ou inadimplência; ou a equipe) só saem com **aprovação de um segundo humano** (Direção ou RH, nunca o autor), com **modelo aprovado obrigatório** no envio por lista (prévia de quantos, quem fica sem contato e como a mensagem fica; irmãos com o mesmo contato recebem uma vez) e **disparo só em horário comercial** — fora dele fica agendado e a rotina dispara na próxima janela. Sem a API do WhatsApp, as mensagens entram no histórico com o link de envio.
- **Três exceções iguais** (mesmo POP — ou a mesma regra — e o mesmo motivo, em 90 dias) **abrem sozinhas a revisão do POP** com as evidências, o dono e prazo de 30 dias; fecha com **nova versão publicada** ou com justificativa (POP mantido, virou regra, virou não conformidade); vencida escala à Direção.

### Configurações, banco, rotina e testes

- **Configurações → Conciliação, despesas e ponto (v25)**: limiar de confiança, janelas, tolerâncias, taxas contratadas da adquirente, palavras do extrato, meta e prazo do fechamento, escalonamento e alçada de perda (Direção); política de despesas — lote, documento, orçamento, categorias bloqueadas e categoria do caixa por tipo (Direção); tolerância do ponto, hora extra mínima, atestado e durações de aula (RH ou Direção). comunicação em massa — a partir de quantas pessoas, quem aprova e o horário comercial de disparo (padrão: 20 pessoas, Direção ou RH, 07:00–19:00 de segunda a sábado; Direção).
- **Banco**: esquema **25.0**, atualização automática e idempotente na primeira subida; a grade que já existia vira a vigência **“Grade em uso”** (nada se perde). `Configurações → Banco de dados` passa a checar também as tabelas da conciliação.
- **Rotina** (`/api/tarefas`): conciliação do mês corrente e do anterior com escalonamento, disparo da comunicação em massa agendada e revisão de POP por exceção repetida — além de tudo o que já rodava.
- **Testes de ponta a ponta novos**: `e2e_conciliacao`, `e2e_despesas` (12 blocos), `e2e_grade_ponto` (16 blocos) e `e2e_portais_massa` (10 blocos), com dados fictícios; regressão completa das suítes anteriores.

## O que chegou na v24.1 — carga inicial e ajustes

- **Férias quitadas até** na ficha e na planilha de colaboradores (períodos anteriores ao sistema não aparecem como vencidos) e **histórico de férias por planilha**.
- **Acessos de autoatendimento em lote** (com **senha temporária** gerada a qualquer momento), **turmas por planilha ou cópia de outro ano** e colaboradores com **nível e gestor** na importação.
- Correções: botões de decisão (aprovar/devolver/rejeitar) no React 19, funil sem estourar o cartão, “Minha avaliação” respeitando o modelo por critérios, ciclos antigos sem botões que não se aplicam, status das ações do clima editável na própria linha, valores em reais compactos nos cartões estreitos (valor exato na dica), canal “Importação” nas pesquisas e nomes acentuados no ambiente de homologação.

## O que chegou na v24 — A Nova Arquitetura

A v24 mescla o sistema com a obra **“STATUS ONE · A Nova Arquitetura · Edição Integral Referenciada v3”** (601 págs): as fichas de tela (Cap. 33), os 40 KPIs (Cap. 34), as regras CRQ (Cap. 35), o design system e os padrões de interação (Cap. 13–16), as 14 decisões da Direção (Cap. 39), o checklist de go-live (Ap. F) e o catálogo de notificações (Ap. J). Continuam **fora por decisão**: CRM de leads individuais (T-016–T-020), o acadêmico transacional (T-011 frequência, T-014 prontuário), as conciliações Cielo/PIX (T-033–T-035, T-039), assinaturas digitais (T-074), a visão futura (T-081, T-105, T-106) e o **cálculo** da folha (holerite, INSS/IRRF/FGTS, eSocial e guias seguem com o contador). A folha entra como **Payroll Bridge**: ciclo com trava, conferência e custo REAL. Todo número continua vindo de um módulo — **sem fonte, aparece “sem fonte” (nunca zero)** — e toda leitura automática é **determinística** (IA só como rascunho N1, nunca decide).

### Rastreabilidade da obra (`Governança → Nova Arquitetura`, `/arquitetura`)

- **106 fichas de tela**: 85 no ar, 6 parciais (cada uma diz o que falta), 12 fora por decisão e 3 de visão futura — cada ficha com módulo, onda, estado real e o link da tela.
- **40 KPIs** (KPI-01 a KPI-40): 34 ligados a uma chave do catálogo de indicadores, com fórmula, fonte e cálculo; os demais dizem por que não (fonte fora do sistema ou decisão).
- **43 regras CRQ** (31 implementadas, 8 parciais, 4 fora), **14 decisões** (entram como pendências no Command Center), **go-live (Ap. F, 32 itens)** — marcar exige evidência; **GO/NO-GO só pela Direção** — e **25 notificações (Ap. J)** com canal e estado.

### Plataforma: contexto global, alertas, aprovações e navegação

- **Seletor global (T-100)**: entidade × unidade × mês no topo das telas executivas e financeiras, persistente entre telas e sessões (link → último uso → padrão do perfil → papel), com **carimbo do contexto** na tela e nas exportações. Perfil de unidade fica travado na própria unidade.
- **Central de alertas (T-003)**: alerta persistente com **dono, prazo (SLA) por severidade**, tratar com desfecho, delegar, silenciar com validade e motivo, trilha completa e **escalonamento dono → gestor → Direção** (aviso aos 80% do prazo). Alerta sem dono é defeito de configuração e aparece como tal. A rotina varre a rede e as unidades que têm diretor ou coordenação no sistema; o sino, o menu inferior e Minhas pendências contam o mesmo recorte da central. Privacidade e SST só como contagem, só para Direção e RH.
- **Aprovações em lote (C10)**: férias, banco de horas e horas extras numa fila só; o que tem conflito de cobertura (contando os pedidos anteriores do mesmo lote — dois pedidos que sozinhos passam não são aprovados juntos se, somados, furam a cobertura mínima) ou estoura limite sai do lote e vai para decisão individual, com justificativa.
- **Pergunte ao Status (T-099)** na busca (Ctrl+K): pergunta terminada em “?” (ou começando com quanto/qual/quantos) vira **número com fonte, período e o link “abrir com o mesmo filtro”**; pergunta sobre pessoa é recusada; só o que o perfil vê; 30 perguntas por minuto; auditado. Sem IA.
- **Navegação**: **menu inferior no celular** com os 5 destinos do papel (some quando o menu completo abre); **notificações agrupadas** (“5 férias aguardam aprovação”); todo gráfico com **“ver dados”** (tabela para leitor de tela e conferência); composições em **barra 100%** (rosca só no C7 de orçado × realizado, como pede o design system).

### Executivo e Financeiro

- **Board do dono (T-001, `/executivo/board`)**: 6 indicadores com meta e variação, **narrativa determinística com chips de ação** (aprovar, delegar, abrir plano), trajetória da receita em 24 meses com orçado, previsão até dezembro e faixa pessimista–otimista, as unidades, alertas críticos e aprovações. **Mês em andamento** na régua certa: realizado até o último lançamento comparado ao **orçado proporcional** (pelo perfil do mesmo mês do ano anterior; sem histórico, por dias corridos) e ao **mesmo período do ano anterior** — nunca o mês parcial contra o mês cheio. Folha ÷ receita pela **última competência com folha aceita**, sobre as mesmas unidades.
- **Health por domínio (T-002, Command Center)**: as 3 maiores causas de cada nota com link, histórico de 13 semanas e “como é calculado” que reproduz a nota.
- **Cockpit do CFO (T-023) + Tesouraria (T-028)**: as seis perguntas de sobrevivência com meta e Δ, 13 meses, narrativa do mês, execução por área (C7), aging, indicadores secundários, maiores devedores e maiores despesas (transferência interna não é despesa), caixa por entidade e unidade, **cobertura em dias com memória de cálculo**, saídas previstas em 30/60 dias e menor saldo em 13 semanas; export CSV com carimbo.
- **DRE gerencial (T-024)**: por unidade, entidade ou mês; realizado, orçado, Δ, AH e AV; **transferências internas eliminadas** (pernas + e − por unidade, saldo zero no Consolidado); custo de pessoal pela **folha aceita (REAL)** onde ela existe; drill até o lançamento e o documento; mês em andamento sinalizado.
- **Orçado × real (T-025)**: donuts C7 com a **banda saudável 90–105%**; mês encerrado com categoria acima do teto gera **pedido de explicação** ao responsável (dono da categoria → diretor da unidade → Financeiro → Direção), que responde na própria tela; “desvios fora da banda” usa a mesma régua.
- **Visão da rede (T-008, `/rede`)**: as unidades lado a lado, **totais = soma exata dos cartões** (o que a fonte tem fora das unidades vira aviso com origem), ranking por indicador com drill, comparação A×B e export.
- **Obrigações fiscais (T-031)**: agenda por entidade gerada pelos modelos (vencimento em dia útil), dono, avisos em D-10, D-3, D-0 e diários quando atrasa; **baixa só com comprovante** (paga sem comprovante fica “aguardando comprovante”); delegar, dispensar com motivo, reabrir só pela Direção. **Dossiê de fiscalização**: movimentos, intimações com prazo, documentos entregues e encerramento só com os prazos cumpridos.

### Pessoas

- **Payroll Bridge (T-055/T-056/T-057)**: ciclo mensal de 5 passos por entidade com trava — **ponto fechado por unidade** → pacote → **conferência a quatro olhos** → resultado aceito (variação acima de 5% explicada antes) → arquivo de holerites e guias com consulta registrada. O resultado aceito é a única fonte do **custo REAL** (DRE, KPI-13, custo por dimensão); a “folha esperada” aparece sempre rotulada como estimativa.
- **Posições × FTE (T-043)** e **gate de reposição (T-069)**: a cadeira separada da pessoa; vaga só abre pelo gate (motivo e alternativa: contratar, realocar, temporário, terceirizar, redistribuir).
- **Etapas do ciclo de avaliação (T-058/T-059)**: linha do tempo com janelas, funil, quebra por unidade e área, **pendências nominais com lembrete** (máx. 2 por pessoa; o 2º escala ao diretor só com a contagem), mover janela exige motivo e avisa, fechar etapa com pendência exige justificativa e aparece como “fechada com pendências”.
- **Painel do dia (T-048, `/ponto/hoje`)**: quem está, quem falta e quem atrasou agora, por unidade e por setor ou turno; no-show vira contato com desfecho que alimenta o ponto do dia (falta, atestado, folga, dispensa).
- **Relatórios do RH (T-045)**: 12 relatórios nomeados (headcount, FTE, aniversariantes, admissões, desligamentos, contratos a vencer, cadastro incompleto, ausências, absenteísmo, distribuição das ausências, férias vencendo, banco de horas) com a mesma regra das telas, favoritos, **agendamento mensal** e pedido de relatório novo.
- **Onboarding 30-60-90 (T-072)**, **SST (T-101–T-103)** — ASO sem dado clínico (só tipo, data, validade, aptidão e restrição administrativa), **admissão só conclui com o ASO apto registrado**, incidentes/CAT/CIPA, treinamentos NR, brigada e EPI —, **recortes com grupo mínimo de 5 (T-044)**, **risco de saída por área (T-067)** com a lista nominal só para RH e Direção e cada consulta na auditoria, ranking de horas extras (T-054).

### Estratégia, governança e matrículas

- **Baseline de projeto (T-077)**: baseline v1, nova baseline só com decisão registrada, dependências entre marcos (sem ciclo), desvio em dias e Gantt por mês ou semana com o planejado ao lado do atual.
- **Auditorias e NC/CAPA (T-080)**: agenda com auditor-líder e prazos; achado com evidência vira NC; causa raiz e CAPA com prazo; **verificação de eficácia por outra pessoa, com evidência**; reincidência reabre com gravidade maior. Toda NC só encerra com a evidência de eficácia descrita.
- **Ação requerida (T-013, `/matriculas/acao`)**: turmas sem titular, alunos sem turma do próximo ano, documentos de matrícula (pendente, recebido, verificado, rejeitado, vencendo) com reenvio registrado na timeline da família, reservas vencendo; 20 itens por seção com “ver todos”; unidade pedindo outra unidade é negada e auditada.
- **Command Center**: as 14 decisões da obra (Cap. 39.1) na fila da Direção, com o que cada uma bloqueia.

### Configurações, rotina e banco

- **Configurações → v24**: alertas (donos por módulo, prazos), aprovações (Direção), folha (trava e variação), obrigações (modelos e avisos), SST, financeiro (banda do orçamento, listas da DRE, pesos do funil do Board), ação requerida (documentos exigidos, validades, janelas) e onboarding. Salvar um formulário antigo não apaga os parâmetros novos.
- **Rotina diária** (`/api/tarefas`, a mesma de antes): varredura de alertas, escalonamento, pedidos de explicação do mês encerrado, lembretes de onboarding, avisos de obrigações e relatórios agendados — cada bloco isolado e sem duplicar.
- **Banco**: esquema 24.0, atualização automática e idempotente (sem perda de dados).

### LGPD, segurança e testes

- Conteúdo de ética e privacidade nunca vai para notificação, exportação ou auditoria (só protocolo e contagem); SST sem dado clínico; alertas só com contagem, nunca nomes; recortes de pessoas com grupo mínimo de 5; lista nominal de risco de saída só para RH e Direção, auditada; IA só como rascunho N1. **Nada de dado real antes do GO da homologação.**
- `scripts/test_v24.ts` (**103 testes** dos cálculos: Payroll Bridge, DRE, contexto, alertas, aprovações, FTE, SST, narrativas, mês em andamento, obrigações, etapas, baseline, auditorias, ação requerida, painel do dia, relatórios, grupo mínimo, Pergunte ao Status, notificações agrupadas, Health e rastreabilidade) e `scripts/e2e_v24.py` (**97 verificações** de ponta a ponta por perfil). Regressão completa de todas as suítes anteriores sem falhas e fumaça com **14 perfis × todas as rotas da matriz** (sem erro 500, sem erro de JavaScript, celular sem rolagem lateral e com o menu inferior).

## O que chegou na v23 — ONE Insights

A camada de **gestão à vista** do ONE: o que as plataformas de referência (SoftExpert, monday, ClickUp, Asana, Salesforce, HubSpot, Board) fazem de melhor — painéis com meta e tendência, quadros em colunas, cronogramas, central de prazos, caixa de pendências, busca instantânea e reconhecimento — aplicado ao que a escola já registra no ONE. **Nada é digitado de novo**: os números saem dos módulos. Os padrões visuais de CRM viraram equivalentes escolares (metas de matrícula e rematrícula por unidade e carteira, quadro da rematrícula e funil agregado); **CRM de leads individuais, acadêmico e folha/contabilidade continuam fora**, por decisão. Todas as leituras automáticas são **determinísticas** (sem IA e sem nomes de pessoas) e **mês sem dado nunca vira zero**.

### Painel Executivo e base de indicadores (v23)

- **Base única de 57 indicadores** (`Insights → Painel Executivo`), reconstruída dos registros dos últimos **24 meses** e mantida em dia sozinha (cálculo por mês, por unidade e da rede): pessoas (quadro, admissões, desligamentos, turnover, absenteísmo, horas extras, banco de horas, eNPS, desempenho, treinamento, vagas, tempo de contratação, cobertura de aulas, alunos por professor), matrículas e famílias (ocupação das vagas, rematrícula, alunos, matrículas novas, candidatos, lista de espera, cancelamentos, NPS das famílias, reclamações, casos no prazo, retenção nos pedidos de saída, pedidos de saída, contato recente), financeiro (receita, despesa, resultado, margem, emitido, recebimento, inadimplência, em atraso, ticket, recuperado, caixa, custo de pessoal), operações (chamados abertos, no prazo, tempo de resolução, em aberto, vistorias, custo de manutenção, aprovações no prazo) e estratégia/governança (OKRs, ações em dia e concluídas, marcos no prazo, reuniões de gestão, saúde da operação, NCs abertas e no prazo, exceções, saúde dos processos, LGPD no prazo). Razões da rede são **recalculadas pelas somas** (não pela média das unidades); pesquisas e ciclos valem a última medição; unidade com poucas respostas no eNPS ou poucas avaliações não mostra o resultado (anonimato).
- **6 abas** (Geral, Pessoas, Matrículas, Financeiro, Operações, Estratégia): cartões com valor, **variação sobre o mês anterior e sobre o mesmo mês do ano anterior**, minigráfico de 12 meses e **farol contra a meta**; **Leitura do mês** automática (fora do alvo, movimentos acima do normal para o indicador, 3 meses seguidos de melhora ou piora, recordes de 24 meses, comparação com o ano anterior e meses sem lançamento); **Comparativo das quatro unidades** em mapa de calor; gráficos por área (admissões × desligamentos, indicadores por unidade, funil de captação do ano e origem dos candidatos, receita × despesa e receita orçada × realizada). Mês e unidade escolhidos no topo; exportação em CSV; impressão limpa.
- **Indicador em detalhe**: série de 24 meses com a linha da meta, acumulado do ano contra o ano anterior, mês a mês, unidades no mês e por unidade em 24 meses, **comentários da gestão por mês** (marcados no gráfico), "como é calculado", link para agir no módulo, a meta do ano (para quem define) e exportação da série.
- **Metas** (`Painel Executivo → Metas`): uma meta por indicador, ano e unidade (ou rede), com limite de atenção opcional e meta mensal ou anual (proporcional ao mês) para os acumulados; sem meta cadastrada valem a meta padrão das configurações ou o **orçamento** (receita, despesa, resultado). **Dicionário** com fórmula, fonte, agregação e histórico de cada indicador.
- **Modo apresentação** (`/apresentacao`): resumo do mês, leitura do mês, um slide por área e o comparativo das unidades, em tela cheia; teclado (← → espaço, Esc sai) e passagem automática (`?auto=20`) — para o conselho, a reunião de gestão ou a TV da sala da Direção.
- **Resumo executivo semanal**: quem assina recebe toda segunda-feira (notificação, celular e e-mail, se configurado) os destaques da semana no seu escopo.

### Orçado × realizado (FP&A) e caixa projetado (v23)

- `Financeiro → Orçado × realizado`: por categoria, **mês e acumulado do ano**, desvio em R$ e % com a leitura certa (receita abaixo e despesa acima são desfavoráveis), comparação com o ano anterior, **previsão de fechamento do ano** (realizado + orçado dos meses seguintes; sem orçamento, a média dos 3 últimos meses), **cascata** do resultado orçado ao realizado, quadro por unidade e **explicação dos desvios** por categoria e mês (Direção, Financeiro e direção da unidade). Sem caixa importado, o realizado fica vazio — nunca zero.
- **Orçamento mês a mês** (`Orçamento mês a mês`): planilha por unidade com os 12 meses de cada categoria — grava **tudo ou nada** (um valor inválido não salva nenhum); **criar a partir do ano anterior** (orçado ou realizado) com reajuste, mantendo a sazonalidade. Edição pela alçada financeira (padrão: Direção e Financeiro).
- **Caixa projetado** (`Financeiro → Caixa projetado`): saldo hoje e em **30, 60 e 90 dias** com **faixa pessimista–otimista** (configurável), saldo semana a semana, entradas × saídas por semana e **alerta quando o caixa fica negativo** no cenário pessimista. Entradas: títulos a vencer × taxa de recebimento dos últimos 6 meses (sem títulos, a média de 3 meses); saídas: orçamento de despesas (sem orçamento, a média). Precisa do saldo inicial do mês em `Fluxo de caixa`.

### People Analytics visual e Quem está fora (v23)

- `Pessoas → People Analytics`: quadro de 24 meses, admissões × desligamentos, turnover, absenteísmo mês a mês, por dia da semana e por unidade, horas extras, tempo de casa, faixa etária, vínculo, pessoas por unidade e cargo, alunos por professor e faixas salariais (salário só para quem vê salário).
- `Pessoas → Quem está fora`: calendário do mês da equipe com férias, folgas, afastamentos e licenças (aprovados e pedidos), ausências registradas para substituição e faltas do ponto; quem está fora hoje e a concentração por unidade e dia. Para quem não trata dados sensíveis, afastamento, licença e atestado aparecem só como **"Ausência"** (nem a cor revela o tipo).

### Central de fluxos e SLA (v23)

`Insights → Central de fluxos e SLA`: os **12 processos com prazo** do ONE num lugar só — solicitações, casos das famílias, chamados, pedidos LGPD, admissões, desligamentos, férias e afastamentos, vagas, descontos, exceções, plano de ação e não conformidades. Cada item tem situação calculada (**no prazo, em risco, vencido**, concluído no prazo ou fora); "em risco" = resta até 25% do prazo (configurável) ou menos de 1 dia. Visão geral com cartões, **leitura automática da central** (vencidos e onde se concentram, tendência do cumprimento, maior gargalo de aprovação, unidade com mais atraso, item mais antigo), cumprimento por semana, entrada de demanda, por processo, por unidade, **carga por responsável** e onde os itens esperam; **Itens** com filtros por situação; **Aprovações** (tempo de decisão por etapa e por aprovador, devolvidas, no prazo); **Auditoria e NCs** (abertas por responsável, gravidade, prazo e mapa unidade × origem). Pedidos LGPD aparecem **só pelo protocolo**; afastamentos, **sem o motivo**; cada perfil vê os processos que já vê nos módulos, no seu escopo. Exportação em CSV.

### Minhas pendências e lembrete diário (v23)

`Insights → Minhas pendências`: tudo o que espera pela pessoa nos módulos, em quatro grupos — **Aprovar** (solicitações na sua etapa, férias, banco de horas, descontos na sua alçada, exceções, vagas), **Atender** (casos, chamados, admissões e desligamentos, pedidos LGPD e incidentes, relatos de ética para o comitê — só protocolo e contagem —, convites de substituição, aulas sem professor, reservas vencendo, contatos do radar), **Gestão** (ações, NCs, controles, OKRs sem check-in, status report e marcos de projeto, rituais e atas, contratos e licenças) e **Ciência e desenvolvimento** (comunicados e POPs para ler e dar ciência, treinamentos exigidos, autoavaliação, avaliações a concluir, contribuições, resultado para ciência, feedbacks e PDI) — em **Vencidas, Vencem hoje, Próximos 3 dias, Mais adiante e Sem prazo**, cada uma com o botão para resolver no módulo. **Lembrete diário** (dias úteis, um por pessoa por dia, pode ser desligado): quem tem pendência vencida ou para hoje recebe um aviso só com números e módulos — nunca o conteúdo.

### Início personalizável e busca global (v23)

- **Início** novo: saudação, atalhos e blocos — pendências, meus indicadores, prazos dos processos, quem está fora, pessoas, datas do mês, mural, comunicados e auditoria — conforme o perfil. Em `Personalizar` cada pessoa escolhe e ordena os blocos, até **8 atalhos** e até **8 indicadores**; perfis que entram direto no módulo (Comercial, Financeiro, Operações e o autoatendimento) podem optar pelo Início. Só o que o perfil pode ver é aceito, mesmo forçando o formulário.
- **Busca global** (**Ctrl+K** / **⌘K**, ou **/**; no celular, a lupa do topo): telas do menu na hora e registros dos módulos — colaboradores, alunos e candidatos, solicitações, casos, chamados, ações, projetos, POPs, contratos e indicadores — sem acento nem caixa, **sempre no escopo do perfil** (quem não é de operações acha só os chamados que abriu; solicitações só de quem pediu, aprova ou dirige a unidade). Até 60 buscas por minuto por pessoa.

### Quadros, cronograma e alinhamento (v23)

- **Quadros em colunas** (estilo kanban): plano de ação (A fazer, Em andamento, Bloqueada, Concluída — mover pelo próprio cartão, com carga por responsável e o que vence em 7 dias), **rematrícula** (sem link → link gerado → enviado → abriu → reserva → matriculado, mais recusou e expirado, com "parado há N dias" e filtro por carteira), **casos das famílias** e **chamados** (por situação, com o prazo no cartão: "vence em 5 h", "vencido há 2 d").
- `Estratégia → Cronograma`: **Gantt** dos projetos com marcos, situação, dono e gasto × orçamento.
- `Estratégia → Alinhamento`: da missão aos resultados — perspectivas → objetivos → KRs (com progresso e confiança) → projetos e ações — e **"o que ainda está solto"** (objetivo sem KR, projeto sem objetivo, ação sem vínculo).

### Metas e previsão de matrículas (v23)

`Matrículas → Metas e previsão`: medidores de **ocupação** e **rematrícula** contra a meta (padrão 85%, configurável), compromisso (matrículas + reservas), provável e potencial, vagas livres; **ritmo semanal com projeção até o fim da campanha** e faixa provável (sem ritmo suficiente, não projeta); metas por unidade e **ranking das carteiras** da rematrícula. Tudo agregado — nenhum lead individual.

### Mural de reconhecimento (v23)

`Insights → Mural de reconhecimento`: qualquer pessoa da equipe reconhece um colega (perfis de unidade e autoatendimento, da mesma unidade), ligado a um **valor da escola**; a pessoa reconhecida é avisada; aplausos; filtros por unidade, valor e pessoa; números por valor, mês e unidade. Não dá para reconhecer a si mesmo; até 10 recados por pessoa em 24 horas; **moderação** (ocultar com motivo, auditada) por Direção e RH; o perfil de leitura só lê.

### Integrações, configurações e revisão (v23)

- **Configurações → Insights**: tolerância do farol, resumo semanal e lembrete de pendências (liga/desliga), "em risco" e prazos de decisão da central, cenários do caixa projetado; **Matrículas**: fim da campanha (previsão) e meta de rematrícula. Salvar um formulário antigo não apaga os parâmetros novos.
- **Rotina diária** (`/api/tarefas`, a mesma de antes): mantém a base de indicadores (fotos do dia), envia o resumo semanal às segundas e o lembrete de pendências nos dias úteis — cada bloco isolado e sem duplicar.
- **Navegação**: menu lateral fixo no computador, com rolagem própria, marca e busca sempre à vista e a **tela atual destacada** (o menu rola até ela); no celular, a lupa da busca fica no topo, ao lado do Menu.
- **Exportações CSV** novas: indicadores do painel (`/api/export/painel`), série de um indicador, orçado × realizado e central de fluxos — todas no escopo do perfil.
- **Revisão de segurança** coberta por teste: escopo da unidade imposto no servidor em todas as telas, ações, buscas e exportações novas (pedir outra unidade na URL não muda nada); indicador salarial só para Direção, RH e Financeiro; privacidade só para quem trata LGPD; ética e LGPD nunca com conteúdo em pendências, lembretes, central ou exportações; cópia de orçamento conferida pela unidade; aplauso e moderação conferidos pelo perfil. `scripts/e2e_insights.py` (81 verificações, todos os perfis) e `scripts/test_v23.ts` (99 testes dos cálculos); regressão completa das 28 suítes de ponta a ponta e dos 3 conjuntos de testes unitários sem falhas.

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
**v30:** basta publicar o código. Na primeira subida o servidor cria as tabelas e colunas da v30 (esquema **30.0**), começa o **histórico funcional** com a admissão de cada ficha, os desligamentos e as promoções do histórico salarial, e inclui as telas novas nos cargos que têm lista de telas personalizada (o quem é quem para todos; a composição para quem via o People Analytics; a igualdade salarial para quem via Cargos e salários; os benefícios para quem via Holerites e guias; o relatório sob medida para quem via Relatórios do RH; os itens com colaboradores para quem via Ativos e patrimônio). A base de indicadores é recalculada na primeira visita ao Painel Executivo. Depois:
1. `Colaboradores → Importar planilha`: complete **sexo**, **ramal**, **e-mail institucional** e **quem é quem** das fichas existentes (só esses campos mudam) e confira o **CNPJ** de cada ficha.
2. `Configurações → Pessoas (v30)`: revise prazos, mínimos e motivos. **A página pública de vagas fica desligada**: só a Direção liga, e só depois do GO da homologação.
3. `Pessoas → Benefícios`: cadastre o catálogo e as adesões atuais; confira o custo com as faturas antes do próximo pacote da folha.
4. `Academy`: marque nos cursos o custo, o instrutor e quais têm inscrição aberta (e se passam pelo gestor).
Nenhuma variável nova.

**v29:** basta publicar o código. Na primeira subida o servidor cria as colunas do acesso pelo cargo e converte os acessos **sem mudar o que cada pessoa vê** (cada cargo recebe a atuação de quem já tinha login nele ou a sugerida pelo nome; perfil diferente do cargo vira exceção "Acesso mantido da versão anterior"; login sem ficha vira conta sem ficha). Depois, com calma:
1. `Configurações → Acesso por cargo → Cargos`: confirme a atuação dos cargos com o selo **sugerida** (abra, confira e salve) e ajuste as telas e aprovações dos cargos de gestão (ex.: auxiliar × gerente financeiro).
2. `Acesso por cargo → Fora do padrão`: para cada exceção herdada, corrija o cargo na ficha ou clique em **Voltar ao acesso do cargo**.
3. `Configurações → Usuários e acessos → Editar`: ligue à ficha os logins da equipe que ainda são "conta sem ficha" (Direção, RH, Financeiro, coordenações). Conta sem ficha fica só para quem não é da escola.
4. Solicitações: nas etapas "Financeiro" (ou outra atuação) que devem passar só por um cargo, troque por `cargo Gerente Financeiro`.
Nenhuma variável nova.

**v25:** basta publicar o código. Na primeira subida o servidor cria as tabelas novas (conciliação, vigências da grade, auditoria do ponto, portal do candidato, envio em massa e revisões de POP), as colunas novas (forma de pagamento e conciliação nos títulos, origem no caixa, pagamento nas solicitações, contato de emergência, aprovação nos comunicados) e transforma a grade que já existe na vigência **“Grade em uso”**. Nada do que já existe é alterado ou apagado. Depois, uma vez:
1. `Financeiro → Conciliação → Contas`: cadastre a conta de movimento de cada unidade; importe o extrato (OFX ou CSV) e o relatório de vendas da Cielo. Na importação de títulos do ActiveSoft, inclua a coluna **forma** (PIX, boleto, cartão, dinheiro) para o recebimento por forma.
2. `Configurações → Conciliação, despesas e ponto (v25)`: **troque as taxas EXEMPLO pelas do contrato da adquirente**; confira a meta e o prazo do fechamento, a política de despesas e a tolerância do ponto.
3. `Pessoas → Grade dos professores`: confira a vigência “Grade em uso”; a próxima grade entra como **nova vigência** (rascunho → ativar) e o RH aplica a CH em `CH` da vigência.
4. `Recrutamento → candidato`: gere o link do portal quando o candidato estiver em processo (variável recomendada: `APP_URL` com o endereço público, para o link sair certo).
Nenhuma variável nova é obrigatória. As páginas públicas novas (`/candidatura/<link>`) abrem sem login.

**v23:** basta publicar o código. Na primeira subida o servidor cria as 10 tabelas novas (base de indicadores, metas, comentários, assinaturas, orçamento mês a mês e explicações, mural e preferências do Início) e monta a **base de indicadores com os 24 meses** na primeira visita ao Painel Executivo (leva alguns segundos uma vez; depois é automático). Nada do que já existe é alterado. Depois, uma vez (Direção/RH):
1. `Painel Executivo → Metas`: cadastre as metas do ano (sem meta, valem as padrão e o orçamento).
2. `Financeiro → Orçamento mês a mês`: crie o orçamento de cada unidade (pode partir do ano anterior com reajuste).
3. `Configurações → Insights` e `Matrículas`: confira tolerância do farol, prazos da central, cenários do caixa, fim da campanha e meta de rematrícula.
4. Quem quiser o resumo de segunda-feira clica em **Receber o resumo toda segunda** no Painel Executivo.
A rotina diária (`/api/tarefas`) é a mesma e já inclui o v23.

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
3. Em **Configurações**, confira unidades, empresas (preencha os CNPJs) e **cargos — cada um com a Atuação no sistema**; em **Acesso por cargo**, ajuste as telas e aprovações dos cargos de gestão.
4. Em **Colaboradores → Importar planilha**, cole a planilha atual (veja o formato abaixo). Depois complete cargo, gestor e carga horária de quem ficou pendente.
5. Saldos atuais do banco de horas: em **Banco de horas → Importar saldos da planilha**, cole duas colunas (`nome;saldo`) copiadas da planilha _RESUMO_BANCO_DE_HORAS (saldo em minutos, ex.: `-4215`, ou em `hh:mm`, ex.: `-70:15`) e informe a data do fechamento. Cada linha vira um ajuste aprovado; rodar de novo não duplica. A partir daí, só lançamentos do dia a dia.
6. Logins: **Configurações → Usuários e acessos → Novo acesso** (escolha a pessoa — o acesso vem do cargo da ficha) ou **Acessos em lote** (todas as fichas com e-mail). Professor e demais cargos de autoatendimento veem a própria ficha, pedem férias e lançam horas.

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

## 3. Acesso pelo cargo: atuações e permissões

Desde a v29, o acesso vem do **cargo da ficha**: cada cargo tem uma **atuação** (abaixo), as **telas** que vê (o cargo pode tirar telas da atuação) e as **aprovações** que faz — `Configurações → Acesso por cargo`. Nos parágrafos históricos deste README, "perfil" é o nome antigo da atuação.

| Atuação | Vê | Faz |
|---|---|---|
| Direção / RH | tudo, todas as unidades, salário e CPF | cadastra, edita, aprova, configura (inclusive o acesso dos cargos), conclui admissão e desligamento |
| Direção da unidade (antes "Diretor de unidade") | só a própria unidade, sem salário/CPF | solicita e aprova férias/afastamentos e banco de horas da unidade (conforme as aprovações do cargo) |
| Coordenação (antes "Gestor") | só a própria unidade, sem salário/CPF | solicita férias/afastamentos e lança horas (ficam pendentes de aprovação); Minha equipe |
| Financeiro | o financeiro (cada cargo com as suas telas) | opera recebimentos, conciliação, contas a pagar; importa, orça e aprova conforme as aprovações do cargo |
| Consulta (antes "Somente leitura") | conforme unidade | consulta |
| Autoatendimento (antes "Colaborador") | só a própria ficha, sem salário/CPF | pede férias e afastamentos, lança horas (ficam pendentes) |
| Comercial e atendimento | Matrículas e Atendimento (rede ou uma unidade) | cadastra alunos, reserva vagas, opera a fila, confirma matrícula (aprovação padrão), registra e conduz casos |
| Operações e manutenção | Operações | chamados, ativos, vistorias, espaços, portaria e fornecedores |

Estratégia (v21): todos os perfis de equipe leem; identidade, mapa, indicadores da rede e parâmetros são da Direção/RH (diretor: indicadores e objetivos da própria unidade); ações e rituais são criados por todos os perfis de gestão no seu escopo; medição de indicador é do responsável, do diretor da unidade e da Direção/RH (investimento em captação também do Comercial). Radar da família: atendem Direção, RH, diretor, gestor e Comercial; distribuem a carteira Direção, RH, diretor e gestor; configuram a jornada Direção/RH.

v22: **Rematrícula** — painel e links para quem reserva vagas (Direção, RH, diretor, gestor, comercial); contrato só Direção/RH. **Substituição de professor** — coordenação (gestor, diretor da unidade, Direção, RH) registra ausências, distribui e confirma coberturas; professor responde convites e avisa ausência; leitura consulta. **Espaços** — operações e gestão cadastram e ligam turmas às salas; todos reservam (leitura não). **Portaria** — perfis configuráveis (padrão: Direção, RH, diretor, gestor, operações, comercial); restrição de retirada e exceções só coordenação/direção. **Privacidade** — Direção, RH e o encarregado. **Canal de ética** — só o comitê (sem os impedidos) e a Direção/RH configuram. **Solicitações** — todos abrem (conforme o tipo); decide quem está na etapa. **Contratos** — Direção, Financeiro, Operações, RH, diretor da unidade (leitura consulta); **licenças** — os mesmos, sem o Financeiro.

v23: **Painel Executivo** — todos os perfis de gestão, cada um com as suas áreas (Gestor: pessoas, matrículas, operações e estratégia; Financeiro: financeiro, matrículas, operações e estratégia; Comercial: matrículas e estratégia; Operações: operações e estratégia; Leitura: tudo menos financeiro); diretor e gestor só a própria unidade; **custo de pessoal** só Direção, RH e Financeiro; indicadores de privacidade só para quem trata LGPD. **Metas**: Direção; RH (exceto financeiras); Financeiro (financeiras). Comentam todos os perfis de gestão, menos leitura; recalcular a base: Direção e RH. **FP&A e caixa**: Direção, Financeiro, RH e diretor da unidade (edição do orçamento pela alçada financeira; explicação de desvios: Direção, Financeiro e diretor). **Central de fluxos**: todos os perfis de gestão, com os processos que cada um já vê nos módulos. **Pendências, Início, busca e mural**: todos (cada um no seu escopo; leitura não publica nem aplaude; moderação do mural: Direção e RH).

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

Testes de ponta a ponta (servidor em `next start -p 3100`, Python 3 + `requests`): `python3 scripts/e2e.py` (Pessoas), `python3 scripts/e2e_matriculas.py` (Matrículas) `python3 scripts/e2e_ponto.py` (Ponto; gere antes as planilhas de teste com `node scripts/make_planilha_teste.js`) `python3 scripts/e2e_atendimento.py` (Atendimento) `python3 scripts/e2e_governanca.py` (Governança), `python3 scripts/e2e_talento.py` (Cargos/Desempenho/Recrutamento) `python3 scripts/e2e_clima_academy.py` (Clima/Academy) `python3 scripts/e2e_sucessao_analytics.py` (Sucessão/Analytics), `python3 scripts/e2e_gestao.py` (Gestão estratégica: identidade, mapa, indicadores, plano de ação, rituais, saúde, marketing, assistente, rotina), `python3 scripts/e2e_radar.py` (Radar da família), v22: `e2e_rematricula.py`, `e2e_cobertura.py`, `e2e_espacos.py`, `e2e_portaria.py`, `e2e_privacidade_etica.py`, `e2e_solicitacoes.py`, `e2e_rotina_v22.py` (rotina e Command Center) e `e2e_pwa.py` (app e notificações no navegador real, com Playwright; suba o servidor com `NODE_TLS_REJECT_UNAUTHORIZED=0 PUSH_HOSTS_EXTRA=localhost`, só para o teste, porque o serviço de notificação de teste é local) — e os demais `scripts/e2e_*.py`. v23: `e2e_insights.py` (painel, metas, comentários, assinatura, FP&A, central de fluxos, pendências e lembrete, busca, mural, Início, quadros e configurações, com todos os perfis). Testes unitários dos cálculos: `npx tsx scripts/test_avaliacao.ts` (motor de avaliação), `npx tsx scripts/test_v23.ts` (variação, farol, agregação da rede, acumulado, leitura do mês, previsões, FP&A, situação dos prazos, pendências, busca, Início e eixos dos gráficos) e `npx tsx scripts/test_gestao.ts` (farol, razões, períodos, rituais, aderência, saúde estratégica, maturidade, funil, jornada, segmento e prompt do assistente).

---

## 5. Estrutura do código

```
src/app/(app)/           páginas autenticadas (colaboradores, organograma, processos, ferias, banco-de-horas, documentos, auditoria, configuracoes, conta)
src/lib/acesso.ts        v29 · acesso pelo cargo: atuações, aprovações, telas (catálogo = menu), cálculo do acesso efetivo (cargo, exceção, substituição, conta sem ficha), sessão recalculada do banco, sincronização e “quem aprova”
src/lib/menu.ts          v29 · o menu de cada atuação (usado no layout, no catálogo de telas do cargo e em “o que a pessoa vê”)
src/app/(app)/configuracoes/acessos/{,cargo/[id],usuario/[id]} · acesso-actions.ts   v29 · matriz de acesso, editor do cargo, o que a pessoa vê (exceção, substituição, conta sem ficha)
src/app/(app)/sem-acesso  v29 · tela fora do acesso do cargo
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
src/lib/kpi-catalogo.ts · kpi-calc.ts · kpi.ts   base de indicadores v23: catálogo (57), cálculos por mês e unidade, metas, visões, leitura do mês e previsões
src/lib/painel-executivo.ts · src/app/(app)/executivo/{,indicador/[chave],metas,dicionario} · src/app/apresentacao   Painel Executivo e modo apresentação
src/components/graficos.tsx · Quadro.tsx · BuscaGlobal.tsx   kit de gráficos SVG (sem biblioteca), quadros em colunas e busca Ctrl+K
src/lib/fpa.ts · src/app/(app)/financeiro/{orcamento,orcamento/planilha,projecao}   orçado × realizado, orçamento mês a mês e caixa projetado
src/lib/fluxos.ts · src/app/(app)/fluxos   central de fluxos e SLA · src/lib/pendencias.ts · src/app/(app)/pendencias   minhas pendências
src/lib/inicio.ts · src/app/(app)/page.tsx · inicio/personalizar   Início personalizável · src/lib/busca.ts · src/app/api/busca   busca global
src/lib/reconhecimento.ts · src/app/(app)/reconhecimento   mural · src/lib/quem-fora.ts · people-visual.ts · metas-matricula.ts   quem está fora, analytics visual, metas e previsão de matrículas
src/lib/insights-rotina.ts · rotina-v23.ts · export-v23.ts · formato.ts · sla-texto.ts   rotina (base, resumo semanal, lembrete), CSVs e formatação pt-BR
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
