import type { Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { statusLinha } from "../lib/linha-config.ts";
import { emSelecao, estadoDeTodos, juntarNomes, previaDoLote, valorComum, type AcaoLote, type BotDoLote, type IaDoLote, type LoteAgentes, type ResultadoLote } from "../lib/lote-agentes.ts";
import { abertosDoBot } from "../lib/trabalhos.ts";
import { dataHora, esc } from "../lib/render.ts";
import { logoDaIa, PROVEDOR } from "./cartao-ia.ts";
import type { BotGerido } from "./gestao.ts";
import { conectada, iasDaTela, inteligenciaDoBot, motivoDoInventario } from "./inteligencia.ts";
import { maquinasDeTrabalho, statusDaMaquina } from "./maquinas.ts";

/**
 * NOD-368: o desenho da seleção e da troca em lote de Configurações › Agentes. Computador = NOD-367 v2 j5-6 a j5-10;
 * celular = NOD-368 v1 (≤720px, mesmo HTML, outro CSS). Sem fundo chapado e sem botão cheio: o confirmar é de contorno.
 */

const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;
const TRACO = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h8"/></svg>`;

/** A caixa: `role=checkbox` com rótulo; "mixed" desenha o traço (Selecionar todos com seleção parcial). */
export function caixaDoLote(marcada: "true" | "false" | "mixed", rotulo: string, acao: string, id?: string): string {
  const desenho = marcada === "true" ? CHECK : marcada === "mixed" ? TRACO : "";
  return `<button type="button" role="checkbox" aria-checked="${marcada}" aria-label="${esc(rotulo)}" class="lote-cb" data-act="${esc(acao)}"${id ? ` data-id="${esc(id)}"` : ""}><span class="lote-cb-caixa" aria-hidden="true">${desenho}</span></button>`;
}

// ---- valores de cada bot ----------------------------------------------------------------------------------------------

/** A máquina gravada do bot ("" = nenhuma: Qualquer uma, ou Este Mac com o servidor no Mac). É o que o PUT grava. */
export const maquinaGravada = (a: Pick<BotGerido, "maquinaId">): string => a.maquinaId ?? "";

/**
 * A IA gravada do bot: "auto" ou a IA fixa. Revisão 1: fixa numa IA fora do lote (dado legado: cursor, hermes) vira
 * "fixa:<id>", que nunca é igual a um destino — o bot muda e a barra mostra "várias" ou "Outra IA".
 */
export function iaGravada(a: Pick<BotGerido, "harness" | "modelo" | "esforco" | "inteligencia">): string {
  const i = inteligenciaDoBot(a);
  if (i.modo !== "fixa" || !i.fixa) return "auto";
  return i.fixa === "claude-cli" || i.fixa === "codex-cli" ? i.fixa : `fixa:${i.fixa}`;
}

const nomeSemMaquina = (estado: Pick<Estado, "maquinas">): string => (estado.maquinas?.servidorNoMac ? "Este Mac" : "Qualquer uma");

/** O nome de uma máquina pela chave; a que sumiu (chave revogada) cai em Qualquer uma, como no detalhe da linha. */
export function nomeDaMaquina(estado: Pick<Estado, "maquinas">, id: string): string {
  return (id && estado.maquinas?.maquinas.find((m) => m.id === id)?.nome) || nomeSemMaquina(estado);
}

export function nomeDaIa(ia: string): string {
  return ia === "auto" ? "Automático" : ia === "claude-cli" || ia === "codex-cli" ? PROVEDOR[ia].nome : "Outra IA";
}

/** "o Automático", "o Claude"; a máquina vai sem artigo ("vm-trabalho", "Qualquer uma"). */
const destinoComArtigo = (acao: AcaoLote, estado: Pick<Estado, "maquinas">): string => (acao.tipo === "ia" ? `o ${nomeDaIa(acao.destino)}` : nomeDaMaquina(estado, acao.destino));

/** Os bots marcados, com o valor de agora para a ação e se estão no meio de uma tarefa. */
export function botsDoLote(estado: Estado, bots: readonly BotGerido[], qual: "maquina" | "ia"): BotDoLote[] {
  const marcados = new Set(estado.configUi.lote.selecionados);
  return bots.filter((a) => marcados.has(a.id)).map((a) => ({
    id: a.id, nome: a.nome, valor: qual === "maquina" ? maquinaGravada(a) : iaGravada(a), ocupado: abertosDoBot(estado, a.id).length > 0,
  }));
}

// ---- opções do seletor ------------------------------------------------------------------------------------------------

export type OpcaoLote = { valor: string; nome: string; detalhe: string; icone: string; status?: { texto: string; tom: "ok" | "atencao" | "erro" | "neutro" }; desabilitada: boolean };

const NUVEM_QUE_ACORDA: ReadonlySet<string> = new Set(["acordada", "dormindo", "acordando", "criando"]);

/** Qualquer uma (ou Este Mac) e as máquinas de trabalho com o status; a offline fica desabilitada, com o motivo. */
export function opcoesDeMaquinaLote(estado: Estado): OpcaoLote[] {
  const lista = maquinasDeTrabalho(estado.maquinas?.maquinas ?? []);
  const padrao = lista.find((m) => m.id === estado.maquinas?.padraoId);
  const nenhuma: OpcaoLote = {
    valor: "", nome: nomeSemMaquina(estado), icone: "", desabilitada: false,
    detalhe: padrao ? `A máquina padrão, hoje ${padrao.nome}` : estado.maquinas?.servidorNoMac ? "O servidor neste Mac" : "A primeira máquina livre",
  };
  return [nenhuma, ...lista.map((m): OpcaoLote => {
    // A da nuvem que dorme (ou está acordando, ou sendo criada) acorda quando chega trabalho: escolhê-la vale. Revisão 5: a
    // excluída e a que não acordou não acordam sozinhas, então ficam desabilitadas como a offline, cada uma com o motivo.
    const acorda = !!m.nuvem && NUVEM_QUE_ACORDA.has(m.nuvem.estado);
    const desabilitada = !m.conectada && !acorda;
    const icone = m.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor;
    const motivo = m.nuvem?.estado === "excluida" ? "Excluída na sua conta Google: escolha outra"
      : m.nuvem?.estado === "falhou_ao_acordar" ? "Não acordou: confira em Máquinas"
      : `${m.ultimoUsoEm ? `Offline desde ${dataHora(m.ultimoUsoEm)}` : "Offline"}: reconecte para escolher`;
    return {
      valor: m.id, nome: m.nome, icone, status: statusDaMaquina(estado, m), desabilitada,
      detalhe: desabilitada ? motivo : m.nuvem ? "VM na nuvem" : m.plataforma === "darwin" ? "Mac" : m.plataforma === "win32" ? "Windows" : "Linux",
    };
  })];
}

/** Automático, Claude e ChatGPT. A IA não conectada fica desabilitada, com o motivo (o mesmo da ficha). */
export function opcoesDeIaLote(estado: Estado): OpcaoLote[] {
  const ias = iasDaTela(estado);
  const ctx = { ias, ui: estado.iasMac, agora: estado.agora };
  const auto: OpcaoLote = { valor: "auto", nome: "Automático", detalhe: "A primeira IA pronta da ordem", icone: ICONE.brilho, desabilitada: false };
  return [auto, ...(["claude-cli", "codex-cli"] as const).map((id): OpcaoLote => {
    const ia = ias.find((x) => x.id === id);
    const ok = !!ia && conectada(ia, ctx);
    return { valor: id, nome: PROVEDOR[id].nome, icone: logoDaIa(id, "lote-logo"), desabilitada: !ok, detalhe: ok ? "Uma IA só, com o modelo de cada bot" : (ia && motivoDoInventario(PROVEDOR[id].nome, ia.inventario)) || `${PROVEDOR[id].nome} não está conectado` };
  })];
}

/**
 * Revisão 1 (#6): o destino ainda vale? null = sim; senão a frase do motivo (a máquina caiu, a IA desconectou, a máquina
 * sumiu). Vale para o confirmar e para o Tentar de novo, que refaz a ação guardada minutos depois.
 */
export function motivoDoDestinoIndisponivel(estado: Estado, acao: AcaoLote): string | null {
  const opcoes = acao.tipo === "maquina" ? opcoesDeMaquinaLote(estado) : opcoesDeIaLote(estado);
  const op = opcoes.find((o) => o.valor === acao.destino);
  if (!op) return acao.tipo === "maquina" ? "a máquina não existe mais." : "essa IA não está disponível.";
  if (!op.desabilitada) return null;
  const d = op.detalhe.replace(/: (reconecte para escolher|escolha outra|confira em Máquinas)$/, "");
  return `${d.charAt(0).toLowerCase()}${d.slice(1)}${/[.!?]$/.test(d) ? "" : "."}`;
}

// ---- a prévia ---------------------------------------------------------------------------------------------------------

/** A prévia do seletor (j5-7/j5-9): quem passa, quem já está e o aviso de quem está no meio de uma tarefa. */
export function htmlDaPrevia(estado: Estado, acao: AcaoLote, bots: readonly BotDoLote[]): { html: string; mudam: number } {
  const { mudam, jaEstao, ocupados } = previaDoLote(bots, acao.destino);
  const destino = destinoComArtigo(acao, estado);
  const pronome = acao.tipo === "ia" ? "nele" : "nela";
  const linhas: string[] = [];
  if (mudam.length === 0) linhas.push(`<p>${bots.length === 1 ? `${esc(bots[0]!.nome)} já está` : "Todos já estão"} ${acao.tipo === "ia" ? "no" : "em"} <b>${esc(acao.tipo === "ia" ? nomeDaIa(acao.destino) : destino)}</b>.</p>`);
  else {
    const passa = mudam.length === 1 ? "passa" : "passam";
    const ja = jaEstao.length === 0 ? "" : ` ${esc(juntarNomes(jaEstao.map((b) => b.nome)))} já ${jaEstao.length === 1 ? "está" : "estão"} ${pronome}.`;
    linhas.push(`<p>${esc(juntarNomes(mudam.map((b) => b.nome)))} ${passa} para <b>${esc(destino)}</b>.${ja}</p>`);
  }
  if (ocupados.length > 0) {
    const um = ocupados.length === 1;
    linhas.push(`<p class="lote-aviso">${ICONE.alerta}<span>${esc(juntarNomes(ocupados.map((b) => b.nome)))} ${um ? "está" : "estão"} no meio de uma tarefa: para ${um ? "esse bot" : "esses bots"}, a troca vale a partir do próximo pedido.</span></p>`);
  }
  if (acao.tipo === "ia" && acao.destino === "auto" && mudam.length > 0) {
    linhas.push(`<p class="lote-aviso lote-aviso-mudo">${ICONE.info}<span>No Automático, cada um segue a ordem dele, ou a sua, em Provedores de IA.</span></p>`);
  }
  // Um espaço entre os parágrafos: o anúncio usa o textContent da prévia, e sem ele as frases se colam ("vm-qa.Bia está").
  return { html: linhas.join(" "), mudam: mudam.length };
}

// ---- o resultado na linha ---------------------------------------------------------------------------------------------

/** O texto do resultado (j5-8): "Agora em vm-trabalho"; para quem tinha tarefa, "vm-trabalho a partir do próximo pedido". */
export function textoDoResultado(estado: Pick<Estado, "maquinas">, acao: AcaoLote, ocupado: boolean): string {
  const nome = acao.tipo === "ia" ? nomeDaIa(acao.destino) : nomeDaMaquina(estado, acao.destino);
  if (ocupado) return `${nome} a partir do próximo pedido`;
  return acao.tipo === "ia" ? `Agora no ${nome}` : `Agora em ${nome}`;
}

export const textoMudando = (estado: Pick<Estado, "maquinas">, acao: AcaoLote): string => `Mudando para ${acao.tipo === "ia" ? `o ${nomeDaIa(acao.destino)}` : nomeDaMaquina(estado, acao.destino)}…`;

/** A mensagem na linha: neutra com ponto cinza; Mudando com o anel; erro com o motivo e Tentar de novo (só aquele bot). */
export function mensagemNaLinha(r: ResultadoLote | undefined, a: Pick<BotGerido, "id" | "nome">): string {
  if (!r) return "";
  if (r.estado === "erro") {
    return `<span class="lote-msg lote-msg-erro"><span>${esc(r.texto)}</span> <button type="button" class="lote-tentar" data-act="lote-tentar" data-id="${esc(a.id)}" aria-label="Tentar de novo com ${esc(a.nome)}">Tentar de novo</button></span>`;
  }
  if (r.estado === "mudando") return `<span class="lote-msg"><i class="lote-gira" aria-hidden="true"></i>${esc(r.texto)}</span>`;
  return `<span class="lote-msg">${statusLinha({ texto: r.texto, tom: "neutro" })}</span>`;
}

// ---- o topo e a barra -------------------------------------------------------------------------------------------------

/**
 * O topo da lista. No computador, a caixa "Selecionar todos" (aparece no foco e no hover; fica com a 1ª marcada). No
 * celular, "Selecionar" à direita; no modo seleção, "Selecionar todos" no lugar do ‹ e "Cancelar" (suposição aceita).
 */
export function topoDaSelecao(lote: LoteAgentes, visiveis: readonly string[]): string {
  // Revisão 4: sem visíveis (a busca não achou nada), o modo seleção ainda mostra o Cancelar (no celular, a única saída).
  if (visiveis.length === 0) return emSelecao(lote) ? `<div class="lote-cab ligado"><button type="button" class="lote-bt-texto lote-cancelar-topo" data-act="lote-cancelar">Cancelar</button></div>` : "";
  const todos = estadoDeTodos(lote.selecionados, visiveis);
  // Revisão 1: o nome do checkbox é estável; o estado sai do aria-checked ("Selecionar todos, marcado").
  const rotulo = "Selecionar todos";
  const ligado = emSelecao(lote);
  const caixa = `<button type="button" role="checkbox" aria-checked="${todos}" class="lote-cb lote-todos" data-act="lote-todos"><span class="lote-cb-caixa" aria-hidden="true">${todos === "true" ? CHECK : todos === "mixed" ? TRACO : ""}</span><span class="lote-todos-txt">${rotulo}</span></button>`;
  const selecionar = ligado ? "" : `<button type="button" class="lote-bt-texto lote-selecionar" data-act="lote-selecionar">Selecionar</button>`;
  const cancelar = ligado ? `<button type="button" class="lote-bt-texto lote-cancelar-topo" data-act="lote-cancelar">Cancelar</button>` : "";
  return `<div class="lote-cab${ligado ? " ligado" : ""}">${caixa}${selecionar}${cancelar}</div>`;
}

/** A contagem da barra; é dita pelo nó fixo #anuncio-config (main.ts), porque um role=status recriado não é lido com confiança. */
export const textoDaContagem = (n: number): string => (n === 0 ? "Nenhum selecionado" : `${n} ${n === 1 ? "selecionado" : "selecionados"}`);

/** A barra de lote presa ao pé (j5-6, j2-4 do celular): contagem anunciada, as duas ações com o valor de agora, Cancelar. */
export function barraDoLote(estado: Estado, bots: readonly BotGerido[]): string {
  const lote = estado.configUi.lote;
  if (!emSelecao(lote)) return "";
  const maquinas = botsDoLote(estado, bots, "maquina");
  // Conta pelos que existem: o bot excluído ou oculto noutra aba sai da conta sem esperar o Cancelar.
  const n = maquinas.length;
  const ias = botsDoLote(estado, bots, "ia");
  const maqComum = valorComum(maquinas.map((b) => b.valor));
  const iaComum = valorComum(ias.map((b) => b.valor));
  const valorMaq = n === 0 ? "" : maqComum === null ? "várias" : nomeDaMaquina(estado, maqComum);
  const valorIa = n === 0 ? "" : iaComum === null ? "várias" : nomeDaIa(iaComum);
  const parado = n === 0 || lote.mudando;
  const contagem = textoDaContagem(n);
  const acao = (qual: "maquina" | "ia", rotulo: string, icone: string, valor: string) =>
    `<button type="button" class="lote-bt lote-bt-${qual}" data-act="lote-abrir" data-qual="${qual}" aria-haspopup="dialog" aria-expanded="${lote.aberto === qual}"${parado ? ' aria-disabled="true"' : ""}>${icone}<span>${rotulo}${valor ? `<small>${esc(valor)}</small>` : ""}</span></button>`;
  const seletor = lote.aberto ? seletorDoLote(estado, bots, lote.aberto) : "";
  return `<div class="lote-barra" role="region" aria-label="Ações para os selecionados">${seletor}<span class="lote-n">${contagem}</span><span class="lote-barra-acoes">${acao("maquina", "Mudar máquina", ICONE.servidor, valorMaq)}${acao("ia", "Mudar IA", ICONE.brilho, valorIa)}</span><button type="button" class="lote-bt-texto lote-cancelar" data-act="lote-cancelar">Cancelar</button></div>`;
}

/** O seletor com prévia (popover no computador, folha presa à base no celular). */
export function seletorDoLote(estado: Estado, bots: readonly BotGerido[], qual: "maquina" | "ia"): string {
  const lote = estado.configUi.lote;
  const marcados = botsDoLote(estado, bots, qual);
  const opcoes = qual === "maquina" ? opcoesDeMaquinaLote(estado) : opcoesDeIaLote(estado);
  const n = marcados.length;
  const titulo = qual === "maquina" ? `Mudar a máquina de ${n} ${n === 1 ? "bot" : "bots"}` : `Mudar a IA de ${n} ${n === 1 ? "bot" : "bots"}`;
  const escolhida = opcoes.find((o) => o.valor === lote.escolha && !o.desabilitada) ?? null;
  const ops = opcoes.map((o) => {
    const marcada = escolhida?.valor === o.valor;
    return `<button type="button" role="radio" aria-checked="${marcada}" class="lc-linha lote-op${o.desabilitada ? " lote-op-off" : ""}" data-act="lote-escolher" data-valor="${esc(o.valor)}"${o.desabilitada ? ' aria-disabled="true"' : ""}><span class="lote-radio" aria-hidden="true"></span>${o.icone ? `<span class="lc-ic" aria-hidden="true">${o.icone}</span>` : ""}<span class="lc-txt"><b>${esc(o.nome)}</b><small>${esc(o.detalhe)}</small></span>${o.status ? statusLinha(o.status) : ""}</button>`;
  }).join("");
  const acao: AcaoLote | null = escolhida ? (qual === "maquina" ? { tipo: "maquina", destino: escolhida.valor } : { tipo: "ia", destino: escolhida.valor as IaDoLote }) : null;
  const previa = acao ? htmlDaPrevia(estado, acao, marcados) : { html: `<p>Escolha ${qual === "maquina" ? "a máquina" : "a IA"} para ver o que muda.</p>`, mudam: 0 };
  const conf = previa.mudam > 0 ? `Mudar ${previa.mudam} ${previa.mudam === 1 ? "bot" : "bots"}` : "Mudar";
  return `<div class="lote-pop" role="dialog" aria-modal="false" aria-labelledby="lote-pop-tit"><h3 id="lote-pop-tit">${titulo}</h3><div class="lote-ops" role="radiogroup" aria-labelledby="lote-pop-tit">${ops}</div><div class="lote-previa">${previa.html}</div><div class="lote-pop-acoes"><button type="button" class="lote-bt-texto" data-act="lote-fechar">Cancelar</button><button type="button" class="lote-conf" data-act="lote-confirmar"${previa.mudam === 0 ? " disabled" : ""}>${conf}</button></div></div>`;
}
