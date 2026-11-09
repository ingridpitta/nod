# nod

**Seu time de bots, trabalhando.** Bots com função e memória que pegam a tarefa e devolvem pronta, no Claude ou no ChatGPT que você já assina. Quando algo precisa de uma decisão, o bot prepara e uma pessoa decide, com registro de quem decidiu e por quê.

Site: [nodbot.ai](https://nodbot.ai) · Comunidade: [Discord](https://discord.gg/nb9K82eKc9) · Licença: [Apache 2.0](LICENSE)

> English: nod is a workspace where AI agents prepare decisions and a person decides. The code and docs are in Brazilian Portuguese; issues and PRs in English are welcome.

## O que é

- **Bots como contatos.** Cada bot tem função, memória e um quadro de tarefas. Você conversa com ele como num chat.
- **Roda na sua IA.** O nod pilota o Claude Code ou o Codex já logados na sua máquina e nunca vê a sua credencial.
- **Você decide.** Ação com efeito externo (mandar um e-mail, mexer numa issue) vira um pedido de aprovação, e a trilha guarda quem aprovou.
- **Apps e rotinas.** Conectores MCP, rotinas por horário e conversa entre bots.

O nod é um servidor Node (TypeScript) com Postgres, uma web em TypeScript puro e um app desktop em Electron.

## Instalar o app

O jeito mais rápido de usar é o app: baixe em [nodbot.ai](https://nodbot.ai) (macOS e Windows, beta). Este repositório é para quem quer rodar o servidor, estudar o código ou contribuir.

## Rodar local

Você precisa de **git**, **Node 24.19.0** (versão exata; o [mise](https://mise.jdx.dev) instala a partir do `.mise.toml`) e **Postgres 16**, pelo Docker ou instalado na máquina. Não precisa de conta de IA: o executor padrão de desenvolvimento é o **catcher**, que responde sem modelo e sem custo.

### 1. Baixar e instalar

```bash passo=clonar
git clone https://github.com/marlonwlv/nod-oss.git nod
cd nod
```

Com o mise, ative-o no seu shell antes (`mise activate`, veja o [guia do mise](https://mise.jdx.dev/getting-started.html)): sem isso o `mise install` baixa o Node, mas o `npm` não o encontra.

```bash passo=instalar
mise trust && mise install
npm ci
cp .env.example .env
```

Sem o mise, instale o Node 24.19.0 de outro jeito (nvm, asdf, instalador oficial) e pule a primeira linha. O `.env.example` já vem pronto para desenvolvimento (`NOD_LOGIN=stub`, `NOD_EXECUTOR=catcher`, Postgres em `127.0.0.1:5434`).

### 2. Banco de dados

**Com Docker** (sobe o Postgres 16 em `127.0.0.1:5434`, cria os papéis e os bancos, migra e popula o seed):

```bash passo=banco-docker
npm run dev:setup
```

**Sem Docker**, com um Postgres 16 seu: rode o script de papéis como superusuário e depois as migrações e o seed. Se o seu Postgres não estiver na porta 5434, ajuste a porta abaixo e as três `DATABASE_URL*` do `.env`.

```bash passo=banco-proprio
psql "postgres://postgres@127.0.0.1:5434/postgres" -f infra/postgres/init/01_roles.sql
npm run db:migrate && npm run db:migrate:test && npm run db:seed
```

### 3. Subir

```bash passo=subir
NOD_LOGIN=stub npm run dev
```

Isso sobe a API em http://127.0.0.1:8888 e a web em http://127.0.0.1:5274. Abra a web e clique em **Entrar como** com uma das pessoas do seed. O login `stub` é só para desenvolvimento: não pede senha, e o servidor se recusa a escutar fora de `127.0.0.1`.

Em outro terminal, confira se está tudo de pé:

```bash passo=conferir
curl -fsS http://127.0.0.1:8888/api/saude
```

### Usar uma IA de verdade

Com o Claude Code instalado e logado, troque `NOD_EXECUTOR=catcher` por `NOD_EXECUTOR=auto` no `.env` (ou use o interruptor na tela). Cada turno passa a custar na sua assinatura. `npm run sonda` confere se o CLI responde.

### Problemas comuns

- **`npm ci` reclama da versão do Node:** a versão é exata (24.19.0). Com nvm ou asdf ativos no shell, eles ganham do mise.
- **Porta ocupada:** troque `NOD_API_PORT` e `NOD_WEB_PORT` no `.env`. A porta do Postgres do Docker é a 5434, de propósito.
- **`/api/saude` responde 503:** o servidor ainda está subindo ou não alcança o banco. Veja o log do `npm run dev`.

## Testar

```bash
npm run check   # lint, typecheck, cercas de arquitetura e as quatro suítes (unit, integration, conformidade, concurrency)
npm run test:unit
```

As suítes de banco usam o Postgres do `.env`. O guia completo está no [CONTRIBUTING.md](CONTRIBUTING.md).

## Estrutura

| Pasta | O que tem |
|---|---|
| `src/domain` | Regras puras, sem I/O (a cerca `npm run fence:domain` garante) |
| `src/db`, `src/repositories` | Migrações SQL e acesso ao Postgres, com RLS por pessoa |
| `src/use-cases`, `src/services` | Casos de uso |
| `src/adapters` | HTTP, executores (Claude Code, Codex, catcher), proxy MCP |
| `web/` | A interface web |
| `desktop/` | O app Electron |
| `docs/adr/` | As decisões de arquitetura, com o gatilho de reversão de cada uma |
| `tests/` | `unit`, `integration`, `conformidade` e `concurrency` |

## Contribuir

Leia o [CONTRIBUTING.md](CONTRIBUTING.md). Toda contribuição segue o [código de conduta](CODE_OF_CONDUCT.md). Para falha de segurança, **não abra issue**: siga o [SECURITY.md](SECURITY.md).

## Licença

O núcleo do nod é [Apache 2.0](LICENSE): você pode usar, estudar, modificar, rodar e redistribuir, inclusive comercialmente. O marketplace, os pagamentos e os recursos de empresa da versão hospedada ficam fechados. O [LICENSING.md](LICENSING.md) explica o que é aberto e o que é fechado, e o [NOTICE](NOTICE) traz o aviso de copyright.

A marca "nod" (o nome e o logo) não está incluída na licença do código e pertence ao Marlon Wanderllich. Para usar a marca, fale com ele antes; os detalhes estão no [LICENSING.md](LICENSING.md).
