import type { Autoria } from "../../contracts/evento.ts";
import type { AssumeBots, OpcoesRemover, PreviaRemoverDto, ResultadoRemoverDto } from "../../contracts/remover-computador.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { botsDoComputador, planoDeRemover } from "../../domain/maquinas-remover.ts";
import { ehNod } from "../../domain/nod.ts";
import { PRAZO_DESCONEXAO_MS } from "../../services/logins-na-maquina.ts";
import { autoriaPessoa, evento } from "../autoria-evento.ts";
import { removerMaquina } from "../interromper-por-maquina.ts";
import type { CasoDeUso, Deps } from "../tipos.ts";

/**
 * ADA-245 (jornada D do onboarding): o executor único de "Remover o nod deste computador" (ADR-135). A tela
 * (POST /maquinas/:id/remover, rotas/contas-ia.ts) e o card do chat (a ferramenta remover_computador, aprovado pela
 * pessoa no lote) chamam a MESMA função, na transação de quem chama:
 *  - os bots presos ao computador soltam e passam a seguir o padrão; se ele era o padrão, o próximo computador de
 *    trabalho vira o padrão (src/domain/maquinas-remover.ts), ou ninguém, e os bots esperam um computador;
 *  - sem "Continuar ligado" (`manterConexao`), o computador sai da conta: revogado agora quando o próprio app limpa
 *    este computador (`daqui`), senão a chave vence em PRAZO_DESCONEXAO_MS e o efeito depois do commit decide (ligado:
 *    a limpeza vai na puxada e a chave cai quando ele confirma; desligado: revoga agora);
 *  - apagar arquivos é do app (a ponte removerDaqui) ou do motor (a puxada): nunca do servidor.
 */

export type EntradaRemover = OpcoesRemover & { maquinaId: string; /** a limpeza local é do app que pediu (a tela no próprio computador) */ daqui?: boolean; autoria?: Autoria };

type Chave = Awaited<ReturnType<Deps["repos"]["maquinaTokens"]["listar"]>>[number];

async function lerEstado(deps: Deps, id: string) {
  const [chaves, preferencias, agentes] = await Promise.all([deps.repos.maquinaTokens.listar(), deps.repos.preferencias.buscar(), deps.repos.agentes.listar({ incluirOcultos: true })]);
  // O só-computador (NOD-94) não roda o nod para se limpar: sai pelo "Desconectar" de antes, não por aqui (revisão do PR #694).
  const chave = chaves.find((c) => c.id === id && c.revogadaEm === null && c.papel !== "computador");
  if (!chave) throw new ErroDeDominio("nao_encontrado", { cause: "computador" });
  const padraoId = preferencias.maquinaPadraoId ?? null;
  const bots = agentes.filter((b) => b.ownerId === deps.escopo.pessoaId && b.dono === "pessoa" && !ehNod(b) && b.excluidoEm === null).map((b) => ({ id: b.id, nome: b.nome, maquinaId: b.maquinaId ?? null }));
  const vivas = new Set(chaves.filter((c) => c.revogadaEm === null && c.papel !== "computador").map((c) => c.id));
  // A escolha do próximo padrão não olha quem está ligado agora (o card do chat roda sem saber): o último uso já é recente
  // em quem está conectado, e assim a tela e o chat escolhem o mesmo.
  const plano = planoDeRemover({ id, padraoId, computadores: chaves.map(paraEscolha), conectados: new Set() });
  return { chave, padraoId, plano, daqui: botsDoComputador(bots, id, padraoId, vivas) };
}

const paraEscolha = (c: Chave) => ({ id: c.id, nome: c.nome, revogadaEm: c.revogadaEm, papel: c.papel ?? "motor", ultimoUsoEm: c.ultimoUsoEm, criadaEm: c.criadaEm });

/** O que o diálogo mostra antes (GET /maquinas/:id/remover/previa): os bots daqui e quem assume. Só lê. */
export async function previaDeRemover(deps: Deps, id: string, online: boolean, plataforma: string | null): Promise<PreviaRemoverDto> {
  const e = await lerEstado(deps, id);
  return { id, nome: e.chave.nome, plataforma, online, ehPadrao: e.plano.ehPadrao, bots: e.daqui.map((b) => b.nome), assume: e.plano.assume };
}

/** maquinas.remover: o executor único. `aguardandoComputador` sai sempre false: quem sabe se ele está ligado é a rota. */
export const removerComputador: CasoDeUso<EntradaRemover, ResultadoRemoverDto> = async (deps, input) => {
  if (typeof input.maquinaId !== "string" || typeof input.manterIas !== "boolean" || typeof input.manterConexao !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "remover computador" });
  const e = await lerEstado(deps, input.maquinaId);
  const id = e.chave.id;
  const presos = e.daqui.filter((b) => b.maquinaId === id).map((b) => b.id);
  if (presos.length > 0) await deps.repos.agentes.definirMaquina(presos, null);
  if (e.plano.novoPadrao !== undefined) await deps.repos.preferencias.definirMaquinaPadrao(e.plano.novoPadrao?.id ?? null);
  const saiu = !input.manterConexao;
  if (saiu && input.daqui) await removerMaquina(deps, id);
  else if (saiu) await deps.repos.maquinaTokens.vencerEm(id, deps.agora() + PRAZO_DESCONEXAO_MS);
  if (!input.daqui) deps.aposCommit?.({ tipo: "remover_computador", maquinaId: id, manterIas: input.manterIas, manterConexao: input.manterConexao });
  const assume: AssumeBots = e.plano.assume;
  const autoria = input.autoria ?? autoriaPessoa(deps.escopo);
  const ev = evento(deps.escopo, { kind: "agente_atualizado", autoria, agora: deps.agora(), dados: { acao: "maquinas.remover", maquina_id: id, bots: e.daqui.length, assume: assume?.id ?? null, saiu_da_conta: saiu } });
  return { data: { ok: true, nome: e.chave.nome, bots: e.daqui.map((b) => b.nome), assume, saiuDaConta: saiu, aguardandoComputador: false }, events: [ev] };
};

/**
 * Os executores únicos das máquinas (definido em 2026-11-07, ADA-243, ADR-135): a rota da tela (PUT /maquinas/padrao,
 * usada pelo seletor "Máquina padrão" e pela tela "Onde os bots trabalham") e o gerir_maquinas de QUALQUER bot chamam a
 * MESMA função, e o teste de contrato (tests/integration/paridade-maquinas.test.ts) leva os dois ao mesmo padraoId.
 */

/**
 * A chave viva da pessoa que pode ser padrão: não revogada e não só-computador (NOD-94). Fora disso, nao_encontrado
 * (a chave revogada some da lista; o só-computador nunca roda bot).
 */
export async function exigirChaveViva(d: Pick<Deps, "repos">, id: unknown): Promise<string> {
  if (typeof id !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "máquina" });
  const viva = (await d.repos.maquinaTokens.listar()).find((c) => c.id === id && c.revogadaEm === null && c.papel !== "computador");
  if (!viva) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
  return viva.id;
}

/** `maquinaId: null` = qualquer uma (tira a padrão). Vale a última gravação (on conflict do update). */
export const definirMaquinaPadrao: CasoDeUso<{ maquinaId: unknown }, { padraoId: string | null }> = async (deps, input) => {
  const id = input.maquinaId === null ? null : await exigirChaveViva(deps, input.maquinaId);
  const r = await deps.repos.preferencias.definirMaquinaPadrao(id);
  return { data: { padraoId: r.maquinaPadraoId ?? null } };
};

/** A tabela id → executor das máquinas; o registro aponta para ela por `casoDeUso`. */
export const EXECUTORES_MAQUINAS = {
  "maquinas.remover": removerComputador,
  "maquinas.definir_padrao": definirMaquinaPadrao,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
