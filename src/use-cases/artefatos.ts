import type { Artefato, ArtefatoDto } from "../contracts/artefato.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { htmlParaLeitura, normalizarTitulo, textoDaPublicacao, validarEstado, validarHtml } from "../domain/artefato.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { assertUuid } from "./apoio-l7.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O artefato do nod (ADR-051): o bot publica HTML que aparece DENTRO da conversa. Nada sai do nod — é
 * uma mensagem nova na conversa do turno e uma linha de versão —, por isso publicar_artefato não tem
 * efeito externo e vale em todo turno, com entrada confiável ou não (ADR-066). Quem isola o HTML é a web:
 * iframe sandbox sem allow-same-origin, CSP sem rede, postMessage filtrado pela origem do próprio iframe.
 */

/**
 * O artefato tem de ser DESTE agente: o id vem do modelo, e a RLS de leitura é da pessoa — ela abre os
 * artefatos de todos os bots dela. Sem este filtro um bot publicaria versão no artefato de outro.
 */
async function artefatoDoAgente(deps: Deps, agenteId: string, artefatoId: string): Promise<Artefato> {
  assertUuid(artefatoId, "artefato_id");
  const a = await deps.repos.artefatos.buscar(artefatoId);
  if (!a || a.agenteId !== agenteId) throw new ErroDeDominio("nao_encontrado", { cause: "artefato de outro agente ou inexistente" });
  return a;
}

/**
 * A marca de confiança é do CONTEÚDO (ADR-026): o HTML escrito num turno que leu conteúdo não confiável
 * herda a marca da entrada. Sem plano nem turno, fail-closed.
 */
async function confiancaDoTurno(deps: Deps, input: ContextoFerramenta): Promise<Confianca> {
  if (input.plano) return input.plano.confiancaEntrada;
  return (await deps.repos.turnos.buscar(input.turnoId))?.entradaConfianca ?? "nao_confiavel";
}

/**
 * `publicar_artefato`: sem artefato_id nasce a v1; com ele, a próxima versão do MESMO artefato (a linha é
 * travada pelo UPDATE, então duas publicações simultâneas viram v2 e v3). Grava a mensagem 'artefato' na
 * conversa do turno — só ids no payload; o HTML fica na versão — e devolve o evento mensagem_criada que
 * as outras falas emitem, para a web reler a conversa. Erro de domínio volta TIPADO em {erro} (mesmo
 * contrato das ferramentas de rotina), sempre ANTES de qualquer escrita.
 */
export const publicarArtefato: CasoNod<Deps, "publicar_artefato"> = async (deps, input) => {
  let artefato: Artefato;
  let html: string;
  try {
    const titulo = normalizarTitulo(input.titulo);
    html = validarHtml(input.html);
    if (input.artefato_id !== undefined) {
      const atual = await artefatoDoAgente(deps, input.agenteId, input.artefato_id);
      const proxima = await deps.repos.artefatos.proximaVersao(atual.id, titulo);
      if (!proxima) throw new ErroDeDominio("nao_encontrado", { cause: "artefato sumiu entre ler e versionar" });
      artefato = proxima;
    } else {
      const criado = await deps.repos.artefatos.criar({ agenteId: input.agenteId, conversaId: input.conversaId, titulo });
      if (!criado) throw new ErroDeDominio("estado_invalido", { cause: "artefato não criado" });
      artefato = criado;
    }
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }

  const agora = deps.agora();
  const versao = artefato.versaoAtual;
  const autoria = input.plano?.autoria ?? autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "artefato",
    texto: textoDaPublicacao({ titulo: artefato.titulo, versao, artefatoId: artefato.id }),
    payload: { kind: "artefato", artefatoId: artefato.id, versao, titulo: artefato.titulo },
    confianca: await confiancaDoTurno(deps, input),
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "mensagem do artefato não criada" });
  await deps.repos.artefatos.gravarVersao({ artefatoId: artefato.id, versao, html, mensagemId: mensagem.id });
  const events = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { mensagem_id: mensagem.id, kind: "artefato", artefato_id: artefato.id, versao } })];
  return { data: { artefato_id: artefato.id, versao }, events };
};

/**
 * `ler_artefato`: o que a pessoa marcou e o HTML da versão atual (até 60 000 caracteres, com marca de
 * corte). O estado lido é o da pessoa do turno. Só leitura; o proxy recebe o conteúdo como NÃO
 * confiável (chamar-ferramenta.ts): o estado foi escrito pela página, que é código do bot.
 */
export const lerArtefato: CasoNod<Deps, "ler_artefato"> = async (deps, input) => {
  try {
    const a = await artefatoDoAgente(deps, input.agenteId, input.artefato_id);
    const v = await deps.repos.artefatos.versao(a.id, a.versaoAtual);
    if (!v) throw new ErroDeDominio("nao_encontrado", { cause: "versão atual ausente" });
    const estado = await deps.repos.artefatos.estado(a.id);
    return { data: { artefato_id: a.id, titulo: a.titulo, versao: a.versaoAtual, estado: estado?.dados ?? null, html: htmlParaLeitura(v.html) } };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
};

/**
 * GET artefatos/:id (e /versoes/:versao): o card da web busca o HTML e o estado quando aparece — a
 * mensagem só carrega ids. Outra pessoa não vê o artefato (RLS por owner_id): nao_encontrado.
 */
export const lerArtefatoDaPessoa: CasoDeUso<{ artefatoId: string; versao?: number }, ArtefatoDto> = async (deps, input) => {
  assertUuid(input.artefatoId, "artefatoId");
  const a = await deps.repos.artefatos.buscar(input.artefatoId);
  if (!a) throw new ErroDeDominio("nao_encontrado", { cause: "artefato" });
  const v = await deps.repos.artefatos.versao(a.id, input.versao ?? a.versaoAtual);
  if (!v) throw new ErroDeDominio("nao_encontrado", { cause: "versão do artefato" });
  const estado = await deps.repos.artefatos.estado(a.id);
  return { data: { artefato: a, versao: { versao: v.versao, html: v.html, criadoEm: v.criadoEm }, estado: estado ? { dados: estado.dados, atualizadoEm: estado.atualizadoEm } : null } };
};

/**
 * PUT artefatos/:id/estado: o que a pessoa marcou na página (window.nod.salvar), até 64 KB de JSON. A
 * validação vem antes do banco; o banco mede de novo na forma do jsonb e, sem caber, nada é gravado.
 */
export const salvarEstadoArtefato: CasoDeUso<{ artefatoId: string; dados: unknown }, { ok: true; atualizadoEm: number }> = async (deps, input) => {
  const json = validarEstado(input.dados);
  assertUuid(input.artefatoId, "artefatoId");
  const a = await deps.repos.artefatos.buscar(input.artefatoId);
  if (!a) throw new ErroDeDominio("nao_encontrado", { cause: "artefato" });
  const salvo = await deps.repos.artefatos.salvarEstado(a.id, json);
  if (!salvo) throw new ErroDeDominio("entrada_invalida", { cause: "estado do artefato > 64 KB na forma do jsonb" });
  return { data: { ok: true, atualizadoEm: salvo.atualizadoEm } };
};
