import type { Agente } from "../../src/contracts/agente.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao, MotivoRecusaLigacao, PayloadLinhaLigacao, TEXTO_CONSENTIMENTO_VOZ as TextoConsentimento, VERSAO_CONSENTIMENTO_VOZ as VersaoConsentimento } from "../../src/contracts/ligacao.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { FaseLigacao, MotivoFimLigacao } from "../../src/contracts/voz.ts";
import type { IdVozNod, VelocidadeVoz, VOZES_NOD as VozesNod, VELOCIDADES_VOZ as VelocidadesVoz } from "../../src/contracts/vozes.ts";
import { avisoDeEstado, type TomDoAviso } from "../lib/aviso-estado.ts";
import type { EstadoLocalLigacao, MotivoAvaliacaoLigacao } from "../lib/ligacao-protocolo.ts";
import type { EstadoMascote } from "../lib/mascote.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { duracaoRelogio } from "../lib/relogio.ts";
import { htmlIaVoltou, htmlSemIa, type EstadoIaVoltou, type EstadoSemIa } from "./ligacao-sem-ia.ts";

/**
 * A tela da ligação (definido em 2026-10-04, ADR-071; protótipo "HiFiMac" aprovado em 2026-10-03): região própria
 * `#ligacao`, irmã de `#espaco`. Dois modos:
 * - TELA CHEIA: o mascote grande, o nome, o cronômetro, o que está acontecendo, a legenda e os controles. Deixa a
 *   `.app` inerte, como Seu espaço.
 * - PÍLULA: no alto, sobre o cabeçalho, com o mascote pequeno, o cronômetro, quem fala, Mudo, Expandir e Desligar. A
 *   `.app` continua viva: a pessoa usa o nod com a ligação aberta. Esc na tela cheia encolhe para cá (não desliga).
 *
 * Aqui só as funções de desenho, puras e sem DOM (testadas em tests/unit/web/ligacao.test.ts); o controlador que liga o
 * motor (web/lib/ligacao.ts) aos eventos e às rotas REST mora em web/telas/ligacao-controle.ts.
 */

// ---- valores repetidos de src/contracts (a web só faz import type; o tipo da origem trava a cópia) -----------------
export const VOZES: typeof VozesNod = [
  { id: "clara", nome: "Clara", genero: "feminina", descricao: "calma e clara" },
  { id: "bento", nome: "Bento", genero: "masculina", descricao: "grave e tranquilo" },
  { id: "luna", nome: "Luna", genero: "feminina", descricao: "leve e animada" },
  { id: "theo", nome: "Theo", genero: "masculina", descricao: "jovem e direto" },
  { id: "aurora", nome: "Aurora", genero: "feminina", descricao: "acolhedora" },
  { id: "caio", nome: "Caio", genero: "masculina", descricao: "firme" },
  { id: "iris", nome: "Íris", genero: "feminina", descricao: "suave" },
  { id: "rui", nome: "Rui", genero: "masculina", descricao: "experiente" },
];
export const VELOCIDADES: typeof VelocidadesVoz = [1, 1.25, 1.5];
/** Espelho de `VERSAO_CONSENTIMENTO_VOZ` com o tipo da origem: subir lá sem subir aqui não compila. */
export const VERSAO_CONSENTIMENTO: typeof VersaoConsentimento = 3;
export const TEXTO_CONSENTIMENTO: typeof TextoConsentimento =
  "No ditado e na ligação, sua fala é transcrita pelo Google (nos EUA). Quando o bot fala, na ligação ou quando você ouve uma resposta, o texto vai ao Google e a voz é gerada lá. Nada é gravado: o ditado vira só o texto da sua mensagem, e da ligação fica só a transcrição em texto, que você pode apagar.";

export type AgenteDaLigacao = Pick<Agente, "id" | "nome" | "cor" | "forma">;
export type LinhaLegenda = { chave: string; autor: "pessoa" | "bot"; texto: string; final: boolean; espera: boolean };
export type AvisoLigacao = { tom: TomDoAviso; texto: string };

export type EstadoTelaLigacao = {
  ligacao: Ligacao;
  agente: AgenteDaLigacao;
  modo: "cheia" | "pilula";
  fase: FaseLigacao;
  rotulo: string | null;
  /** Começo do cronômetro: quando atendeu (ou quando a tela abriu, enquanto chama). */
  desde: number;
  agora: number;
  legendas: LinhaLegenda[];
  janela: { decisaoId: string; ate: number } | null;
  mudo: boolean;
  teclado: boolean;
  voz: IdVozNod;
  velocidade: VelocidadeVoz;
  aviso: AvisoLigacao | null;
  quemFala: "bot" | "pessoa" | null;
  audioSuspenso: boolean;
  /** "Diga algo como" (protótipo do onboarding): cada chip manda o texto como uma vez da pessoa. */
  sugestoes: string[];
  /** Rede de segurança (2026-10-05): a IA do Mac caiu e a ligação espera a escolha (web/telas/ligacao-sem-ia.ts). */
  semIa?: EstadoSemIa | null;
  /** A escolha foi feita e o cérebro novo atendeu: o aviso neutro, até a próxima novidade. */
  iaVoltou?: EstadoIaVoltou | null;
};

export type AvaliacaoLigacao = { ligacaoId: string; agenteNome: string; duracaoMs: number; motivoFim: string | null; passo: "nota" | "motivo" | "obrigado" };

/** A decisão que a janela de aprovação mostra, já tirada de "Sua vez". */
export type CardJanela = { decisao: SuaVezDto["itens"][number]["decisao"] | null; restanteS: number };

// ---- ícones (traço, cor do texto) --------------------------------------------------------------------------------------
const svg = (d: string, t = 22, extra = ""): string => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
export const ICONE_LIGACAO = {
  fone: (t = 16) => svg('<path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>', t),
  microfone: (t = 22) => svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', t),
  microfoneMudo: (t = 22) => svg('<path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 4l16 16"/>', t),
  teclado: (t = 22) => svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>', t),
  ajustes: (t = 22) => svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', t),
  encolher: (t = 20) => svg('<path d="M6 15l6-6 6 6"/>', t),
  expandir: (t = 18) => svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', t),
  desligar: (t = 22) => svg('<path d="M3.5 13.5c4.7-4 12.3-4 17 0l-1.8 2.3-3.4-1.2v-2.4a9.5 9.5 0 0 0-6.6 0v2.4l-3.4 1.2z"/>', t),
  enviar: (t = 18) => svg('<path d="M5 12h14M13 6l6 6-6 6"/>', t),
  fechar: (t = 16) => svg('<path d="M6 6l12 12M18 6L6 18"/>', t),
  bom: (t = 17) => svg('<path d="M7 10v11H4V10zM7 10l4-8a2.5 2.5 0 0 1 2.5 2.5V8h5.4a2 2 0 0 1 2 2.3l-1.4 9A2 2 0 0 1 17.5 21H7"/>', t),
  ruim: (t = 17) => svg('<path d="M17 14V3h3v11zM17 14l-4 8a2.5 2.5 0 0 1-2.5-2.5V16H5.1a2 2 0 0 1-2-2.3l1.4-9A2 2 0 0 1 6.5 3H17"/>', t),
};

// ---- textos -------------------------------------------------------------------------------------------------------------
export function textoFase(fase: FaseLigacao, rotulo: string | null): string {
  switch (fase) {
    case "chamando":
      return "Chamando…";
    case "conectando":
      return "Conectando…";
    case "ouvindo":
      return "Ouvindo";
    case "pensando":
      return "Pensando…";
    case "falando":
      return "Falando";
    case "trabalhando":
      return rotulo ? `Trabalhando · ${rotulo}` : "Trabalhando";
    case "reconectando":
      return "Reconectando…";
    case "aguardando_escolha":
      return "Esperando você escolher";
    case "encerrada":
      return "Ligação encerrada";
  }
}

/** Por que acabou, em palavras (null = acabou porque a pessoa desligou: nada a explicar). */
export function textoFim(motivo: MotivoFimLigacao, bot: string): string | null {
  const textos: Record<MotivoFimLigacao, string | null> = {
    pessoa_desligou: null,
    bot_desligou: `${bot} encerrou a ligação.`,
    tempo_maximo: "A ligação chegou ao tempo máximo.",
    limite_diario: "Você chegou ao limite de ligações de hoje.",
    cerebro_caiu: "A ligação caiu: o seu Mac parou de responder.",
    midia_caiu: "A ligação caiu: a conexão deste computador falhou.",
    reinicio_servidor: "A ligação caiu porque o nod foi atualizado. Ligue de novo.",
    drenagem: "A ligação caiu porque o nod foi atualizado. Ligue de novo.",
    nao_atendida: `${bot} não atendeu.`,
    recusada: "A ligação foi recusada.",
    voz_indisponivel: "A voz está fora do ar agora. Tente de novo em alguns minutos.",
    ociosidade: "A ligação foi encerrada por falta de conversa.",
    limite_da_assinatura: "Sua assinatura de IA chegou ao limite. A ligação foi encerrada.",
    erro: "A ligação caiu por um erro.",
    sem_ia: "A ligação foi encerrada: a IA deste Mac parou de responder e nenhuma saída foi escolhida em 2 minutos.",
  };
  return textos[motivo];
}

/** Os estados locais do motor que viram aviso na tela. `noApp` muda onde liberar o microfone. */
export function avisoDoEstadoLocal(estado: EstadoLocalLigacao, noApp: boolean): AvisoLigacao | null {
  switch (estado) {
    case "microfone-negado":
      return { tom: "erro", texto: noApp ? "Libere o microfone em Ajustes do Sistema › Privacidade › Microfone. Enquanto isso, dá para digitar." : "Libere o microfone para este site nos ajustes do navegador. Enquanto isso, dá para digitar." };
    case "microfone-restrito":
      return { tom: "erro", texto: "O microfone deste Mac está bloqueado por quem administra o computador. Enquanto isso, dá para digitar." };
    case "microfone-mudo":
      return { tom: "erro", texto: noApp ? "O microfone não está mandando som. Confira em Ajustes do Sistema › Privacidade › Microfone e o aparelho de entrada em Som. Enquanto isso, dá para digitar." : "O microfone não está mandando som. Confira se o navegador tem acesso ao microfone em Ajustes do Sistema › Privacidade › Microfone e qual aparelho de entrada ele usa. Enquanto isso, dá para digitar." };
    case "microfone-indisponivel":
      return { tom: "erro", texto: "Nenhum microfone encontrado. Conecte um e ligue de novo; enquanto isso, dá para digitar." };
    case "voz-fora":
      return { tom: "erro", texto: "A voz está fora do ar agora. Tente de novo em alguns minutos." };
    case "comando-falhou":
      return { tom: "alerta", texto: "Não consegui registrar a decisão. Aprove ou recuse na tela." };
    case "ja-em-ligacao":
      return { tom: "alerta", texto: "Esta ligação já está aberta em outra janela." };
    case "sessao-expirada":
      return { tom: "erro", texto: "Sua sessão expirou. Entre de novo para ligar." };
    case "caiu":
      return { tom: "erro", texto: "A ligação caiu e não voltou. Ligue de novo quando quiser." };
    case "encerrada-pelo-servidor":
      return { tom: "info", texto: "A ligação foi encerrada." };
    default:
      return null;
  }
}

// ---- o "Ligar" (na gaveta do bot desde 2026-10-16) -----------------------------------------------------------------------------------
/** Motivos de recusa que dizem "este recurso não é para você aqui": o botão nem aparece. */
const ESCONDE_BOTAO: ReadonlySet<MotivoRecusaLigacao> = new Set(["desligada", "sem_permissao", "sala", "conversa_de_equipe"]);

export type BotaoLigar = "ligar" | "em-ligacao" | null;

/**
 * Mostra "Ligar" na gaveta do bot? (definido em 2026-10-04) Só bot da própria pessoa, só com a
 * disponibilidade já lida (`undefined` = ainda lendo; `null` = a leitura falhou ou a rota não existe: some, falha
 * fechada) e nunca com outra ligação aberta. Com a ligação deste bot aberta nesta página, vira "Em ligação" (volta à
 * tela cheia).
 * Os outros motivos de recusa (sem Mac, limite, voz fora…) deixam o botão: o clique mostra o porquê.
 */
export function botaoLigar(p: { agente: Pick<Agente, "id" | "ownerId"> | undefined; pessoaId: string | undefined; disponibilidade: DisponibilidadeLigacao | null | undefined; ligacao: { agenteId: string; local: boolean } | null }): BotaoLigar {
  const a = p.agente;
  if (!a || !p.pessoaId || a.ownerId !== p.pessoaId) return null;
  // Aberta em outra janela: nada aqui (abrir de novo derrubaria a de lá, 4409).
  if (p.ligacao) return p.ligacao.agenteId === a.id && p.ligacao.local ? "em-ligacao" : null;
  const d = p.disponibilidade;
  if (!d) return null;
  if (!d.disponivel && ESCONDE_BOTAO.has(d.motivo)) return null;
  return "ligar";
}

/**
 * O Ligar na gaveta do bot (definido em 2026-10-16, plano "tela limpa", T2): saiu do topo da conversa e virou uma linha
 * dos Atalhos, com as mesmas ações (`iniciar-ligacao`, `ligacao-expandir`) e a mesma regra de quando aparece (`botaoLigar`).
 */
export function htmlLinhaLigar(b: BotaoLigar, nome: string): string {
  if (b === "ligar") return `<button type="button" class="gv-linha" data-act="iniciar-ligacao" aria-label="${esc(`Ligar para ${nome}`)}">${ICONE_LIGACAO.fone(17)}<span class="gv-linha-txt">Ligar para ${esc(nome)}</span></button>`;
  if (b === "em-ligacao") return `<button type="button" class="gv-linha em-ligacao" data-act="ligacao-expandir">${ICONE_LIGACAO.fone(17)}<span class="gv-linha-txt">Em ligação</span><span class="gv-meta">voltar</span></button>`;
  return "";
}

// ---- a linha "Chat de voz" na conversa --------------------------------------------------------------------------------
/**
 * A linha da ligação na conversa (definido em 2026-10-04, ADR-075): discreta, com o fone, "Chat de voz · 03:12" e as
 * duas ações da transcrição; a ligação não atendida é só a linha. Viva (a desta tela), oferece voltar a ela.
 */
export function renderLinhaLigacao(m: Pick<Mensagem, "criadoEm">, p: PayloadLinhaLigacao, viva: boolean): string {
  const quando = `<time>${esc(hora(m.criadoEm))}</time>`;
  if (p.estado === "nao_atendida") return `<div class="linha-ligacao nao-atendida">${ICONE_LIGACAO.fone(15)}<span class="ll-txt">Ligação não atendida</span>${quando}</div>`;
  if (p.estado === "chamando" || p.estado === "em_curso") {
    const voltar = viva ? botao("ligacao-expandir", "Voltar à ligação", { classe: "link sm" }) : "";
    return `<div class="linha-ligacao ao-vivo">${ICONE_LIGACAO.fone(15)}<span class="ll-txt">Chat de voz · <b>em andamento</b></span>${quando}${voltar}</div>`;
  }
  const duracao = p.duracaoMs !== null ? ` · ${duracaoRelogio(p.duracaoMs)}` : "";
  const acoes = `<span class="ll-acoes">${botao("ver-transcricao", "Ver transcrição", { classe: "link sm", id: p.ligacaoId })}${botao("apagar-transcricao", "Apagar transcrição", { classe: "link sm", id: p.ligacaoId })}</span>`;
  return `<div class="linha-ligacao">${ICONE_LIGACAO.fone(15)}<span class="ll-txt">Chat de voz${esc(duracao)}</span>${quando}${acoes}</div>`;
}

/** A transcrição de uma ligação: pessoa e bot alternados, a fala cortada marcada. */
export function renderTranscricao(falas: readonly FalaLigacao[], bot: string): string {
  if (falas.length === 0) return '<p class="tr-vazia">Não há transcrição desta ligação: ela foi apagada ou nada foi dito.</p>';
  const itens = falas.map((f) => {
    const quem = f.autor === "pessoa" ? "Você" : bot;
    const marca = [f.tipo === "texto" ? "digitado" : f.tipo === "leitura" ? "leitura da aprovação" : "", f.interrompida ? "interrompida" : ""].filter(Boolean).map((t) => `<span class="tag tag-cinza">${esc(t)}</span>`).join("");
    return `<li class="tr-fala tr-${f.autor}${f.interrompida ? " tr-interrompida" : ""}"><b>${esc(quem)}</b>${marca}<p>${esc(f.texto)}${f.interrompida ? "…" : ""}</p></li>`;
  }).join("");
  return `<ol class="tr-falas">${itens}</ol>`;
}

// ---- a tela -----------------------------------------------------------------------------------------------------------
/** As partes da região: o esqueleto só muda com o modo; cada parte é uma sub-região que só é regravada quando muda. */
export type PartesLigacao = { esqueleto: string; mascote: string; info: string; aviso: string; legenda: string; card: string; teclado: string; controles: string };

const LEGENDAS_NA_TELA = 6;

function estadoDoMascote(t: EstadoTelaLigacao): EstadoMascote {
  if (t.fase === "pensando" || t.fase === "chamando" || t.fase === "conectando") return "pensando";
  if (t.fase === "trabalhando") return "trabalhando";
  return "disponivel";
}

/** O gênero da voz do bot decide o artigo do aviso ("A Nina", "O Bento"). */
function botDoAviso(t: EstadoTelaLigacao): { nome: string; genero: "feminina" | "masculina" } {
  return { nome: t.agente.nome, genero: VOZES.find((v) => v.id === t.voz)?.genero ?? "feminina" };
}

function htmlAviso(t: EstadoTelaLigacao): string {
  // Esperando a escolha, o aviso da rede de segurança é o único: ele explica o silêncio e traz as saídas.
  if (t.semIa) return htmlSemIa(t.semIa, botDoAviso(t)) + (t.audioSuspenso ? avisoDeEstado({ tom: "alerta", texto: "O navegador segurou o som da ligação.", acao: botao("ligacao-retomar-audio", "Ouvir", { classe: "pri sm" }), classe: "aviso-compacto" }) : "");
  const voltou = t.iaVoltou ? htmlIaVoltou(t.iaVoltou, botDoAviso(t)) : "";
  return voltou + htmlAvisoComum(t);
}

function htmlAvisoComum(t: EstadoTelaLigacao): string {
  const aviso = t.aviso ? avisoDeEstado({ tom: t.aviso.tom, texto: t.aviso.texto, papel: t.aviso.tom === "erro" ? "alert" : "status", classe: "aviso-compacto" }) : "";
  const audio = t.audioSuspenso ? avisoDeEstado({ tom: "alerta", texto: "O navegador segurou o som da ligação.", acao: botao("ligacao-retomar-audio", "Ouvir", { classe: "pri sm" }), classe: "aviso-compacto" }) : "";
  return aviso + audio;
}

/** "Diga algo como" (ADR-077): cada chip manda o texto como uma vez da pessoa; na pílula, embaixo dela. */
function htmlSugestoes(t: EstadoTelaLigacao): string {
  // Sem IA, um chip viraria uma vez sem resposta: eles voltam quando a ligação voltar a ouvir.
  if (t.semIa) return "";
  return t.sugestoes.length ? `<div class="lc-sugestoes"><span>Diga algo como</span>${t.sugestoes.map((s) => botao("ligacao-sugestao", esc(s), { classe: "chip-sugestao", dados: { texto: s } })).join("")}</div>` : "";
}

function htmlLegenda(t: EstadoTelaLigacao): string {
  const linhas = t.legendas.slice(-LEGENDAS_NA_TELA);
  const ultimaDoBot = [...linhas].reverse().find((l) => l.autor === "bot" && !l.espera)?.chave;
  const ps = linhas.map((l) => {
    // Classes com o prefixo lc-: `.espera` e `.parcial` já são de outros componentes (interface.css).
    const classes = ["lc-fala", l.autor === "bot" ? "lc-bot" : "lc-pessoa", l.espera ? "lc-espera" : "", !l.final ? "lc-parcial" : "", l.chave === ultimaDoBot ? "lc-atual" : ""].filter(Boolean).join(" ");
    return `<p class="${classes}">${esc(l.texto)}</p>`;
  }).join("");
  return `${ps}${htmlSugestoes(t)}`;
}

/** O card da janela de aprovação: a frase, a contagem e os botões que também valem por clique. */
export function htmlCardJanela(card: CardJanela | null, nomeBot: string): string {
  if (!card) return "";
  const d = card.decisao;
  const pergunta = d?.tipo === "pergunta" || d?.tipo === "falta_de_dado" || d?.tipo === "permissao";
  const contagem = `<span class="lj-contagem" id="ligacao-contagem">${card.restanteS}s</span>`;
  const frase = d ? esc(d.frase) : `${esc(nomeBot)} pediu uma aprovação.`;
  const acoes = !d ? "" : pergunta
    ? '<p class="lj-dica">Responda falando ou pelo teclado.</p>'
    : `<p class="lj-dica">Diga “eu aprovo” ou “recuso”.</p><div class="lj-acoes">${botao("ligacao-recusar", "Recusar", { id: d.id })}${botao("ligacao-aprovar", "Aprovar", { classe: "pri", id: d.id })}</div>`;
  return `<section class="ligacao-janela" aria-label="Aprovação durante a ligação"><div class="lj-cab"><b>${pergunta ? "Pergunta" : "Aprovação"}</b>${contagem}</div><p class="lj-frase">${frase}</p>${acoes}</section>`;
}

function htmlTeclado(t: EstadoTelaLigacao): string {
  if (!t.teclado || t.semIa) return "";
  return `<form class="lc-teclado" data-form="ligacao-texto"><input id="ligacao-texto" name="texto" maxlength="2000" autocomplete="off" placeholder="Escreva para ${esc(t.agente.nome)}…" aria-label="Mensagem para ${esc(t.agente.nome)} durante a ligação" /><button type="submit" class="bt pri" aria-label="Enviar">${ICONE_LIGACAO.enviar()}</button></form>`;
}

function botaoRedondo(act: string, icone: string, rotulo: string, extra: { pressionado?: boolean; classe?: string } = {}): string {
  const pressionado = extra.pressionado === undefined ? "" : ` aria-pressed="${extra.pressionado}"`;
  return `<button type="button" class="lig-bt${extra.classe ? ` ${extra.classe}` : ""}" data-act="${act}" aria-label="${esc(rotulo)}" title="${esc(rotulo)}"${pressionado}>${icone}</button>`;
}

function htmlOnda(t: EstadoTelaLigacao): string {
  const quem = t.quemFala === "bot" ? `${t.agente.nome} falando` : t.quemFala === "pessoa" ? "Você falando" : "Em silêncio";
  return `<span class="lp-onda${t.quemFala ? ` fala-${t.quemFala}` : ""}" role="img" aria-label="${esc(quem)}"><i></i><i></i><i></i><i></i><i></i></span>`;
}

export function partesDaLigacao(t: EstadoTelaLigacao, card: CardJanela | null): PartesLigacao {
  const nome = esc(t.agente.nome);
  const relogio = duracaoRelogio(t.agora - t.desde);
  const mudo = botaoRedondo("ligacao-mudo", t.mudo ? ICONE_LIGACAO.microfoneMudo() : ICONE_LIGACAO.microfone(), t.mudo ? "Ligar o microfone" : "Desligar o microfone", { pressionado: t.mudo, classe: t.mudo ? "ativo" : "" });
  const desligar = botaoRedondo("ligacao-desligar", ICONE_LIGACAO.desligar(), "Desligar", { classe: "desligar" });
  if (t.modo === "cheia") {
    return {
      esqueleto: `<div class="ligacao-cheia" role="dialog" aria-modal="true" aria-label="Ligação com ${nome}">
        <div class="lc-topo">${botaoRedondo("ligacao-encolher", ICONE_LIGACAO.encolher(), "Encolher a ligação (Esc)")}</div>
        <div class="lc-identidade"><div id="ligacao-mascote" class="lc-mascote"></div><div id="ligacao-info" class="lc-info"></div></div>
        <div id="ligacao-aviso" class="lc-aviso"></div>
        <div id="ligacao-legenda" class="lc-legenda" aria-live="polite"></div>
        <div id="ligacao-card" class="lc-card"></div>
        <div id="ligacao-teclado" class="lc-teclado-wrap"></div>
        <div id="ligacao-controles" class="lc-controles"></div>
      </div>`,
      mascote: iconeAgente(t.agente, "xxl", estadoDoMascote(t)),
      info: `<span class="lc-nome">${nome}</span><span class="lc-relogio" data-ligacao-relogio>${relogio}</span><span class="lc-estado">${esc(textoFase(t.fase, t.rotulo))}</span>`,
      aviso: htmlAviso(t),
      legenda: htmlLegenda(t),
      card: htmlCardJanela(card, t.agente.nome),
      teclado: htmlTeclado(t),
      controles: `<div class="lc-grupo">${mudo}${botaoRedondo("ligacao-teclado", ICONE_LIGACAO.teclado(), t.teclado ? "Fechar o teclado" : "Escrever durante a ligação", { pressionado: t.teclado, classe: t.teclado ? "ativo" : "" })}${botaoRedondo("ligacao-ajustes", ICONE_LIGACAO.ajustes(), "Ajustes da voz")}</div>${desligar}`,
    };
  }
  return {
    esqueleto: `<div class="ligacao-pilula" role="region" aria-label="Ligação com ${nome}">
      <div class="lp-barra"><div id="ligacao-mascote" class="lp-mascote"></div><div id="ligacao-info" class="lp-info"></div><div id="ligacao-controles" class="lp-controles"></div></div>
      <div id="ligacao-aviso" class="lp-aviso"></div>
      <div id="ligacao-card" class="lp-card"></div>
      <div id="ligacao-legenda" class="lp-sugestoes"></div><div id="ligacao-teclado" hidden></div>
    </div>`,
    mascote: iconeAgente(t.agente, "sm", estadoDoMascote(t)),
    info: `<span class="lp-nome">${nome}</span><span class="lp-relogio" data-ligacao-relogio>${relogio}</span>${htmlOnda(t)}`,
    aviso: htmlAviso(t),
    legenda: htmlSugestoes(t),
    card: htmlCardJanela(card, t.agente.nome),
    teclado: "",
    controles: `${mudo}${botaoRedondo("ligacao-expandir", ICONE_LIGACAO.expandir(), "Abrir a ligação em tela cheia")}${desligar}`,
  };
}

const MOTIVOS: readonly { id: MotivoAvaliacaoLigacao; rotulo: string }[] = [
  { id: "demorou", rotulo: "Demorou" },
  { id: "nao_entendeu", rotulo: "Não entendeu" },
  { id: "interrompeu", rotulo: "Interrompeu" },
  { id: "voz", rotulo: "Voz" },
  { id: "outro", rotulo: "Outro" },
];

/** "Como foi a ligação?" (protótipo HiFiMac): 👍/👎 e, no 👎, o motivo. */
export function renderAvaliacao(a: AvaliacaoLigacao): string {
  const cab = `<div class="la-cab">${ICONE_LIGACAO.fone(15)}<b>Ligação com ${esc(a.agenteNome)} · ${esc(duracaoRelogio(a.duracaoMs))}</b>${botao("ligacao-fechar-avaliacao", ICONE_LIGACAO.fechar(), { classe: "la-fechar", aria: "Fechar" })}</div>`;
  const motivo = a.motivoFim ? `<p class="la-motivo">${esc(a.motivoFim)}</p>` : "";
  const corpo = a.passo === "nota"
    ? `<div class="la-pergunta">Como foi a ligação?<span>${botao("ligacao-avaliar", ICONE_LIGACAO.bom(), { classe: "la-nota", dados: { nota: "boa" }, aria: "Foi boa" })}${botao("ligacao-avaliar", ICONE_LIGACAO.ruim(), { classe: "la-nota", dados: { nota: "ruim" }, aria: "Foi ruim" })}</span></div>`
    : a.passo === "motivo"
      ? `<div class="la-pergunta">O que atrapalhou?</div><div class="la-motivos">${MOTIVOS.map((m) => botao("ligacao-motivo", esc(m.rotulo), { classe: "chip-sugestao", dados: { motivo: m.id } })).join("")}</div>`
      : '<p class="la-obrigado">Obrigado. Isso ajuda a melhorar as ligações.</p>';
  return `<section class="ligacao-avaliacao" role="status" aria-label="Como foi a ligação">${cab}${motivo}${corpo}</section>`;
}

export function renderRecusa(texto: string): string {
  return `<div class="ligacao-recusa">${avisoDeEstado({ tom: "alerta", texto, papel: "status", acao: botao("ligacao-fechar-recusa", ICONE_LIGACAO.fechar(), { classe: "la-fechar", aria: "Fechar" }) })}</div>`;
}

/** Junta uma legenda nova à lista: parcial da pessoa troca a de mesmo id; a fala do bot entra uma vez por `utt`. */
export function comLegenda(legendas: readonly LinhaLegenda[], l: LinhaLegenda, maximo = 40): LinhaLegenda[] {
  const i = legendas.findIndex((x) => x.chave === l.chave);
  const nova = i >= 0 ? legendas.map((x, j) => (j === i ? l : x)) : [...legendas, l];
  return nova.slice(-maximo);
}

export const TEXTO_SEM_MAC = "Perdi a conexão com o seu Mac. Tentando de novo…";
