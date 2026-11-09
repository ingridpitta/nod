import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao, MotivoRecusaLigacao, PayloadLinhaLigacao } from "../contracts/ligacao.ts";
import { VERSAO_CONSENTIMENTO_VOZ } from "../contracts/ligacao.ts";
import type { Turno } from "../contracts/turno.ts";
import type { IaDaLigacao, MotivoFimLigacao } from "../contracts/voz.ts";
import { VELOCIDADES_VOZ, VOZES_NOD } from "../contracts/vozes.ts";
import { ehIdVoz, generoDaVoz } from "../domain/vozes.ts";
import { registrarVersaoDoPerfil } from "./versoes-perfil.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { PerfilComando } from "../domain/comando-de-voz.ts";
import { FECHO_LEITURA, redigirLeituraDeAprovacao, rotuloDoItemFalado, type PedidoDeLeitura } from "../domain/leitura-aprovacao.ts";
import type { MetricasLigacao, NovaFala } from "../repositories/ligacoes.repo.ts";
import { autoriaAgente, autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { encerrarCerebroSemLigacao } from "./despachar-turno.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Casos de uso da ligação por voz (definido em 2026-10-04, ADR-072/075). Ligar cria três coisas na MESMA tx: a linha
 * em `ligacoes`, a mensagem "Chat de voz" (que fica antes de tudo o que o bot fizer durante a ligação) e o turno-cérebro
 * (`origem='ligacao'`), que o Mac puxa e roda como laço de voz. O que acontece em tempo real (áudio, vez, falas de
 * espera) é do orquestrador de voz (src/adapters/voz), que grava pelas funções deste arquivo.
 */

/** O que só o servidor sabe na hora de ligar (estado em memória): entra pronto da rota. */
export type ContextoLigacao = {
  /** NOD_LIGACAO: desligada, só admins ou todas — já resolvido para esta pessoa. */
  permitido: boolean;
  habilitada: boolean;
  /** Há um Mac desta pessoa conectado que anunciou o laço de voz. */
  maquinaComLigacao: boolean;
  /** A IA do bot (o harness) está pronta naquela máquina. */
  iaPronta: boolean;
  /** O harness do bot é o Codex (o laço de voz do Codex é o app-server). */
  codexSemVoz: boolean;
  /**
   * NOD-167: a IA do bot está pronta no Mac, mas ele anunciou que ela não roda o laço de voz (o Codex sem
   * `app-server`). Ausente = false (o app antigo não anuncia; o turno ainda falha com `executor_indisponivel`).
   */
  iaSemLacoDeVoz?: boolean;
  drenando: boolean;
  vozDisponivel: boolean;
  vivasNoServidor: number;
  maxSimultaneas: number;
  /** Teto diário por pessoa em ms (0 = sem teto). */
  limiteDiarioMs: number;
  /** Início do dia da pessoa (America/Sao_Paulo), epoch ms. */
  inicioDoDia: number;
  provedorStt: string;
  provedorTts: string;
  /** NOD-218: a cor deste processo (`NOD_COR`), gravada na ligação. Ausente = sem cor (Mac, local). */
  instancia?: string | null;
  /** NOD_VOZ_LEITURA=1 (NOD-180): ouvir as respostas fora da ligação. Ausente = desligada. */
  leituraHabilitada?: boolean;
};

const TEXTOS_RECUSA: Record<MotivoRecusaLigacao, string> = {
  desligada: "As ligações ainda não estão ligadas neste nod.",
  sem_permissao: "As ligações ainda estão em teste e não estão abertas para a sua conta.",
  sem_mac: "Para ligar, abra o app do nod no seu Mac: é ele que roda a IA do bot.",
  sem_ia: "A IA deste bot não está pronta no seu Mac. Abra o Claude Code (ou o Codex) e entre na sua conta.",
  app_antigo: "Atualize o app do nod no seu Mac para ligar.",
  codex_em_breve: "A ligação com bots que usam o ChatGPT (Codex) está desligada neste servidor. Por enquanto, converse por texto.",
  codex_sem_app_server: "Atualize o Codex para ligar: a versão instalada no seu Mac não atende ligação. Por enquanto, converse por texto.",
  ja_em_ligacao: "Você já está numa ligação. Desligue antes de começar outra.",
  bot_ocupado_em_ligacao: "Este bot já está numa ligação.",
  sala: "Ligação é só com um bot por vez, na conversa dele.",
  conversa_de_equipe: "Bots da equipe ainda não atendem ligação.",
  voz_indisponivel: "A voz está fora do ar agora. Tente de novo em alguns minutos.",
  limite_diario: "Você chegou ao limite de ligações de hoje. Amanhã libera de novo.",
  limite_simultaneas: "Muitas ligações ao mesmo tempo agora. Tente de novo em um minuto.",
  drenagem: "O nod está reiniciando. Tente de novo em um minuto.",
  sem_consentimento: "Antes da primeira ligação, confirme o aviso sobre a voz.",
};

export function textoDaRecusa(m: MotivoRecusaLigacao): string {
  return TEXTOS_RECUSA[m];
}

/**
 * NOD-168: a linha que fica na conversa quando a ligação acaba por um motivo que a pessoa não escolheu (o mapa total
 * da web, `textoFim`). null = fim esperado (desligou, tempo, não atendeu, seguiu sem voz): a linha "Chat de voz" já
 * diz tudo.
 */
const TEXTOS_FIM: Record<MotivoFimLigacao, string | null> = {
  pessoa_desligou: null,
  bot_desligou: null,
  tempo_maximo: null,
  limite_diario: "Você chegou ao limite de ligações de hoje.",
  cerebro_caiu: "A ligação caiu: o seu Mac parou de responder.",
  midia_caiu: "A ligação caiu: a conexão deste computador falhou.",
  reinicio_servidor: "A ligação caiu porque o nod foi atualizado. Ligue de novo.",
  drenagem: "A ligação caiu porque o nod foi atualizado. Ligue de novo.",
  nao_atendida: null,
  // A pessoa escolheu seguir sem voz (onboarding): a linha diria que "foi recusada", como se o bot tivesse recusado.
  recusada: null,
  voz_indisponivel: "A voz está fora do ar agora. Tente de novo em alguns minutos.",
  ociosidade: "A ligação foi encerrada por falta de conversa.",
  limite_da_assinatura: "Sua assinatura de IA chegou ao limite. A ligação foi encerrada.",
  erro: "A ligação caiu por um erro.",
  sem_ia: "A ligação foi encerrada: a IA deste Mac parou de responder e nenhuma saída foi escolhida em 2 minutos.",
};

export function textoDoFim(m: MotivoFimLigacao): string | null {
  return TEXTOS_FIM[m];
}

/** A voz do bot: a escolhida, ou uma do catálogo derivada do id (estável entre ligações). */
export function vozDoAgente(agenteId: string, voz: string | null | undefined): string {
  if (voz && ehIdVoz(voz)) return voz;
  let h = 0;
  for (const c of agenteId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VOZES_NOD[h % VOZES_NOD.length]!.id;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function textoDaLinha(estado: Ligacao["estado"], duracaoMs: number | null): string {
  if (estado === "nao_atendida") return "Ligação não atendida";
  if (estado === "chamando" || estado === "em_curso") return "Chat de voz · em andamento";
  return `Chat de voz · ${mmss(duracaoMs ?? 0)}`;
}

async function motivoDeRecusa(deps: Deps, agenteId: string, c: ContextoLigacao): Promise<{ motivo: MotivoRecusaLigacao } | { conversaId: string; agente: NonNullable<Awaited<ReturnType<Deps["repos"]["agentes"]["buscar"]>>> }> {
  if (!c.habilitada) return { motivo: "desligada" };
  if (!c.permitido) return { motivo: "sem_permissao" };
  if (c.drenando) return { motivo: "drenagem" };
  if (!c.vozDisponivel) return { motivo: "voz_indisponivel" };
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente || agente.excluidoEm !== null) throw new ErroDeDominio("nao_encontrado");
  if (agente.dono === "empresa") return { motivo: "conversa_de_equipe" };
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa do bot" });
  if (await deps.repos.ligacoes.viva()) return { motivo: "ja_em_ligacao" };
  if (c.vivasNoServidor >= c.maxSimultaneas) return { motivo: "limite_simultaneas" };
  if (c.limiteDiarioMs > 0 && (await deps.repos.ligacoes.duracaoDesde(c.inicioDoDia)) >= c.limiteDiarioMs) return { motivo: "limite_diario" };
  if (c.codexSemVoz) return { motivo: "codex_em_breve" };
  if (!c.maquinaComLigacao) return { motivo: "sem_mac" };
  if (!c.iaPronta) return { motivo: "sem_ia" };
  if (c.iaSemLacoDeVoz) return { motivo: "codex_sem_app_server" };
  return { conversaId: conversa.id, agente };
}

/**
 * Ouvir as respostas (NOD-180): a leitura ligada, a voz aberta para a pessoa e no ar, e um bot próprio. Não depende do
 * Mac, da IA, da drenagem nem do consentimento (a tela pede o aviso antes do primeiro "ouvir").
 */
async function podeOuvir(deps: Deps, agenteId: string, c: ContextoLigacao): Promise<boolean> {
  if (!c.leituraHabilitada || !c.habilitada || !c.permitido || !c.vozDisponivel) return false;
  const agente = await deps.repos.agentes.buscar(agenteId);
  return !!agente && agente.excluidoEm == null && agente.dono !== "empresa";
}

export const disponibilidadeLigacao: CasoDeUso<{ agenteId: string; contexto: ContextoLigacao }, DisponibilidadeLigacao> = async (deps, input) => {
  const r = await motivoDeRecusa(deps, input.agenteId, input.contexto);
  const ouvir = await podeOuvir(deps, input.agenteId, input.contexto);
  if ("motivo" in r) return { data: { disponivel: false, motivo: r.motivo, texto: textoDaRecusa(r.motivo), ouvir } };
  const { versao } = await deps.repos.ligacoes.consentimento();
  return { data: { disponivel: true, consentimentoNecessario: (versao ?? 0) < VERSAO_CONSENTIMENTO_VOZ, versaoConsentimento: VERSAO_CONSENTIMENTO_VOZ, provedor: input.contexto.provedorTts, ouvir } };
};

export type SaidaLigar = { ligacao: Ligacao; turno: Turno; voz: string; velocidade: number; nomeBot: string; genero: "feminina" | "masculina" };

export const ligar: CasoDeUso<{ agenteId: string; contexto: ContextoLigacao; executor?: Executor; iniciadaPor?: "pessoa" | "produto" }, SaidaLigar> = async (deps, input) => {
  const r = await motivoDeRecusa(deps, input.agenteId, input.contexto);
  if ("motivo" in r) throw new ErroDeDominio(r.motivo === "limite_diario" || r.motivo === "limite_simultaneas" ? "limite_atingido" : "estado_invalido", { cause: r.motivo });
  const { versao } = await deps.repos.ligacoes.consentimento();
  // ADR-077: a ligação do onboarding (iniciada pelo produto) nasce tocando antes do consentimento — o "Atender" É o
  // consentimento, gravado antes de a mídia abrir; até lá o orquestrador recusa a mídia (aguardandoConsentimento).
  if (input.iniciadaPor !== "produto" && (versao ?? 0) < VERSAO_CONSENTIMENTO_VOZ) throw new ErroDeDominio("estado_invalido", { cause: "sem_consentimento" });
  const agora = deps.agora();
  const { agente, conversaId } = r;
  const voz = vozDoAgente(agente.id, agente.voz);
  const ligacao = await deps.repos.ligacoes.criar({
    agenteId: agente.id,
    conversaId,
    iniciadaPor: input.iniciadaPor ?? "pessoa",
    harness: agente.harness ?? null,
    modelo: null,
    provedorStt: input.contexto.provedorStt,
    provedorTts: input.contexto.provedorTts,
    voz,
    instancia: input.contexto.instancia ?? null,
  });
  if (!ligacao) throw new ErroDeDominio("estado_invalido", { cause: "ja_em_ligacao" });
  const autoria = autoriaPessoa(deps.escopo, input.executor ?? "catcher");
  // Falar de novo libera a fila (como enviarMensagem): uma parada aberta não pode segurar o turno da ligação.
  await deps.repos.paradas.encerrarAbertas({ conversaId, agora });
  const payload: PayloadLinhaLigacao = { kind: "ligacao", ligacaoId: ligacao.id, duracaoMs: null, estado: "chamando" };
  const linha = await deps.repos.mensagens.criar({ conversaId, autoria, kind: "sistema", texto: textoDaLinha("chamando", null), payload, confianca: "confiavel" });
  if (!linha) throw new ErroDeDominio("nao_permitido");
  await deps.repos.ligacoes.vincularMensagem(ligacao.id, linha.id);
  const turno = await deps.repos.turnos.enfileirar({
    conversaId,
    agenteId: agente.id,
    origem: "ligacao",
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: 0,
    entradaTexto: "[nod] A ligação começou.",
    entradaConfianca: "confiavel",
    modelo: agente.modelo,
    harness: agente.harness,
    executor: input.executor ?? "catcher",
    ligacaoId: ligacao.id,
  });
  if (!turno) throw new ErroDeDominio("nao_permitido");
  return {
    data: { ligacao: { ...ligacao, mensagemId: linha.id }, turno, voz, velocidade: agente.vozVelocidade ?? 1, nomeBot: agente.nome, genero: generoDaVoz(voz) },
    events: [
      evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId, dados: { mensagem_id: linha.id, kind: "sistema" } }),
      evento(deps.escopo, { kind: "ligacao_mudou", autoria, agora, conversaId, turnoId: turno.id, dados: { ligacao_id: ligacao.id, estado: "chamando" } }),
    ],
  };
};

/**
 * Rede de segurança (definido em 2026-10-05, emenda da ADR-072): a IA do Mac caiu com a ligação em curso e a pessoa
 * escolheu continuar. Abre um turno-cérebro NOVO para a MESMA ligação, com o harness forçado para a IA escolhida — a
 * linha em `ligacoes` e a mensagem "Chat de voz" são as mesmas; o turno que caiu fica como está (interrompido).
 *
 * O modelo vai como "auto": o da voz é do servidor (`modeloDeVoz`, por harness), e "auto" evita casar um modelo do
 * Claude escolhido no perfil do bot com o Codex (ou o contrário), que o plano recusaria. A preferência do bot não muda.
 * `iasProntas`: o inventário que o Mac anunciou, já resolvido pela rota; null = simulação (catcher), sem conferência.
 * Quem garante que a ligação está de fato esperando a escolha é o orquestrador de voz, antes e depois deste caso.
 */
export const reabrirCerebroDaLigacao: CasoDeUso<{ ligacaoId: string; ia: IaDaLigacao; iasProntas: readonly IaDaLigacao[] | null; executor?: Executor }, { ligacao: Ligacao; turno: Turno }> = async (deps, input) => {
  const l = await deps.repos.ligacoes.buscar(input.ligacaoId);
  if (!l) throw new ErroDeDominio("nao_encontrado");
  if (l.estado !== "chamando" && l.estado !== "em_curso") throw new ErroDeDominio("estado_invalido", { cause: "ligação encerrada" });
  if (input.iasProntas !== null && !input.iasProntas.includes(input.ia)) throw new ErroDeDominio("estado_invalido", { cause: "sem_ia" });
  const agente = await deps.repos.agentes.buscar(l.agenteId);
  if (!agente || agente.excluidoEm !== null) throw new ErroDeDominio("nao_encontrado");
  const agora = deps.agora();
  // Como no ligar: uma parada aberta na conversa não pode segurar o turno da ligação.
  await deps.repos.paradas.encerrarAbertas({ conversaId: l.conversaId, agora });
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: l.conversaId,
    agenteId: agente.id,
    origem: "ligacao",
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: 0,
    entradaTexto: "[nod] A ligação continua com outra IA.",
    entradaConfianca: "confiavel",
    modelo: "auto",
    harness: input.ia,
    executor: input.executor ?? "catcher",
    ligacaoId: l.id,
  });
  if (!turno) throw new ErroDeDominio("nao_permitido");
  await deps.repos.ligacoes.religou(l.id);
  const autoria = autoriaPessoa(deps.escopo, input.executor ?? "catcher");
  return {
    data: { ligacao: { ...l, religacoes: l.religacoes + 1 }, turno },
    events: [evento(deps.escopo, { kind: "ligacao_mudou", autoria, agora, conversaId: l.conversaId, turnoId: turno.id, dados: { ligacao_id: l.id, estado: l.estado, cerebro_reaberto: true, harness: input.ia } })],
  };
};

/** A mídia e o cérebro estão conectados: a ligação foi atendida (conta a duração a partir daqui). */
export const atenderLigacao: CasoDeUso<{ ligacaoId: string }, Ligacao | null> = async (deps, input) => {
  const agora = deps.agora();
  const l = await deps.repos.ligacoes.atender(input.ligacaoId, agora);
  if (!l) return { data: null };
  if (l.mensagemId) await deps.repos.ligacoes.atualizarLinha(l.mensagemId, { kind: "ligacao", ligacaoId: l.id, duracaoMs: null, estado: "em_curso" }, textoDaLinha("em_curso", null));
  return { data: l, events: [evento(deps.escopo, { kind: "ligacao_mudou", autoria: autoriaPessoa(deps.escopo), agora, conversaId: l.conversaId, dados: { ligacao_id: l.id, estado: "em_curso" } })] };
};

/**
 * Fecha a ligação uma vez (Desligar, queda, limite, drenagem). Atualiza a linha "Chat de voz" com a duração e, quando o
 * fim não foi escolha da pessoa, deixa na conversa uma linha de sistema dizendo por quê (NOD-168): quem estava só na
 * pílula, ou volta depois, não fica sem saber. O turno-cérebro termina sozinho quando o laço recebe `fim` (ou o lease
 * vence); quem fecha o canal é o orquestrador.
 */
export const encerrarLigacao: CasoDeUso<{ ligacaoId: string; motivo: MotivoFimLigacao; metricas?: MetricasLigacao }, Ligacao | null> = async (deps, input) => {
  const agora = deps.agora();
  const l = await deps.repos.ligacoes.encerrar(input.ligacaoId, { motivo: input.motivo, agora, metricas: input.metricas });
  if (!l) return { data: await deps.repos.ligacoes.buscar(input.ligacaoId) };
  if (l.mensagemId) await deps.repos.ligacoes.atualizarLinha(l.mensagemId, { kind: "ligacao", ligacaoId: l.id, duracaoMs: l.duracaoMs, estado: l.estado }, textoDaLinha(l.estado, l.duracaoMs));
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "ligacao_mudou", autoria, agora, conversaId: l.conversaId, dados: { ligacao_id: l.id, estado: l.estado, motivo: l.motivoFim } })];
  // Só quem encerrou de fato chega aqui (o repo devolve a linha uma vez): a 2ª chamada não duplica o aviso.
  const texto = l.motivoFim ? textoDoFim(l.motivoFim) : null;
  const aviso = texto ? await deps.repos.mensagens.criar({ conversaId: l.conversaId, autoria, kind: "sistema", assunto: "ligacao", texto, confianca: "confiavel" }) : null;
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: l.conversaId, dados: { mensagem_id: aviso.id, kind: "sistema", ligacao_id: l.id } }));
  // Auditoria A3 (definido em 2026-10-15): o turno-cérebro que nenhuma máquina pegou não roda mais — sai na mesma tx que
  // fecha a ligação. Pendente, ele envenenava a fila da máquina com voz (despacharTurno também o assenta, para o que já
  // tinha ficado preso). O que já roda termina pelo `fim` do laço de voz, como antes.
  for (const t of await deps.repos.turnos.pendentesDaPessoa(l.conversaId)) {
    if (t.origem !== "ligacao" || t.ligacaoId !== l.id) continue;
    events.push(...(await encerrarCerebroSemLigacao(deps, t, t.executor, agora)).events);
  }
  return { data: l, events };
};

export const gravarFalaLigacao: CasoDeUso<NovaFala, boolean> = async (deps, input) => {
  const texto = input.texto.trim();
  if (texto === "") return { data: false };
  return { data: await deps.repos.ligacoes.gravarFala({ ...input, texto }) };
};

export const falasDaLigacao: CasoDeUso<{ ligacaoId: string }, { falas: FalaLigacao[]; apagadaEm: number | null }> = async (deps, input) => {
  const l = await deps.repos.ligacoes.buscar(input.ligacaoId);
  if (!l) throw new ErroDeDominio("nao_encontrado");
  return { data: { falas: await deps.repos.ligacoes.falas(l.id), apagadaEm: l.transcricaoApagadaEm } };
};

export const apagarTranscricao: CasoDeUso<{ ligacaoId: string }, { apagadas: number }> = async (deps, input) => {
  const l = await deps.repos.ligacoes.buscar(input.ligacaoId);
  if (!l) throw new ErroDeDominio("nao_encontrado");
  if (l.estado === "chamando" || l.estado === "em_curso") throw new ErroDeDominio("estado_invalido", { cause: "ligação em andamento" });
  const agora = deps.agora();
  const apagadas = await deps.repos.ligacoes.apagarFalas(l.id, agora);
  return { data: { apagadas }, events: [evento(deps.escopo, { kind: "ligacao_mudou", autoria: autoriaPessoa(deps.escopo), agora, conversaId: l.conversaId, dados: { ligacao_id: l.id, transcricao_apagada: true } })] };
};

const MOTIVOS_AVALIACAO = ["demorou", "nao_entendeu", "interrompeu", "voz", "outro"] as const;

export const avaliarLigacao: CasoDeUso<{ ligacaoId: string; nota: unknown; motivo?: unknown }, { ok: true }> = async (deps, input) => {
  if (input.nota !== "boa" && input.nota !== "ruim") throw new ErroDeDominio("entrada_invalida", { cause: "nota" });
  const motivo = input.motivo === undefined || input.motivo === null ? null : (MOTIVOS_AVALIACAO as readonly unknown[]).includes(input.motivo) ? (input.motivo as string) : undefined;
  if (motivo === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "motivo" });
  if (!(await deps.repos.ligacoes.avaliar(input.ligacaoId, input.nota, motivo))) throw new ErroDeDominio("nao_encontrado");
  return { data: { ok: true } };
};

export const consentirVoz: CasoDeUso<{ versao: unknown }, { versao: number }> = async (deps, input) => {
  if (input.versao !== VERSAO_CONSENTIMENTO_VOZ) throw new ErroDeDominio("entrada_invalida", { cause: "versão do consentimento" });
  await deps.repos.ligacoes.consentir(VERSAO_CONSENTIMENTO_VOZ, deps.agora());
  return { data: { versao: VERSAO_CONSENTIMENTO_VOZ } };
};

export const ligacaoViva: CasoDeUso<Record<string, never>, { ligacao: Ligacao | null }> = async (deps) => ({ data: { ligacao: await deps.repos.ligacoes.viva() } });

export const buscarLigacao: CasoDeUso<{ ligacaoId: string }, Ligacao | null> = async (deps, input) => ({ data: await deps.repos.ligacoes.buscar(input.ligacaoId) });

/** A voz do bot e a velocidade da fala (ADR-071); `null` volta à voz derivada do id. */
export const definirVozDoAgente: CasoDeUso<{ agenteId: string; voz: unknown; vozVelocidade: unknown }, { voz: string | null; vozVelocidade: number }> = async (deps, input) => {
  const voz = input.voz === null ? null : input.voz === undefined ? undefined : ehIdVoz(input.voz) ? input.voz : false;
  const velocidade = input.vozVelocidade === undefined ? undefined : (VELOCIDADES_VOZ as readonly unknown[]).includes(input.vozVelocidade) ? (input.vozVelocidade as number) : false;
  if (voz === false || velocidade === false) throw new ErroDeDominio("entrada_invalida", { cause: "voz" });
  // NOD-20: trava antes de ler o perfil de antes; o ajuste de voz (na ligação) vira uma versão de origem `voz`.
  const antes = await deps.repos.agentes.buscarParaAtualizar(input.agenteId);
  if (!antes) throw new ErroDeDominio("nao_encontrado");
  const agente = await deps.repos.agentes.definirVoz(input.agenteId, { voz, velocidade });
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  await registrarVersaoDoPerfil(deps, { antes, depois: agente, origem: "voz" });
  return { data: { voz: agente.voz ?? null, vozVelocidade: agente.vozVelocidade ?? 1 }, events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora: deps.agora(), dados: { agente_id: agente.id } })] };
};

/**
 * O que não coube na fala (código, tabela, link, resposta longa) vai para o chat como mensagem do bot, ligada ao turno
 * da ligação. Confiança de quem falou: a resposta do cérebro sai como a de qualquer turno de conversa.
 */
export const mandarNoChatDaLigacao: CasoDeUso<{ ligacaoId: string; agenteId: string; conversaId: string; turnoId: string; texto: string }, { mensagemId: string | null }> = async (deps, input) => {
  const texto = input.texto.trim().slice(0, 20_000);
  if (texto === "") return { data: { mensagemId: null } };
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "local" });
  const m = await deps.repos.mensagens.criar({ conversaId: input.conversaId, turnoId: input.turnoId, autoria, kind: "texto", texto, confianca: "confiavel" });
  if (!m) return { data: { mensagemId: null } };
  return { data: { mensagemId: m.id }, events: [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { mensagem_id: m.id, kind: "texto" } })] };
};

/**
 * A leitura de um card para a aprovação por voz (ADR-074): montada pelo servidor a partir dos campos tipados da decisão
 * e dos itens (redigirLeituraDeAprovacao), nunca pelo modelo. null = este tipo não se decide falando (perguntas se
 * respondem na própria conversa; decisão já fechada; decisão de outra pessoa).
 */
export const leituraDaDecisao: CasoDeUso<{ decisaoId: string; soDoBotDoOnboarding?: boolean }, { decisaoId: string; leitura: string; perfil: PerfilComando } | null> = async (deps, input) => {
  const d = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!d || (d.estado !== "pendente" && d.estado !== "reaberta") || d.ownerId !== deps.escopo.pessoaId || d.decisorId !== deps.escopo.pessoaId) return { data: null };
  // ADR-077: fora da conversa da ligação, só o card do bot novo do onboarding (o acesso e a rotina dele, para_bot).
  if (input.soDoBotDoOnboarding && d.agenteId !== (await deps.repos.onboarding.buscar()).botId) return { data: null };
  const contaminado = d.turnoId ? await deps.repos.turnos.contaminado(d.turnoId) : false;
  let pedido: PedidoDeLeitura | null = null;
  if (d.tipo === "aprovacao" || d.tipo === "gate_rotina") {
    const itens = await deps.repos.itensAprovacao.listar(d.id);
    pedido = {
      tipo: d.tipo,
      contaminado,
      acao: d.frase,
      app: itens[0]?.destino.conector && itens[0].destino.conector !== "terminal" && itens[0].destino.conector !== "computador" ? itens[0].destino.conector : null,
      itens: itens.map((i) => (i.destino.conector === "terminal" || i.destino.conector === "computador"
        ? { tipo: i.destino.conector, rotuloFerramenta: rotuloDoItemFalado(i.destino.conector) }
        : { tipo: "app" as const, texto: i.textoFinal })),
    };
  } else if (d.tipo === "retomar_turno") pedido = { tipo: "retomar_turno", acao: d.frase, contaminado };
  else if (d.tipo === "rotina" || d.tipo === "rotina_atualizacao" || d.tipo === "rotina_exclusao") pedido = { tipo: d.tipo, resumo: d.frase.split(" · ")[0]!.replace(/\s*\([A-Za-z_]+\/[A-Za-z_ ]+\)/, "").replace(/^Rotina proposta:\s*/i, ""), horario: "", contaminado };
  else if (d.tipo === "perfil") pedido = { tipo: "perfil", nome: d.frase, titulo: "", contaminado };
  else if (d.tipo === "bot") {
    const p = await deps.repos.propostas.buscar(d.id);
    pedido = { tipo: "bot", nome: p?.payload.kind === "bot" ? p.payload.nome : d.frase, titulo: p?.payload.kind === "bot" ? p.payload.descricao.slice(0, 140) : "", contaminado };
  }
  else if (d.tipo === "acesso") {
    // O acesso se aprova inteiro pela voz só com o app já conectado; o texto do card diz o app e o nível.
    return { data: { decisaoId: d.id, leitura: `${d.frase.slice(0, 140)}. ${FECHO_LEITURA}`, perfil: "estrito" } };
  }
  if (!pedido) return { data: null };
  const perfil: PerfilComando = d.tipo === "aprovacao" || d.tipo === "gate_rotina" || d.tipo === "retomar_turno" ? "estrito" : "proposta";
  return { data: { decisaoId: d.id, leitura: redigirLeituraDeAprovacao(pedido), perfil } };
};

/**
 * O resultado de uma tarefa pedida durante a ligação (`iniciar_tarefa`), para virar aviso falado: a última fala do bot
 * naquele turno. null = o turno não é desta ligação, é o próprio cérebro ou não deixou fala.
 */
export const resultadoDaTarefaDaLigacao: CasoDeUso<{ turnoId: string; ligacaoId: string }, { texto: string; confiavel: boolean; concluido: boolean } | null> = async (deps, input) => {
  const t = await deps.repos.turnos.buscar(input.turnoId);
  if (!t || t.ligacaoId !== input.ligacaoId || t.origem === "ligacao") return { data: null };
  const fala = (await deps.repos.mensagens.listarDaConversa(t.conversaId, 40)).filter((m) => m.turnoId === t.id && m.autoria.autor_tipo === "agente" && m.kind === "texto").at(-1);
  const concluido = t.estado === "concluido";
  const texto = fala?.texto.trim() || (concluido ? "terminou sem dizer nada" : "parou antes de terminar");
  return { data: { texto: texto.slice(0, 1500), confiavel: t.entradaConfianca === "confiavel" && !(await deps.repos.turnos.contaminado(t.id)), concluido } };
};
