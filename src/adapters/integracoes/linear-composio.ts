import type { CredencialLinear, FonteLinear, IssueLinear } from "../../contracts/quadro-importacao.ts";
import { LIMITES_QUADRO } from "../../contracts/quadro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { LIMITE_IMPORTACAO } from "../../domain/importar-linear.ts";
import { ORCAMENTO_CONECTOR_MS } from "../../shared/constantes.ts";

/**
 * NOD-422 (definido em 2026-11-02): a busca do time do Linear pelo servidor, com a conta Linear da pessoa no Composio.
 * Só consultas GraphQL (decisão 7: nunca escreve no Linear); só as issues abertas (fora os tipos completed e canceled).
 * Suposição registrada no PR: a ferramenta é a LINEAR_RUN_QUERY_OR_MUTATION; fica atrás da NOD_LINEAR_SERVIDOR.
 */
export const FERRAMENTA_LINEAR = "LINEAR_RUN_QUERY_OR_MUTATION";

const POR_PAGINA_LEVE = 100;
const POR_PAGINA_COMPLETA = 25;
/**
 * Teto de páginas (revisão do PR #630, definido em 2026-11-02): a busca completa comporta o teto de 500 com folga de uma
 * página (21 × 25 = 525; o filtro sem_backlog vai na própria consulta, então o Backlog não conta); a leve, da prévia,
 * conta até 3.000 para dizer quantas seriam sem o Backlog. Acabar as páginas com hasNextPage verdadeiro LANÇA
 * limite_atingido: lista incompleta nunca volta como se fosse a do time inteiro (um cursor sem fim também não vira laço).
 */
export const PAGINAS_COMPLETA = Math.ceil(LIMITE_IMPORTACAO / POR_PAGINA_COMPLETA) + 1;
export const PAGINAS_LEVE = 30;
/**
 * Revisão 6 do PR #630: os comentários da issue. Busca o dobro dos que entram e corta depois de tirar os vazios (o de
 * anexo só, o apagado): os vazios não tomam o lugar dos com texto. Entram os COMENTARIOS_TRAZIDOS mais recentes.
 */
export const COMENTARIOS_TRAZIDOS = 10;
const COMENTARIOS_BUSCADOS = COMENTARIOS_TRAZIDOS * 2;

/**
 * Revisão 5 do PR #630 (definido em 2026-11-02): o prazo de cada página no adaptador. O cliente do Composio já corta cada
 * requisição em ORCAMENTO_CONECTOR_MS; este é a rede de segurança por chamada (5 s de folga para o cliente desistir
 * primeiro), para uma página presa não segurar a importação (e a trava do quadro) sem fim. Estourou = conector_indisponivel.
 */
export const PRAZO_PAGINA_LINEAR_MS = ORCAMENTO_CONECTOR_MS + 5_000;

/** A chamada com prazo: o timer é limpo no fim e não segura o processo (unref). */
async function comPrazo<T>(ms: number, chamada: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new ErroDeDominio("conector_indisponivel", { cause: `linear: a página passou de ${ms} ms` })), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([chamada, estouro]);
  } finally {
    clearTimeout(timer);
  }
}

export type ExecutarComposio = (ferramenta: string, p: { userId: string; contaId: string; argumentos: Record<string, unknown> }) => Promise<Record<string, unknown>>;

/** sem_backlog tira o estado Backlog na consulta; o caso de uso ainda passa o filtro local (estado novo também cai no Backlog). */
const filtro = (semBacklog: boolean) =>
  `filter: { team: { key: { eq: $time } }, state: { type: { nin: ["completed", "canceled"] }${semBacklog ? `, name: { nin: ["Backlog"] }` : ""} } }`;
const leve = (semBacklog: boolean) => `query($time: String!, $depois: String) { issues(first: ${POR_PAGINA_LEVE}, after: $depois, ${filtro(semBacklog)}) {
  nodes { identifier number title url createdAt state { name } labels { nodes { name } } }
  pageInfo { hasNextPage endCursor } } }`;
// O histórico vem do fim (last: 30): a passagem para o estado atual é a mais recente, não a mais antiga.
const completa = (semBacklog: boolean) => `query($time: String!, $depois: String) { issues(first: ${POR_PAGINA_COMPLETA}, after: $depois, ${filtro(semBacklog)}) {
  nodes { identifier number title url description createdAt state { name } labels { nodes { name } } parent { identifier }
    inverseRelations { nodes { type issue { identifier } } }
    comments(last: ${COMENTARIOS_BUSCADOS}) { nodes { id body createdAt user { name } } }
    attachments { nodes { url createdAt } }
    history(last: 30) { nodes { createdAt toState { name } } } }
  pageInfo { hasNextPage endCursor } } }`;

type No = Record<string, unknown>;
const obj = (v: unknown): No | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as No) : null);
const nos = (v: unknown): No[] => {
  const n = obj(v)?.nodes;
  return Array.isArray(n) ? n.map(obj).filter((x): x is No => x !== null) : [];
};
const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const quando = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Revisão do PR #630: só a página do Linear vira o link da tarefa, e só no teto da URL; outra coisa descarta só a URL
 * (a issue vem). O anexo é o PR: só https e no teto (o resto do anexo cai).
 */
export function urlDoLinear(v: unknown): string | null {
  const u = texto(v);
  return u.startsWith("https://linear.app/") && u.length <= LIMITES_QUADRO.url ? u : null;
}
const urlDoAnexo = (v: unknown): string => {
  const u = texto(v);
  return u.startsWith("https://") && u.length <= LIMITES_QUADRO.url ? u : "";
};

/** O teto do id de um comentário do Linear (o CHECK length(linear_id) <= 100 de quadro_comentarios, 0148). */
export const ID_COMENTARIO_MAX = 100;

/**
 * Uma issue do GraphQL do Linear, conferida campo a campo (texto de fora, ADR-062). null = faltou o essencial ou veio
 * malformada. Revisão 4 do PR #630: um comentário com id acima do teto da coluna abortaria a aplicação inteira no CHECK;
 * a issue é descartada (quem lista avisa pelo aoDescartar) e o resto vem.
 */
export function lerIssue(n: No): IssueLinear | null {
  const identificador = texto(n.identifier);
  const numero = typeof n.number === "number" && Number.isInteger(n.number) && n.number > 0 ? n.number : null;
  const estado = texto(obj(n.state)?.name);
  if (!/^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/.test(identificador) || numero === null || !estado) return null;
  if (nos(n.comments).some((c) => texto(c.id).length > ID_COMENTARIO_MAX)) return null;
  const criada = quando(n.createdAt);
  // Quando entrou no estado atual: a última passagem do histórico para ele; sem histórico, a criação.
  const noEstadoDesde = nos(n.history).filter((h) => texto(obj(h.toState)?.name) === estado).reduce((m, h) => Math.max(m, quando(h.createdAt)), 0) || criada;
  return {
    identificador: identificador.toUpperCase(),
    numero,
    titulo: texto(n.title) || identificador,
    url: urlDoLinear(n.url),
    descricao: texto(n.description),
    estado,
    noEstadoDesde,
    etiquetas: nos(n.labels).map((l) => texto(l.name)).filter(Boolean),
    mae: texto(obj(n.parent)?.identifier) || null,
    bloqueadaPor: nos(n.inverseRelations).filter((r) => r.type === "blocks").map((r) => texto(obj(r.issue)?.identifier)).filter(Boolean),
    comentarios: nos(n.comments).map((c) => ({ id: texto(c.id), autor: texto(obj(c.user)?.name) || "Linear", texto: texto(c.body), criadoEm: quando(c.createdAt) })).filter((c) => c.id && c.texto)
      .sort((a, b) => a.criadoEm - b.criadoEm).slice(-COMENTARIOS_TRAZIDOS),
    anexos: nos(n.attachments).map((a) => ({ url: urlDoAnexo(a.url), criadoEm: quando(a.createdAt) })).filter((a) => a.url),
  };
}

/** O corpo do GraphQL dentro do `data` da ferramenta (o Composio às vezes aninha um `data` a mais). */
function pagina(d: No): { issues: No[]; depois: string | null } {
  if (Array.isArray(d.errors) && d.errors.length) throw new ErroDeDominio("conector_indisponivel");
  const raiz = obj(obj(d.data)?.issues) ? obj(d.data)! : d;
  const issues = obj(raiz.issues);
  if (!issues) throw new ErroDeDominio("conector_indisponivel");
  const info = obj(issues.pageInfo);
  return { issues: nos(issues), depois: info?.hasNextPage === true && typeof info.endCursor === "string" ? info.endCursor : null };
}

/** A FonteLinear sobre o Composio. `executarCom` recebe a chave cifrada do tenant e devolve o executor (só o adaptador decifra). */
export function criarFonteLinearComposio(executarCom: (chaveCifrada: string) => ExecutarComposio, o: { prazoMs?: number } = {}): FonteLinear {
  const prazoMs = o.prazoMs ?? PRAZO_PAGINA_LINEAR_MS;
  return {
    async listar(cred: CredencialLinear, p) {
      const executar = executarCom(cred.chaveCifrada);
      // Revisão 7 do PR #630: por identificador. Uma issue que muda durante a paginação pode voltar em duas páginas; fica
      // uma só, com a leitura mais nova (na posição em que apareceu primeiro).
      const todas = new Map<string, IssueLinear>();
      const semBacklog = p.filtro === "sem_backlog";
      const consulta = p.completo ? completa(semBacklog) : leve(semBacklog);
      const paginas = p.completo ? PAGINAS_COMPLETA : PAGINAS_LEVE;
      let depois: string | null = null;
      for (let k = 0; k < paginas; k++) {
        const d = await comPrazo(prazoMs, executar(FERRAMENTA_LINEAR, {
          userId: cred.userId, contaId: cred.contaId,
          argumentos: { query_or_mutation: consulta, variables: { time: p.time.toUpperCase(), depois } },
        }));
        const r = pagina(d);
        for (const n of r.issues) {
          const i = lerIssue(n);
          if (i) todas.set(i.identificador, i);
          else p.aoDescartar?.(/^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/.test(texto(n.identifier)) ? texto(n.identifier).toUpperCase() : null);
        }
        if (p.aoAvancar) await p.aoAvancar(todas.size);
        depois = r.depois;
        if (!depois) return [...todas.values()];
      }
      // Acabaram as páginas e o Linear ainda tem mais: a lista está incompleta e não pode passar por completa.
      throw new ErroDeDominio("limite_atingido", { cause: `linear: mais de ${todas.size} issues abertas` });
    },
  };
}
