# ADR-100 — O motor se atualiza sozinho, num momento sem turno

Status: aceito · Data: 2026-10-12 · Estende a [ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) (o motor numa
máquina Linux)

## Contexto

O servidor distribui o motor da própria versão (ADR-090). Para levar código novo a uma máquina, porém, alguém precisa
rodar `curl -fsSL <nod>/motor | sh` nela. Em 12/10, o #260 (a pílula com o motivo real) entrou na main e não valeu na
`nod-motor-teste`, que roda os bots: o motor de lá continuava velho. O Marlon pediu: "precisamos melhorar essa
experiência de ter que reinstalar o motor da VM toda vez. Ele poderia ter uma opção de atualizar sozinho".

Três fatos do código definiram o desenho:

- **A versão não diz se o motor mudou.** O motor se identifica pela versão do package.json, e em 11/10 seis merges
  saíram com a mesma `0.4.0-rc.8`.
- **Os arquivos do motor são do root, e isso é de propósito.** Eles moram em `/opt/nod-motor/app`. O motor roda como
  `nod`, com `NoNewPrivileges`, e os bots também rodam como `nod`. Se o motor pudesse trocar os próprios arquivos, um
  bot poderia reescrever o hook que vigia os comandos dele (`hook-nativas.mjs`).
- **Reiniciar o motor interrompe os turnos que rodam.** Os bots trabalham por horas (ADR-067), e um reinício no meio de
  um turno perde trabalho.

## Decisão

1. **Igual é ter o mesmo conteúdo.** `GET /api/motor/manifesto` (pública) devolve a versão e o sha256 de cada um dos
   três arquivos que o servidor serve. O motor compara com os arquivos dele a cada 5 min.
2. **O motor decide QUANDO; o root faz a troca.**
   - Diferente e sem turno rodando: o motor para de puxar trabalho novo (drena), espera 30 s pelo puxar que ainda esteja
     em voo, confere de novo e grava `~/.config/nod-motor/atualizar`.
   - Com turnos rodando: espera um momento ocioso por até 30 min. Passado esse tempo, drena: nada novo começa nesta
     máquina, o que roda termina e entrega, e aí ele pede.
   - **Nenhum turno é interrompido.**
3. **O atualizador é do root.**
   - `nod-motor-atualizar.path` (systemd) vê o pedido e roda `nod-motor-atualizar` (`/usr/local/sbin`).
   - O atualizador baixa o manifesto e os três arquivos do servidor gravado na instalação (`/etc/nod-motor/servidor`, fora
     do alcance do `nod`), confere o sha256 de cada um e instala como root.
   - Ele guarda a versão anterior em `app.anterior`, reinicia o serviço e apaga o pedido, com sucesso ou não.
   - O motor nunca indica de onde baixar nem o que instalar: ele só diz "agora".
4. **Pedido que não vira reinício em 10 min** (atualizador ausente, servidor fora, arquivo que não bate): o motor volta a
   puxar e tenta de novo em 1 h.
5. **O servidor que pede um motor mais novo (426):** antes, o motor saía com o código 2 e ficava parado até alguém
   reinstalar. Agora ele grava o pedido antes de sair, e o atualizador o traz de volta com os arquivos novos.
6. **Ligada por padrão.** A instalação cria `/etc/nod-motor/atualizar-sozinho`, e o motor só pede com essa marca.
   - Para desligar na instalação: `NOD_ATUALIZAR_SOZINHO=0`.
   - Para desligar depois: `sudo rm /etc/nod-motor/atualizar-sozinho && sudo systemctl disable --now nod-motor-atualizar.path`.
   - `nod-motor estado` diz se está ligada.

## Fora do escopo

- **Node, Claude Code, serviço e unidades do systemd** continuam com a reinstalação (`curl … | sh`). Esses mudam
  raramente e exigem apt ou npm como root. O atualizador troca só o código do motor, que roda como `nod`. Assim, um
  servidor comprometido não ganha mais do que já tem: código como `nod`.
- **O app do Mac** tem a própria atualização (as releases do Electron).
- **A tela Máquinas** ainda não mostra "atualizando". Hoje isso fica no `journalctl -u nod-motor` (`motor_atualizacao`)
  e no `journalctl -u nod-motor-atualizar`.

## Alternativas descartadas

- **Rodar o script de instalação inteiro como root, automaticamente.** Ele faria tudo (Node, CLI, serviço), mas daria
  ao servidor execução de código como root em toda máquina pareada. Hoje isso só acontece quando uma pessoa roda o
  comando.
- **Arquivos do motor graváveis pelo `nod`.** Mais simples, mas um bot poderia reescrever o hook que o vigia.
- **Atualizar na hora, interrompendo.** Os bots perdem trabalho, como nos "turno interrompido" de 11/10.
- **Comparar pela versão.** Não muda entre merges.

## A primeira vez

Uma máquina instalada antes desta ADR não tem o atualizador. Ela precisa de uma última reinstalação (`curl … | sh`), que
instala o `.path`, o atualizador e a marca. Daí em diante, cada merge na main chega sozinho, no primeiro momento sem
turno.

## Gatilho de reversão

- Uma atualização interromper um turno (um `turno interrompido` com `motor_atualizacao` `pedido` no mesmo minuto). A
  regra de drenar falhou: desligar a marca e rever.
- Uma máquina ficar drenada (sem puxar) por mais de 2 h seguidas por causa da atualização. Os 30 min de janela
  ociosa não bastam: rever a janela ou drenar só à noite.

## Emenda de 2026-10-15 — a drenagem tem teto

**O gatilho disparou.** Em 2026-10-15, a VM `nod-motor-teste` passou a drenar às 20:52 UTC. Na hora, rodava o turno de
delegação do Eng 1, ativo desde as 18:17 UTC (três issues em paralelo, horas de trabalho). A VM ficou 2h15 sem pegar
nenhum turno novo e só voltou quando o motor foi reiniciado à mão, às 23:07 UTC, o que interrompeu o turno do Eng 1.
Nesse meio-tempo, a fala do Marlon para a Ada e outros quatro turnos dela ficaram na fila. Com bots que trabalham por
horas, esperar o turno mais longo acabar trava todos os outros bots da máquina.

**O que muda no item 2.** A drenagem dura no máximo `DRENAGEM_MAXIMA_MS` (10 min). Passado esse tempo, se ainda houver
turno rodando, o motor volta a pegar trabalho (`motor_atualizacao` `drenagem_desistiu`, nível aviso) e drena de novo
depois de `ESPERA_DEPOIS_DE_DESISTIR_MS` (1 h). Se a máquina ficar sem nenhum turno antes disso, o motor pede a
atualização na hora. No pior caso, com um turno de horas na máquina, o atraso imposto pela atualização é de 10 min a
cada 70 min. A regra "nenhum turno é interrompido" continua valendo.

**Gatilho de reversão desta emenda.** O motor não se atualizar em 24 h numa máquina que nunca fica ociosa (o
`drenagem_desistiu` se repetindo o dia todo). Nesse caso, a saída é deixar a fala da pessoa passar durante a drenagem,
ou drenar só à noite.

## Emenda de 2026-10-22 — a VM do Mac atualiza com o app (NOD-93)

O runtime (Lima) e o disco da VM do computador no Mac (ADR-123) saem no mesmo release do app, com o sha256 fixo no app.
Atualizar o app troca o disco base e mantém o disco de dados. O motor não atualiza nada disso.

## Emenda de 2026-10-23 — a IA do Mac também (NOD-9)

A regra da brecha desta ADR vale para o CLI de IA no Mac: atualiza sem turno e sem ligação; sem brecha, espera, avisa
em 23 h e segura os pedidos novos em 24 h (teto de 10 min segurando). Uma tentativa automática por alvo por dia.
A VM do motor ganha o mesmo no PR 4 da NOD-9 (`nod-motor atualizar-ia`).

PR 4 (2026-10-23): na VM a IA é reinstalada por cima em `~/.local` com o npm do motor (`npm_local`, sem sudo, uma
trava de arquivo para o serviço e o terminal nunca rodarem juntos). As duas atualizações não se cruzam: com o motor
drenando ou com o pedido ao root gravado, a IA não começa; com a IA atualizando, o motor conta um turno rodando e não
reinicia.

## Emenda de 2026-10-24 — o login na VM prepara a IA (NOD-8)

O login na VM instala a IA que falta ou está abaixo do piso, pelo mesmo `npm_local`. Ele confere antes se há 2 GB livres
em `~/.local` e, se não houver, para com `sem_espaco`.

## Emenda de 2026-10-27 — o motor se atualiza com frentes rodando (ADR-131)

O gatilho de reversão da emenda de 2026-10-15 disparou: a VM dos bots ficou dias sem se atualizar, drenando 10 a 15 min a
cada 70 min, porque sempre havia de 1 a 5 frentes rodando. Pela [ADR-131](adr-131-o-motor-se-atualiza-com-frentes-rodando.md),
o item 2 muda: drenando, o motor espera só os turnos da pessoa (`daPessoa` no plano) e pede o reinício por cima do fundo;
o reinício é queda (`reinicio_do_motor`) e o servidor retoma o fundo na hora, sem gastar o teto de quedas. A regra
"nenhum turno é interrompido" passa a ser "nenhum turno da pessoa é interrompido".
