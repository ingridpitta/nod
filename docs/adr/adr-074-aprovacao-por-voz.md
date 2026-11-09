# ADR-074 — Aprovação por voz: gramática fechada e comando de uso único

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

- Um card da conversa da ligação chega ao orquestrador pelos frames da pessoa; a composição monta a **leitura no
  servidor** (`redigirLeituraDeAprovacao`, a partir de campos tipados; turno contaminado lê só os tipados) e o bot a lê.
- A **janela** abre 300 ms depois do fim da leitura e dura 20 s; nenhuma espera toca nela. Só vale fala **detectada
  depois da abertura**; a guarda de eco por similaridade fica desligada para a frase de comando (ela é o que o bot leu).
- **Gramática fechada** (`interpretarComando`): estrito ("eu aprovo", "aprovo", "pode aprovar") para aprovação, acesso
  e retomar; proposta ("pode criar", "pode ser", "isso") para rotina e perfil; qualquer negação recusa; "sim/ok" no
  estrito pede confirmação uma vez; "repete" relê.
- Reconhecido o comando, o servidor manda `comando {comandoId}` (opaco, uso único, 10 s) e **o cliente** chama a rota
  de decisão existente com `{canal:"voz", ligacaoId, comandoId, acao}`. A rota confere e gasta o comando no orquestrador
  e monta o corpo sozinha (recusar uma aprovação = todos os itens desmarcados). `sempre`, `restoDaTarefa`, `itens` e
  `capacidades` com canal de voz → 400.
- O resultado é falado só depois da resposta 200, e o cérebro recebe uma nota de que já foi dito.

## Por quê

O modelo nunca decide (ADR-026). A fala transcrita é frágil; a defesa é o tempo (janela pelo VAD), a gramática fechada,
a leitura montada pelo servidor e o comando de uso único. Risco residual aceito: alguém ao lado dizer "eu aprovo"
dentro da janela — o mesmo de um Mac destravado.
