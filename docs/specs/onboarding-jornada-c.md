# Onboarding, jornada C: pulou sem IA

Spec escrita com `/spec` em 2026-11-06. Depende da jornada A (tela "Este computador" com "Pular por agora"). Rascunho.

Protótipos neste PR: `prototypes/onboarding-2026-11/jornadas.html#c` e `prototypes/onboarding-2026-11/prancha-c.html` (5 telas). Fontes editáveis: protótipo https://claude.ai/artifact/512SXTVrFLRSs3uwqXY8jt · prancha https://claude.ai/artifact/WqK7sEopZc4dwURXKkTQis.

## Contexto

O Marlon decidiu em 05/11: sem assinatura a pessoa pode pular e ver a plataforma, com uma mensagem padrão dos bots e um card elegante para instalar ou entrar. Hoje, sem IA, a primeira mensagem vira "Turno interrompido: a IA não conseguiu abrir neste Mac" (`src/domain/redacao.ts:196`), um erro técnico no lugar da fala do bot, e o card "Sua IA não foi encontrada · Conectar" fica no rodapé da barra (visto em 05/11).

## Estado atual (verificado em 2026-11-06)

| Peça | Onde | Hoje | Lacuna |
| --- | --- | --- | --- |
| Turno sem IA | `src/domain/stream-json.ts:493` → `lancamento_falhou`; `redacao.ts:196` | Erro na conversa | Não é fala; cita "Mac"; sem caminho para resolver |
| Conta recusada | `web/telas/ia-fora.ts` (`avisoContaSemAcesso`, `linhaIaTrocada`), `assentar-turno.ts` repete o pedido noutra IA | Já resolve o caso "conta sem acesso" com aviso e botão | Não cobre "nenhuma IA nesta máquina" |
| Cartão da IA | `web/telas/cartao-ia.ts` (instalar, entrar e testar em até 3 passos) | Vive em Provedores de IA e no onboarding | Não aparece na conversa |
| Trava de envio | por pessoa (agregado `inventario_motores`) | Impede enviar sem IA | Olha a pessoa, não a máquina |
| Onboarding sem IA | `onboarding-controle.ts` "Configurar sem voz" | Entrevista pelas ferramentas do modelo | Sem modelo, a entrevista não anda |

## Mudança proposta

1. **O bot responde como bot** (tela C): "Recebi. Estou sem IA neste computador, então ainda não consigo pensar nisso. Conecte uma e eu começo na hora; a mensagem fica guardada." A mensagem entra na conversa e fica pendente.
2. **Um card só, na conversa**, logo abaixo da fala, no padrão `.cp` (`web/card-proposta.css`): "Conectar uma IA neste computador", com Claude ("instalado, falta entrar" ou "instala em menos de um minuto") e ChatGPT, cada um com o botão do `cartao-ia.ts`, e o rodapé "Outras IAs · Grok e Gemini em breve". Mensagens seguintes sem IA **não** empilham card: o bot responde uma linha ("Ainda sem IA aqui. A mensagem fica guardada; é só conectar no card acima") e o card existente se atualiza.
3. **Depois de conectar:** o card vira a linha "Claude conectado como ana@…", e as mensagens guardadas rodam na ordem, pelo mesmo caminho que `assentar-turno.ts` já usa para repetir numa outra IA.
4. **Barra:** o aviso "Sem IA neste computador · Conectar" é um botão de verdade, persistente, e leva ao card na conversa do Nod. Composer: a dica "Bruna responde quando uma IA estiver conectada aqui" em vez de travar o envio.
5. **Onboarding sem IA:** a conversa com o Nod anda só por chips (confirmar o nome, escolher o objetivo); texto livre recebe "Sem IA aqui eu só consigo seguir pelas opções". O card de proposta diz "Pensa com: a IA que você conectar".
6. **Conta sem acesso ao plano** (2g): o estado que `ia-fora.ts` já detecta ganha a tela de "Este computador" com "Entrar com outra conta", e o mesmo card na conversa.

### Detalhes de implementação

- `lancamento_falhou` deixa de virar texto na conversa quando a máquina não tem IA pronta: o despacho não abre turno; a mensagem fica `pendente_sem_ia` (estado novo no domínio puro, `src/domain/`), com a fala fixa do bot gerada sem modelo.
- O card é um bloco "ao vivo" como os cartões de `conta-no-chat.ts` (um ativo por vez, vira linha ao resolver): um por conversa, atualizado, nunca duplicado.
- A trava de envio e o aviso passam a ler o estado por máquina (mesma mudança da jornada B).
- Estado da conta do plano: reutiliza a detecção de `ia-fora.ts`.

## No chat

Nenhuma ação nova de pessoa: conectar a IA é ponte do app (`PonteIas`) e o card é o cartão que responde a pessoa (exceção ADR-135 §2). A fila `pendente_sem_ia` é estado do turno, sem rota de pessoa nova.

## Critérios de aceite

1. Sem IA nesta máquina, a primeira mensagem a qualquer bot recebe a fala do bot e um card; nunca "Turno interrompido".
2. Três mensagens seguidas sem IA: um card só na conversa, três linhas curtas do bot.
3. Conectar pelo card: o card vira linha com o e-mail e as mensagens guardadas são respondidas na ordem.
4. O aviso da barra é um botão focável, persistente enquanto a máquina não tem IA, e leva ao card.
5. Onboarding sem IA anda só por chips e conclui; o card de proposta não cita o Claude como certo.
6. Conta sem acesso ao plano: tela 2g e card com "Entrar com outra conta".
7. Nenhum texto "Mac" fora do Mac. `npm run check` verde.

## Plano de testes

| Camada | O quê | Quantos |
| --- | --- | --- |
| Unit | fala fixa sem IA; um card por conversa; chips-only no onboarding; `redacao.ts` por plataforma | +6 |
| Integration | mensagem `pendente_sem_ia` → IA conecta → turno roda na ordem (`withRollback`) | +3 |
| e2e | `e2e:fumaca`: pular → mensagem → conectar (catcher) → resposta | +1 |

## Rollback

Reverter o PR. Sem migração se o estado pendente couber no enum existente por `ALTER TYPE … ADD VALUE` (aditivo, com o rollback de renomear e recriar, modelo da 0060); caso contrário a fila vive no app até a IA chegar.

## Esforço

Fala fixa + fila pendente 1 d · card na conversa 1 d · barra e composer por máquina 0,5 d · onboarding por chips 0,5 d · testes 0,75 d. ~4 dias.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `src/domain/stream-json.ts:493`, `src/domain/redacao.ts:196`, `src/contracts/motivos.ts` | sem IA não é turno interrompido |
| `web/telas/ia-fora.ts`, `web/telas/cartao-ia.ts` | card de conexão na conversa |
| `web/telas/barra.ts`, `web/telas/conversa.ts` | botão persistente, dica no composer |
| `web/telas/onboarding*.ts` | chips sem IA |

## Fora do escopo

- Falar com o bot sem IA por um modelo do servidor (hoje a IA é sempre da pessoa, ADR-019).
- Jornadas A, B e D.

## Implementação (PR #693, atrás de NOD_ONBOARDING_TEXTO=1)

- **Sem estado novo e sem migração.** A mensagem guardada é um turno `pendente` com prazo de 7 dias (`PRAZO_SEM_IA_MS`), sem `interrompidoCom`, e a fala fixa é uma negação `plano_ausente` com `terminal: false` e `aguardaIa: true` (`src/domain/sem-ia.ts`). Desvio do plano: o campo `aguardaIa` no lugar de uma classe nova, para não mexer nos enums nem nas tabelas de destino.
- **Reivindicar espera a IA.** Com `harnessesProntos` anunciado, a máquina não pega o turno com fala guardada sem a IA dele pronta (`turnos.repo.ts`). O filtro é pelo dado, não pela flag; o turno comum continua indo para a máquina, que recusa nomeando a IA (ADR-090).
- **Na ordem.** As guardadas da conversa saem juntas num turno só (a fila lida junta, `absorverPendentes`), na ordem; a fala fixa fica fora da janela do modelo.
- **Tela pelo dado.** A web reconhece a negação `aguardaIa` (`web/telas/sem-ia-conversa.ts`): balão do bot, um card por conversa (só na última fala), linha "… conectado" quando a IA fica pronta, botão na barra que leva ao card e dica no composer. O botão do card abre Provedores de IA, onde o cartão da IA instala e entra (**assumido**: não embute o cartão inteiro na conversa).
- **Mac.** `lancamento_falhou`, `motor_ausente` e `nao_autenticado` dizem "neste computador", sem flag (bug). `maquina_sem_contato` mantém "seu Mac", porque Windows e Linux já têm frase própria (ADR-045).
- **Pendente da jornada A.** A conversa por chips e a tela "Este computador" (2g, "Entrar com outra conta") ainda não existem no código. Ficam prontos `FALA_ONBOARDING_SO_CHIPS` e `pensaCom()` em `web/telas/sem-ia-conversa.ts` para a A usar.
