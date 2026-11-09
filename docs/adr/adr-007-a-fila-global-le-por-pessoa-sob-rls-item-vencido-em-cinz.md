# ADR-007 — A fila global lê por PESSOA sob RLS, item vencido em cinza, servidor é fonte da verdade do tempo

**Status** mantido

## Decisão

Inalterado, e agora é a policy do ADR-003 e não uma segunda policy. A consulta de 'Sua vez' é leitura por PESSOA com a policy de duas pernas (dono OU decisor designado). Devolve pendentes e vencidos recentes com o estado como coluna; vencido em cinza com desfecho e botão de reabrir, nunca suprimido. Servidor envia instante absoluto em UTC; cliente só interpola. Os dois relógios (DECISÃO, tempo de parede; EXECUÇÃO, conta trabalho) continuam separados por nome de campo. O agrupamento muda de 'por empresa' para 'por pessoa e por agente' — é o critério de agrupamento de core/fila-frota.ts que muda, não a assinatura.

## O que mudou

Só o critério de agrupamento. A policy de duas pernas deixa de ser sobre tenant e passa a SER a policy de visibilidade do ADR-003.

## Por quê

Este ADR já se chamava 'lê por PESSOA' — estava certo por antecipação e a premissa nova só tirou o ruído de tenant que o cercava. Uma frente escreveu um ADR NOVO inteiro, com quatro alternativas rejeitadas, para chegar onde este ADR já estava. Era uma emenda de um parágrafo. E a alternativa 'consultar com role privilegiado e filtrar na aplicação' fica MAIS perigosa agora: a fila é a única tela onde o trabalho do time inteiro legitimamente se mistura, é a tela de abertura, e é onde um bug de filtro expõe conversa privada de colega.

## Refinamento (2026-09-16, 0003 e 0004 — a decisora decide, não apaga)

- A segunda perna ("decisor designado") é `decisor_id = current_setting('nod.pessoa_id')` na policy de `decisoes` (EMENDA 1) e um EXISTS na decisão em `itens_aprovacao`. Ela abre a LEITURA; para a decisora DECIDIR, a 0003 criou `nod_decisora` (PERMISSIVE FOR UPDATE, USING e WITH CHECK pela perna) com o trigger que fecha as colunas do ato de decidir — estado, desfecho, decidida_em, decidida_por, vista_em, e `prazo_decisao_em` só na transição vencida → reaberta (o botão "reabrir"). Em `itens_aprovacao`: selecionado, marcado_por, marcado_em, texto_final, editado_por.
- Com a 0004 (policies por comando), a decisora não apaga a decisão nem o item (DELETE é só da dona; antes o USING FOR ALL deixava). O que exige `owner_id` = pessoa — mensagem de resultado, turno de retomada, concessão — roda numa transação da DONA: a composição (`src/adapters/http/rotas/decisoes.ts`) separa a fase da decisora (marcar, fechar) da fase da dona (assentar, retomar), e a decisão diz quem é a dona (`ownerId`).
- `listarSuaVez` carimba `vista_em` ao listar (listar = ver): é o único sinal que separa `expirou_sem_ninguem_ver` de `expirou_com_alguem_ciente` (ADR-017 #2); consultas de fundo passam `marcarVista: false`.


## Refinamento (2026-09-24 — a pessoa dispensa; o sistema continua sem suprimir)

- "Nunca suprimido" vale para o SISTEMA: nenhum laço, filtro ou prazo tira um pedido da tela sem a pessoa saber. A pessoa, sim, pode tirar: o × do card chama `POST decisoes/:id/dispensar` (`src/use-cases/dispensar-decisao.ts`), que fecha como `decidida` com desfecho `{ tipo: "dispensada", por, em, antes }`. O registro fica; só sai da fila.
- Vale para vencida de qualquer tipo e, aberta, só para os tipos que se respondem com texto (pergunta, falta_de_dado, permissao). Aprovação, acesso e propostas abertas continuam só com os próprios botões de recusar — dispensar uma aprovação pularia o registro dos itens.
- Decisão com proposta de mesmo id ainda pendente (acesso, mudança de rotina): a proposta é recusada junto, senão o card dela voltaria à conversa com botões que dariam `estado_invalido`.
- Motivo, medido no dia: a conversa da Nina tinha cinco cartões "falta um dado" (quatro vencidos) de rotinas que rodaram sem Gmail, fixos no fim do chat, e o único botão era "Reabrir". Na conversa, "Limpar vencidos (N)" aparece a partir de dois vencidos.
- Gatilho de revisão: se aparecer pedido dispensado por engano que precisava voltar, o caminho é oferecer "desfazer" logo depois do ×, não esconder o ×.

## Refinamento (2026-09-24 — fila honesta: grupos, vencidos recolhidos, prazos em palavras)

- Medido no dia, na tela do dono: "13 decisões esperando por você", uma conversa com 5 pedidos abertos e 15 cards cinza de "turno interrompido" vencidos, o rótulo "venceu expirou com alguem ciente", "recusa automática" em tipo onde nada é recusado e o ⚑ contando gêmeas que o chat já escondia.
- **Grupos.** `montarFila` dobra os pedidos ABERTOS iguais — mesma decisora, agente, conversa, tipo e frase; só `acesso` e `retomar_turno` — no mais antigo, com os outros em `ItemFila.gemeas`. A faixa, o ⚑ e o título de "Sua vez" contam grupos; a web mostra "×N" ("N pedidos iguais; decidir aqui resolve todos") e o card de proposta de cada gêmea não aparece sozinho. Listar marca as gêmeas como vistas (ADR-017 #2). Decidir, recusar ou dispensar o grupo fecha as gêmeas na mesma transação por `regra:gemea_resolvida` (desfecho de ADR-042; `src/use-cases/fechar-gemeas.ts`), e a proposta de cada uma segue o clique. Vencida nunca entra no grupo de uma aberta; aprovação e pedir_a_pessoa nunca se dobram.
- **Recolher não é suprimir.** Vencidos vão para UM `<details>` "N pedidos vencidos · ver" depois dos abertos, na conversa e em "Sua vez"; todos continuam lá dentro com o seu Reabrir, e "Limpar vencidos" fica ao lado do resumo. Três ou mais linhas de sistema seguidas na conversa viram "N avisos do sistema · ver". O sistema só recolhe; nada sai da tela sem a pessoa.
- **Palavras.** O relógio do card diz o que acontece no prazo, por tipo (`Record` exaustivo em `web/telas/sua-vez.ts`): "recusa automática" só em aprovação e acesso, "passa em branco" no gate de rotina, "vence · nada muda sem você" nas propostas. O vencido diz quando e o que houve ("venceu há 3h · ninguém chegou a ver"), e a mensagem do varredor virou "Este pedido venceu em … sem resposta — …". Os valores da métrica de expiração não mudam.
- **Dispensar o "Retomar".** O `retomar_turno` aberto também sai pelo "Dispensar" (ADR-045: a pessoa pode não querer retomar). O que muda fora da decisão roda na transação da DONA: gêmeas; pedido ainda aberto de uma execução de rotina → a janela vira `passou_em_branco` com motivo `pedido_dispensado` (o CHECK `^[a-z_]+$` de `rotina_execucoes.motivo` aceita, sem migração); pedido de ajuda do computador do bot → o controle volta ao bot, salvo takeover em curso. Dispensar continua não sendo responder (EMENDA 16).
- Gatilho de revisão: se um pedido resolvido junto precisava de decisão própria (duas propostas de acesso com a mesma frase e capacidades diferentes), a chave do grupo passa a incluir as capacidades da proposta.

## Refinamento (2026-09-24 — aviso no Mac: ler a fila não é sempre ver)

- Com os avisos (notificação do macOS e número no Dock, ou Notification API e título da aba no navegador), a web passa a ler "Sua vez" com a janela ESCONDIDA ou fora de foco: é essa leitura que decide o aviso e o número. Se ela carimbasse `vista_em`, todo pedido que chega com a pessoa longe sairia como `expirou_com_alguem_ciente` — o rótulo "ninguém chegou a ver" (ADR-017 #2) deixaria de existir justamente no caso que o aviso veio resolver.
- Por isso `GET sua-vez?ver=0` lista sem carimbar (`marcarVista: false`, inclusive nas gêmeas do "×N"); sem o parâmetro, listar continua sendo ver. A web manda `?ver=0` quando `document.visibilityState !== "visible"` ou `!document.hasFocus()`, e relê sem ele quando a janela volta para a frente — o carimbo sai quando a pessoa de fato vê a faixa.
- A decisora designada que não é dona não recebe frame `decisao.*` (o outbox manda à dona, ADR-016): a web relê "Sua vez" a cada 60 s no relógio que já existia (4 ticks de 15 s), para que o pedido dela apareça — e avise — sem depender de outra leitura.
- Validação: `tests/integration/sua-vez.test.ts` (HTTP: `?ver=0` não carimba nem a gêmea; sem o parâmetro, carimba).
- Mostrar o aviso não carimba: a notificação não prova leitura. Clicar nela traz a janela para a frente, e a releitura carimba. Quem só lê a frase no aviso e não abre o nod deixa o pedido vencer como "ninguém chegou a ver" — aceito.
- Gatilho de revisão: se a medição mostrar pedidos lidos só pelo aviso (a pessoa diz que viu e o rótulo diz que não), o carimbo passa a ter um terceiro estado ("avisada") em vez de reusar `vista_em`.

## Emenda (2026-10-30 — NOD-399: a proposta vencida vira a linha "expirado" no lugar dela)

- Na CONVERSA, a proposta cuja decisão venceu (`comDecisaoVencida`: mudança e exclusão de rotina, acesso e credencial) não vai mais para o `<details>` "N pedidos vencidos · ver": encolhe numa linha no lugar do card (critério 7 da NOD-399, protótipo v2) — "Excluir uma rotina de Ada · expirou sem resposta, nada mudou · Reabrir · Dispensar". Uma vez só: a proposta que já tem recibo de decidida não volta como linha.
- Continua valendo "recolher não é suprimir": a linha tem o Reabrir e o Dispensar (que recusa a proposta junto, como no refinamento de 2026-09-24). Os outros vencidos (pergunta, falta de dado, aprovação, retomar) seguem no `<details>` e em "Limpar vencidos". "Sua vez" não muda.
- Gatilho de reversão: se a conversa voltar a acumular linhas "expirado" no fim (o caso da Nina, cinco cartões fixos), as linhas entram no "Limpar vencidos (N)" ou voltam para o `<details>` a partir de duas.
