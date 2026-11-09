import type { Agente } from "../contracts/agente.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { AutorLote, Quadro } from "../contracts/quadro.ts";
import type { PayloadPropostaAssumirQuadro, PreviaAssumir, ResultadoAssumir, RotinaDoAssumir } from "../contracts/quadro-assumir.ts";
import { colunasDe } from "../domain/colunas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { botsDoQuadro, idCurto, ROTINAS_FORA_PADRAO, rotinaFora, tituloDaRotina } from "../domain/quadro-assumir.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { pausarRotina } from "./pausar-rotina.ts";
import { acharQuadro, agentesDaPessoa, comMembros, eventoQuadro, experimentoLigado, falhaDoAchado, type FalhaQuadro } from "./quadro.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O quadro assume a esteira (definido em 2026-11-02, NOD-422, PR 2). Assumir lista as rotinas ativas dos bots do quadro
 * (src/domain/quadro-assumir.ts) e NADA pausa sem a confirmação da pessoa: pela conversa vira o card 'assumir_quadro'
 * (proposta e decisão, mesmo id); pela tela ela vê a mesma lista (GET .../quadro/assumir) e o clique é a confirmação, que
 * grava o mesmo card já decidido. Confirmar pausa as listadas que ainda estão ativas pelo pausarRotina de sempre e marca
 * `quadros.assumido_em`, tudo na mesma transação (falhou uma, nada muda). As pausadas ficam no payload (`pausadas`): o
 * Desfazer reativa só essas — nunca as que já estavam pausadas antes — e limpa `assumido_em`.
 */

type Falha = { ok: false; erro: FalhaQuadro; detalhe: string };
const falha = (erro: FalhaQuadro, detalhe: string): Falha => ({ ok: false, erro, detalhe });

/** A lista de exclusão do processo (NOD_QUADRO_ASSUMIR_FORA; o compor configura ao subir). Padrão: a bc381ef2. */
let ROTINAS_FORA: readonly string[] = ROTINAS_FORA_PADRAO;
export function configurarRotinasFora(fora: readonly string[]): void {
  ROTINAS_FORA = fora;
}

type Pedido = { autor: AutorLote; quadro?: string; anfitriaoId?: string; /** ADA-14: o `?quadro=` da tela. */ quadroDoBot?: string | null; turnoId?: string | null };
type Achado = { ok: true; quadro: Quadro; agentes: Agente[]; anfitriaoNome: string };

async function acharParaAssumir(deps: Deps, p: Pedido): Promise<Achado | Falha> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, { autor: p.autor, ops: [], executor: "catcher", turnoId: p.turnoId ?? null, ...(p.quadro !== undefined ? { quadro: p.quadro } : {}), ...(p.anfitriaoId ? { anfitriaoId: p.anfitriaoId } : {}), ...(p.quadroDoBot ? { quadroDoBot: p.quadroDoBot } : {}) }, agentes);
  if (!achado) return falha("sem_quadro", "não há quadro para assumir a esteira");
  if ("ambiguo" in achado || "semNome" in achado) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  const anfitriaoNome = agentes.find((a) => a.id === achado.agenteId)?.nome ?? (await deps.repos.agentes.buscar(achado.agenteId, true))?.nome ?? "quadro";
  return { ok: true, quadro: achado, agentes, anfitriaoNome };
}

/** As rotinas ativas dos bots do quadro (só as da pessoa), fora as da lista de exclusão. */
async function rotinasDoQuadro(deps: Deps, q: Quadro, agentes: readonly Agente[]): Promise<{ rotinas: RotinaDoAssumir[]; fora: number }> {
  const tarefas = await deps.repos.quadros.tarefas(q.id);
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  const rotinas: RotinaDoAssumir[] = [];
  let fora = 0;
  for (const agenteId of botsDoQuadro(q.agenteId, colunasDe(q), tarefas)) {
    if (!nomes.has(agenteId)) continue;
    for (const r of await deps.repos.rotinas.listarDoAgente(agenteId)) {
      if (r.ownerId !== deps.escopo.pessoaId || r.estado !== "ativa" || r.excluidoEm !== null) continue;
      if (rotinaFora(r.id, ROTINAS_FORA)) { fora++; continue; }
      rotinas.push({ id: r.id, agenteId, agenteNome: nomes.get(agenteId)!, titulo: tituloDaRotina(r.instrucao) });
    }
  }
  return { rotinas, fora };
}

const jaAssumiu = (nome: string) => falha("entrada_invalida", `o quadro do ${nome} já assumiu a esteira: para voltar, desfaça o assumir`);

/** A prévia da tela (GET .../quadro/assumir): a mesma lista do card. Só lê. */
export const previaAssumir: CasoDeUso<{ agenteId: string; quadro?: string | null }, PreviaAssumir | Falha> = async (deps, input) => {
  const a = await acharParaAssumir(deps, { autor: { tipo: "pessoa" }, anfitriaoId: input.agenteId, quadroDoBot: input.quadro ?? null });
  if (!a.ok) return { data: a };
  const { rotinas, fora } = await rotinasDoQuadro(deps, a.quadro, a.agentes);
  return { data: { ok: true, anfitriaoNome: a.anfitriaoNome, rotinas, fora, assumidoEm: await deps.repos.quadroImportacoes.assumidoEm(a.quadro.id) } };
};

export type PropostaDeAssumir = { ok: true; propostaId: string; payload: PayloadPropostaAssumirQuadro; jaAberto?: true } | Falha;

/** Grava o card (proposta + decisão, mesmo id) na conversa de quem pediu. */
async function criarCard(deps: Deps, a: Achado, lista: { rotinas: RotinaDoAssumir[]; fora: number }, onde: { agenteId: string; conversaId: string; turnoId: string | null; autoria: Autoria }) {
  const payload: PayloadPropostaAssumirQuadro = { kind: "assumir_quadro", quadroId: a.quadro.id, anfitriaoId: a.quadro.agenteId, anfitriaoNome: a.anfitriaoNome, rotinas: lista.rotinas, fora: lista.fora, ...(onde.turnoId ? { turnoId: onde.turnoId } : {}), pausadas: null, desfeitoEm: null };
  const proposta = await deps.repos.propostas.criar({ conversaId: onde.conversaId, agenteId: onde.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const agora = deps.agora();
  const n = lista.rotinas.length;
  const frase = `O quadro do ${a.anfitriaoNome} assume a esteira: ${n === 0 ? "nenhuma rotina a pausar" : `pausar ${n} ${n === 1 ? "rotina" : "rotinas"}`}`;
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "assumir_quadro", agenteId: onde.agenteId, conversaId: onde.conversaId, turnoId: onde.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: frase.slice(0, 500) });
  const ctx = { autoria: onde.autoria, agora, conversaId: onde.conversaId, ...(onde.turnoId ? { turnoId: onde.turnoId } : {}) };
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "proposta_criada", ...ctx, dados: { proposta_id: proposta.id, kind: "assumir_quadro" } })];
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", ...ctx, dados: { decisao_id: decisao.id, tipo: "assumir_quadro" } }));
  return { propostaId: proposta.id, payload, events };
}

/** O bot pediu assumir_quadro na conversa: abre o card com as rotinas. Nada pausa até a pessoa confirmar. */
export async function proporAssumirQuadro(deps: Deps, p: { agenteId: string; conversaId: string; turnoId: string; quadro?: string }): Promise<{ data: PropostaDeAssumir; events: RuntimeEvent[] }> {
  const a = await acharParaAssumir(deps, { autor: { tipo: "agente", agenteId: p.agenteId }, turnoId: p.turnoId, ...(p.quadro !== undefined ? { quadro: p.quadro } : {}) });
  if (!a.ok) return { data: a, events: [] };
  if (await deps.repos.quadroImportacoes.assumido(a.quadro.id)) return { data: jaAssumiu(a.anfitriaoNome), events: [] };
  const lista = await rotinasDoQuadro(deps, a.quadro, a.agentes);
  // O pedido repetido com a mesma lista reaproveita o card aberto (um só na Sua vez).
  const chave = (ids: readonly { id: string }[]) => ids.map((r) => r.id).sort().join(",");
  const aberto = (await deps.repos.propostas.assumirDoQuadro(a.quadro.id, "pendente")).find((x) => x.payload.kind === "assumir_quadro" && chave(x.payload.rotinas) === chave(lista.rotinas));
  if (aberto && aberto.payload.kind === "assumir_quadro") return { data: { ok: true, propostaId: aberto.id, payload: aberto.payload, jaAberto: true }, events: [] };
  const c = await criarCard(deps, a, lista, { agenteId: p.agenteId, conversaId: p.conversaId, turnoId: p.turnoId, autoria: autoriaDoAgente(deps.escopo, p.agenteId) });
  return { data: { ok: true, propostaId: c.propostaId, payload: c.payload }, events: c.events };
}

/**
 * O card decidido (POST decisoes/:id/decidir, ou o clique da tela). Recusar fecha sem mudar nada. Confirmar trava o
 * quadro (depois a proposta, a ordem do quadro_exclusao), pausa as listadas que seguem ativas e marca assumido_em. Quadro
 * removido ou já assumido: fecha como recusada e devolve `obsoleta` (a rota dá 409 depois do commit, o molde da NOD-159).
 * `soEstas` (a tela): só pausa as que a pessoa viu na prévia.
 */
export const decidirAssumirQuadro: CasoDeUso<{ decisaoId: string; recusar: boolean; soEstas?: readonly string[] }, { assumido: boolean; pausadas: string[]; obsoleta?: true }> = async (deps, input) => {
  const lida = await deps.repos.propostas.buscar(input.decisaoId);
  if (!lida || lida.payload.kind !== "assumir_quadro") throw new ErroDeDominio("nao_encontrado", { cause: "assumir o quadro" });
  const q = await deps.repos.quadros.buscarTravado(lida.payload.quadroId);
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "assumir_quadro") throw new ErroDeDominio("nao_encontrado", { cause: "assumir o quadro" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const payload = proposta.payload;
  const nome = payload.anfitriaoNome;
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  let texto = `Nada pausado: o quadro do ${nome} não assumiu a esteira.`;
  let pausadas: string[] | null = null;
  let obsoleta = false;
  if (!input.recusar) {
    if (!q) { obsoleta = true; texto = `O quadro do ${nome} já não existe: nada foi pausado.`; }
    else if (await deps.repos.quadroImportacoes.assumido(q.id)) { obsoleta = true; texto = `O quadro do ${nome} já tinha assumido a esteira: nada mais foi pausado.`; }
    else {
      pausadas = [];
      const so = input.soEstas ? new Set(input.soEstas) : null;
      for (const r of payload.rotinas) {
        if (so && !so.has(r.id)) continue;
        if (rotinaFora(r.id, ROTINAS_FORA)) continue;
        const atual = await deps.repos.rotinas.buscar(r.id);
        if (!atual || atual.estado !== "ativa" || atual.excluidoEm !== null) continue;
        const x = await pausarRotina(deps, { rotinaId: r.id, estado: "pausada", texto: `Pausada: o quadro do ${nome} assumiu a esteira.` });
        // Já estava pausada (a pessoa ou o varredor pausou entre a leitura e aqui): não entra no Desfazer, que só
        // reativa o que este assumir pausou. O pausarRotina volta sem eventos quando o estado não muda.
        if (x.events === undefined) continue;
        events.push(...x.events);
        pausadas.push(r.id);
      }
      if (!(await deps.repos.quadroImportacoes.marcarAssumido(q.id, agora))) throw new ErroDeDominio("nao_encontrado", { cause: "quadro" });
      events.push(eventoQuadro(deps, { autor: { tipo: "pessoa" }, conversaId: proposta.conversaId }, q, null, []));
      const n = pausadas.length;
      texto = `O quadro do ${nome} assumiu a esteira. ${n === 0 ? "Nenhuma rotina estava ativa para pausar." : `${n === 1 ? "Pausei 1 rotina" : `Pausei ${n} rotinas`}: ${pausadas.map(idCurto).join(", ")}.`} Desfazer reativa só ${n === 1 ? "essa" : "essas"}.`;
    }
  }
  const decidida = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
  await deps.repos.propostas.atualizarPayload(proposta.id, { ...payload, pausadas });
  await deps.repos.propostas.decidir(proposta.id, pausadas ? "confirmada" : "recusada");
  await recibo(deps, proposta.conversaId, texto, events);
  const autoria = autoriaPessoa(deps.escopo);
  events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decidida.turnoId, dados: { decisao_id: decidida.id, tipo: "assumir_quadro", recusada: pausadas === null } }));
  if (pausadas) log("info", "nod_quadro_assumido", { quadro_id: payload.quadroId, pausadas: pausadas.length });
  return { data: { assumido: pausadas !== null, pausadas: pausadas ?? [], ...(obsoleta ? { obsoleta: true as const } : {}) }, events: await comMembros(deps, events) };
};

/**
 * Desfazer o assumir: reativa as rotinas que o último assumir confirmado pausou e que seguem pausadas (a que a pessoa
 * excluiu ou já reativou fica como está) e limpa assumido_em. As que estavam pausadas antes do assumir nunca entram.
 */
export async function desfazerAssumir(deps: Deps, p: Pedido & { autoria?: Autoria }): Promise<{ data: { ok: true; reativadas: string[]; anfitriaoNome: string } | Falha; events: RuntimeEvent[] }> {
  const a = await acharParaAssumir(deps, p);
  if (!a.ok) return { data: a, events: [] };
  const q = await deps.repos.quadros.buscarTravado(a.quadro.id);
  if (!q || (await deps.repos.quadroImportacoes.assumidoEm(q.id)) === null) return { data: falha("entrada_invalida", `o quadro do ${a.anfitriaoNome} não assumiu a esteira: nada a desfazer`), events: [] };
  const proposta = (await deps.repos.propostas.assumirDoQuadro(q.id, "confirmada")).find((x) => x.payload.kind === "assumir_quadro" && !x.payload.desfeitoEm);
  const payload = proposta?.payload.kind === "assumir_quadro" ? proposta.payload : null;
  const events: RuntimeEvent[] = [];
  const reativadas: string[] = [];
  for (const id of payload?.pausadas ?? []) {
    const atual = await deps.repos.rotinas.buscar(id);
    if (!atual || atual.estado !== "pausada" || atual.excluidoEm !== null) continue;
    const x = await pausarRotina(deps, { rotinaId: id, estado: "ativa", texto: `Reativada: o quadro do ${a.anfitriaoNome} deixou de assumir a esteira.`, ...(p.autoria ? { autoria: p.autoria } : {}) });
    events.push(...(x.events ?? []));
    reativadas.push(id);
  }
  await deps.repos.quadroImportacoes.marcarAssumido(q.id, null);
  if (proposta && payload) {
    await deps.repos.propostas.atualizarPayload(proposta.id, { ...payload, desfeitoEm: deps.agora() });
    const n = reativadas.length;
    await recibo(deps, proposta.conversaId, `O quadro do ${a.anfitriaoNome} deixou de assumir a esteira. ${n === 0 ? "Nenhuma rotina a reativar." : `${n === 1 ? "Reativei 1 rotina" : `Reativei ${n} rotinas`}: ${reativadas.map(idCurto).join(", ")}.`}`, events);
  }
  events.push(eventoQuadro(deps, { autor: p.autor, conversaId: proposta?.conversaId ?? null, turnoId: p.turnoId ?? null }, q, null, []));
  log("info", "nod_quadro_assumir_desfeito", { quadro_id: q.id, reativadas: reativadas.length });
  return { data: { ok: true, reativadas, anfitriaoNome: a.anfitriaoNome }, events: await comMembros(deps, events) };
}

/**
 * A ação `quadro.assumir` pela tela. Sem `desfazer`, o clique é a confirmação: grava o card na conversa do anfitrião e o
 * decide na hora (só as rotinas da prévia que a pessoa viu, em `rotinas`). Com `desfazer`, desfaz.
 */
export async function assumirPelaTela(deps: Deps, p: { anfitriaoId: string; quadroDoBot?: string | null; desfazer?: boolean; rotinas?: readonly string[] }): Promise<{ data: ResultadoAssumir | Falha; events: RuntimeEvent[] }> {
  if (p.desfazer) {
    const d = await desfazerAssumir(deps, { autor: { tipo: "pessoa" }, anfitriaoId: p.anfitriaoId, quadroDoBot: p.quadroDoBot ?? null });
    if (!d.data.ok) return { data: d.data, events: d.events };
    return { data: { ok: true, assumidoEm: null, pausadas: [], reativadas: d.data.reativadas, propostaId: null }, events: d.events };
  }
  const a = await acharParaAssumir(deps, { autor: { tipo: "pessoa" }, anfitriaoId: p.anfitriaoId, quadroDoBot: p.quadroDoBot ?? null });
  if (!a.ok) return { data: a, events: [] };
  if (await deps.repos.quadroImportacoes.assumido(a.quadro.id)) return { data: jaAssumiu(a.anfitriaoNome), events: [] };
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(a.quadro.agenteId);
  if (!conversa) return { data: falha("nao_encontrado", "a conversa do bot anfitrião"), events: [] };
  const lista = await rotinasDoQuadro(deps, a.quadro, a.agentes);
  const c = await criarCard(deps, a, lista, { agenteId: a.quadro.agenteId, conversaId: conversa.id, turnoId: null, autoria: autoriaPessoa(deps.escopo) });
  const r = await decidirAssumirQuadro(deps, { decisaoId: c.propostaId, recusar: false, ...(p.rotinas ? { soEstas: p.rotinas } : {}) });
  if (!r.data.assumido) throw new ErroDeDominio("estado_invalido", { cause: "quadro mudou" });
  return { data: { ok: true, assumidoEm: deps.agora(), pausadas: r.data.pausadas, reativadas: [], propostaId: c.propostaId }, events: [...c.events, ...(r.events ?? [])] };
}

async function recibo(deps: Deps, conversaId: string, texto: string, events: RuntimeEvent[]): Promise<void> {
  const autoria = autoriaPessoa(deps.escopo);
  const msg = await deps.repos.mensagens.criar({ conversaId, autoria, kind: "sistema", assunto: "aprovacao.recibo", texto, confianca: "confiavel" });
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
}
