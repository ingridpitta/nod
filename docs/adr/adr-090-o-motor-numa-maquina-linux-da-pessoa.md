# ADR-090 — O motor numa máquina Linux da pessoa: "traga sua VM"

> Emendada pela [ADR-147](adr-147-motor-no-windows-nativo.md): "uma máquina Linux" vira "uma máquina Linux ou Windows".

**Status** aceito · decidido e implementado em 2026-10-09 (decisões do Marlon na conversa de estudo; aula em
https://claude.ai/artifact/9s7Evq2HLyixCeMncVSnaV) · plano em [docs/plano-motor-na-vm.md](../plano-motor-na-vm.md)

Estende a ADR-021 (ponte), ADR-022 (localidade) e ADR-069 (pareamento). Emenda a ADR-020 (o app do Mac deixa de ser
obrigatório quando há outro motor) e a ADR-045 (a queda é da máquina, não só do Mac). Confirma a ADR-028 e a pré-ADR-030.

## Contexto

O Mac de quem usa o nod é o motor de todo turno: o laço do executor, o `claude -p`/`codex`, o proxy MCP, o hook das
nativas e o `gh` rodam dentro do app Electron (`desktop/main.ts`). Medido no diário (ADR-085): p50 de 3 turnos ao mesmo
tempo, p90 de 7, máximo de 23; ~300 MB por `claude -p`; em 06/10 a carga chegou a 22 por núcleo, puxada pelos comandos
que os bots disparam. E o Mac dorme: 43 retomadas em 7 dias de rotinas cortadas de madrugada (ADR-045).

Quem tem uma máquina sempre ligada quer que os bots trabalhem nela, sem ocupar o Mac. O desenho já permite: o servidor
nunca disca para a máquina (ADR-021), então uma VM só precisa de saída HTTPS; e duas máquinas da mesma pessoa já são
previstas (`reivindicar` com `SKIP LOCKED`, `machine_id` em `turnos`). Falta o motor rodar sem Electron, a VM se
parear sem navegador, uma regra de qual máquina pega cada turno e os textos que hoje dizem "Mac" em todo lugar.

## Decisão

1. **Uma máquina Linux da pessoa é uma máquina como o Mac.** O motor que roda nela é o mesmo código
   (`src/adapters/executor/*`, `src/adapters/mcp-proxy/*`, `src/adapters/conectores-locais/*`), com um ponto de entrada
   Node sem Electron. Mesma ponte (`/api/maquina/*`), mesma chave escopada (ADR-031), mesma versão mínima (ADR-020).
   Uma chave por máquina: o id da chave continua sendo a identidade da máquina.
2. **Híbrido.** O Mac (ou qualquer navegador) é a janela; a máquina escolhida é o motor. O app do Mac continua sendo o
   jeito padrão de usar o nod, mas, com outro motor conectado, a web sozinha funciona (emenda a ADR-020: "sem ele não
   há executor" passa a valer só quando nenhuma outra máquina está conectada).
3. **Pareamento por código, sem navegador na máquina** (estende a ADR-069). A máquina pede um código curto ao
   servidor e mostra no terminal; a pessoa digita o código na web (com sessão) e confirma "Conectar <nome>?"; a
   máquina, que pergunta em intervalos, recebe a chave nascida em `emitirChaveMaquina` no escopo de quem confirmou. É o
   fluxo de dispositivo da RFC 8628. Pedido em memória, uso único, prazo curto, limite de tentativas, como o da ADR-069.
4. **A credencial do CLI é logada pela pessoa, na máquina dela.** O nod mostra o comando (`claude` / `codex login`
   / `gh auth login`) e a vigia das IAs percebe quando ficou pronto, perguntando ao CLI (ADR-019). O nod nunca lê,
   recebe, guarda ou repassa o login. O Marlon conferiu os termos de uso em 2026-10-09: com o login feito pela própria
   pessoa na máquina dela, o uso está coberto.
5. **Cada bot tem onde trabalha** (estende a ADR-022). "Qualquer máquina" (o comportamento de hoje) ou uma máquina
   escolhida, com um padrão por pessoa. A regra é declarativa e decidida no `reivindicar`; o agente não escolhe e não
   tem ferramenta para trocar.
   - **Emenda NOD-268 (2026-10-15): a troca de IA no limite só vai para a IA que a máquina do bot tem.** Com o bot
     preso a uma máquina (ou ao padrão da pessoa), o reenvio depois do limite só troca para uma IA pronta *nela*, e o
     turno novo sai com o harness fixo (não `auto`), para não ser escolhido de novo noutra volta. Se a outra IA só está
     pronta noutra máquina, o turno não migra: a fala espera a hora do limite (`acordar_em`) e a conversa ganha UMA
     linha ("O Codex está pronto noutra máquina, mas este bot roda em <máquina>…"). "A máquina do bot" segue a ordem de
     `alvoDoTurno` sem o "desta vez" (`alvoDoBot`: a do bot, senão a padrão, só com a chave viva), porque é para ela que a
     fala refeita vai.
   - **Emenda NOD-293 (2026-10-20): a frente roda na máquina da sessão do trabalho dela.** No `alvoDoTurno`, o turno
     com `trabalho_id` ganha um nível entre o "desta vez" e a máquina do bot: `trabalhos.sessao_maquina_id` (0079), se a
     chave ainda vale. Sessão numa chave revogada ou vencida, ou trabalho sem sessão, cai na regra de antes. "Rodar em
     <outra máquina> desta vez" na conversa muda só a fala da conversa (`trabalho_id is null`): levar a frente para outra
     máquina a rodava numa pasta vazia, sem a sessão. No turno de um trabalho, o "desta vez" só vem do ato da pessoa
     sobre a própria task ou o próprio turno (emenda NOD-314 abaixo) e vence a sessão: é o jeito de tirar a frente do Mac
     sem contato onde a sessão dela está (QA do NOD-293, 2026-10-22, ao juntar com a NOD-314).
6. **Máquina escolhida fora do ar.**
   - **Conversa, task ou pedido de colega que ainda não começou:** espera na fila. A tela diz "esperando <máquina>
     (sem contato desde HH:MM)" e oferece "Rodar em <outra máquina> desta vez", que é ato da pessoa e vale só para
     aquele turno.
   - **Rotina:** não muda de máquina. Fora do ar na janela, a execução fica `interrompida` com o aviso único da
     ADR-045, generalizado de "seu Mac" para "<máquina>".
   - **Turno que já tinha começado:** como hoje (ADR-045). Não migra: turno não é idempotente e a credencial mudaria
     no meio.
   - **Emenda NOD-268 (2026-10-15): todas as IAs da máquina no limite.** O despacho no Automático não entrega a
     fala a uma IA que ele sabe estar no limite: a fala fica com `acordar_em` na renovação mais próxima (sem horário do
     fornecedor, 1 h) e a conversa ganha uma linha. Uma fala nova da pessoa absorve a adiada; Parar a cancela. A fala
     que já esperou uma vez segue o caminho de sempre (não espera de novo).
   - **Emenda NOD-92 (2026-10-22, ADR-121): a máquina gerenciada dormindo acorda e espera.** Com
     `NOD_MAQUINA_NUVEM=gcp`, a VM do Google que o nod liga e desliga não está "fora do ar" quando dorme. Conversa,
     task, pedido de colega e rotina com alvo nela a acordam e esperam na fila. A rotina não vira `interrompida` nem
     `nao_rodou`, e o prazo de 24 h sem contato não corre enquanto ela dorme ou acorda. Só com `falhou_ao_acordar`
     volta a regra de cima, contada a partir da falha.
7. **Os arquivos ficam onde o bot trabalha.** A pasta do bot é `~/nod/<bot>` na máquina que roda o turno (como já é,
   `claude-cli.ts`). Não há sincronização com o Mac. Anexos já chegam por `/api/interno/anexos/:id` e funcionam em
   qualquer máquina; o arquivo do Mac para um app (ADR-068) já não vale no modo compartilhado e continua assim.
8. **A máquina diz o que é.** O anúncio (`AnuncioMaquina`) ganha `plataforma` (`darwin` | `linux`). O prompt de
   sistema, "Sua vez", os avisos e as telas usam o nome e o tipo da máquina do turno, e deixam de afirmar "Mac" quando
   não é. O bot numa VM não ouve que tem Finder nem as credenciais do Mac da pessoa.
9. **O uso da máquina vale fora do macOS** (estende a ADR-085). O amostrador lê memória e processador também no Linux,
   para "segurar trabalho novo em segundo plano" valer na VM. Em 2026-10-09 a tela passou a falar por máquina
   (emenda da ADR-085): o trabalho da VM diz "esperando <VM> aliviar", e não "o Mac".
10. **O computador da pessoa roda no motor** (emenda de 2026-10-22, [ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md)).
    Com `NOD_COMPUTADORES=motor`, um computador por pessoa numa máquina Linux dela, com uma tela por bot. Antes
    ficava fora: o computador por bot (ADR-037) não estava em uso.

## Por que não fere a ADR-028 nem a pré-ADR-030

A ADR-028 proíbe o turno de executar fora da máquina onde roda o proxy MCP, porque Sua vez, aprovação tipada e
`pedir_a_pessoa` param de valer em silêncio. Aqui o proxy, o CLI, o hook e o login vão juntos para a VM: o turno nunca
sai da máquina do proxy. O caminho de volta é o de sempre, pelo servidor: `pedir_a_pessoa` e `pedir_aprovacao` chegam à
pessoa e voltam ao turno. O critério mecânico da pré-ADR-030 continua valendo e vira teste de aceite (ver o plano).

O que a ADR-028 temia, "uma segunda cópia da credencial fora do servidor", não acontece: a VM é da pessoa, e a
credencial é logada por ela, como no Mac. A VM não é o "computador do bot" (ADR-037), que é de outra natureza.

## Alternativas rejeitadas

- **App inteiro na VM por área de trabalho remota.** Tela atrasada, microfone ruim e joga fora a web, que já existe.
- **O servidor do nod alcançar a VM (SSH, túnel, porta aberta).** Contraria a ADR-021 sem ganho: a VM puxa como o Mac.
- **Pareamento colando a chave de "Chaves" num arquivo.** Funciona hoje e fica como saída manual, mas é o passo que a
  ADR-069 tirou do Mac por pedir que a pessoa entenda o modelo.
- **Passar o turno para outra máquina sozinho quando a escolhida cai.** Proibido pela ADR-022.
- **Sincronizar a pasta do bot entre VM e Mac.** Decidido em 2026-10-09: os arquivos ficam onde o bot trabalha.
- **O nod hospedar as máquinas (caminho C).** Fora: isolamento entre pessoas por microVM, operação 24 h e a credencial
  da pessoa na infraestrutura do nod. O caminho B (o nod cria a VM na conta da pessoa) vem depois, sobre o mesmo motor.
  **Emenda NOD-92 (2026-10-22):** o caminho B deixou de ser "depois". Ele é a [ADR-121](adr-121-caminho-b-a-vm-na-conta-de-nuvem-da-pessoa.md):
  o nod liga e desliga a VM do Google da pessoa (PR 1) e, no PR 2, a cria.

## Gatilho de reversão

- **Login.** Se, em 14 dias com pelo menos uma VM conectada, ela passar mais de 10% do tempo conectada sem nenhuma IA
  pronta no anúncio (`harnesses` sem `pronto`: login expirado ou ausente), o login feito pela pessoa no terminal não é
  viável como fluxo: reabrir o item 4 (login guiado pela tela, sempre sem o nod tocar a credencial).
- **Regra de onde trabalha.** Se mais de 1 em cada 5 turnos de conversa de bots presos a uma máquina esperar mais de
  10 min por ela fora do ar, a espera é pior que a migração: reabrir o item 6 só para turno que não começou.
- **Promessa de aliviar o Mac.** Se, com todos os bots presos à VM, o diário ainda registrar `fundo_segurado` no Mac em
  mais de 5% dos dias, o peso não era o motor: medir o que sobrou antes de seguir para o caminho B.

## Implementação (2026-10-09)

- **Motor sem janela:** `motor/main.ts` (comandos `parear`, `entrar`, `estado`, `rodar`) e `motor/conexao.ts` (chave em
  arquivo 0600). Reusa o laço, os drivers, a vigia das IAs e o proxy do app do Mac. `scripts/motor/build.mjs` empacota
  em `dist/motor`, que vai na imagem do servidor.
- **Instalação:** `curl -fsSL https://<nod>/motor | sh` (`/motor` redireciona para `/api/motor/instalar`;
  `src/adapters/http/motor-instalacao.ts`). Node fixo, usuário `nod`, Claude Code (Codex com `NOD_COM_CODEX=1`), gh,
  serviço `nod-motor` no systemd e o pareamento no fim. Rodar de novo atualiza.
- **Pareamento por código:** `src/services/pareamento-dispositivo.ts` e as rotas `pareamento/dispositivo[/trocar]` e
  `maquinas/dispositivos/:codigo[/aprovar]`.
- **Onde o bot trabalha:** migração 0066 (`agentes.maquina_id`, `preferencias.maquina_padrao_id`,
  `turnos.maquina_desta_vez`), filtro no `reivindicar` e as rotas `maquinas`, `maquinas/padrao`, `maquinas/:id/bots`,
  `agentes/:id/maquina` e `conversas/:id/rodar-desta-vez`.
- **Prompt:** `plataforma` no anúncio e `maquina` no plano; `terminalNaMaquinaLinux` em `prompt-sistema.ts`.
- **Uso da máquina:** o amostrador lê `/proc/meminfo` e a carga no Linux, só no motor (`lerNoLinux`).
- **Web:** Seu espaço › Máquinas (`web/telas/maquinas.ts`), o "Conectar uma máquina" em 5 passos, o link
  `?parear-maquina=<código>` e a fila da conversa com a máquina fora do ar (protótipo 4c).

Ainda não implementado: juntar "Este Mac" em "Máquinas", o timer de atualização do motor, a rotina com a máquina fora
do ar ganhar o aviso único (hoje ela espera e vence pela regra de sempre), o caminho B e os computadores dos bots.

## Emenda (2026-10-20, NOD-314): o turno preso a uma máquina sem contato

- **"Desta vez" também na task e no turno preso.** A task na fila de uma máquina sem contato ganha "Rodar em <outra>
  desta vez" no topo (`POST trabalhos/:id/rodar-desta-vez`): grava `maquina_desta_vez` só nos turnos pendentes dela,
  uma vez; `agentes.maquina_id` não muda. A outra máquina precisa ser da pessoa e ter contato recente (409 senão).
- **O pendente preso 24 h sai da fila.** O varredor de órfãos (NOD-219) encerra o pendente cujo alvo (desta vez → bot →
  padrão) é uma chave viva sem contato há 24 h, contadas do mais recente entre a entrada do turno, a volta marcada e o
  último contato da chave (`turnos.encerrarPresoSemContato`, UPDATE condicional: o Mac que volta e reivindica ganha). O
  turno fica `interrompido` com `maquina_sem_contato` e `despachado_em` nulo — o que o separa da queda de um turno que
  rodou, e por isso não conta como queda nem é retomado pelo pedido parado. A ligação fica de fora.
- **Uma linha só, por origem.** Conversa: "Tirei este pedido da fila: <máquina> ficou sem contato por mais de 24 h",
  com o atalho "Rodar em <outra> desta vez" (refaz o turno uma vez). Rotina: execução `nao_rodou` com
  `maquina_sem_contato`, sem linha no chat (resolve o "aviso único" que estava pendente acima). Pedido de colega: quem
  pediu recebe um aviso de falha.

## Emenda 11 (2026-10-22, NOD-94): a máquina "só computador", instalada por SSH

Cita a [ADR-102](adr-102-contas-da-pessoa-em-todas-as-maquinas.md) (a cifra do navegador para a máquina) e a
[ADR-021](adr-021-a-ponte-de-execucao-o-app-local-puxa-o-servidor-nunca-di.md) (o servidor nunca disca).

- **Máquina "só computador".** Uma máquina Linux da pessoa pode ser pareada com papel `computador`
  (`maquina_tokens.papel`, migração 0105). Ela não pega turno e só hospeda o computador do bot da pessoa (o roteamento
  do computador para ela é a Fase B, depois da NOD-96). Atualiza sozinha pela ADR-100. No máximo uma viva por pessoa
  (`maquina_tokens_um_computador`); "Substituir" revoga a anterior.
- **Quem decide o papel é o servidor.** O convite criado pelo pedido de instalação leva `papel: "computador"` e é
  aprovado automaticamente (o envio do formulário já é o consentimento); o pareamento grava o papel na chave. O
  `papel` que a máquina anuncia é só conferido.
- **Instalação por SSH, uma vez, a partir de outra máquina da pessoa** (o motor de uma VM ou o app do Mac). A
  credencial (chave, senha ou frase-senha) é cifrada no navegador com a cifra da ADR-102, repassada pelo servidor em
  memória, entregue uma única vez à instaladora e nunca guardada. O servidor guarda só host, porta, usuário e a
  impressão da host key (`maquinas_ssh`), para travar a reinstalação com `StrictHostKeyChecking=yes`.
- **O servidor continua sem discar** para máquina nenhuma (ADR-021). Por isso a alternativa rejeitada "servidor alcançar
  a VM por SSH" continua rejeitada: quem abre o SSH é a instaladora, e depois disso a outra máquina disca para o nod como
  qualquer motor.
- **Gatilho de reversão:** se a maioria das instalações cair na saída manual (o `curl … | sh` com o convite), ou se
  surgir hospedagem gerenciada, a instalação por SSH sai e fica só o comando.

### Adendo à emenda 11 (2026-10-28, NOD-344): o endereço do script e a chave antiga

- **O endereço que o script da outra máquina usa nunca vem do pedido HTTP.** É o `NOD_URL_PUBLICA`; sem ele, o pedido vai
  com `servidor: null` e a instaladora usa a origem com que ela mesma está pareada. Um `Host`/`X-Forwarded-Host` forjado
  não desvia o pareamento. A instaladora anuncia que sabe fazer isso (`servidorProprio`); a de antes da NOD-344 recebe
  409 `instaladora_antiga` na hora, e a lista de instaladoras (a primeira é a pré-selecionada na tela) põe antes as que dão conta. Origem em loopback com
  destino fora dele falha antes do SSH com `sem_saida_para_o_nod` ("configure NOD_URL_PUBLICA").
- **A reinstalação aposenta a chave antiga.** O motor que pareia de novo com convite chama `POST /api/maquina/aposentar`
  com a chave anterior (o próprio Bearer: só revoga a si mesma) e o servidor a revoga por `removerMaquina`, que também
  fecha os avisos "sem contato". A VM ligada à nuvem não perde a chave por aqui (409 `maquina_na_nuvem`, ADR-121). O
  "Substituir" do computador também passa por `removerMaquina`.
- **Desligar a instaladora espera a limpeza** (ssh-agent morto, mestre encerrada; teto de 10 s) e avisa o fim
  (`instalacao_falhou`, uma tentativa) do que estava no meio, para a tela não ficar em "instalando".
- **Limite aceito:** quem tem root na máquina reinstalada lê a chave antiga de qualquer jeito; por isso aposentar uma chave
  de outra pessoa que estava no mesmo `conexao.json` é o comportamento certo (fica órfã ao ser sobrescrita), e o log
  `maquina_aposentada` traz pessoa e tenant. Instalar por SSH na própria máquina da instaladora-motor (destino em
  loopback) pareia no mesmo `conexao.json` e aposenta a chave do próprio motor: os turnos dele caem como
  `maquina_removida`. Caso raro, aceito.

## Emenda de 2026-10-22 — o computador da pessoa entra (ADR-122, NOD-96)

O item 10 deixa de ser "fora": com `NOD_COMPUTADORES=motor`, o computador é um por pessoa e roda numa máquina Linux
dela pelo motor ([ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md)). A máquina é `computadores.maquina_id`
(chave da pessoa, como na escolha de onde o bot trabalha; nula = onde o nod roda); o motor anuncia
`computador: pronto | faltam_pacotes | sem_suporte` no anúncio da máquina, e o Mac anuncia `sem_suporte`. Alvo:
Debian 12, sem Docker; isolamento por uids, systemd, bwrap e comandos assinados.
