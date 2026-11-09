# ADR-112 — Modo WhatsApp

Status: proposto · Data: 2026-10-17 · Complementa a [ADR-111](adr-111-chaves-de-experimento-calibracao-e-memoria-longa.md)
(as chaves de experimento) e a ADR-053 (o que a conversa mostra). Migração 0089.

## Contexto

Em 17/10 o Marlon comparou o Nod com o Rakazo/Grok Bot e achou as respostas do Nod longas, com cara de relatório:
títulos, listas e um resumo no fim de cada resposta, mesmo para pergunta simples.

Teste offline para medir antes de mudar: o prompt `conversa-manual` do repositório (`tests/unit/domain/__prompts__/`),
Sonnet 5.5, sem ferramentas, 10 mensagens × 2 rodadas. Das variantes saíram o "responde curto" da descrição e a memória
"prefere respostas curtas" do bot de exemplo, para o efeito ser só da regra testada.

| Variante | Mediana do tamanho | Respostas com lista |
|---|---|---|
| Hoje | 1.229 caracteres | 85% |
| "Seja conciso." no fim | −16% | 80% |
| "Be concise." no fim | −27% | 80% |
| Regra de WhatsApp (abaixo) | −64% (444 caracteres) | 0% |

Com a regra de WhatsApp, além disso, 0% das respostas com tabela e 15% com negrito.

Efeito colateral observado: num pedido de rotina, com a regra o bot propôs direto, assumindo dias úteis, em vez de
perguntar.

## Decisão

1. **Uma terceira chave da pessoa**, como as da ADR-111: `preferencias.exp_whatsapp` (0089, nasce falsa), no menu da conta
   logo abaixo da Calibração e da Memória longa, com o mesmo interruptor, rótulo "Modo WhatsApp". `PUT preferencias
   {experimentos: {whatsapp?}}` muda só ela. Vale a partir do próximo turno de qualquer bot da pessoa.
2. **Ligada, o prompt de texto muda em dois pontos** (`prompt-sistema.ts`), ambos na parte estável:
   - a linha "Formatação:" sai e entra a `LINHA_WHATSAPP` ("Tom: escreva como alguém respondendo no WhatsApp: uma a três
     frases curtas…"), que já diz o que a conversa mostra (negrito, código, link no nome);
   - na linha "Progresso:", "O relatório completo vai só na resposta final, depois da última ferramenta." vira "A resposta
     final vai depois da última ferramenta."; o resto da linha fica igual.
   Com a Calibração ligada junto, as duas valem: a linha da Calibração continua logo depois (agora da linha do Tom). O Raio-X
   classifica "Tom:" na seção identidade.
3. **A ligação não muda**: o prompt de voz é outro (`prompt-ligacao.ts`) e já é curto e falado. No turno da ligação o
   Raio-X grava `whatsapp: false`, porque a chave não valeu.
4. **O Raio-X grava o que valeu** em `composicao.experimentos.whatsapp`, e a aba "O que foi enviado" mostra ao lado das
   outras duas. Turno de antes da 0089 não tem o campo e lê desligado.
5. **Desligada, nada muda.** Os prompts de referência existentes ficam byte a byte iguais; o cenário novo
   `conversa-whatsapp` mostra as duas linhas que mudam (parte estável 15.223 caracteres, contra 15.033 da
   `conversa-manual`).

## Alternativas descartadas

- **Só "Be concise."** Encurta pouco (−27%) e mantém o formato de relatório (80% das respostas com lista).
- **Mudar direto, sem chave.** O efeito colateral (assumir em vez de perguntar) precisa ser visto em uso real antes de
  valer para todo mundo, e sem o A/B não há como separar o efeito da regra do resto.
- **Juntar com a Calibração.** Misturaria os efeitos: uma resposta melhor ou pior não diria qual das duas linhas causou.

## Gatilho de reversão ou de promoção

- **Promover a padrão** (apagar a chave e trocar a "Formatação:" pela linha do Tom para todos) se o Marlon confirmar em
  uso real, comparando no Raio-X o tamanho das respostas em turnos com e sem a chave.
- **Retirar** se faltar informação nas respostas, se o bot passar a assumir em vez de perguntar onde deveria perguntar,
  ou se o Marlon preferir respostas mais longas.
- Retirar = desligar a chave e, no PR seguinte, tirar o código. A coluna fica no banco (migração só adiciona).
