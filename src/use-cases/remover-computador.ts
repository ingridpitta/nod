import type { AcaoNoLote, PayloadPropostaLoteBots } from "../contracts/conversa.ts";
import type { ErroRemoverComputador, ResultadoRemoverComputador } from "../contracts/ferramentas-computadores.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { listaFalada } from "../domain/times.ts";
import { log } from "../obs/log.ts";
import { previaDeRemover } from "./acoes/maquinas.ts";
import { evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/**
 * remover_computador (ADA-245, jornada D, critério "No chat"): a via do chat de `maquinas.remover` (ADR-135). Nunca roda
 * na hora: a ação é `pessoa_confirma`, então vira SEMPRE um card (o lote dos bots, tipo remover_computador, motivo
 * ligar_total), também em "Ignorar todas as aprovações". Aprovado, o gerir-bots chama o MESMO executor da tela
 * (EXECUTORES_MAQUINAS) e o computador, se estiver ligado, se limpa na próxima puxada.
 *
 * Cercas (as do gerir_times): o turno é do bot, é conversa ou criação, de primeira mão, não foi parado e nada de fora
 * entrou nele — tirar um computador da conta é da pessoa, e só ela (falando com o bot) pede.
 */

const MODOS = new Set(["conversa", "criacao"]);
const INSTRUCAO: Record<ErroRemoverComputador, string> = {
  fora_da_conversa: "Nada mudou. remover_computador só vale na conversa com a pessoa, a pedido dela.",
  entrada_invalida: "Nada mudou. Confira o nome do computador (Configurações › Computadores) e chame de novo.",
  computador_ambiguo: "Nada mudou. Pergunte à pessoa qual destes computadores ela quis dizer e chame de novo com o nome exato.",
};

const falha = (erro: ErroRemoverComputador, opcoes?: string[], instrucao?: string): SaidaCasoDeUso<ResultadoRemoverComputador> => ({ data: { ok: false, erro, ...(opcoes ? { opcoes } : {}), instrucao: instrucao ?? INSTRUCAO[erro] } });
const naConversa = (t: Pick<Turno, "profundidade">, modo: string | null): boolean => !!modo && MODOS.has(modo) && t.profundidade === 0;
const chave = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("pt-BR");

export const removerComputadorPeloChat: CasoNod<Deps, "remover_computador"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !naConversa(turno, modo)) return falha("fora_da_conversa");
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId || (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId)) return falha("fora_da_conversa", undefined, "Os computadores são da pessoa: só um bot dela, falando com ela, pede para remover.");
  if (turno.pararSolicitadoEm != null || turno.estado === "interrompido") return falha("fora_da_conversa", undefined, "Este turno foi parado.");
  const limpo = turno.entradaConfianca === "confiavel" && input.plano?.confiancaEntrada !== "nao_confiavel" && !(await deps.repos.turnos.contaminado(turno.id));
  if (!limpo) return falha("fora_da_conversa", undefined, "Este turno leu conteúdo de fora: um computador só sai da conta a pedido direto da pessoa.");
  if (typeof input.resumo !== "string" || input.resumo.trim() === "" || typeof input.computador !== "string" || input.computador.trim() === "") return falha("entrada_invalida");
  if ((input.manter_ias !== undefined && typeof input.manter_ias !== "boolean") || (input.manter_conexao !== undefined && typeof input.manter_conexao !== "boolean")) return falha("entrada_invalida");

  // Só os computadores de trabalho vivos da pessoa (o só-computador não roda o nod para se remover).
  const vivos = (await deps.repos.maquinaTokens.listar()).filter((c) => c.revogadaEm === null && c.papel !== "computador");
  const pedido = chave(input.computador);
  const porId = vivos.find((c) => c.id === input.computador.trim());
  const porNome = vivos.filter((c) => chave(c.nome) === pedido);
  const parecidos = porNome.length ? porNome : vivos.filter((c) => chave(c.nome).includes(pedido));
  const alvo = porId ?? (parecidos.length === 1 ? parecidos[0] : undefined);
  if (!alvo) return parecidos.length > 1 ? falha("computador_ambiguo", parecidos.map((c) => c.nome)) : falha("entrada_invalida", vivos.map((c) => c.nome));

  const previa = await previaDeRemover(deps, alvo.id, false, null);
  const manterIas = input.manter_ias === true;
  const manterConexao = input.manter_conexao === true;
  const autoria = autoriaDoAgente(deps.escopo, agente.id);
  const agora = deps.agora();
  const resumo = input.resumo.trim();
  const acao: AcaoNoLote = { tipo: "remover_computador", maquina_id: alvo.id, manter_ias: manterIas, manter_conexao: manterConexao, membros: previa.bots, assume_nome: previa.assume?.nome ?? null, i: 0, estado: "esperando", motivo: "ligar_total", alvoNome: alvo.nome, botId: null, alvoDaAcao: null };
  const payload: PayloadPropostaLoteBots = { kind: "lote_bots", resumo, acoes: [acao], turnoId: input.turnoId };
  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: agente.id, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "lote_bots", agenteId: agente.id, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: resumo });
  const events = [evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "lote_bots", acoes: 1 } })];
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { decisao_id: decisao.id, tipo: "lote_bots" } }));
  log("info", "remover_computador", { bots: previa.bots.length, manter_ias: manterIas, manter_conexao: manterConexao });

  const quem = previa.assume ? `passam para ${previa.assume.nome}` : "esperam um computador";
  const bots = previa.bots.length ? `${listaFalada(previa.bots)} ${quem}` : "nenhum bot roda lá";
  const instrucao = `Remover o nod de ${alvo.nome} espera a pessoa no card desta conversa (${bots}${manterConexao ? "; ele continua ligado à conta" : "; ele sai da conta"}). Diga isso em uma frase e encerre o turno.`;
  return { data: { ok: true, decisao_id: proposta.id, computador: alvo.nome, bots: previa.bots, assume: previa.assume?.nome ?? null, instrucao }, events };
};
