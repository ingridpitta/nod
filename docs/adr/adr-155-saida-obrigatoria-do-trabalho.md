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
5. **Freios:** mesma volta 3x sem novidade pausa (regra existente de voltas); retomadas e novas tentativas passam a
   contar no teto de 12 acionamentos por tarefa por hora; o freio de ir e voltar continua.
6. **O zelador deixa de cobrar** tarefa com volta marcada ou trabalho vivo; continua cobrando prazo.
7. **O card mostra um estado numa linha:** trabalhando · esperando + motivo · precisa de você · bloqueado. Frente aberta
   pela tarefa conta como trabalhando. No detalhe, "Volto quando…" com a ação registrada `quadro.acordar_trabalho`
   ("Acordar agora"), viva na tela e no `gerir_quadro`.

## Consequências

- Nenhum trabalho de tarefa acaba em silêncio; o pior caso custa 1 turno extra antes de ir para a pessoa.
- Uma migração aditiva (`quadro_execucoes.saida`, `turnos.acordar_quando`/`acordar_pr_url`, `trabalhos.tarefa_id`).
- Dependência do GitHub para a volta por CI; com ele fora, a expiração garante o retorno.
- Turnos de conversa e o zelador de prazo não mudam.

## Alternativas descartadas

- **Inferir a saída por `mudado_em` da tarefa:** não distingue "esperando" de "parou" e falha quando a pessoa mexe em
  paralelo. Fica só como rede.
- **Deixar o zelador acordar mais cedo:** abre turno novo (outra sessão), sem contexto, e é o que gerou as 5 paradas.
- **Estado/coluna nova "Esperando":** contraria a regra de Sua vez como único lugar de decisão e enche o quadro.

## Gatilho de revisão

Se mais de 10% dos trabalhos de tarefa numa semana caírem em "o bot parou 2x sem saída", rever as instruções ou o
limite de reacionamento.
