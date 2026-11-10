# ADR-161: O repo público é o único, do código e da operação (emenda a ADR-160)

Status: aceita (2026-11-10, NOD-485). Decisão do Marlon: "por que não passar tudo para o público?". Emenda os itens 1, 3
e 4 da [ADR-160](adr-160-open-core-por-exportacao-e-historico-zerado.md); a licença e a pasta `fechado/` (item 5) seguem.

## Contexto

A ADR-160 deixou o desenvolvimento no repo privado e publicava snapshots exportados no `marlonwlv/nod`. Na prática isso
dava dois repos para manter, um exportador no caminho de toda mudança e uma CI pública que nunca rodou (os runners
Blacksmith só existem na organização do repo privado). O Marlon decidiu mover o desenvolvimento para o público. A
primeira proposta mantinha o privado como "distribuição" (sincronizado a partir do público, com deploy e secrets lá);
ela foi trocada por esta, mais simples: um repo só.

## Decisão

1. **`marlonwlv/nod` é a fonte da verdade do código e da operação.** PRs, CI, deploy de produção e, depois que o Marlon
   copiar os secrets, o release do app moram aqui. O exportador se aposenta (o último export é `gamefik/nod@233248bb8`).
2. **Só o código fechado fica privado**, no repo `gamefik/nod-fechado` (pasta `fechado/`). O núcleo nunca o importa
   (ADR-160 item 5). O build da produção o traz para `fechado/` com uma deploy key só de leitura, guardada no secret
   `FECHADO_DEPLOY_KEY` do environment `producao`.
3. **CI pública sem nada nosso exposto a PR de fork**: runners hospedados do GitHub (`ubuntu-latest`, `macos-15`,
   `windows-latest`), nenhum self-hosted, nenhum `pull_request_target`, `permissions: contents: read`, nenhum secret em
   job de PR, gitleaks pinado em todo PR. Trava em `tests/unit/infra/workflows-publicos.test.ts`.
4. **Deploy pelo público, só da `main`**: `deploy.yml` roda depois do `ci` verde num push à `main` **deste** repo
   (exige `event == push`, `head_branch == main` e `head_repository == marlonwlv/nod`; o `workflow_run` também dispara
   para PR de fork com branch "main") e confere que o SHA está na `main`. Environment `producao` restrito à `main`. O WIF
   da GCP aceita este repo só com o `repository_id`, a ref `refs/heads/main` e o environment `producao`.
5. **Config de produção dividida**: as flags ficam em `infra/gcp/config.env`, versionadas e mudadas por PR, como antes.
   Os identificadores (projeto, registro, IP do banco, domínios de admissão, admins, bucket) aqui são de exemplo; os
   reais estão no secret `NOD_CONFIG_PRIVADA`, que `scripts/ci/config-producao.ts` valida, mascara (os logs do Actions são
   públicos) e acrescenta no fim do arquivo. Senhas e chaves continuam no Secret Manager da GCP, lidas na VM.
6. **Nomes internos**: a lista de proibidos da ADR-160 é ela mesma interna e não vem para cá. Uma varredura agendada no
   repo privado confere a `main` e os PRs abertos deste repo e falha (avisa o Marlon) quando acha algo.

## Transição

- Os PRs abertos no `gamefik/nod` em 10/11 (#723, #725, #698, #677) terminam lá. Cada merge deles é levado para cá por
  `scripts/oss/portar.mjs` (no privado), que exporta o pai e o merge e abre o PR com a diferença. Uma trava na CI do
  privado reprova PR novo que mexa em caminho público.
- Corte do deploy: com o deploy público provado, `DEPLOY_PUBLICO=1` aqui e `DEPLOY_PELO_PUBLICO=1` lá, no mesmo passo. O
  `deploy.sh` pega um `flock` na VM: dois deploys de repos diferentes nunca rodam juntos.
- **Reversão**: zerar `DEPLOY_PUBLICO` aqui e `DEPLOY_PELO_PUBLICO` lá e rodar o `deploy` do `gamefik/nod` (o WIF aceita
  os dois). Para tirar o acesso do público à GCP, voltar a condição do provider para só `gamefik/nod`.

## Consequências

- Um repo, um fluxo: o PR que muda uma flag de produção é público e revisado como código.
- Os logs do deploy são públicos; o que não puder aparecer neles tem de estar no secret (mascarado) ou no Secret Manager.
- O release do app (assinatura Apple, Windows, bucket) fica no `gamefik/nod` até o Marlon copiar os secrets para o
  environment daqui; até lá, a release sai de lá.
- O site (`site/`, deploy manual pelo wrangler) tem o e-mail de contato trocado pelo de exemplo no público; o Marlon define
  o contato público antes do próximo deploy do site.

## Gatilho de reversão

Vazamento de dado de produção por log ou PR que a máscara e a varredura não seguraram, ou necessidade de CI com
máquina própria que não dê para isolar de PR de fork: voltar o deploy ao repo privado (seção Transição).
