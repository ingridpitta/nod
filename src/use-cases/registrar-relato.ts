import type { Mensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { JANELA_RELATO_MS, type EntradaRelato, type Relato } from "../contracts/relato.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigirSegredos } from "../domain/segredos.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type SaidaRegistrarRelato = { relato: Relato };

/** Um bot não tem nome aqui: o trecho guarda o TIPO do autor, que é o que a investigação usa. */
function autorDe(m: Mensagem): string {
  return m.autoria.autor_tipo === "pessoa" ? "pessoa" : "agente";
}

/**
 * O trecho que o relato anexa (o do botão e o contado ao Nod): o tipo do autor e o texto redigido (NOD-158).
 * `naAtividade` (ADR-041, emenda do PR 2 do chat limpo, 2026-10-18): o item estava na Atividade do bot, não no chat — o
 * relato registra o que a pessoa viu.
 */
export function trechoDoRelato(mensagens: readonly Mensagem[]): { mensagens: { id: string; autor: string; kind: string; texto: string; em: number; naAtividade?: true }[] } {
  return { mensagens: mensagens.map((m) => ({ id: m.id, autor: autorDe(m), kind: m.kind, texto: redigirSegredos(m.texto), em: m.criadoEm, ...(m.destino && m.destino !== "chat" ? { naAtividade: true as const } : {}) })) };
}

/**
 * Como o relato chegou ao turno que explica a mensagem (NOD-292, emenda do ADR-041 de 2026-10-20). Vai no
 * `relato_criado` como `turno_via`:
 * - `mensagem`: a fala do bot, produzida pelo turno (`mensagens.turno_id`);
 * - `disparado`: a fala da pessoa, pelo turno que ela disparou (`turnos.mensagem_origem_id`);
 * - `absorvedor`: a fala da pessoa que foi lida junto com outra — o turno que respondeu por ela (`absorvido_por`);
 * - `nenhum`: nada explica a mensagem (sistema, negação, fala da pessoa sem turno).
 */
export type ViaTurnoRelato = "mensagem" | "disparado" | "absorvedor" | "nenhum";

/** Teto da cadeia de absorção seguida (A absorvido por B absorvido por C…); o Set de vistos corta ciclo antes. */
export const MAX_SALTOS_ABSORCAO = 5;

/**
 * O turno que explica a mensagem apontada (NOD-292). A fala do bot aponta o turno que a produziu; a fala da
 * pessoa não tem `turnoId`, então vale o turno que ela disparou — e, se ele foi absorvido, o que respondeu
 * por ele. A fala de bot sem `turnoId` não busca por origem: só a pessoa dispara turno.
 */
async function turnoAlvo(deps: Deps, mensagem: Mensagem): Promise<{ turno: Turno | null; via: ViaTurnoRelato }> {
  if (mensagem.turnoId) {
    const turno = await deps.repos.turnos.buscar(mensagem.turnoId);
    return { turno, via: turno ? "mensagem" : "nenhum" };
  }
  if (mensagem.autoria.autor_tipo !== "pessoa") return { turno: null, via: "nenhum" };
  const disparado = await deps.repos.turnos.buscarPorMensagemOrigem(mensagem.id);
  if (!disparado) return { turno: null, via: "nenhum" };
  let turno = disparado;
  let saltos = 0;
  const vistos = new Set<string>([turno.id]);
  while (saltos < MAX_SALTOS_ABSORCAO && turno.motivoInterrupcao === "absorvido" && turno.absorvidoPor && !vistos.has(turno.absorvidoPor)) {
    const proximo = await deps.repos.turnos.buscar(turno.absorvidoPor);
    if (!proximo) break; // o salto que não acha fica no último turno achado
    vistos.add(proximo.id);
    turno = proximo;
    saltos++;
  }
  return { turno, via: saltos > 0 ? "absorvedor" : "disparado" };
}

/**
 * A pessoa aponta uma mensagem e diz que o comportamento não foi o desejado (ADR-041).
 *
 * O que ela informa é curto — qual mensagem, que categoria, se anexa a janela, e um texto opcional.
 * O que o time recebe é o estado técnico inteiro do momento, copiado daquilo que JÁ estava tipado e
 * persistido: sinais write-ahead do turno (ADR-009), motivo da falha, modelo, harness, custo, e o
 * diagnóstico que a ponte gravou quando a execução não concluiu.
 *
 * O turno é o que EXPLICA a mensagem (NOD-292, `turnoAlvo`): o que produziu a fala do bot, ou o que a fala
 * da pessoa disparou (ou o que a absorveu). `relato.turnoId` é esse turno, não `mensagem.turnoId`.
 *
 * A prosa (texto da pessoa + trecho da conversa) vai para `relato_prosa`, apagável por nod_poda: o
 * trecho pode carregar dado pessoal (ADR-002) e conteúdo não confiável (ADR-026), e precisa sair
 * inteiro num pedido de exclusão sem levar o registro junto.
 */
export const registrarRelato: CasoDeUso<EntradaRelato, SaidaRegistrarRelato> = async (deps, input) => {
  const mensagem = await deps.repos.mensagens.buscar(input.mensagemId);
  if (!mensagem) throw new ErroDeDominio("nao_encontrado");

  const agora = deps.agora();
  // Mensagem de sistema/negação (ou fala da pessoa sem turno) pode não ter turno; o relato continua válido, só sem metadado de execução.
  const { turno, via } = await turnoAlvo(deps, mensagem);
  const diagnostico = turno ? await deps.repos.relatos.diagnosticoDoTurno(turno.id) : null;

  // A janela é resolvida AQUI, ancorada na mensagem apontada: o cliente manda o alcance, nunca o
  // intervalo. Ler sob RLS já filtra o que esta pessoa pode ver.
  // Chat limpo (PR 2): na conversa própria a janela conta itens de chat e leva os da Atividade marcados (janelaAte).
  const propria = input.alcance === "janela" && (await deps.repos.conversas.buscar(mensagem.conversaId))?.tipo === "propria";
  const anexadas =
    input.alcance === "janela"
      ? await deps.repos.mensagens.janelaAte(mensagem.conversaId, mensagem.id, mensagem.criadoEm - JANELA_RELATO_MS, undefined, { comDestino: propria })
      : [mensagem];

  const relato = await deps.repos.relatos.criar({
    mensagemId: mensagem.id,
    conversaId: mensagem.conversaId,
    turnoId: turno?.id ?? null,
    categoria: input.categoria,
    alcance: input.alcance,
    mensagensAnexadas: anexadas.length,
    estadoTurno: turno?.estado ?? null,
    origemTurno: turno?.origem ?? null,
    sinais: turno?.sinais ?? null,
    motivoFalha: turno?.motivoFalha ?? null,
    motivoInterrupcao: turno?.motivoInterrupcao ?? null,
    modelo: turno?.modelo ?? null,
    harness: turno?.harness ?? null,
    // NOD-291: o executor em que o turno rodou; a autoria da mensagem é o fallback (a mensagem sem turno).
    executor: turno?.executor ?? mensagem.autoria.executor,
    machineId: turno?.machineId ?? mensagem.autoria.machine_id,
    custoUsd: turno?.custoUsd ?? null,
    reenvios: turno?.reenvios ?? null,
    confiancaMensagem: mensagem.confianca,
    mensagemParcial: mensagem.parcial,
    versaoApp: input.versaoApp ?? null,
    correlationId: input.correlationId ?? null,
  });
  if (!relato) throw new ErroDeDominio("nao_permitido");

  // Aparado aqui também, não só no validador da borda: quem chamar o caso de uso por outro caminho
  // não grava espaço em branco como se fosse complemento da pessoa.
  // NOD-158: a prosa é uma cópia que sai do contexto vivo, então vai redigida; a mensagem gravada não muda.
  const textoPessoa = input.texto?.trim() ?? "";
  await deps.repos.relatos.gravarProsa({
    relatoId: relato.id,
    textoPessoa: textoPessoa === "" ? null : redigirSegredos(textoPessoa),
    trecho: trechoDoRelato(anexadas),
  });

  // Só escalares no evento (DadosEvento): o texto do relato NUNCA sai daqui (ADR-004).
  const events = [
    evento(deps.escopo, {
      kind: "relato_criado",
      autoria: autoriaPessoa(deps.escopo, mensagem.autoria.executor),
      agora,
      conversaId: mensagem.conversaId,
      turnoId: turno?.id ?? null,
      dados: {
        relato_id: relato.id,
        categoria: relato.categoria,
        alcance: relato.alcance,
        mensagens_anexadas: relato.mensagensAnexadas,
        com_diagnostico: diagnostico !== null,
        turno_via: via,
      },
    }),
  ];

  return { data: { relato: { ...relato, diagnostico } }, events };
};

export const listarRelatos: CasoDeUso<{ limite?: number }, { relatos: Relato[] }> = async (deps, input) => {
  return { data: { relatos: await deps.repos.relatos.listar(input.limite) } };
};
