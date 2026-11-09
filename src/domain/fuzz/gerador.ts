import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * O fuzz das ações (NOD-398, emenda da ADR-135): para cada ação do registro, entradas absurdas geradas a partir do JSON
 * Schema dela, com semente fixa. Puro: quem chama o servidor e confere os invariantes é o teste (tests/helpers/fuzz.ts).
 *
 * O corpo sai como TEXTO cru (não um objeto JS): `{"__proto__":…}` e JSON quebrado só existem assim.
 */

/** PRNG de 32 bits (mulberry32): a mesma semente dá a mesma sequência em qualquer máquina. */
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type EntradaDeFuzz = {
  /** O que a entrada tem de absurdo (sai no relatório da falha). */
  rotulo: string;
  /** O corpo, já serializado. `null` = sem corpo. */
  corpo: string | null;
};

/** Aninhamento fundo o bastante para estourar um parser recursivo ingênuo, raso o bastante para o JSON.parse do Node. */
const PROFUNDIDADE = 200;
const aninhado = (): string => "[".repeat(PROFUNDIDADE) + "]".repeat(PROFUNDIDADE);

/** Valores absurdos em texto JSON. Os que não são JSON válido ficam em CORPOS_QUEBRADOS. */
export const VALORES_ABSURDOS: readonly { rotulo: string; json: string }[] = [
  { rotulo: "string vazia", json: '""' },
  { rotulo: "só espaços", json: '"   "' },
  { rotulo: "string de 100 mil", json: JSON.stringify("x".repeat(100_000)) },
  { rotulo: "byte nulo", json: JSON.stringify("a\u0000b") },
  { rotulo: "emoji e RTL", json: JSON.stringify("🦄‮‮" + "ç".repeat(500)) },
  { rotulo: "surrogate solto", json: '"\\ud800"' },
  { rotulo: "sql", json: JSON.stringify("'; drop table agentes; --") },
  { rotulo: "caminho", json: JSON.stringify("../../../etc/passwd") },
  { rotulo: "uuid inexistente", json: '"00000000-0000-4000-8000-000000000000"' },
  { rotulo: "zero", json: "0" },
  { rotulo: "negativo", json: "-1" },
  { rotulo: "fração", json: "1.5" },
  { rotulo: "1e308", json: "1e308" },
  { rotulo: "-1e308", json: "-1e308" },
  { rotulo: "além de 2^53", json: "9007199254740993" },
  { rotulo: "true", json: "true" },
  { rotulo: "false", json: "false" },
  { rotulo: "null", json: "null" },
  { rotulo: "lista vazia", json: "[]" },
  { rotulo: "objeto vazio", json: "{}" },
  { rotulo: "lista de 10 mil", json: JSON.stringify(Array.from({ length: 10_000 }, (_, i) => i)) },
  { rotulo: "aninhamento fundo", json: aninhado() },
  { rotulo: "__proto__", json: '{"__proto__":{"admin":true,"tenantId":"x"}}' },
  { rotulo: "constructor", json: '{"constructor":{"prototype":{"admin":true}}}' },
];

/** Corpos inteiros que não são um objeto JSON válido. */
export const CORPOS_QUEBRADOS: readonly EntradaDeFuzz[] = [
  { rotulo: "sem corpo", corpo: null },
  { rotulo: "corpo vazio", corpo: "" },
  { rotulo: "json quebrado", corpo: '{"a":' },
  { rotulo: "não json", corpo: "<xml/>" },
  { rotulo: "lista no topo", corpo: "[1,2,3]" },
  { rotulo: "string no topo", corpo: '"oi"' },
  { rotulo: "número no topo", corpo: "42" },
  { rotulo: "null no topo", corpo: "null" },
  { rotulo: "__proto__ no topo", corpo: '{"__proto__":{"admin":true}}' },
  { rotulo: "aninhamento no topo", corpo: '{"a":' + aninhado() + "}" },
];

/** Um valor plausível para o schema (a base que o fuzz estraga campo a campo). */
export function valorPlausivel(s: JsonSchema | undefined, profundidade = 0): unknown {
  if (!s || profundidade > 4) return "a";
  if (s.enum && s.enum.length > 0) return s.enum[0];
  const alternativa = s.anyOf?.[0] ?? s.oneOf?.[0];
  if (alternativa) return valorPlausivel(alternativa, profundidade + 1);
  switch (s.type) {
    case "object": {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) o[k] = valorPlausivel(v, profundidade + 1);
      return o;
    }
    case "array":
      return Array.from({ length: s.minItems ?? 0 }, () => valorPlausivel(s.items, profundidade + 1));
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return "a".repeat(Math.max(1, s.minLength ?? 1));
  }
}

/** Os campos do topo do schema (o fuzz mexe neles); sem schema, campos que costumam existir nas rotas. */
const CAMPOS_GENERICOS = ["id", "nome", "texto", "modo", "agenteId", "estado", "valor"];

function serializarComCampo(base: Record<string, unknown>, campo: string, json: string): string {
  // Monta à mão para o valor entrar cru (aninhamento, __proto__) sem passar por um objeto JS.
  const resto = Object.entries(base).filter(([k]) => k !== campo);
  const partes = resto.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  partes.push(`${JSON.stringify(campo)}:${json}`);
  return `{${partes.join(",")}}`;
}

/**
 * Todas as entradas candidatas da ação, numa ordem estável: corpos quebrados, cada campo × cada valor absurdo, cada
 * obrigatório faltando, campo extra e a base plausível. `gerarEntradas` sorteia N delas pela semente.
 */
export function candidatas(schema: JsonSchema | undefined): EntradaDeFuzz[] {
  const base = schema?.type === "object" || !schema ? (valorPlausivel(schema ?? { type: "object" }) as Record<string, unknown>) : {};
  const campos = schema?.properties ? Object.keys(schema.properties) : CAMPOS_GENERICOS;
  const saida: EntradaDeFuzz[] = [...CORPOS_QUEBRADOS];
  for (const campo of campos) {
    for (const v of VALORES_ABSURDOS) saida.push({ rotulo: `${campo}: ${v.rotulo}`, corpo: serializarComCampo(base, campo, v.json) });
  }
  for (const r of schema?.required ?? []) {
    const sem = Object.fromEntries(Object.entries(base).filter(([k]) => k !== r));
    saida.push({ rotulo: `sem o obrigatório ${r}`, corpo: JSON.stringify(sem) });
  }
  saida.push({ rotulo: "campo extra", corpo: serializarComCampo(base, "campoQueNaoExiste", '"x"') });
  saida.push({ rotulo: "base plausível", corpo: JSON.stringify(base) });
  return saida;
}

/**
 * N entradas para a ação, determinísticas pela semente. As que mais pegam erro (corpo quebrado, base plausível) entram
 * sempre; o resto é sorteado sem repetição.
 */
export function gerarEntradas(schema: JsonSchema | undefined, semente: number, n: number): EntradaDeFuzz[] {
  const todas = candidatas(schema);
  if (n >= todas.length) return todas;
  const fixas = todas.filter((e) => e.rotulo === "base plausível" || e.rotulo === "json quebrado" || e.rotulo === "sem corpo");
  const resto = todas.filter((e) => !fixas.includes(e));
  const sorteio = prng(semente);
  // Fisher–Yates parcial: as primeiras k posições ficam embaralhadas.
  const k = Math.max(0, n - fixas.length);
  for (let i = 0; i < Math.min(k, resto.length); i++) {
    const j = i + Math.floor(sorteio() * (resto.length - i));
    [resto[i], resto[j]] = [resto[j]!, resto[i]!];
  }
  return [...fixas, ...resto.slice(0, k)].slice(0, n);
}

/** Uma rota como o fuzz a vê (a mesma forma da catraca de paridade). */
/** `publica`: a rota mora em /api (a conta, ADR-135 §5), não em /api/t/:tenant. */
export type RotaDoFuzz = { metodo: string; padrao: string; acao?: string; publica?: boolean };

/** Ids para os parâmetros de caminho: absurdo, da pessoa (existe) e de outra pessoa (o RLS tem de esconder). */
/**
 * Ids reais para os grupos do caminho. `porRecurso` (revisão 9) leva os ids de cada recurso pelo segmento logo antes do
 * grupo e, sem ele, pelo primeiro segmento do caminho (`conversas`, `rotinas`, `colunas`...): a rota `/rotinas/:id`
 * recebe id de rotina, não só de bot, e passa da busca da entidade. O recurso sem entrada usa `daPessoa`/`deOutraPessoa`.
 */
export type IdsDoFuzz = {
  daPessoa: readonly string[];
  deOutraPessoa: readonly string[];
  porRecurso?: Readonly<Record<string, { daPessoa: readonly string[]; deOutraPessoa: readonly string[] }>>;
};

export type CasoDeFuzz = {
  acao: string;
  metodo: string;
  /** Caminho relativo a /api/t/:tenant, ou a /api quando `publica`. */
  caminho: string;
  publica: boolean;
  /** A rota do servidor que gerou o caso (método + padrão): a cobertura das rotas de conta conta por ela. */
  rota: string;
  entrada: EntradaDeFuzz;
};

// Nomeado `(?<id>…)` ou de captura sem nome `(…)` (as rotas de conta usam o sem nome): os dois viram valor. `(?:…)` não.
const GRUPO = /\((?:\?<(?<nome>[a-zA-Z]+)>|(?!\?))(?<sub>(?:[^()]|\([^()]*\))*)\)/g;

/** Grupos que o roteador exige UUID (fora disso a rota dá 404 antes do handler): o fuzz só manda UUID neles. */
const GRUPOS_UUID = new Set(["id", "mid", "aid", "eid"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Um valor para o grupo nomeado do padrão que CASA com o sub-padrão dele (senão a rota nem é alcançada e o fuzz não
 * testa o handler). Peso: ids da pessoa ×3 (exercita o caminho que muda dado), de outra pessoa (o RLS esconde) e um
 * UUID que não existe.
 */
function valorDoGrupo(nome: string, sub: string, sorteio: () => number, ids: IdsDoFuzz): string {
  const re = new RegExp(`^(?:${sub})$`);
  const absurdos = ["00000000-0000-4000-8000-000000000000", "nao-e-uuid", "%2e%2e", "x".repeat(300), "github", "1"];
  const candidatos = [...ids.daPessoa, ...ids.daPessoa, ...ids.daPessoa, ...ids.deOutraPessoa, ...absurdos];
  const alternativas = /^[a-z|]+$/.test(sub) ? sub.split("|") : [];
  const validos = [...candidatos.filter((c) => re.test(c) && (!GRUPOS_UUID.has(nome) || UUID.test(c))), ...alternativas];
  if (validos.length === 0) return absurdos[0]!;
  return validos[Math.floor(sorteio() * validos.length)]!;
}

/** Monta o caminho concreto do padrão da rota (`^\/agentes\/(?<id>[^/]+)$` → `/agentes/<id>`). */
export function caminhoDoPadrao(padrao: string, sorteio: () => number, ids: IdsDoFuzz): string {
  const semAncoras = padrao.replace(/^\^/, "").replace(/\$$/, "");
  return semAncoras.replace(GRUPO, (_m, ...args) => {
    const g = args.at(-1) as { nome?: string; sub: string };
    const pos = args.at(-3) as number;
    // O segmento logo antes do grupo (`/quadro/colunas/:cid` → `colunas`) vale antes do primeiro (NOD-415).
    const antes = semAncoras.slice(0, pos);
    const vizinho = /\\\/([a-z_-]+)\\\/$/.exec(antes)?.[1];
    const recurso = /^\\\/([a-z_-]+)\\\//.exec(antes)?.[1];
    const doRecurso = (vizinho ? ids.porRecurso?.[vizinho] : undefined) ?? (recurso ? ids.porRecurso?.[recurso] : undefined);
    return encodeURIComponent(valorDoGrupo(g.nome ?? "", g.sub, sorteio, doRecurso ?? ids));
  }).replace(/\\\//g, "/");
}

/**
 * O plano do fuzz: toda ação do registro × toda rota que a declara × N entradas. A ação sem rota volta em `semRota`
 * (o teste exige que cada uma tenha outro caminho ou um motivo). Ação nova no registro entra aqui sem ninguém editar o
 * teste — a sentinela prova.
 */
export function planoDeFuzz(o: { registro: readonly DefinicaoAcao[]; rotas: readonly RotaDoFuzz[]; semente: number; n: number; ids: IdsDoFuzz }): {
  casos: CasoDeFuzz[];
  semRota: string[];
} {
  const casos: CasoDeFuzz[] = [];
  const semRota: string[] = [];
  const sorteio = prng(o.semente ^ 0x9e3779b9);
  o.registro.forEach((acao, i) => {
    const rotas = o.rotas.filter((r) => r.acao === acao.id);
    if (rotas.length === 0) {
      semRota.push(acao.id);
      return;
    }
    const entradas = gerarEntradas(acao.schema, (o.semente + i * 7919) >>> 0, o.n);
    for (const r of rotas) {
      for (const entrada of entradas) casos.push({ acao: acao.id, metodo: r.metodo, caminho: caminhoDoPadrao(r.padrao, sorteio, o.ids), publica: r.publica === true, rota: `${r.metodo} ${r.padrao}`, entrada });
    }
  });
  // As que destroem vão por último (excluir o bot-alvo no meio deixaria as outras ações só com 404), e as públicas (a
  // conta: sair, excluir a conta) depois de todas, porque derrubam a sessão. Ordenação estável: a semente reproduz.
  // Entre as que destroem, a do recurso mais fundo antes (NOD-415: `bots.excluir` antes de `quadro.remover_coluna`
  // deixava a coluna só com 404, e a main ficou vermelha com a semente 3044290320): o filho sai antes do pai.
  const peso = (c: CasoDeFuzz) => (c.publica ? 2 : c.metodo === "DELETE" ? 1 : 0);
  const fundura = (c: CasoDeFuzz) => (c.metodo === "DELETE" && !c.publica ? c.caminho.split("/").length : 0);
  casos.sort((a, b) => peso(a) - peso(b) || fundura(b) - fundura(a));
  return { casos, semRota };
}

/** A semente do fuzz: a do ambiente (para reproduzir) ou uma nova. Inválida → erro claro, nunca NaN silencioso. */
export function lerSemente(valor: string | undefined, nova: () => number): number {
  if (valor === undefined || valor.trim() === "") return nova() >>> 0;
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`FUZZ_SEMENTE inválida: ${valor}`);
  return n >>> 0;
}
