import { fraseDoReenvio } from "./decidir.ts";
import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import { TIPOS_PEDIDO_A_PESSOA } from "../contracts/pedido.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { historicoDoFio, mensagensDoFio, rodadaNoFio } from "../domain/fio-da-pergunta.ts";
import { opcaoRespondida } from "../domain/opcoes-da-pergunta.ts";
import { ajudaDoComputador } from "./ajuda-do-computador.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { responderPedidoDeDone } from "./tarefa-casa.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/**
 * Os três tipos de pedir_a_pessoa (EMENDA 16): a resposta é TEXTO da pessoa, nunca um botão.
 * Dispensar (× / "Deixar pra lá", #46 e ADR-045) NÃO é responder: fecha sem texto e sem retomar
 * (dispensar-decisao.ts). definido em 2026-09-24 (emenda da ADR-045): a resposta pronta da pergunta
 * (`opcoes`) também chega aqui como texto — o toque manda as palavras da opção por esta mesma rota.
 */
export const TIPOS_RESPONDIVEIS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(TIPOS_PEDIDO_A_PESSOA);

/**
 * FASE 1 — pela DECISORA (pode ser outra pessoa que a dona: policy nod_decisora, 0003): fecha a
 * decisão com o texto registrado como quem destravou. Devolve a decisão para a fase 2 achar a dona.
 */
export const fecharComResposta: CasoDeUso<{ decisaoId: string; texto: string }, { decisao: Decisao }> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  const atual = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  if (!TIPOS_RESPONDIVEIS.has(atual.tipo)) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.tipo} não se responde com texto; use decidir` });
  if (atual.estado !== "pendente" && atual.estado !== "reaberta") throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.estado}` });
  // definido em 2026-10-18 (QA do PR #389): o pedido de ajuda do computador se resolve com "Assumir controle" e "Devolver
  // ao bot". A web já não o responde pelo campo; aqui fecha a porta para o bundle antigo em cache e o POST direto, que
  // fechavam a ajuda e deixavam o controle em `aguardando_pessoa`. O "Devolver ao bot" passa: ele limpa
  // `ajudaDecisaoId` na mesma tx antes de chamar esta fase (adapters/fundo/computadores.ts).
  if (atual.tipo === "pergunta" && (await ajudaDoComputador(deps.repos, atual.agenteId))?.ajudaDecisaoId === atual.id) {
    throw new ErroDeDominio("estado_invalido", { cause: "pedido de ajuda do computador: resolve-se com Assumir controle e Devolver ao bot" });
  }
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.decidir(atual.id, { por: deps.escopo.pessoaId, agora });
  if (!decisao) throw new ErroDeDominio("nao_permitido", { cause: "nem dona nem decisora" });
  const autoria = autoriaPessoa(deps.escopo);
  return {
    data: { decisao },
    events: [evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, respondida: true } })],
  };
};

export type EntradaRetomarComResposta = { decisao: Decisao; texto: string; respondidaPor: { id: string; nome: string }; prazoMs?: number; executor?: Executor };
export type SaidaRetomarComResposta = { mensagem: Mensagem; turno: Turno | null };

/**
 * definido em 2026-09-24 (fio da pergunta, emenda da ADR-045): da 2ª rodada em diante, a retomada leva
 * o histórico do fio — as perguntas, as respostas e as explicações anteriores, as últimas 10, cada uma
 * aparada. A retomada de rotina roda em sessão nova e só sabe o que a entrada diz: sem isto, a terceira
 * pergunta chegaria sem as duas primeiras. Na 1ª rodada não há fio a contar (a pergunta está na frase).
 */
async function historicoDaResposta(deps: Deps, d: Decisao): Promise<string[]> {
  if (d.fioId === null) return [];
  const rodadas = (await deps.repos.decisoes.dosFios([d.fioId])).filter((x) => Date.parse(x.criadoEm) <= Date.parse(d.criadoEm));
  const doFio = mensagensDoFio(rodadas, await deps.repos.mensagens.listarDaConversa(d.conversaId));
  if (doFio.length === 0) return [];
  const pessoas = await deps.repos.pessoas.listarDoTenant();
  const linhas = historicoDoFio(doFio, (id) => pessoas.find((p) => p.id === id)?.nome ?? "a pessoa");
  return [`Esta pergunta é a ${rodadaNoFio(rodadas, d.id)}ª rodada do mesmo fio. O que já foi dito nele (as ${linhas.length} últimas mensagens, da mais antiga para a mais nova):`, ...linhas];
}

/**
 * definido em 2026-10-18 (plano "pergunta com botões", Parte 1): a resposta É uma das opções da pergunta? Mora na fase 2,
 * que roda pela dona e lê a conversa (a fase 1 roda pela decisora, que pode não ler o balão). `via: "opcao"` com o índice
 * quando o texto repete uma opção (clique, letra ou digitado igual — a régua da medição do clique); `via: "texto"` com
 * balão e outra resposta. Sem `turnoId` (pergunta da sala esfriada) ou sem balão, nada: não há opções a comparar.
 */
async function viaDaResposta(deps: Deps, d: Decisao, texto: string): Promise<{ via?: "opcao" | "texto"; opcao?: number }> {
  if (!d.turnoId) return {};
  const balao = await deps.repos.mensagens.pedidoAPessoaDaDecisao(d.turnoId, d.id);
  if (balao?.payload?.kind !== "pedido_a_pessoa") return {};
  const opcao = opcaoRespondida(texto, balao.payload.opcoes);
  return opcao === null ? { via: "texto" } : { via: "opcao", opcao };
}

/**
 * FASE 2 — pela DONA (o outbox e o turno exigem owner = pessoa da sessão): a resposta vira mensagem
 * de texto na conversa e um turno de RETOMADA (origem 'retomada', retoma_turno_id = o turno que
 * parou, --resume pela sessão da conversa) com a resposta como entrada. O turno original de
 * pedir_a_pessoa ENCERROU normalmente (E5.2), por isso não passa por retomarTurno (que exige
 * 'interrompido'). Sem turno original (decisão de sala esfriada) só a mensagem entra.
 *
 * definido em 2026-09-24 (emenda da ADR-045): a mensagem leva o payload `resposta_a_pedido`, que a
 * liga à pergunta — a web rotula "respondendo à pergunta das HH:MM", marca a pergunta como respondida
 * e, com `retomada`, escreve "{agente} retomou com a sua resposta" sem gravar outra linha. Fio da
 * pergunta (mesma data): o turno nasce ANTES da mensagem para ela levar `turnoRetomadaId` — é por ele
 * que o fio sabe se o agente ainda está lendo.
 */
export const retomarComResposta: CasoDeUso<EntradaRetomarComResposta, SaidaRetomarComResposta> = async (deps, input) => {
  const agora = deps.agora();
  const d = input.decisao;
  const autoria: ReturnType<typeof autoriaPessoa> = { ...autoriaPessoa(deps.escopo, input.executor ?? "catcher"), autor_id: input.respondidaPor.id };
  const original = d.turnoId ? await deps.repos.turnos.buscar(d.turnoId) : null;
  let turno: Turno | null = null;
  let turnoNovo = false;
  if (original) {
    await deps.repos.paradas.encerrarAbertas({ conversaId: d.conversaId, agora });
    // definido em 2026-09-24 (ADR-044): a retomada de uma rotina roda como rotina, em sessão nova
    // (emitir-plano-turno.ts), então precisa da entrada ORIGINAL da rotina para saber o que fazer.
    const daRotina = await rotinaDoTurno(deps.repos, original.id);
    ({ turno, nova: turnoNovo } = await enfileirarRetomada(deps, {
      original,
      prazoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
      entradaTexto: [
        `Resposta de ${input.respondidaPor.nome} ao seu pedido (${d.tipo}: "${d.frase}"): ${input.texto}`,
        `Continue a partir daqui; ${fraseDoReenvio(original.entradaAnexos.length > 0)}.`,
        ...(await historicoDaResposta(deps, d)),
        ...(daRotina ? ["Entrada original da rotina:", daRotina.turnoDisparado.entradaTexto] : []),
      ].join("\n"),
      reenvios: original.reenvios + 1,
      executor: input.executor ?? "catcher",
    }));
  }
  const payload: PayloadMensagem = { kind: "resposta_a_pedido", decisaoId: d.id, agenteId: d.agenteId, perguntaEm: Date.parse(d.criadoEm), retomada: original !== null, ...(turno ? { turnoRetomadaId: turno.id } : {}), ...(await viaDaResposta(deps, d, input.texto)) };
  const mensagem = await deps.repos.mensagens.criar({ conversaId: d.conversaId, turnoId: d.turnoId, autoria, kind: "texto", texto: input.texto, payload, confianca: "confiavel" });
  if (!mensagem) throw new ErroDeDominio("nao_permitido");
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: d.conversaId, turnoId: d.turnoId, dados: { mensagem_id: mensagem.id, kind: "texto", decisao_id: d.id, destravou: true } })];
  if (original && turno && turnoNovo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: d.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: d.id } }));
  // Revisão do épico (S2, 2026-10-08): a task da pergunta relê o estado (rodando com a retomada na fila).
  events.push(...(await sincronizarDasDecisoes(deps, [d])));
  // ADA-28 (escopo E): a "pronta para o Done" — Dar Done leva a Feito; outra resposta volta à etapa anterior.
  if (d.tarefaPedeDone) events.push(...(await responderPedidoDeDone(deps, d, input.texto, input.executor ?? "catcher")));
  return { data: { mensagem, turno }, events };
};
