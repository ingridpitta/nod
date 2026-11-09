# Licenciamento do nod

## O que é aberto

Todo o código deste repositório é o **núcleo do nod** e está sob a [Apache License 2.0](LICENSE): servidor, web,
app desktop, motor, computador do bot, migrações, testes e documentação de arquitetura. Pode usar, modificar,
redistribuir e oferecer comercialmente, nos termos da licença (inclusive a concessão de patentes e o aviso do
[NOTICE](NOTICE)).

## O que é fechado

Fica fora deste repositório, numa pasta fechada do repositório de desenvolvimento ou só nos servidores do nod:

- **Marketplace pago**: curadoria, listagem paga, repasse e o catálogo hospedado pelo nod.
- **Pagamentos**: assinatura, cobrança, faturas e limites de plano pago.
- **Recursos de empresa**: SSO (OIDC/SAML), marca branca, política gerenciada pela organização, log de auditoria
  administrativa e afins.
- **A operação da versão hospedada**: infraestrutura de produção, deploy, chaves, release assinado do app e o feed de
  atualização.

O núcleo não depende de nada disso para compilar, rodar ou passar nos testes. O que é fechado se liga ao núcleo por
pontos de extensão do próprio núcleo.

## Titular

Copyright 2026 Marlon Wanderllich. O código é licenciado sob a Apache 2.0 pelo titular (veja o [NOTICE](NOTICE)).

## A marca

O nome **nod**, o logo e o personagem são marcas de Marlon Wanderllich. A Apache 2.0 não concede direito de marca
(seção 6): um fork pode usar o código, mas precisa de outro nome e outra identidade visual, e não pode se apresentar
como o nod oficial. Dizer que o seu projeto é "baseado no nod" é permitido.

## Contribuições

Contribuições entram sob a mesma Apache 2.0, com o `Signed-off-by` do DCO em cada commit (veja o
[CONTRIBUTING.md](CONTRIBUTING.md)).
