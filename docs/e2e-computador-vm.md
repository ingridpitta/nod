# Smoke do computador da pessoa numa VM limpa (NOD-96 PR 7, ADR-122)

O que o e2e local (`tests/concurrency/computador-motor-e2e.test.ts` e `computador-telas-supervisor.test.ts`) não
alcança: Xvfb, Chromium e bwrap de verdade, as units do systemd numa máquina que nunca as viu, o `IPAddressDeny` no
kernel e o Atualizar reiniciando o serviço pelo `Restart=always`.

## Rodar

```sh
gcloud auth login                         # se o login venceu
scripts/e2e-computador-vm.sh              # Debian 12 (o alvo)
scripts/e2e-computador-vm.sh --trixie     # Debian 13 (secundário)
```

O script cria uma `e2-standard-4` no projeto e zona de `infra/gcp/config.env` (troque com `NOD_GCP_PROJETO` e
`NOD_GCP_ZONA`), envia o `HEAD` + `dist/motor`, roda `scripts/e2e-computador-vm/preparar.sh` como root e **apaga a VM**
no fim, passe ou falhe (`--manter` deixa a VM para depurar). Nada é instalado na máquina de onde roda. Sai com 0 só se
tudo passar; o log fica em `/tmp/nod-smoke-<imagem>.log`.

## O que confere

`preparar.sh` (na VM, root):
- instala o node do motor e o usuário `nod`, como o script do motor pressupõe;
- roda o **mesmo** `blocoDoComputador()` do script do motor, duas vezes (idempotente), com os arquivos servidos por um
  http local no lugar do servidor;
- `nod-computador.socket` e `nod-computador-terminal.socket` ativos e habilitados no boot; donos e modos dos sockets;
  `IPAddressDeny` com 169.254/16 nas duas units; `systemd-analyze security`;
- o `nod` não lê `/var/lib/nod-computador` (perfis, logins, keyring).

`na-vm.mjs` (na VM, como `nod`, fazendo o papel do servidor: assina e sela):
- `iniciar` numa instalação limpa (TOFU) em menos de 60 s;
- Chromium real abre e navega; login em comum entre telas (httpbin);
- 6 telas ao mesmo tempo com mais de 1 GB livre;
- a tela e o terminal não alcançam o metadata nem o 127.0.0.1 do motor; o terminal alcança a internet e roda como
  `nod-pc-term`;
- Atualizar: o serviço reinicia, religa com a mesma chave e o login fica;
- Redefinir: X25519 nova na resposta, religa selando para ela e o login fica;
- comando forjado (sem assinatura válida) é recusado.

Rodar o `na-vm.mjs` fora da VM (sem systemd, com a tela falsa) só valida o protocolo: Chromium, login real, egress do
terminal e o reinício do Atualizar falham de propósito.
