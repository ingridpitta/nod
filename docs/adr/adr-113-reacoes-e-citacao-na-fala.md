# ADR-113 — Ações na fala: reações e citação de qualquer fala

Status: proposto · Data: 2026-10-18 · PR B da Fase 2 ([plano "pergunta com botões"](../plano-pergunta-com-botoes.md),
Partes 3b e 5). Emenda a [ADR-041](adr-041-o-relato-carrega-o-estado-tecnico-a-pessoa-so-aponta.md) (o relato sai do
besouro para a bandeira) e complementa a ADR-045 (a caixa "Respondendo" da Parte 3a) e a ADR-062 (a citação não lava a
confiança). Migração 0090.

## Contexto

O PR A (#389) pôs o cartão da pergunta e a caixa "Respondendo" para duas ou mais perguntas abertas. Faltava o resto da
tela "Responder, reagir e mais ações" do protótipo aprovado em 18/10: ao passar o mouse numa fala, uma barra com reagir,
responder, reportar e ⋯. Até aqui a barra tinha um botão só, o besouro do relato (ADR-042), e não havia como responder a
uma fala antiga nem marcar uma fala sem escrever. O único rótulo de citação era "respondendo à pergunta das HH:MM".

Decisões do Marlon (18/10): o bot não vê as reações na v1; "Abrir task com isto" passa pelo bot; o prazo de 24 h da
pergunta fica.

## Decisão

1. **A barra da fala** (`web/telas/acoes-da-fala.ts`, módulo próprio para a Fase 3 mexer no `renderMensagem` sem
   conflito): quatro botões só de ícone, em traço, com `aria-label` — reagir (carinha), responder (seta de retorno),
   reportar (bandeira) e ⋯. Aparece no hover e com foco (`:focus-within`); no celular, num toque na fala, com alvos de
   44 px (o ⋯ fica à vista junto das outras). A fala da pessoa não tem reagir; a linha de sistema tem só reportar e ⋯.
2. **O menu ⋯**: as reações rápidas no topo (👍 ❤️ ✅ 👀 e "+", que abre a lista fechada de 16) e os itens com ícone à
   esquerda: Copiar texto, Abrir task com isto, Lembrar disso (`POST agentes/:id/memoria`, tipo "fato", a fala cortada em
   600 letras, com a linha "Anotei …" na conversa; não aparece em fala `nao_confiavel`, que num clique viraria memória em
   todo prompt e linha confiável no histórico — revisão do PR, 18/10) e Ver no Raio-X (só no modo dev e só em fala com
   turno).
3. **Reações** moram na tabela `reacoes` (0090): `conversa_id`, `mensagem_id`, `emoji`, `criado_em`, mais o escopo de
   `nod_escopar_tabela` (a dona é quem reagiu). Uma por pessoa, fala e emoji (`reacoes_uma_por_pessoa`). A perna extra é a
   mesma de `mensagens`: quem é da sala lê as reações das falas dela; pôr e tirar só a própria. `PUT
   mensagens/:id/reacoes {emoji, marcada}` é idempotente e responde as reações da fala; o emoji fora da lista fechada
   (`src/contracts/reacao.ts`) é `entrada_invalida`, e a fala que a pessoa não lê é 404. Mudou: evento `reacao_mudou` →
   frame `reacao.mudou`, e a web relê a conversa. As reações da janela vêm junto da conversa
   (`ConversaDto.reacoes`, uma consulta) e viram o chip "👍 1" embaixo da fala; o toque no chip põe ou tira a da pessoa.
4. **O bot não lê reações** (decisão 2 do Marlon): nenhuma consulta do plano de turno toca `reacoes`.
5. **Citação de qualquer fala** (Parte 3b): o "Responder" põe a caixa "Respondendo · trecho · ×" no campo (a mesma da
   Parte 3a) e a mensagem vai com `respondeA: { mensagemId }`. O servidor confere que a fala é da mesma conversa,
   recalcula o trecho (120 letras, corte na palavra; o do cliente é ignorado) e grava o payload `resposta_a_fala` na fala
   da pessoa (jsonb, sem migração, como a ADR-045). A web desenha o trecho acima do balão, e ele leva à fala citada. A
   entrada do turno e o histórico do plano levam "(respondendo a: «trecho»)" antes do texto: com sessão retomada o bot
   só lê a entrada. O título da task que a rede de 2 min abre a partir dessa fala sai sem o prefixo.
6. **A citação não lava a confiança** (ADR-062): citar uma fala `nao_confiavel` faz a mensagem e o turno nascerem não
   confiáveis.
7. **A citação vai como mensagem comum mesmo com pergunta aberta**, e a pergunta segue aberta. O "Responder" na própria
   pergunta aberta não cita: aponta o campo para ela (`alvoId`, o "Trocar" da Parte 3a). A citação mora em
   `estado.citacoes`, fora da escolha do campo, para o `hidratar-sua-vez` não a apagar.
8. **"Abrir task com isto"** manda ao bot "Abre uma task com isto: «começo da fala»" citando a fala, como mensagem
   comum; o bot usa `abrir_task` (decisão 3 do Marlon). Nenhuma rota nova de task. O começo (50 letras, corte na palavra)
   está no texto porque a rede de 2 min tira o título da task dele: só com o pedido, a task saía com o título "Abre uma
   task com isto." (QA do PR, 18/10). A citação inteira continua em `respondeA`.
9. **O relato sai do besouro para a bandeira**: o mesmo `abrirReportarBug`, com o estado técnico (ADR-041).

## Alternativas

- **Abrir a task direto pela web**: rejeitada pelo Marlon (decisão 3). O bot sabe dar título e passos; a web não.
- **Reações no payload da mensagem**: duas pessoas da sala reagindo ao mesmo tempo disputariam a mesma linha, e a RLS de
  `mensagens` só deixa a dona escrever. Tabela própria, uma linha por reação.
- **Emoji livre**: a coluna viraria texto livre de qualquer tamanho; lista fechada de 16, crescendo por PR.

## Consequências

- O bot não sabe que a pessoa curtiu ou marcou ✅. Gatilho de revisão: três pedidos em 30 dias de "o bot devia ter visto
  a reação", ou a medição mostrar que ✅ vira o jeito de dizer "pode seguir".
- O frame `reacao.mudou` vai só para quem reagiu (as outras abas dela). Na sala, os outros membros veem a reação quando a
  conversa é relida por outro motivo. Gatilho: reação usada em sala com mais de uma pessoa.
- Reverter o código deixa a tabela `reacoes` sem uso (o código anterior não a lê); o rollback da 0090 a apaga.
- A Fase 3 (plano "chat limpo") desenha o bloco de progresso entre o balão e o chip de reações: o progresso é conteúdo
  da fala; a reação é sobre ela.
