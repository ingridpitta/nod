import type { Agente } from "../contracts/agente.ts";
import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Confianca, Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import type { Negacao } from "../contracts/negacao.ts";
import type { EstadoOrcamento, Sala } from "../contracts/sala.ts";
import type { Turno } from "../contracts/turno.ts";
import { avaliarOrcamento, registrarPost, TETO_POSTS_SEM_HUMANO, type DecisaoOrcamento } from "../domain/canal-orcamento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { descreverNegacao } from "../domain/estado-degradacao.ts";
import { redigir } from "../domain/redacao.ts";
import { responders } from "../domain/rodada-sala.ts";
import { autoriaPessoa, evento, exigir, fecharRodadaSeAssentou, PRAZO_DECISAO_MS, rodadaDaSala } from "./apoio-l7.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaPost = {
  salaId: string;
  texto: string;
  /** Default: a pessoa da sessão. Um bot posta pela L6 (assentar-turno) com a própria autoria composta. */
  autoria?: Autoria;
  confianca?: Confianca;
  turnoId?: string | null;
  /** NOD-206: o executor do turno que postou (o dos bots respondentes). A fala da pessoa não o traz. */
  executor?: Executor;
  /** Post originado de turno de rotina é isento do orçamento (E5.5, E12.3). */
  eRotina?: boolean;
  /** NOD-353: o resumo das ações do turno do bot que postou (a fala da sala o mostra como a da conversa própria). */
  acoes?: Extract<PayloadMensagem, { kind: "acoes_do_turno" }> | null;
  /**
   * Presença do bot candidato (ADR-021: derivada do poll, sem heartbeat). Nesta rodada todos os
   * bots da sala rodam na máquina de quem a abriu, então o default é "online"; quem tiver a
   * presença por máquina (L9) injeta aqui e o ausente vira passe `ausente_offline`, nunca silêncio.
   */
  estaOnline?: (agente: Agente) => boolean;
};

export type SaidaPost = {
  mensagem: Mensagem;
  turnos: Turno[];
  passes: Mensagem[];
  negacoes: { agenteId: string; decisao: DecisaoOrcamento; mensagem: Mensagem }[];
  orcamento: EstadoOrcamento;
  decisaoTeto: string | null;
};

const REGRA_ORCAMENTO = "regra:canal-orcamento" as const;

async function membrosVisiveis(deps: Pick<Deps, "repos">, sala: Sala): Promise<Agente[]> {
  const agentes: Agente[] = [];
  for (const m of await deps.repos.salas.membros(sala.id)) {
    const a = await deps.repos.agentes.buscar(m.agenteId);
    if (a) agentes.push(a);
  }
  return agentes;
}

/**
 * Post na sala (pessoa ou bot) → responders() (menção vence; sem menção, política) → por candidato,
 * orçamento do CANAL (persistido na linha da sala, mesma tx; rotina isenta) → turno origem 'sala'
 * serial por conversa (reivindicação da L3), ou passe `ausente_offline`, ou negação ESCRITA que
 * encerra a tentativa. Estourar o teto de posts sem humano vira decisão em "Sua vez" (uma por
 * esfriamento) em vez de texto pedindo ao modelo para perguntar (core-features §2). Só a dona da
 * sala posta nesta rodada: os turnos são dela (máquina, cota, autoria) e a leitura dos membros
 * sob a policy de outra pessoa mostra só o grant dela — o roteamento sairia errado em silêncio.
 */
export const postarNaSala: CasoDeUso<EntradaPost, SaidaPost> = async (deps, input) => {
  const texto = input.texto.trim();
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  const sala = exigir(await deps.repos.salas.buscar(input.salaId), "nao_encontrado", "sala");
  if (sala.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido", { cause: "só a dona da sala posta nesta rodada" });
  const autoria = input.autoria ?? autoriaPessoa(deps.escopo.pessoaId);
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];

  if (autoria.autor_tipo === "pessoa") await deps.repos.paradas.encerrarAbertas({ conversaId: sala.conversaId, agora });
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: sala.conversaId,
    turnoId: input.turnoId ?? null,
    autoria,
    kind: "texto",
    texto,
    payload: input.acoes ?? null,
    confianca: input.confianca ?? (autoria.autor_tipo === "pessoa" ? "confiavel" : "nao_confiavel"),
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "mensagem não criada" });
  events.push(evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "texto", salaId: sala.id }, { conversaId: sala.conversaId, turnoId: input.turnoId ?? null }));

  const membros = await membrosVisiveis(deps, sala);
  const nomes: Record<string, string> = {};
  for (const a of membros) nomes[a.id] = a.nome;
  const candidatos = responders(
    { politica: sala.politica, leadAgenteId: sala.leadAgenteId, membros: membros.map((a) => a.id), nomes },
    { texto, autorTipo: autoria.autor_tipo, autorId: autoria.autor_id },
  );

  const anterior = sala.orcamento;
  const orcamento = registrarPost(anterior, { autorTipo: autoria.autor_tipo, autorId: autoria.autor_id, agora });
  /**
   * O estado avaliado para os candidatos é o de DEPOIS deste post (anel e teto contam o post que
   * acabou de entrar), mas o relógio do ritmo é o do post ANTERIOR: comparar com o próprio post
   * daria "rápido demais" sempre. Fala humana reabre o orçamento (E12.3), e um post de bot logo
   * após a fala humana (postsSemHumano = 0 antes dele) é resposta, não ricochete — definido em 2026-09-16.
   */
  const relogioRitmo = autoria.autor_tipo === "pessoa" || anterior.postsSemHumano === 0 ? null : anterior.ultimoPostEm;
  const paraAvaliar: EstadoOrcamento = { ...orcamento, ultimoPostEm: relogioRitmo };
  const turnos: Turno[] = [];
  const passes: Mensagem[] = [];
  const negacoes: SaidaPost["negacoes"] = [];
  let decisaoTeto: string | null = null;
  const estaOnline = input.estaOnline ?? (() => true);

  for (const agenteId of candidatos) {
    const agente = membros.find((a) => a.id === agenteId);
    if (!agente) continue;
    const decisao = avaliarOrcamento({ estado: paraAvaliar, candidatoAgenteId: agenteId, eRotina: input.eRotina === true, agora });
    if (decisao !== "permitir") {
      const negacao: Negacao = { classe: "ferramenta_negada", nome: `resposta de ${agente.nome}`, motivo: "teto_canal", desde: agora, terminal: true };
      const textoNegacao = `${descreverNegacao(negacao, agora)}: ${decisao === "recusar" ? "anel de bots detectado" : "sala em resfriamento"}. Nada mais será tentado até uma pessoa falar.`;
      const m = await deps.repos.mensagens.criar({
        conversaId: sala.conversaId,
        autoria: autoriaPessoa(deps.escopo.pessoaId, REGRA_ORCAMENTO),
        kind: "negacao",
        texto: textoNegacao,
        payload: { kind: "negacao", classe: negacao.classe, nome: negacao.nome, motivo: negacao.motivo, terminal: true },
        confianca: "confiavel",
      });
      if (m) negacoes.push({ agenteId, decisao, mensagem: m });
      events.push(evento(deps, "negacao", autoria, { agenteId, motivo: "teto_canal", decisao, salaId: sala.id }, { conversaId: sala.conversaId }));
      if (decisao === "resfriar" && orcamento.postsSemHumano >= TETO_POSTS_SEM_HUMANO && decisaoTeto === null) {
        // Uma decisão por esfriamento: se já há pergunta aberta à pessoa nesta rodada (criada depois da última
        // fala humana — os dois instantes são do banco, nunca do relógio injetado), a sala já espera por ela.
        const { desdeMs } = await rodadaDaSala(deps.repos, sala.conversaId);
        // Math.floor: a decisão nasce DEPOIS da fala humana, mas o ISO da decisão tem precisão de ms.
        const jaTem = (await deps.repos.decisoes.pendentesDaConversa(sala.conversaId)).some((d) => d.tipo === "pergunta" && Date.parse(d.criadoEm) >= Math.floor(desdeMs));
        if (!jaTem) {
          const d = await deps.repos.decisoes.criar({
            tipo: "pergunta",
            agenteId,
            conversaId: sala.conversaId,
            turnoId: input.turnoId ?? null,
            prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
            frase: `A sala "${sala.nome}" esfriou: ${orcamento.postsSemHumano} posts de bots sem resposta humana. Fale na sala para reabrir a rodada.`,
          });
          if (d) {
            decisaoTeto = d.id;
            events.push(evento(deps, "decisao_criada", autoria, { decisaoId: d.id, tipo: "pergunta", salaId: sala.id }, { conversaId: sala.conversaId }));
          }
        }
      }
      continue;
    }
    if (!estaOnline(agente)) {
      const m = await deps.repos.mensagens.criar({
        conversaId: sala.conversaId,
        autoria: { ...autoriaPessoa(deps.escopo.pessoaId, "regra:presenca"), autor_tipo: "agente", autor_id: agenteId },
        kind: "passe",
        texto: redigir("passe", agora, { agente: agente.nome, motivo: "ausente_offline" }),
        payload: { kind: "passe", motivo: "ausente_offline" },
        confianca: "confiavel",
      });
      if (m) passes.push(m);
      continue;
    }
    const turno = await deps.repos.turnos.enfileirar({
      conversaId: sala.conversaId,
      agenteId,
      origem: "sala",
      prazoEm: agora + PRAZO_DECISAO_MS,
      profundidade: 0,
      entradaTexto: texto,
      entradaConfianca: mensagem.confianca,
      modelo: agente.modelo,
      harness: agente.harness,
      // NOD-206: o do turno que postou; a fala da pessoa não traz executor — palpite, o plano grava o real.
      executor: input.executor ?? "catcher",
    });
    if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno de sala não criado" });
    turnos.push(turno);
    events.push(evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId, origem: "sala", salaId: sala.id }, { conversaId: sala.conversaId, turnoId: turno.id }));
  }

  if (!(await deps.repos.salas.atualizarOrcamento(sala.id, orcamento))) throw new ErroDeDominio("nao_permitido", { cause: "orçamento é da dona da sala" });
  // Passes por ausência podem fechar a rodada sozinhos (todos offline → assentou por ausência).
  if (passes.length > 0 && turnos.length === 0) await fecharRodadaSeAssentou(deps, sala.conversaId, "em_andamento");
  else if (candidatos.length === 0 && autoria.autor_tipo === "pessoa" && sala.politica === "so_mencoes") {
    // Silêncio é estado renderizado (ADR-029): a pessoa lê por que ninguém respondeu.
    await deps.repos.mensagens.criar({ conversaId: sala.conversaId, autoria: autoriaPessoa(deps.escopo.pessoaId, "regra:rodada-sala"), kind: "sistema", assunto: "sala.evento", texto: "Ninguém foi mencionado: nesta sala só menção (@Nome) dispara resposta.", confianca: "confiavel" });
  }
  return { data: { mensagem, turnos, passes, negacoes, orcamento, decisaoTeto }, events };
};
