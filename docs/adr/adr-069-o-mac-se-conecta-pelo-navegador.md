# ADR-069 — O Mac se conecta pelo navegador, sem copiar chave

**Status** novo · decidido em 2026-10-03

## Decisão

O app do Mac se conecta em um clique. Ele já vem com o endereço do servidor (`NOD_SERVIDOR_PADRAO`
no build) e a primeira tela tem só **Entrar com Google**. O fluxo é o de apps nativos com OAuth
(RFC 8252, retorno por `127.0.0.1`) com PKCE (RFC 7636):

```
app: verificador aleatório, desafio = sha256(verificador), porta livre em 127.0.0.1
 └─► navegador: https://servidor/?parear-mac=1&porta&estado&desafio&nome
       └─ entra com Google (o pedido espera na sessionStorage da aba) → "Conectar este Mac?"
       └─ POST /api/t/:t/maquinas/pareamentos {nome, desafio}  (sessão da pessoa) → código
       └─► http://127.0.0.1:porta/retorno?estado&codigo
app: confere o estado → POST /api/pareamento/trocar {codigo, verificador} → chave (ADR-031)
```

- O pedido aberto vive **em memória** no servidor (`src/services/pareamento-maquina.ts`), por 5 min,
  e só pode ser trocado uma vez. Toda tentativa consome o código, certa ou errada.
- A chave **nasce na troca**, dentro do escopo da pessoa que confirmou, pelo mesmo
  `emitirChaveMaquina` de **Minhas chaves**. Ela aparece lá com o nome do Mac e se revoga igual.
- `/api/pareamento/trocar` é pública, mas recusa qualquer requisição com `Origin` (403), como as
  rotas de máquina (ADR-021): quem troca é o app, nunca uma página.
- A chave não aparece em URL nem no histórico do navegador. O que passa pelo navegador é o código,
  que sozinho não vale nada sem o verificador.
- A chave manual de **Chaves** continua funcionando, em "Outro servidor ou chave manual".

## Por quê

Copiar uma chave do navegador para o app era o único passo da instalação que pedia para a pessoa
entender o modelo (uma chave por computador). Os outros já eram automáticos: a conta do Claude Code
ou do Codex do Mac é encontrada sem turno pago (ADR-036), e o GitHub vem do `gh` logado (ADR-048).

## Alternativas rejeitadas

- **Esquema de URL próprio (`nod://`).** Exige registrar o protocolo no app empacotado, não
  funciona no `desktop:dev` e qualquer app instalado pode registrar o mesmo esquema. O retorno por
  `127.0.0.1` em porta aleatória é o que a RFC 8252 recomenda para desktop.
- **A chave no redirecionamento.** Ficaria no histórico do navegador e em logs de extensão.
- **Pedido no banco.** Vive minutos e não precisa sobreviver a um deploy: se o servidor reinicia no
  meio, a pessoa clica de novo. Em memória, como o token de turno, sem migração.

## Limites

- Um processo malicioso já rodando no Mac poderia escutar uma porta e induzir a pessoa a confirmar
  um pedido dele. O diálogo diz o nome do computador e pede para confirmar só se o clique veio do
  app. É o mesmo limite de qualquer login de app nativo por navegador.
- Uma instância do servidor só, como o resto do estado em memória (ADR-017).

## Gatilho de reversão

Reabrir se o servidor ganhar réplicas (o pedido precisa ir para o banco ou para um armazenamento
compartilhado), ou se mais de um pareamento em cada cinco falhar por prazo vencido.

## Emenda de 2026-10-28 — `nod://` para navegação (NOD-136)

O esquema `nod://` passa a ser registrado pelo app (Info.plist, `mac.protocols` no electron-builder), mas **só para
navegar**: `nod://conversa/<uuid>`, `nod://sua-vez` e `nod://computador-do-bot`. O pareamento continua pelo navegador,
como decidido acima; nenhum segredo, código ou token viaja num link `nod://`.

O risco que levou a rejeitar o esquema para o login continua valendo e foi aceito: outro app que registre `nod` pode
receber o link (o LaunchServices escolhe quem o trata), e com ele só o UUID de uma conversa, que sozinho não dá acesso
a nada. Do lado do nod, o link vem de qualquer página: o parser (desktop/deep-link.ts) é estrito, a URL nunca vai à
página, a `loadURL` nem ao log, e a conversa que não é da pessoa abre Sua vez.

Gatilho de reversão: se um link `nod://` precisar carregar segredo ou executar uma ação (não só abrir uma tela), esta
emenda cai e a ação volta a passar pelo navegador.
