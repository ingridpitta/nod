import { MOTIVOS_FORA_DA_DECISAO } from "./decisoes.ts";
import type { ItemDeAtividade } from "../contracts/atividade.ts";
import type { Assunto } from "../contracts/destino-no-chat.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { comCasaAbreviada, liberadaPeloRevisor, rodouSemAprovacao, semInvisiveis, semVerbo, tituloNaAtividade, type AcaoDoModoParaTexto } from "./acoes-do-modo.ts";
import { DESTINO } from "./destino-no-chat.ts";

/**
 * Os itens da Atividade, com o título e o detalhe prontos (definido em 2026-10-18, chat limpo, PR 1; ADR-114). A redação é
 * a de hoje: o que tem payload é redigido de novo a partir dele; o resto leva o texto gravado como detalhe. ADR-029: a
 * negação diz nome e causa, e a hora é o `em` do item.
 */

/** O rótulo de cada assunto quando o payload não dá um título melhor. */
const ROTULO: Readonly<Record<Assunto, string>> = {
  "colega.handoff": "Passou a um colega",
  "colega.pedido": "Pedido de colega",
  "colega.resposta": "Resposta de colega",
  "acesso.concedido": "Acesso permitido",
  "acesso.revogado": "Acesso revogado",
  "acesso.pasta": "Pasta aberta",
  "aprovacao.recibo": "Aprovação decidida",
  "aprovacao.automatica_falhou": "Aprovado sem perguntar · um item falhou",
  "aprovacao.total_credenciais": "Ignorar todas as aprovações mudou",
  "proposta.obsoleta": "Mudança não aplicada",
  artefato: "Artefato",
  ligacao: "Chat de voz",
  "sessao.nova": "Nova sessão",
  "sala.evento": "Sala",
  "rotina.evento": "Rotina",
  "rotina.falhou": "A rotina não rodou",
  "aviso.pessoa": "Aviso do bot",
  "barra.ajuste": "Sugeriu mudar a barra lateral",
  canvas: "Publicou um canvas",
  "leitura.lista": "Mostrou os não lidos",
  "leitura.recibo": "Marcou conversas como lidas",
  "times.organizados": "Organizou os times",
  "acessos.mudados": "Mudou quem usa um app",
  "rotina.adiada": "Rotina adiada",
  "rotina.execucao": "A rotina rodou",
  "agente.criado": "Bot criado",
  "bot.criado": "Criou bots",
  "turno.orfao": "Pedido tirado da fila",
  "turno.falhou": "Turno interrompido",
  "turno.interrompido": "Turno interrompido",
  "turno.queda_da_maquina": "A máquina parou de responder",
  "turno.retomado": "Turno retomado",
  "lote.retorno_caiu": "O retorno do lote caiu",
  passe: "Passou a vez",
  parada: "Parado por você",
  "negacao.ferramenta": "Ferramenta negada",
  "negacao.conector": "App indisponível",
  "negacao.terminal": "Negado",
  "negacao.plano_ausente": "IA indisponível",
  "ia.trocada": "Trocou de IA",
  "ia.troca": "A IA das tasks chegou ao limite",
  "ia.limite_do_plano": "Limite da IA",
  "ia.fala_espera": "Mensagem esperando a IA",
  "conta.trocada": "Trocou de conta",
  "conta.seguiu": "Seguiu em outra conta",
  "conta.escolhida": "Conta escolhida",
  "conta.nota": "Refeito",
  "conta.recusada": "Conta fora da máquina",
  "cota.pedido_na_fila": "Pedido na fila da cota",
  "cota.espera": "Esperando a cota",
  "fundo.espera": "Esperando para tentar de novo",
  "computador.fora_do_ar": "Computador fora do ar",
  "computador.em_operacao": "Computador em manutenção",
  "computador.tela_fechada": "Fechou a tela do computador",
  "computador.senha_preenchida": "Preencheu a senha salva",
  "trabalho.aberto": "Abriu uma task",
  "frentes.abertas": "Começou frentes",
  "frentes.terminadas": "Frentes terminaram",
  "frentes.recado": "Recado a uma frente",
  "pedido.respondido": "Respondeu a um pedido",
  "memoria.anotada": "Anotou na memória",
  "memoria.task_fechada": "Fechou uma task para liberar memória",
  compactacao: "Conversa compactada",
  "arquivos.desfeitos": "Desfez os arquivos de um turno",
  "proposta.decidida": "Proposta decidida",
  "proposta.resultado": "Proposta decidida",
  inteligencia: "Inteligência",
  "aprovacao.modo": "Modo de aprovação",
  "aprovacao.automatica": "Aprovado sem perguntar",
  "acesso.automatico": "Acesso pela aprovação automática",
  "decisao.vencida": "Pedido vencido",
  "sistema.generico": "Aviso do sistema",
  "tarefa.precisa": "Tarefa precisa de você",
  "tarefa.resultado": "Terminou uma etapa da tarefa",
  "bastidor.turno_falhou": "Turno de bastidor interrompido",
  "bastidor.turno_orfao": "Pedido de bastidor tirado da fila",
  "bastidor.lote_retorno_caiu": "O retorno do lote caiu",
  "bastidor.negacao_terminal": "Negado",
  "bastidor.aprovacao_recibo": "Aprovação decidida",
};

/** Teto do detalhe: a Atividade é lista; o texto inteiro abre no clique (alvo da mensagem). */
const DETALHE_MAX = 280;

function cortar(texto: string): string | null {
  const t = texto.replace(/\s+/g, " ").trim();
  if (t === "") return null;
  return t.length > DETALHE_MAX ? `${t.slice(0, DETALHE_MAX - 1)}…` : t;
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** O título que o payload dá; null = o rótulo do assunto. */
function tituloDoPayload(m: Mensagem): string | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "negacao":
      return p.classe === "conector_indisponivel" ? `${p.nome} indisponível` : p.classe === "plano_ausente" ? ROTULO["negacao.plano_ausente"] : `${p.nome} negada`;
    case "trabalho_aberto":
      return `Abriu a task ${p.titulo}`;
    case "frentes_abertas":
      return p.frentes.length === 1 ? `Começou a frente ${p.frentes[0]?.titulo ?? ""}`.trim() : `Começou ${p.frentes.length} frentes`;
    case "frentes_terminadas":
      return p.frentes.length === 1 ? `A frente ${p.frentes[0]?.titulo ?? ""} terminou` : `${p.frentes.length} ${plural(p.frentes.length, "frente terminou", "frentes terminaram")}`;
    case "recado_a_frente":
      return `Repassou um recado a ${p.titulo}`;
    case "pedido_respondido":
      return `Respondeu ao pedido de ${p.nome}`;
    case "passe":
      return ROTULO.passe;
    case "parada":
      return p.nadaRodando ? "Parar: nada estava rodando" : `Parado por você · ${p.interrompidas} ${plural(p.interrompidas, "turno interrompido", "turnos interrompidos")}`;
    case "canvas":
      return p.importado ? "Importou um protótipo para o canvas" : null;
    default:
      return null;
  }
}

/** O detalhe que o payload dá melhor que o texto (lista de frentes); null = o texto gravado. */
function detalheDoPayload(m: Mensagem): string | null {
  const p = m.payload;
  if (p?.kind === "frentes_abertas" && p.frentes.length > 1) return cortar(p.frentes.map((f) => f.titulo).join(" · "));
  if (p?.kind === "frentes_terminadas" && p.frentes.length > 1) return cortar(p.frentes.map((f) => f.titulo).join(" · "));
  if (p?.kind === "trabalho_aberto" || p?.kind === "recado_a_frente" || p?.kind === "pedido_respondido") return null;
  return cortar(m.texto);
}

export function itemDaMensagem(m: Mensagem, assunto: Assunto): ItemDeAtividade {
  const vezes = m.payload?.kind === "negacao" && m.payload.vezes && m.payload.vezes > 1 ? m.payload.vezes : undefined;
  const alvo = m.payload?.kind === "trabalho_aberto" || m.payload?.kind === "recado_a_frente" ? { trabalhoId: m.payload.trabalhoId } : { mensagemId: m.id };
  const detalhe = detalheDoPayload(m);
  // Chat limpo, PR 2: o texto inteiro vai junto quando o detalhe não o mostra todo (o clique abre a mensagem na lista).
  const inteiro = m.texto.trim();
  const texto = "mensagemId" in alvo && inteiro !== "" && detalhe !== inteiro.replace(/\s+/g, " ") ? inteiro : undefined;
  return {
    id: m.id,
    em: m.criadoEm,
    categoria: DESTINO[assunto].categoria,
    titulo: tituloDoPayload(m) ?? ROTULO[assunto],
    detalhe,
    ...(texto ? { texto } : {}),
    ...(vezes ? { vezes } : {}),
    // NOD-70: "ver nas decisões" só na negação que a aba Decisões mostra (o mesmo recorte de ehDecisao).
    ...(m.payload?.kind === "negacao" && m.payload.classe !== "plano_ausente" && !(MOTIVOS_FORA_DA_DECISAO as readonly string[]).includes(m.payload.motivo) ? { negacao: true as const } : {}),
    alvo,
  };
}

const CAUSA_DO_CONECTOR: Readonly<Record<string, string>> = {
  conector_indisponivel: "o app não respondeu",
  timeout_transporte: "a conexão com o app demorou demais",
  falha_tecnica: "falha técnica no app",
};

/** A linha da trilha (conector indisponível): uma por conector e causa. Sem alvo nem "Relatar" na v1 (decisão 14). */
export function itemDaNegacaoDeConector(l: { chave: string; motivo: string; ferramenta: string; conector: string | null; vezes: number; em: number }): ItemDeAtividade {
  return {
    id: `trilha:${l.chave}:${l.motivo}`,
    em: l.em,
    categoria: "bloqueios",
    titulo: `${l.conector ?? l.ferramenta} indisponível`,
    detalhe: CAUSA_DO_CONECTOR[l.motivo] ?? l.motivo.replaceAll("_", " "),
    ...(l.vezes > 1 ? { vezes: l.vezes } : {}),
  };
}

/**
 * definido em 2026-10-27 (NOD-374, revisão do PR #538): o app que estava fora do ar voltou (a sonda do nod ou uma chamada
 * que deu certo). Fica na Atividade de cada bot que esbarrou na falha — o fechamento do "indisponível" do mesmo dia.
 */
export function itemDaRecuperacaoDeConector(l: { chave: string; ferramenta: string; conector: string | null; vezes: number; em: number }): ItemDeAtividade {
  return {
    id: `trilha:${l.chave}:recuperado`,
    em: l.em,
    categoria: null,
    titulo: `${l.conector ?? l.ferramenta} voltou sozinho`,
    detalhe: "o app respondeu de novo",
    ...(l.vezes > 1 ? { vezes: l.vezes } : {}),
  };
}

/**
 * Uma ação que o modo rodou sem a pessoa (PR 6 dos modos de aprovação; tela Y3): o título diz o que foi ("Leu as
 * credenciais da AWS", "Comando arriscado") e o detalhe é o comando ou o caminho, redigido. Sem alvo: o registro não tem
 * mensagem, e o "Relatar" fica para a fala (como a linha da trilha, decisão 14).
 */
export function itemDaAcaoDoModo(a: AcaoDoModoParaTexto & { id: string; em: number; motivo?: string | null; contestadaEm?: number | null }): ItemDeAtividade {
  return {
    id: `modo:${a.id}`,
    em: a.em,
    categoria: rodouSemAprovacao(a) ? "sem_aprovacao" : null,
    titulo: tituloNaAtividade(a),
    detalhe: cortar(comCasaAbreviada(semVerbo(a.resumo))),
    codigo: true,
    // PR 4: a liberação do revisor leva o motivo dele e o "Devia ter perguntado".
    ...(liberadaPeloRevisor(a) ? { revisor: { acaoId: a.id, motivo: a.motivo ? semInvisiveis(a.motivo) || null : null, contestada: (a.contestadaEm ?? null) !== null } } : {}),
  };
}

const ORIGEM: Readonly<Record<string, string>> = { pessoa: "pedido seu", rotina: "da rotina", colega: "pedido de colega", rede: "da conversa" };

function duracao(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `em ${min} min` : `em ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** Um item pelo começo no dia e um pelo fim no dia; `[ini, fim)` é a faixa do dia. */
export function itensDoTrabalho(t: { id: string; titulo: string; forma: "task" | "frente"; origem: string; estado: string; criadoEm: number; terminadoEm: number | null }, faixa: { ini: number; fim: number }): ItemDeAtividade[] {
  const itens: ItemDeAtividade[] = [];
  const alvo = { trabalhoId: t.id };
  if (t.criadoEm >= faixa.ini && t.criadoEm < faixa.fim) {
    itens.push({ id: `trabalho:${t.id}:comecou`, em: t.criadoEm, categoria: "frentes", titulo: t.forma === "frente" ? `Começou a frente ${t.titulo}` : `Abriu a task ${t.titulo}`, detalhe: ORIGEM[t.origem] ?? null, alvo });
  }
  if (t.terminadoEm !== null && t.terminadoEm >= faixa.ini && t.terminadoEm < faixa.fim) {
    // terminado_em só existe nos estados finais (CHECK trabalho_terminado, 0063): terminado, parado e falhou.
    const titulo = t.estado === "falhou" ? `${t.titulo} falhou` : t.estado === "parado" ? `Parou ${t.titulo}` : `Terminou ${t.titulo}`;
    itens.push({ id: `trabalho:${t.id}:terminou`, em: t.terminadoEm, categoria: "frentes", titulo, detalhe: duracao(t.terminadoEm - t.criadoEm), alvo });
  }
  return itens;
}

/** Mais recentes primeiro; empate pelo id, para a ordem não mudar entre duas leituras. */
export function ordenarAtividade(itens: readonly ItemDeAtividade[]): ItemDeAtividade[] {
  return [...itens].sort((a, b) => b.em - a.em || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' de verdade (2026-02-30 não passa). */
export function diaValido(dia: string): boolean {
  const m = DIA.exec(dia);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === dia;
}

/** O dia de antes, no calendário (sem fuso: é aritmética de data). */
export function diaAnterior(dia: string): string {
  const m = DIA.exec(dia);
  if (!m) return dia;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1)).toISOString().slice(0, 10);
}

/** O dia de um instante no fuso IANA; lança RangeError com fuso desconhecido (a rota responde 400). */
export function diaNoFuso(instante: number, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));
}
