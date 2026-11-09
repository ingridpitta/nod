import type { RaioXTurno } from "../../src/contracts/raio-x.ts";
import type { Api } from "../lib/api.ts";
import { ErroApi } from "../lib/api.ts";
import { BOTAO_FECHAR, renderRaioX } from "./raio-x-render.ts";

/**
 * A gaveta do Raio-X (modo dev, 0036): mexe no DOM, então fica fora de raio-x-render.ts. Só main.ts a importa,
 * como reportar-bug.ts. Sem modal: a conversa continua clicável ao lado (canvas modo-dev, D2).
 */

let gaveta: HTMLDialogElement | null = null;
let quemAbriu: HTMLElement | null = null;
/** Repete o último pedido (falha de rede, servidor reiniciando): o botão "Tentar de novo" do erro. */
let tentar: (() => Promise<void>) | null = null;

function fechar(): void {
  gaveta?.close();
}

function trocarAba(d: HTMLDialogElement, aba: HTMLElement, focar: boolean): void {
  for (const b of d.querySelectorAll<HTMLElement>("[data-aba]")) {
    const sel = b === aba;
    b.setAttribute("aria-selected", String(sel));
    b.tabIndex = sel ? 0 : -1;
  }
  for (const p of d.querySelectorAll<HTMLElement>("[data-painel]")) p.hidden = p.dataset.painel !== aba.dataset.aba;
  if (focar) aba.focus();
}

function criarGaveta(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "raio-x";
  d.setAttribute("aria-labelledby", "rx-titulo");
  document.body.append(d);
  d.addEventListener("close", () => {
    d.remove();
    document.body.classList.remove("com-raio-x");
    if (gaveta === d) gaveta = null;
    // O botão que abriu pode ter sido re-renderizado pela conversa; o do mesmo turno recebe o foco de volta.
    const volta = quemAbriu?.isConnected ? quemAbriu : d.dataset.turno ? document.querySelector<HTMLElement>(`[data-act="abrir-raio-x"][data-id="${CSS.escape(d.dataset.turno)}"]`) : null;
    volta?.focus({ preventScroll: true });
    quemAbriu = null;
  });
  // Gaveta sem modal (a conversa fica clicável ao lado): o Esc não vem de graça, então é tratado aqui.
  d.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
    const aba = (e.target as HTMLElement).closest<HTMLElement>("[data-aba]");
    if (!aba || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const abas = [...d.querySelectorAll<HTMLElement>("[data-aba]")];
    const i = abas.indexOf(aba);
    const destino = e.key === "Home" ? abas[0] : e.key === "End" ? abas.at(-1) : abas[(i + (e.key === "ArrowRight" ? 1 : -1) + abas.length) % abas.length];
    if (destino) { e.preventDefault(); trocarAba(d, destino, true); }
  });
  d.addEventListener("click", (e) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>("[data-aba],[data-rx]");
    if (!alvo) return;
    if (alvo.dataset.rx === "fechar") fechar();
    if (alvo.dataset.rx === "copiar") {
      const rotulo = alvo.querySelector("span");
      const json = d.dataset.json ?? "";
      const voltar = () => setTimeout(() => { if (rotulo) rotulo.textContent = "Copiar o turno em JSON"; }, 1500);
      navigator.clipboard.writeText(json).then(
        () => { if (rotulo) rotulo.textContent = "Copiado"; voltar(); },
        () => { if (rotulo) rotulo.textContent = "Não copiou"; voltar(); },
      );
    }
    if (alvo.dataset.rx === "tentar" && tentar) void tentar();
    if (alvo.dataset.aba) trocarAba(d, alvo, false);
  });
  return d;
}

/** `onde`: "catcher" ou "rodou em <máquina>" da fala (`ondeRodou`, ./modo-dev.ts), no cabeçalho; vazio, nada. */
export async function abrirRaioX(api: Api, turnoId: string, nome: string, origem?: HTMLElement, onde = ""): Promise<void> {
  // Uma gaveta só: abrir o Raio-X de outro turno troca o conteúdo, sem fechar e reabrir.
  const d = gaveta ?? (gaveta = criarGaveta());
  quemAbriu = origem ?? quemAbriu;
  d.dataset.turno = turnoId;
  delete d.dataset.json;
  tentar = () => abrirRaioX(api, turnoId, nome, undefined, onde);
  d.setAttribute("aria-busy", "true");
  d.innerHTML = `<p class="rx-intro rx-carregando" role="status">Carregando o Raio-X…</p>`;
  document.body.classList.add("com-raio-x");
  if (!d.open) d.show();
  let r: RaioXTurno;
  try {
    r = await api.raioXDoTurno(turnoId);
  } catch (e) {
    if (d.dataset.turno !== turnoId) return;
    d.removeAttribute("aria-busy");
    // 404 é definitivo (o turno não é seu ou não existe); o resto pode ser a rede ou o servidor reiniciando.
    const naoAchou = e instanceof ErroApi && e.status === 404;
    d.innerHTML = `<header class="rx-cab"><div><h2 id="rx-titulo">Raio-X do turno</h2></div>${BOTAO_FECHAR}</header><div class="rx-falha" role="alert"><p class="rx-intro">${naoAchou ? "Turno não encontrado." : "Não foi possível carregar o Raio-X."}</p>${naoAchou ? "" : '<button type="button" class="bt" data-rx="tentar">Tentar de novo</button>'}</div>`;
    d.querySelector<HTMLElement>(naoAchou ? '[data-rx="fechar"]' : '[data-rx="tentar"]')?.focus({ preventScroll: true });
    return;
  }
  // Outro Raio-X foi pedido enquanto este carregava: vale o último.
  if (d.dataset.turno !== turnoId) return;
  d.dataset.json = JSON.stringify(r, null, 2);
  d.removeAttribute("aria-busy");
  d.innerHTML = renderRaioX(r, nome, onde);
  d.querySelector<HTMLElement>('[data-rx="fechar"]')?.focus({ preventScroll: true });
}
