# ADR-031 — A chave de máquina persiste, carrega o próprio escopo e é revogável

**Status** novo · **Origem** E1.0 da Jornada 01 (LEA-7), decidido em 2026-09-16

## Decisão

A chave (token) de máquina do ADR-021 **sobrevive a restart**: mora na tabela `maquina_tokens`,
escopada por `nod_escopar_tabela` sem perna extra. A dona da linha é a **pessoa** que emitiu — a
máquina não é sujeito no modelo do nod; a chave é uma procuração da pessoa para um computador dela.
`visibility` fica sempre `privado`.

O servidor guarda só `sha256(chave)` em `bytea` (32 bytes). A chave crua sai **uma vez**, na
resposta da emissão, e em nenhum outro lugar (banco, log, listagem).

**A chave carrega o próprio escopo, como o cookie de sessão:**

```
chave = base64url(JSON{t: tenantId, p: pessoaId}) "." base64url(randomBytes(32))
```

A validação acontece ANTES de existir sessão. Com RLS FORCE, `select … where hash = $1` sem escopo
nunca acha a linha: como `nod_app` **falha** com "unrecognized configuration parameter"; como
`nod_dono` **volta vazio em silêncio**, o mesmo tipo de armadilha que a 0005 registrou (medido em
2026-09-16).
Por isso a validação: (1) lê o escopo ALEGADO da primeira metade, (2) abre a transação escopada com
ele, (3) busca pelo hash da chave INTEIRA sob RLS e confirma com `timingSafeEqual`. O escopo alegado
é não-confiável até o hash casar; como o hash cobre a chave inteira, adulterar a metade do escopo
muda o hash e a linha nunca é encontrada.

Toda chave é **revogável** (`revogado_em`) e listável pela dona. Gerar uma chave nova NÃO invalida as
anteriores — por isso a revogação é parte da emissão, não um extra.

## Contexto

O token de TURNO (`src/services/token-turno.ts`) é `Map` em memória por decisão escrita, e ela se
sustenta porque o token morre com o turno: reinício perde, o varredor de lease assenta, custo zero
para a pessoa. A chave de MÁQUINA tem outro tempo de vida: fica guardada no computador e deve
continuar valendo entre deploys.

A tabela é separada de `maquinas` (0001) de propósito: aquela é o inventário ("sem credencial",
ADR-021), tocado pelo poll a cada batida; esta é credencial. Uma pessoa pode ter N chaves (dois
laptops, rotação sem perder o inventário).

## Alternativas rejeitadas

### Map em memória, igual ao token de turno

Morreria a cada deploy e obrigaria cada pessoa a reabrir o navegador e reemitir — deploy vira evento
de suporte, e quebra a promessa do ADR-021 de uma máquina que puxa sozinha depois de configurada.

### Função `SECURITY DEFINER` que busca pelo hash atravessando a RLS

Seria o primeiro bypass de RLS do repositório — exatamente o que `tests/conformidade/rls.test.ts`
existe para impedir. O escopo embutido resolve o mesmo problema sem exceção nenhuma no gate.

### Cache de validação

Poria a revogação atrás de um TTL.

## Gatilho de reversão

- Voltar para memória se o deploy cair abaixo de **1 por mês por dois trimestres** E as máquinas
  ativas ficarem **≤ 3**.
- Endurecer (nunca afrouxar): se uma chave revogada continuar autorizando por mais de **20 s** (um
  ciclo de long-poll do ADR-021), qualquer cache sai.

## Fora desta decisão

Ligar a chave à autorização das rotas `/api/interno` multi-máquina (ponte HTTP do ADR-021) e guardar
a chave no Keychain (E1.4) ficam para quando existir app local falando HTTP.

## Reversibilidade

Média: chaves emitidas teriam de ser reemitidas se o formato mudar.
