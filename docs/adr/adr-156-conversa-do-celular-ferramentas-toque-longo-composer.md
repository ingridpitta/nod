# ADR-156 — Conversa do celular: ferramentas numa linha, toque longo e composer + · mic

Status: proposta (2026-11-07, ADA-2 F5) · Emenda a [ADR-129](adr-129-o-pensamento-no-chat.md) §5 (o cabeçalho do
pensamento pronto) e a [ADR-113](adr-113-reacoes-e-citacao-na-fala.md) (como as ações da fala aparecem no celular) · Aplica a
[ADR-148](adr-148-base-do-celular.md) (a forma muda, as ações não) e a [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md)
(nenhuma ação sem rota e sem caminho no chat).

## Contexto

O protótipo `nod-prototipos/ada-2` v2 (jornada 2) redesenha a conversa no celular: o pensamento pronto ocupa uma caixa
com "Pensou por 12 s · 3 ações", as ações da fala aparecem num toque que disputa com a rolagem e a seleção, o card de
aprovação é um bloco preto cheio e o composer junta +, campo, mic e enviar dentro de uma caixa só. Os critérios 1, 2,
3, 5, 11 e 13 e os itens #290 e #293 pedem a forma nova.

## Decisão

1. **Ferramentas numa linha (#290, celular e computador).** O pensamento pronto (`renderResumoDasAcoes`, fase
   `pronto`) passa a mostrar `🔧 Usou N ferramentas ›` (singular "Usou 1 ferramenta"), em 14 px `--ink-3`, sem fundo e
   sem borda. N é o total de chamadas do turno (o mesmo número que hoje sai como "N ações"). Falhas somam
   ` · N falhou/falharam` no mesmo texto. A duração sai do texto e fica no `title` e no `aria-label`
   ("Ver as 3 ferramentas usadas, pensou por 12 s"). O `<details>` continua o mesmo: tocar abre a lista inline e o ›
   gira 90°. A fase viva (pensando) não muda. Esta é a única parte que vale também no computador (critério 13).
   Emenda a ADR-129 §5: "Pensou por N s · N ações" vira "Usou N ferramentas".
2. **Toque longo na mensagem (celular).** Segurar uma mensagem 450 ms (`criarToqueLongo`, toque ou caneta, nunca mouse)
   levanta a mensagem (`--shadow-pop`), desfoca o resto e abre um menu de vidro com **Responder**, **Copiar** e
   **Criar tarefa disto**; depois de um divisor, os outros itens que hoje estão no ⋯ (Lembrar, Abrir task com isto,
   Baixar tudo, Reportar, Raio-X, Desfazer, conforme a fala) e, no topo, a linha de reações. Nenhuma ação some: o menu
   é o mesmo conjunto de `itensDoMenu` + a barra, só que reunido. O toque simples deixa de alternar a barra
   (`acoes-a-mostra`) no celular. Emenda a ADR-113: no celular as ações da fala aparecem no toque longo, não no toque.
   Fixar fica fora (não há ação de fixar).
3. **Criar tarefa disto reusa `quadro.criar_tarefa`.** A tela chama a rota que já existe
   (`POST /agentes/:id/quadro/tarefas`) com título = início da fala (até `LIMITES_QUADRO.titulo`, cortado em palavra)
   e descrição = o texto inteiro (até `LIMITES_QUADRO.descricao`) com a origem ("Da conversa com X, 7/11 14:02").
   Sem agente e no status padrão, para não disparar trabalho sozinho. O item só aparece quando o bot tem quadro. O
   mesmo item entra no ⋯ do computador (paridade da tela). Pelo chat, "cria uma tarefa com isso" já é
   `gerir_quadro criar_tarefa`.
4. **Card de aprovação em contorno (celular).** `.cp` com borda `--line`, raio 16 e fundo `--surface`; a ação vira
   pílula de contorno (44, raio 22, borda 1.5 px `--ink`, transparente) e "Agora não" fica em texto `--ink-2`. O
   perigo continua vermelho (contorno `--danger`). Vale para o card de proposta e o de lote; o cartão do revisor fica
   fora. Só CSS em `celular-base.css`.
5. **Composer + · campo · mic (#293, celular).** Na conversa, no quadro e na tarefa aberta: + redondo de 46 em vidro à
   esquerda, campo em pílula (min 46, raio 23, texto 16, cresce até 6 linhas) no meio, mic redondo de 46 em vidro à
   direita que, com texto (ou sem ditado), vira o enviar de 46 com contorno `--ink`. O conjunto fica 8 px acima do
   teclado ou da área segura. O composer não é regravado dentro da conversa (`web/lib/regioes.ts`): a troca mic ↔
   enviar é classe, não novo HTML. No quadro, o + abre a `folha-mais` com o que o quadro tem (Anexar); com um item só,
   abre o seletor de arquivo direto.

## Consequências

- O que é forma vive em `web/celular-base.css`, dentro de `CONSULTA_CELULAR` (o teste da ADR-148 recusa regra fora). O
  #290 é a exceção e vai em `web/interface.css`.
- Nenhuma ação nova: Responder e Copiar são da tela; Criar tarefa disto usa `quadro.criar_tarefa` (vivo). Paridade e
  piso não mudam.
- Testes que conferiam "Pensou por" no pronto passam a conferir "Usou N ferramentas".

## Gatilho de reversão

Se a medição do celular mostrar que as pessoas não acham as ações da fala (uso de Responder/Copiar cair mais de metade
em duas semanas), a barra volta no toque simples e o toque longo fica como atalho.
