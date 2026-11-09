# ADR-121 — Caminho B: o nod liga, desliga e (no PR 2) cria a VM na conta de nuvem da pessoa

Status: aceita · Data: 2026-10-22 · NOD-92 (PR 1: dormir e acordar uma VM do Google que a pessoa já tem). Estende a
ADR-090 (a VM é uma máquina como as outras) e emenda o item 6 dela. Mantém a ADR-021 (o servidor chama a API do Google,
nunca disca para a VM) e a ADR-037 (o computador continua com a NOD-96). Plano: comentário "Plano de engenharia" do
Arquiteto na NOD-92.

## Contexto

Quem não tem uma VM sempre ligada fica sem rotina quando o Mac dorme. Quem tem paga 24 h: a `nod-motor-teste`
(`e2-standard-8`) fica ligada mesmo com os bots parados. A ADR-090 já previa "A primeiro, B em breve, C fora". O Marlon
decidiu pelo caminho B: a VM fica na conta Google Cloud da pessoa, o custo é dela, e o nod a liga e desliga pela API do
Google. Criar a VM é o PR 2; custo e ajuste fino do sono, o PR 3.

## Decisão

1. **A unidade é a máquina que já existe.** A VM é uma `maquina_tokens` comum (ADR-090 item 1). Ao lado fica uma linha
   em `maquinas_nuvem` (migração 0107) com projeto, zona, nome, `estado` (o que o nod acha) e `desejado` (o que os
   gatilhos pedem). Turno, `alvoDoTurno`, ponte e motor não mudam.
2. **Estados.** `criando` (PR 2), `acordada`, `adormecendo`, `dormindo`, `acordando`, `falhou_ao_acordar` e `excluida`.
   `adormecendo` é interno: a tela mostra Dormindo. Motivos fechados (ADR-004): `credencial_nuvem`,
   `cota_ou_cobranca`, `sem_capacidade`, `motor_sem_contato` e `excluida`. Cada troca entra em `maquinas_nuvem_eventos`,
   que só acrescenta (`nod_app` sem UPDATE nem DELETE).
3. **Reconciliador com reserva fora da transação** (`src/adapters/fundo/reconciliador-nuvem.ts`). Uma volta a cada
   15 s, por pessoa (`paraCadaPessoa`):
   - transação 1: os gatilhos pedem acordar e as ociosas tentam dormir;
   - transação 2: reserva cada máquina com trabalho (`operacao_id`, `ocupado_ate` de 2 min, UPDATE condicional);
   - fora da transação: chama o Google e grava o resultado só se `operacao_id` ainda é o dele (`concluir`), ou solta.

   Uma operação por máquina de cada vez. Uma resposta atrasada não apaga estado mais novo. Erro transitório (rede, 429,
   5xx) solta a reserva e a próxima volta tenta de novo. A regra do passo é pura (`proximoPasso`, em
   `src/domain/maquina-nuvem.ts`):
   - o start só sai depois de o Google dizer `parada` (com `parando`, espera);
   - `acordando` vira `acordada` quando o motor fala com o servidor depois de `ligou_em`;
   - 3 min sem contato: reinicia uma vez; 6 min: `falhou_ao_acordar` com `motor_sem_contato`;
   - `sem_capacidade` continua `acordando`, com nova tentativa em 5 min;
   - instância `inexistente` vira `excluida`;
   - falhar ao desligar volta a máquina para `acordada`, e o relógio do sono recomeça.
4. **Dormir sob a trava da pessoa, a mesma do `reivindicar`.** `tentarDormir` toma
   `pg_advisory_xact_lock(hashtext('<tenant>:<pessoa>'))` e reconfere tudo lá dentro:
   - nenhuma reserva viva;
   - nenhum turno `despachando` nela;
   - nenhum turno pendente com alvo nela, nem sem alvo (com volta marcada até 15 min);
   - nenhuma rotina ativa com alvo nela (bot ou máquina padrão) nos próximos 15 min;
   - ociosa há `dormir_apos_min` (15, 30, 60 ou 120; padrão 30; nulo = Nunca dormir), contado do mais recente entre
     `ultima_atividade_em` e `estado_desde`. `ultima_atividade_em` muda quando a máquina reivindica um turno e, a cada
     volta do reconciliador, enquanto há turno `despachando` nela; o polling da chave (`ultimo_uso_em`) não conta como
     atividade, senão a VM nunca dormiria (revisão da NOD-92, B1).

   Passando, grava `adormecendo` e o desligar sai depois do commit. "Dormir agora" pula só a ociosidade; com trabalho, o
   409 diz o motivo. O `reivindicar` ganha um filtro: máquina em `adormecendo`, `dormindo` ou `acordando` sem contato
   depois de `ligou_em` não pega turno. O turno que chegou antes do sono a segura acordada; o que chega depois espera.
5. **Acordar.** Os gatilhos só gravam `desejado = 'acordada'`; o reconciliador liga.
   - Turno pendente com alvo nela (conversa, task, pedido de colega, rotina).
   - Rotina com alvo nela nos próximos 15 min.
   - Turno sem alvo: acorda UMA máquina da nuvem (a usada por último), só se nenhuma outra máquina da pessoa falou nos
     últimos 2 min e nenhuma já está acordando.
   - O botão Acordar (e Tentar de novo, que tira de `falhou_ao_acordar`).

   O trabalho mostra `acordando: true` em `ondeRoda` ("Acordando <máquina>…").
6. **Prazos suspensos enquanto ela dorme ou acorda** (`src/repositories/nuvem-relogio.ts`). Em `criando`,
   `adormecendo`, `dormindo` e `acordando`:
   - o órfão sem contato (24 h, NOD-314) e o fundo preso contam o contato dela como "agora";
   - a execução de rotina não vence (`execucaoVenceu` devolve falso), em vez de virar `interrompida` ou `nao_rodou`.

   Fora desses estados, o relógio inclui `estado_desde`: a máquina que falhou ao acordar dá o prazo inteiro a partir da
   falha. É a emenda do item 6 da ADR-090.
7. **Conectar a conta Google: OAuth no mesmo cliente do login.** `NOD_GOOGLE_CLIENT_ID`/`_SECRET`, com outro callback:
   `NOD_NUVEM_REDIRECT_URI` ou `NOD_URL_PUBLICA` + `/api/nuvem/google/callback`.
   - Escopo `https://www.googleapis.com/auth/cloud-platform`, `access_type=online`, `prompt=consent`.
   - PKCE S256 e `state` assinado como no login (`sessao-google.ts`), válido por 10 min.
   - Cookie `nod_nuvem`, `HttpOnly`, `SameSite=Lax`, `Path=/api/nuvem/google`.
   - O pedido pendente (escopo e verificador) fica só na memória.
   - **O token da pessoa nunca é gravado** nem vai ao log. Ele vive na memória durante o preparo, que roda em segundo
     plano depois do 302 para `/maquinas?nuvem=preparando`.
8. **O preparo** (`src/adapters/nuvem/conta-gcp.ts`) é idempotente: "já existe" (409) conta como sucesso.
   1. Projeto: o informado no conectar, senão o da credencial atual, senão cria `nod-<pessoa>-<4hex>`.
   2. Faturamento: lê o `billingInfo`. Desligado, vincula `NOD_NUVEM_CONTA_FATURAMENTO` ou a primeira conta aberta. Sem
      nenhuma, `cota_ou_cobranca` (`sem_faturamento`).
   3. Ativa `compute.googleapis.com` e `iam.googleapis.com`.
   4. Cria a rede `nod-maquinas` (modo auto). O nod não cria regra de firewall nela.
   5. **Uma conta de serviço por pessoa**: `nod-<hash8 da pessoa>@<projeto>`. Duas pessoas no mesmo projeto não somam
      permissões.
   6. **Papéis custom mínimos, com condição IAM por nome** (política versão 3):
      - `nodMaquinasGerenciar` (instances create/delete/get/start/stop/reset/setMetadata/setLabels e disks create/use):
        só instâncias e discos com nome que começa com `nod-g-`, em qualquer zona do projeto;
      - `nodMaquinasLigar` (instances get/start/stop/reset, sem delete): só o nome exato da VM conectada;
      - `nodMaquinasLer` (operações, sub-rede e imagem): só no projeto, na sub-rede `nod-maquinas` e em operações
        (`condicaoLerProjeto`). O `disks.use` saiu daqui para o papel com prefixo (revisão da NOD-92, B6).
   7. Cria a chave JSON da conta de serviço e guarda o nome dela (`credenciais_nuvem.chave_nome`). Depois de gravar a
      nova, apaga as outras chaves `USER_MANAGED` da conta de serviço (Reconectar não deixa a velha viva; falha ao
      apagar só registra `nuvem_chave_antiga_ficou`). Organização que bloqueia chave (412, `FAILED_PRECONDITION` ou a
      constraint `disableServiceAccountKeyCreation`) vira `credencial_nuvem` com `org_bloqueia_chave`.

   No conectar, o nod ainda confere que a instância existe (404 vira `excluida`), liga o `nodMaquinasLigar` ao nome
   exato e cria a linha `maquinas_nuvem` como `acordada`.
9. **A chave é cifrada e não sai.** A chave JSON vai cifrada com `cifrar()`/`NOD_CREDENTIAL_KEY` para
   `credenciais_nuvem.chave_cifrada`. A linha é privada (`visibility = 'privado'`), uma por pessoa e projeto. Ela é
   decifrada só no `compor.ts`, para montar o provedor. O adaptador (`src/adapters/nuvem/gcp.ts`) assina o JWT RS256 e
   guarda o token da conta de serviço só na memória, por 50 min. Chave e token nunca entram em log, mensagem de erro
   ou DTO: o erro leva só o motivo fechado, e `redigirCampos` mascara bloco PEM (com teste em
   `tests/unit/nuvem-gcp.test.ts`).
10. **A VM criada pelo nod nasce sem conta de serviço** (`serviceAccounts: []`, PR 2). Um bot dentro dela não fala com
    o Google pelo metadata.
11. **Atrás de `NOD_MAQUINA_NUVEM=gcp`, lida só no `compor.ts`.** Sem a flag: as rotas `nuvem/*` não existem (404), o
    reconciliador não sobe e `MaquinaDto` sai sem `nuvem`. Com ela, `DELETE maquinas/chaves/:id` dá 409 para a
    máquina da nuvem.
12. **Fora até a NOD-96:** "tela aberta" segurando o sono (`MotivoParaFicarAcordada`, hoje sempre falso), o acordar
    por ação de computador e o computador rodando dentro da VM. **Fora até os PRs 2 e 3:** criar, excluir, convite no
    metadata, custo e horas acordada.

## Desvios do plano do Arquiteto

1. O OAuth começa por `POST /nuvem/google`, que devolve `{url}`, e não por um GET com 302. Assim ele leva o corpo do
   conectar e o cookie `Strict` da sessão.
2. O conectar recebe projeto, zona e nome no início do OAuth. Não há tela que lista as instâncias.
3. Sem escolha de projeto nem de conta de cobrança na v1: usa o projeto informado ou cria um. O `billingInfo` é lido, e
   `NOD_NUVEM_CONTA_FATURAMENTO` é opcional.
4. O `PUT nuvem/maquinas/:id/dormir-apos` foi adiantado do PR 3.
5. O 409 "instância não listada" não existe. A pessoa digita projeto, zona e nome; um erro vira motivo na linha de
   falha.
6. O acordar sai na volta de 15 s do reconciliador, não na hora de enfileirar o turno.
7. Turno pendente sem alvo também segura o sono, e acorda a da nuvem se nenhuma outra máquina falou há menos de 2 min.
8. O "rótulo `nod`" do critério de aceite virou prefixo de nome `nod-g-` na condição IAM. A condição IAM da Compute não
   lê rótulo, só nome, tipo e tag.

## Ressalvas

- As expressões CEL com `extract` (`condicaoGerenciarProjeto`, `condicaoLerProjeto`) não foram testadas contra o IAM de
  verdade; o e2e no GCP espera a URI de OAuth.
- Reconectar apaga a chave velha; Revogar só apaga a linha no nod: a chave segue viva no Google até a pessoa apagar a
  conta de serviço (sem o token OAuth dela o nod não tem como apagar). Não há rotação.
- Projeto preparado antes desta revisão mantém o vínculo `nodMaquinasLer` sem condição até ser preparado de novo.
- Um papel que já existe (409) não tem as permissões atualizadas.
- O preparo do conectar também dá à conta de serviço o `nodMaquinasGerenciar` (prefixo `nod-g-`) e o `nodMaquinasLer`
  no projeto informado, não só o `nodMaquinasLigar` como dizia o plano.
- O filtro do `reivindicar` e a suspensão dos prazos leem `maquinas_nuvem` com ou sem a flag. Sem linhas, não mudam
  nada. Mas tirar a flag com uma máquina dormindo deixa a linha parada: os turnos dela esperam e o prazo de 24 h não
  corre. Antes de desligar, acordar as máquinas (`docs/deploy-gcp.md`).
- Emenda 2026-10-28 (NOD-96): o `infra/gcp/vm/deploy.sh` leva ao env da cor nova `NOD_MAQUINA_NUVEM` (do
  `config.env`, vazio por padrão), `NOD_NUVEM_REDIRECT_URI=https://<NOD_DOMINIO>/api/nuvem/google/callback` e
  `NOD_URL_PUBLICA=https://<NOD_DOMINIO>`. Ligar em produção é `NOD_MAQUINA_NUVEM=gcp` no `config.env` e um deploy,
  depois de cadastrar essa URI no cliente OAuth de `nod-exemplos`. Ligado em 2026-10-28 (NOD-92): o Marlon cadastrou a
  URI e o escopo `cloud-platform`, e o Google aceita a URI (sem `redirect_uri_mismatch`).
- O estado do preparo ("preparando", "falhou") e o pedido OAuth pendente ficam na memória: um deploy no meio perde os
  dois, e a pessoa conecta de novo.
- A rotina não vence enquanto espera. Quando a máquina acorda, vale de novo a regra de sempre, contada do instante
  agendado (o plano pedia contar a partir do acordar).
- O app OAuth não é verificado, e `cloud-platform` é escopo sensível: o Google mostra "app não verificado" e limita a
  100 pessoas novas. Aceito para o uso interno.
- O e2e real está pendente: falta cadastrar a URI de callback no cliente OAuth de `nod-exemplos`. Unit, integração e
  concorrência usam o provedor falso (`src/adapters/nuvem/falso.ts`).

## Alternativas rejeitadas

- **Caminho A sozinho (a VM da pessoa sempre ligada, ADR-090).** É o de hoje: paga 24 h com os bots parados, e quem
  não tem VM fica sem rotina quando o Mac dorme.
- **Caminho C (o nod hospeda e paga as máquinas).** Fora pela ADR-090: isolamento entre pessoas, operação 24 h e
  custo de máquina no nod.
- **Um agente na VM que se desliga sozinho quando fica ociosa.** Desligar até dá; acordar não, porque a VM parada não
  ouve nada. O servidor teria de ligá-la de qualquer jeito, e a VM decidiria o sono sem ver a fila nem as rotinas.
- **Cloud Scheduler ou horário fixo para ligar e desligar.** Não acorda por uma fala nem por um pedido de colega, e paga
  as janelas vazias.
- **Guardar o token OAuth da pessoa (`access_type=offline`).** Seria uma credencial de longa duração com o
  `cloud-platform` inteiro da pessoa. A conta de serviço por pessoa, com papel por nome, guarda bem menos.
- **Papel predefinido (`compute.instanceAdmin`).** Vale para todas as instâncias do projeto, inclusive as que não são
  do nod.
- **Federação de identidade sem chave (o projeto confia no nod como emissor OIDC).** Tira a chave de longa duração, mas
  pede mais configuração no projeto da pessoa. Fica para o gatilho abaixo.

## Gatilho de reversão

- **A trava falhou.** Um turno `despachando` numa máquina em `adormecendo` ou `dormindo`, visto em produção ou no
  teste de concorrência (`tests/concurrency/maquina-nuvem-corrida.test.ts`): tirar `NOD_MAQUINA_NUVEM` e reabrir o
  item 4.
- **O IAM não cerca.** No e2e real (PR 4), um stop numa instância fora do prefixo `nod-g-` e fora do nome conectado
  passar: tirar a flag e trocar a condição com `extract` por condições por zona (`condicaoGerenciar`) antes de religar.
- **Acordar não é confiável.** Em 14 dias com ao menos uma máquina conectada, mais de 1 em cada 5 idas a `acordando`
  terminar em `falhou_ao_acordar` (contado em `maquinas_nuvem_eventos`): a pessoa pagaria em espera o que economiza
  em máquina. Reabrir o sono padrão (Nunca dormir) e medir o motivo.
- **A chave não é viável.** Mais de 1 em cada 5 preparos em 14 dias falhar com `credencial_nuvem` (log
  `nuvem_preparo_falhou`) por organização que bloqueia chave (`org_bloqueia_chave`, visto em `GET nuvem/conta`): abrir
  issue para federação de identidade sem chave.
