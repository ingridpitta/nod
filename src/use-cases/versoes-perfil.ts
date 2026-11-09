import { CORES_AGENTE, FORMAS_AGENTE, type Agente } from "../contracts/agente.ts";
import type { PayloadPropostaPerfil, Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { VELOCIDADES_VOZ } from "../contracts/vozes.ts";
import {
  type AutorVersao,
  type DetalheVersaoPerfil,
  type ListaVersoesPerfil,
  type OrigemVersao,
  type PerfilVersionavel,
  type VersaoPerfil,
  VERSAO_MAXIMA,
  VERSOES_POR_PAGINA,
} from "../contracts/versoes-perfil.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod, nomeReservadoAoNod } from "../domain/nod.ts";
import { camposQueMudaram, perfilDoAgente, redigirPerfil, temRedacao } from "../domain/versoes-perfil.ts";
import { ehIdVoz } from "../domain/vozes.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { recusarPropostaObsoleta } from "./confirmar-perfil.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * definido em 2026-10-30 (NOD-20): grava a versão do perfil depois de uma escrita. Quem chama já travou a linha do agente
 * (buscarParaAtualizar) ANTES de ler `antes`, então a numeração e os campos não correm com outra escrita; o trigger
 * nod_versao_perfil_coerente (0132) é a segunda cerca (só max+1, só no bot da pessoa).
 * A comparação é cru×cru (o perfil vivo); o que grava sai redigido. Sem diferença, não grava e devolve null.
 * Na primeira mudança grava antes a v1 `inicial` com o perfil de antes (não há backfill).
 */
export async function registrarVersaoDoPerfil(
  deps: Deps,
  e: { antes: Agente; depois: Agente; origem: Exclude<OrigemVersao, "inicial">; autor?: AutorVersao; propostaId?: string | null; restauradaDe?: number | null },
): Promise<VersaoPerfil | null> {
  const antes = perfilDoAgente(e.antes);
  const depois = perfilDoAgente(e.depois);
  const campos = camposQueMudaram(antes, depois);
  if (campos.length === 0) return null;
  const repo = deps.repos.versoesPerfil;
  const ultima = await repo.ultima(e.depois.id);
  if (!ultima) await repo.inserir({ agenteId: e.depois.id, versao: 1, origem: "inicial", perfil: redigirPerfil(antes), campos: [] });
  const versao = await repo.inserir({
    agenteId: e.depois.id,
    versao: (ultima?.versao ?? 1) + 1,
    origem: e.origem,
    autor: e.origem === "chat" ? "nod" : (e.autor ?? "pessoa"),
    propostaId: e.origem === "proposta" ? (e.propostaId ?? null) : null,
    restauradaDe: e.origem === "restauracao" ? (e.restauradaDe ?? null) : null,
    perfil: redigirPerfil(depois),
    campos,
  });
  await repo.podar(e.depois.id);
  // ADR-004: a trilha só leva enum, uuid e número; a origem e o número da versão vão na regra (^[a-z0-9_:]+$) e o
  // conteúdo mora na tabela das versões.
  await deps.repos.trilha.registrar({ agenteId: e.depois.id, ferramenta: "perfil", kind: "perfil_versao", regra: `perfil:versao:${e.origem}:${versao.versao}`, regraVersao: 1, em: deps.agora() });
  return versao;
}

/** Um número de versão aceitável na entrada (a coluna é integer: acima disso o Postgres daria 500). */
function numeroDeVersao(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= VERSAO_MAXIMA;
}

/** O bot da pessoa, ou o erro certo: inexistente → nao_encontrado; de outra pessoa (equipe) → nao_permitido. */
async function agenteDaDona(deps: Deps, agenteId: string, travar: boolean): Promise<Agente> {
  const visto = await deps.repos.agentes.buscar(agenteId);
  if (!visto || visto.excluidoEm) throw new ErroDeDominio("nao_encontrado");
  if (visto.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  if (!travar) return visto;
  const travado = await deps.repos.agentes.buscarParaAtualizar(agenteId);
  if (!travado) throw new ErroDeDominio("nao_permitido");
  return travado;
}

/** A v1 de quando ainda não há nada gravado: o perfil de agora (redigido), para a lista não ficar vazia. */
function versaoVirtual(a: Agente): VersaoPerfil {
  const perfil = redigirPerfil(perfilDoAgente(a));
  return { id: `virtual-${a.id}`, agenteId: a.id, versao: 1, origem: "inicial", autor: "pessoa", propostaId: null, restauradaDe: null, perfil, campos: [], criadoEm: a.criadoEm, redigida: temRedacao(perfil) };
}

export const listarVersoesDoPerfil: CasoDeUso<{ agenteId: string; antes?: number | null }, ListaVersoesPerfil> = async (deps, input) => {
  const a = await agenteDaDona(deps, input.agenteId, false);
  const antes = input.antes === undefined || input.antes === null ? null : numeroDeVersao(input.antes) ? input.antes : false;
  if (antes === false) throw new ErroDeDominio("entrada_invalida", { cause: "antes" });
  const repo = deps.repos.versoesPerfil;
  const [{ versoes, mais }, total, ultima] = [await repo.listar(a.id, antes, VERSOES_POR_PAGINA), await repo.contar(a.id), await repo.ultima(a.id)];
  if (!ultima) return { data: { versoes: antes ? [] : [versaoVirtual(a)], total: 1, atual: 1, mais: false, virtual: true } };
  return { data: { versoes, total, atual: ultima.versao, mais, virtual: false } };
};

/** As propostas de perfil pendentes do bot (na conversa própria dele): restaurar as deixa obsoletas. */
async function propostasDePerfilPendentes(deps: Deps, agenteId: string): Promise<(Proposta & { payload: PayloadPropostaPerfil })[]> {
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agenteId);
  if (!conversa) return [];
  const pendentes = await deps.repos.propostas.pendentesDaConversa(conversa.id);
  return pendentes.filter((p): p is Proposta & { payload: PayloadPropostaPerfil } => p.payload.kind === "perfil" && p.agenteId === agenteId);
}

export const verVersaoDoPerfil: CasoDeUso<{ agenteId: string; versao: number }, DetalheVersaoPerfil> = async (deps, input) => {
  const a = await agenteDaDona(deps, input.agenteId, false);
  if (!numeroDeVersao(input.versao)) throw new ErroDeDominio("entrada_invalida", { cause: "versao" });
  const repo = deps.repos.versoesPerfil;
  const ultima = await repo.ultima(a.id);
  const versao = ultima ? await repo.buscar(a.id, input.versao) : input.versao === 1 ? versaoVirtual(a) : null;
  if (!versao) throw new ErroDeDominio("nao_encontrado");
  const p = perfilRestaurado(a, versao.perfil);
  // Revisão 3 M1: só avisa que a proposta deixa de valer quando restaurar a deixaria (texto mudando, como no restaurar).
  const proposta = p && textoMuda(a, p) ? (await propostasDePerfilPendentes(deps, a.id))[0] : undefined;
  return {
    data: {
      versao,
      atual: redigirPerfil(perfilDoAgente(a)),
      numeroAtual: ultima?.versao ?? 1,
      proxima: (ultima?.versao ?? 1) + 1,
      restauravel: p !== null,
      perdeSegredo: p !== null && perdeSegredo(a, p),
      propostaPendente: proposta ? { id: proposta.id, criadaEm: proposta.criadoEm } : null,
    },
  };
};

/**
 * O perfil que restaurar a versão aplicaria sobre `atual`, ou null quando nada mudaria. No Nod só o nome fica (ADR-081
 * decisão 3: título, missão, forma, cor e voz seguem livres, revisão 4 A1). Forma, cor e voz que não existem mais ficam como estão; o nome reservado
 * ao Nod não volta num bot comum. A comparação é com o perfil de agora redigido, a mesma forma em que a versão foi gravada:
 * uma missão com segredo não parece "diferente" só pela redação.
 */
function perfilRestaurado(atual: Agente, alvo: PerfilVersionavel): PerfilVersionavel | null {
  const agora = perfilDoAgente(atual);
  const nod = ehNod(atual);
  const p: PerfilVersionavel = {
    nome: nod || nomeReservadoAoNod(alvo.nome) ? agora.nome : alvo.nome.slice(0, 60),
    titulo: alvo.titulo.slice(0, 120),
    descricao: alvo.descricao.slice(0, 8000),
    forma: FORMAS_AGENTE.some((f) => f === alvo.forma) ? alvo.forma : agora.forma,
    cor: CORES_AGENTE.some((c) => c === alvo.cor) ? alvo.cor : agora.cor,
    voz: alvo.voz === null || ehIdVoz(alvo.voz) ? alvo.voz : agora.voz,
    vozVelocidade: (VELOCIDADES_VOZ as readonly number[]).includes(alvo.vozVelocidade) ? alvo.vozVelocidade : agora.vozVelocidade,
  };
  // Cada texto igual ao de agora depois de redigido continua o de agora (cru): restaurar não troca um segredo pelo marcador.
  const redigidoAgora = redigirPerfil(agora);
  if (p.nome === redigidoAgora.nome) p.nome = agora.nome;
  if (p.titulo === redigidoAgora.titulo) p.titulo = agora.titulo;
  if (p.descricao === redigidoAgora.descricao) p.descricao = agora.descricao;
  return camposQueMudaram(agora, p).length === 0 ? null : p;
}

/** Restaurar `p` troca nome, subtítulo ou missão (o que a proposta de perfil revisa, NOD-190). */
function textoMuda(atual: Agente, p: PerfilVersionavel): boolean {
  return p.nome !== atual.nome || p.titulo !== atual.titulo || p.descricao !== atual.descricao;
}

/**
 * definido em 2026-10-30 (NOD-20, revisão 2 A1): restaurar `p` sobre `atual` faz um segredo sumir de vez? Sim quando um
 * texto que muda traz o marcador «redigido: …» (o segredo da versão não volta) ou quando o texto de agora tem um segredo
 * (a versão nova grava o de agora redigido, e o vivo é trocado: o segredo de agora some). Aí a pessoa precisa aceitar.
 */
function perdeSegredo(atual: Agente, p: PerfilVersionavel): boolean {
  const agora = perfilDoAgente(atual);
  const redigidoAgora = redigirPerfil(agora);
  return (["nome", "titulo", "descricao"] as const).some((c) => p[c] !== agora[c] && (temRedacao({ ...p, nome: p[c], titulo: "", descricao: "" }) || redigidoAgora[c] !== agora[c]));
}

export type SaidaRestaurarVersao = { agente: Agente; versao: VersaoPerfil; propostasObsoletas: string[] };

export type EntradaRestaurarVersao = {
  agenteId: string;
  versao: number;
  /**
   * O número da versão vigente que quem pediu viu (o comparativo, o Desfazer). Diferente do de agora → estado_invalido
   * `perfil_mudou`: restaurar não desfaz em silêncio uma mudança que entrou depois. Ausente = sem guarda (o Nod no chat).
   */
  esperada?: number | null;
  /**
   * A pessoa viu o aviso de que partes com segredo voltam como «redigido: …» e confirmou. Sem isto, restaurar um texto
   * redigido recusa (estado_invalido `versao_redigida`): trocaria o texto vivo pelo marcador, e o segredo some.
   */
  aceitarRedacao?: boolean;
  /** Pelo gerir_bots (o Nod): a versão nova sai com autor nod. Só o executor do lote liga; a rota não repassa. */
  peloNod?: boolean;
};

/**
 * Restaurar a versão N: trava o agente, aplica o perfil da versão (perfilRestaurado), grava a versão nova `restauracao`
 * com restaurada_de = N e deixa obsoletas as propostas de perfil pendentes do bot (a mesma recusa da NOD-190, com o aviso
 * na conversa e a decisão fechada). Igual a agora → estado_invalido; versão inexistente ou podada → nao_encontrado.
 * Ordem das travas: agente → proposta → decisão (a mesma da confirmação).
 */
export const restaurarVersaoDoPerfil: CasoDeUso<EntradaRestaurarVersao, SaidaRestaurarVersao> = async (deps, input) => {
  if (!numeroDeVersao(input.versao)) throw new ErroDeDominio("entrada_invalida", { cause: "versao" });
  if (input.esperada !== undefined && input.esperada !== null && !numeroDeVersao(input.esperada)) throw new ErroDeDominio("entrada_invalida", { cause: "esperada" });
  const atual = await agenteDaDona(deps, input.agenteId, true);
  const repo = deps.repos.versoesPerfil;
  // Com a linha do agente travada, a última versão não muda até o commit: a guarda não corre com outra escrita.
  const numeroAtual = (await repo.ultima(atual.id))?.versao ?? 1;
  if (input.esperada !== undefined && input.esperada !== null && input.esperada !== numeroAtual) throw new ErroDeDominio("estado_invalido", { cause: "perfil_mudou" });
  const alvo = await repo.buscar(atual.id, input.versao);
  if (!alvo) throw new ErroDeDominio("nao_encontrado");
  const p = perfilRestaurado(atual, alvo.perfil);
  if (!p) throw new ErroDeDominio("estado_invalido", { cause: "igual_a_atual" });
  const textoMudou = textoMuda(atual, p);
  if (!input.aceitarRedacao && perdeSegredo(atual, p)) throw new ErroDeDominio("estado_invalido", { cause: "versao_redigida" });
  const mudouPerfil = textoMudou || p.forma !== atual.forma || p.cor !== atual.cor;
  let agente = mudouPerfil
    ? await deps.repos.agentes.atualizarPerfil(atual.id, { nome: p.nome, titulo: p.titulo, descricao: p.descricao, forma: p.forma, cor: p.cor, ...(p.titulo !== atual.titulo || p.descricao !== atual.descricao ? { confirmado: true } : {}) })
    : atual;
  if (!agente) throw new ErroDeDominio("nao_permitido");
  if (p.voz !== (atual.voz ?? null) || p.vozVelocidade !== (atual.vozVelocidade ?? 1)) {
    agente = await deps.repos.agentes.definirVoz(atual.id, { voz: p.voz, velocidade: p.vozVelocidade });
    if (!agente) throw new ErroDeDominio("nao_permitido");
  }
  const versao = await registrarVersaoDoPerfil(deps, { antes: atual, depois: agente, origem: "restauracao", autor: input.peloNod ? "nod" : "pessoa", restauradaDe: alvo.versao });
  if (!versao) throw new ErroDeDominio("estado_invalido", { cause: "igual_a_atual" });

  const events: RuntimeEvent[] = [];
  const obsoletas: string[] = [];
  // A proposta de perfil é sobre os textos (a revisão da NOD-190 compara nome, subtítulo e missão): voltar só a forma, a
  // cor ou a voz não a deixa obsoleta.
  for (const proposta of textoMudou ? await propostasDePerfilPendentes(deps, agente.id) : []) {
    // Revisão 3 B1: a pessoa pode ter recusado o card no meio (a lista foi lida sem trava da proposta): já decidida, segue.
    const r = await recusarPropostaObsoleta(deps, proposta, proposta.payload, agente).catch((e: unknown) => {
      if (e instanceof ErroDeDominio && e.codigo === "estado_invalido" && String(e.cause).startsWith("proposta ")) return null;
      throw e;
    });
    if (!r) continue;
    obsoletas.push(proposta.id);
    events.push(...r.events);
  }
  events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora: deps.agora(), dados: { agente_id: agente.id, acao: "perfil_restaurado", nome: agente.nome, versao: versao.versao } }));
  return { data: { agente, versao, propostasObsoletas: obsoletas }, events };
};
