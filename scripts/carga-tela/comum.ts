// Peças comuns do teste de carga da tela (scripts/carga-tela/rodar.ts): configuração por ambiente, o cliente HTTP
// com login stub e o conteúdo sintético das respostas dos bots.
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CONFIG = {
  /** Nome do banco efêmero (`npm run db:efemero:up -- <nome> <porta>`); o container é nod-efemero-<nome>-postgres-1. */
  banco: process.env.CARGA_BANCO ?? "carga-tela",
  bancoPorta: Number(process.env.CARGA_BANCO_PORTA ?? 5441),
  apiPorta: Number(process.env.CARGA_API_PORTA ?? 8892),
  cdpPorta: Number(process.env.CARGA_CDP_PORTA ?? 9351),
  /** Atraso do catcher entre eventos: 25 ms ≈ 40 pedaços de texto por segundo por bot, perto do stream do Claude. */
  atrasoMs: Number(process.env.CARGA_ATRASO_MS ?? 25),
  saida: process.env.CARGA_SAIDA ?? join(tmpdir(), "nod-carga-tela"),
};

export const container = (): string => `nod-efemero-${CONFIG.banco}-postgres-1`;
export const urlWeb = (): string => `http://127.0.0.1:${CONFIG.apiPorta}`;

export function escrever(linha: string): void {
  process.stdout.write(`${linha}\n`);
}

export type Sessao = { cookie: string; tenantId: string; pessoaId: string };

/** Login stub (NOD_LOGIN=stub) como a primeira pessoa do seed com esse nome. */
export async function entrar(nome = "Marlon"): Promise<Sessao> {
  const modo = (await (await fetch(`${urlWeb()}/api/sessao/modo`)).json()) as { pessoas: { id: string; nome: string }[] };
  const pessoa = modo.pessoas.find((p) => p.nome === nome) ?? modo.pessoas[0];
  if (!pessoa) throw new Error("nenhuma pessoa no cadastro: rode o seed do banco efêmero");
  const r = await fetch(`${urlWeb()}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId: pessoa.id }) });
  if (!r.ok) throw new Error(`entrar: ${r.status}`);
  const escopo = (await r.json()) as { tenantId: string; pessoaId: string };
  return { cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "", ...escopo };
}

export async function api<T>(s: Sessao, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`${urlWeb()}/api/t/${s.tenantId}/${caminho}`, {
    method: metodo,
    headers: { cookie: s.cookie, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${texto.slice(0, 200)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

export type Bot = { id: string; nome: string; conversaId: string };

export async function botsDeCarga(s: Sessao): Promise<Bot[]> {
  const f = await api<{ agentes: Bot[] }>(s, "GET", "frota");
  return f.agentes.filter((a) => a.nome.startsWith("Carga ")).sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Resposta de bot com o markdown que a web formata: parágrafos, tabela de 12 linhas, lista, código e links. */
export function respostaRica(i: number): string {
  const linhas = Array.from({ length: 12 }, (_, k) => `| PR #${1000 + i * 12 + k} | ${k % 3 === 0 ? "**aprovado**" : k % 3 === 1 ? "em revisão" : "`bloqueado`"} | ${(k * 7.3 + i).toFixed(1)} h | https://github.com/acme/app/pull/${1000 + i * 12 + k} |`);
  return [
    `Resumo da rodada ${i}: olhei os **${12 + (i % 7)} pull requests** abertos e cruzei com o [quadro do Linear](https://linear.app/acme/view/abc${i}) e com o canal *#eng-releases*. O ponto de atenção é o \`deploy-${i}\` que ficou parado desde ontem.`,
    "",
    "| PR | Estado | Tempo | Link |",
    "|---|---|---:|---|",
    ...linhas,
    "",
    "Próximos passos:",
    "- revisar o `middleware` de autenticação e a política de cache",
    "- confirmar com a equipe de dados se o *backfill* terminou",
    "- abrir o incidente se o p95 passar de **800 ms** de novo",
    "- atualizar a documentação em https://docs.acme.com.br/runbooks/deploy",
    "",
    "```ts",
    `export async function verificar${i}(ids: string[]): Promise<number> {`,
    "  let ok = 0;",
    "  for (const id of ids) {",
    "    const r = await fetch(`/api/prs/${id}`);",
    "    if (r.ok) ok += 1;",
    "  }",
    "  return ok;",
    "}",
    "```",
    "",
    `Se quiser, eu preparo a mensagem para o time com esses números. Rodada ${i} concluída.`,
  ].join("\n");
}

const FRASES = [
  "Estou olhando os dados da semana e ",
  "cruzando com o que ficou pendente ",
  "no quadro do time; ",
  "achei **três pontos** que valem atenção ",
  "e um que parece ruído. ",
  "O primeiro é o tempo de build, ",
  "que subiu `18%` desde segunda. ",
  "O segundo é a fila de revisão, ",
  "com PRs parados há mais de dois dias. ",
  "O terceiro é o alerta de memória ",
  "que disparou no ambiente de staging.\n\n",
];

/**
 * Mensagem da pessoa cujo roteiro faz o catcher emitir `n` pedaços de texto e terminar com `final` (tests/helpers/catcher-roteiro.ts).
 * O roteiro apara o texto de cada marcador, então as frases chegam coladas ("segunda.O segundo"): não muda a medida.
 */
export function promptStreaming(n: number, final: string, rotulo: string): string {
  const deltas = Array.from({ length: n }, (_, k) => `[[delta: ${FRASES[k % FRASES.length]}]]`).join("\n");
  return `${rotulo}\n${deltas}\n[[texto: ${final}]]`;
}
