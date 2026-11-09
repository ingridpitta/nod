# ADR-050 — Bot novo é bot completo

Status: aceito · Data: 2026-09-28 · Emenda ADR-033 (criação conversacional), ADR-043 e ADR-044.

## Contexto

Em 28/09, às 10:47, o Marlon criou a Teodora. No primeiro pedido, às 10:48, escreveu: "quero que você
vire minha assistente pessoal (...) verifique o que os agentes Taga, Ada e Nina fazem e pegue o que eles
fazem para você". A Teodora respondeu "não consigo" cinco vezes, nestas mensagens:
- "Não consigo ver os outros agentes daqui";
- "Não consigo ir mais a fundo";
- "Não consigo perguntar para elas";
- "Não consigo mandar mensagem para elas", com um texto para ele copiar e colar em cada bot;
- "Não consigo consultar um colega", depois que ele usou o atalho "Pedir ajuda a outro bot" do painel.

Ele relatou a mensagem como "Não fez o que pedi" (relato `16884e53`, banco diário).

A causa não era o modelo. O bot sem perfil confirmado roda em `modo = criacao`, e os 5 eventos
`turno_despachado` da conversa registram `modo: criacao` com 4 ferramentas: `atualizar_perfil`,
`pedir_acesso`, `criar_rotina` e `lembrar`. Sem `perguntar_a_bot` e sem `delegar_tarefa`, o diretório de
colegas também saía do prompt. O bot só sai da criação quando a pessoa confirma um perfil, e a Teodora
esperava saber o que as colegas faziam para propor esse perfil. Era um impasse.

Tudo o que a Teodora precisava estava no banco: a Nina resume o Gmail às 8h, 13h e 18h; a Ada monta os
ToDos às 8h e ao meio-dia; a Taga vigia o Slack a cada 10 minutos.

A primeira proposta de correção foi pôr `perguntar_a_bot` na criação. Ela foi recusada por não mudar a
experiência:
- cada resposta de colega volta num turno separado, com o catálogo de peer (só `lembrar`);
- a pessoa receberia três respostas picadas;
- no fim, o bot continuaria sem poder propor o perfil.

O desenho que valeu está na página "Bot novo" do canvas "Nod — tela do agente".

## Decisão

1. **A criação tem o kit da conversa mais `atualizar_perfil`.** Isso inclui o computador e as pastas,
   com as ferramentas nativas de arquivo nas mesmas condições da conversa (`nativasDoTurno`, emenda da
   ADR-039 do mesmo dia: entrada confiável e pasta autorizada).
   Perfil vazio deixa de ser trava de capacidade e vira uma linha no prompt: o primeiro pedido é trabalho
   para fazer agora, e quando a missão fica clara o bot propõe o perfil no mesmo turno.
   `modoDoTurno` continua devolvendo `criacao` (o prompt e o `atualizar_perfil` dependem disso).
2. **`ver_colegas`: o que um colega faz é dado do nod.** A ferramenta devolve perfil, rotinas (id,
   horário, estado, instrução) e apps concedidos (com o nível) dos colegas, com o mesmo filtro do
   diretório (`ehColega`: mesmo dono, confirmado, visível). A resposta sai na hora e é confiável, porque é
   configuração que a pessoa confirmou. Sem `agente`, vem o resumo de todos; com `agente`, o colega
   inteiro. Os cortes existem porque o proxy corta o resultado em 8 mil caracteres. A ferramenta entra em
   criação, conversa e sala. `perguntar_a_bot` fica para opinião.
3. **O perfil vem com as rotinas, num card só.** `atualizar_perfil` aceita `rotinas`, cada uma no schema de
   `criar_rotina` e validada pelo mesmo caminho (`prepararRotina`). Cada rotina vira uma proposta 'rotina'
   sem decisão em "Sua vez", porque o card do perfil é o único lugar onde ela se confirma. Uma rotina
   recusada pelo domínio devolve `{erro, rotina: índice}` e nada é criado.
   - Confirmar o perfil ativa as rotinas na mesma transação e concede os acessos que elas declaram
     (ADR-044), com UMA linha de sistema (`semMensagem`).
   - Recusar o perfil recusa as rotinas junto.
   - A web desenha tudo num card (`card-perfil.ts`) e esconde as rotinas soltas.
4. **Confirmar o perfil retoma o turno que o propôs** (`retomar-apos-perfil.ts`), como conceder um acesso
   retoma a tarefa. A entrada da retomada pede o próximo passo e, se o bot assumiu trabalho de colegas, que
   pergunte com `pedir_a_pessoa` se deve pausar as rotinas deles.
5. **Pausar ou reativar a rotina de um colega vale quando a pessoa pediu.** `pausar_rotina` e
   `reativar_rotina` aceitam a rotina de um colega (o filtro `ehColega`) só com entrada confiável. Pergunta
   de outro bot, conteúdo de conector ou rotina acordada sozinha nunca mexem na rotina de outro agente. A
   conversa do colega recebe a linha "{bot} pausou esta rotina a seu pedido". Atualizar e excluir a rotina
   de um colega continuam fora do alcance.

## Alternativas descartadas

- **Só `perguntar_a_bot` na criação.** Três respostas picadas em turnos de peer que não conseguem propor o
  perfil (ver Contexto).
- **Pôr rotinas e apps de cada colega no diretório do prompt.** O dado chegaria sem chamada, mas cada
  mudança de rotina de qualquer colega invalidaria o cache do prompt, e a rotina (que roda sem ninguém)
  pagaria o texto a cada disparo. Sob demanda, custa uma chamada só quando precisa.
- **Um card por rotina, como antes.** Cinco confirmações para um pedido; o canvas mostrou um card só.
- **Pausar as colegas no próprio card do perfil** (uma caixa marcada "pausar as rotinas da Nina, Ada e
  Taga"). Economiza um clique, mas decide pela pessoa antes de a nova rotina provar que funciona.

## Gatilho de reversão

- Se, em 30 dias, a trilha mostrar um bot em criação chamando ferramenta de computador ou
  `pedir_aprovacao` e a pessoa recusar o item ou abrir incidente, o kit completo na criação está largo
  demais. Nesse caso, o computador volta a ficar fora da criação.
- Se aparecer na trilha uma `pausar_rotina` de colega sem mensagem da pessoa pedindo pausa na janela da
  conversa, a regra de "entrada confiável" não basta e passa a exigir resposta de `pedir_a_pessoa` no
  mesmo fio.
- Se mais de 1 em cada 5 perfis com rotinas for recusado inteiro por causa de uma rotina, o card passa a
  permitir desmarcar rotinas.

## Não implementado

- Desmarcar rotinas dentro do card; hoje é tudo ou "Ajustar" pela conversa.
- Ver as instruções inteiras das rotinas no card; o card mostra o começo, e o resto fica no `title`.
- Pausar "por uma semana": pausar é até a pessoa reativar.

## Emenda (2026-10-28, NOD-23): `/configurar` reabre a entrevista num bot já confirmado

- **Submodo, não modo novo.** `/configurar` (apelidos `/setup` e `/config`) na conversa própria com um bot da
  pessoa, confirmado, não excluído e que não é o Nod, liga `agentes.configurando_desde`. Enquanto a janela está
  viva, o turno de conversa recebe também `atualizar_perfil` e a linha da entrevista no prompt (no máximo 4
  perguntas, uma por mensagem, resumo e "Certo?"). Tudo o mais que vale para `conversa` continua valendo.
- **Nada muda sem a pessoa.** A ferramenta só propõe; o perfil muda no cartão de sempre (`confirmar-perfil`).
- **Fim do modo.** Confirmar, recusar ou a proposta ficar obsoleta fecha o modo (`encerrarConfiguracao`). Sem
  nada disso, ele expira em 2 h. O turno que é o próprio `/configurar` vale mesmo atrasado (fila, repetição) e
  religa a janela a partir da emissão.
- **Sessão viva.** A fala `/configurar` não é absorvida pelo turno em curso (ADR-067): vira turno próprio, com o
  plano que a traduz.
- **Ressalva aceita.** Um turno já emitido com `atualizar_perfil` continua com ela se a pessoa recusar o cartão no
  meio dele; o bot pode propor de novo, mas nada muda sem confirmar.
- **Gatilho de reversão.** Se, em 30 dias, aparecer na trilha um `atualizar_perfil` fora da criação sem um
  `/configurar` da pessoa nas 2 h anteriores, a janela por coluna não basta e passa a exigir o comando no mesmo turno.
