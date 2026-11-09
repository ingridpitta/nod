# Onboarding, jornada D: remover o nod deste computador

Spec escrita com `/spec` em 2026-11-06. Independente das outras jornadas (pode ir primeiro). Rascunho.

Protótipos neste PR: `prototypes/onboarding-2026-11/jornadas.html#d` e `prototypes/onboarding-2026-11/prancha-d.html` (3 telas). Fontes editáveis: protótipo https://claude.ai/artifact/512SXTVrFLRSs3uwqXY8jt · prancha https://claude.ai/artifact/WqK7sEopZc4dwURXKkTQis.

## Contexto

Em 05/11 o Marlon tentou uma reinstalação limpa no Windows: não havia "Nod" em Aplicativos, `desinstalar-nod.exe` não existia, o motor continuou rodando como tarefa agendada e `%LOCALAPPDATA%\nod` ficou. A conexão e as contas sobrevivem de propósito (o desinstalador guarda), mas ninguém diz isso. Remover precisa ser uma ação do app, com o que acontece escrito antes, e o resultado conferível depois.

## Estado atual (verificado em 2026-11-06)

| Peça | Onde | Hoje | Lacuna |
| --- | --- | --- | --- |
| Tela | `web/telas/maquinas.ts` (ADR-090; h2 "Máquinas", grupo "Máquina padrão", "Suas máquinas", menu "…") | "Desconectar máquina" revoga a chave e "os bots dela voltam para a padrão" (`:147`); "Revogar chave" (`:148`) | Não remove nada da máquina; jargão: máquina, chave, motor |
| Windows | motor instalado por script em `%LOCALAPPDATA%\nod`, conexão em `%APPDATA%\nod-motor\conexao.json`, dados em `%LOCALAPPDATA%\nod-motor`, Claude via npm em `%APPDATA%\npm`, tarefa agendada `nod-motor-S-1-5-21…` | Sem desinstalador quando instalado pelo app | O motor continua rodando depois de "desinstalar" |
| Mac | `desktop/instalar-ia.ts` (IAs em `<userData>/ferramentas/<ia>/v-…`), `desktop/contas-no-servidor.ts` (sair da conta) | O app sai pela lixeira | As IAs e as contas instaladas pelo nod ficam |
| Padrão | `maquinas.ts:40` "a dele, senão o padrão da pessoa" | Remover a padrão: ninguém assume | Texto "voltam para a padrão" fica errado |

## Mudança proposta

1. **Configurações › Computadores** (D1): o mesmo `maquinas.ts`, com "Computadores" no título, "Computador padrão", "Seus computadores", "Conectar outro computador"; sem "Ver a chave" no menu (fica em Detalhes). Linhas: nome, plataforma, bots aqui, IA conectada e e-mail, status (Conectado / Offline desde …).
2. **Menu "…" › Remover o nod deste computador** (D2): diálogo com o título "Remover o nod deste computador?", o texto conta os bots de verdade e nomeia quem assume ("Os 2 bots daqui passam para o MacBook de Ana; se ele estiver desligado, esperam até um computador com IA conectar"), duas opções: "Tirar também o Claude e o ChatGPT instalados pelo nod" (ligada; "seus logins neles são seus e ficam") e "Continuar ligado à minha conta" (desligada; "para instalar de novo sem entrar outra vez; sem isso, este computador sai da conta"). Botão vermelho "Remover".
3. **Fim** (D3): lista do que aconteceu (parou de rodar e foi removido; IAs instaladas pelo nod removidas; saiu da conta ou continua ligado) e um botão "Fechar". Sem fechar sozinho.
4. **Remover de verdade.** Windows: parar e apagar a tarefa agendada, apagar `%LOCALAPPDATA%\nod` e `%LOCALAPPDATA%\nod-motor`, remover o Claude de `%APPDATA%\npm` só se o nod o instalou (marca no `instalador.log`), apagar `conexao.json` e `contas-locais.json` a não ser que "Continuar ligado" esteja marcado. Mac: revogar a chave no servidor, apagar `ferramentas/<ia>` do app quando a opção está ligada, sair das contas (`contas-no-servidor.ts`), manter o `.app`.
5. **Servidor:** a ação de remover é a de desconectar máquina que já existe (revoga a chave; ADR-031), mais a volta dos bots para a padrão com o nome dela na resposta. Remover a padrão: a próxima máquina de trabalho conectada vira padrão e o diálogo diz qual; sem outra, os bots ficam "esperando um computador".

### Detalhes de implementação

- Um desinstalador de verdade no Windows: `nod-motor desinstalar [--manter-conexao] [--manter-ias]` no `motor/main.ts`, chamado pelo app pela ponte, e registrado em "Aplicativos" (chave `Uninstall` do registro) pelo instalador, para a reinstalação limpa existir fora do app.
- O texto do diálogo é função pura do estado (`bots aqui`, `máquina padrão`, `online`), em `web/telas/maquinas.ts`, testável como as outras.
- `aria-modal`, foco no título ao abrir, Esc fecha, foco volta ao "…" (o protótipo mostra).

## No chat

| Ação (id) | O que faz | Risco | cartaoNoChat | Estado | Em que bot |
| --- | --- | --- | --- | --- | --- |
| id de "Desconectar máquina" (existe; confirmar em `docs/paridade.md`) | remove o nod deste computador, revoga a chave, bots passam para a padrão | pessoa_confirma | sim | o que já está | todos |

**Como a pessoa pede:** "tira o nod deste computador" · "quero desinstalar aqui e manter no Mac" · "remove este notebook da minha conta".

**Risco:** `pessoa_confirma` porque apaga programas e tira a máquina da conta; o cartão é sempre da pessoa, também em "Ignorar todas as aprovações". Apagar arquivos locais é ponte do app, não ação de servidor.

- [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o cartão que o risco e o modo pedem.

## Critérios de aceite

1. Windows: Configurações › Computadores › … › Remover → Fim. Depois: tarefa agendada inexistente, `%LOCALAPPDATA%\nod` e `nod-motor` inexistentes, `claude.cmd` ausente quando a opção estava ligada, presente quando estava desligada.
2. "Continuar ligado" marcado: `conexao.json` fica; reinstalar entra sem login. Desmarcado: a máquina some de "Seus computadores" e reinstalar pede login.
3. Mac: a chave é revogada, `ferramentas/<ia>` sai quando a opção está ligada, o `.app` fica.
4. O diálogo mostra o número real de bots e o nome real da máquina que assume; remover a padrão nomeia a próxima ou diz "esperando um computador".
5. Fim não fecha sozinho; "Fechar" encerra o app no Windows e volta a Computadores no Mac.
6. A mesma ação pelo chat chega ao mesmo estado com cartão.
7. Nenhum texto com "motor", "máquina", "chave" ou "parear" nas três telas; `npm run check` verde; paridade sem piso quebrado.

## Plano de testes

| Camada | O quê | Quantos |
| --- | --- | --- |
| Unit | texto do diálogo por estado; renomeações; desinstalador do motor com `--manter-*` (fs falso) | +6 |
| Integration | desconectar máquina padrão → próxima vira padrão; bots sem máquina esperam | +3 |
| Aceite | `docs/aceite-desktop.md`: roteiro de remover no Windows e no Mac, com os `Test-Path` do teste de 05/11 | roteiro |

## Rollback

Reverter o PR. Sem migração. O desinstalador só roda a pedido.

## Esforço

Tela e copy 0,5 d · diálogo e texto por estado 0,5 d · desinstalador Windows + registro 1,5 d · Mac (IAs e contas) 0,5 d · servidor (padrão assume) 0,5 d · testes e aceite 0,75 d. ~4 dias.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `web/telas/maquinas.ts` | Computadores, menu, diálogo, Fim |
| `motor/main.ts`, instalador do Windows | `desinstalar`, registro em Aplicativos |
| `desktop/main.ts`, `desktop/instalar-ia.ts`, `desktop/contas-no-servidor.ts` | remover IAs e sair das contas pela ponte |
| `src/use-cases/` desconectar máquina | a padrão passa para a próxima; nome na resposta |
| `docs/aceite-desktop.md` | roteiro |

## Fora do escopo

- Excluir a conta da pessoa (outro fluxo, ADR-124).
- VMs criadas pelo nod ("Excluir máquina", `maquinas.ts:146`): já existe e não muda.
- Jornadas A, B e C.
