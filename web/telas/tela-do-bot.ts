import type { Api } from "../lib/api.ts";
import type { EstadoComputadorBot } from "../estado/reducer.ts";
import { estadoDoComputador, foraDoAr } from "../lib/computador.ts";

/**
 * Miniatura da tela do bot no painel (definido em 2026-10-16). A imagem não entra no HTML da gaveta:
 * cada quadro regravaria o painel inteiro. O laço só observa com o painel à vista e o computador
 * livre; o diálogo do desktop, quando aberto, é quem lê a tela e devolve o quadro por `lembrarTela`.
 * ADR-125: o laço só roda com a aba Computador aberta (`[data-comp-bot]`) e conta o estado lido por `aoVer`, que
 * escolhe o que a aba mostra (ligado, dormindo, sem computador, fora do ar). A miniatura só existe com ele ligado.
 */
let alvo: { api: Api; agenteId: string } | null = null;
let timer = 0;
let imagem = "";
let emCurso = false;
let vistaAntes = false;
let aoVer: (agenteId: string, estado: EstadoComputadorBot) => void = () => {};

/** Quem recebe o estado lido a cada pulso (o main.ts grava no estado da gaveta). */
export function aoVerComputador(f: (agenteId: string, estado: EstadoComputadorBot) => void): void {
  aoVer = f;
}

export function definirTelaDoBot(api: Api | null, agenteId: string | null): void {
  if (!api || !agenteId) {
    alvo = null;
    imagem = "";
    vistaAntes = false;
    if (timer) { window.clearInterval(timer); timer = 0; }
    return;
  }
  if (alvo?.agenteId !== agenteId) imagem = "";
  alvo = { api, agenteId };
  aplicar();
  // A aba acabou de abrir: lê agora, sem esperar o próximo tique (um pulso por abertura, não por render).
  const vista = abaAVista();
  const abriu = vista && !vistaAntes;
  vistaAntes = vista;
  if (timer) { if (abriu) void pulso(); return; }
  void pulso();
  timer = window.setInterval(() => void pulso(), 3000);
}

/** O diálogo acabou de ver este quadro: a miniatura fica igual ao fechar. */
export function lembrarTela(agenteId: string, pngBase64: string): void {
  if (alvo?.agenteId !== agenteId) return;
  imagem = pngBase64;
  aplicar();
}

function preview(): HTMLButtonElement | null {
  if (!alvo) return null;
  return document.querySelector<HTMLButtonElement>(`[data-tela-bot="${CSS.escape(alvo.agenteId)}"]`);
}

function abaAVista(): boolean {
  return !!alvo && !!document.querySelector(`[data-comp-bot="${CSS.escape(alvo.agenteId)}"]`) && painelAVista();
}

function painelAVista(): boolean {
  const app = document.querySelector(".app");
  if (!app?.classList.contains("com-detalhes") || document.hidden) return false;
  if (window.matchMedia("(max-width: 1099px)").matches) return app.classList.contains("detalhes-abertos");
  return !app.classList.contains("detalhes-ocultos");
}

function aplicar(): void {
  const el = preview();
  const img = el?.querySelector("img");
  if (!el || !img) return;
  if (!imagem) {
    img.removeAttribute("src");
    img.hidden = true;
    el.classList.remove("com-imagem");
    return;
  }
  const src = `data:image/png;base64,${imagem}`;
  if (img.getAttribute("src") !== src) img.src = src;
  img.hidden = false;
  el.classList.add("com-imagem");
}

async function pulso(): Promise<void> {
  if (!alvo || emCurso || !abaAVista() || document.querySelector(".computador-dialog, dialog.cb-veu")) return;
  const { api, agenteId } = alvo;
  emCurso = true;
  try {
    const dto = await api.computador(agenteId);
    if (alvo?.agenteId !== agenteId) return;
    aoVer(agenteId, estadoDoComputador(dto, Date.now()));
    const fora = foraDoAr(dto);
    if (!preview() || !dto.ativo || fora || (dto.computador.ocupadoAte ?? 0) > Date.now()) {
      if (!dto.ativo || fora) { imagem = ""; aplicar(); }
      return;
    }
    const r = await api.acaoComputador(agenteId, { tipo: "observar" });
    if (alvo?.agenteId !== agenteId || !r.tela) return;
    imagem = r.tela.imagem;
    aplicar();
  } catch {
    // A miniatura fica no último quadro. Abrir continua no botão; sem nenhuma leitura ainda, a aba não fica em "Vendo…".
    if (alvo?.agenteId === agenteId && !imagem) aoVer(agenteId, "erro");
  } finally {
    emCurso = false;
  }
}
