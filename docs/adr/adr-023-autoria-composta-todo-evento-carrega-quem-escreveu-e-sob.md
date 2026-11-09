# ADR-023 — Autoria composta: todo evento carrega quem escreveu e sob procuração de quem

**Status** novo

## Decisão

O RuntimeEvent e a forma da mensagem carregam AUTORIA COMPOSTA desde a primeira migração: autor_tipo (pessoa | agente), autor_id, e sob_procuracao_de (pessoa_id, nullable). A renderização deriva daí a assinatura no formato 'Vera · por Carolina'. Toda regra que pergunta 'foi uma pessoa?' lê autor_tipo, nunca infere de outro campo. O campo entra em contracts/evento.ts no commit 2 (o dos tipos), antes de qualquer lógica.

## O que mudou

Novo — mas não é ideia minha: já estava escrito em contracts/evento.ts no esqueleto e é o item nº1 da lista 'acertar de primeira' do README.

## Por quê

Esta é a maior omissão da rodada: nenhuma das quatro frentes mencionou autoria composta, e ela é o item nº1 da lista de coisas a acertar de primeira, marcada como obrigatória na PRIMEIRA migração, com o aviso de que 'retrofitar reescreve toda renderização de mensagem e toda regra que pergunta foi uma pessoa?'. A premissa nova AGRAVA em vez de aliviar: agora o agente roda sob a assinatura PESSOAL da pessoa, na máquina dela, com a credencial dela. 'Foi a Fulana ou o agente da Fulana?' deixou de ser questão de produto e virou questão de trilha, de custo e de LGPD ao mesmo tempo. Custa um campo hoje. Depois custa a renderização inteira, sobre uma trilha imutável.

