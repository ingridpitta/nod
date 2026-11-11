/**
 * NOD-429 (definido em 2026-10-30): os componentes do quadro-agente, portados da v3 do protótipo base
 * (gamefik/nod-prototipos, `_nod/quadro/quadro.js`, PR #16) para TS. O par é web/quadro.css (classes `qd-`).
 *
 * Diferença do protótipo: lá título, motivo e descrição entravam como HTML cru. Aqui todo campo `string` é TEXTO e passa
 * por `esc`; só entra como HTML o que tem o tipo `Html` — o que os próprios componentes geram, o mascote do nod
 * (`iconeAgente`) e o texto formatado do produto, marcados com `confiar` por quem os produziu.
 *
 * Os componentes não sabem de estado nem de dados: recebem o que mostrar e devolvem a string. As NOD-415 a 422 e 430
 * montam o quadro de verdade com eles.
 */
import { esc } from "../lib/escape.ts";
import { colunasPadrao, GRUPO_DO_STATUS, trilhaDaColuna, type Grupo, type ModoDaConversa, type Status } from "../lib/quadro.ts";
import type { Filtro } from "../lib/vista-do-quadro.ts";

declare const MARCA: unique symbol;
/** HTML já seguro. Só sai de um componente daqui ou de `confiar`. */
export type Html = string & { readonly [MARCA]: true };
/** Marca como seguro um HTML que o próprio nod gerou (o mascote, o texto formatado). Nunca texto de fora. */
export function confiar(html: string): Html { return html as Html; }
const h = (s: string): Html => s as Html;
const juntar = (partes: readonly (Html | "" | false | null | undefined)[]): Html => h(partes.filter(Boolean).join(""));
const cl = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(" ");

const svg = (d: string, classe: string, w = 16, sw = 1.8): Html =>
  h(`<svg class="qd-ic ${classe}" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);

/** Os ícones de estado das colunas: a forma diz o grupo (vazio = não iniciado, meio = iniciado, cheio = fechado). */
export const ICONE_DO_STATUS: Readonly<Record<Status, Html>> = {
  backlog: svg('<circle cx="12" cy="12" r="8" stroke-dasharray="2.6 2.6"/>', "qd-st qd-st-backlog", 14, 2),
  afazer: svg('<circle cx="12" cy="12" r="8"/>', "qd-st qd-st-afazer", 14, 2),
  fazendo: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>', "qd-st qd-st-fazendo", 14, 2),
  voce: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>', "qd-st qd-st-voce", 14, 2),
  revisao: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 1 1-8 8h8z" fill="currentColor" stroke="none"/>', "qd-st qd-st-revisao", 14, 2),
  bloqueado: svg('<circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11"/>', "qd-st qd-st-bloqueado", 14, 2),
  feito: svg('<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m8 12.2 2.8 2.8L16.2 9.6" stroke="var(--surface)" stroke-width="2.2"/>', "qd-st qd-st-feito", 14, 2),
  cancelado: svg('<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m9 9 6 6M15 9l-6 6" stroke="var(--surface)" stroke-width="2.2"/>', "qd-st qd-st-cancelado", 14, 2),
};

export const ICONE = {
  fila: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', "qd-ic-fila", 12, 2),
  falhou: svg('<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>', "qd-ic-falhou", 13, 2),
  pausa: svg('<circle cx="12" cy="12" r="8.5"/><path d="m6.5 17.5 11-11"/>', "qd-ic-bloq", 12, 2),
  ok: svg('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>', "qd-ic-ok", 14, 1.9),
  // NOD-421 (3ª revisão do PR #621): o PR em Entregáveis. Fechado sem merge = círculo com um traço; mergeado = o merge.
  fechado: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/>', "qd-ic-fechado", 14, 1.9),
  mergeado: svg('<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="12" r="2"/><path d="M7 8v8M7 8c0 3 4 4 8 4"/>', "qd-ic-mergeado", 14, 1.8),
  voltar: svg('<path d="m15 5-7 7 7 7"/>', "qd-ic-voltar", 16, 1.9),
  chev: svg('<path d="m9 6 6 6-6 6"/>', "qd-ic-chev", 12, 2),
  trava: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', "qd-ic-trava", 12, 2),
  quadro: svg('<rect x="3.5" y="4.5" width="5" height="15" rx="1.2"/><rect x="9.5" y="4.5" width="5" height="10" rx="1.2"/><rect x="15.5" y="4.5" width="5" height="12" rx="1.2"/>', "qd-ic-quadro", 14, 1.6),
  conversa: svg('<path d="M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H8z"/>', "qd-ic-conversa", 14, 1.7),
  mais: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>', "qd-ic-mais", 16, 1.6),
  novo: svg('<path d="M12 5v14M5 12h14"/>', "qd-ic-novo", 14, 2),
  alca: svg('<path d="M5 9h14M5 15h14"/>', "qd-ic-alca", 16, 2),
  subir: svg('<path d="m6 15 6-6 6 6"/>', "qd-ic-subir", 14, 2),
  descer: svg('<path d="m6 9 6 6 6-6"/>', "qd-ic-descer", 14, 2),
  /** NOD-420: a tarefa parada além do prazo da coluna (ao lado do "há quanto", decorativo: o texto diz). */
  prazo: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', "qd-ic-prazo", 11, 2),
  tirar: svg('<path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9.5 7V4.5h5V7"/>', "qd-ic-tirar", 14, 1.7),
} as const;

/* ---------- Estado do trabalho, aviso e avatar ---------- */

export type EstadoDoTrabalho = "rodando" | "fila" | "esperando" | "falhou";
// ADA-16 (ADR-163): cada tarefa roda num trabalho próprio, sem teto; a fila é a da máquina pegar, a da mesma tarefa ou a do portão.
const FRASE: Record<EstadoDoTrabalho, { curta: string; longa: string }> = {
  rodando: { curta: "", longa: "o agente está trabalhando nela agora" },
  fila: { curta: "na fila", longa: "esperando a máquina começar; o motivo, se houver, aparece ao lado" },
  esperando: { curta: "esperando", longa: "esperando a CI, um colega ou um comando" },
  falhou: { curta: "falhou", longa: "falhou e vai tentar de novo" },
};
const VERBO: Record<EstadoDoTrabalho, string> = { rodando: "trabalhando", fila: "na fila", esperando: "esperando", falhou: "falhou" };

/** O anel com a inicial: uma pessoa; você, cheio. */
export function anel(iniciais: string, rotulo: string, voce = false): Html {
  return h(`<span class="${cl("qd-anel", voce && "qd-anel-voce")}" role="img" aria-label="${esc(rotulo)}">${esc(iniciais)}</span>`);
}

/**
 * O aviso de alguns segundos na linha 1 do card ("Movido por você · Desfazer") ou a recusa da trava ("Feito só aceita
 * vindo de Em revisão · Mandar para Em revisão"). Comentário final do Marlon na j4-5 (definido em 2026-10-30): a recusa
 * cabe no card — quebra linha no CSS e leva o texto inteiro no `title` (o leitor de tela lê o próprio texto, em `role=status`).
 */
export interface Aviso { texto: string; acao?: string | false; recusa?: boolean; act?: string; id?: string }
export function aviso(a: Aviso): Html {
  const rotulo = a.acao === false ? "" : (a.acao ?? "Desfazer");
  const dados = `${a.act ? ` data-act="${esc(a.act)}"` : ""}${a.id ? ` data-id="${esc(a.id)}"` : ""}`;
  const acao = rotulo ? `<button type="button" class="qd-link qd-aviso-acao"${dados}>${esc(rotulo)}</button>` : "";
  const inteiro = rotulo ? `${a.texto} · ${rotulo}` : a.texto;
  return h(`<span class="${cl("qd-aviso", a.recusa && "qd-aviso-recusa")}" role="status" title="${esc(inteiro)}"><span class="qd-aviso-txt">${esc(a.texto)}</span>${acao}</span>`);
}

/** Quem está executando: o avatar (mascote ou anel), o nome e, opcional, o que faz e há quanto tempo. */
export interface QuemRoda { avatar: Html; nome: string; acao?: string; tempo?: string }

function rotuloDoAvatar(nome: string, estado: EstadoDoTrabalho | null, acao?: string, tempo?: string): string {
  const verbo = acao || (estado ? VERBO[estado] : "");
  return [nome, verbo].filter(Boolean).join(" ") + (tempo ? ` · ${tempo}` : "");
}

/** O mascote por dentro fica mudo: quem lê o estado é o title e o aria-label do avatar. */
function emudecer(av: Html): string {
  return av.replace(/ role="img"/g, ' aria-hidden="true"').replace(/ aria-label="[^"]*"/g, "").replace(/ title="[^"]*"/g, "");
}

const SELO: Partial<Record<EstadoDoTrabalho, string>> = {
  falhou: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="var(--danger)"/><path d="m4 4 4 4M8 4 4 8" stroke="var(--qd-card, var(--surface))" stroke-width="1.6" stroke-linecap="round"/></svg>',
  fila: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><circle cx="6" cy="6" r="5.25" fill="var(--qd-card, var(--surface))" stroke="var(--ink-3)" stroke-width="1.3"/><path d="M6 3.4V6l1.7 1.1" fill="none" stroke="var(--ink-3)" stroke-width="1.3" stroke-linecap="round"/></svg>',
  // ADA-16: esperando (a CI, um colega, um comando) é uma pausa, não um relógio de fila: dois traços.
  esperando: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><circle cx="6" cy="6" r="5.25" fill="var(--qd-card, var(--surface))" stroke="var(--ink-3)" stroke-width="1.3"/><path d="M4.8 4v4M7.2 4v4" stroke="var(--ink-3)" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

/**
 * O avatar com o estado da execução (#223 da v3): rodando, um anel girando em volta; na fila, um relógio; falhou, um ⊗.
 * `sobre`: quem roda no lugar do responsável entra sobreposto a ele. Sem estado, é o avatar puro.
 */
export function avatar(a: { avatar: Html; nome: string; estado?: EstadoDoTrabalho | null; acao?: string; tempo?: string; sobre?: boolean }): Html {
  if (!a.estado && !a.sobre) return a.avatar;
  const rot = rotuloDoAvatar(a.nome, a.estado ?? null, a.acao, a.tempo);
  const selo = a.estado && SELO[a.estado] ? `<i class="qd-av-sel">${SELO[a.estado]}</i>` : "";
  return h(`<span class="${cl("qd-av", a.estado && `qd-av-${a.estado}`, a.sobre && "qd-av-sobre")}" role="img" aria-label="${esc(rot)}" title="${esc(rot)}">${emudecer(a.avatar)}${selo}</span>`);
}

/* ---------- O card ---------- */

export interface Card {
  id: string;
  /** O código à vista (NOD-442: o do Linear ou o curto do quadro); sem ele, o próprio id. O `data-id` segue sendo o id. */
  codigo?: string;
  titulo: string;
  /** O responsável: o avatar e o nome. */
  responsavel?: { avatar: Html; nome: string };
  estado?: EstadoDoTrabalho;
  /** Troca a frase curta do estado ("na fila · após NOD-512"). */
  estadoTexto?: string;
  /** Bloqueado: o motivo vai na linha 1. */
  motivo?: string;
  /**
   * ADR-162 (fluxo Multica): o bot perguntou e a tarefa espera você, na coluna dela. O card só mostra "te perguntou",
   * pequeno e cinza (a única concessão além do Multica; tirar é apagar este campo); a pergunta vai no rótulo e no comentário.
   */
  perguntou?: string;
  tags?: string[];
  /** NOD-421: o PR do card com o ponto discreto do estado (antes das tags); o estado em texto vai no title e no qd-sr. */
  pr?: { texto: string; tom: "pendente" | "ok" | "falhou" | "conflito" | "mergeado" | "fechado"; titulo: string };
  quando?: string;
  /** Quem executa agora. Sem isto, com estado "rodando", é o próprio responsável. */
  rodam?: QuemRoda[];
  /** O aviso de alguns segundos no lugar do estado. */
  aviso?: Aviso;
  brilho?: boolean;
  classe?: string;
  /** ADR-142: o card se arrasta para outra coluna (só no quadro que edita); com ele vem o "Mover para…" (teclado e toque). */
  arrastavel?: boolean;
  /** NOD-420: o campo Responder no próprio card (Bloqueado e Precisa de você); o valor é o teto da resposta. */
  responder?: number;
  /** NOD-420: parada além do prazo da coluna (o "parada há" fica em destaque). */
  atrasada?: boolean;
  /** ADR-142: o menu do "Mover para…", quando aberto neste card. */
  menu?: Html;
  /** NOD-460: o título e o código com o trecho da busca marcado (já escapados); sem eles, o texto puro. */
  tituloHtml?: Html;
  codigoHtml?: Html;
  /** NOD-460: há quanto o agente roda ("há 2 min"), para o selo "Trabalhando" da linha 1. */
  rodandoHa?: string;
  /** ADA-232: o bot marcou a volta; a linha 1 diz "Esperando · <motivo>" (sem motivo, só "Esperando"). */
  esperando?: { motivo: string | null };
  /**
   * 2026-11-10 (o wakeup do Multica: wait.reply_from, wait.pr_checks, wait.time): a espera da tarefa num chip com sino, na
   * linha de cima do card e no fim da linha da lista — "Esperando você responder", "Esperando a CI", "Volta às 14:00".
   * Ganha do "te perguntou" e do "Esperando · motivo".
   */
  espera?: { texto: string; voce: boolean };
  /** Quadro minimalista (2026-11-10): o ícone de prioridade antes do código (já pronto, web/telas/opcoes-quadro.ts). */
  prioridade?: Html;
  /** 2026-11-10: o nome da prioridade; com o card editável (arrastavel), as barrinhas viram o botão do seletor. */
  prioridadeNome?: string;
  /** O seletor de prioridade está aberto neste card (o menu vem em `menu`). */
  priAberta?: boolean;
  /** A descrição em até duas linhas, debaixo do título (propriedade do card ligada). */
  descricao?: string;
  /** "Atualizado há 1 h", à direita do rodapé (quando não há o "parada há" da coluna). */
  atualizado?: string;
  /** Quantos comentários a tarefa tem (o balãozinho do rodapé; 0 não aparece). */
  comentarios?: number;
  /** As labels da tarefa (outra frente cria o campo): o nome e, se houver, a cor do pontinho. */
  labels?: { nome: string; cor?: string | null }[];
  /** O prazo da tarefa ("até 12 nov"); vencida = em perigo (a única cor). */
  prazo?: { texto: string; vencida: boolean };
}

/** ADA-232: a frase da linha 1 de quem marcou a volta (o motivo vem do bot, sempre escapado). */
/** Labels e Prazo no card (só quando a tarefa os traz). A cor da label só entra se for um #rgb/#rrggbb (dado de fora). */
function extrasDoCard(c: Card): string {
  const cor = (x?: string | null): string => (x && /^#[0-9a-f]{3,8}$/i.test(x) ? ` style="--qm-cor:${x}"` : "");
  const paleta = (x?: string | null): string => (x && /^[a-z]+$/.test(x) ? ` class="qd-label-ponto" data-cor="${esc(x)}"` : "");
  const labels = (c.labels ?? []).map((l) => `<span class="qd-tag qm-label"${cor(l.cor)}><i${paleta(l.cor)} aria-hidden="true"></i>${esc(l.nome)}</span>`).join("");
  const prazo = c.prazo ? `<span class="qd-tag qm-prazo${c.prazo.vencida ? " qm-vencida" : ""}" title="${esc(c.prazo.vencida ? `Vencida: ${c.prazo.texto}` : `Prazo: ${c.prazo.texto}`)}">${esc(c.prazo.texto)}${c.prazo.vencida ? '<span class="qd-sr">, vencida</span>' : ""}</span>` : "";
  return labels + prazo;
}

const COMENTARIO = svg('<path d="M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H8z"/>', "qm-ic-com", 12, 1.8);

export const fraseEsperando = (motivo: string | null): string => (motivo ? `Esperando · ${motivo}` : "Esperando");

/**
 * 2026-11-10 (a edição inline do Multica): no card editável, clicar nas barrinhas abre o seletor de prioridade (o recibo
 * traz o Desfazer). Sem botão pesado: o próprio ícone, com o foco e o hover discretos.
 */
export function prioridadeDoCard(c: Card): string {
  if (!c.prioridade) return "";
  if (!c.arrastavel || !c.prioridadeNome) return String(c.prioridade);
  return `<button type="button" class="qm-pri-bt" data-act="tarefa-prioridade" data-tarefa="${esc(c.id)}" aria-haspopup="menu" aria-expanded="${!!c.priAberta}"${c.priAberta ? ' aria-controls="qd-menu"' : ""}` +
    ` aria-label="${esc(`Prioridade: ${c.prioridadeNome}. Mudar`)}" title="${esc(`Prioridade: ${c.prioridadeNome}`)}">${c.prioridade}</button>`;
}

/** O "Mover para…" do card (ADR-142, revisão do PR #622): leva ao mesmo lugar que arrastar, sem precisar de mouse. */
export function botaoDeMover(c: Card): string {
  if (!c.arrastavel) return "";
  return `<button type="button" class="qd-card-mover" data-act="tarefa-mover" data-tarefa="${esc(c.id)}" aria-label="${esc(`Mover ${c.titulo} para…`)}" aria-haspopup="menu" aria-expanded="${!!c.menu}"${c.menu ? ' aria-controls="qd-menu"' : ""}>Mover para…</button>`;
}

function quemRodaNoCard(c: Card): QuemRoda[] {
  if (c.rodam) return c.rodam;
  if (c.estado === "rodando" && !c.motivo && c.responsavel) return [{ ...c.responsavel, acao: c.estadoTexto, tempo: c.quando }];
  return [];
}

/** O responsável (com o anel se é ele quem roda, ou o relógio/⊗) e, por cima, quem roda no lugar dele. */
export function avataresDoCard(c: Card): { html: Html; rodam: QuemRoda[] } {
  const rodam = quemRodaNoCard(c);
  const r = c.responsavel;
  const dele = r ? rodam.find((q) => q.nome === r.nome) : undefined;
  const k: EstadoDoTrabalho | null = dele ? "rodando" : !c.motivo && (c.estado === "fila" || c.estado === "esperando" || c.estado === "falhou") ? c.estado : null;
  const base = r ? avatar(dele ? { ...dele, avatar: r.avatar, estado: "rodando" } : { avatar: r.avatar, nome: r.nome, estado: k, acao: k ? c.estadoTexto : undefined }) : "";
  const outros = rodam.filter((q) => q !== dele).map((q) => avatar({ ...q, estado: "rodando", sobre: true }));
  return { html: juntar([base, ...outros]), rodam };
}

function estadoDoCard(c: Card): Html {
  if (c.motivo) {
    return h(`<span class="qd-estado qd-e-bloqueado" title="${esc(`bloqueada: ${c.motivo}`)}">${ICONE.pausa}<span>${esc(c.motivo)}</span></span>`);
  }
  if (c.espera) return chipDeEspera(c.espera);
  if (c.esperando) {
    const f = fraseEsperando(c.esperando.motivo);
    return h(`<span class="qd-estado qd-e-esperando" title="${esc(`o bot volta sozinho: ${f}`)}"><span>${esc(f)}</span></span>`);
  }
  if (c.estado === "rodando") return seloTrabalhando(c.rodandoHa, c.responsavel?.avatar);
  if (!c.estado) return h("");
  const f = FRASE[c.estado];
  return h(`<span class="qd-estado qd-e-${c.estado}" title="${esc(c.estadoTexto ? `${c.estadoTexto}: ${f.longa}` : f.longa)}"><span>${esc(c.estadoTexto || f.curta)}</span></span>`);
}

/** NOD-460: o selo discreto de quem roda agora (bolinha verde parada, sem pulsar), com há quanto tempo. */
export function seloTrabalhando(ha?: string, av?: Html): Html {
  const txt = ha ? `Trabalhando · ${ha}` : "Trabalhando";
  // Quadro minimalista (2026-11-10): com o avatar de quem roda (pequeno, mudo), como o "Working" do Multica.
  const marca = av ? `<span class="qm-selo-av" aria-hidden="true">${emudecer(av)}</span>` : `<i aria-hidden="true"></i>`;
  return h(`<span class="qd-selo${av ? " qm-selo" : ""}" title="${esc(ha ? `Trabalhando ${ha}` : "Trabalhando agora")}">${marca}${esc(txt)}</span>`);
}

/** NOD-420 (revisão 4 do PR #624): o que o leitor de tela ouve da tarefa parada além do prazo da coluna. */
export const PASSOU_DO_PRAZO = "passou do prazo";

/** O "há quanto" do card e da linha; atrasada, com o relógio (aria-hidden) e o "passou do prazo" para o leitor de tela. */
export function quandoDoCard(c: Card): string {
  if (!c.quando) return "";
  if (!c.atrasada) return `<span class="qd-quando">${esc(c.quando)}</span>`;
  return `<span class="qd-quando qd-atrasada" title="Passou do prazo da coluna">${ICONE.prazo}${esc(c.quando)}<span class="qd-sr">, ${PASSOU_DO_PRAZO}</span></span>`;
}

/** O que o leitor de tela ouve do card inteiro, numa frase. */
export function rotuloDoCard(c: Card): string {
  const { rodam } = avataresDoCard(c);
  return [
    c.codigo ?? c.id, c.titulo, c.responsavel?.nome,
    c.motivo ? `bloqueada: ${c.motivo}` : "",
    c.espera ? `${c.espera.texto}${c.perguntou ? `: ${c.perguntou}` : ""}` : c.perguntou !== undefined ? `te perguntou${c.perguntou ? `: ${c.perguntou}` : ""}` : "",
    !c.motivo && !c.espera && c.esperando ? fraseEsperando(c.esperando.motivo) : "",
    ...rodam.map((q) => rotuloDoAvatar(q.nome, "rodando", q.acao, q.tempo)),
    !c.motivo && !c.esperando && !c.espera && c.estado && c.estado !== "rodando" ? FRASE[c.estado].longa : "",
    c.aviso ? c.aviso.texto : "",
    c.atrasada ? PASSOU_DO_PRAZO : "",
  ].filter(Boolean).join(", ");
}

/**
 * NOD-420: o campo Responder no card (e na linha do celular). Enter envia, Shift+Enter quebra a linha; quem ouve o
 * teclado e o envio é web/lib/quadro-na-tela.ts. O id deixa o rascunho sobreviver à regravação do quadro.
 */
export function formDoResponder(c: Card, onde: "card" | "linha"): string {
  if (!c.responder) return "";
  const id = `qd-cresp-${onde}-${esc(c.id)}`;
  return `<form class="qd-card-resp" data-form="responder-tarefa" data-id="${esc(c.id)}">` +
    `<textarea id="${id}" class="qd-resp-in qd-card-resp-in" name="resposta" rows="1" maxlength="${c.responder}" required placeholder="Responder" aria-label="${esc(`Responder: ${c.titulo}`)}"></textarea>` +
    `<button type="submit" class="qd-bt qd-bt-leve qd-card-resp-bt" aria-label="${esc(`Enviar resposta: ${c.titulo}`)}">Enviar</button></form>`;
}

/**
 * O card: branco, 4 linhas. 1) id + o que não é execução (na fila, falhou, o motivo do bloqueio) ou o aviso; 2) o título
 * (até 2 linhas), que é o botão — o clique vale no card inteiro; 3) as tags; 4) os avatares (com o anel de quem roda),
 * o "te perguntou" (ADR-162) e quando mudou.
 */
export function card(c: Card): Html {
  const av = avataresDoCard(c);
  const r = c.responsavel;
  const quem = r || av.rodam.length ? `<span class="qd-quem"><span class="qd-avs">${av.html}</span><span>${esc(r?.nome ?? "")}</span></span>` : "";
  const quando = `${perguntouDoCard(c)}${quandoDoCard(c) || (c.atualizado ? `<span class="qd-quando qm-atualizado">${esc(c.atualizado)}</span>` : "")}`;
  const coms = c.comentarios ? `<span class="qm-coms" title="${esc(`${c.comentarios} ${c.comentarios === 1 ? "comentário" : "comentários"}`)}">${COMENTARIO}<span>${c.comentarios}</span><span class="qd-sr"> ${c.comentarios === 1 ? "comentário" : "comentários"}</span></span>` : "";
  const resp = formDoResponder(c, "card");
  const l1 = c.aviso ? aviso(c.aviso) : estadoDoCard(c);
  const l3 = c.pr || c.tags?.length ? `<span class="qd-tags">${c.pr ? `<span class="qd-tag qd-tag-pr" title="${esc(c.pr.titulo)}"><i class="qd-pr-ponto qd-pr-${c.pr.tom}" aria-hidden="true"></i>${esc(c.pr.texto)}<span class="qd-sr"> (${esc(c.pr.titulo)})</span></span>` : ""}${(c.tags ?? []).map((t) => `<span class="qd-tag">${esc(t)}</span>`).join("")}${extrasDoCard(c)}</span>` : extrasDoCard(c) ? `<span class="qd-tags">${extrasDoCard(c)}</span>` : "";
  const classe = cl("qd-card", c.menu && "qd-com-menu", c.motivo && "qd-bloqueado", c.brilho && "qd-brilho", c.aviso && "qd-com-aviso", c.classe && esc(c.classe));
  return h(`<li class="${classe}" data-tarefa="${esc(c.id)}"${c.arrastavel ? ' draggable="true"' : ""}>` +
    `<div class="qd-card-l1">${prioridadeDoCard(c)}<span class="qd-id">${c.codigoHtml ?? esc(c.codigo ?? c.id)}</span>${l1}</div>` +
    `<button type="button" class="qd-card-bt" data-act="abrir-tarefa" data-id="${esc(c.id)}" aria-label="${esc(rotuloDoCard(c))}"><span class="qd-card-tit">${c.tituloHtml ?? esc(c.titulo)}</span></button>` +
    (c.descricao ? `<p class="qm-desc">${esc(c.descricao)}</p>` : "") +
    l3 + resp + (quem || quando || coms ? `<div class="qd-card-pe">${quem}${coms}${quando}</div>` : "") + botaoDeMover(c) + (c.menu ?? "") + `</li>`);
}

/** ADR-162: o sinal discreto da tarefa que espera você. 2026-11-10: com o chip da espera (`espera`), o chip fala por ele. */
export function perguntouDoCard(c: Pick<Card, "perguntou" | "espera">): string {
  if (c.espera) return "";
  return c.perguntou !== undefined ? `<span class="qd-perguntou">te perguntou</span>` : "";
}

const SINO = '<svg class="qd-espera-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';

/** 2026-11-10: o chip da espera (sino + frase), pequeno, com contorno e sem fundo; o de "você" com a tinta mais forte. */
export function chipDeEspera(e: { texto: string; voce: boolean }): Html {
  return h(`<span class="${cl("qd-espera", e.voce && "qd-espera-voce")}" title="${esc(e.texto)}">${SINO}<span>${esc(e.texto)}</span></span>`);
}

/* ---------- Coluna, quadro, barra e meta ---------- */

export interface Coluna {
  /** O id da coluna (o `status` das tarefas): um dos padrão ou `c-<slug>` (NOD-448). */
  status: string;
  nome: string;
  /** NOD-448: o grupo (dá a cor do fundo); sem ele, o da coluna padrão. */
  grupo?: Grupo;
  /** NOD-448: o ícone (a forma do grupo); sem ele, o da coluna padrão. */
  icone?: Status;
  /** NOD-448 (decisão 8 do Gil): coluna criada pela pessoa, com o ícone cinza. */
  pessoa?: boolean;
  cards?: Html[];
  /** A contagem, quando os cards mostrados são só uma parte. */
  n?: number;
  recolhida?: boolean;
  /** Aberta, mas a pessoa pode recolher: o nome vira o botão que recolhe (o mesmo `abrir-coluna` da tira). */
  recolhivel?: boolean;
  /**
   * NOD-448 (decisão 6): o cabeçalho edita. Clique recolhe, clique duplo ou F2 renomeia, Alt ← → move, arrastar move
   * (só dentro do grupo). `fixa` não move.
   */
  editavel?: { fixa: boolean };
  /** NOD-448: o cabeçalho inteiro trocado (o campo de renomear). */
  cab?: Html;
  /** NOD-448: o que vem depois do nome no cabeçalho (o ⋯ e o menu ou o popover dele). */
  apos?: Html;
  /** A regra da coluna ("Feito só aceita vindo de Em revisão"), num cadeado com o texto no title e para o leitor de tela. */
  trava?: string;
  /** NOD-420: o prazo (SLA) da coluna, em palavras ("2 h"), discreto ao lado do nome. */
  prazo?: string;
  /** 2026-11-10 (o backlog_hint do Multica): uma linha discreta debaixo do cabeçalho ("Parada no Backlog: …"). */
  dica?: string;
  vazio?: string;
  mais?: number;
  /** O `data-act` do "e mais N" (a ação de mostrar o resto da coluna). */
  maisAcao?: string;
  /** NOD-460: o "+" do cabeçalho, que abre o campo de nova tarefa no topo da lista (aberta = o campo está à vista). */
  novaTarefa?: { aberta: boolean };
  classe?: string;
  /** NOD-448 / NOD-429: tira presa à direita (o `right` dela, quando há outras presas depois). */
  presa?: string;
  /** Quadro minimalista (agrupar por responsável): o avatar no lugar do ícone de status. */
  avatar?: Html;
}

export const iconeDe = (c: Pick<Coluna, "status" | "icone" | "pessoa">): Html => {
  const ic = ICONE_DO_STATUS[c.icone ?? (c.status as Status)] ?? ICONE_DO_STATUS.afazer;
  return c.pessoa ? h(ic.replace('class="qd-ic qd-st ', 'class="qd-ic qd-st qd-st-pessoa ')) : ic;
};

export function coluna(c: Coluna): Html {
  const cards = c.cards ?? [];
  const n = c.n ?? cards.length;
  const ic = c.avatar ? h(`<span class="qm-av qm-col-av" aria-hidden="true">${emudecer(c.avatar)}</span>`) : iconeDe(c);
  const grupo = c.grupo ?? GRUPO_DO_STATUS[c.status as Status] ?? "iniciado";
  const id = esc(c.status);
  const presa = c.presa !== undefined ? ` style="right: ${esc(c.presa)}"` : "";
  const base = cl("qd-col", `qd-col-${id}`, `qd-grupo-${grupo}`, c.recolhida && "qd-col-recolhida", c.pessoa && "qd-col-pessoa", c.presa !== undefined && "qd-fixa", c.classe && esc(c.classe));
  const dados = `data-status="${id}" data-coluna="${id}" data-grupo="${grupo}"`;
  if (c.recolhida) {
    return h(`<section class="${base}" aria-label="${esc(`${c.nome}, ${n}, recolhida`)}" ${dados}${presa}>` +
      `<button type="button" class="qd-col-tira" data-act="abrir-coluna" data-status="${id}" aria-expanded="false" title="${esc(`Mostrar ${c.nome}`)}">${ic}<span class="qd-col-nome">${esc(c.nome)}</span><span class="qd-n">${n}</span></button></section>`);
  }
  const trava = c.trava ? `<span class="qd-col-trava" title="${esc(c.trava)}">${ICONE.trava}<span class="qd-sr">${esc(c.trava)}</span></span>` : "";
  // QA do PR #624: o prazo é um chip que não quebra; o nome cortado por reticências leva o nome inteiro no title.
  const prazo = c.prazo ? `<span class="qd-col-prazo" title="${esc(`Prazo da coluna: ${c.prazo}`)}"><span class="qd-sr">Prazo: </span>${esc(c.prazo)}</span>` : "";
  const nome = `<span class="qd-col-nome" title="${esc(c.nome)}">${esc(c.nome)}</span>`;
  // "e mais N" só com a ação que mostra o resto (NOD-415): botão sem ação não aparece, só a contagem.
  const mais = !c.mais ? "" : c.maisAcao
    ? `<li class="qd-col-mais"><button type="button" class="qd-link" data-act="${esc(c.maisAcao)}" data-status="${id}">${esc(`e mais ${c.mais}`)}</button></li>`
    : `<li class="qd-col-mais">${esc(`e mais ${c.mais}`)}</li>`;
  // NOD-460: o vazio "" (filtro ou busca sem nada) não diz nada na coluna: a linha do vazio fica sobre a grade.
  const vazio = !cards.length && !c.mais && c.vazio !== "" ? `<li class="qd-col-vazio">${esc(c.vazio ?? "Nada aqui")}</li>` : "";
  const add = c.novaTarefa ? `<button type="button" class="qd-col-add" data-act="col-nova-tarefa" data-status="${id}" aria-label="${esc(`Nova tarefa em ${c.nome}`)}" title="${esc(`Nova tarefa em ${c.nome}`)}" aria-expanded="${c.novaTarefa.aberta}">${ICONE.novo}</button>` : "";
  const ed = c.editavel;
  const dica = ed ? (ed.fixa ? `Recolher ${c.nome} · clique duplo renomeia` : `Recolher ${c.nome} · clique duplo renomeia · arraste para mover`) : `Recolher ${c.nome}`;
  const atalhos = ed ? ` aria-keyshortcuts="${ed.fixa ? "F2" : "F2 Alt+ArrowLeft Alt+ArrowRight"}"${ed.fixa ? "" : " data-arrasta"}` : "";
  const cab = c.cab ?? (c.recolhivel
    ? `<button type="button" class="qd-col-bt" data-act="abrir-coluna" data-status="${id}" aria-expanded="true" data-coluna="${id}" title="${esc(dica)}"${atalhos}>${ic}${nome}<span class="qd-n">${n}</span></button>`
    : `${ic}${nome}<span class="qd-n">${n}</span>`);
  return h(`<section class="${base}" aria-label="${esc(`${c.nome}, ${n}`)}" ${dados}${presa}>` +
    `<h3 class="qd-col-cab">${cab}${trava}${prazo}${add}${c.apos ?? ""}</h3>` +
    (c.dica ? `<p class="qd-col-dica">${esc(c.dica)}</p>` : "") +
    `<ul class="qd-col-lista">${cards.join("")}${mais}${vazio}</ul></section>`);
}

/** Uma coluna extra na grade (a coluna nova, o "+"): o html e a trilha dela. */
export interface ExtraDaGrade { html: Html; trilha: string; em?: number }

/** O quadro: as colunas numa grade que rola de lado; a tira recolhida é estreita. `extras` entram na posição `em` (ou no fim). */
export function quadro(o: { colunas: Coluna[]; rotulo?: string; antes?: Html; classe?: string; extras?: ExtraDaGrade[] }): Html {
  const itens: { html: string; trilha: string }[] = o.colunas.map((c) => ({ html: coluna(c), trilha: trilhaDaColuna(c) }));
  for (const x of [...(o.extras ?? [])].reverse()) itens.splice(Math.min(x.em ?? itens.length, itens.length), 0, { html: x.html, trilha: x.trilha });
  return h(`<div class="${cl("qd-quadro", o.classe && esc(o.classe))}" role="region" aria-label="${esc(o.rotulo ?? "Quadro")}">${o.antes ?? ""}` +
    `<div class="qd-grade" style="grid-template-columns: ${itens.map((i) => i.trilha).join(" ")}">${itens.map((i) => i.html).join("")}</div></div>`);
}

export type { Filtro } from "../lib/vista-do-quadro.ts";

/** NOD-460: um chip de agente da barra (o avatar, o nome e quantas tarefas ele tem no quadro). */
export interface ChipDaBarra { agenteId: string; avatar: Html; nome: string; n: number }
/** NOD-460: o Exibir (por pessoa e por quadro). `recolhidas` = mostrar as tiras das colunas recolhidas. */
export type ExibirDaBarra = { recolhidas: boolean; compacto: boolean; aberto?: boolean } & import("../../src/contracts/quadro-opcoes.ts").OpcoesDoQuadro;

const ICONE_BUSCA = svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', "qd-ic-busca", 15, 1.9);
const ICONE_EXIBIR = svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', "qd-ic-exibir", 15, 1.8);
const ICONE_CHECK = svg('<path d="m6 12.5 4 4 8-9"/>', "qd-ic-check", 14, 2.2);

/** O menu do Exibir: as duas caixas e a nota de onde vale. */
export function menuDoExibir(e: ExibirDaBarra, id = "qd-menu-exibir"): Html {
  const item = (chave: "recolhidas" | "compacto", rot: string, on: boolean): string =>
    `<button type="button" role="menuitemcheckbox" class="qd-menu-it" data-act="exibir-alternar" data-chave="${chave}" aria-checked="${on}"><span class="qd-caixa" aria-hidden="true">${on ? ICONE_CHECK : ""}</span>${rot}</button>`;
  return h(`<div class="qd-menu qd-menu-ex" id="${esc(id)}" role="menu" aria-label="Exibir">${item("recolhidas", "Colunas recolhidas", e.recolhidas)}${item("compacto", "Compacto", e.compacto)}` +
    `<p class="qd-menu-nota">Vale para você, neste quadro, em todo aparelho.</p></div>`);
}

/**
 * A barra do quadro. Sem `chips` é a de antes do quadro de verdade (só Todas). NOD-460: Todas · Comigo (n) · até 4
 * chips de agente (o resto no "+N") e, à direita, a busca ("/"), "n trabalhando" (que também filtra) e o Exibir.
 */
export function barra(o: { filtro: Filtro; trabalhando?: QuemRoda[]; curto?: boolean; extra?: Html; ajustes?: boolean; comigo?: number; chips?: ChipDaBarra[]; maisChips?: ChipDaBarra[]; maisAberto?: boolean; busca?: string; exibir?: ExibirDaBarra }): Html {
  const pressed = (k: Filtro): string => `aria-pressed="${o.filtro === k}"`;
  const n = (k: number): string => `<span class="qd-chip-n">${k}</span>`;
  const todas = `<button type="button" class="qd-filtro-bt qd-chip" data-act="filtro-do-quadro" data-filtro="todos" ${pressed("todos")}><span>Todas</span></button>`;
  // "Comigo (n)" fica sempre à vista, mesmo com 0 (revisão 2 do PR #645: o critério e o protótipo; o 0 já responde "o que é meu?").
  const comigo = o.comigo !== undefined
    ? `<button type="button" class="qd-filtro-bt qd-chip" data-act="filtro-do-quadro" data-filtro="comigo" ${pressed("comigo")} aria-label="${esc(`Comigo, ${o.comigo}`)}"><span>Comigo</span>${n(o.comigo)}</button>` : "";
  const chip = (c: ChipDaBarra): string => {
    const k = `agente:${c.agenteId}` as const;
    return `<button type="button" class="qd-filtro-bt qd-chip" data-act="filtro-do-quadro" data-filtro="${esc(k)}" ${pressed(k)} aria-label="${esc(`${c.nome}, ${c.n}`)}"><span class="qd-chip-av" aria-hidden="true">${emudecer(c.avatar)}</span><span class="qd-chip-nome">${esc(c.nome)}</span>${n(c.n)}</button>`;
  };
  const resto = o.maisChips ?? [];
  const mais = resto.length
    ? `<span class="qd-chip-mais-l"><button type="button" class="qd-filtro-bt qd-chip qd-chip-mais" data-act="filtro-mais-agentes" aria-haspopup="menu" aria-expanded="${!!o.maisAberto}"${o.maisAberto ? ' aria-controls="qd-menu-agentes"' : ""} aria-label="${esc(`Mais ${resto.length} ${resto.length === 1 ? "agente" : "agentes"}`)}">+${resto.length}</button>` +
      (o.maisAberto ? `<div class="qd-menu qd-menu-ag" id="qd-menu-agentes" role="menu" aria-label="Mais agentes">${resto.map((c) => `<button type="button" role="menuitemradio" class="qd-menu-it" data-act="filtro-do-quadro" data-filtro="${esc(`agente:${c.agenteId}`)}" aria-checked="false"><span class="qd-chip-av" aria-hidden="true">${emudecer(c.avatar)}</span><span class="qd-chip-nome">${esc(c.nome)}</span>${n(c.n)}</button>`).join("")}</div>` : "") + `</span>`
    : "";
  const filtros = `<div class="qd-filtros" role="group" aria-label="Filtrar tarefas">${todas}${comigo}${(o.chips ?? []).map(chip).join("")}${mais}</div>`;
  const quem = o.trabalhando ?? [];
  const avs = quem.map((q) => avatar({ ...q, estado: "rodando" })).join("");
  const k = quem.length;
  const frase = o.curto ? `${k} trabalhando` : k === 1 ? "1 agente trabalhando" : `${k} agentes trabalhando`;
  const pilha = `<span class="qd-avs qd-avs-pilha" aria-hidden="true">${avs}</span>`;
  // NOD-460: com o quadro de verdade (chips), "n trabalhando" é um filtro; antes dele, só o texto.
  const trab = !k && o.filtro !== "trabalhando" ? ""
    : o.chips ? `<button type="button" class="qd-trabalhando qd-trab" data-act="filtro-do-quadro" data-filtro="trabalhando" ${pressed("trabalhando")}>${pilha}${k ? `${k} trabalhando` : "Trabalhando"}</button>`
      : `<span class="qd-trabalhando">${pilha}${frase}</span>`;
  const busca = o.busca === undefined ? ""
    : `<span class="qd-busca-l"><label class="qd-busca">${ICONE_BUSCA}<span class="qd-sr">Buscar tarefa por título ou código</span>` +
      `<input type="search" id="qd-busca" class="qd-busca-in" data-campo="busca" placeholder="Buscar" value="${esc(o.busca)}" maxlength="200" autocomplete="off" spellcheck="false" aria-keyshortcuts="/">` +
      `${o.busca ? "" : `<kbd class="qd-kbd" title="Atalho: /" aria-hidden="true">/</kbd>`}</label>` +
      `${o.busca ? `<button type="button" class="qd-busca-limpar" data-act="busca-limpar" aria-label="Limpar busca">×</button>` : ""}</span>`;
  const e = o.exibir;
  const ajustada = !!e && (!e.recolhidas || e.compacto);
  const exibir = !e ? ""
    : `<span class="qd-exibir-l"><button type="button" class="qd-exibir" data-act="exibir-abrir" aria-haspopup="menu" aria-expanded="${!!e.aberto}"${e.aberto ? ' aria-controls="qd-menu-exibir"' : ""}${ajustada ? ' aria-label="Exibir (vista ajustada)"' : ""}>${ICONE_EXIBIR}<span>Exibir</span>${ajustada ? '<i class="qd-ponto" aria-hidden="true"></i>' : ""}</button>${e.aberto ? menuDoExibir(e) : ""}</span>`;
  // Só com o menu de ajustes ligado (NOD-421): botão sem ação não aparece.
  const ajustes = !o.ajustes ? "" : `<button type="button" class="qd-q-mais" aria-label="Ajustes do quadro" aria-haspopup="menu" aria-expanded="false">${ICONE.mais}</button>`;
  return h(`<div class="qd-barra-q">${filtros}${o.extra ?? ""}<span class="qd-barra-dir">${busca}${trab}${exibir}${ajustes}</span></div>`);
}

/** O selo do recurso em teste (decisão da NOD-343: o quadro nasce só para o Marlon). */
export function seloEmTeste(texto = "Em teste · só você vê", titulo = "Recurso em teste, liberado só para a sua conta"): Html {
  return h(`<span class="qd-flag" title="${esc(titulo)}">${esc(texto)}</span>`);
}

/* ---------- Celular: o quadro vira lista agrupada por estado ---------- */

export function linha(c: Card): Html {
  const av = avataresDoCard(c);
  const est = c.motivo ? `<span class="qd-l-est qd-e-bloqueado" title="${esc(`bloqueada: ${c.motivo}`)}">${ICONE.pausa}</span>` : "";
  const sel = !c.aviso && !c.motivo && c.estado === "rodando" ? seloTrabalhando(c.rodandoHa) : "";
  const fim = c.aviso ? aviso(c.aviso) : `${est}${sel}<span class="qd-id">${c.codigoHtml ?? esc(c.codigo ?? c.id)}</span>`;
  return h(`<li class="${cl("qd-l", c.menu && "qd-com-menu", c.aviso && "qd-com-aviso", c.classe && esc(c.classe))}" data-tarefa="${esc(c.id)}">` +
    `<button type="button" class="qd-l-bt" data-act="abrir-tarefa" data-id="${esc(c.id)}" aria-label="${esc(rotuloDoCard(c))}">${c.prioridade ?? ""}${av.html ? `<span class="qd-avs">${av.html}</span>` : ""}<span class="qd-l-tit">${c.tituloHtml ?? esc(c.titulo)}</span></button>` +
    `<span class="qd-l-fim">${c.espera && !c.aviso && !c.motivo ? chipDeEspera(c.espera) : perguntouDoCard(c)}${quandoDoCard(c)}${fim}</span>${botaoDeMover(c)}${c.menu ?? ""}${formDoResponder(c, "linha")}</li>`);
}

export function lista(o: { grupos: { status: string; nome: string; icone?: Status; pessoa?: boolean; avatar?: Html; linhas: Html[]; n?: number; recolhido?: boolean; vazio?: string }[]; rotulo?: string; novaTarefa?: boolean; antes?: Html }): Html {
  const g = o.grupos.map((gr) => {
    const n = gr.n ?? gr.linhas.length;
    const cab = `<h3 class="qd-lg-cab"><button type="button" class="qd-lg-bt" data-act="abrir-coluna" data-status="${esc(gr.status)}" aria-expanded="${!gr.recolhido}">${gr.avatar ? `<span class="qm-av qm-col-av" aria-hidden="true">${emudecer(gr.avatar)}</span>` : iconeDe(gr)}<span>${esc(gr.nome)}</span><span class="qd-n">${n}</span>${gr.recolhido ? ICONE.chev : ""}</button>` +
      `${gr.recolhido || !o.novaTarefa ? "" : `<button type="button" class="qd-lg-mais" data-act="col-nova-tarefa" data-status="${esc(gr.status)}" aria-label="${esc(`Nova tarefa em ${gr.nome}`)}">${ICONE.novo}</button>`}</h3>`;
    // Aberto e vazio diz que está vazio (como a coluna da grade), em vez de abrir nada; o vazio "" (NOD-460) não diz.
    const corpo = gr.linhas.length ? gr.linhas.join("") : gr.vazio === "" ? "" : `<li class="qd-col-vazio">${esc(gr.vazio ?? "Nada aqui")}</li>`;
    return `<section class="${cl("qd-lg", gr.recolhido && "qd-lg-recolhido")}" aria-label="${esc(gr.nome)}">${cab}${gr.recolhido ? "" : `<ul class="qd-lg-lista">${corpo}</ul>`}</section>`;
  }).join("");
  return h(`<div class="qd-lista" role="region" aria-label="${esc(o.rotulo ?? "Quadro")}">${o.antes ?? ""}${g}</div>`);
}

/* ---------- Conversa | Quadro dentro da pílula ---------- */

/**
 * O par Conversa | Quadro (alternativa A da v3). A ordem segue o gesto: o Quadro fica à direita e entra pela direita.
 *
 * O HTML não depende do modo (como o `aria-expanded` da pílula, revisão do PR 1 de 2026-10-16): quem marca o modo atual
 * (`data-atual`, `aria-selected` e `tabindex`) é web/lib/quadro-na-tela.ts, nos nós vivos. Assim a troca não regrava o
 * cabeçalho e o indicador DESLIZA (transição de CSS) em vez de saltar. O `modo` aqui é só o estado inicial do HTML.
 */
export function segmento(o: { nome: string; modo?: ModoDaConversa; compacto?: boolean }): Html {
  const atual = o.modo ?? "conversa";
  const aba = (m: ModoDaConversa, rot: string, ic: Html): string => {
    const s = m === atual;
    return `<button type="button" role="tab" class="qd-seg-bt" data-act="modo-da-conversa" data-modo="${m}" aria-selected="${s}" tabindex="${s ? 0 : -1}" id="qd-aba-${m}"${m === "quadro" ? ' aria-controls="quadro"' : ""} aria-label="${rot}">${ic}<span>${rot}</span></button>`;
  };
  return h(`<span class="${cl("qd-seg", o.compacto && "qd-seg-compacto")}" role="tablist" aria-label="${esc(`Ver ${o.nome} como`)}" data-atual="${atual}">` +
    `<i class="qd-seg-ind" aria-hidden="true"></i>${aba("conversa", "Conversa", ICONE.conversa)}${aba("quadro", "Quadro", ICONE.quadro)}</span>`);
}

/* ---------- O modo Quadro de uma conversa, antes dos dados (NOD-415) ---------- */

/**
 * O quadro de uma conversa sem tarefa nenhuma: a barra com o selo do teste, as colunas padrão (grade no computador) e a
 * lista por estado (celular); o CSS mostra uma ou outra. `alternadas` são as colunas que a pessoa abriu ou recolheu, ao
 * contrário do padrão (RECOLHIDAS_PADRAO): toda coluna e todo grupo alterna.
 */
export function quadroVazio(o: { nome: string; filtro?: Filtro; alternadas?: ReadonlySet<string> }): Html {
  const alternadas = o.alternadas ?? new Set<string>();
  const cols = colunasPadrao().map((c) => ({ ...c, recolhida: c.recolhida !== alternadas.has(c.status) }));
  const rotulo = `Quadro de ${o.nome}`;
  return juntar([
    barra({ filtro: o.filtro ?? "todos", extra: seloEmTeste() }),
    quadro({ colunas: cols.map((c) => ({ status: c.status, nome: c.nome, recolhida: c.recolhida, recolhivel: true })), rotulo, classe: "qd-so-largo" }),
    h(`<div class="qd-so-estreito">${lista({ rotulo, grupos: cols.map((c) => ({ status: c.status, nome: c.nome, linhas: [], recolhido: c.recolhida })) })}</div>`),
  ]);
}
