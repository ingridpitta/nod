# ADR-133 — O perfil do bot no celular

Status: aceita · Data: 2026-10-28 · NOD-382 (PR #546) · Protótipo
<https://gamefik.github.io/nod-prototipos/nod-382/> · Emendada pela NOD-444 (2026-10-31, item 3: o vazio de Rotinas) · Emenda da ADR-094 (item 3) e da ADR-125 (itens 1, 2, 4 e 6),
só no celular (`CONSULTA_CELULAR`). O desktop segue a ADR-125 sem mudança.

## Contexto

No celular, a gaveta do bot da ADR-125 era a do desktop esticada: abas, menu de 9 itens no toque longo e descrições
longas em cinza. A NOD-382 troca isso por um perfil no padrão do iOS (Contatos/Ajustes), sem mexer no desktop.

## Decisão

1. **Perfil em vez de gaveta com abas** (emenda ADR-125 itens 1 e 4). A pílula do cabeçalho e "Ver perfil" no menu do
   toque longo abrem o perfil, que entra pela direita com ‹ no topo. O topo tem avatar, nome e subtítulo, ações rápidas
   (Mensagem, Ligar quando o bot liga, Compartilhar) e uma lista agrupada: Código, Rotinas, Biblioteca e Computador com o
   valor à direita, depois Ajustes; Excluir no fim. Cada linha abre a sua tela com ‹ de volta ao perfil. ‹ e Esc voltam
   à origem: o chat, a lista de bots (com a tela de antes) quando o perfil abriu por ela, ou Seu espaço (Configurações ›
   Agentes) quando abriu por lá. Um atalho do chat que abre um
   nível da gaveta (Ver na memória, Trocar a IA…) abre o perfil com origem no chat.
2. **Menu do toque longo com até 5 itens** (emenda ADR-125 item 2; o gesto é o da NOD-379, `web/lib/toque-longo.ts`): Fixar, Marcar como (não) lido, Mover, Ver perfil e Excluir,
   conforme o bot. Ocultar sai do menu e vira o interruptor "Ocultar da lista" em Ajustes › Na lista. O bot oculto sai da
   frota, então ligar o interruptor fecha o perfil, abre a lista e avisa "foi para Ocultos" (o mesmo do desktop); trazer
   de volta é por Configurações › Agentes › Ocultos, onde o menu do bot oculto no celular tem só Mostrar na lista e
   Excluir (o perfil dele não abre: ele não está na frota). Excluir confirma numa folha de baixo e, feito, também fecha o perfil
   e abre a lista. O Nod não tem Excluir nem Duplicar; o bot de outra pessoa não tem Código, Computador, Excluir nem
   lápis, e mostra "Bot compartilhado com você".
3. **Sem descrições longas em cinza** (emenda ADR-125 item 6). Ajustes no celular perde o `<small>` da Máquina, a nota do
   Ambiente e a frase longa de Acessos; os vazios são só o título e um botão; os erros, "— " no valor e a linha
   "não carregou · Tentar de novo". Nada de fundo colorido chapado.
4. **Foco** (emenda ADR-094 item 3, que dizia que o código não move foco ao abrir a gaveta). Ao abrir o perfil, o foco vai
   para o ‹ (um botão: não abre o teclado) para o leitor de tela começar no topo da tela nova; ao fechar, volta à pílula
   ou à linha do bot na lista. "Mensagem" é a única exceção à regra "abrir uma conversa não abre o teclado": a pessoa pediu
   para escrever, então o foco vai para o campo e o teclado abre.
5. **Sem arrastar a linha no celular.** O arrasto nativo do iOS cancela o toque longo que abre o menu; mover um bot no
   celular é pelo item Mover do menu.

6. **Código sem Repositório e Branch.** O protótipo mostra as duas linhas, mas a API do bot ainda não as traz; a tela
   Código mostra só a pasta. Entram quando a API trouxer.

## Alternativas descartadas

- Manter as abas no celular e só enxugar o menu: continua uma tela de desktop apertada, e o protótipo aprovado pede a lista
  agrupada.
- Ocultar como item do menu no celular: estoura os 5 itens; em Ajustes ele fica junto do que se configura no bot.

## Gatilho de reversão

Se em 30 dias a pessoa abrir o perfil e sair sem tocar em nada na maioria das vezes (o perfil vira passagem) ou pedir
de volta o arrastar no celular, revisitar o item 1 (voltar às abas) ou o item 5.

## Emenda de 2026-10-31 — O vazio de Rotinas ensina a conversa (NOD-444)

Esta emenda abre uma exceção ao item 3 ("os vazios são só o título e um botão"). O vazio de Rotinas passa a ter o
título "Nenhuma rotina ainda" e uma dica: "Peça na conversa, do seu jeito: «todo dia útil às 8, me mande as pautas»".
O botão sai do vazio, porque o "Nova rotina" de cima já é o caminho e agora leva à conversa. Dois botões para a
mesma coisa eram o duplicado que a NOD-444 tirou.

A dica fica em `--ink-2` (corpo secundário) e não no cinza de nota (`--ink-3`), para não ser a frase longa em cinza
que o item 3 tirou. É o único vazio com dica. Os outros continuam só com o título e o botão.

Gatilho de reversão: se em 30 dias (até 2026-11-30) quem chega a esse vazio no celular não cria a rotina pela
conversa e volta ao perfil, na maioria dos casos (visto na retro, lendo as conversas), voltar ao vazio de título e
botão.
