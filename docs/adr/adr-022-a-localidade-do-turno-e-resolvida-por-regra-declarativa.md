# ADR-022 — A localidade do turno é resolvida por regra declarativa, nunca escolhida pelo agente

**Status** novo

## Decisão

Todo turno nasce com locality já resolvida por uma função PURA que recebe (origem do turno, se toca dado pessoal, motor exigido, pessoa dona) e devolve 'local' ou 'servidor' com um motivo TIPADO. A regra da v1 cabe em três linhas: conversa e trabalho do dia rodam LOCAL; rotina agendada roda no SERVIDOR; turno que exige motor ausente do inventário da pessoa é RECUSADO com motivo, nunca silenciosamente promovido. O agente NÃO escolhe e não tem ferramenta para pedir troca de executor. Turno local interrompido não migra. locality, locality_reason, executor e machine_id são gravados no evento desde o primeiro turno.

## O que mudou

Novo. É a regra que impede o agente de escolher com qual credencial gasta.

## Por quê

A pergunta 'quem escolhe o executor' precisa de resposta antes de existir código, porque senão vira um if espalhado em três lugares com semânticas divergentes. E há uma resposta tentadora e errada: deixar o agente decidir, já que ele 'sabe o contexto'. Deixar o agente escolher onde roda é deixá-lo escolher com qual credencial gasta e sob qual regra opera — é a mesma classe de falha que o ADR-013 já rejeitou ao recusar que cada agente declare seus próprios servidores MCP ('exfiltração com cara de configuração'). Trocar 'qual servidor MCP' por 'qual máquina' não muda o argumento. E migrar automaticamente o turno interrompido para o servidor é proibido por dois motivos: turno de agente não é idempotente (pode ter mandado mensagem ou escrito arquivo antes de morrer), e a migração trocaria a credencial no meio do caminho — o que começou na sua assinatura terminaria na fatura da organização.

