# Runbook de produção: restaurar o banco e investigar incidentes

O que fazer quando o banco de produção (`nod-pg`, Cloud SQL, projeto `nod-exemplos`) precisa voltar
a um estado anterior, e como provar de tempos em tempos que isso funciona (NOD-205). A montagem e o
deploy estão em [deploy-gcp.md](deploy-gcp.md).

Regra geral: **restaurar nunca sobrescreve a instância atual**. Toda restauração cria outra instância
(ou enche um banco vazio) e o nod passa a apontar para ela; a `nod-pg` antiga fica intacta até alguém
decidir apagá-la.

Para investigar um incidente pelos logs (Cloud Logging, `journalctl` do motor), vá à
[seção 8](#8-investigar-um-incidente-onde-estão-os-logs).

## 1. PITR e troca de SQL_IP (caminho principal)

O `nod-pg` tem backup diário e PITR de 7 dias. Para voltar a um instante dentro dessa janela:

```bash
# 1. Clone no instante (UTC). NÃO use o prefixo nod-pg-ensaio-: o ensaio apaga essas cópias.
gcloud sql instances clone nod-pg nod-pg-restaurada-AAAAMMDD \
  --point-in-time='2026-10-02T12:00:00Z' --project=nod-exemplos
# 2. IP privado da instância nova
gcloud sql instances describe nod-pg-restaurada-AAAAMMDD \
  --format='value(ipAddresses[0].ipAddress)' --project=nod-exemplos
```

3. No secret `NOD_CONFIG_PRIVADA` do environment `producao` (NOD-485, ADR-161), troque `SQL_IP` pelo IP novo e
   `SQL_INSTANCIA` pelo nome novo (acrescente a linha se ela não estiver lá). NÃO edite o
   [`infra/gcp/config.env`](../infra/gcp/config.env): ele é público, traz valores de exemplo e o
   `scripts/ci/config-producao.ts` acrescenta o secret depois dele (a última linha vence). O `vm/deploy.sh` monta
   `DATABASE_URL` e `DATABASE_URL_DONO` a partir de `SQL_IP`.
4. Actions → deploy → Run workflow (na `main`): o deploy leva o `config.env` com o secret para a VM e troca a cor
   (azul/verde, sem queda). Na VM, confira `grep '^SQL_IP=' /opt/nod/config.env | tail -1` antes de seguir.
5. Confira `https://<domínio>/api/saude` (a saúde inclui o banco) e entre no nod.
6. Na instância nova, confira que a proteção contra exclusão e os backups com PITR estão ligados
   (`gcloud sql instances describe … --format='value(settings.deletionProtectionEnabled,settings.backupConfiguration)'`);
   se não estiverem, `gcloud sql instances patch … --deletion-protection --enable-point-in-time-recovery`.

O que se perde: tudo o que foi escrito no `nod-pg` depois do instante escolhido. Os usuários e as
senhas dos papéis (`nod_dono`, `nod_app`, `nod_poda`) vêm junto no clone, então os segredos não mudam.
O clone de 10 GB leva minutos; o tempo real fica registrado na tabela de ensaios abaixo.

## 2. Plano B: pg_dump e restaurar.sh

Quando o PITR não serve (instante fora dos 7 dias, ou instância perdida), restaure um dump no formato
custom (`pg_dump -Fc`) num banco **vazio**: o [`vm/restaurar.sh`](../infra/gcp/vm/restaurar.sh) recusa
banco com tabelas.

1. Banco vazio: uma instância nova (`SQL_INSTANCIA` e `SQL_IP` novos no `config.env` local, sem commit, e no secret
   `NOD_CONFIG_PRIVADA` para o deploy, como no passo 3 acima; criada pelo
   `provisionar.sh`) e depois `infra/gcp/preparar-banco.sh` (papéis, banco `nod`, extensões).
2. Leve o dump e rode na VM, como o [`levar-dados.sh`](../infra/gcp/levar-dados.sh) faz:

   ```bash
   gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-exemplos --command='mkdir -p ~/nod-tmp'
   gcloud compute scp infra/gcp/config.env infra/gcp/vm/restaurar.sh nod.dump nod-vm:~/nod-tmp/ \
     --zone=southamerica-east1-b --tunnel-through-iap --project=nod-exemplos
   gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-exemplos \
     --command='sudo bash ~/nod-tmp/restaurar.sh ~/nod-tmp/nod.dump; rm -rf ~/nod-tmp'
   ```

3. O `restaurar.sh` imprime migrações, pessoas e linhas no fim. Depois, deploy como no passo 4 da seção 1
   (o deploy aplica as migrações que faltarem por cima).

## 3. Segredos

Ficam no Secret Manager do `nod-exemplos`; o `vm/deploy.sh` os lê a cada deploy. Uma restauração não
mexe neles.

| Segredo | O que é |
|---|---|
| `nod-credential-key` | `NOD_CREDENTIAL_KEY`, chave do cofre de credenciais (ADR-015, ADR-031). Sem ela, as credenciais gravadas no banco não abrem: um banco restaurado só serve com a mesma chave |
| `nod-sessao-segredo` | Assinatura das sessões |
| `nod-google-client-id`, `nod-google-client-secret` | Cliente OAuth do login Google |
| `nod-pg-senha-postgres`, `nod-pg-senha-dono`, `nod-pg-senha-app` | Senhas dos papéis do banco |
| `nod-anthropic-revisor` | `NOD_REVISOR_CHAVE`, chave da API do revisor do Automático (ADR-115); só lida com `NOD_REVISOR=ligado` |
| `nod-resend-api-key` | `NOD_RESEND_API_KEY`, chave do Resend (só de envio) do login por e-mail (ADR-124 §6, NOD-406); só lida com `NOD_CONTAS=1` |

Nunca imprima um segredo: passe por variável de ambiente (`-e PGPASSWORD`), nunca por `echo`.

## 4. Migração só de adição

Voltar o código não volta o banco. Por isso toda migração nova só adiciona (NOD-186): o código anterior
continua funcionando sobre o esquema novo, e um rollback de código não pede restauração. A regra é
travada por `npm run fence:migrations` (no `check` e no CI); as exceções e o `-- ROLLBACK:` estão no
[AGENTS.md](../AGENTS.md). Restaurar o banco é para perda ou estrago de dados, não para desfazer deploy.

## 5. Como rodar o ensaio

O ensaio prova que o PITR funciona: clona o `nod-pg` numa cópia `nod-pg-ensaio-<run_id>`, compara
produção e cópia na `nod-vm` e **sempre** apaga a cópia. Script em
[`infra/gcp/ensaiar-restauracao.sh`](../infra/gcp/ensaiar-restauracao.sh), workflow em
[`.github/workflows/ensaio-restauracao.yml`](../.github/workflows/ensaio-restauracao.yml).

Uma vez, por alguém com papel de dono do projeto:

1. `infra/gcp/provisionar.sh` (idempotente) cria a conta `nod-ensaio` e os papéis `nodEnsaioLeitura`
   (ler, clonar, criar) e `nodEnsaioApagar` (alterar e apagar só instâncias `nod-pg-ensaio-*`, por
   condição IAM). A conta de deploy continua sem poder apagar instância.
2. No GitHub, a variável de repositório `GCP_ENSAIO_SA` recebe o e-mail impresso no fim.

A cada ensaio: Actions → **ensaio-restauracao** → Run workflow, **na branch `main`** (o WIF só aceita
`main`). O campo `instante` é opcional (ISO em UTC, ex. `2026-10-09T12:00:00Z`); vazio restaura o
estado mais recente.

O que o ensaio confere, e falha se não bater:

- a lista de `schema_migrations` (quantidade e md5 dos nomes em ordem);
- a contagem de `pessoas` (por `count(*)` como `nod_dono`; se a RLS esconder as linhas, por
  `n_live_tup`, e o resumo diz qual método foi usado);
- o número de tabelas em `public`.

Produção com zero em qualquer um desses falha: comparação vazia não conta. O total de linhas
(`pg_stat_user_tables`, depois de `analyze`) é só informativo, porque a produção segue recebendo
escritas durante o clone. O resultado sai no resumo do run.

Para ver o roteiro sem tocar na GCP: `infra/gcp/ensaiar-restauracao.sh --simular`. Se um run morrer
antes de apagar a cópia: `infra/gcp/ensaiar-restauracao.sh apagar --copia nod-pg-ensaio-<run_id>`
(recusa qualquer nome fora do prefixo).

Faça um ensaio no lançamento e depois a cada mudança relevante de infraestrutura.

## 6. Ensaios realizados

Preencha uma linha por ensaio com os números do resumo do run.

| Data | Instante | Duração do clone | Migrações | Pessoas | Tabelas | Linhas | Bateu | Run |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## 7. Monitor externo e reinício automático

Definido na NOD-267 (ADR-017, refinamento de 2026-10-15).

**O que reinicia sozinho.** No modo compartilhado, o watchdog dentro do processo roda a verificação de saúde a cada
15 s. Com 4 falhas seguidas (~1 min) ele loga `watchdog_reiniciando {motivo, falhas}` e sai com código 1; o Docker
(`restart: unless-stopped`) sobe o processo de novo. A verificação falha quando o `select 1` passa de 2 s ou dá erro,
ou quando o agendador ou o varredor de lease ficam mais de 3 intervalos (no mínimo 60 s) sem terminar um tick (pool
esgotado, tick pendurado), ou quando o próprio boot passa de 90 s sem terminar. Nos primeiros 90 s do processo e
durante a drenagem do deploy ele não age.

Logs para procurar no Cloud Logging: `saude_falhou` (com o `motivo`), `watchdog_falha`, `watchdog_reiniciando`,
`laco_tick_lento` e `varredor_lease_tick_falhou`. Como consultar: [seção 8](#8-investigar-um-incidente-onde-estão-os-logs).

**O que avisa uma pessoa: o monitor externo.** Se o processo reinicia em laço, ou a VM cai, o watchdog não resolve.
O cadastro é manual e fica com o dono da conta (não faz parte da NOD-267):

1. No UptimeRobot, *New monitor* → tipo **HTTP(s)**, URL `https://203-0-113-100.sslip.io/api/saude`.
2. Intervalo de **1 min**; alerta só depois de **2 falhas seguidas** (evita aviso por um deploy).
3. Contato de alerta: e-mail do Marlon.
4. Status esperado: 200. Qualquer outro (o 503 `{ok:false}` incluso) é queda.

**Como testar o monitor.** Pare a cor ativa por 3 min (`sudo docker compose --env-file /opt/nod/imagens.env -f /opt/nod/compose.yml stop nod-$(cat /opt/nod/estado/cor-ativa)`),
confira que o e-mail chegou depois da 2ª falha e suba de novo (`... start nod-<cor>`). Para ver o watchdog agir sem derrubar a VM,
os testes `tests/concurrency/watchdog-boot.test.ts` e `tests/integration/servidor-saude.test.ts` (pool esgotado)
reproduzem o tick travado e o pool esgotado.

## 8. Investigar um incidente: onde estão os logs

Definido na NOD-387. Os logs do app **não somem no deploy**: as duas cores e o Caddy mandam tudo para o Cloud Logging
(driver `gcplogs` no `compose.yml`, com a primeira entrada em 2026-10-03 01:55 UTC), que guarda 30 dias no bucket `_Default`, fora do disco da VM.

**`docker logs` só vê o contêiner atual.** Ele (e o `docker compose logs`) lê o cache local de cada contêiner que
ainda existe: perde tudo quando o deploy recria a cor, nunca mostra os `run --rm` do deploy e é truncado pelo tamanho.
Foi assim que o diagnóstico da NOD-362 concluiu, errado, que a janela das 13h de Brasília (16h UTC) de 23/10 tinha se
perdido. Não use o `docker logs` para histórico.

1. Anote a janela do incidente em UTC (Brasília é UTC−3).
2. Leia tudo da janela, em ordem, de qualquer cor (não precisa entrar na VM). A saída traz `pessoa_id`, `tenant_id` e
   erros crus: vai num arquivo só seu, que você apaga ao terminar e não anexa inteiro a issue ou PR. Se bater no
   `--limit`, estreite a janela.
   ```bash
   L='logName="projects/nod-exemplos/logs/gcplogs-docker-driver"'
   f="$(mktemp /tmp/incidente.XXXXXX)"   # 0600, só seu
   gcloud logging read "$L AND timestamp>=\"2026-10-23T16:00:00Z\" AND timestamp<=\"2026-10-23T16:35:00Z\"" \
     --project=nod-exemplos --order=asc --limit=20000 \
     --format='value(timestamp,jsonPayload.container.name,jsonPayload.message)' > "$f"
   # ao terminar: rm -f "$f"
   ```
3. Afine por evento, cor ou nível, somando ao filtro:
   - evento: `AND jsonPayload.message:\"watchdog_reiniciando\"` (ou `tx_longa`, `saude_falhou`, um `turno_id`);
   - cor: `AND jsonPayload.container.name:\"nod-azul\"` (ou `\"nod-verde\"`, `\"caddy\"`). O trecho pega o contêiner da
     cor (`/nod-nod-azul-1`) e os `run --rm` do deploy (`/nod-nod-azul-run-<id>`: migração, `ligacoes-orfas`, aviso de
     credenciais). Antes de 2026-10-23 havia uma cor só, `/nod-nod-1` e `/nod-nod-run-<id>` (some da retenção perto de 22/11):
     `AND jsonPayload.container.name:\"/nod-nod-1\"`;
   - nível: `AND jsonPayload.message:\"\\\"nivel\\\":\\\"erro\\\"\"` (as barras são do shell, dentro das aspas duplas).
4. Sem saber a janela, use `--freshness` em vez de `timestamp`, do mais novo ao mais velho (o padrão é `1d`; com
   `timestamp` no filtro ou com `--order=asc` ele é ignorado):
   `gcloud logging read "$L AND jsonPayload.message:\"tx_longa\"" --project=nod-exemplos --freshness=7d --limit=50 --format='value(timestamp,jsonPayload.container.name,jsonPayload.message)'`.
5. O motor (`nod-motor`) roda na VM do motor da pessoa e não está no Cloud Logging. Lá, com o sufixo `UTC` para não
   depender do fuso da VM: `sudo journalctl -u nod-motor --since "2026-10-23 16:00 UTC" --until "2026-10-23 16:35 UTC"`
   e `sudo journalctl -u nod-motor-atualizar` para as atualizações.

Os mesmos exemplos, com o "como o filtro funciona", estão em [deploy-gcp.md](deploy-gcp.md#logs).

## Rollback de código: definido na NOD-173
