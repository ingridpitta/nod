import type { PonteMidia } from "../../src/contracts/midia-desktop.ts";
import { cartaoSumiu, duracaoHumana, htmlErroMidia, lembrancaDaMidia } from "./midia.ts";
import { rotuloVel, proximaVel } from "../telas/luz-html.ts";

/**
 * NOD-323: o lado vivo da mídia do bot na conversa (o HTML é puro, em midia.ts). Tudo por delegação no document, porque a
 * conversa redesenha por blocos: carregou/falhou (o giro some; a falha mostra "Não carregou" e Tentar de novo), o 1º
 * quadro do GIF parado num canvas, Pausar/Reproduzir do GIF, o memo de áudio (play, 1×, a trilha), um tocando por vez
 * e, no app do Mac, a conferência de que o arquivo grande ainda está na pasta do bot.
 */

const PLAY_P = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

/** Desenha o 1º quadro do GIF no canvas ao lado (o GIF parado mostra o canvas, não o <img> que anima). */
export function desenharQuadro(img: HTMLImageElement): void {
  const canvas = img.parentElement?.querySelector<HTMLCanvasElement>(".msg-midia-quadro");
  if (!canvas || !img.naturalWidth) return;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  try {
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    canvas.dataset.pronto = "1";
  } catch {
    // Sem o quadro (canvas indisponível): o GIF parado mostra o próprio <img>.
  }
}

function aoCarregar(ev: Event): void {
  const el = ev.target as HTMLElement;
  if (!(el instanceof HTMLElement) || !el.matches("[data-midia-img]")) return;
  el.dataset.ok = "1";
  el.closest(".msg-midia-bt, .msg-midia-cel, .msg-midia-vid")?.classList.add("carregou");
  if (el instanceof HTMLImageElement && el.matches("[data-gif]")) desenharQuadro(el);
  if (el instanceof HTMLAudioElement) atualizarMemo(el);
}

function aoFalhar(ev: Event): void {
  const el = ev.target as HTMLElement;
  if (!(el instanceof HTMLElement) || !el.matches("[data-midia-img]")) return;
  const caixa = el.closest<HTMLElement>(".msg-midia-bt, .msg-midia-cel, .msg-midia-vid, .msg-memo");
  if (!caixa || caixa.querySelector(".msg-midia-erro")) return;
  caixa.classList.add("falhou");
  const botao = caixa.matches("button");
  if (botao) {
    caixa.dataset.rotuloOk = caixa.getAttribute("aria-label") ?? "";
    caixa.setAttribute("aria-label", `Não carregou. Tentar de novo${caixa.dataset.rotuloOk ? `: ${caixa.dataset.rotuloOk}` : ""}`);
    caixa.removeAttribute("aria-haspopup");
  }
  caixa.insertAdjacentHTML("beforeend", htmlErroMidia(botao));
}

/** "Tentar de novo": pede o arquivo outra vez (com um marcador na URL, para não vir do cache da falha). */
export function tentarDeNovo(gatilho: HTMLElement): void {
  const caixa = gatilho.closest<HTMLElement>(".falhou");
  const el = caixa?.querySelector<HTMLImageElement | HTMLMediaElement>("[data-midia-img]");
  if (!caixa || !el) return;
  caixa.querySelector(".msg-midia-erro")?.remove();
  caixa.classList.remove("falhou");
  if (caixa.dataset.rotuloOk !== undefined) {
    if (caixa.dataset.rotuloOk) caixa.setAttribute("aria-label", caixa.dataset.rotuloOk);
    else caixa.removeAttribute("aria-label");
    caixa.setAttribute("aria-haspopup", "dialog");
    delete caixa.dataset.rotuloOk;
  }
  const base = (el.getAttribute("src") ?? "").replace(/([?&])tentativa=\d+/, "").replace(/[?&]$/, "");
  const [semHash, hash] = base.split("#");
  el.setAttribute("src", `${semHash}${semHash!.includes("?") ? "&" : "?"}tentativa=${Date.now()}${hash ? `#${hash}` : ""}`);
  if (el instanceof HTMLMediaElement) el.load();
}

/** Pausar/Reproduzir o GIF na conversa; a escolha atravessa o redesenho (lembrancaDaMidia.gifsPausados). */
export function alternarGif(bt: HTMLElement): void {
  const id = bt.dataset.anexoId ?? "";
  const caixa = bt.closest<HTMLElement>(".msg-midia-gif");
  if (!caixa || !id) return;
  const parado = !caixa.classList.contains("parado");
  const p = lembrancaDaMidia.gifsPausados;
  // A lembrança guarda a escolha CONTRA o padrão (com movimento reduzido, o padrão é parado).
  if (parado !== lembrancaDaMidia.reduzirMovimento) p.add(id);
  else p.delete(id);
  caixa.classList.toggle("parado", parado);
  const img = caixa.querySelector<HTMLImageElement>("img[data-gif]");
  if (parado && img?.complete) desenharQuadro(img);
  const nome = (img?.alt ?? "").replace(/^GIF: /, "");
  bt.setAttribute("aria-pressed", parado ? "true" : "false");
  bt.setAttribute("aria-label", `${parado ? "Reproduzir" : "Pausar"} ${nome}`);
  bt.innerHTML = `${parado ? PLAY_P : PAUSA}<span>${parado ? "Reproduzir" : "Pausar"}</span><b>GIF</b>`;
}

const audioDe = (el: HTMLElement): HTMLAudioElement | null => el.closest(".msg-memo")?.querySelector("audio") ?? null;

export function alternarAudio(bt: HTMLElement): void {
  const a = audioDe(bt);
  if (!a) return;
  if (a.paused) void a.play().catch(() => undefined);
  else a.pause();
}

export function velocidadeDoAudio(bt: HTMLElement): void {
  const a = audioDe(bt);
  if (!a) return;
  a.playbackRate = proximaVel(a.playbackRate);
  bt.textContent = rotuloVel(a.playbackRate);
  bt.setAttribute("aria-label", `Velocidade ${rotuloVel(a.playbackRate)}`);
}

export function irNoAudio(trilha: HTMLInputElement): void {
  const a = audioDe(trilha);
  if (!a || !Number.isFinite(a.duration)) return;
  a.currentTime = (Number(trilha.value) / 1000) * a.duration;
}

/** O memo acompanha o áudio: o ícone, a trilha (--p e aria-valuetext) e o tempo. */
export function atualizarMemo(a: HTMLAudioElement): void {
  const memo = a.closest(".msg-memo");
  if (!memo) return;
  const total = Number.isFinite(a.duration) ? a.duration * 1000 : 0;
  const agora = duracaoHumana(a.currentTime * 1000) ?? "0:00";
  const fim = duracaoHumana(total) ?? "0:00";
  const p = total > 0 ? (a.currentTime * 1000) / total : 0;
  const trilha = memo.querySelector<HTMLInputElement>(".memo-trilha");
  if (trilha) {
    trilha.value = String(Math.round(p * 1000));
    trilha.style.setProperty("--p", `${p * 100}%`);
    trilha.setAttribute("aria-valuetext", `${agora} de ${fim}`);
  }
  const tempo = memo.querySelector(".memo-tempo");
  if (tempo) tempo.textContent = a.paused && a.currentTime === 0 ? fim : agora;
  const play = memo.querySelector<HTMLElement>(".memo-play");
  if (play) {
    play.innerHTML = a.paused ? PLAY_P : PAUSA;
    const nome = (play.getAttribute("aria-label") ?? "").replace(/^(Reproduzir|Pausar) /, "");
    play.setAttribute("aria-label", `${a.paused ? "Reproduzir" : "Pausar"} ${nome}`);
  }
  memo.classList.toggle("tocando", !a.paused);
}

function aoMudarAudio(ev: Event): void {
  const m = ev.target;
  if (!(m instanceof HTMLMediaElement)) return;
  // Um tocando por vez: o áudio (ou o vídeo da tela cheia) que começa pausa os outros.
  if (ev.type === "play") document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((o) => { if (o !== m && !o.muted && !o.paused) o.pause(); });
  if (m instanceof HTMLAudioElement) atualizarMemo(m);
}

export type OpcoesMidiaDom = {
  ponte?: PonteMidia;
  /** O caminho relativo da mídia na máquina (a API `.../local`), ou null. */
  local: (url: string) => Promise<string | null>;
  /** Redesenha a conversa (a lembrança mudou). */
  redesenhar: () => void;
};

/** O arquivo grande deste Mac ainda está na pasta do bot? Confere uma vez por anexo; o que sumiu fica lembrado. */
async function conferirLocal(card: HTMLElement, o: OpcoesMidiaDom): Promise<void> {
  const id = card.dataset.anexoId ?? "";
  const url = card.dataset.midiaUrl ?? "";
  if (!o.ponte || !id || !url || lembrancaDaMidia.conferidos.has(id)) return;
  lembrancaDaMidia.conferidos.add(id);
  const caminho = await o.local(url).catch(() => null);
  const existe = caminho ? await o.ponte.existe(caminho).catch(() => true) : true;
  if (existe) return;
  lembrancaDaMidia.sumiram.add(id);
  // NOD-326: o mesmo anexo pode estar no chat e na Biblioteca. O cartão do chat vira o "saiu da pasta" na hora; o item
  // da Biblioteca não é trocado (a lista se redesenha pela lembrança, com o nome e o "…").
  const cartoes = [card, ...document.querySelectorAll<HTMLElement>(`[data-midia-local][data-anexo-id="${CSS.escape(id)}"]`)];
  for (const c of new Set(cartoes)) {
    if (!c.isConnected || c.closest("[data-biblioteca]")) continue;
    const nome = c.querySelector(".anexo-info b")?.textContent ?? "";
    c.outerHTML = cartaoSumiu(nome, c.dataset.bot || undefined);
  }
  o.redesenhar();
}

/** Mostrar no Finder (o cartão ou a tela cheia): a API dá o caminho relativo; o app do Mac confere e abre. */
export async function mostrarNoFinder(url: string, o: OpcoesMidiaDom): Promise<boolean> {
  if (!o.ponte) return false;
  const caminho = await o.local(url).catch(() => null);
  return caminho ? o.ponte.mostrarNoFinder(caminho).catch(() => false) : false;
}

/** Liga os ouvintes uma vez (no boot da página). */
export function instalarMidiaDom(o: OpcoesMidiaDom): void {
  lembrancaDaMidia.reduzirMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  document.addEventListener("load", aoCarregar, true);
  document.addEventListener("loadeddata", aoCarregar, true);
  document.addEventListener("loadedmetadata", aoCarregar, true);
  document.addEventListener("error", aoFalhar, true);
  for (const tipo of ["play", "pause", "timeupdate", "ended"]) document.addEventListener(tipo, aoMudarAudio, true);
  if (!o.ponte) return;
  void o.ponte.maquina().then((id) => {
    if (!id) return;
    lembrancaDaMidia.esteMac = id;
    o.redesenhar();
  }, () => undefined);
  const conferirTudo = (): void => document.querySelectorAll<HTMLElement>("[data-midia-local]").forEach((c) => void conferirLocal(c, o));
  new MutationObserver(conferirTudo).observe(document.body, { childList: true, subtree: true });
  conferirTudo();
}
