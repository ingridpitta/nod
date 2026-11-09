import type { AlvoCredencial, PayloadPropostaCredencial, Proposta } from "../contracts/conversa.ts";
import { TETO_PARA_CREDENCIAL, type ArgsPedirCredencial, type ErroPedirCredencial, type ResultadoPedirCredencial } from "../contracts/ferramentas-credencial.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { chavePedivel, conectorGeridoPeloNod } from "../domain/credenciais-conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { decisaoEmAberto } from "../domain/revisor.ts";
import { evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/**
 * pedir_credencial (definido em 2026-10-28, NOD-50): o cartão de pedido de credencial. Nasce proposta 'credencial' +
 * decisão 'credencial' com o MESMO id (o padrão de gerir-bots e pedir-acesso): o cartão do chat e "Sua vez" são o mesmo
 * pedido. O payload leva só o alvo — o valor vai da web ao cofre por POST propostas/:id/credencial (guardar-credencial.ts)
 * e nunca passa pelo motor, pelo proxy nem por aqui. O modo automático NUNCA resolve este cartão: não há valor que ele
 * possa inventar, então esta ferramenta não chama confirmacaoPeloModo (a decisão nasce `pendente` em qualquer modo).
 */

const PARA_PADRAO = "Para seguir com o que você pediu.";

const NOMES: Record<Exclude<AlvoCredencial, "conector">, string> = { github_token: "GitHub", composio: "Composio" };

/** O "para" do cartão: uma frase, até 80 caracteres, com ponto final; vazio = o padrão (lacuna da spec, protótipo). */
export function paraDoCartao(para: string | undefined): string {
  const limpo = (para ?? "").replace(/\s+/g, " ").trim();
  if (!limpo) return PARA_PADRAO;
  const frase = limpo.charAt(0).toUpperCase() + limpo.slice(1);
  // Por ponto de código (Array.from), para não partir um emoji; o ponto final conta no teto.
  const letras = Array.from(frase);
  const pontuada = /[.!?…]$/.test(frase);
  if (letras.length > TETO_PARA_CREDENCIAL || (!pontuada && letras.length === TETO_PARA_CREDENCIAL)) return `${letras.slice(0, TETO_PARA_CREDENCIAL - 1).join("").trimEnd()}…`;
  return pontuada ? frase : `${frase}.`;
}

function recusada(erro: ErroPedirCredencial): ResultadoPedirCredencial {
  const instrucao: Record<ErroPedirCredencial, string> = {
    conector_nao_encontrado: "nenhum cartão foi criado: não há conector com esse slug que seja da pessoa. Confira o slug (ver_apps_conectados) ou diga o que falta.",
    conector_nativo: "nenhum cartão foi criado: esse conector é gerido pelo nod (nativo ou do Composio). Para o GitHub use alvo 'github_token'; para o Composio, alvo 'composio'.",
    chave_invalida: "nenhum cartão foi criado: informe em 'chave' o nome exato da variável de ambiente (stdio) ou do header (http) que falta; em stdio, só uma chave que o conector já declara (chave nova a pessoa acrescenta na tela de apps); em http, só Authorization ou um header de credencial que o conector já declara; variáveis de sistema (PATH, NODE_*, LD_*…) não se pedem.",
    composio_ja_configurado: "nenhum cartão foi criado: o time já tem uma chave do Composio. Se ela parou de funcionar, diga à pessoa para trocá-la na tela de apps (Composio configurado · alterar chave).",
  };
  return { estado: "recusada", erro, instrucao: instrucao[erro] };
}

function pendente(propostaId: string): ResultadoPedirCredencial {
  return { estado: "pendente", proposta_id: propostaId, instrucao: "a chave ainda NÃO foi guardada: diga em uma frase que pediu e encerre o turno; a resposta volta como guardada ou recusada. Nunca peça o valor no chat." };
}

/** O mesmo cartão ainda aberto deste turno e alvo (critério 8: duas chamadas não criam segundo cartão). */
async function cartaoRepetido(deps: Deps, ctx: ContextoFerramenta, payload: PayloadPropostaCredencial): Promise<Proposta | null> {
  for (const p of await deps.repos.propostas.pendentesDaConversa(ctx.conversaId)) {
    if (p.payload.kind !== "credencial" || p.agenteId !== ctx.agenteId || p.payload.turnoId !== ctx.turnoId) continue;
    if (p.payload.alvo !== payload.alvo || p.payload.conectorId !== payload.conectorId || p.payload.chave !== payload.chave) continue;
    const decisao = await deps.repos.decisoes.buscar(p.id);
    if (decisao && !decisaoEmAberto(decisao.estado)) continue;
    return p;
  }
  return null;
}

/** O alvo validado, ou o erro tipado (nenhum cartão nasce). */
async function alvoDoPedido(deps: Deps, args: ArgsPedirCredencial): Promise<Omit<PayloadPropostaCredencial, "kind" | "para" | "turnoId"> | ErroPedirCredencial> {
  // A chave do Composio vale para o time inteiro (ADR-041): o bot só a pede quando ainda não há nenhuma; trocar a que existe
  // é na tela do Composio, por quem sabe por quê (revisão do PR #553).
  if (args.alvo === "composio" && (await deps.repos.composio.chave())) return "composio_ja_configurado";
  if (args.alvo !== "conector") return { alvo: args.alvo, conectorId: null, app: NOMES[args.alvo], chave: null };
  const slug = (args.conector ?? "").trim();
  const c = slug ? await deps.repos.conectores.buscarPorSlug(slug) : null;
  // Conector de outra pessoa conta como inexistente (o mesmo `nao_encontrado` da escrita de credenciais).
  if (!c || c.ownerId !== deps.escopo.pessoaId) return "conector_nao_encontrado";
  if (conectorGeridoPeloNod(c, (await deps.repos.composio.sessao(c.slug))?.conectorId)) return "conector_nativo";
  const chave = (args.chave ?? "").trim();
  if (!chavePedivel(chave, c.transporte, Object.keys(c.env))) return "chave_invalida";
  // http (revisão 8): o nome como declarado (x-api-key → X-API-Key), para o mesmo header não abrir dois cartões no turno.
  const declarada = c.transporte === "http" ? Object.keys(c.env).find((d) => d.toLowerCase() === chave.toLowerCase()) : undefined;
  return { alvo: "conector", conectorId: c.id, app: c.nome, chave: declarada ?? chave };
}

/** A frase da decisão em "Sua vez" — do domínio, nunca do modelo, e nunca com valor. */
function fraseDoPedido(agente: string, p: PayloadPropostaCredencial): string {
  const o_que = p.alvo === "github_token" ? "o token do GitHub" : p.alvo === "composio" ? "a chave do Composio do time" : `a chave ${p.chave ?? ""} do ${p.app}`;
  return `${agente} pede ${o_que}. ${p.para}`;
}

export const pedirCredencial: CasoNod<Deps, "pedir_credencial"> = async (deps, input) => {
  const ctx: ContextoFerramenta = { turnoId: input.turnoId, agenteId: input.agenteId, conversaId: input.conversaId };
  const alvo = await alvoDoPedido(deps, input);
  if (typeof alvo === "string") return { data: recusada(alvo) };
  const payload: PayloadPropostaCredencial = { kind: "credencial", ...alvo, para: paraDoCartao(input.para), turnoId: ctx.turnoId };
  await deps.repos.propostas.travarPedidosDoTurno(ctx.turnoId);
  const repetido = await cartaoRepetido(deps, ctx, payload);
  if (repetido) return { data: pendente(repetido.id) };

  const agora = deps.agora();
  const agente = await deps.repos.agentes.buscar(ctx.agenteId);
  const proposta = await deps.repos.propostas.criar({ conversaId: ctx.conversaId, agenteId: ctx.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({
    id: proposta.id,
    tipo: "credencial",
    agenteId: ctx.agenteId,
    conversaId: ctx.conversaId,
    turnoId: ctx.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    frase: fraseDoPedido(agente?.nome ?? "O bot", payload),
  });
  if (!decisao) throw new ErroDeDominio("nao_permitido");
  const autoria = autoriaDoAgente(deps.escopo, ctx.agenteId);
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: ctx.conversaId, turnoId: ctx.turnoId, dados: { proposta_id: proposta.id, kind: "credencial" } }),
    evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: ctx.conversaId, turnoId: ctx.turnoId, dados: { decisao_id: decisao.id, tipo: "credencial", proposta_id: proposta.id } }),
  ];
  return { data: pendente(proposta.id), events };
};
