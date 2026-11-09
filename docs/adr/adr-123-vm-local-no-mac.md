# ADR-123 — O computador do bot no Mac mora numa VM Linux embutida no app

> Itens 1 a 5 substituídos pela ADR-127 (2026-10-24).

Status: proposta, atrás de `NOD_VM_LOCAL=1` · Data: 2026-10-22 · Issue: NOD-93 · Emenda a
[ADR-037](adr-037-computadores-por-bot.md) (computadores), [ADR-097](adr-097-agentes-entram-trabalho-pesado-faz-fila.md)
(memória no Mac) e [ADR-100](adr-100-o-motor-se-atualiza-sozinho.md) (quem atualiza o quê).

## Contexto

A NOD-96 traz o computador de volta como um por pessoa, rodando na máquina da pessoa, e o primeiro corte é só Linux.
Quem usa o nod só pelo app do Mac fica sem computador. O "não" original da VM no Mac era "dobra o suporte": aceitar o
Docker Desktop, o OrbStack, o Podman ou o Colima que a pessoa tiver. Com um runtime só, embutido no app, o suporte não
dobra.

## Decisão

1. **Runtime:** Lima com Virtualization.framework (`vmType: vz`, sem Rosetta), embutido no app em `extraResources`, com
   `LIMA_HOME` próprio em `~/Library/Application Support/nod/vm`. O `limactl` assinado leva
   `com.apple.security.virtualization`. Sem mounts do Mac e sem porta no host: o único canal é o socket do dockerd,
   num caminho só do nod.
2. **O Docker da pessoa fica intocado.** O nod usa o `docker` CLI estático que leva, com `DOCKER_HOST` e `DOCKER_CONFIG`
   próprios. Nunca `~/.docker`, `docker context`, `~/.lima` nem `/var/run/docker.sock`.
3. **O mesmo driver.** `DriverComputador` (src/contracts/computador.ts) é o da NOD-96; só o `rodar()` de
   `src/adapters/computador/docker.ts` passa a aceitar `{ bin, env }`. Sem eles, continua o `docker` do PATH.
4. **Um disco por arquitetura**, do mesmo Dockerfile da imagem do Linux: `nod-vm-<versão>-<arch>.img.zst` (Debian 12
   genericcloud datado + dockerd + chrony + a imagem do computador dentro), com `.sha256`, gerado no `desktop-release`
   (`infra/vm-local/construir-disco.sh`, runner da própria arquitetura). A imagem multi-arquitetura sai de
   `npm run computador:build` (buildx, `linux/arm64` + `linux/amd64`).
5. **Dois discos na VM.** O base troca a cada versão do app; o `nod-dados` (containers, volumes, logins) sobrevive a
   Atualizar e Redefinir. O dockerd não sobe sem o `nod-dados` montado.
6. **macOS 13 ou mais novo** para o computador. O app continua abrindo no 12 (`minimumSystemVersion: 12.0`): abaixo
   do 13 é o estado `macos_antigo`, e nada baixa.
7. **Preparo só em memória** (`src/domain/preparo-vm-local.ts`): é estado volátil do Mac, anunciado na conexão; não vai
   para o banco.

## Notas nas ADRs existentes

- **ADR-037:** o computador também pode morar numa VM do app do Mac. Nada muda no driver nem nos limites por host.
- **ADR-097:** a VM entra como um bloco na fatia dos bots no Mac. Memória por modo: Pouco 2 GiB, Equilibrado 3 GiB,
  Livre 4 GiB, teto de 25% da RAM (suposição até medir).
- **ADR-100:** runtime e disco da VM atualizam com o app (o digest fixo vai no app), nunca pelo motor.

## Alternativas descartadas

- **O Docker/Podman da pessoa:** é o "dobra o suporte" do não original, e o nod passaria a mexer em algo dela.
- **QEMU embutido:** maior, mais lento no Apple Silicon, e a assinatura não fica mais simples.
- **Virtualization.framework direto por um helper Swift:** é o plano B, se a notarização do `limactl` com o
  entitlement não passar (portão do PR 2), com a mesma interface de `desktop/vm-local/runtime.ts`.

## Gatilho de reversão

- A notarização do `limactl` com `com.apple.security.virtualization` recusada: troca para o helper Swift.
- A VM vz voltando travada do sono do Mac em mais de 10% dos acordares medidos no ensaio: rever o runtime.
- O disco passando de 1,5 GB comprimido: separar a imagem do computador do disco base.
