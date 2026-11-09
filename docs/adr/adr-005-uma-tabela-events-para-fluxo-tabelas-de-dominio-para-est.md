# ADR-005 — Uma tabela events para fluxo + tabelas de domínio para estado com regra

**Status** mantido

## Decisão

Inalterado. events particionada para fluxo append-only; tabelas de domínio para as poucas entidades com ciclo de vida e constraint; decisão pendente é tabela, não kind; o par (tenant_id, id) em todo identificador que sai do servidor, inclusive na URL. owner_id acompanha como atributo, nunca como parte do identificador.

## O que mudou

Nada de estrutura. A tabela de credenciais muda de conteúdo (só a chave da organização) por causa do ADR-015, não de forma.

## Por quê

Nada aqui dependia do número de clientes; dependia de o produto ter estado com regra, e isso não mudou. O par composto é o único ponto onde alguém poderia querer economizar agora, e é onde a economia é mais cara: o próprio ADR já precificou como 'mudança de contrato de cliente, não migração de dados'. E a premissa nova REFORÇA: com o executor na sua máquina e o estado no servidor, o par atravessa uma fronteira a mais do que antes.

