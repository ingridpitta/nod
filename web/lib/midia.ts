import type { AnexoDaConversa, MotivoRecusaMidia, RecusasMidia } from "../../src/contracts/anexo.ts";
import { renderCardArquivo, tamanhoHumano } from "./anexos.ts";
import { familiaDoArquivo, iconeDoArquivo } from "./icones-arquivo.ts";
import { esc } from "./escape.ts";

/**
 * NOD-323 (ADR-126, protótipo v3.1): a mídia que o bot anexou, ABAIXO do balão da fala, na ordem anexada. Render puro
 * (string), sem estado global: quem desenha passa o que precisa (a url, o nome do bot, se é o app do Mac nesta máquina,
 * os GIFs pausados). O comportamento (tela cheia, GIF, áudio, erro) mora em `midia-dom.ts` e `telas/luz.ts`, por
 * delegação de `data-act` — o HTML é o mesmo a cada redesenho, então o bloco da mensagem não é refeito à toa.
 * Espelho de `src/contracts/anexo.ts` nos limites: a web só importa TIPOS de src/ (tests/unit/web/midia.test.ts confere).
 */

export type FamiliaWeb = "imagem" | "gif" | "video" | "audio" | "arquivo";

const MIB = 1024 * 1024;
export const LIMITE_WEB: Record<"imagem" | "video" | "audio" | "arquivo", number> = { imagem: 20 * MIB, video: 50 * MIB, audio: 25 * MIB, arquivo: 20 * MIB };

export function familiaWeb(mime: string): FamiliaWeb {
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "arquivo";
}

export type OpcoesMidia = {
  url: (id: string) => string;
  /** O nome do bot que falou ("Fica na pasta do Chico"); sem nome, "do bot". */
  bot?: string;
  /** O id da máquina deste app do Mac; null no navegador e no celular (sem Finder). */
  esteMac?: string | null;
  /** GIFs em que a pessoa trocou o padrão (pausou, ou soltou com movimento reduzido); sobrevivem ao redesenho. */
  gifsPausados?: ReadonlySet<string>;
  /** Reduzir movimento ligado no sistema: o GIF abre parado. */
  reduzirMovimento?: boolean;
  /** Os arquivos grandes que o app do Mac conferiu e não estão mais na pasta do bot (j5-5). */
  sumiram?: ReadonlySet<string>;
};

/**
 * O que a mídia lembra entre redesenhos, fora do `Estado` (não muda o que o servidor manda): os GIFs pausados, o id da
 * máquina deste app do Mac (o desktop diz no boot) e o movimento reduzido do sistema. `midia-dom.ts` mantém em dia.
 */
export const lembrancaDaMidia: { gifsPausados: Set<string>; esteMac: string | null; reduzirMovimento: boolean; sumiram: Set<string>; conferidos: Set<string> } = {
  gifsPausados: new Set(), esteMac: null, reduzirMovimento: false, sumiram: new Set(), conferidos: new Set(),
};

/** Item da tela cheia: o que a luz precisa para mostrar e navegar, sem ler o DOM de novo. */
export type ItemLuz = { id: string; nome: string; mime: string; url: string; w?: number; h?: number; dur?: number; mac?: string };

const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSA = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const PLAY_P = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const AVISO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>';
const GIRO = '<span class="msg-midia-giro" aria-hidden="true"><span class="ob-gira"></span></span>';

/** `m:ss` (ou `h:mm:ss`) de uma duração em ms; null sem duração. */
export function duracaoHumana(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

const proporcao = (a: AnexoDaConversa, padrao: number): number => (a.largura && a.altura ? a.largura / a.altura : padrao);
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** A imagem única cabe em 400 × 400 na proporção real (o tamanho vem do arquivo), nunca recortada. */
function larguraUnica(a: AnexoDaConversa): number {
  const ar = proporcao(a, 4 / 3);
  const caixa = Math.min(400, 400 * ar);
  return Math.round(Math.min(a.largura ?? caixa, caixa));
}

function botaoImagem(a: AnexoDaConversa, o: OpcoesMidia, i: number, classe: string, extra = "", conteudo?: string): string {
  const alt = `Imagem: ${a.nome}`;
  const tamanho = a.largura && a.altura ? ` width="${a.largura}" height="${a.altura}"` : "";
  const img = conteudo ?? `<img src="${esc(o.url(a.id))}" alt="${esc(alt)}" loading="lazy" decoding="async" draggable="false"${tamanho} data-midia-img />`;
  return `<button type="button" class="${classe}" data-act="midia-abrir" data-anexo-id="${esc(a.id)}" data-i="${i}" aria-haspopup="dialog"${extra}>${GIRO}${img}</button>`;
}

/** GIF: anima na conversa e tem Pausar (WCAG 2.2.2); parado (pela pessoa ou pelo movimento reduzido), o 1º quadro num canvas. */
function gif(a: AnexoDaConversa, o: OpcoesMidia, i: number, classeBt: string): string {
  // Pausar/Reproduzir da pessoa vale mais que o padrão: "Reproduzir" com movimento reduzido fica no conjunto como "tocando".
  const escolheu = o.gifsPausados?.has(a.id) === true;
  const parado = o.reduzirMovimento === true ? !escolheu : escolheu;
  const tamanho = a.largura && a.altura ? ` width="${a.largura}" height="${a.altura}"` : "";
  // eager: o quadro parado precisa do arquivo carregado, mesmo com o <img> invisível.
  const conteudo = `<img src="${esc(o.url(a.id))}" alt="${esc(`GIF: ${a.nome}`)}" decoding="async" draggable="false"${tamanho} data-midia-img data-gif /><canvas class="msg-midia-quadro" aria-hidden="true"></canvas>`;
  const ctl = `<button type="button" class="msg-midia-gif-ctl" data-act="midia-gif" data-anexo-id="${esc(a.id)}" aria-pressed="${parado ? "true" : "false"}" aria-label="${parado ? "Reproduzir" : "Pausar"} ${esc(a.nome)}">${parado ? PLAY_P : PAUSA}<span>${parado ? "Reproduzir" : "Pausar"}</span><b>GIF</b></button>`;
  return `<div class="msg-midia-gif${parado ? " parado" : ""}" style="--w:${larguraUnica(a)}px;--ar:${num(proporcao(a, 1))};--r:${num(proporcao(a, 1))}">${botaoImagem(a, o, i, `msg-midia-bt${classeBt}`, "", conteudo)}${ctl}</div>`;
}

/** Imagens e GIFs: 1 na proporção real; 2–3 de mesma proporção em grade quadrada; mistas na linha de 180 px; 4+ três e "+N". */
function galeria(itens: { a: AnexoDaConversa; i: number }[], o: OpcoesMidia): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) {
    const { a, i } = itens[0]!;
    if (familiaWeb(a.mime) === "gif") return gif(a, o, i, "");
    return `<figure class="msg-midia-img" style="--w:${larguraUnica(a)}px;--ar:${num(proporcao(a, 4 / 3))}">${botaoImagem(a, o, i, "msg-midia-bt")}</figure>`;
  }
  const ars = itens.map(({ a }) => proporcao(a, 1));
  const mesma = ars.every((r) => Math.abs(r - ars[0]!) / ars[0]! < 0.02);
  if (itens.length <= 3 && !mesma) {
    const soma = ars.reduce((s, r) => s + r, 0);
    const celulas = itens.map(({ a, i }, k) => {
      const r = num(ars[k]!);
      const borda = " msg-midia-borda";
      return familiaWeb(a.mime) === "gif" ? gif(a, o, i, borda) : `<div class="msg-midia-cel-linha" style="--r:${r};--ar:${r}">${botaoImagem(a, o, i, `msg-midia-bt${borda}`)}</div>`;
    }).join("");
    return `<div class="msg-midia-linha" style="--n:${itens.length};--soma:${num(soma)}">${celulas}</div>`;
  }
  const k = Math.min(itens.length, 3);
  const mostradas = itens.slice(0, 3);
  const resto = itens.length - 2;
  const celulas = mostradas.map(({ a, i }, j) => {
    const mais = itens.length > 3 && j === 2;
    const extra = mais ? ` aria-label="${esc(`Ver as outras ${resto} imagens`)}"` : "";
    // Na grade o GIF fica no 1º quadro (o quadrado é só a prévia): anima na tela cheia.
    const conteudo = `<img src="${esc(o.url(a.id))}" alt="${mais ? "" : esc(`Imagem: ${a.nome}`)}" loading="lazy" decoding="async" draggable="false" data-midia-img${familiaWeb(a.mime) === "gif" ? " data-gif data-gif-grade" : ""} />${familiaWeb(a.mime) === "gif" ? '<canvas class="msg-midia-quadro" aria-hidden="true"></canvas>' : ""}${mais ? `<span class="msg-midia-mais" aria-hidden="true">+${resto}</span>` : ""}`;
    return botaoImagem(a, o, i, `msg-midia-cel msg-midia-borda${familiaWeb(a.mime) === "gif" ? " parado" : ""}${mais ? " tem-mais" : ""}`, extra, conteudo);
  }).join("");
  return `<div class="msg-midia-grade" style="--k:${k}">${celulas}</div>`;
}

/** Vídeo na conversa: só a capa (o 1º quadro), o ▶ e a duração; o player aparece em tela cheia. */
function video(a: AnexoDaConversa, o: OpcoesMidia, i: number): string {
  const dur = duracaoHumana(a.duracaoMs);
  const rotulo = `Assistir ${a.nome}${dur ? `, ${dur}` : ""}`;
  // #t=0.1: o iOS só desenha a capa com um instante pedido.
  return `<button type="button" class="msg-midia-vid" data-act="midia-abrir" data-anexo-id="${esc(a.id)}" data-i="${i}" aria-haspopup="dialog" aria-label="${esc(rotulo)}" style="--ar:${num(proporcao(a, 16 / 9))}"><video src="${esc(o.url(a.id))}#t=0.1" preload="metadata" muted playsinline tabindex="-1" aria-hidden="true" data-midia-img></video><span class="msg-midia-play">${PLAY}</span>${dur ? `<span class="msg-midia-dur">${esc(dur)}</span>` : ""}</button>`;
}

/** Áudio: o memo de voz (play | 1×, a trilha e o tempo), sem onda nesta PR (a onda real é da NOD-329). Toca ali mesmo. */
function audio(a: AnexoDaConversa, o: OpcoesMidia): string {
  const dur = duracaoHumana(a.duracaoMs) ?? "0:00";
  return `<div class="msg-memo" data-memo="${esc(a.id)}"><div class="memo-linha"><div class="memo-pilula"><button type="button" class="memo-play" data-act="midia-audio" data-anexo-id="${esc(a.id)}" aria-label="${esc(`Reproduzir ${a.nome}`)}">${PLAY_P}</button><button type="button" class="memo-vel" data-act="midia-audio-vel" data-anexo-id="${esc(a.id)}" aria-label="Velocidade 1×">1×</button></div><input type="range" class="memo-trilha" min="0" max="1000" step="1" value="0" data-act-input="midia-audio-ir" data-anexo-id="${esc(a.id)}" aria-label="${esc(`Posição em ${a.nome}`)}" aria-valuetext="0:00 de ${esc(dur)}" /><span class="memo-tempo" aria-hidden="true">${esc(dur)}</span></div><audio src="${esc(o.url(a.id))}" preload="metadata" data-midia-img></audio></div>`;
}

const ROTULO_FAMILIA: Record<FamiliaWeb, string> = { imagem: "imagem", gif: "imagem", video: "vídeo", audio: "áudio", arquivo: "arquivo" };

/**
 * Grande demais (j5-3/j5-4): os bytes ficaram na máquina. No app do Mac onde o bot roda, Mostrar no Finder; fora dele,
 * onde o arquivo está. O app confere depois se o arquivo ainda existe (j5-5, `midia-dom.ts`).
 */
function cartaoGrande(a: AnexoDaConversa, o: OpcoesMidia): string {
  if (o.sumiram?.has(a.id)) return cartaoSumiu(a.nome, o.bot);
  const fam = familiaWeb(a.mime);
  const limite = LIMITE_WEB[fam === "gif" ? "imagem" : fam];
  const icone = iconeDoArquivo(fam === "arquivo" ? familiaDoArquivo(a.mime, a.nome) : fam === "imagem" || fam === "gif" ? "imagem" : "outro");
  const detalhe = `${tamanhoHumano(a.tamanho)} · passa do limite de ${Math.round(limite / MIB)} MB para ${ROTULO_FAMILIA[fam]} no chat`;
  const doBot = o.bot ? `do ${o.bot}` : "do bot";
  const aqui = !!o.esteMac && a.maquina?.id === o.esteMac;
  const acao = aqui
    ? `<button type="button" class="bt link sm msg-midia-card-acao" data-act="midia-finder" data-anexo-id="${esc(a.id)}">Mostrar no Finder</button>`
    : `<span class="msg-midia-card-onde">Fica na pasta ${esc(doBot)}${a.maquina ? ` no ${esc(a.maquina.nome)}` : ""}.</span>`;
  const local = aqui ? ` data-midia-local="1" data-midia-url="${esc(o.url(a.id))}"${o.bot ? ` data-bot="${esc(o.bot)}"` : ""}` : "";
  return `<div class="msg-arquivo alto" data-anexo-id="${esc(a.id)}"${local}><div class="msg-arquivo-abrir">${icone}<span class="anexo-info"><b>${esc(a.nome)}</b><span>${esc(detalhe)}</span>${acao}</span></div></div>`;
}

/** O cartão de quando o arquivo grande saiu da pasta do bot (j5-5): tracejado, apagado, sem Baixar. */
export function cartaoSumiu(nome: string, bot?: string): string {
  return `<div class="msg-arquivo alto mudo"><div class="msg-arquivo-abrir">${iconeDoArquivo("outro")}<span class="anexo-info"><b>${esc(nome)}</b><span>Não está mais na pasta ${esc(bot ? `do ${bot}` : "do bot")}.</span></span></div></div>`;
}

/**
 * O lugar de uma mídia que não carregou (j5-2): o mesmo tamanho, o motivo e Tentar de novo. Dentro do botão da mídia não
 * cabe outro botão: lá o "Tentar de novo" é só o desenho e o próprio botão (que ganha o rótulo) tenta de novo; fora (o memo),
 * é um botão de verdade, alcançável pelo teclado.
 */
export function htmlErroMidia(dentroDeBotao: boolean): string {
  const acao = dentroDeBotao
    ? '<span class="bt link sm" aria-hidden="true">Tentar de novo</span>'
    : '<button type="button" class="bt link sm" data-act="midia-tentar">Tentar de novo</button>';
  return `<span class="msg-midia-erro" role="status">${AVISO}<span>Não carregou.</span>${acao}</span>`;
}

/** A mídia que o bot anexou e o que a tela cheia navega. Vazio quando a fala não tem mídia do bot. */
export function renderMidiasDoBot(anexos: readonly AnexoDaConversa[], o: OpcoesMidia): string {
  const doBot = anexos.filter((a) => a.origem === "bot");
  if (doBot.length === 0) return "";
  const luz: ItemLuz[] = [];
  const naLuz = (a: AnexoDaConversa): number => {
    luz.push({ id: a.id, nome: a.nome, mime: a.mime, url: o.url(a.id), ...(a.largura ? { w: a.largura } : {}), ...(a.altura ? { h: a.altura } : {}), ...(a.duracaoMs !== undefined ? { dur: a.duracaoMs } : {}), ...(a.maquina ? { mac: a.maquina.id } : {}) });
    return luz.length - 1;
  };
  const imagens: { a: AnexoDaConversa; i: number }[] = [];
  const videos: string[] = [];
  const audios: string[] = [];
  const cartoes: string[] = [];
  for (const a of doBot) {
    const fam = familiaWeb(a.mime);
    if (a.semBytes) cartoes.push(cartaoGrande(a, o));
    else if (fam === "imagem" || fam === "gif") imagens.push({ a, i: naLuz(a) });
    else if (fam === "video") videos.push(video(a, o, naLuz(a)));
    else if (fam === "audio") audios.push(audio(a, o));
    else cartoes.push(renderCardArquivo(a, o.url(a.id)));
  }
  const corpo = galeria(imagens, o) + videos.join("") + audios.join("") + (cartoes.length ? `<div class="msg-arquivos">${cartoes.join("")}</div>` : "");
  return `<div class="msg-midias" data-luz="${esc(JSON.stringify(luz))}">${corpo}</div>`;
}

/** Os ids que "Baixar tudo" baixa: só a mídia do bot com bytes no nod. */
export function baixaveis(anexos: readonly AnexoDaConversa[]): AnexoDaConversa[] {
  return anexos.filter((a) => a.origem === "bot" && !a.semBytes);
}

/** O texto da linha discreta (j5-6), por código e com plural. Espelho de `TEXTO_RECUSA` do domínio, que é do servidor. */
const TEXTO_RECUSA_WEB: Record<MotivoRecusaMidia, [string, string]> = {
  fora_da_pasta: ["fica fora da pasta {bot}", "ficam fora da pasta {bot}"],
  credencial: ["é um arquivo de credencial", "são arquivos de credencial"],
  nao_existe: ["não foi encontrado", "não foram encontrados"],
  nao_e_arquivo: ["não é um arquivo", "não são arquivos"],
  tipo_nao_suportado: ["é de um tipo que o chat não mostra", "são de um tipo que o chat não mostra"],
  vazio: ["está vazio", "estão vazios"],
  falha_envio: ["não chegou ao nod", "não chegaram ao nod"],
  limite_por_turno: ["passou do limite por resposta", "passaram do limite por resposta"],
};
export const MOTIVOS_RECUSA_WEB = Object.keys(TEXTO_RECUSA_WEB) as MotivoRecusaMidia[];

/** "1 arquivo não foi anexado: fica fora da pasta do Chico." — sem caminho nenhum (o chat não mostra caminho da máquina). */
export function textoRecusas(recusas: RecusasMidia | undefined, bot?: string): string | null {
  const validas = (recusas ?? []).filter((r) => TEXTO_RECUSA_WEB[r.motivo] && r.n > 0);
  if (validas.length === 0) return null;
  const doBot = bot ? `do ${bot}` : "do bot";
  const frase = (r: { motivo: MotivoRecusaMidia; n: number }) => TEXTO_RECUSA_WEB[r.motivo][r.n === 1 ? 0 : 1].replace("{bot}", doBot);
  const total = validas.reduce((s, r) => s + r.n, 0);
  const cabeca = total === 1 ? "1 arquivo não foi anexado" : `${total} arquivos não foram anexados`;
  if (validas.length === 1) return `${cabeca}: ${frase(validas[0]!)}.`;
  return `${cabeca}: ${validas.map((r) => `${r.n} ${frase(r)}`).join("; ")}.`;
}

export function linhaRecusas(recusas: RecusasMidia | undefined, bot?: string): string {
  const t = textoRecusas(recusas, bot);
  return t ? `<p class="msg-midia-recusado">${AVISO}<span>${esc(t)}</span></p>` : "";
}
