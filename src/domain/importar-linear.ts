import { LIMITES_LABEL } from "../contracts/quadro-labels.ts";
import type { ColunaQuadro, GrupoColuna, IdColuna } from "../contracts/quadro.ts";
import type { ComentarioLinear, FiltroImportacao, IssueLinear, PreviaImportacao } from "../contracts/quadro-importacao.ts";
import { LIMITES_QUADRO } from "../contracts/quadro.ts";
import { normalizarNome, validarColunas } from "./colunas.ts";
import { FUSO_DA_PESSOA_PADRAO } from "./ritmo-rotina.ts";

/**
 * Trazer um time do Linear para o quadro, puro (definido em 2026-11-02, NOD-422; decisões da Ada no comentário 🧭 de
 * 03:01 e 03:34). Os estados do Linear viram colunas 1 para 1 com os mesmos nomes; cada issue aberta vira uma tarefa com
 * a descrição (cortada com o link), uma linha de topo (etiquetas, mãe, bloqueada por), os últimos 10 comentários, o PR
 * mais recente e o mesmo número. Nada aqui fala com o Linear: o adaptador busca, este módulo decide.
 */

/** Acima disto a importação recusa e pede um filtro (decisão 4 da Ada). */
export const LIMITE_IMPORTACAO = 500;
/**
 * Revisão do PR #630 (definido em 2026-11-02): uma importação 'trazendo' sem progresso há mais que isto caiu (o processo
 * reiniciou no meio). A próxima tentativa a marca 'falhou' e a tela já a mostra parada. Cada página do Linear grava o
 * progresso (atualizado_em), então uma busca viva nunca fica tanto tempo sem tocar a linha.
 */
export const IMPORTACAO_PARADA_MS = 10 * 60_000;
export const ERRO_IMPORTACAO_PARADA = "A importação parou sem terminar: nada mudou no quadro. Pode trazer de novo.";
/** A importação trazendo que parou de andar (sem progresso há mais de IMPORTACAO_PARADA_MS). */
export function importacaoParada(i: { estado: string; atualizadoEm: number }, agora: number): boolean {
  return i.estado === "trazendo" && agora - i.atualizadoEm > IMPORTACAO_PARADA_MS;
}
/** Só os últimos comentários vêm; o resto fica no Linear (decisão 5). */
export const COMENTARIOS_POR_TAREFA = 10;
/** A etiqueta do Linear que deixa a tarefa esperando a pessoa (ADR-162: na coluna do estado). */
export const ETIQUETA_PRECISA_HUMANO = "precisa-humano";
export type { ComentarioLinear, FiltroImportacao, IssueLinear, PreviaImportacao };

/** Uma linha da tabela da issue: o estado do Linear, a coluna do quadro e quem cuida dela (pelo nome do bot). */
export type EstadoNoQuadro = { estado: string; coluna: IdColuna; nome: string; grupo: GrupoColuna; responsavel: string | null };

export const MAPA_DE_ESTADOS: readonly EstadoNoQuadro[] = [
  { estado: "Backlog", coluna: "backlog", nome: "Backlog", grupo: "nao_iniciado", responsavel: null },
  { estado: "Priorizado", coluna: "afazer", nome: "Priorizado", grupo: "nao_iniciado", responsavel: "Ada" },
  { estado: "Detalhamento de produto", coluna: "c-detalhamento", nome: "Detalhamento", grupo: "iniciado", responsavel: "Ada" },
  { estado: "Prototipando", coluna: "c-prototipando", nome: "Prototipando", grupo: "iniciado", responsavel: "Gil" },
  { estado: "Pronto para engenharia", coluna: "c-pronto-eng", nome: "Pronto para engenharia", grupo: "iniciado", responsavel: "Faustino" },
  { estado: "Plano de engenharia", coluna: "c-plano-eng", nome: "Plano de engenharia", grupo: "iniciado", responsavel: "Faustino" },
  { estado: "Implementando", coluna: "fazendo", nome: "Implementando", grupo: "iniciado", responsavel: "Faustino" },
  // Decisão 6 da Ada (03:34): o Faustino revisa de ponta a ponta; se um Revisor voltar, troca-se na coluna.
  { estado: "Revisando", coluna: "revisao", nome: "Revisando", grupo: "iniciado", responsavel: "Faustino" },
  { estado: "QA", coluna: "c-qa", nome: "QA", grupo: "iniciado", responsavel: "Teodora" },
  { estado: "Lançando", coluna: "c-lancando", nome: "Lançando", grupo: "iniciado", responsavel: "Lançador" },
];

const POR_ESTADO = new Map(MAPA_DE_ESTADOS.map((e) => [normalizarNome(e.estado), e]));

/** O estado do Linear na coluna da tabela; estado novo cai em Backlog com a nota. */
export function colunaDoEstado(estado: string): { coluna: IdColuna; nota: string | null } {
  const e = POR_ESTADO.get(normalizarNome(estado));
  return e ? { coluna: e.coluna, nota: null } : { coluna: "backlog", nota: `estado ${estado} do Linear sem coluna` };
}

/**
 * As colunas do quadro depois da importação: as da tabela (renomeando as padrão que elas reaproveitam), com o
 * responsável padrão de cada uma resolvido entre os bots da pessoa (bot que não existe deixa a coluna sem ninguém; a
 * coluna que já tinha responsável ou passagem fica com os dela), e as
 * nativas que já existiam no lugar delas. A ordem é a dos grupos.
 */
export function colunasDaImportacao(atuais: readonly ColunaQuadro[], agentes: readonly { id: string; nome: string }[]): ColunaQuadro[] | { erro: string } {
  const doBot = (nome: string | null) => (nome ? agentes.find((a) => normalizarNome(a.nome) === normalizarNome(nome))?.id ?? null : null);
  const daTabela = new Set(MAPA_DE_ESTADOS.map((e) => e.coluna));
  const grupos: GrupoColuna[] = ["nao_iniciado", "iniciado", "feito", "fechado"];
  const saida: ColunaQuadro[] = [];
  for (const g of grupos) {
    for (const e of MAPA_DE_ESTADOS.filter((x) => x.grupo === g)) {
      const atual = atuais.find((c) => c.id === e.coluna);
      // Revisão do PR #630: a coluna que já existe guarda o responsável e a passagem que a pessoa pôs; o padrão da tabela
      // só preenche o que está vazio.
      const responsavel = atual?.responsavel || doBot(e.responsavel);
      saida.push({ ...(atual ?? {}), id: e.coluna, nome: e.nome, grupo: g, ...(responsavel ? { responsavel } : {}) });
    }
    const nativas = atuais.filter((c) => c.grupo === g && !daTabela.has(c.id));
    saida.push(...nativas.filter((c) => c.id !== "voce").map((c) => ({ ...c })));
  }
  const e = validarColunas(saida);
  return e ?? saida;
}

/** A tarefa que a issue vira. `status` é o id da coluna; precisa-humano fica esperando a pessoa (`voce`, ADR-162) na coluna do estado (`voltarPara`). */
export type ItemImportado = {
  identificador: string;
  numero: number;
  titulo: string;
  url: string | null;
  descricao: string;
  status: IdColuna;
  voltarPara: IdColuna | null;
  prUrl: string | null;
  estadoLinear: string;
  noEstadoDesde: number;
  comentarios: ComentarioLinear[];
  /** 0159: as etiquetas da issue, que viram labels da tarefa nova (as que cabem no nome da label). */
  etiquetas: string[];
};

const sufixoDoCorte = (url: string | null) => (url ? `\n\n… continua no Linear: ${url}` : "\n\n… continua no Linear");

/** Corta o texto no teto com o link para o resto (o corte nunca passa do teto, nem com o sufixo). */
export function cortarComLink(texto: string, url: string | null, teto: number = LIMITES_QUADRO.descricao): string {
  if (texto.length <= teto) return texto;
  const sufixo = sufixoDoCorte(url);
  return texto.slice(0, Math.max(0, teto - sufixo.length)).trimEnd() + sufixo;
}

/** A linha do topo da descrição: o que ainda não é propriedade de verdade fica como texto (fora de escopo da issue). */
export function linhaDeTopo(i: Pick<IssueLinear, "etiquetas" | "mae" | "bloqueadaPor">, nota: string | null): string {
  const partes = [
    ...(i.etiquetas.length ? [`Etiquetas: ${i.etiquetas.join(", ")}`] : []),
    ...(i.mae ? [`Mãe: ${i.mae}`] : []),
    ...(i.bloqueadaPor.length ? [`Bloqueada por: ${i.bloqueadaPor.join(", ")}`] : []),
    ...(nota ? [`Nota: ${nota}`] : []),
  ];
  return partes.join(" · ");
}

const PR_DO_GITHUB = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+(?:[/?#].*)?$/i;

/** O PR do GitHub anexado mais recente (só a URL do PR, sem o resto do caminho). */
export function prMaisRecente(anexos: IssueLinear["anexos"]): string | null {
  const prs = anexos.filter((a) => PR_DO_GITHUB.test(a.url)).sort((a, b) => b.criadoEm - a.criadoEm);
  const url = prs[0]?.url.match(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i)?.[0] ?? null;
  return url && url.length <= LIMITES_QUADRO.url ? url : null;
}

const temEtiqueta = (i: Pick<IssueLinear, "etiquetas">, nome: string) => i.etiquetas.some((e) => normalizarNome(e) === normalizarNome(nome));

export function itemDaIssue(i: IssueLinear): ItemImportado {
  const { coluna, nota } = colunaDoEstado(i.estado);
  const topo = linhaDeTopo(i, nota);
  const corpo = [topo, i.descricao.trim()].filter(Boolean).join("\n\n");
  const precisa = temEtiqueta(i, ETIQUETA_PRECISA_HUMANO);
  // QA do PR #630: o vazio sai ANTES do corte; os 10 que vêm são os 10 últimos com texto.
  const comentarios = i.comentarios.filter((c) => c.texto.trim().length > 0).sort((a, b) => a.criadoEm - b.criadoEm).slice(-COMENTARIOS_POR_TAREFA)
    .map((c) => ({ ...c, texto: cortarComLink(c.texto, i.url, LIMITES_QUADRO.comentario) }));
  return {
    identificador: i.identificador,
    numero: i.numero,
    titulo: i.titulo.trim().slice(0, LIMITES_QUADRO.titulo) || i.identificador,
    url: i.url,
    descricao: cortarComLink(corpo, i.url),
    status: precisa ? "voce" : coluna,
    voltarPara: precisa ? coluna : null,
    prUrl: prMaisRecente(i.anexos),
    estadoLinear: i.estado,
    noEstadoDesde: i.noEstadoDesde,
    comentarios,
    etiquetas: i.etiquetas.map((e) => e.trim().replace(/\s+/g, " ")).filter((e) => e.length > 0 && e.length <= LIMITES_LABEL.nome).slice(0, LIMITES_LABEL.porTarefa),
  };
}

const DIA_E_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_DA_PESSOA_PADRAO, day: "2-digit", month: "2-digit" });

/** A linha do histórico da tarefa importada (vira o início do tempo em coluna). O dia é o de São Paulo, como o resto do quadro. */
export function linhaDoLinear(estado: string, desde: number): string {
  return `No Linear em ${estado} desde ${DIA_E_MES.format(new Date(desde))}`;
}

/** O que o filtro deixa vir: sem_backlog tira o Backlog (a oferta quando passa de 500). */
export function passaNoFiltro(i: Pick<IssueLinear, "estado">, filtro: FiltroImportacao | null): boolean {
  return filtro !== "sem_backlog" || colunaDoEstado(i.estado).coluna !== "backlog";
}

/**
 * A prévia por coluna. Revisão 4 do PR #630: cada issue conta numa coluna só, a mesma do aplicarImportacao (itemDaIssue):
 * ADR-162: a precisa-humano conta na coluna do estado (é onde o card aparece, esperando a pessoa); a soma das colunas é o
 * total e `precisamDeVoce` diz quantas esperam.
 */
export function previaDaImportacao(issues: readonly Pick<IssueLinear, "estado" | "etiquetas">[], responsaveis: ReadonlyMap<IdColuna, string>): PreviaImportacao {
  const n = new Map<IdColuna, number>();
  const semColuna = new Set<string>();
  let precisamDeVoce = 0;
  for (const i of issues) {
    const { coluna, nota } = colunaDoEstado(i.estado);
    if (nota) semColuna.add(i.estado);
    const precisa = temEtiqueta(i, ETIQUETA_PRECISA_HUMANO);
    if (precisa) precisamDeVoce++;
    n.set(coluna, (n.get(coluna) ?? 0) + 1);
  }
  return {
    total: issues.length,
    colunas: MAPA_DE_ESTADOS.map((e) => ({ coluna: e.coluna, nome: e.nome, estado: e.estado, tarefas: n.get(e.coluna) ?? 0, responsavel: responsaveis.get(e.coluna) ?? null })),
    precisamDeVoce,
    semColuna: [...semColuna].sort(),
  };
}

/**
 * O número de cada importada: o mesmo do Linear (NOD-422 continua NOD-422) se estiver livre ou já for dela; se uma
 * tarefa nativa usa o número, a importada ganha um novo depois do maior (e o NOD-xxx do Linear ainda a acha pelo
 * linear_id). `reservados` = os números que um código guardado com o prefixo já usa: contam como ocupados. Devolve
 * também o próximo número livre do quadro.
 */
export function numerosDaImportacao(
  itens: readonly { identificador: string; numero: number }[],
  existentes: readonly { numero: number | null; linearId: string | null }[],
  proximoAtual: number,
  reservados: readonly number[] = [],
): { numeros: Map<string, number>; proximo: number } {
  const chave = (s: string) => s.trim().toLowerCase();
  const dono = new Map<number, string | null>();
  for (const t of existentes) if (t.numero !== null) dono.set(t.numero, t.linearId ? chave(t.linearId) : null);
  // O número de um código guardado (tarefa excluída, que saiu do quadro, código antigo) não volta para outra tarefa.
  for (const n of reservados) if (!dono.has(n)) dono.set(n, null);
  const jaTem = new Map(existentes.filter((t) => t.linearId && t.numero !== null).map((t) => [chave(t.linearId!), t.numero!]));
  const numeros = new Map<string, number>();
  const colididos: string[] = [];
  for (const i of itens) {
    const k = chave(i.identificador);
    const meu = jaTem.get(k);
    if (meu !== undefined) { numeros.set(i.identificador, meu); continue; }
    if (i.numero > 0 && !dono.has(i.numero)) { dono.set(i.numero, k); numeros.set(i.identificador, i.numero); continue; }
    colididos.push(i.identificador);
  }
  let proximo = Math.max(proximoAtual, 1, ...[...dono.keys()].map((x) => x + 1));
  for (const id of colididos) { numeros.set(id, proximo); dono.set(proximo, chave(id)); proximo++; }
  return { numeros, proximo };
}

const URL_DO_LINEAR = /^https?:\/\/linear\.app\/[\w-]+\/issue\/([a-z][a-z0-9]{0,9}-\d+)(?:[/?#].*)?$/i;

/** A URL de uma issue do Linear vira o identificador (NOD-422); qualquer outro texto, null. */
export function identificadorDaUrl(texto: string): string | null {
  const m = texto.trim().match(URL_DO_LINEAR);
  return m ? m[1]!.toUpperCase() : null;
}
