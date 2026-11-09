# Ambiente local persistente e bancos de feature

Há dois regimes de banco local. Eles são deliberadamente diferentes para que um teste de feature
não consiga apagar o Nod usado no dia a dia.

## Resumo operacional — leia primeiro

### Começar um dia normal

1. Ligue o Mac e espere o Docker Desktop ficar pronto. Ele inicia `nod-postgres` automaticamente.
2. Abra um terminal e execute:

```bash
cd ~/code/nod
docker compose ps
NOD_LOGIN=stub npm run dev
```

3. Em `docker compose ps`, confirme `nod-postgres`, estado `healthy` e a porta
   `127.0.0.1:5434->5432`.
4. Abra `http://127.0.0.1:5274` e confirme o selo verde **Persistente · DB 5434**.
5. No fim do dia, encerre web e API com `Ctrl+C`. Pode desligar o Mac sem parar o Postgres.

Para o Nod que fica aberto o dia todo, prefira o modo build (`npm run diario:prod`, seção
[Modo build para o diário](#modo-build-para-o-diário)): ele gasta menos processador e memória que o
`npm run dev`, mas a página passa a abrir em `http://127.0.0.1:8888`.

Se o Postgres não estiver saudável, execute `npm run docker:up` e confira novamente. Não rode
`docker:reset`, `docker compose down -v` nem remova `nod_nod_pgdata` para tentar corrigir uma falha:
esses comandos apagam o banco diário.

### Criar um ambiente descartável para uma feature

```bash
cd ~/code/nod
npm run db:efemero:up -- nome-da-feature 5435
```

Use as variáveis impressas pelo comando e execute essa cópia do Nod com API e web em portas
diferentes, por exemplo `8889` e `5275`. A interface deve mostrar o selo âmbar **Efêmero · DB 5435**.
Ao terminar:

```bash
npm run db:efemero:down -- nome-da-feature 5435
```

Esse `down` remove somente o banco efêmero nomeado. O banco diário continua na porta `5434`.

### Atualizar o Nod diário — web, API e banco

Web e API vêm do mesmo código e são atualizadas juntas ao trocar a tag Git. O Postgres continua no
mesmo volume; apenas as migrações pendentes são aplicadas. Execute a atualização com o servidor Nod
parado, mas com o Postgres disponível.

1. Encerre `npm run dev` com `Ctrl+C`.
2. Confirme que não há trabalho local a perder:

```bash
cd ~/code/nod
git status --short
```

Se aparecer qualquer arquivo, pare a atualização. Não descarte, sobrescreva nem faça stash automático;
primeiro conclua ou registre essas alterações.

3. Inicie o Postgres e crie um backup validado **antes** de trocar código ou migrar:

```bash
npm run docker:up
npm run db:backup
```

Guarde o caminho impresso pelo backup. O arquivo deve existir em `backups/local/` e ter tamanho maior
que zero.

4. Busque as tags e selecione exatamente a versão desejada. Nunca presuma qual é a tag mais nova:

```bash
git fetch --tags
VERSAO_NOD=v0.2.1
git switch --detach "$VERSAO_NOD"
npm ci
```

5. Atualize o schema dos bancos persistentes e o seed:

```bash
npm run db:migrate
npm run db:migrate:test
npm run db:seed
```

As migrações são incrementais: uma migração já registrada não é aplicada novamente. O volume
`nod_nod_pgdata` não deve ser recriado durante uma atualização.

6. Valide a versão e inicie web e API:

```bash
npm run check
NOD_LOGIN=stub npm run dev
```

7. Abra `http://127.0.0.1:5274` e confirme o selo **Persistente · DB 5434**, login, conversas
   existentes e envio de uma mensagem. Web, API e banco estarão então na nova versão.

Se a falha ocorrer antes das migrações, corrija a instalação ou retorne ao código anterior. Se uma
migração já tiver sido aplicada, não faça downgrade cego: voltar a tag não reverte o schema. Pare o
Nod, preserve o banco e o backup e use uma migração corretiva ou restaure o backup em outro banco
para validar a recuperação antes de substituir o banco diário.

## Modo build para o diário

O `npm run dev` é o modo de quem desenvolve: sobe a API pelo `tsx` e a web pelo Vite, que vigia os
arquivos e recompila a cada edição. Para o Nod que fica aberto o dia todo, isso gasta processador e
memória sem necessidade, e qualquer edição na mesma pasta recarrega a página (medido em 09/10/2026,
issue #218).

O modo build gera a web uma vez e sobe só a API, que serve a página pela própria porta:

```bash
cd ~/code/nod
NOD_LOGIN=stub npm run diario:prod
```

O comando roda `npm run build` (gera `dist/web`) e depois `node src/adapters/http/server.ts` com
`NOD_STATIC_DIR=dist/web`. Abra `http://127.0.0.1:8888`, não a 5274: no modo build não há Vite. O
selo **Persistente · DB 5434** e o login continuam iguais. Encerre com `Ctrl+C`, como no modo dev; a
API espera os turnos em andamento terminarem antes de sair.

Depois de trocar de versão (passo 4 da atualização acima), rode `npm run diario:prod` de novo: o
build é refeito a cada início. Se o build falhar, a API não sobe e a versão anterior não fica
servida. Com login Google, cadastre também `http://127.0.0.1:8888/api/sessao/google/callback` e
aponte `NOD_GOOGLE_REDIRECT_URI` para ele.

Quem desenvolve continua com `npm run dev` (web 5274, API 8888). Os dois modos usam a porta 8888 da
API: rode um de cada vez.

## Bancos de teste órfãos

Fora do CI, cada worktree que roda os testes de integração cria o próprio banco
`nod_test_<hash do caminho>` no Postgres que o `DATABASE_URL_DONO` aponta (veja
`tests/setup/banco-por-worktree.ts`). Quando a worktree é apagada, o banco fica. Em 09/10/2026 o
`nod-postgres` tinha cerca de 140 desses bancos (~1,8 GB) contra 183 MB do `nod`.

O `npm run db:test:limpar` apaga os bancos `nod_test_<hash>` cuja worktree não existe mais. Ele lê o
caminho gravado no comentário de cada banco, nunca toca em `nod` nem em `nod_test`, mantém os bancos
sem comentário e não derruba conexões: um banco em uso é relatado e fica. Ele roda sozinho no fim do
`npm run check`, quando todos os testes passaram. Para rodar à mão:

```bash
npm run db:test:limpar
```

O comando usa o `DATABASE_URL_DONO` do ambiente ou do `.env`. Numa worktree com banco efêmero, ele
limpa só o efêmero.

## Nod diário: persistente, porta 5434

O `docker-compose.yml` principal publica o Postgres somente em `127.0.0.1:5434` e guarda os dados no
volume Docker nomeado `nod_nod_pgdata` (nome lógico `nod_pgdata`). O container se chama
`nod-postgres` e usa `restart: unless-stopped`: depois de reiniciar o computador, ele volta quando o
Docker Desktop iniciar. Desligar o computador, reiniciar o Docker, atualizar a imagem ou executar
`npm run docker:down` não apaga esse volume.

Primeira instalação:

```bash
cp .env.example .env       # apenas na primeira instalação; não sobrescreva um .env existente
npm ci
npm run docker:up
npm run db:migrate
npm run db:migrate:test
npm run db:seed
npm run db:backup
NOD_LOGIN=stub npm run dev
```

Abra `http://127.0.0.1:5274`. A API fica em `127.0.0.1:8888` e o Postgres persistente em
`127.0.0.1:5434`.

Comandos seguros para o banco diário:

```bash
npm run docker:up          # inicia ou reutiliza o mesmo volume
npm run docker:down        # para; mantém os dados
npm run db:backup          # grava backups/local/nod-<data>.dump fora do volume
```

`npm run docker:reset` executa `docker compose down -v`: ele apaga o volume e todos os dados do Nod
diário. Use-o somente quando a perda total for intencional. `docker volume rm nod_nod_pgdata` tem o
mesmo efeito destrutivo.

O procedimento completo para atualizar web, API e banco está no resumo operacional no início deste
arquivo.

## Feature: efêmero, outra porta

Cada banco de feature usa `docker-compose.efemero.yml`, um projeto Compose próprio e armazenamento
`tmpfs`. Ele nunca monta `nod_nod_pgdata`. O exemplo abaixo cria um banco descartável na porta
`5435`, aplica as migrações e executa o seed:

```bash
npm run db:efemero:up -- acesso-novo 5435
```

O comando imprime as variáveis de conexão e `NOD_BANCO_AMBIENTE=efemero`. Exporte-as no terminal da
feature e escolha portas livres também para a API e a web:

```bash
export NOD_BANCO_AMBIENTE=efemero
export DATABASE_URL=postgres://nod_app:nod@127.0.0.1:5435/nod
export DATABASE_URL_DONO=postgres://nod_dono:nod@127.0.0.1:5435/nod
export DATABASE_URL_TEST=postgres://nod_app:nod@127.0.0.1:5435/nod_test
export NOD_API_PORT=8889
export NOD_WEB_PORT=5275
NOD_LOGIN=stub npm run dev
```

Assim, o Nod diário continua em web `5274`, API `8888` e Postgres `5434`; a feature do exemplo usa
web `5275`, API `8889` e Postgres `5435`.

Para consultar ou remover o banco descartável:

```bash
npm run db:efemero:status -- acesso-novo 5435
npm run db:efemero:down -- acesso-novo 5435
```

O `down` efêmero remove apenas o projeto `nod-efemero-acesso-novo`. Como os dados ficam em `tmpfs`,
eles também somem se o container for removido. Use outro nome e outra porta para manter mais de uma
feature simultaneamente.
