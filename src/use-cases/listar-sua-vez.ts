import type { SuaVezDto } from "../contracts/api.ts";
import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { PedidoDoItem } from "../contracts/pedido.ts";
import type { Turno } from "../contracts/turno.ts";
import { nuncaPermanente as ehNuncaPermanente } from "../domain/aprovacao-permanente.ts";
import { montarFila } from "../domain/fila-frota.ts";
import { aPedidoDeOutraPessoa } from "../domain/modo-aprovacao.ts";
import { incidentesVisiveis } from "./dispensar-incidente.ts";
import { fiosDosItens } from "./fios-da-pergunta.ts";
import { fraseDoItem, type ConectoresDaLeitura } from "./frase-da-acao.ts";
import { paradaDoPedido } from "./pre-voo-rotina.ts";
import { TIPOS_RESPONDIVEIS } from "./responder-decisao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** O que "Sua vez" e "reabrir" precisam de Deps: a rota (e o teste) montam só isto. */
export type DepsSuaVez = Pick<Deps, "repos" | "escopo" | "agora" | "tx">;

/**
 * Tipos cuja decisão nasce com o MESMO id de uma proposta (confirmar-proposta.ts, criar-rotina.ts,
 * rotinas-do-agente.ts, pedir-acesso.ts). definido em 2026-09-24 (ADR-044): o item leva a proposta
 * para a web rotular o botão ("Permitir e rodar agora" quando o pedido veio de uma rotina).
 */
const TIPOS_COM_PROPOSTA: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["acesso", "perfil", "rotina", "rotina_atualizacao", "rotina_exclusao", "rotina_execucao", "lote_bots", "credencial", "colunas_quadro", "quadro_exclusao", "app", "importacao_linear", "assumir_quadro"]);

export type EntradaSuaVez = {
  /**
   * definido em 2026-09-16: listar = ver. Renderizar a fila para a decisora carimba `vista_em`
   * (idempotente, coalesce) — é o único sinal que separa os dois rótulos de expiração do ADR-017
   * (expirou_sem_ninguem_ver vs. expirou_com_alguem_ciente). Desligável para consultas de fundo.
   */
  marcarVista?: boolean;
};

/**
 * O balão de cada pergunta da fila (definido em 2026-10-18, plano "pergunta com botões", Parte 4): "Sua vez" desenha o
 * mesmo cartão da conversa — a fala, as opções, a recomendada — e a origem genérica do turno que perguntou ("rotina",
 * "peer"; a raiz da cadeia quando o turno é retomada). Uma consulta só pelos turnos; sem balão legível (a decisora que não
 * é dona da conversa, a sala esfriada, as perguntas antigas) o item fica sem `pedido` e a web mostra a frase.
 */
async function pedidosDosItens(deps: DepsSuaVez, decisoes: readonly Decisao[]): Promise<Map<string, PedidoDoItem>> {
  const daPergunta = decisoes.filter((d) => TIPOS_RESPONDIVEIS.has(d.tipo) && d.turnoId !== null);
  const baloes = await deps.repos.mensagens.pedidosAPessoaDasDecisoes(daPergunta.flatMap((d) => (d.turnoId ? [d.turnoId] : [])));
  const saida = new Map<string, PedidoDoItem>();
  for (const m of baloes) {
    const p = m.payload;
    if (p?.kind !== "pedido_a_pessoa" || saida.has(p.decisaoId)) continue;
    saida.set(p.decisaoId, { texto: m.texto, ...(p.opcoes?.length ? { opcoes: p.opcoes } : {}), ...(p.recomendada !== undefined ? { recomendada: p.recomendada } : {}), ...(p.ajudaDoComputador ? { ajudaDoComputador: true as const } : {}), origem: m.raiz?.origem ?? m.origemTurno ?? null });
  }
  return saida;
}

/**
 * PR 4b dos modos de aprovação: os itens que foram ao revisor ganham a frase curta da ação (`fraseDaAcao`), que o cartão
 * compacto pergunta no lugar da frase da decisão. Calculada aqui, a cada leitura; o item sem frase fica como está.
 */
async function comFraseDaAcao(deps: DepsSuaVez, decisaoId: string, itens: ItemAprovacao[], conectores: ConectoresDaLeitura): Promise<ItemAprovacao[]> {
  if (!itens.some((i) => i.motivoManual === "revisor_pediu" || i.motivoManual === "revisor_falhou")) return itens;
  const tipo = (await deps.repos.acoesPeloModo.daDecisao(decisaoId))?.tipo ?? null;
  const saida: ItemAprovacao[] = [];
  for (const i of itens) {
    const frase = i.motivoManual === "revisor_pediu" || i.motivoManual === "revisor_falhou" ? await fraseDoItem(deps, tipo, i, conectores) : null;
    saida.push(frase ? { ...i, fraseDaAcao: frase } : i);
  }
  return saida;
}

/**
 * "Sua vez" por PESSOA sob RLS de duas pernas (ADR-007, EMENDA 1): a leitura roda como nod_app com
 * a pessoa da sessão como DECISORA — nunca role privilegiado + filtro na aplicação. Vencida fica
 * visível em cinza com desfecho; reaberta volta ao topo (montarFila). Instantes saem em ISO UTC e
 * ms relativos: o cliente só interpola (web/lib/relogio.ts). Estados negativos são ESCRITOS (E3.3):
 * fila vazia leva o carimbo da última decisão; motor indisponível vira item "fora do ar desde".
 */
export async function listarSuaVez(deps: DepsSuaVez, input: EntradaSuaVez = {}): Promise<{ data: SuaVezDto }> {
  const { repos } = deps;
  const agora = deps.agora();
  const marcar = input.marcarVista ?? true;

  const decisoes = await repos.decisoes.listarSuaVez(agora);
  const ultimaDecisaoEm = await repos.decisoes.ultimaDecisaoEm();
  const fila = montarFila({ decisoes, agora, ultimaDecisaoEm });
  const porId = new Map(decisoes.map((d) => [d.id, d]));
  // definido em 2026-09-24 (fio da pergunta): a faixa diz a rodada, e os contadores contam fios.
  const fios = await fiosDosItens(repos, fila.itens.map((i) => i.decisao));
  const pedidos = await pedidosDosItens(deps, fila.itens.map((i) => i.decisao));

  // Revisão 8 do PR #628: cada turno da fila é lido uma vez só (os bastidores e o "a pedido de" usam a mesma leitura).
  const turnos = new Map<string, Turno | null>();
  for (const t of new Set(fila.itens.flatMap((i) => (i.decisao.turnoId ? [i.decisao.turnoId] : [])))) turnos.set(t, await repos.turnos.buscar(t));

  // NOD-402 (ADR-130): o pedido aberto de um turno dos bastidores (rotina, colega, sob procuração; não a frente) leva a
  // marca; a web segue para ele a regra da mensagem dos bastidores (segurado enquanto a pessoa conversa).
  const bastidores = new Set<string>();
  for (const t of new Set(fila.itens.flatMap((i) => (i.decisao.turnoId && i.estadoColuna !== "vencido" ? [i.decisao.turnoId] : [])))) {
    const turno = turnos.get(t);
    if (turno?.bastidores && !turno.trabalhoId) bastidores.add(t);
  }

  // NOD-443 (revisão 7 do PR #628, achado 4; ADR-143): o cartão que o turno a pedido de quem participa do quadro abriu
  // (o bot da dona sob a procuração dela) diz de quem é o pedido — a dona decide sabendo que não foi ela quem pediu.
  // Revisão 8: o nome de cada pessoa é lido uma vez por chamada (vários cartões da mesma Ana, uma leitura).
  const aPedidoDe = new Map<string, string>();
  const nomes = new Map<string, string>();
  for (const [t, turno] of turnos) {
    if (!turno?.sobProcuracaoDe || !aPedidoDeOutraPessoa(turno.sobProcuracaoDe, turno.ownerId)) continue;
    const quem = turno.sobProcuracaoDe;
    let nome = nomes.get(quem);
    if (nome === undefined) nomes.set(quem, (nome = (await repos.pessoas.buscar(quem))?.nome ?? "outra pessoa"));
    aPedidoDe.set(t, nome);
  }

  const itens: SuaVezDto["itens"] = [];
  const conectores: ConectoresDaLeitura = new Map();
  // NOD-114: a task do turno que pediu, para o aviso do navegador e do desktop abrir a task e não a conversa (uma consulta só).
  const trabalhos = await repos.turnos.trabalhosDosTurnos(fila.itens.flatMap((i) => (i.decisao.turnoId ? [i.decisao.turnoId] : [])));
  for (const item of fila.itens) {
    let decisao = item.decisao;
    const aberta = decisao.estado === "pendente" || decisao.estado === "reaberta";
    if (marcar && aberta && decisao.vistaEm === null && (await repos.decisoes.marcarVista(decisao.id, agora))) {
      decisao = { ...decisao, vistaEm: new Date(agora).toISOString() };
    }
    // definido em 2026-09-24: a gêmea dobrada no "×N" também foi vista — senão, ao vencer, ela sairia
    // como expirou_sem_ninguem_ver (ADR-017 #2) sendo que a pessoa leu o grupo.
    for (const id of marcar ? item.gemeas : []) {
      if (porId.get(id)?.vistaEm === null) await repos.decisoes.marcarVista(id, agora);
    }
    const itensAprovacao: ItemAprovacao[] = decisao.tipo === "aprovacao" ? await comFraseDaAcao(deps, decisao.id, await repos.itensAprovacao.listar(decisao.id), conectores) : [];
    const proposta = TIPOS_COM_PROPOSTA.has(decisao.tipo) ? await repos.propostas.buscar(decisao.id) : null;
    // definido em 2026-09-24 (emenda da ADR-044): o pedido aberto de uma rotina diz desde quando ela está
    // parada e quais janelas não rodaram — só no aberto; o vencido já pausou a rotina.
    const rotinaParada = proposta && aberta && decisao.tipo === "acesso" ? await paradaDoPedido(repos, proposta) : null;
    const nuncaPermanente = itensAprovacao.filter((i) => ehNuncaPermanente(i.destino.ferramenta)).map((i) => i.id);
    itens.push({ ...item, decisao, itensAprovacao, proposta, fio: fios.get(decisao.id) ?? null, rotinaParada, nuncaPermanente, pedido: pedidos.get(decisao.id) ?? null, trabalhoId: decisao.turnoId ? (trabalhos.get(decisao.turnoId) ?? null) : null, ...(decisao.turnoId && bastidores.has(decisao.turnoId) ? { bastidores: true } : {}), ...(decisao.turnoId && aPedidoDe.has(decisao.turnoId) ? { aPedidoDe: aPedidoDe.get(decisao.turnoId)! } : {}) });
  }

  const foraDoAr = (await repos.inventario.listar())
    .filter((m) => m.inventario.estado !== "pronto")
    .map((m) => ({ nome: m.motor, desde: m.inventario.em }));

  // Avisos de infraestrutura (ADR-045): a queda do Mac é um aviso com começo e fim, não uma decisão.
  const incidentes = await incidentesVisiveis(repos, agora);

  return { data: { itens, incidentes, foraDoAr, vazio: fila.vazio, ultimaDecisaoEm: fila.ultimaDecisaoEm } };
}

/** Prova de que a assinatura cabe no contrato CasoDeUso (Deps completo é um DepsSuaVez). */
export const listarSuaVezComoCaso: CasoDeUso<EntradaSuaVez, SuaVezDto> = listarSuaVez;
