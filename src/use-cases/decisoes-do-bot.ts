import type { DecisaoDto, DecisoesDto } from "../contracts/decisoes-do-bot.ts";
import type { LinhaTrilha } from "../db/schema/trilha.ts";
import {
  appEAcao,
  cabecalhoCsv,
  DESFECHOS_DECISAO,
  desfechoDoKind,
  DIAS_MAX_CSV,
  diasNoPeriodo,
  faixaDoPeriodo,
  type FiltroDecisao,
  FILTROS_DECISAO,
  fraseDaDecisao,
  KIND_DO_DESFECHO,
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  linhaCsv,
  LINHAS_MAX_CSV,
  nomeDoCsv,
  validarCursor,
} from "../domain/decisoes.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { diaValido } from "../domain/item-de-atividade.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaDecisoes = { agenteId: string; de: string; ate: string; fuso: string; desfecho?: string; cursor?: string; limite?: number };

/**
 * O bot (só o do dono: outro bot é 404, como na Atividade), a faixa [de, ate+1) no fuso e os kinds do filtro. `de` > `ate`
 * ou datas inválidas: 400; fuso desconhecido: 400 `fuso_invalido`; filtro desconhecido: 400.
 */
async function recorte(deps: Deps, input: EntradaDecisoes, diasMax: number | null) {
  if (!diaValido(input.de) || !diaValido(input.ate)) {
    throw new ErroDeDominio("entrada_invalida", { cause: "periodo" });
  }
  const dias = diasNoPeriodo(input.de, input.ate);
  if (dias < 1 || (diasMax !== null && dias > diasMax)) throw new ErroDeDominio("entrada_invalida", { cause: "periodo" });
  const filtro = (input.desfecho ?? "tudo") as FiltroDecisao;
  if (!FILTROS_DECISAO.includes(filtro)) throw new ErroDeDominio("entrada_invalida", { cause: "desfecho" });
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  let faixa: { desde: number; ate: number };
  try {
    faixa = faixaDoPeriodo(input.de, input.ate, input.fuso);
  } catch {
    throw new ErroDeDominio("fuso_invalido");
  }
  const kinds = filtro === "tudo" ? DESFECHOS_DECISAO.map((d) => KIND_DO_DESFECHO[d]) : [KIND_DO_DESFECHO[filtro]];
  return { agente, faixa, kinds };
}

export function decisaoDaLinha(l: LinhaTrilha): DecisaoDto {
  const { app, acao } = appEAcao(l.ferramenta);
  return {
    id: l.id,
    em: l.em,
    desfecho: desfechoDoKind(l.kind) ?? "permitida",
    app,
    acao,
    ferramenta: l.ferramenta,
    conectorId: l.conectorId,
    frase: fraseDaDecisao(l),
    regra: l.regra,
    regraVersao: l.regraVersao,
    motivo: l.motivo,
  };
}

/** GET agentes/:id/decisoes: uma página (padrão 100, até 500), as mais novas primeiro, e a contagem do período. */
export const lerDecisoes: CasoDeUso<EntradaDecisoes, DecisoesDto> = async (deps, input) => {
  const limite = input.limite ?? LIMITE_PADRAO;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) throw new ErroDeDominio("entrada_invalida", { cause: "limite" });
  let cursor: string | null = null;
  if (input.cursor !== undefined && input.cursor !== "") {
    cursor = validarCursor(input.cursor);
    if (!cursor) throw new ErroDeDominio("entrada_invalida", { cause: "cursor" });
  }
  // O mesmo teto do CSV: a contagem do período varre a faixa inteira (revisão: período sem teto era consulta sem fim).
  const r = await recorte(deps, input, DIAS_MAX_CSV);
  const [linhas, porKind, haAntes] = await Promise.all([
    deps.repos.trilha.decisoesDoAgente({ agenteId: r.agente.id, ...r.faixa, kinds: r.kinds, cursor, limite: limite + 1 }),
    deps.repos.trilha.contarDecisoesDoAgente({ agenteId: r.agente.id, ...r.faixa }),
    deps.repos.trilha.temDecisaoAntes({ agenteId: r.agente.id, antes: r.faixa.desde }),
  ]);
  const pagina = linhas.slice(0, limite);
  return {
    data: {
      de: input.de,
      ate: input.ate,
      linhas: pagina.map(decisaoDaLinha),
      contagem: { permitida: porKind.tool_call ?? 0, negada: porKind.negacao ?? 0, cartao: porKind.cartao ?? 0 },
      proximo: linhas.length > limite ? (pagina.at(-1)?.id ?? null) : null,
      haAntes,
    },
  };
};

export type CsvDasDecisoes = { nome: string; corpo: string; linhas: number; cortado: boolean };

const LOTE_CSV = 5_000;

/**
 * GET agentes/:id/decisoes.csv: o período inteiro (até 31 dias), com o mesmo filtro da tela, em lotes de 5 mil pelo
 * cursor, até 50 mil linhas (`cortado` diz se parou no teto). UTF-8 com BOM, CRLF, fórmula escapada, hora no fuso.
 */
export const exportarDecisoesCsv: CasoDeUso<EntradaDecisoes, CsvDasDecisoes> = async (deps, input) => {
  const r = await recorte(deps, input, DIAS_MAX_CSV);
  const partes: string[] = [cabecalhoCsv()];
  let cursor: string | null = null;
  let total = 0;
  let cortado = false;
  for (;;) {
    const falta = LINHAS_MAX_CSV - total;
    const lote = await deps.repos.trilha.decisoesDoAgente({ agenteId: r.agente.id, ...r.faixa, kinds: r.kinds, cursor, limite: Math.min(LOTE_CSV, falta) + 1 });
    const usar = lote.slice(0, Math.min(LOTE_CSV, falta));
    for (const l of usar) partes.push(`${linhaCsv(l, input.fuso)}\r\n`);
    total += usar.length;
    if (lote.length <= usar.length) break;
    if (total >= LINHAS_MAX_CSV) {
      cortado = true;
      break;
    }
    cursor = usar.at(-1)?.id ?? null;
  }
  return { data: { nome: nomeDoCsv(r.agente.nome, input.de, input.ate), corpo: partes.join(""), linhas: total, cortado } };
};
