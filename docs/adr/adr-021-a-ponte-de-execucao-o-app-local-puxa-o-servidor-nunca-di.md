# ADR-021 — A ponte de execução: o app local puxa, o servidor nunca disca

**Status** novo

## Decisão

O app local é o único que inicia conexão. Cinco rotas HTTP, todas POST do app para o servidor: conectar (a máquina se anuncia: id, nome, inventário de motores, versão do contrato), puxar (long-poll, teto de 20s no servidor e 35s no cliente — a folga é deliberada), renovar (batida de 30s enquanto o turno roda, levando os quatro sinais do ADR-009 e o lote de eventos; resposta {ativo:false} manda abortar), entregar (o resultado, uma vez só) e desconectar. O servidor NUNCA abre conexão com a máquina, não conhece o IP e não tem rota que a alcance. Autenticação: a pessoa entra pelo navegador com Google Workspace restrito ao domínio da organização, e dali emite um TOKEN DE MÁQUINA guardado no Keychain, do qual o servidor guarda só o SHA-256 com comparação em tempo constante. Toda requisição com cabeçalho Origin é recusada com 403 ANTES de olhar o token. PRESENÇA é derivada do próprio poll (sem heartbeat separado). Turno órfão por lease vencido vira 'interrompido' com motivo tipado, numa transição terminal e idempotente por constraint — NÃO volta para pendente, NÃO é oferecido a outra máquina, NÃO migra para o servidor. Duas máquinas da mesma pessoa competem e o SKIP LOCKED decide; o produto MOSTRA onde rodou. O TAMANHO: o núcleo verificado no openmausbot é 110 linhas de servidor + 254 de cliente = 364 linhas.

## O que mudou

Novo. É o único mecanismo desta rodada que não existia em nenhum ADR.

## Por quê

As suas decisões 3 e 4 fixam a direção da conexão e o comportamento no laptop fechado, mas nenhum ADR descrevia o canal — e sem isso escrito a implementação inventaria um, com alta chance de inventar um túnel. O custo que isso evita está inventariado: o companion/ inteiro do openmausbot existe só para deixar algo de fora alcançar a máquina, com um processo que mente sobre a própria origem, mais pareamento, mais token por dispositivo, mais scrubbing. Nada disso é necessário quando a máquina é quem disca. Pus o número de linhas dentro do ADR de propósito: a ponte parece um subsistema quando descrita como lista de exigências, e o time precisa ver que são dias, não semanas.


## Estado nesta rodada (2026-09-16)

O executor fala pela interface `PonteInterna` in-process (mesmo processo que o servidor). Do contrato já valem: Origin → 403 ANTES do token nas rotas `/api/interno/…` (`src/adapters/http/roteador.ts`), identidade derivada do token de turno e nunca de campo `remetente` no corpo, sessão do servidor (stub por cookie assinado, só em 127.0.0.1). A ponte HTTP multi-máquina entra depois sem trocar o driver.

## Gatilho de reversão

Reabrir (canal push, túnel ou relay) só se uma máquina precisar ser alcançada quando NÃO está puxando — hoje isso não existe por desenho: presença é o poll. Se o long-poll de 20 s virar custo mensurável de conexão no PaaS (ADR-001), ajustar o teto, não a direção.

## Ponte HTTP em 2026-09-17

`NOD_MODO=compartilhado` usa `/api/maquina/` para os cinco verbos e a obtenção de sessão do app.
A autorização usa a chave escopada do ADR-031, a cada requisição e durante o long-poll; o id
da chave identifica o computador. O servidor rejeita eventos de domínio fornecidos pela máquina:
a renovação aceita os quatro sinais e um delta de texto limitado, publicado pelo próprio servidor.

Refinamento: o app renova a cada 1 s enquanto executa para observar Parar por polling. Falha de
renovação interrompe o executor. Lease vencido não pode ser renovado nem antes de o varredor passar.
O inventário reflete os Macs conectados, e o servidor não inicia executor. O modo de desenvolvimento
in-process permanece. Usa-se uma instância do servidor enquanto conexões e tokens vivem em memória.

Para evitar `--resume` de uma sessão existente só em outro computador, o modo compartilhado
reconstrói o contexto a partir do histórico do servidor. Afinidade de sessão por máquina fica para
outra etapa. Assinatura e disponibilização: [guia da release](../release-desktop.md).

## Emenda de 2026-10-08 — anúncio só de inventário (NOD-199)

**Contexto.** Desde a NOD-171/NOD-178 a vigia do Mac reanuncia as IAs quando algo muda (login no Codex, CLI
atualizado, IA reprovada que volta). O reanúncio ia pelo `conectar`, que não aceita turno em andamento: com plano puxado
há menos de 90 s respondia `estado_invalido` (o anúncio se perdia); depois de 90 s limpava `planos` e a entrega do turno
que ainda rodava deixava de casar. Com as duas IAs prontas a vigia não tentava de novo, e o Codex só aparecia ao
reabrir o app.

**Decisão.**
- Sexta rota da máquina, `POST /api/maquina/inventario`, com a mesma chave, o mesmo bloqueio de Origin e o mesmo piso
  de versão (426) das outras. Exige conexão viva desta chave: sem ela, 409 (`reconectar`), e o app volta ao `conectar`.
- Ela lê o anúncio pela mesma função do `conectar` (`lerAnuncio`: só harness integrado, `semLacoDeVoz` só de harness
  pronto no anúncio, capacidades validadas, gh) e troca inventário, harnesses, gh e capacidades da conexão. Persiste e
  repete as falas barradas como o `conectar`. **Nunca** toca em `planos`, `puxando` nem `recebidas`: o turno em curso
  termina e entrega como antes. Nome, plataforma (ADR-090) e laço de voz vêm do último `conectar` e só mudam
  reabrindo o app.
- O `conectar` continua sendo o primeiro anúncio e a recuperação do `reconectar`; o contrato dele não mudou e apps
  antigos seguem funcionando.
- No app, `anunciarInventario` vai pela rota nova quando já conectado e grava o anúncio, para um `reconectar` depois
  não reanunciar o inventário velho. Servidor antigo (404 na rota nova): cai no `conectar` só sem turno puxado e ainda
  não entregue; com turno, falha e a vigia tenta de novo. **O app nunca limpa planos para anunciar.**
- Anúncio que falhou é tentado de novo no passo de 30 s da vigia, mesmo com todas as IAs prontas.
- O motor sem janela (ADR-090) usa a mesma vigia e reanuncia pelo mesmo `anunciarInventario` que o app do Mac.

**Gatilho de reversão.** Se a rota de inventário e o `conectar` divergirem (um campo novo do anúncio lido só em um),
fundir as duas leituras de volta é trocar `lerAnuncio` — o teste parametrizado das duas rotas pega a divergência.
