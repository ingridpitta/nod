# ADR-160: Open core por exportação, histórico zerado e Apache 2.0

Status: aceita (2026-11-09, ADA-282). Decisões do Marlon: titular do copyright Marlon Wanderllich, repo público
`marlonwlv/nod-oss`, exportar com histórico zerado (sem transferir o `gamefik/nod`).

## Contexto

O nod vai abrir o código. O repositório de desenvolvimento tem milhares de commits com dado de produção sem segredo
(formato do env, estado local de ferramentas), referências a pessoas e clientes reais, capturas de tela e a
infraestrutura da versão hospedada. Nenhuma credencial real vazou (auditoria da ADA-282), mas limpar o histórico
commit a commit deixaria resíduo e exigiria prova commit a commit.

## Decisão

1. **O repositório de desenvolvimento continua privado e é a fonte da verdade.** O público é um **snapshot exportado**,
   com **histórico zerado**: o primeiro export é um commit só e cada export seguinte é um commit novo, que cita o SHA do
   privado. Nada do histórico privado é publicado.
2. **O export é declarativo e varrido.** `scripts/oss/exportar.mjs` lê um ref commitado e aplica `oss/manifesto.json`:
   exclusões (glob), reescritas (literal ou regex, com caixa preservada), ajustes do `package.json` e os arquivos de
   `oss/publico/` na raiz. Depois varre o snapshot: padrões proibidos (no conteúdo e no nome do arquivo), binários e imagens fora da lista revisada e gitleaks (sem
   `gitleaks:allow` nem `.gitleaksignore` valendo). Achado
   reprova; o aceito precisa citar o padrão, os arquivos e o porquê.
3. **Push só com flag explícita**: `--push=<dono/repo>` igual ao manifesto, varredura limpa, gitleaks instalado, sem
   titular pendente e privado sem alteração por commitar. Nunca roda na CI nem por bot: é decisão de pessoa.
4. **A CI do privado roda o export a seco** (job `oss`: testes do export, varredura e typecheck do snapshot), sem push e
   sem bloquear na primeira fase.
5. **Licença: Apache 2.0 no núcleo.** Marketplace pago, pagamentos e recursos de empresa ficam na pasta `fechado/`
   (excluída do export) ou só nos servidores do nod, e se ligam ao núcleo por pontos de extensão do núcleo, que compila
   e passa nos testes sem eles. A marca "nod" não é licenciada (`LICENSING.md`). Contribuições com DCO.

## Consequências

- O blame público começa no primeiro export; o histórico completo fica no privado.
- Arquivo novo com dado real não passa calado: a varredura do job `oss` acusa. Imagem ou binário novo precisa entrar
  em `imagensRevisadas` de propósito.
- Teste que lê um arquivo excluído precisa ser excluído junto (o snapshot roda os testes unitários sem ele).
- Contribuição externa entra no público e é aplicada no privado à mão até a direção se inverter.

## Alternativas

- **Transferir e abrir o próprio repositório**: leva o histórico e quebra o WIF do deploy, os runners próprios (PR de
  fork em repo público) e o app de CI da organização. Recusada enquanto o histórico tiver os achados da auditoria.
- **`git filter-repo`**: resíduo em versões antigas e prova commit a commit. Recusada.
- **Licença de código-fonte disponível ou copyleft forte**: o Marlon fechou em Apache 2.0 com a pasta fechada.

## Gatilho de reversão

Contribuição externa frequente (mais de uma por semana por um mês): inverter a direção, o público vira a fonte e o
privado passa a consumir o público mais a pasta fechada.
