# ADR-125 — A gaveta do bot minimalista: identidade editável no topo, abas e o nível Ajustes

Status: aceito · Data: 2026-10-23 · NOD-349 · Emenda ADR-060 (itens 3 e 5) e ADR-032 (painel do bot). Protótipo
`nod-prototipos/nod-349` (v2).

## Contexto

A gaveta de 380 px juntava tudo numa rolagem só: a miniatura da tela, o nome, Editar perfil, Atalhos, Rotinas, Acessos,
Colabora com, o Modo dev e o Ambiente. O ⋯ do topo repetia o menu da lista, com Excluir ao lado do nome. O Marlon
comparou com o Grok e pediu a gaveta enxuta: no topo só compartilhar e fechar, a identidade editável ali mesmo e o resto
em abas e num nível de ajustes.

## Decisão

1. **Topo.** Só dois ícones redondos de contorno (32 px, 44 no toque): Compartilhar à esquerda e Fechar à direita. Sem
   título e sem ⋯. Compartilhar abre um menu pequeno com o que já existe: Copiar ID da conversa e Duplicar bot.
2. **O ⋯ sai da gaveta** (emenda ADR-060 item 3). O menu do bot fica na linha da lista: clique direito, Shift+F10 e toque
   longo, com um ⋯ visível na linha só no toque. Renomear bot abre a gaveta com o nome em edição (sai o diálogo) e Editar
   perfil abre Ajustes › Missão e voz.
3. **Identidade editável no topo.** Avatar xl (o lápis aparece no hover; no toque, sempre), nome e subtítulo são campos
   sem sublinhado: Enter ou blur salva, Esc desfaz, o nome vazio volta e avisa. O avatar abre um popover com as 8 formas
   e as 12 cores do mascote e Redefinir. No bot de outra pessoa, nada disso; no Nod, só o nome fica fixo (o servidor
   recusa renomear), e subtítulo, forma e cor continuam editáveis. Os PATCHs de um bot saem um de cada vez (o último
   valor vence) e a frota relida no meio não desfaz na tela o que ainda vai sair. Gerar e Enviar imagem ficam para a
   NOD-355.
4. **Abas** (padrão da NOD-326): Detalhes, Biblioteca e Computador, com a última aba lembrada por bot neste navegador. O
   bot de outra pessoa não tem a aba Computador. A aba Biblioteca entrou com a NOD-326 (a chave `BIBLIOTECA_NA_GAVETA`
   saiu; ver a emenda no fim).
5. **Detalhes** mostra o onboarding, as Rotinas e uma linha "Ajustes ›". **Computador** mostra a miniatura e os estados
   ligado, dormindo, sem computador e fora do ar, este como linha neutra (ícone em `--danger`) e um ponto na aba que
   vem só da frota. Todos os estados têm Abrir computador; ambiente indisponível e falha de leitura dizem isso.
6. **Nível Ajustes** (emenda ADR-060 item 5): Atalhos (Ligar, Memória, Trabalhos, Atividade), Perfil (Missão e voz),
   Acessos e Ambiente, e no fim o que é do Modo dev. O ‹ dos níveis abertos dali volta para Ajustes; o da rotina volta à
   visão geral. Missão e voz é o antigo Editar perfil sem forma, cor, nome e título.
7. **Saem:** Colabora com (qualquer bot colabora com qualquer bot) e a Pasta de trabalho, cujo destino é a Biblioteca;
   desde a NOD-326 a Pasta mora no topo da aba Biblioteca (antes, em Ajustes › Ambiente, para nada sumir sem destino). Planejar e Pedir ajuda viram os dois primeiros itens do "/" do campo ("Atalhos de <bot>").
8. **Erros sem cor de fundo:** nenhum cartão, tag ou botão cheio vermelho ou âmbar na visão geral; só o ícone tem cor.

## Alternativas descartadas

- **Manter o ⋯ no topo ao lado de compartilhar.** Excluir continuaria a um clique do nome, e o topo voltaria a ter três
  ícones.
- **Editar nome e avatar no nível Editar perfil, como antes.** Um nível inteiro para trocar uma cor; a pessoa já está
  olhando o nome no topo.
- **Mostrar a aba Biblioteca vazia até a NOD-326.** Seria uma aba que não faz nada; a chave liga a aba quando a
  biblioteca existir.

## Gatilho de reversão

- Se, num mês, mais de um relato disser que não achou Excluir, Mover ou Fixar (o menu saiu do topo), o ⋯ volta à gaveta
  só no celular.
- Se o nome for apagado por engano (relato de nome trocado sem querer) mais de uma vez, a edição inline passa a pedir
  um clique em "Renomear" antes de virar campo.

## Emenda (2026-10-24, NOD-326): a aba Biblioteca (o Ir para a mensagem revisto pela NOD-363)

- A chave `BIBLIOTECA_NA_GAVETA` foi removida: as abas são Detalhes · Biblioteca · Computador (o bot de outra pessoa,
  Detalhes · Biblioteca).
- A Pasta de trabalho sai de Ajustes › Ambiente e fica no topo da aba Biblioteca, só no bot da pessoa.
- A aba lista a mídia que o bot criou e prendeu a uma fala desta conversa (`GET /conversas/:id/biblioteca`, cursor por
  instante e id, 60 por página), em Hoje, Últimos 7 dias e Mais antigos no relógio da pessoa, 5 por grupo e mais 5 a
  cada "Mostrar mais". Imagem e vídeo abrem na tela cheia; o arquivo com prévia, na prévia; o resto (áudio também)
  baixa. O "…" tem Baixar e Ir para a mensagem, este só quando a fala está desenhada no chat: o chat carrega uma janela
  das últimas falas e ainda não pagina para trás; sem a fala, o "…" mostra "A mensagem está mais acima no chat." (o ir
  até a fala antiga fica para a paginação do histórico). A lista só é lida com a aba aberta e se relê ao vivo quando
  chega fala nova do bot, e ao reconectar ou retomar o stream.
- Gatilho de reversão: se a leitura da Biblioteca passar de 200 ms no p95 com o índice parcial `anexos_da_biblioteca`,
  a lista passa a vir junto com a conversa em vez de uma rota própria.

## Emenda (2026-10-28, NOD-379): no celular o ⋯ da linha sai

O item 2 deixava um ⋯ visível na linha só no toque. Na inicial do celular (ADR-094, emenda NOD-379) o ⋯ some da vista e
o menu do bot abre no toque longo, com o bot segurado por cima do fundo desfocado e o menu logo abaixo; uma dica única
("Segure um bot para ver as ações") ensina o gesto. O botão ⋯ continua no HTML, escondido só visualmente, para o leitor de
tela. No computador nada muda.

## Emenda (2026-10-28, NOD-382): o celular

No celular, a gaveta vira o perfil do bot da [ADR-133](adr-133-perfil-do-bot-no-celular.md): lista agrupada no lugar das
abas, menu do toque longo com até 5 itens (Ocultar vai para Ajustes › Na lista) e Ajustes sem as descrições longas. O
desktop segue esta ADR.

## Emenda (2026-10-28, NOD-363): Ir para a mensagem em todo item da Biblioteca

O desvio da emenda NOD-326 sai: o "…" de todo item tem Ir para a mensagem. Com a fala desenhada, leva na hora, sem rede.
Fora da janela, o item vira "Carregando…" e a conversa relê com o `?ate=<mensagem>` da busca do celular (NOD-380): a
janela cresce até a fala (teto de 1000 falas depois dela) e continua assim nas releituras até a pessoa voltar ao fim.
Quando a fala chega, o menu fecha, a gaveta sobreposta do celular fecha e só então rola e realça. Se a fala foi apagada
ou passa do teto, a nota "Não deu para chegar a essa mensagem: ela é antiga demais ou saiu do chat." aparece no menu;
sem resposta em 20 s, a nota "A mensagem demorou para carregar. Tente de novo.". A fala que veio mas a timeline recolhe
(no meio de um turno) leva à vizinha desenhada. Fechar o menu cancela a espera e devolve a janela de antes (o alvo
anterior, se um Ir ou a busca já a tinham feito crescer). Ir a uma fala já carregada também marca o alvo (sem
rede), para a fala nova não a tirar de debaixo de quem lê. Limite aceito: perto do teto (1000 falas depois da fala), cada
fala nova desliza a janela em uma, e a fala pode sair dela. Não há paginação para trás com `antes` nem mescla de páginas no cliente: a janela
crescida é contínua, e o DTO inteiro trocado na releitura não tem buraco nem duplicata. A rolagem infinita para cima,
quando vier, é que cria a paginação.

Desvio do detalhamento: a issue sugeria `antes`/`limite` na rota, mescla no reducer e teto de 2000 falas. Ficou o `?ate=`
da NOD-380, com teto de 1000, porque a janela contínua elimina a mescla e o caso de buraco e de duplicata. Gatilho de
reversão: relato de "antiga demais" para fala dentro de 2000, ou a rolagem infinita para cima entrando no roadmap. Aí
entra a paginação com cursor (`antes`) e a mescla no cliente.
