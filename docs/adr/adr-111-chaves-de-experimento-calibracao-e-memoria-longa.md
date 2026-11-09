# ADR-111 — Chaves de experimento: Calibração e Memória longa

Status: proposto · Data: 2026-10-16 · Complementa a [ADR-054](adr-054-modo-dev-e-o-custo-de-cada-turno.md) (o modo dev e
o Raio-X), a ADR-046 (anexos de mensagem) e a 0030 (o que chegou depois da sessão). Migração 0088.

## Contexto

Em 16/10, das 17:15 às 17:20, o Marlon pediu um teste controlado entre o Grok Bot e o Nod: as mesmas três perguntas,
iguais, ao bot da casa de cada um. Duas falhas do nod apareceram com evidência:

1. **Calibração.** Perguntado "GPT-5.5 vs Opus 5.5", o Nod pesquisou, não achou o segundo, afirmou que "o Opus 5.5 não
   existe", comparou com o Opus 5 e repetiu a correção no resumo pedido em seguida. O modelo existia; a busca estava
   atrás do que a pessoa via. O Grok, na mesma pergunta, disse que não tinha dados confiáveis.
2. **Memória sem sessão.** Em 15/10, 15:46, a Frida 2 disse que o playbook enviado no turno anterior "não ficou salvo
   nesta máquina" e que a própria tabela da resposta anterior "só chega inteira até a linha do Copy". A pessoa teve de
   mandar o arquivo de novo. As duas causas estão no código: sem sessão retomada, cada fala do histórico vai cortada em
   1 mil caracteres (`emitir-plano-turno.ts`), e o anexo só vai no turno em que foi enviado (`entrada_anexos`).

O Marlon quer conferir as duas mudanças com uso real, ligando e desligando ao longo do tempo, antes de elas virarem o
padrão — como faz com o modo dev.

## Decisão

1. **Duas chaves da pessoa**, em `preferencias` (0088: `exp_calibracao`, `exp_memoria_longa`, ambas nascendo falsas),
   no menu da conta logo abaixo do Modo dev, com o mesmo interruptor. `PUT preferencias {experimentos: {calibracao?,
   memoriaLonga?}}`; cada uma muda sozinha. Valem a partir do próximo turno de qualquer bot da pessoa.
2. **Calibração** põe a `LINHA_CALIBRACAO` na parte estável do prompt de texto (seção identidade, logo depois de
   "Formatação:"): dizer que não achou e com o que comparou; não afirmar que não existe; corrigir a pessoa só com
   evidência direta. A ligação não muda (tem o próprio prompt).
3. **Memória longa**, só no turno sem sessão retomada e fora da ligação (`historico-do-plano.ts`):
   - as falas mais recentes do histórico vão até 8 mil caracteres (o teto da 0030) enquanto o total couber em 40 mil;
     as mais antigas voltam a 1 mil; a fala cortada leva a marca de quanto ficou de fora;
   - até 3 anexos das falas anteriores da pessoa na janela voltam ao turno (os mais recentes, dos tipos que a IA do
     turno lê), marcados `anterior`. O driver diz ao modelo que vieram de antes. A rota interna serve os bytes porque
     estão no plano daquele turno, como pede a ADR-046; nada vai para o disco.
4. **O Raio-X grava o que valeu** em cada turno (`composicao.experimentos`: as duas chaves e quantos anexos anteriores
   voltaram), e a aba "O que foi enviado" mostra isso. É o que permite comparar turnos com e sem as chaves depois.
5. **Desligadas, nada muda.** Os prompts de referência dos cenários existentes ficam idênticos; o cenário novo
   `conversa-calibracao` mostra a linha que entra.

## Alternativas descartadas

- **Mudar direto, sem chave.** É o caminho de uma correção comum, mas o Marlon pediu para medir com uso real antes. A
  Memória longa custa contexto (até ~40 mil caracteres a mais por turno sem sessão) e a Calibração pode encompridar
  respostas; sem o A/B, não há como separar o efeito delas do resto.
- **Uma chave só para as duas.** Misturaria os efeitos: uma resposta melhor não diria qual das duas ajudou.
- **Variável de ambiente do servidor.** Liga para todo mundo ao mesmo tempo e exige deploy para trocar; a chave da
  pessoa troca na hora e deixa os outros no padrão.
- **Guardar o anexo no disco da máquina.** Já rejeitado na ADR-046.

## Gatilho de reversão ou de promoção

- **Promover a padrão** (apagar a chave e manter o comportamento) quando o Marlon disser que o efeito se confirmou em
  uso real, com turnos comparáveis no Raio-X.
- **Retirar** uma chave se ela piorar o que o Marlon vê. Indícios: a Calibração deixa as respostas visivelmente mais
  longas ou cheias de ressalva; a Memória longa estoura a janela ou dispara compactação ("Autocompact") nos turnos sem
  sessão, o que aparece no Raio-X como compactações.
- Retirar = desligar a chave e, no PR seguinte, tirar o código. As colunas ficam no banco (migração só adiciona).

## Emenda (2026-10-30, NOD-429): chave só da tela

`quadro` (0130, `exp_quadro`) é a primeira chave que **não** vale no turno: liga o par Conversa | Quadro na pílula
das conversas com os bots da pessoa. Não entra no prompt nem em `composicao.experimentos` (os itens 1 e 4 não se
aplicam a ela), e a linha só aparece em Avançado com o Modo dev ligado (ou com ela já ligada, para desligar). Decisão
do Marlon: ligar o quadro antes da NOD-415 sem devtools no app do Mac, desligado para os outros. A flag do servidor da
NOD-415 a substitui.
