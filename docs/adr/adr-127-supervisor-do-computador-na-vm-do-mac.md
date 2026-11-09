# ADR-127: O supervisor do computador também roda na VM do Mac

Status: aceita (2026-10-24, NOD-93). Emenda a ADR-122 (item 6, "Mac anuncia sem_suporte") e substitui os itens 1 a 5 da ADR-123.

## Contexto
A ADR-123 pôs no Mac uma VM Lima (vz) com dockerd e a imagem nod-computador, falando pelo docker.sock. Ela foi escrita quando o computador ainda era por bot (ADR-037). A NOD-96 (ADR-122) passou para um computador por pessoa: supervisor com systemd e bwrap, uma loja única de cookies e comandos assinados que vêm do servidor pela ponte. Pelo docker.sock, o Mac teria um segundo produto, sem cookies comuns e sem Atualizar e Redefinir, e o servidor precisaria de `NOD_COMPUTADORES=docker`.

## Decisão
1. O disco da VM do Mac tem o mesmo alvo da ADR-122: Debian 12 genericcloud com chrony, os pacotes, usuários e units do computador, o node do motor e o Chromium do Playwright. Os pacotes, usuários e units vêm do mesmo `blocoDoComputador` do instalador, com os arquivos locais e sem ligar a unit na construção. O disco não tem dockerd nem imagem tar.
2. O único canal entre o Mac e a VM é o `/run/nod-computador/ctl.sock` do supervisor. O Lima o encaminha para `~/Library/Application Support/nod/vm/ctl.sock`, mantido o teto de 104 bytes. O usuário do Lima entra no grupo `nod` da VM. Continua sem mounts do Mac e sem portas no host.
3. O app do Mac é só o fio, como o motor no Linux: o `iniciarComputador` puxa da ponte e repassa ao socket. Antes de repassar, garante a VM pronta: preparo, memória e `limactl start`, até TETO_PRONTO_MS. Depois do relato, desliga a VM quando `motivoParaFicarAcordada` dá falso.
4. O app anuncia `computador` e `vmLocal`. O `computador` é "pronto" com a VM preparada ou preparável e "sem_suporte" no macOS < 13. O `vmLocal` traz o estado do preparo. Sem `NOD_VM_LOCAL=1`, o app não anuncia nenhum dos dois.
5. O despachante (ADR-122, item 6) escolhe nesta ordem: maquina_id; senão hospedeira_id; senão as Linux que anunciam computador; **sem nenhuma Linux, as darwin que anunciam computador**. Dentro do grupo, a ordem é a mesma de antes: a única pronta, a padrão, a mais recente. Uma Linux que aparece depois não tira o computador do Mac sozinha: a hospedeira manda, e a troca fica com a pessoa (NOD-365).
6. O disco `nod-dados` guarda `/var/lib/nod-computador`, com perfis, cookies e chaves do supervisor. Ele sobrevive a Atualizar o app e a Redefinir o disco base.
7. Saem da ADR-123 o docker CLI embutido, o DOCKER_HOST/DOCKER_CONFIG próprios, o dockerd e a imagem no disco, e a mudança de bin/env no docker.ts. Continuam o Lima vz, o macOS 13+, o preparo em memória (item 7), o download com retomada e sha256 e o disco por arquitetura no release.
8. O sha256 do disco vem embutido no app, nunca da origem do disco (ADR-123, nota da ADR-100). O job `vm-local` do `desktop-release` constrói o disco, e o job `mac` espera por ele e grava o hash em `Contents/Resources/vm-local/disco.sha256` (`scripts/vm-local/digest-do-disco.ts`), assinado e notarizado com o app. O disco vem de `NOD_VM_DISCO_URL`, que aceita só `https:`, e o padrão é o release do repo. A origem pública (release público ou CDN) fica para o Marlon decidir. Origem inválida, app sem o hash ou HTTP 4xx no download levam o preparo a `falhou` com o motivo. Só erro de rede e HTTP 5xx, 408 ou 429 pausam como sem internet.

## Consequências
- Mac e Linux viram o mesmo produto: mesmo supervisor, mesmo protocolo, mesmos testes. No servidor, muda uma linha de filtro.
- O disco fica do tamanho do runtime do computador (Chromium e node), menor que dockerd mais a imagem.
- O desvio da ADR-122 continua: os arquivos do computador ficam fora do atualizador automático (ADR-100). Na VM, eles se atualizam junto com o disco base, a cada versão do app.
- O Docker Desktop e o Podman da pessoa ficam intocados, porque o nod não tem mais docker no Mac.
