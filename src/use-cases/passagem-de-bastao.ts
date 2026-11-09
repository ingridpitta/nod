import type { Conector } from "../contracts/conector.ts";
import type { DesfechoDecisao } from "../contracts/decisao.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { entradaDoRetornoARefazer } from "../domain/cota-da-ia.ts";
import { FERRAMENTAS_NOD_COM_EFEITO, type DadosDaPassagem, type ItemDaPassagem } from "../domain/passagem-de-bastao.ts";
import { ehLinhaDeItemDeAprovacao } from "../domain/decisoes.ts";
import type { Deps } from "./tipos.ts";

/** NOD-310: o que a passagem lê, sempre com limite (a emissão do plano não pode ficar cara). */
export const FALAS_DA_PASSAGEM = 50;
/** Achado 2 do QA do PR #432: lê mais que as 50 para contar as omitidas (o teto da tela da task); acima, "mais de N". */
export const FALAS_LIDAS = 300;
export const TURNOS_DA_PASSAGEM = 60;

/** Revisão do PR #432: dispensar ou expirar não é responder; a IA nova não pode supor que houve resposta. */
const COMO_SAIU: Record<DesfechoDecisao["tipo"], string> = {
  decidida: "respondida",
  decidida_por_regra: "decidida por regra",
  expirou_sem_ninguem_ver: "expirou sem resposta",
  expirou_com_alguem_ciente: "expirou sem resposta",
  dispensada: "dispensada pela pessoa, sem resposta",
};

const hora = (em: number) => new Date(em).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * Os nomes da trilha (`${slug}__${tool}`, nomeParaTrilha) das capacidades de conector que ESCREVEM (sem `readOnlyHint`).
 * O que a sonda marcou como leitura nunca vira "efeito externo".
 */
export function capacidadesQueEscrevem(conectores: readonly Pick<Conector, "slug" | "catalogo">[]): Set<string> {
  const nomes = new Set<string>();
  for (const c of conectores) for (const cap of c.catalogo ?? []) if (!cap.readOnlyHint) nomes.add(`${c.slug}__${cap.nome}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120));
  return nomes;
}

/**
 * NOD-310 (emenda da ADR-108 §5): os dados do trabalho para a passagem de bastão — o pedido da raiz, as falas, as
 * decisões, os erros e os efeitos externos. Só lê o banco; nunca chama IA. `conectores` = o registro já lido pela emissão.
 */
export async function dadosDaPassagem(deps: Pick<Deps, "repos">, trabalho: Pick<Trabalho, "id" | "agenteId">, conectores: readonly Pick<Conector, "slug" | "catalogo">[]): Promise<DadosDaPassagem> {
  const { repos } = deps;
  const turnos = (await repos.turnos.doTrabalho(trabalho.id)).slice(-TURNOS_DA_PASSAGEM);
  const primeiro: Turno | undefined = turnos[0];
  const raiz = primeiro ? ((primeiro.retomaTurnoId ? await repos.turnos.raizDaCadeia(primeiro.id) : null) ?? primeiro) : null;
  const pedidoOriginal = raiz ? entradaDoRetornoARefazer(raiz.entradaTexto) : null;

  const [mensagens, trilha, decisoes] = await Promise.all([
    repos.mensagens.doTrabalho(trabalho.id, FALAS_LIDAS),
    repos.trilha.doTurnos(turnos.map((t) => t.id)),
    Promise.all(turnos.map((t) => repos.decisoes.doTurno(t.id))).then((l) => l.flat()),
  ]);
  const itens = (await Promise.all(decisoes.map(async (d) => ({ d, itens: d.tipo === "aprovacao" ? await repos.itensAprovacao.listar(d.id) : [] }))));

  const feito: ItemDaPassagem[] = [];
  const respostas: ItemDaPassagem[] = [];
  const erros: ItemDaPassagem[] = [];
  const efeitos: ItemDaPassagem[] = [];

  // As mais recentes primeiro (o repo devolve assim); só as FALAS_DA_PASSAGEM primeiras entram, as outras viram contagem.
  const recentes = [...mensagens].sort((a, b) => b.criadoEm - a.criadoEm);
  const omitidas = { feito: 0, decisoes: 0, aoMenos: mensagens.length >= FALAS_LIDAS };
  let usadas = 0;
  for (const m of recentes) {
    if (m.kind !== "texto" || m.texto.trim() === "") continue;
    // A fala que abriu o trabalho já vai como pedido original.
    if (m.autoria.autor_tipo === "pessoa" && raiz && m.id === raiz.mensagemOrigemId) continue;
    if (usadas >= FALAS_DA_PASSAGEM) {
      if (m.autoria.autor_tipo === "pessoa") omitidas.decisoes += 1;
      else omitidas.feito += 1;
      continue;
    }
    usadas += 1;
    const deFora = m.confianca !== "confiavel" || (m.autoria.autor_tipo === "agente" && m.autoria.autor_id !== trabalho.agenteId);
    if (m.autoria.autor_tipo === "pessoa") {
      respostas.push({ texto: `A pessoa: ${m.texto}`, em: m.criadoEm, ...(deFora ? { deFora } : {}) });
    } else {
      feito.push({ texto: m.texto, em: m.criadoEm, ...(deFora ? { deFora } : {}) });
    }
  }

  for (const { d, itens: lista } of itens) {
    const em = Date.parse(d.criadoEm);
    for (const i of lista) {
      const alvo = `${i.destino.conector}/${i.destino.ferramenta}`;
      if (i.desfecho === "executado") efeitos.push({ texto: `${alvo} (aprovado e executado): ${i.textoFinal}`, em });
      else if (i.desfecho === "falhou_na_execucao") erros.push({ texto: `${alvo} falhou ao executar: ${i.textoFinal}`, em });
      else if (i.desfecho === "retirado_pela_pessoa" || i.desfecho === "sensivel_nao_aprovado") respostas.push({ texto: `A pessoa não aprovou ${alvo}: ${i.textoFinal}`, em });
    }
    if (d.tipo !== "aprovacao" && d.desfecho) {
      const como = COMO_SAIU[d.desfecho.tipo];
      respostas.push({ texto: `${d.tipo === "pergunta" ? "Pergunta" : d.tipo} (${como}): ${d.frase}`, em });
    }
  }

  for (const t of turnos) {
    if (t.motivoFalha) erros.push({ texto: `Turno falhou (${t.motivoFalha}).`, em: t.criadoEm });
    else if (t.estado === "interrompido" && t.motivoInterrupcao) erros.push({ texto: `Turno interrompido (${t.motivoInterrupcao}).`, em: t.criadoEm });
  }

  const escrevem = capacidadesQueEscrevem(conectores);
  const porFerramenta = new Map<string, { vezes: number; ultima: number }>();
  for (const l of trilha) {
    // NOD-70: cartão, clique e lote já entram abaixo pelo item de aprovação; a linha da trilha deles não conta de novo.
    if (ehLinhaDeItemDeAprovacao(l)) continue;
    const em = Date.parse(l.em);
    if (l.kind === "negacao") { erros.push({ texto: `Negado: ${l.ferramenta}${l.motivo ? ` (${l.motivo})` : ""}.`, em }); continue; }
    if (l.kind !== "tool_call" || !(escrevem.has(l.ferramenta) || FERRAMENTAS_NOD_COM_EFEITO.has(l.ferramenta))) continue;
    const atual = porFerramenta.get(l.ferramenta);
    porFerramenta.set(l.ferramenta, { vezes: (atual?.vezes ?? 0) + 1, ultima: Math.max(atual?.ultima ?? 0, em) });
  }
  for (const [ferramenta, { vezes, ultima }] of porFerramenta) efeitos.push({ texto: `${ferramenta}: chamada ${vezes}× (a última às ${hora(ultima)}).`, em: ultima });

  return { pedidoOriginal, feito, decisoes: respostas, erros, efeitos, omitidas };
}
