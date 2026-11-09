# ADR-102 — As contas de IA são da pessoa, em todas as máquinas

Status: aceito (decisões do Marlon no protótipo, 2026-10-13) · Data: 2026-10-13 · Emenda a
[ADR-101](adr-101-varias-contas-por-ia-um-diretorio-por-conta.md) (várias contas por IA) e a
[ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) (item 4: o login na VM) · Mantém a
[ADR-019](adr-019-a-sonda-de-disponibilidade-pergunta-ao-cli-nunca-le-a-cr.md) · Plano:
[plano-contas-mac-vm.md](../plano-contas-mac-vm.md)

## Contexto

A ADR-101 deu várias contas por IA ao app do Mac. A VM ficou com uma conta por IA, logada no terminal, sem relação com
as do Mac; a conta da VM no limite não tinha para onde ir; e a pessoa via as contas em duas telas que não se falavam. O
Marlon pediu para redesenhar a jornada e escolheu, no protótipo de 13/10 (canvas "Nod — tela do agente", páginas
"Contas e máquinas" e "Decisão 1 · Gestão"), os caminhos abaixo.

## Decisão

1. **Uma lista só de contas, da pessoa.** Claude e ChatGPT intercalados numa ordem só, que vale em todas as máquinas.
   Substitui a ordem das IAs da pessoa (`preferencias.ordem_ias` passa a ser derivada da lista) e a ordem das contas
   por IA do Mac.
2. **Ver em dois lugares, gerenciar em um** (opções 1A + 1B). Provedores de IA mostra e gerencia as contas (adicionar,
   entrar numa máquina, renomear, sair de uma máquina, remover, reordenar, o modo no limite). Máquinas mostra as contas
   de cada máquina e leva a Provedores filtrado por ela. Renomear e desconectar a máquina ficam em Máquinas.
3. **O login na VM é pela tela** (opção 2A, emenda o item 4 da ADR-090). O motor roda o login do CLI e manda o link (e,
   no Codex, o código do aparelho) pelo servidor. O código que a página da Anthropic devolve vai **cifrado no navegador**
   com a chave pública que o motor gerou para aquele login (RSA-OAEP 2048 envolvendo uma chave AES-GCM 256); o servidor
   só repassa: o código nunca fica em claro no servidor (memória longa, log, banco). A cifra não protege contra o próprio servidor comprometido, que serve o JS da tela (revisão R5). No Claude, o terminal continua como saída discreta (`nod-motor entrar claude`).
4. **A mesma conta em duas máquinas é reconhecida por uma impressão** (opção 3A). A máquina calcula
   `sha256("nod-conta-v1", pessoa, ia, e-mail, organização)` com o que o CLI informa e manda só o hash. O servidor casa
   as contas iguais sem ver o e-mail; a mesma conta em duas pessoas dá hashes diferentes.
5. **O servidor escolhe a conta do turno.** O plano leva `conta` (id + impressão); a máquina usa a pasta daquela conta
   (`CLAUDE_CONFIG_DIR`/`CODEX_HOME`). As regras da ADR-101 continuam, por provedor: "Perguntar antes" é o padrão entre
   contas do mesmo provedor; passar de um provedor para o outro continua automático; conta corporativa só entra na troca
   automática marcada. O limite é da conta (vale em todas as máquinas).
   - **Emenda NOD-308 (2026-10-20; decisão do Marlon na NOD-221 item 3, 19/10): conta corporativa segue a mesma regra da pessoal; não há mais exceção por plano.** A corporativa entra na fila e na troca como
     qualquer conta (ADR-101 §6, ADR-108 §2).
   - **Emenda NOD-268 (2026-10-15):** a conta escolhida precisa estar na máquina que roda o bot. Com alvo, a conta
     tem que estar pronta nele; sem alvo, em qualquer máquina não revogada. Sem conta na máquina, a nota das contas é
     escrita uma vez (dedup pela nota aberta) e a fala espera com `acordar_em` na volta da conta, em vez de repetir a
     nota a cada despacho. Tasks de fundo ficam como estavam.
6. **Emenda à ADR-101, item 3:** o **apelido** e o **plano** passam a morar no servidor (o apelido é um rótulo que a
   pessoa escreve; o plano decide o selo e a regra da conta corporativa). **E-mail e organização continuam só nas
   máquinas** e aparecem na tela só dentro do app do Mac que conhece a conta. A conversa cita a conta pelo apelido.
7. **Conectar a VM:** o comando de instalação leva um convite de uso único (30 min) e a máquina se apresenta sozinha; a
   tela pede só para confirmar. O Codex vem sempre (opt-out `NOD_SEM_CODEX=1`).

## Alternativas descartadas

- **Contas dentro de cada máquina (1B sozinha).** Repete a mesma conta em várias telas e põe uma ordem por máquina.
- **Login da VM só pelo terminal (2C) ou só o Codex pela tela (2B).** Mantêm os três saltos que motivaram o redesenho.
- **Listas independentes por máquina (3B)** ou **e-mail mascarado no servidor (3C).** A primeira não diz qual conta é
  qual; a segunda emenda a ADR-019 sem precisar.
- **Copiar a credencial do Mac para a VM.** Proibido pela ADR-019 e pela cláusula da Anthropic contra intermediar
  credenciais.
- **Repassar o código do Claude em claro pelo servidor.** O servidor passaria a ver uma credencial de uso único; a cifra
  ponta a ponta custa pouco (WebCrypto no navegador, `node:crypto` no motor).

## Consequências

- Uma tabela de contas por pessoa (`contas_ia`) e uma de vínculos com as máquinas (`contas_ia_maquinas`); o turno grava
  a conta usada (`turnos.conta_id`).
- O canal servidor → máquina ganha uma puxada de contas (`/api/maquina/contas`): logins pedidos, saídas, desconectar.
- O modo local (ADR-092) continua com a tela da ADR-101.
- O app do Mac precisa da versão nova para entrar na lista; o antigo mostra a tela de hoje com o aviso de atualizar.

### Limites conhecidos (revisão do PR #306, 2026-10-13; pedem decisão do Marlon)

- **A impressão é pseudônima, não anônima.** É um sha256 sem chave de entradas fáceis de adivinhar (a pessoa, a IA, o
  e-mail, a organização). Com o banco e uma lista de e-mails prováveis do tenant, cada impressão se confirma por
  dicionário. Na prática, o e-mail não fica guardado em claro, mas também não fica secreto. A coluna `contas_ia.impressao`
  deve ser tratada como dado pessoal. A saída mais forte seria um HMAC com um segredo da pessoa que o servidor não
  guarde, repassado entre as máquinas cifrado como o código do login.
- **O estado dos logins e convites fica só na memória do servidor.** Isso inclui os logins pela tela, os convites e o
  pedido de desconexão. Um reinício ou deploy perde o login em curso, e a pessoa recomeça. A segurança do "Desconectar e
  sair das contas" não depende dessa memória: a chave da máquina vence em 2 min, gravado em `maquina_tokens.expira_em`.
- **O código do Claude é entregue uma vez à máquina.** Se a resposta da puxada se perder, ou se o motor reiniciar no meio
  do login, o login fica parado até vencer (15 min), e a pessoa pede de novo.

## Gatilho de reversão

- Um fornecedor proibir explicitamente a troca entre contas próprias (vale o gatilho da ADR-101).
- O `claude auth status`/`account/read` deixar de dizer e-mail e organização: a impressão perde a base (voltar à 3B).
- Mais de 1 em cada 10 logins pela tela falhar por um código que não chega ao CLI em 14 dias: rever a cifra e o
  repasse (o terminal continua como saída).

## Emenda de 2026-10-15 — item 6 (ADR-105)

O e-mail e a organização deixam de ficar só nas máquinas: vão no anúncio e moram em `contas_ia` (0075), e a lista os
mostra em qualquer máquina. A impressão segue sendo a chave da conta (item 4). Motivo e alternativas na
[ADR-105](adr-105-email-da-conta-de-ia-no-servidor.md).

## Emenda NOD-301 (2026-10-20) — turno sem alvo e a máquina sem conta livre

Com o turno **sem alvo** (sem `maquina_desta_vez`, sem máquina do bot nem padrão da pessoa), a primeira máquina que
puxava levava o turno, mesmo sem conta livre da IA dele — e a conversa ganhava a nota de limite enquanto outra máquina
viva da pessoa tinha conta livre. Agora, **só no modo compartilhado** (no local a VM é só alvo, ADR-092 §2), a máquina
cuja IA do turno está sem conta livre nela (todas as contas da IA no limite) **deixa passar** o turno por até
`ESPERA_DECLINIO_MS` (20 s, contados de `greatest(criado_em, acordar_em)`) quando outra máquina com contato recente
(`CONTATO_RECENTE_MS`) tem a IA pronta e conta livre dela. Passado o prazo, pega como antes e mostra a nota — a outra
pode não puxar, e o turno não passa fome.

Fica de fora do declínio: a ligação (a voz não espera), o turno com alvo, a task com sessão do CLI (a sessão é da
máquina que a criou) e a IA que a pessoa toda tem no limite (`ias_no_limite`: nenhuma máquina ajudaria). No Automático
(`auto/auto`) só declina se todas as IAs que a máquina rodaria estão sem conta livre nela. O cálculo é da ponte, sobre a
leitura de contas que ela já guarda por 30 s; o filtro é um predicado a mais no `reivindicar` (SKIP LOCKED intacto).

**Gatilho de reversão:** turno sem alvo que espera os 20 s e acaba na máquina sem conta (a outra não pegou) em mais de
1 em cada 10 declínios em 14 dias — o prazo ou a leitura de "viva" está errado.

## Emenda de 2026-10-24 — passo 1 Preparar no login (NOD-8)

O login de uma conta ganha o passo 1 Preparar. Na fase `preparando`, a máquina instala ou atualiza a IA (ADR-100) e só
depois abre a página. Se esse passo falhar, o login termina com `preparo_falhou`, e o motivo vem no `preparo.atualizacao`.
Quando o servidor é antigo e recusa `preparando` com 400, o motor manda de novo como `abrindo` e segue.

## Emenda ADA-245 (2026-11-08) — remover o nod de um computador

Ação nova `maquinas.remover` (pessoa_confirma, ADR-135), com rota própria (`GET /maquinas/:id/remover/previa`,
`POST /maquinas/:id/remover`) em vez de estender o `desconectar`, e a mesma função no card do chat
(`remover_computador`, sempre com cartão). Os bots presos ao computador soltam e seguem o padrão; se ele era o padrão,
o próximo computador de trabalho vira o padrão (último uso, depois o mais novo; `src/domain/maquinas-remover.ts`), ou
ninguém, e os bots esperam um computador. A escolha não olha quem está conectado agora, para a tela e o chat
escolherem o mesmo. Sem "Continuar ligado", o computador sai da conta: na hora quando o próprio app já se limpou
(`daqui`); ligado, a puxada leva `remover` junto de `desconectar` e a chave cai quando ele confirma; desligado, revoga
na hora e a limpeza local fica com a pessoa. Com "Continuar ligado", a chave fica e a puxada só leva `remover`. O pedido
para o computador desligado vive em memória por 24 h e se perde num reinício do servidor.
Gatilho de reversão: pedido perdido em reinício virando reclamação (aí o pedido vai para o banco).
