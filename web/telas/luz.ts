import { duracaoHumana, lembrancaDaMidia, type ItemLuz } from "../lib/midia.ts";
import { abrirSobreposicao } from "../lib/sobreposicao.ts";
import { baixarUrl, destinoDaSeta, htmlDaLuz, htmlDoItem, ICONE, proximaVel, rotuloVel, temFinder } from "./luz-html.ts";

export { destinoDaSeta, htmlDaLuz, htmlDoItem, proximaVel, rotuloVel, temFinder, VELOCIDADES } from "./luz-html.ts";

/** NOD-323: o comportamento da tela cheia da mídia do bot (o HTML está em luz-html.ts). */
export type OpcoesLuz = {
  /** Mostrar no Finder (só o app do Mac desta máquina). */
  finder?: (item: ItemLuz) => void;
  /** Abre neste item da lista em vez do `data-i` da origem (o link nod-anexo para a 4ª imagem em diante). */
  indice?: number;
};

/** Abre a tela cheia na mídia em que a pessoa clicou (o botão tem data-i; a lista vem do data-luz do grupo). */
export function abrirLuz(origem: HTMLElement, o: OpcoesLuz = {}): HTMLDialogElement | null {
  const grupo = origem.closest<HTMLElement>(".msg-midias");
  let itens: ItemLuz[];
  try {
    itens = JSON.parse(grupo?.dataset.luz ?? "[]") as ItemLuz[];
  } catch {
    return null;
  }
  let i = o.indice ?? Number(origem.dataset.i ?? "0");
  if (!Number.isInteger(i) || !itens[i]) return null;
  // A casa da lista: a fala no chat ou (NOD-326) a Biblioteca da gaveta — o foco volta ao botão dela depois do redesenho.
  const mensagem = origem.closest<HTMLElement>("[data-mensagem]")?.dataset.mensagem;
  const biblioteca = mensagem === undefined ? origem.closest<HTMLElement>("[data-biblioteca]")?.dataset.biblioteca : undefined;
  const casa = biblioteca !== undefined ? `[data-biblioteca="${CSS.escape(biblioteca)}"]` : `[data-mensagem="${CSS.escape(mensagem ?? "")}"]`;
  const anexoDe = (k: number): string => itens[k]?.id ?? "";
  const esteMac = o.finder ? lembrancaDaMidia.esteMac : null;
  const dialog = abrirSobreposicao({
    classe: "luz",
    rotulo: "Mídia em tela cheia",
    html: htmlDaLuz(itens, i, esteMac),
    origem,
    // A conversa redesenhou com a tela aberta: o foco volta ao botão da mídia que está à vista agora.
    reencontrar: () => document.querySelector<HTMLElement>(`${casa} [data-act="midia-abrir"][data-anexo-id="${CSS.escape(anexoDe(i))}"]`)
      ?? document.querySelector<HTMLElement>(`${casa} [data-act="midia-abrir"]`),
    seletorFechar: '[data-luz="fechar"]',
    aoFechar: () => dialog.querySelectorAll("video").forEach((v) => v.pause()),
  });
  dialog.setAttribute("aria-describedby", "luz-legenda");
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) dialog.classList.add("entra");

  const ir = (k: number): void => {
    if (itens.length < 2 || k < 0 || k >= itens.length || k === i) return;
    i = k;
    dialog.querySelectorAll("video").forEach((v) => v.pause());
    dialog.classList.remove("cem");
    const lugar = dialog.querySelector<HTMLElement>('[data-luz="item"]');
    if (lugar) lugar.innerHTML = htmlDoItem(itens[i]!, i, itens.length);
    const baixar = dialog.querySelector<HTMLAnchorElement>('[data-luz="baixar"]');
    if (baixar) {
      baixar.href = baixarUrl(itens[i]!.url);
      baixar.download = itens[i]!.nome;
      baixar.setAttribute("aria-label", `Baixar ${itens[i]!.nome}`);
    }
    const finderBt = dialog.querySelector<HTMLElement>('[data-luz="finder"]');
    if (finderBt) finderBt.hidden = !temFinder(itens[i], esteMac);
    // Nas pontas a seta daquele lado some; se o foco estava nela, passa para a outra.
    const ant = dialog.querySelector<HTMLElement>('[data-luz="ant"]');
    const prox = dialog.querySelector<HTMLElement>('[data-luz="prox"]');
    const focoNa = document.activeElement;
    if (ant) ant.hidden = i === 0;
    if (prox) prox.hidden = i === itens.length - 1;
    if (focoNa === ant && ant?.hidden) prox?.focus();
    else if (focoNa === prox && prox?.hidden) ant?.focus();
    dialog.querySelectorAll<HTMLElement>(".luz-mini").forEach((m, k) => {
      if (k === i) {
        m.setAttribute("aria-current", "true");
        m.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      } else m.removeAttribute("aria-current");
    });
  };

  dialog.addEventListener("click", (ev) => {
    const alvo = ev.target as HTMLElement;
    const passo = alvo.closest<HTMLElement>("[data-luz-ir]");
    if (passo) return ir(Number(passo.dataset.luzIr));
    const papel = alvo.closest<HTMLElement>("[data-luz]")?.dataset.luz;
    if (papel === "ant" || papel === "prox") {
      const k = destinoDaSeta(i, papel === "ant" ? -1 : 1, itens.length);
      return k === null ? undefined : ir(k);
    }
    if (papel === "finder") return temFinder(itens[i], esteMac) ? o.finder?.(itens[i]!) : undefined;
    if (papel === "play" || papel === "video") return alternarVideo(dialog);
    if (papel === "vel") {
      const v = dialog.querySelector<HTMLVideoElement>('[data-luz="video"]');
      const bt = alvo.closest<HTMLElement>('[data-luz="vel"]');
      if (!v || !bt) return;
      v.playbackRate = proximaVel(v.playbackRate);
      bt.textContent = rotuloVel(v.playbackRate);
      bt.setAttribute("aria-label", `Velocidade ${rotuloVel(v.playbackRate)}`);
      return;
    }
    // Clicar fora da mídia (no escuro do palco ou em volta da figura) fecha; na mídia e nos controles, não.
    if (papel === "palco" || alvo.classList.contains("luz-fig") || alvo.classList.contains("luz-video")) dialog.close();
  });
  // Duplo clique na imagem: o tamanho real do arquivo (o palco rola); de novo, ajustada.
  dialog.addEventListener("dblclick", (ev) => {
    if ((ev.target as HTMLElement).closest('[data-luz="midia"]')) dialog.classList.toggle("cem");
  });
  dialog.addEventListener("keydown", (ev) => {
    if ((ev.target as HTMLElement).matches?.("input[type=range]")) return;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); ir(i - 1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); ir(i + 1); }
  });
  // Deslizar (toque): passa para o lado, se a imagem não está no tamanho real.
  let x0: number | null = null;
  dialog.addEventListener("pointerdown", (ev) => { x0 = ev.pointerType === "mouse" ? null : ev.clientX; });
  dialog.addEventListener("pointerup", (ev) => {
    if (x0 === null || dialog.classList.contains("cem")) return;
    const dx = ev.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) ir(dx < 0 ? i + 1 : i - 1);
  });
  // O vídeo: a barra acompanha o tempo; a trilha leva ao ponto.
  dialog.addEventListener("input", (ev) => {
    const r = ev.target as HTMLInputElement;
    const v = dialog.querySelector<HTMLVideoElement>('[data-luz="video"]');
    if (r.dataset.luz !== "ir" || !v || !Number.isFinite(v.duration)) return;
    v.currentTime = (Number(r.value) / 1000) * v.duration;
  });
  const atualizar = (ev: Event): void => {
    const v = ev.target as HTMLVideoElement;
    if (v.dataset?.luz !== "video") return;
    const fig = v.closest(".luz-video");
    const total = Number.isFinite(v.duration) ? v.duration * 1000 : (itens[i]?.dur ?? 0);
    const agora = duracaoHumana(v.currentTime * 1000) ?? "0:00";
    const fim = duracaoHumana(total) ?? "0:00";
    const trilha = fig?.querySelector<HTMLInputElement>('[data-luz="ir"]');
    if (trilha) {
      const p = total > 0 ? (v.currentTime * 1000) / total : 0;
      trilha.value = String(Math.round(p * 1000));
      trilha.style.setProperty("--p", `${p * 100}%`);
      trilha.setAttribute("aria-valuetext", `${agora} de ${fim}`);
    }
    const tempo = fig?.querySelector('[data-luz="tempo"]');
    if (tempo) tempo.textContent = `${agora} / ${fim}`;
    const play = fig?.querySelector<HTMLElement>('[data-luz="play"]');
    if (play) {
      play.innerHTML = v.paused ? ICONE.play : ICONE.pausa;
      play.setAttribute("aria-label", v.paused ? "Reproduzir" : "Pausar");
    }
  };
  for (const tipo of ["timeupdate", "loadedmetadata", "play", "pause", "ended"]) dialog.addEventListener(tipo, atualizar, true);
  return dialog;
}

function alternarVideo(dialog: HTMLDialogElement): void {
  const v = dialog.querySelector<HTMLVideoElement>('[data-luz="video"]');
  if (!v) return;
  if (v.paused) void v.play().catch(() => undefined);
  else v.pause();
}
