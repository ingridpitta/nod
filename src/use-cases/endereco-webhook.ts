import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { CHAMADAS_NO_LOG, PENDENTES_MAX } from "../domain/rotina-webhook.ts";
import { cunharSegredoHmac, cunharTokenGatilho } from "../services/token-gatilho.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O endereço do webhook (NOD-84, ADR-139): ver (só a dona, o inteiro), gerar novo (revoga o anterior na mesma
 * transação) e o "Enviar teste". O token e o segredo inteiros só saem por `verEnderecoWebhook`, que a rota serve com
 * no-store para o Copiar; nenhum outro caminho (evento, mensagem, trilha, ferramenta do bot) os carrega.
 */
export type Cifrar = (texto: string) => string;

/** A rotina webhook viva da dona, de um bot vivo (o bot excluído leva a rotina junto: não se vê nem testa o endereço). */
async function rotinaWebhookDaDona(deps: Deps, rotinaId: string, opcoes: { travar?: boolean } = {}): Promise<Rotina> {
  const rotina = opcoes.travar ? await deps.repos.rotinas.buscarParaAtualizar(rotinaId) : await deps.repos.rotinas.buscar(rotinaId);
  if (!rotina || rotina.excluidoEm !== null) throw new ErroDeDominio("nao_encontrado");
  if (rotina.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  if (rotina.gatilho !== "webhook") throw new ErroDeDominio("estado_invalido", { cause: "rotina sem webhook" });
  if (!(await deps.repos.agentes.buscar(rotina.agenteId))) throw new ErroDeDominio("nao_encontrado", { cause: "bot excluído" });
  return rotina;
}

/** Cunha token e segredo HMAC, cifra os dois e grava (revogando o vivo). Devolve só o prefixo, para a tela mascarar. */
export async function novoEnderecoDaRotina(deps: Deps, rotinaId: string, cifrar: Cifrar): Promise<{ prefixo: string }> {
  const c = cunharTokenGatilho(deps.escopo, rotinaId);
  const g = await deps.repos.rotinaGatilhos.criar({ rotinaId, prefixo: c.prefixo, hash: c.hash, tokenCifrado: cifrar(c.token), segredoHmacCifrado: cifrar(cunharSegredoHmac()) }, deps.agora());
  if (!g) throw new ErroDeDominio("estado_invalido", { cause: "endereço não gravado" });
  return { prefixo: g.prefixo };
}

/** O caminho (`/api/w/<token>`; a web põe a origem) e o segredo do GitHub. Só a dona. */
export const verEnderecoWebhook: CasoDeUso<{ rotinaId: string; decifrar(cifrado: string): string }, { caminho: string; segredo: string; prefixo: string }> = async (deps, input) => {
  const rotina = await rotinaWebhookDaDona(deps, input.rotinaId);
  const g = await deps.repos.rotinaGatilhos.vivoDaRotina(rotina.id);
  if (!g) throw new ErroDeDominio("nao_encontrado", { cause: "rotina sem endereço vivo" });
  return { data: { caminho: `/api/w/${input.decifrar(g.tokenCifrado)}`, segredo: input.decifrar(g.segredoHmacCifrado), prefixo: g.prefixo } };
};

/** "Gerar novo endereço": o antigo deixa de valer na hora (a chamada com ele vira "recusada"). */
export const gerarEnderecoWebhook: CasoDeUso<{ rotinaId: string; cifrar: Cifrar }, { prefixo: string }> = async (deps, input) => {
  // Trava a rotina: dois "Gerar novo" ao mesmo tempo se enfileiram (sem a trava, o 2º revoga o antigo já revogado e
  // bate no índice de um-vivo), e a chamada que chega no meio espera a troca terminar.
  const rotina = await rotinaWebhookDaDona(deps, input.rotinaId, { travar: true });
  return { data: await novoEnderecoDaRotina(deps, rotina.id, input.cifrar) };
};

/** O payload fictício do teste: diz que é teste, o provedor e o primeiro evento do filtro. */
export function payloadDeTeste(rotina: Pick<Rotina, "provedor" | "eventos">): string {
  return JSON.stringify({ teste: true, provedor: rotina.provedor, evento: rotina.eventos?.[0] ?? null, mensagem: "Chamada de teste enviada pelo nod. Não lance nada." }, null, 2);
}

/**
 * "Enviar teste": um turno de verdade com a etiqueta teste, a pessoa olhando a tela (pessoaEsperando), e a chamada
 * "teste" no log. Não passa pelo filtro de evento, mas respeita a pausa e o teto da fila (revisão da NOD-84: o teste
 * não fura o que vale para o provedor), com a rotina travada como na chamada de fora. Como toda chamada de webhook, o
 * turno é não confiável: efeito externo pede aprovação, e a entrada pede para não lançar nada.
 */
export const testarWebhook: CasoDeUso<{ rotinaId: string; executor: Executor; machineId: string; emoldurar(texto: string): string }, { turnoId: string | null; conversaId: string; bloqueada: boolean }> = async (deps, input) => {
  const rotina = await rotinaWebhookDaDona(deps, input.rotinaId, { travar: true });
  if (rotina.estado === "pausada") throw new ErroDeDominio("estado_invalido", { cause: "rotina pausada" });
  if ((await deps.repos.rotinaJanelas.contarAbertas(rotina.id, deps.agora())) >= PENDENTES_MAX) throw new ErroDeDominio("limite_atingido", { cause: "fila do webhook cheia" });
  const evento = rotina.eventos?.[0] ?? null;
  const webhook = { entrada: input.emoldurar(payloadDeTeste(rotina)), provedor: rotina.provedor ?? "provedor", evento, teste: true };
  const base = deps.agora();
  for (let i = 0; i < 3; i++) {
    const r = await dispararRotina(deps, { rotina, instanteAgendado: base + i, machineId: input.machineId, executor: input.executor, preservarAgenda: true, webhook });
    if ("janelaDeOutro" in r.data) continue;
    const turnoId = "turno" in r.data ? r.data.turno.id : null;
    await deps.repos.rotinaChamadas.registrar({ rotinaId: rotina.id, em: deps.agora(), desfecho: "teste", ...(evento ? { evento } : {}), ...(turnoId ? { turnoId } : {}) });
    await deps.repos.rotinaChamadas.podar(rotina.id, deps.agora(), CHAMADAS_NO_LOG);
    const events: RuntimeEvent[] = r.events ?? [];
    return { data: { turnoId, conversaId: rotina.conversaId, bloqueada: "bloqueada" in r.data }, events };
  }
  throw new ErroDeDominio("limite_atingido", { cause: "janela do teste ocupada" });
};
