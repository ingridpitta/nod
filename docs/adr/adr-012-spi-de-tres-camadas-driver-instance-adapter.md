# ADR-012 — SPI de três camadas Driver / Instance / Adapter

**Status** revisado

## Decisão

Mantidas as três camadas sem tirar uma vírgula, com UM campo novo no metadata do Driver: locality ('local' | 'servidor' | 'ambos'). O RuntimeEvent ganha executor ('local' | 'servidor') desde o primeiro evento gravado. UM Driver com campo locality, NÃO duas implementações — as duas frentes propuseram desenhos diferentes e este é o certo, porque duas implementações divergem de comportamento com o tempo e toda a trilha fala o vocabulário de eventos. A diferença entre local e servidor é (a) de onde vem o ambiente do filho, (b) quem hospeda o processo, (c) qual proxy MCP ele monta.

## O que mudou

Um campo no Driver, um campo no evento. Resolvida a divergência entre frentes a favor de um Driver só.

## Por quê

A frase que justificava o ADR — 'a organização tem uma assinatura e três chaves' — ficou MAIS verdadeira, não menos: agora é uma assinatura pessoal por pessoa e uma chave da organização. A camada Instance é 'conta viva com credencial e catálogo', que é o lugar natural para 'a conta da Fulana na máquina dela'. E um motor que não existe na máquina de alguém já é modelado: o registry transforma falha de create() em sombra com motivo. Uma ressalva honesta: ninguém perguntou se as três camadas ainda se pagam, já que a camada Instance existia em parte para girar chave de cliente e não há mais chave de cliente para girar. A resposta é sim — porque agora ela pendura o inventário por pessoa — mas a pergunta era obrigatória e vale ficar registrada.

