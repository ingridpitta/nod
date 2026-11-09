import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { createHash } from "node:crypto";
import { CHAMADAS_NO_LOG, entregaDaChamada, eventoDaChamada, eventoPassa, exigeAssinatura, filtroQueCasou, PENDENTES_MAX, RETRY_AFTER_S, type DesfechoChamada, type MotivoRecusa } from "../domain/rotina-webhook.ts";
import { assinaturaGithubValida, casaHashGatilho } from "../services/token-gatilho.ts";
import { autoriaPessoa, evento } from "./apoio-l7.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * A chamada de um webhook (NOD-84, ADR-139), já dentro da transação no escopo que o token ALEGA. A rota fez o que não
 * precisa do banco (Origin, limites, token malformado, teto do corpo, moldura do payload); aqui se prova o token e se
 * decide o desfecho. Nada lança para o chamador de fora: todo desfecho é um status HTTP com um código curto, e as recusas
 * gravam a linha "recusada" na MESMA transação (que confirma — é um registro, não um erro).
 *
 * Ordem (comentário de plano na NOD-84, revista na revisão): hash sem trava → trava da rotina → hash de novo → assinatura → ping → entrega repetida → pausada → evento fora do filtro →
 * fila cheia → dispara. `vivoDaRotina({travar})` trava a linha do endereço: duas chamadas da mesma rotina se enfileiram
 * aqui, e o dedupe e a contagem de pendentes não correm entre si.
 */
export type EntradaWebhook = {
  rotinaId: string;
  /** SHA-256 do token inteiro que veio no path ou no Bearer. */
  hash: Buffer;
  cabecalhos: Record<string, string | string[] | undefined>;
  corpoCru: Buffer;
  /** O corpo já interpretado (JSON, ou o `payload=` do form do GitHub); null quando não deu. */
  corpo: unknown;
  /**
   * O payload cortado e emoldurado como dado não confiável (a rota monta: a moldura é do adapter). Preguiçoso (revisão 5
   * da NOD-84): só roda quando a chamada vai disparar, depois de o token e a assinatura casarem — quem forja tokens não
   * gasta a CPU da redação.
   */
  emoldurar(): string;
  decifrar(cifrado: string): string;
  executor: Executor;
  machineId: string;
};

export type CodigoWebhook =
  | "aceita"
  | "ping"
  | "duplicada"
  | "rotina_pausada"
  | "evento_ignorado"
  | "rotina_bloqueada"
  | "fila_cheia"
  | "nao_permitido";

export type SaidaWebhook = { status: number; codigo: CodigoWebhook; retryAfter?: number };

const NEGADO: SaidaWebhook = { status: 401, codigo: "nao_permitido" };

function cabecalho(h: EntradaWebhook["cabecalhos"], nome: string): string | null {
  const v = h[nome];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

type Chamada = { desfecho: DesfechoChamada; motivo?: MotivoRecusa; evento?: string | null; entregaId?: string | null; turnoId?: string | null };

/**
 * Grava a linha no log (e poda) e devolve o aviso `rotina_atualizada` para a tela reler a gaveta, o "!" e o "N hoje" —
 * toda chamada registrada avisa, inclusive a recusada (Codex, revisão da NOD-84). A linha que o dedupe barrou não avisa.
 */
async function registrar(deps: Deps, rotina: Rotina, c: Chamada): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const linha = await deps.repos.rotinaChamadas.registrar({ rotinaId: rotina.id, em: agora, desfecho: c.desfecho, ...(c.motivo ? { motivo: c.motivo } : {}), ...(c.evento ? { evento: c.evento } : {}), ...(c.entregaId ? { entregaId: c.entregaId } : {}), ...(c.turnoId ? { turnoId: c.turnoId } : {}) });
  await deps.repos.rotinaChamadas.podar(rotina.id, agora, CHAMADAS_NO_LOG);
  if (!linha) return [];
  return [evento(deps, "rotina_atualizada", autoriaPessoa(deps.escopo.pessoaId, "regra:webhook-rotina"), { rotinaId: rotina.id, origem: "webhook" }, { conversaId: rotina.conversaId })];
}

/**
 * A recusa (endereço errado; e, desde a revisão 5, assinatura errada) grava no log no máximo 1 vez por minuto por rotina (revisão 4 da NOD-84): quem tem um
 * endereço antigo e varia o segredo (cada variação é um contador novo no limite por token) não enche o log, não emite
 * `rotina_atualizada` sem fim e não segura a trava de chave da rotina com o INSERT. Só pula quando a linha MAIS NOVA é
 * uma recusada de menos de 1 minuto: o "!" já está aceso; depois de uma aceita, a próxima recusa grava e o reacende.
 */
async function recusarUmaVez(deps: Deps, rotina: Rotina, c: Chamada = { desfecho: "recusada", motivo: "endereco" }): Promise<{ data: SaidaWebhook; events?: RuntimeEvent[] }> {
  const data = NEGADO;
  const [ultima] = await deps.repos.rotinaChamadas.listar(rotina.id, 1);
  if (ultima?.desfecho === "recusada" && ultima.em > deps.agora() - RECUSA_ENDERECO_MS) return { data };
  return comEventos(data, await registrar(deps, rotina, c));
}
const RECUSA_ENDERECO_MS = 60_000;

/** Até 3 tentativas de janela: duas chamadas no mesmo milissegundo não podem perder a segunda. */
const TENTATIVAS_JANELA = 3;

const comEventos = (data: SaidaWebhook, events: RuntimeEvent[]) => (events.length > 0 ? { data, events } : { data });

/** Rotina que não existe, de outra pessoa, excluída, de horário ou de bot excluído: o mesmo 401 de um token errado. */
async function rotinaValida(deps: Deps, rotina: Rotina | null): Promise<Rotina | null> {
  if (!rotina || rotina.ownerId !== deps.escopo.pessoaId || rotina.excluidoEm !== null || rotina.gatilho !== "webhook") return null;
  return (await deps.repos.agentes.buscar(rotina.agenteId)) ? rotina : null;
}

export const receberWebhook: CasoDeUso<EntradaWebhook, SaidaWebhook> = async (deps, input) => {
  // 1º o hash, SEM trava (revisão da NOD-84): quem martela tokens errados não segura a linha da rotina e não enfileira
  // as chamadas legítimas atrás de si. Rotina inválida não tem log (não há rotina webhook dona dele para mostrar o "!").
  const solta = await rotinaValida(deps, await deps.repos.rotinas.buscar(input.rotinaId));
  if (!solta) return { data: NEGADO };
  const previo = await deps.repos.rotinaGatilhos.vivoDaRotina(solta.id);
  if (!previo || !casaHashGatilho(previo.hash, input.hash)) return recusarUmaVez(deps, solta);

  // Token certo: agora a linha da rotina TRAVADA (antes da do endereço; pausar/excluir travam na mesma ordem pelo
  // UPDATE). Uma pausa ou um "Gerar novo endereço" que confirmou no meio é visto aqui, e o hash é conferido de novo.
  const rotina = await rotinaValida(deps, await deps.repos.rotinas.buscarParaAtualizar(input.rotinaId));
  if (!rotina) return { data: NEGADO };
  const gatilho = await deps.repos.rotinaGatilhos.vivoDaRotina(rotina.id, { travar: true });
  if (!gatilho || !casaHashGatilho(gatilho.hash, input.hash)) return recusarUmaVez(deps, rotina);

  const evento_ = eventoDaChamada(input.cabecalhos, input.corpo);
  // GitHub: a assinatura é obrigatória desde a 1ª chamada (e continua depois de gerar endereço novo): vazar o endereço
  // não basta. Outro provedor que mande o cabeçalho com o NOSSO segredo: a 1ª assinada válida o adota e dali em diante é
  // obrigatória. O que manda o cabeçalho com a chave dele (a Meta assina `X-Hub-Signature-256` com o App Secret do app,
  // revisão 6) não é recusado: para ele, como para o Stripe e os genéricos, o endereço secreto é a credencial.
  const assinatura = cabecalho(input.cabecalhos, "x-hub-signature-256");
  const valida = assinatura !== null && assinaturaGithubValida(input.decifrar(gatilho.segredoHmacCifrado), input.corpoCru, assinatura);
  if ((gatilho.assinadoEm !== null || exigeAssinatura(rotina.provedor)) && !valida) return recusarUmaVez(deps, rotina, { desfecho: "recusada", motivo: "assinatura", evento: evento_ });
  if (valida && gatilho.assinadoEm === null) await deps.repos.rotinaGatilhos.marcarAssinado(gatilho.id, deps.agora());

  // O ping do GitHub ao salvar o webhook: "conectou", sem rodar. Fica no log (a gaveta mostra "GitHub conectou").
  if (evento_ === "ping") return comEventos({ status: 200, codigo: "ping" }, await registrar(deps, rotina, { desfecho: "ignorada", evento: "ping" }));

  // Assinada: o dedupe é pela assinatura (corpo + segredo), não pelo id que vem em cabeçalho — quem reenvia uma entrega
  // capturada trocando o X-GitHub-Delivery cai aqui como repetida; a redelivery legítima do GitHub também. A chave é a
  // assinatura canônica (a mesma que foi verificada, sem os espaços que `assinaturaGithubValida` ignora).
  const entregaId = valida && assinatura !== null ? `sig:${createHash("sha256").update(assinatura.trim()).digest("hex").slice(0, 40)}` : entregaDaChamada(input.cabecalhos, input.corpo);
  if (entregaId && (await deps.repos.rotinaChamadas.jaEntregue(rotina.id, entregaId))) return { data: { status: 200, codigo: "duplicada" } };

  if (rotina.estado === "pausada") return comEventos({ status: 202, codigo: "rotina_pausada" }, await registrar(deps, rotina, { desfecho: "pausada", evento: evento_, entregaId }));
  if (!eventoPassa(rotina.eventos, evento_)) return comEventos({ status: 202, codigo: "evento_ignorado" }, await registrar(deps, rotina, { desfecho: "ignorada", evento: evento_, entregaId }));
  // Fila cheia: 429 sem o id de entrega no log, para a retentativa do provedor passar quando a fila andar. O GitHub
  // NÃO reenvia sozinho depois de um 429 (ADR-139 §5): a linha fila_cheia acende o aviso para a dona reenviar.
  const filaCheia = { status: 429, codigo: "fila_cheia", retryAfter: RETRY_AFTER_S } as const;
  if ((await deps.repos.rotinaJanelas.contarAbertas(rotina.id, deps.agora())) >= PENDENTES_MAX) return comEventos(filaCheia, await registrar(deps, rotina, { desfecho: "fila_cheia", evento: evento_ }));

  // No texto confiável (cabeçalho do turno e linha cinza) vai só o filtro que a dona confirmou, nunca o nome de fora.
  const filtro = filtroQueCasou(rotina.eventos, evento_);
  const webhook = { entrada: input.emoldurar(), provedor: rotina.provedor ?? "provedor", evento: filtro };
  const base = deps.agora();
  for (let i = 0; i < TENTATIVAS_JANELA; i++) {
    const r = await dispararRotina(deps, { rotina, instanteAgendado: base + i, machineId: input.machineId, executor: input.executor, preservarAgenda: true, webhook });
    if ("janelaDeOutro" in r.data) continue;
    // Bloqueada: sem o id de entrega no log (revisão 4), como a fila_cheia — o reenvio depois de liberar a rotina roda.
    if ("bloqueada" in r.data) return comEventos({ status: 202, codigo: "rotina_bloqueada" }, [...(r.events ?? []), ...(await registrar(deps, rotina, { desfecho: "bloqueada", evento: evento_ }))]);
    const turnoId = "turno" in r.data ? r.data.turno.id : null;
    const aviso = await registrar(deps, rotina, { desfecho: "rodou", evento: evento_, entregaId, turnoId });
    return comEventos({ status: 202, codigo: "aceita" }, [...(r.events ?? []), ...(await linhaCinza(deps, rotina, filtro)), ...aviso]);
  }
  // Três colisões seguidas no mesmo ms é outro processo na mesma rotina: o provedor tenta de novo, e fica no log.
  return comEventos(filaCheia, await registrar(deps, rotina, { desfecho: "fila_cheia", evento: evento_ }));
};

/** "O webhook do Stripe disparou a rotina (payment_*)." — a linha cinza no chat. `filtro` é o que a dona confirmou. */
export function textoDaLinhaCinza(provedor: string, filtro: string | null): string {
  return `O webhook do ${provedor} disparou a rotina${filtro ? ` (${filtro})` : ""}.`;
}

async function linhaCinza(deps: Deps, rotina: Rotina, filtro: string | null): Promise<RuntimeEvent[]> {
  const autoria = autoriaPessoa(deps.escopo.pessoaId, "regra:webhook-rotina");
  const linha = await deps.repos.mensagens.criar({ conversaId: rotina.conversaId, autoria, kind: "sistema", assunto: "rotina.evento", texto: textoDaLinhaCinza(rotina.provedor ?? "provedor", filtro), confianca: "confiavel" });
  return linha ? [evento(deps, "mensagem_criada", autoria, { mensagem_id: linha.id, kind: "sistema" }, { conversaId: rotina.conversaId })] : [];
}
