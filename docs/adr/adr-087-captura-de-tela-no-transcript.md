# ADR-087 — Captura de tela do turno no transcript: retenção e privacidade

Status: **proposta** (rascunho para decisão do Marlon) · Data: 2026-10-08 · Origem: [NOD-200](https://linear.app/gamefik/issue/NOD-200)
· Relaciona-se com [ADR-002](adr-002-classificacao-de-dado-pessoal-por-origem-funcao-pura-def.md) (dado pessoal e poda),
[ADR-037](adr-037-computadores-por-bot.md) (computador do bot) e [ADR-046](adr-046-anexos-no-chat-vao-para-o-modelo.md) (anexos de mensagem).

> Este texto é uma proposta. O código da NOD-200 entra desligado (`NOD_CAPTURA_NO_TRANSCRIPT` ausente), e só deve ser
> ligado em produção depois que as perguntas em aberto abaixo forem respondidas.

## Contexto

Quando o bot usa o computador dele, a pessoa só lê a fala final ("Pronto, o painel está atualizado"). Ela não vê o que o
bot viu. A NOD-200 pede que a última tela observada no turno entre na conversa como imagem da fala, para a pessoa
conferir o resultado sem abrir o computador.

A tela é dado novo na conversa. Pode conter dado pessoal de terceiros, como e-mails, nomes, documentos ou painéis de
cliente, e passa a ficar guardada no banco do nod, não só no contêiner efêmero do computador.

## Decisão proposta

1. **O que é capturado.** A última tela que o bot recebeu de `computador_observar` (ou de qualquer ação que devolve tela)
   no turno, de qualquer computador. O guardador fica em memória, em `src/adapters/fundo/computadores.ts`. Ele grava antes
   da dedup da NOD-161, então a tela repetida que o modelo recebeu sem imagem continua sendo a captura. Nada é
   capturado nestes casos:
   - a pessoa está no controle (`pessoa` ou `aguardando_pessoa`);
   - a ação voltou com erro;
   - a ação foi executada depois de uma aprovação (`executarAprovado`), porque o modelo não viu essa tela.
2. **Onde entra.** Só na fala de texto do bot criada por `mensagens.criar` no assentar. A captura vira um anexo
   `image/png` chamado `tela-HHMM.png`, preso à mensagem. Ficam de fora a sala, o silêncio (`sem_novidade`), a rotina
   derrubada pela máquina, a entrega tardia, o passe e o `/compactar`. O assentar só **lê** a captura
   (`capturas.ler`); quem a esquece é a ponte (`capturas.esquecer`), depois do assentar confirmado, em todos os ramos.
   Assim nada sobra para o turno seguinte, e o assentar repetido por impasse acha a mesma tela.
3. **Não volta ao modelo.** O histórico do próximo plano leva só texto, e os anexos de entrada são só os da mensagem da
   pessoa daquele turno. A captura é para a pessoa, não para o modelo.
4. **Retenção.** O anexo da captura tem a mesma regra de qualquer anexo (ADR-046):
   - fica em `anexos`, com RLS por tenant e dona;
   - o `nod_poda` pode apagar;
   - vale o teto de 10 MiB, e acima dele não grava, só registra o log.

   Em memória, a tela vive no máximo 2 h e são no máximo 200 turnos, saindo o mais antigo.
5. **Falha não derruba a fala.** A gravação roda num SAVEPOINT. Se falhar, a mensagem entra igual e sai o log
   `captura_turno_falhou`, com `turno_id` e `motivo` (SQLSTATE ou código), nunca os bytes nem o texto do erro.
6. **Chave.** `NOD_CAPTURA_NO_TRANSCRIPT=1` liga o guardador e o serviço juntos. Desligada, nada fica em memória e
   `capturas.ler` devolve sempre null.

## Perguntas em aberto (precisam de decisão humana antes de ligar)

- **Prazo de retenção próprio?** Hoje a captura vive o mesmo tempo que a conversa. Faz sentido um prazo menor (ex.:
  30 dias) para capturas, com poda automática?
- **Aviso à pessoa.** A primeira captura de um bot deveria vir com uma linha explicando que telas passam a ficar
  guardadas na conversa, e como desligar?
- **Por bot ou por pessoa.** A chave hoje vale para o processo inteiro. Para produção, faz sentido uma preferência
  por bot ou por pessoa?
- **Redação de dado sensível.** Telas de login, de documentos ou de painéis de cliente deveriam ser excluídas ou
  borradas? Hoje o nod não sabe o que há na imagem.
- **Validação jurídica (LGPD).** Guardar imagem com dado de terceiros exige revisão de base legal e de política de
  privacidade. Essa decisão não é de engenharia.

## Casos de borda conhecidos

- **Retry do assentar.** Num deadlock ou erro de serialização (40P01/40001), a ponte repete a transação inteira. Como
  o assentar só lê a captura e a ponte só a esquece depois do assentar confirmado, a repetição grava a mesma tela, uma
  vez. Se a entrega falhar de vez, a captura fica guardada, como o escopo, para a entrega repetida; o que nunca chega a
  entregar sai pelo teto (2 h ou 200 turnos).
- **Restart do servidor.** A tela em memória se perde, e a fala daquele turno entra sem imagem.
- **Vários computadores no mesmo turno.** Vale a última observação de qualquer um deles.

## Consequências

- A pessoa vê o que o bot viu, na própria fala, sem abrir o computador.
- O banco passa a guardar imagens geradas pelo bot. O volume cresce no máximo uma imagem por fala de turno com
  computador.
- A web já mostrava `m.anexos` em qualquer mensagem; o `lerConversa` agora busca anexos também das falas do bot.
