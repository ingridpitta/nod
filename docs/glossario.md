# Glossário e fluxos do nod — em linguagem simples

Este documento traduz os termos técnicos do nod para o dia a dia, com analogias. Para o desenho
formal da arquitetura, veja [arquitetura.md](arquitetura.md). Para as decisões, [docs/adr/](adr/).

## O que é o nod, numa frase

> **Um lugar onde assistentes de IA preparam decisões e uma pessoa decide — com um cartório
> registrando quem decidiu, por quê, e se havia alguém olhando.**

A analogia que vale para o documento inteiro: pense num **escritório**. Você é o **chefe**. Você tem
**assistentes** (a IA) que fazem rascunhos e tarefas, mas **quem aprova é você**. E há um **cartório**
que anota tudo, de forma que ninguém pode apagar depois.

Um detalhe que explica metade das decisões técnicas: **a IA de verdade roda na SUA máquina** (o
Claude Code que você já tem instalado e paga). O nod é o **gerente do escritório** — ele organiza,
distribui tarefas e guarda os registros, mas **nunca vê a sua senha** e nunca faz a tarefa sozinho.

---

## Glossário

### As peças que você "vê" no produto

| Termo | Em linguagem simples | Analogia |
|---|---|---|
| **Agente** (ou **bot**) | Um assistente de IA que você configura: nome, personalidade, memória. | Um funcionário virtual com um crachá. |
| **Frota** | A tela com todos os seus agentes. | O organograma do escritório. |
| **Turno** | Uma "rodada de trabalho" de um agente: ele acorda, faz uma coisa, entrega um resultado. | Uma tarefa/recado, do começo ao fim. |
| **Ferramenta** | Uma ação que o agente pode tomar (ex.: `lembrar`, `pedir_aprovação`, `perguntar_a_bot`). | Os botões que o assistente pode apertar. |
| **Conector** | Um serviço externo que você conecta ao agente (ex.: outro sistema/MCP). | Plugar o Gmail ou o ClickUp na mesa do assistente. |
| **Decisão / Aprovação** | O momento em que **você** aprova ou recusa o que o agente preparou. | O chefe assinando (ou não) o documento. |
| **Sua vez** | A fila de coisas esperando **a sua** decisão. | A bandeja de "para assinar" na sua mesa. |
| **Rotina** | Uma tarefa que se repete sozinha num horário (tipo agenda). | O despertador que manda o assistente fazer algo toda manhã. |
| **Sala** | Um espaço onde 2 a 6 agentes conversam entre si para resolver algo. | Uma sala de reunião de assistentes. |
| **Trilha** | O registro de tudo que aconteceu, que **não pode ser editado nem apagado**. | O livro do cartório (à prova de rasura). |
| **Seu Mac** | O **seu** computador, onde o nod e a IA rodam. Quando ele dorme, perde a rede ou o nod é fechado, o que estava rodando para no meio — "seu Mac parou de responder". | A mesa do escritório: se a luz cai, o trabalho em cima dela para. |
| **Computador do bot** | Um computador **próprio de cada bot**, separado do seu Mac, onde ele navega em sites e guarda arquivos (ADR-037). Pode estar fora do ar mesmo com o seu Mac ligado: depois de três falhas seguidas ele sai das execuções, a conversa do bot recebe **um** aviso com o motivo e "Tentar de novo" religa. | A estação de trabalho que o assistente tem na sala dele. |
| **Aviso** (incidente) | Um recado de infraestrutura com começo e fim ("Seu Mac ficou sem contato entre 00:50 e 06:13"). **Não é decisão**: não pede nada, só conta o que aconteceu; "Entendi" tira da tela (ADR-045). | O bilhete do zelador: "faltou luz de madrugada". |

### As peças "de dentro" (a mecânica)

| Termo | Em linguagem simples | Analogia |
|---|---|---|
| **Servidor** | O cérebro central: guarda tudo, mantém a fila, distribui as ordens de trabalho. | O gerente do escritório. |
| **Executor** | O "motor" que de fato roda a IA de um turno. Existem dois tipos (ver abaixo). | O tipo de motor do carro. |
| **`catcher`** | Executor **de mentira**, gratuito: em vez de chamar a IA de verdade, lê marcadores no texto. Usado no desenvolvimento e nos testes. | Um simulador de voo — parece real, não sai do chão, custo zero. |
| **`claude-cli`** | Executor **de verdade**: usa o Claude Code que está na sua máquina (e custa a sua assinatura). | O motor de verdade, com combustível de verdade. |
| **Driver** | A "tomada" específica que conversa com um executor. Cada executor tem o seu driver. | O adaptador de tomada certo para cada aparelho. |
| **CLI (Claude Code)** | O programa de IA que **já está instalado na sua máquina** e resolve a própria credencial. | O carro que já está na sua garagem. |
| **Proxy MCP** | O **porteiro/segurança** entre a IA e as ferramentas. Ele decide o que o agente pode usar, corta resultados grandes demais, monta a lista de aprovação e bloqueia o proibido. | O segurança que confere o crachá em cada porta e barra o que não pode. |
| **MCP** | O "idioma" padrão que as ferramentas e a IA usam para conversar. | O protocolo de rádio comum que todos falam. |
| **Plano de turno** | A **ordem de trabalho lacrada** que o servidor entrega antes de cada turno: qual agente, quais ferramentas, orçamento, prazo, uma chave temporária. | Um envelope lacrado com as instruções da tarefa. |
| **Ponte** | O canal de conversa entre a sua máquina e o servidor. **Regra de ouro: a sua máquina sempre liga para o servidor; o servidor nunca liga para você.** | Você liga para o escritório — o escritório nunca liga para a sua casa. |
| **Fila (de turnos)** | A lista de tarefas pendentes. Dois trabalhadores nunca pegam a mesma. | A pilha de senhas do banco — cada um pega a próxima. |
| **Lease / Renovar** | Uma "reserva com prazo" do turno: a máquina precisa dizer "ainda estou trabalhando" a cada 30s. Se calar, a tarefa é liberada. | O parquímetro: pare de alimentar e a vaga é liberada. |
| **Assentar** | Finalizar um turno e gravar o resultado em definitivo. | Bater o carimbo de "concluído". |
| **Sonda** | Uma verificação que pergunta "o Claude Code está disponível?". | O teste de "alô, alô, está me ouvindo?". |
| **Inventário** | A lista de motores disponíveis para cada pessoa. | O inventário da garagem: quais carros funcionam. |

### Os termos de "encanamento" (para quem for ler o código)

| Termo | Em linguagem simples |
|---|---|
| **Postgres / banco** | O arquivo/gaveta onde tudo é guardado. |
| **RLS** (segurança por linha) | A tranca da gaveta: cada pessoa só enxerga as próprias linhas. São duas camadas de tranca. |
| **Escopo / transação escopada** | Toda operação no banco é carimbada com "de quem é" (empresa + pessoa). Não existe acesso anônimo. |
| **Tenant** | A fronteira da empresa. Hoje há um só, o tenant padrão. |
| **Events / Outbox** | *Events* = o rio de "o que aconteceu". *Outbox* = a caixa de saída que garante que os avisos sejam entregues. |
| **Barramento** | O sistema de som interno que anuncia as mudanças para quem estiver escutando. |
| **SSE** | O "feed ao vivo" para o navegador: um letreiro que avisa "mudou algo, vem ver". |
| **Domínio puro** | As regras do produto escritas como contas puras — sem banco, sem efeitos colaterais. Fáceis de testar. |
| **Caso de uso** | Uma operação do produto (enviar mensagem, decidir, criar rotina). |
| **Fail-closed** | Na dúvida, **bloqueia** (segurança primeiro) — mas sempre **mostra o motivo na tela**, nunca fica em silêncio. |
| **Autoria composta / procuração** | Todo registro guarda **quem escreveu** e **em nome de quem**. |

---

## Os fluxos, contados como história

### Fluxo 1 — As camadas do sistema (o prédio do escritório)

Pense no nod como um **prédio de escritório** com andares bem separados:

- **A recepção (web):** o navegador. Só sabe **pedir** e **mostrar**. Não decide nada sozinho —
  pergunta ao andar de cima e desenha na tela o que voltar.
- **O balcão de atendimento (adapters/http):** recebe os pedidos da recepção, confere quem é você e
  encaminha para dentro.
- **Os escritórios de regra (use-cases + domínio):** onde as regras do produto moram. O **domínio**
  é o cofre de regras puras — não fala com ninguém de fora, só faz contas. Isso o torna fácil de
  conferir.
- **O almoxarifado (repositories):** a **única** porta para o arquivo. Ninguém mexe na gaveta sem
  passar por aqui, e sempre com o crachá (empresa + pessoa).
- **O arquivo trancado (Postgres):** as gavetas com tranca dupla (RLS). Cada pessoa só abre as
  próprias. E tem o **livro do cartório** (trilha), que ninguém apaga.

A regra que segura tudo: **as camadas só olham para baixo, nunca para os lados errados**. O
compilador e o *linter* barram quem tentar furar essa ordem — não é combinado de boa vontade, é
trava.

### Fluxo 2 — A vida de um turno (o recado, do pedido à entrega)

É a jornada mais importante. Em oito passos:

1. **Você pede.** Escreve uma mensagem ou toma uma decisão na tela.
2. **O gerente anota.** O servidor registra e cria um **turno** (uma tarefa) na **fila**.
3. **Um trabalhador puxa a tarefa.** Um processo de fundo (o *orquestrador*) pega a próxima tarefa
   da fila. Ninguém pega a mesma duas vezes.
4. **O gerente entrega o envelope lacrado.** O servidor emite o **plano de turno**: qual agente,
   quais ferramentas, quanto pode gastar, até quando, e uma **chave temporária**.
5. **O motor liga.** O **executor** inicia a IA de verdade (`claude-cli`) — ou o simulador
   (`catcher`) — com aquele plano.
6. **O porteiro confere cada ação.** Quando a IA quer usar uma ferramenta, ela passa pelo **proxy
   MCP**, que olha o plano e faz uma de três coisas: **libera**, **corta** (se o resultado é grande
   demais) ou **bloqueia** (e escreve o porquê). Sem plano válido, **nada** é liberado.
7. **A cada 30s, "ainda estou aqui".** A máquina **renova** o *lease*. Se ela travar ou o laptop
   fechar, a reserva vence e a tarefa vira "interrompida" — com motivo escrito, nunca em silêncio.
8. **Entrega e carimbo.** No fim, o resultado é **entregue uma vez**; o servidor **assenta** o turno,
   grava tudo no cartório e dispara um aviso ao vivo (**SSE**) para o seu navegador, que se atualiza.

Três verdades que valem a pena guardar:
- **A sua máquina sempre liga para o servidor, nunca o contrário** (a ponte). Sua presença é
  percebida justamente porque você está "puxando" tarefas.
- **Sem o envelope (plano), o porteiro não libera nada.** A segurança é estrutural, não um "se" no
  código.
- **O porteiro protege contra o *agente*, não contra você.** Você é o dono da sua máquina; o proxy
  existe para conter a IA, não você.

### Fluxo 3 — A abertura do escritório (o boot)

Quando o servidor liga, ele faz uma rotina de abertura, em ordem:

1. **Prepara as gavetas do arquivo** (as partições por mês).
2. **Abre a porta** (passa a escutar na porta 8888).
3. **Confere os motores disponíveis** (a *sonda*: o Claude Code responde?).
4. **Liga os trabalhadores de fundo**, todos por pessoa:
   - o **orquestrador** (puxa e roda os turnos),
   - o **agendador** (dispara as rotinas na hora certa),
   - dois **varredores** (um libera reservas vencidas, outro fecha o que expirou),
   - o **despachante** (leva os avisos da caixa de saída ao letreiro ao vivo).

A partir daí, o escritório está aberto e o Fluxo 2 pode acontecer a qualquer momento.
