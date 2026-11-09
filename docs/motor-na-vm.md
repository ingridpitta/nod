# Motor na VM: como conectar e testar

Guia do teste real da [ADR-090](adr/adr-090-o-motor-numa-maquina-linux-da-pessoa.md). O servidor precisa estar com a
versão que tem o motor (o deploy do `main` depois do merge desta feature).

## 1. A VM

Qualquer provedor. Debian 12 ou Ubuntu 22.04/24.04, x64 ou arm64. Para começar, 2 vCPU e 4 GB; com vários bots
rodando testes e builds, 4 vCPU e 8 GB. Nenhuma porta precisa ficar aberta além do SSH que você usa para entrar. Use a
VM só para o Nod: ela vai guardar o login das suas IAs.

## 2. Instalar

No terminal da VM, como root ou com sudo:

```bash
curl -fsSL https://<seu-nod>/motor | sh
# com o Codex também:
curl -fsSL https://<seu-nod>/motor | NOD_COM_CODEX=1 sh
```

Sem nenhum swap na máquina, o instalador liga um swap comprimido em memória (zram: metade da memória, até 8 GB). Se o
kernel não tiver zram, ele usa um arquivo de swap de 4 GB no disco. O serviço vem com `OOMPolicy=continue`: quando a
memória acaba, cai só o processo que o Linux escolher, não o motor inteiro (ADR-097, fase 0b). Para atualizar uma VM
que já tem o motor, rode o mesmo `curl`.

Com `Delegate=yes` na unidade (ADR-097, fase 2), cada turno roda no seu grupo de controle (cgroup v2), em
`/sys/fs/cgroup/system.slice/nod-motor.service/turno-<id>`. O teto de memória de cada task é a máquina menos 1,5 GB, com
até 2 GB de swap, e o peso de processador é o mesmo para todas. Uma task que passa disso perde um processo dela, não os
das outras. O motor fica em `…/motor`, com peso maior, para seguir respondendo. O log `grupos_da_maquina_ligados` diz
que a repartição ligou; `grupos_da_maquina_desligados` diz por que não (sem cgroup v2 ou sem a delegação, por exemplo
num motor instalado antes da fase 2). Desligada, tudo roda como antes.

Os comandos pesados dos bots (testes, `tsc`, builds) fazem fila pela memória da máquina (ADR-097, fase 1b): quando não
cabe, o comando espera a vez dentro do terminal do bot, e os outros bots seguem. O estado fica em
`~/.local/share/nod-motor/executor/vaga` do usuário `nod`: quem tem a vez (`com-a-vez/`), quem espera (`espera/`) e o
pico de memória de cada comando por repositório (`historico.json`). Para desligar a fila, ponha
`Environment=NOD_FILA_DO_FORNO=0` na unidade `nod-motor` e reinicie o serviço.

No fim ele mostra um código (ex.: `K7QM-4F2X`) e um link. Abra o Nod (no Mac ou no navegador) em **Seu espaço ›
Máquinas › Conectar uma máquina**, digite o código e confirme. O terminal diz "Conectada como <nome>".

## 3. Entrar nas IAs (na VM)

```bash
nod-motor entrar claude    # o Claude Code mostra um link: abra em outro aparelho e cole o código de volta
nod-motor entrar codex     # opcional
nod-motor entrar github    # opcional (para o bot usar gh)
nod-motor estado           # o servidor conectado e o estado de cada IA
```

O login é seu, direto com o fornecedor. O Nod não vê a senha nem a chave. Com o serviço ainda sem IA pronta, ele percebe
o login sozinho em segundos e a tela do Nod marca a IA como pronta. Se você entrar numa segunda IA com o motor já
trabalhando, ela passa a valer no próximo `sudo systemctl restart nod-motor` (que interrompe o que estiver rodando).

## 4. Escolher onde cada bot trabalha

Em **Máquinas**: marque os bots que vão para a VM no último passo do "Conectar", ou depois em "Onde cada bot trabalha".
"Bot sem escolha" define onde trabalha bot novo.

## 5. O que conferir

- Mande uma mensagem a um bot preso à VM: com o modo dev ligado (⌘⇧D), a faixa embaixo da resposta e o Raio-X mostram
  "rodou em" a VM (desde 2026-10-18 a etiqueta não fica mais no balão, ADR-114, emenda do PR 6), e o bot diz que está na
  máquina Linux.
- Feche o app do Mac: o bot da VM continua respondendo pelo navegador.
- Pare o serviço na VM (`sudo systemctl stop nod-motor`) e mande uma mensagem: a linha da fila diz "<vm> não responde
  desde HH:MM" e oferece "Rodar em <Mac> desta vez".
- `journalctl -u nod-motor -f` mostra o log do motor.

## Com o Nod no seu Mac (modo local, o diário)

[ADR-092](adr/adr-092-motor-remoto-com-o-servidor-no-mac.md). O servidor escuta só em 127.0.0.1, então a VM chega até
ele por um túnel SSH aberto no Mac. Nada fica exposto na internet.

1. No Mac, abra o túnel e deixe-o aberto. A VM passa a ver a API do Nod em `http://127.0.0.1:8888`:
   ```bash
   ssh -N -o ServerAliveInterval=15 -R 127.0.0.1:8888:127.0.0.1:8888 voce@sua-vm
   # numa VM do GCP: gcloud compute ssh <vm> --zone <zona> --tunnel-through-iap -- -N -R 127.0.0.1:8888:127.0.0.1:8888
   ```
2. Na VM: `curl -fsSL http://127.0.0.1:8888/api/motor/instalar | sh`. Use a porta da API (8888), não a da página
   (5274): o motor guarda o endereço da API.
3. Aprove o código em **Máquinas**, como no passo 2 acima. Uma VM já pareada com outro Nod troca de servidor com
   `sudo nod-motor parear http://127.0.0.1:8888`.

O que muda em relação ao compartilhado:

- **Bot sem escolha roda neste Mac** ("Este Mac" em Máquinas). A VM só pega os bots escolhidos para ela, porque os
  arquivos dos outros estão no Mac.
- **O turno da VM não retoma sessão.** Ele recebe o histórico recente, e a sessão da conversa continua a do Mac.
- **Se o túnel cair, a VM fica "sem contato".** Os bots dela esperam o túnel voltar, ou você os põe em "Este Mac".

## Atualizar e desligar

- Atualizar: rode o mesmo `curl … | sh`. Ele troca os arquivos e mantém a conexão e os logins. Com o motor já rodando,
  a versão nova só vale depois de `sudo systemctl restart nod-motor`. Desde a ADR-131 o reinício não derruba as tasks:
  elas voltam para a fila na hora e continuam da mesma sessão. Normalmente nada disso é preciso: o motor se atualiza
  sozinho (ADR-100).
- Atualizar a IA (NOD-9, definido em 2026-10-23): o motor atualiza sozinho o Claude Code e o Codex que ficarem abaixo
  da versão que o nod precisa, quando a IA não tem turno rodando. Para pedir na hora: `nod-motor atualizar-ia claude`
  (ou `codex`), como o usuário `nod`: `sudo -u nod nod-motor atualizar-ia claude`. Ele espera os turnos daquela IA,
  mostra o andamento e sai com 0 quando terminou. Também dá para pedir pela tela (o **Atualizar** no login que falhou
  por IA desatualizada). Sem sudo: a IA é reinstalada por cima em `~/.local` com o npm do motor. No máximo 3 pedidos
  por hora por IA. Se a IA vem de `NOD_CLAUDE_BIN`/`NOD_CODEX_BIN`, o nod não mexe nela.
- Desconectar: em **Computadores**, cancele a chave da VM. Os bots presos a ela voltam a rodar em qualquer máquina.
- Remover da VM: `sudo systemctl disable --now nod-motor` e apague `/opt/nod-motor` e o usuário `nod`.

## Problemas conhecidos

- **O pareamento venceu:** o código vale 10 min. Rode `nod-motor parear https://<seu-nod>`.
- **"Chave não vale mais":** a chave foi cancelada (o motor só desiste depois de três recusas seguidas, a 1 min uma da
  outra). Rode `nod-motor parear https://<seu-nod>` e mova os bots para a máquina nova em Máquinas.
- **Segurança:** a chave do motor, o login do Claude Code (`~/.claude/.credentials.json`) e o do Codex
  (`~/.codex/auth.json`) contam como credenciais para o terminal do bot: ele não os lê sem você aprovar.
- **"O servidor pede um motor mais novo":** rode o `curl … | sh` de novo.
