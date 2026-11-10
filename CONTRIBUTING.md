# Como contribuir com o nod

Obrigado pelo interesse. Este guia cobre como montar o ambiente, as regras do código e o caminho de um PR.

## Antes de começar

- **Bug:** abra uma issue com o template *Bug*, com os passos para reproduzir.
- **Ideia ou funcionalidade:** abra uma issue com o template *Ideia* e espere uma resposta antes de escrever muito código. Assim ninguém perde trabalho com algo que não cabe no produto.
- **Falha de segurança:** não abra issue. Siga o [SECURITY.md](SECURITY.md).
- **Dúvida:** pergunte no [Discord](https://discord.gg/nb9K82eKc9).

As issues com o label `boa primeira issue` são um bom ponto de partida.

## Ambiente

Siga a seção **Rodar local** do [README](README.md). Em resumo: Node 24.19.0, Postgres 16, `npm ci`, `cp .env.example .env`, `npm run dev:setup` e `NOD_LOGIN=stub npm run dev`. O executor `catcher` responde sem modelo nenhum, então dá para desenvolver e testar sem conta de IA e sem custo.

## Regras do código

O projeto tem algumas regras que os testes e as cercas fazem valer. As principais:

- **TypeScript estrito**, sem `any` solto. O Node roda o TypeScript direto, sem build no servidor.
- **O domínio é puro.** `src/domain` não faz I/O nem importa adaptadores, e o `npm run fence:domain` falha se fizer.
- **Migração só soma.** Migração já aplicada não se edita: crie uma nova. O `npm run fence:migrations` confere.
- **Toda tabela tem RLS por pessoa.** Os testes de `tests/conformidade` leem o catálogo do Postgres e falham se uma tabela nascer sem política.
- **Falha é escrita, nunca silêncio.** Quando algo não dá certo, o usuário vê o motivo.
- **Decisão grande vira ADR** em `docs/adr/`, com o contexto, a decisão e o gatilho de reversão.
- **Textos da interface em português do Brasil**, curtos e diretos.

## Testes

Escreva o teste junto do código. São quatro modos:

| Pasta | Quando usar |
|---|---|
| `tests/unit` | Lógica sem banco |
| `tests/integration` | Postgres real, com cada teste numa transação desfeita no fim |
| `tests/conformidade` | Regras lidas do catálogo do Postgres (RLS, gatilhos, papéis) |
| `tests/concurrency` | Duas conexões e commit de verdade, com limpeza própria por id |

Enquanto trabalha, rode só o que mexeu (`npx vitest run caminho/do/teste`) e o `npm run typecheck`. Antes de pedir revisão, rode o `npm run check` uma vez.

## Pull requests

1. Faça um fork e crie um branch a partir da `main`.
2. Um PR por assunto, pequeno o bastante para revisar de uma vez.
3. Preencha o template: o que muda, por quê, como testou e o que ficou de fora.
4. A CI precisa estar verde (lint, typecheck, unit, integration, e2e, navegador e gitleaks). Ela roda em runners do
   GitHub, sem nenhum segredo, inclusive em PR de fork. PR em rascunho não roda CI: marque como pronto quando quiser.
5. Mudança de interface leva print ou vídeo curto.
6. Nada de segredo, chave, IP de servidor, e-mail ou dado de pessoa real no código, nos testes ou nos commits. O job
   `gitleaks` reprova segredo; o resto é revisão.

Usamos *squash merge*: o título do PR vira a mensagem do commit na `main`. Este repositório é a fonte do código e da
operação do nod: depois do merge, a `main` com a CI verde vai para produção pelo `deploy.yml`, que só roda na `main`
deste repositório, num environment protegido, e nunca em PR.

## Certificado de origem (DCO)

Não pedimos CLA. Cada commit precisa da linha `Signed-off-by`, que declara que você tem o direito de enviar aquele código sob a licença do projeto, nos termos do [Developer Certificate of Origin 1.1](https://developercertificate.org/). Basta usar o `-s` ao commitar:

```bash
git commit -s -m "Corrige o prazo da aprovação"
```

O `-s` acrescenta `Signed-off-by: Seu Nome <seu@email>` com o nome e o e-mail do seu git.

## Licença

Ao contribuir, você concorda que a sua contribuição é licenciada sob a mesma licença do projeto ([Apache 2.0](LICENSE)). O DCO acima é o que registra isso, commit a commit. O que fica fora do código aberto está no [LICENSING.md](LICENSING.md).
