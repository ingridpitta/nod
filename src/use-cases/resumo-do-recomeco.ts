import type { Conector } from "../contracts/conector.ts";
import type { Turno } from "../contracts/turno.ts";
import type { ItemDaPassagem } from "../domain/passagem-de-bastao.ts";
import { FERRAMENTAS_NOD_COM_EFEITO } from "../domain/passagem-de-bastao.ts";
import type { DadosDoResumo } from "../domain/recomeco.ts";
import { redigirSegredos } from "../domain/segredos.ts";
import { capacidadesQueEscrevem } from "./passagem-de-bastao.ts";
import { ehLinhaDeItemDeAprovacao } from "../domain/decisoes.ts";
import type { Deps } from "./tipos.ts";

/** NOD-312: quantos turnos de conversa anteriores o resumo do recomeço lê (a emissão do plano não pode ficar cara). */
export const TURNOS_DO_RESUMO = 8;

/**
 * NOD-312: os dados do resumo do trabalho para o turno de conversa que recomeçou sem a sessão — o mesmo mecanismo da
 * passagem de bastão da NOD-310 (emenda da ADR-108 §5), lido dos turnos de conversa do bot nesta conversa. Só o registro
 * do nod: nomes de ferramenta e contagens (a trilha não guarda a saída), desfechos das aprovações e das perguntas, e os
 * turnos que falharam. As falas não entram (já vão no histórico). Só lê o banco; nunca chama IA. A redação de segredos
 * é feita no domínio (montarResumoDoRecomeco), sobre tudo.
 */
export async function dadosDoResumo(deps: Pick<Deps, "repos">, turnos: readonly Turno[], conectores: readonly Pick<Conector, "slug" | "catalogo">[]): Promise<DadosDoResumo> {
  const { repos } = deps;
  const ids = turnos.map((t) => t.id);
  const [trilha, decisoes] = await Promise.all([
    ids.length ? repos.trilha.doTurnos(ids) : Promise.resolve([]),
    Promise.all(ids.map((id) => repos.decisoes.doTurno(id))).then((l) => l.flat()),
  ]);
  const itens = await Promise.all(decisoes.map(async (d) => ({ d, itens: d.tipo === "aprovacao" ? await repos.itensAprovacao.listar(d.id) : [] })));

  const ferramentas: ItemDaPassagem[] = [];
  const efeitos: ItemDaPassagem[] = [];
  const erros: ItemDaPassagem[] = [];
  const respostas: ItemDaPassagem[] = [];

  const escrevem = capacidadesQueEscrevem(conectores);
  const porFerramenta = new Map<string, { vezes: number; ultima: number; efeito: boolean }>();
  for (const l of trilha) {
    // NOD-70: cartão, clique e lote já entram abaixo pelo item de aprovação; a linha da trilha deles não conta de novo.
    if (ehLinhaDeItemDeAprovacao(l)) continue;
    const em = Date.parse(l.em);
    if (l.kind === "negacao") { erros.push({ texto: `Negado: ${l.ferramenta}${l.motivo ? ` (${l.motivo})` : ""}.`, em }); continue; }
    if (l.kind !== "tool_call") continue;
    const atual = porFerramenta.get(l.ferramenta);
    porFerramenta.set(l.ferramenta, { vezes: (atual?.vezes ?? 0) + 1, ultima: Math.max(atual?.ultima ?? 0, em), efeito: escrevem.has(l.ferramenta) || FERRAMENTAS_NOD_COM_EFEITO.has(l.ferramenta) });
  }
  for (const [ferramenta, { vezes, ultima, efeito }] of porFerramenta) {
    (efeito ? efeitos : ferramentas).push({ texto: `${ferramenta} × ${vezes}`, em: ultima });
  }

  for (const { d, itens: lista } of itens) {
    const em = Date.parse(d.criadoEm);
    for (const i of lista) {
      const alvo = `${i.destino.conector}/${i.destino.ferramenta}`;
      if (i.desfecho === "executado") efeitos.push({ texto: `${alvo} (aprovado e executado): ${umaLinha(i.textoFinal)}`, em });
      else if (i.desfecho === "falhou_na_execucao") erros.push({ texto: `${alvo} falhou ao executar.`, em });
      else if (i.desfecho === "retirado_pela_pessoa" || i.desfecho === "sensivel_nao_aprovado") respostas.push({ texto: `A pessoa não aprovou ${alvo}.`, em });
    }
    if (d.tipo === "pergunta" && d.desfecho) respostas.push({ texto: `Pergunta (${d.desfecho.tipo === "decidida" ? "respondida" : "sem resposta"}): ${umaLinha(d.frase, 200)}`, em });
  }

  for (const t of turnos) {
    if (t.motivoFalha) erros.push({ texto: `Turno falhou (${t.motivoFalha}).`, em: t.criadoEm });
    // Revisão 7: a sessão recusada é o próprio recomeço (já dito no aviso), não um erro do trabalho.
    else if (t.estado === "interrompido" && t.motivoInterrupcao && t.motivoInterrupcao !== "sessao_rejeitada" && t.motivoInterrupcao !== "absorvido") erros.push({ texto: `Turno interrompido (${t.motivoInterrupcao}).`, em: t.criadoEm });
  }
  return { ferramentas, efeitos, erros, decisoes: respostas };
}

/** Revisão 1 (baixo 7): do texto do efeito, só a 1ª linha e no máximo 120 caracteres — o resumo não carrega corpo de e-mail ou de comentário. */
// Revisão 5: redige ANTES de cortar (domain/segredos.ts) — o corte no meio de um token deixava o pedaço passar.
export function umaLinha(texto: string, teto = 120): string {
  const linha = redigirSegredos((texto.split("\n").find((l) => l.trim() !== "") ?? "").trim());
  return linha.length > teto ? `${linha.slice(0, teto - 1)}…` : linha;
}
