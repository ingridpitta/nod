# ADR-155 — Saída obrigatória do trabalho da tarefa

Status: proposta (2026-11-07, ADA-232) · Plano: [docs/planos/ADA-232.md](../planos/ADA-232.md) · Emenda a regra do
varredor de `quadro_execucoes` (NOD-418) e o papel do zelador de prazos (avisos do quadro).

## Contexto

Em 05/11 a tarefa do PR #677 (ADA-228) parou 5 vezes: o bot abria o PR, conferia a CI e o turno terminava sem mover nada.
`decidirAposTermino` só reage a falha; trabalho concluído sem movimento vira "nada", e só o zelador de prazo acordava a
tarefa. No card isso aparece vazio ("parado sem motivo"), sem dizer se o bot espera algo ou desistiu.

## Decisão

1. **Todo trabalho de tarefa termina numa de 4 saídas:** (a) andou — `terminei`, mudança de coluna ou PR; (b) Precisa de
   você com pergunta; (c) Bloqueado com motivo; (d) volta depois — `esperar_comando` ou `me_chame_as` ligados à tarefa,
   retomando a mesma sessão e pasta.
2. **O motor registra a saída** ao assentar o turno (`quadro_execucoes.saida`), a partir das ferramentas chamadas e da
   tarefa antes/depois. A regra mora no domínio; o prompt só explica.
3. **Sem saída:** um reacionamento na hora, na mesma cadeia/sessão, com o aviso "você parou sem dizer o porquê, escolha uma
   saída". Duas seguidas → Precisa de você com "o bot parou 2x sem saída".
4. **Volta quando a CI terminar:** `me_chame_as` ganha `quando: "ci"`, ligado ao PR da tarefa; o varredor confere os
   checks e acorda a cadeia, com expiração de 24 h.
   **Emenda de 2026-11-10 (comparação Multica × nod, os wakeups `--until-pr merged/conflicts` e `--until-issue`):** o mesmo
   varredor acorda também `quando: "merge"` (o PR da tarefa saiu de aberto), `quando: "conflito"` (o PR aberto ficou com
   conflito, ou saiu de aberto) e `quando: "tarefa"` com `tarefa` (código ou id de outra tarefa do mesmo quadro) e `estado`
   opcional (`feito` = grupo Feito, `revisao`, `bloqueado`; sem ele, o primeiro dos três). Cancelar ou apagar a outra
   tarefa também acorda. A condição mora em `turnos.acordar_quando`/`acordar_pr_url`/`acordar_tarefa_id`/
   `acordar_tarefa_estado` (0171), a regra em `voltaPorEventoPronta`. O card mostra "Esperando o merge", "Esperando
   conflito" e "Esperando ENG-12"; a expiração continua 24 h.
5. **Freios:** mesma volta 3x sem novidade pausa (regra existente de voltas); retomadas e novas tentativas passam a
   contar no teto de 12 acionamentos por tarefa por hora; o freio de ir e voltar continua.
6. **O zelador deixa de cobrar** tarefa com volta marcada ou trabalho vivo; continua cobrando prazo.
7. **O card mostra um estado numa linha:** trabalhando · esperando + motivo · precisa de você · bloqueado. Frente aberta
   pela tarefa conta como trabalhando. No detalhe, "Volto quando…" com a ação registrada `quadro.acordar_trabalho`
   ("Acordar agora"), viva na tela e no `gerir_quadro`.

### Emenda (2026-11-10, ADR-142): o trabalho preso à etapa

Quando a tarefa sai da etapa em que o trabalho nasceu por outro (a pessoa ou outro bot) e o turno não foi parado, ele
termina preso à etapa dele e não muda mais o status. Sem saída própria (nenhuma), a saída gravada é **andou**: a tarefa
andou, e ele não é reacionado nem levado a Precisa de você. As saídas explícitas (Precisa de você, Bloqueado, volta)
continuam valendo como antes.

## Emenda de 2026-11-10 (comparação Multica × nod, P1, P4 e P8)

8. **Onde a regra vale (P1).** Vale em toda coluna em que o trabalho anda: A fazer e o `andando` do domínio
   (`src/domain/quadro.ts`: todo o grupo iniciado menos Bloqueado e a espera da pessoa — Fazendo, **Em revisão** e as
   colunas de andamento da pessoa). Antes o varredor tinha uma regra própria (só A fazer e Fazendo), e o bot acionado
   pela passagem em Em revisão (ADR-142) que parava sem saída era gravado como "fora" e valia como "andou".
9. **Turno aberto por comentário (P4).** O comentário que aciona o **responsável** abre um trabalho da tarefa (origem
   `comentario`); desde esta emenda ele também grava a saída e é cobrado pelas 4 saídas, e é o trabalho atual da tarefa
   em toda coluna que aciona (não só Fazendo). **Critério da exceção** (`cobraTurnoDeComentario`): o turno que parou sem
   saída mas **comentou na tarefa** durante o turno só respondeu (a pergunta ou a consulta da pessoa teve resposta; no
   Multica responder não muda status) e não é cobrado — a saída não se grava, e saída nula nunca reaciona. O bot
   @mencionado que não é o responsável não vira trabalho da tarefa e nunca é cobrado (a tarefa não é dele). Calado e sem
   saída, o turno de comentário do responsável é cobrado como qualquer outro.
10. **A ida à espera pelo varredor entra nos movimentos (P8).** Bloqueado ou a marca de espera da pessoa postos pelo
    varredor gravam o movimento (`mover`; o freio do reacionamento, `freio`), como o lote: o card ganha o Desfazer e
    `entradasNaEspera` acha a entrada.

## Consequências

- Nenhum trabalho de tarefa acaba em silêncio; o pior caso custa 1 turno extra antes de ir para a pessoa.
- Uma migração aditiva (`quadro_execucoes.saida`, `turnos.acordar_quando`/`acordar_pr_url`, `trabalhos.tarefa_id`).
- Dependência do GitHub para a volta por CI; com ele fora, a expiração garante o retorno.
- Turnos de conversa e o zelador de prazo não mudam.
- Emenda de 2026-11-10 (ADA-289, PR #723): vale em toda coluna que anda (grupo iniciado fora de Bloqueado e de
  Precisa de você), inclusive Em revisão, que aciona pela passagem desde a ADR-142; antes o varredor olhava só A fazer e
  Fazendo e o bot que parava calado na revisão valia como "andou". O turno aberto por **comentário** continua fora da
  cobrança (de propósito): ele roda ao lado do trabalho da tarefa, e responder o comentário com outro comentário é o fim
  esperado dele; quem segue cobrado é o trabalho da tarefa.

## Alternativas descartadas

- **Inferir a saída por `mudado_em` da tarefa:** não distingue "esperando" de "parou" e falha quando a pessoa mexe em
  paralelo. Fica só como rede.
- **Deixar o zelador acordar mais cedo:** abre turno novo (outra sessão), sem contexto, e é o que gerou as 5 paradas.
- **Estado/coluna nova "Esperando":** contraria a regra de Sua vez como único lugar de decisão e enche o quadro.

## Gatilho de revisão

Se mais de 10% dos trabalhos de tarefa numa semana caírem em "o bot parou 2x sem saída", rever as instruções ou o
limite de reacionamento.
