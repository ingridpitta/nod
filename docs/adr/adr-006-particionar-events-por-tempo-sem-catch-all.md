# ADR-006 — Particionar events por tempo, sem catch-all

**Status** revisado

## Decisão

Mantido o que é irreversível: PARTITION BY RANGE (created_at) mensal na migração inicial, e a AUSÊNCIA de partição catch-all p_future. Reduzido de 24 para 12 meses de partições criadas de uma vez. O job de boot que cria partições faltantes fica. A métrica de distância até a partição mais distante ESPERA — vira alarme quando houver volume.

## O que mudou

De 24 para 12 partições. A métrica de distância sai do dia 1.

## Por quê

Separar as três coisas que este ADR junta. A CHAVE de partição é irreversível (converter tabela grande em particionada depois exige recriar e mover dados com escrita parada) e fica. A AUSÊNCIA de catch-all é o que torna a falha barulhenta em vez de silenciosa, e vale mais num time onde ninguém é plantonista de banco — fica. A QUANTIDADE era justificada por 'se o container não reiniciar por quatro meses'; uma ferramenta que o time inteiro usa todo dia reinicia muito mais. E vale dizer com honestidade: com um time pequeno o particionamento não resolve escala nenhuma. Estamos pagando 12 linhas de migração por opcionalidade e pelo DROP PARTITION da retenção de dado pessoal. É uma troca boa, mas é isso que ela é.

