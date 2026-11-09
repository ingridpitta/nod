# ADR-139 — A rotina também roda quando um serviço avisa (webhook)

Status: aceita (2026-10-30, NOD-84) · Estende [ADR-043](adr-043-ciclo-de-vida-de-rotinas-pelo-agente.md) e [ADR-011](adr-011-travas-de-execucao-janela-de-rotina-unica-expiracao-idem.md);
emenda [ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (o turno de webhook nasce não confiável, uma
exceção explícita ao "sem rotina desconfiada pela fonte").

## Contexto

As rotinas só rodavam por horário. A NOD-84 pede que o bot reaja na hora a um evento de fora (o Stripe recebeu, o
GitHub abriu um PR): o bot cria a rotina pela conversa, a pessoa cola um endereço no provedor e cada chamada vira uma
execução. O endereço é uma credencial (quem o tem dispara o bot), e o payload é texto de terceiros.

## Decisão

1. **O webhook é uma rotina com `gatilho = 'webhook'`** (0130): mesma tabela, mesmos casos de uso, mesmo
   `dispararRotina`, mesmo UNIQUE da janela (ADR-011, com `instanteAgendado = agora`). O `cron` fica `NOT NULL` com uma
   sentinela e `proxima_execucao` em 9999-01-01; quem decide é `gatilho`, e o agendador e a agenda filtram
   `gatilho = 'horario'`. Mudar o cron de uma rotina webhook é recusado. Só o modo compartilhado recebe webhook (o
   servidor do Mac não tem endereço público): no local, `criar_rotina` com `quando_webhook` devolve
   `webhook_so_compartilhado` (0131).
2. **O endereço é `/api/w/<token>`** (ou `POST /api/w` com `Authorization: Bearer`). Token `gt_` + base64url do escopo
   alegado + `.` + 32 bytes aleatórios; o banco guarda o SHA-256 (comparado em tempo constante) e o token cifrado
   (AES-GCM, `NOD_CREDENTIAL_KEY`) só para o Copiar. A busca roda na transação do escopo que o token alega (o padrão da
   chave de máquina, [ADR-031](adr-031-a-chave-de-maquina-persiste-carrega-o-proprio-escopo-e-e-rev.md)), sob RLS. Um gatilho vivo por rotina; "Gerar novo endereço" revoga o anterior na mesma
   transação; excluir a rotina revoga também. O GitHub assina com um **segredo HMAC separado** (vazar o endereço não
   basta para assinar); depois da primeira chamada assinada válida, a assinatura vira obrigatória.
3. **O bot nunca vê o endereço.** Ferramentas, eventos, mensagens e trilha levam só o mascarado (8 caracteres da metade
   aleatória + `…`). O inteiro sai só por `GET /rotinas/:id/endereco`, só à dona, com `no-store`, chamado pelo Copiar;
   ele nunca fica no estado nem no HTML da tela. Os logs mascaram `/w/<token>`.
4. **A rota pública barra antes do banco**: `Origin` presente → 403 (não é navegador); limites em memória por processo
   (por token, pelo segredo; por IP, com teto baixo para token malformado e alto para o bem formado, porque o GitHub e
   o Stripe saem de poucos IPs divididos entre tenants; por dona e global, que só contam as chamadas com o token provado
   no banco e que custam um turno — aceita ou bloqueada —, para que tokens forjados não esgotem o teto de todos nem uma
   dona com muitas rotinas esgote o das outras; o teto por IP bem formado só vale para o token, inteiro, ainda não
   provado neste processo, e o token sai dos provados no primeiro 401. Não há freio por "forjados": a dona alegada
   vem do próprio token, sem prova; o token desconhecido custa um SELECT sem trava. Risco assumido: quem forja ~600/min
   pelo IP de um provedor fecha esse IP, por um minuto, para todo token ainda não provado no processo — endereço novo,
   primeiro ping, todos logo depois de um deploy; o já provado segue) → 429; token malformado → 401; corpo acima de 256 KB → 413. O payload só é
   redigido e emoldurado depois de o token ser provado. Depois, no caso de uso:
   token desconhecido ou revogado, ou assinatura inválida no GitHub (ou em outro provedor depois que ele assinou com
   o nosso segredo; o que assina com a chave dele, como a Meta, segue só pelo endereço) → 401 (com a rotina identificada, o log diz
   **recusada**, no máximo uma vez por minuto enquanto ela for a mais nova: quem varia o segredo de um endereço antigo
   não enche o log nem a tela); pausada → 202 **pausada**;
   evento fora do filtro → 202 **ignorada** (o `ping` do GitHub aparece como "GitHub conectou"); id de entrega repetido
   (`X-GitHub-Delivery`, `Idempotency-Key`, `evt_` do Stripe) → 200 sem nova execução, pelo UNIQUE parcial; três turnos
   abertos da rotina → 429 com `Retry-After` (**fila_cheia**); senão 202 (**rodou**). O log guarda, por rotina, as 50
   chamadas mais novas ou as das últimas 72 h, e das recusadas só as 10 mais novas (quem martela com endereço errado
   não empurra as aceitas para fora); pausadas e ignoradas também entram no dedupe; bloqueadas e fila_cheia não (o reenvio roda quando a rotina andar). A janela do dedupe é a do log: um
   id de entrega reenviado depois de 72 h e fora das 50 mais novas roda de novo.
5. **O payload é dado, não instrução.** Os primeiros 16 KB entram emoldurados (`envolverNaoConfiavel`) e o turno nasce
   `nao_confiavel`: no manual, efeito externo pede aprovação, como depois de ler qualquer conteúdo de fora. É a emenda
   à ADR-066: a fonte de um webhook é sempre de fora, então a rotina por webhook é a única que nasce desconfiada.
   Nesse turno, e nas retomadas dele, criar ou mudar rotina (o que grava instrução) vira card mesmo no Automático e
   no Total: o payload chega sozinho, sem a dona olhando. A redação dos segredos (`gt_`, `ghs_`, o próprio segredo da chamada) roda só na janela
   de 16 KB mais uma margem, para que um corpo adversarial de 256 KB não custe CPU.
6. **"Enviar teste"** roda um turno de verdade com um payload de exemplo (`teste: true`, "não lance nada"), etiqueta
   **teste** e a chamada **teste** no log; ignora o filtro de evento, mas respeita a pausa (409) e a fila cheia (429).
7. **A tela** (web/telas/webhook.ts, o ponto de troca do componente comum da NOD-399): endereço mascarado com Copiar
   no card confirmado e na gaveta do bot, "Copiar segredo" só no GitHub, "Gerar novo endereço" que confirma no lugar,
   Últimas chamadas com o desfecho escrito, o "!" de 13 px em `--danger` na recusada e na lista enquanto a última
   recusada for mais nova que a última aceita, e a etiqueta webhook/teste na resposta. As ações
   `rotinas.gerar_endereco` e `rotinas.enviar_teste` entram no registro (ADR-135) como `falta`, na onda da NOD-393,
   como as irmãs de rotina.

## Consequências

- Os limites por IP e global são por processo: com mais de uma réplica, o teto efetivo multiplica. O limite que segura
  custo é o de três turnos abertos, que está no banco.
- Sem id de entrega não há dedupe; quem segura repetição é a fila cheia.
- O GitHub não reenvia sozinho uma entrega que voltou 429: o evento perdido fica no log como **fila_cheia**, que a dona
  vê nas Últimas chamadas (e pode reenviar pela tela de entregas do GitHub). Stripe e a maioria dos provedores
  reenviam com recuo. O 429 dos limites em memória volta antes do banco e não entra no log (por isso o teto por IP do
  token bem formado é alto); o firme é o de 3 abertos, que fica no log.
- Restaurar uma rotina excluída não traz o endereço de volta: gera-se outro.
- O ROLLBACK da 0130 pausa e exclui as rotinas webhook antes de soltar a coluna, para que nenhuma vire rotina de
  horário com o cron sentinela.
- `Stripe-Signature` não é verificada nesta etapa (o endereço secreto basta); o HMAC é só o do GitHub.

## Gatilho de reversão

Se um provedor exigir verificação própria de assinatura que o endereço secreto não cubra, ou se os limites em memória
deixarem passar abuso com várias réplicas, os limites vão para o banco e a verificação vira por provedor.
