# Onboarding, jornada B: já tem conta, computador novo

Spec escrita com `/spec` em 2026-11-06. Depende da jornada A (tela "Este computador" e conta no app). Rascunho: decisões **assumidas** na crítica de interface, a reverter pelo Marlon antes do plano.

Protótipos neste PR: `prototypes/onboarding-2026-11/jornadas.html#b` e `prototypes/onboarding-2026-11/prancha-b.html` (8 telas). Fontes editáveis: protótipo https://claude.ai/artifact/512SXTVrFLRSs3uwqXY8jt · prancha https://claude.ai/artifact/WqK7sEopZc4dwURXKkTQis.

## Contexto

Quem já usa o nod no Mac e instala no Windows (o caso do Marlon em 05/11) entra na conta e cai direto nos bots: o onboarding é por pessoa e já foi concluído, então a tela da IA não aparece. O computador novo fica sem IA, o aviso da barra é por pessoa (diz "Disponível" porque a conta existe no Mac), e a primeira mensagem morre em "Turno interrompido". Além disso os bots continuam presos à máquina padrão, que pode estar desligada, sem que a pessoa saiba.

## Estado atual (verificado em 2026-11-06)

| Peça | Onde | Hoje | Lacuna |
| --- | --- | --- | --- |
| Onboarding por pessoa | `src/use-cases/onboarding.ts:82`, `0049_onboarding.sql` | `mostrar` falso depois de concluído | Computador novo não tem tela de entrada |
| Contas de IA no servidor | `0075_contas_ia_email.sql` (ADR-105), agregado por pessoa `inventario_motores` | "Disponível" = entra na troca automática, por pessoa | A barra diz que há IA quando só o Mac tem |
| Despacho | por máquina (ADR-090); máquina padrão em `web/telas/maquinas.ts` (grupo "Máquina padrão"; `maquinas.ts:40` "a dele, senão o padrão da pessoa") | Bot sem máquina usa a padrão | Padrão offline = nada responde, sem aviso |
| Pareamento | `desktop/parear.ts` + `web/telas/parear-mac.ts` "Conectar este Mac?" (ADR-069) | Login pelo navegador confirma o Mac | No Windows o motor pareia por script, sem a confirmação |
| Texto | `maquinas.ts:246` "voltam para este Mac / outra máquina", `:414` "no seu Mac" | Texto do Mac | Não nomeia a máquina que assume |

## Mudança proposta

1. **Conta** (A1, A2, A4): entrar pelo app com Google ou código; o e-mail reconhecido traz os bots da conta.
2. **Este computador** (2b, 2d, 2a) com o cabeçalho "Oi de novo, Ana · este computador". A tela aparece em toda máquina em que a pessoa ainda não a viu (marca local da máquina, não etapa de servidor). Se o Claude está logado aqui, 2a; se instalado sem login, 2b; nada, 2c da jornada A.
3. **Onde os bots trabalham** (tela B, nova, **assumida**): depois de conectar a IA num computador novo, quando a máquina padrão está offline ou é outra: "Trabalhar neste computador" (este vira a padrão) ou "Manter no MacBook de Ana" (os bots ficam lá e esperam; aqui a pessoa só conversa). A escolha reutiliza a ação do seletor "Máquina padrão" de `maquinas.ts`.
4. **Avisos por máquina.** O aviso "Sem IA" na barra e a trava de envio passam a olhar a máquina do bot (ou esta máquina, quando ele usa "qualquer uma"), não o agregado da pessoa. O status do bot no topo diz onde ele trabalha ("Trabalha no MacBook de Ana, que está desligado").
5. **Copy.** "neste computador" em vez de "neste Mac"; o nome da máquina padrão nos textos de volta ("os bots passam para o MacBook de Ana").

### Detalhes de implementação

- "Já vi Este computador" vive no arquivo local da máquina (`desktop/contas-locais.ts` no Mac; `%APPDATA%\nod-motor\conexao.json` no Windows) como `esteComputadorVistoEm`. Reinstalação limpa apaga e a tela volta, como pedido em 05/11.
- A tela B só aparece se `maquinaPadrao.online === false` ou `maquinaPadrao.id !== estaMaquina.id`; com a padrão online e igual a esta, segue direto para os bots.
- O aviso da barra consome o estado por máquina que o servidor já tem (anúncio do motor, ADR-102); muda o `web/estado/reducer.ts` e `web/telas/barra.ts`, não o banco.
- Se a pessoa escolhe "Manter", a resposta do bot a uma mensagem é a linha "Eu trabalho no MacBook de Ana, que está desligado; começo quando ele voltar, ou mude meu computador em Configurações › Computadores", em vez de `Turno interrompido`.

## No chat

| Ação (id) | O que faz | Risco | cartaoNoChat | Estado | Em que bot |
| --- | --- | --- | --- | --- | --- |
| id do seletor "Máquina padrão" (já existe; confirmar em `docs/paridade.md`) | torna esta máquina a padrão | muda | não | o que já está | todos |

**Como a pessoa pede:** "trabalha aqui neste computador a partir de agora" · "manda os bots pro meu notebook" · "qual computador está rodando a Bruna?".

Sem ação nova: a tela B reutiliza o id existente. Se o plano concluir que ele está `falta`, sobe para `vivo` no mesmo PR (conta como ação nova pela skill `acao-no-chat`).

- [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o cartão que o risco e o modo pedem.

## Critérios de aceite

1. Conta existente, Windows limpo: entrar → "Este computador" aparece com "Oi de novo" e o estado real da IA desta máquina.
2. Claude conectado aqui com a padrão (Mac) offline: a tela B aparece; "Trabalhar neste computador" torna esta a padrão e a primeira mensagem a um bot é respondida aqui.
3. "Manter": o bot responde a linha de espera, não `Turno interrompido`; nenhuma mensagem some.
4. Barra: com IA só no Mac desligado, este computador mostra "Sem IA neste computador" (por máquina), nunca "Disponível".
5. Reinstalação limpa no mesmo e-mail mostra "Este computador" de novo; a conversa com o Nod não se repete.
6. Nenhum texto "Mac" num Windows; os textos de volta nomeiam a máquina.
7. `npm run check` verde; `npm run paridade` sem piso quebrado.

## Plano de testes

| Camada | O quê | Quantos |
| --- | --- | --- |
| Unit | decisão "mostrar Este computador" por marca local × estado da IA; decisão "mostrar tela B"; aviso da barra por máquina | +6 |
| Integration | tornar padrão a partir da tela B; estado por máquina no `GET` que a barra lê | +2 |
| e2e | `e2e:fumaca`: conta existente, máquina nova, padrão offline → escolha → resposta | +1 |

## Rollback

Reverter o PR. Sem migração. A marca local da máquina é ignorada pelo código antigo.

## Esforço

Marca local + tela por máquina 1 d · tela B + ação 1 d · aviso e trava por máquina 1 d · copy 0,25 d · testes 0,75 d. ~4 dias.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `web/telas/onboarding*.ts` | "Oi de novo", tela B |
| `web/telas/barra.ts`, `web/estado/reducer.ts` | aviso por máquina |
| `web/telas/maquinas.ts:246,414,592`, `desktop/login-ia.ts:144` | copy por plataforma, nome da máquina |
| `desktop/contas-locais.ts`, `motor/conexao.ts` | `esteComputadorVistoEm` |
| `src/domain/redacao.ts` | linha de espera quando a máquina do bot está offline |

## Fora do escopo

- Pareamento do Windows pelo navegador com confirmação (hoje só o Mac): decisão aberta.
- Mover rotinas entre máquinas (hoje não mudam sozinhas, `maquinas.ts:113` do protótipo).
- Jornadas A, C e D (PRs irmãos).
