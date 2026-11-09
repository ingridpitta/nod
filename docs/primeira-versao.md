# Primeira versão funcional

Referência funcional: Grok Bot e OpenMausBot. Referência visual: imagem fornecida em 17/09/2026.
Base: main `1f071ed`, após integrar o PR #16 e confirmar zero PRs abertos.

## Experimentar

1. Rode `npm run dev:setup` e `NOD_LOGIN=stub npm run dev` com Node 24.19.0.
2. Abra http://127.0.0.1:5274 e entre como uma pessoa do cadastro.
3. Na Frota, escolha **usar Claude (real)**. A sonda precisa confirmar o CLI instalado/autenticado.
   O modo **catcher** é uma simulação para testes e não responde como um modelo real.
4. Clique **+ Criar bot**. Ele nasce com nome e abre o chat com opções de missão. Escolha uma
   opção ou descreva como ele deve ajudar; confirme o perfil proposto.
5. Crie um segundo bot com outra especialidade. Peça ao primeiro que consulte esse colega.
   A troca aparece recolhida com a contagem e os participantes; clique para ver os detalhes.
   A resposta chega e o primeiro bot continua a tarefa.
6. Abra **Nova sala**, escolha de dois a seis bots e envie um objetivo compartilhado. `@Nome`
   direciona uma mensagem; o bot pode passar a vez ou pedir contribuição.
7. Em **Rotinas → Nova rotina**, informe instrução, frequência, horário e fuso. **Testar agora**
   envia o resultado à conversa; **Pausar/Ativar** controla o agendamento. Testes no mesmo minuto
   são deduplicados. Você também pode pedir por prompt, por exemplo: “Todo dia útil às 9h, no fuso
   America/Sao_Paulo, prepare três ideias de conteúdo. Proponha essa rotina.” Confirme a proposta.

O painel **Detalhes** reúne perfil, memória, colegas e rotinas. A busca lateral filtra bots por
nome/especialidade; `⌘K` ou `Ctrl+K` foca a busca. A conversa mantém o rascunho durante eventos ao vivo.

## O que esperar

- O CLI roda nesta máquina com a assinatura da pessoa. Esta versão suporta Claude Code.
- Salas e consultas entre bots mostram as contribuições e mantêm o retorno na origem.
- Rotinas precisam da máquina e do nod ligados; não rodam com o computador desligado.
- Sem conectores concedidos, os bots trabalham com a conversa e memória; não leem arquivos nem
  navegam na internet por conta própria. Os conectores existentes continuam disponíveis na interface.
- Computador remoto fica para a próxima rodada. Não há necessidade de contratar uma VM para usar
  os quatro fluxos desta versão.

## Validação

Os testes específicos cobrem criação direta sem concessões implícitas, diretório restrito, retorno
bot-a-bot à sala de origem e teste de rotina sem modificar pausa/agenda. `npm run check` cobre ainda
isolamento, concorrência, streaming, interrupção e as jornadas completas com o executor de simulação.

Aceite manual em 17/09/2026, pelo navegador e Claude Code 2.1.273 (Haiku):

- Criação de Lume e Cora com perfis completos; consulta Lume → Cora → Lume em conversa privada.
- Criação de rotina por prompt, confirmação, pausa, teste imediato e histórico `executou`.
- Criação de rotina de Cora pelo formulário; ambas as rotinas de exemplo ficaram pausadas.
- Criação da sala **Estúdio de conteúdo**; consulta entre bots e consolidação na própria sala,
  com atualização ao vivo e preservação do rascunho digitado durante o processamento.
- Interface conferida em 1500 px e 390 px; na largura de celular, sem overflow horizontal e
  com acesso ao painel pelo botão Detalhes.

Foram oito turnos reais, todos concluídos. O CLI reportou US$ 0,1619484 de valor equivalente,
mais US$ 0,013891 da sonda: US$ 0,1758394 no total. É a estimativa do CLI para uso pela assinatura,
não uma comprovação de cobrança adicional por API. O roteiro `e2e:haiku` não foi repetido.

Gate final em 17/09/2026: `npm run check` e `npm run build` passaram. São 630 testes: 335 unitários,
206 de integração, 49 de conformidade e 40 de concorrência, em 154 arquivos.

## Segunda rodada: Marketplace e criação conversacional

A partir da base `e246e61` (PR #17 integrado), o `+` cria um bot com nome e boas-vindas.
O botão ao lado abre o menu para buscar agentes ou criar grupos. A troca entre bots ocupa
uma linha expansível com contagem e participantes.

No **Marketplace**, salve a chave do seu projeto Composio em **Salvar e verificar**. Escolha
um app, clique **Conectar**, abra **Entrar no app**, conclua a autorização e clique **Verificar
conexão**. De volta ao chat, o bot pode pedir acesso às ferramentas específicas necessárias.
A chave não deve ser colada no chat. MCPs próprios continuam na seção abaixo do catálogo;
URLs remotas precisam de HTTPS, e credenciais HTTP são cabeçalhos (ex.: Authorization).

O pedido “me lembre de postar no LinkedIn aqui no chat a cada 5 minutos” agora produz uma
proposta confirmável. Pela interface, também há intervalos de 5, 15, 30 minutos e uma hora.
A migração 0010 permite persistir UTC, corrigindo a confirmação dessas propostas.

O login real de cada app requer a conta e autorização do usuário; testes de contrato do
Composio usam respostas simuladas. Ver [ADR-033](adr/adr-033-criacao-conversacional-marketplace-intervalos.md).

Aceite manual da segunda rodada em 17/09/2026, com Claude Code real: criação instantânea de
Nina, opção de missão no chat, proposta e confirmação de perfil, proposta e ativação de rotina
`*/5 * * * *` em UTC, entrega automática às 13:00 de São Paulo e pausa após a entrega.
O pedido para conectar Slack gerou o card no chat e abriu o Marketplace com retorno à conversa.
Nenhuma mensagem foi enviada ao Slack. Busca do catálogo, menu de conversas, expansão da troca
Lume/Cora e ocultação de horário fixo ao escolher intervalo foram conferidos no navegador.

Gate da segunda rodada: `npm run check` e `npm run build` passaram. São 652 testes: 354 unitários,
208 de integração, 49 de conformidade e 41 de concorrência, em 159 arquivos.
