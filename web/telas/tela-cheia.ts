import type { AcaoComputador, ComputadorDto, TelaComputador } from "../../src/contracts/computador.ts";
import type { Api } from "../lib/api.ts";
import { estadoDaPilula, htmlPilula, htmlTelaCheia } from "../lib/computador-pessoa.ts";
import { abrirVivoNoVnc, type AbrirVivo, type ClienteVivo } from "../lib/tela-vivo.ts";
import { lembrarTela } from "./tela-do-bot.ts";

/**
 * A tela cheia do computador do bot v2 (NOD-96, PR 6). Diferente do diálogo de antes (web/telas/computador.ts): não liga
 * nada — o computador é da pessoa e acorda sozinho quando um bot precisa — e não tem barra de ferramentas. Abre em
 * Assistindo; "Assumir o controle" passa por "Assumindo… <bot> termina a ação em curso" e chega em "Você está no
 * controle · Parar", com a borda azul. Fechar devolve ao bot. Vindo do pedido de ajuda, já abre no controle.
 *
 * NOD-95 (ADR-138): no controle, a tela vira ao vivo (web/lib/tela-vivo.ts): o canvas do VNC toma o lugar da captura
 * e as teclas, o mouse e a rolagem vão por ele, sem passar pelas ações. Assistindo continua nas capturas de 2 s. Se o
 * ao vivo não liga ou cai, as capturas voltam e as ações de antes seguem valendo.
 */
export type OpcoesTelaCheia = {
  assumir?: boolean;
  /** O pedido de ajuda, ao lado do título. */
  pedido?: string | null;
  /** Avisado quando o controle muda: o painel e a gaveta releem o computador. */
  aoMudar?: () => void;
  /** Só no Modo dev: o diálogo antigo, com terminal e arquivos. */
  antigo?: (() => void) | null;
  /** NOD-95: como abrir a tela ao vivo (padrão: o noVNC); os testes passam um falso. */
  vivo?: AbrirVivo;
};

export function abrirTelaCheia(api: Api, agente: { id: string; nome: string }, opcoes: OpcoesTelaCheia = {}): void {
  document.querySelector<HTMLDialogElement>("dialog.cb-veu")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "cb-veu";
  dialog.setAttribute("aria-label", `Tela de ${agente.nome}`);
  dialog.innerHTML = htmlTelaCheia(agente.nome, opcoes.pedido ?? null);
  if (opcoes.antigo) {
    const dev = document.createElement("button");
    dev.type = "button";
    dev.className = "cb-link cb-tela-dev";
    dev.dataset.c = "antigo";
    dev.textContent = "Ferramentas";
    dialog.querySelector(".cb-tela-cab .cb-tela-x")?.before(dev);
  }
  document.body.append(dialog);
  dialog.showModal();
  const q = <T extends Element = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const imagem = q<HTMLImageElement>(".cb-tela-vista > img");
  let dto: ComputadorDto | undefined;
  let tela: TelaComputador | undefined;
  let assumindo = false;
  /** Pediu "assumir" nesta tela: se fechar antes da resposta, o fim do pedido devolve ao bot. */
  let pediuAssumir = false;
  let terminou = false;
  let ocupado = false;
  let fila: Promise<void> = Promise.resolve();
  let teclas = "";
  let timerTeclas: number | undefined;
  let timerClique: number | undefined;
  const controla = () => dto?.computador.controle === "pessoa" && Boolean(dto.ativo);
  // NOD-95: o cliente do ao vivo; `aoVivo` só depois de conectar. Caiu uma vez: fica nas capturas até assumir de novo.
  let vivo: ClienteVivo | null = null;
  let ligandoVivo = false;
  let aoVivo = false;
  let vivoCaiu = false;

  function pintar(): void {
    const estado = estadoDaPilula(dto?.computador.controle, assumindo);
    q(".cb-tela-pilula").innerHTML = dto?.ativo || assumindo ? htmlPilula(agente.nome, estado) : "";
    q(".cb-tela-vista").classList.toggle("no-controle", estado === "controle");
    imagem.classList.toggle("controlavel", estado === "controle");
    const temImagem = Boolean(imagem.getAttribute("src"));
    imagem.hidden = !temImagem || aoVivo;
    q(".cb-tela-vivo").hidden = !aoVivo;
    q(".cb-tela-vazia").hidden = temImagem || aoVivo;
  }
  function desligarVivo(): void {
    const c = vivo;
    vivo = null;
    aoVivo = false;
    c?.fechar();
  }
  async function ligarVivo(): Promise<void> {
    if (vivo || ligandoVivo || vivoCaiu || terminou || !controla()) return;
    ligandoVivo = true;
    const c = await (opcoes.vivo ?? abrirVivoNoVnc)({
      alvo: q(".cb-tela-vivo"),
      url: api.urlVivo(agente.id),
      aoLigar: () => { if (vivo !== c || terminou) return; aoVivo = true; pintar(); c?.focar(); },
      aoCair: () => { if (vivo !== c) return; vivo = null; aoVivo = false; vivoCaiu = true; if (!terminou) pintar(); },
    });
    ligandoVivo = false;
    if (!c) return;
    if (terminou || !controla()) { c.fechar(); return; }
    vivo = c;
  }
  async function ler(): Promise<void> {
    dto = await api.computador(agente.id);
    if (terminou) return;
    // O controle saiu da pessoa por fora (Parar noutra aba, o bot retomou): o ao vivo acaba e a captura volta.
    if (vivo && !controla()) desligarVivo();
    // Ao vivo, a captura de 2 s não é pedida: o canvas já mostra a tela, e a ação `observar` pararia o VNC.
    if (dto.ativo && !vivo && !ligandoVivo && (dto.computador.ocupadoAte ?? 0) <= Date.now()) {
      const r = await api.acaoComputador(agente.id, { tipo: "observar" });
      if (r.tela && !terminou) {
        tela = r.tela;
        imagem.src = `data:image/png;base64,${tela.imagem}`;
        lembrarTela(agente.id, tela.imagem);
      }
    }
    pintar();
  }
  async function vez(fn: () => Promise<void>, silencioso = false): Promise<void> {
    if (terminou || (silencioso && ocupado)) return;
    while (ocupado && !terminou) await new Promise<void>((r) => window.setTimeout(r, 30));
    if (terminou) return;
    ocupado = true;
    try { await fn(); } catch { /* a próxima leitura mostra o estado real */ } finally { ocupado = false; pintar(); }
  }
  function devolverAoFechar(): void {
    void api.configurarComputador(agente.id, "devolver").catch(() => undefined).finally(() => opcoes.aoMudar?.());
  }
  async function configurar(operacao: "assumir" | "devolver"): Promise<void> {
    if (terminou) return;
    if (operacao === "assumir") { assumindo = true; pediuAssumir = true; vivoCaiu = false; pintar(); }
    if (operacao === "devolver") desligarVivo();
    try {
      await api.configurarComputador(agente.id, operacao);
    } finally {
      assumindo = false;
      opcoes.aoMudar?.();
    }
    // Fechou durante "Assumindo…": o controle chegou com a tela fechada e volta ao bot agora.
    if (terminou) { if (operacao === "assumir" && pediuAssumir) devolverAoFechar(); return; }
    await ler();
    if (operacao === "assumir" && controla()) { imagem.focus(); void ligarVivo(); }
  }
  async function interagir(a: AcaoComputador): Promise<void> {
    if (!controla()) return;
    fila = fila.then(() => vez(async () => {
      if (!controla()) return;
      const entrada = (a.tipo === "digitar" || a.tipo === "tecla") && tela ? { ...a, quadro: tela.quadro } : a;
      await api.acaoComputador(agente.id, entrada);
      await ler();
    }));
    await fila;
  }
  function enviarTeclas(): void {
    if (timerTeclas) window.clearTimeout(timerTeclas);
    const texto = teclas;
    teclas = "";
    if (texto && tela) void interagir({ tipo: "digitar", texto, quadro: tela.quadro });
  }
  // A imagem tem a resolução do computador (1280×800): o clique é convertido para ela.
  const ponto = (e: MouseEvent) => {
    const b = imagem.getBoundingClientRect();
    const escala = Math.min(b.width / 1280, b.height / 800);
    const dx = (b.width - 1280 * escala) / 2;
    const dy = (b.height - 800 * escala) / 2;
    return { x: Math.min(1279, Math.max(0, Math.floor((e.clientX - b.left - dx) / escala))), y: Math.min(799, Math.max(0, Math.floor((e.clientY - b.top - dy) / escala))) };
  };
  let inicio: { x: number; y: number } | undefined;
  imagem.addEventListener("mousedown", (e) => { if (!controla()) return; e.preventDefault(); imagem.focus(); inicio = ponto(e); });
  imagem.addEventListener("mouseup", (e) => {
    if (!tela || !inicio) return;
    const fim = ponto(e);
    const ini = inicio;
    inicio = undefined;
    if (Math.abs(fim.x - ini.x) + Math.abs(fim.y - ini.y) > 8) void interagir({ tipo: "arrastar", ...ini, destinoX: fim.x, destinoY: fim.y, quadro: tela.quadro });
    else {
      if (timerClique) window.clearTimeout(timerClique);
      const acao: AcaoComputador = { tipo: "clicar", ...fim, quadro: tela.quadro, botao: e.button === 2 ? 3 : 1, vezes: e.detail >= 2 ? 2 : 1 };
      timerClique = window.setTimeout(() => { void interagir(acao); }, e.detail >= 2 ? 0 : 230);
    }
  });
  imagem.addEventListener("contextmenu", (e) => e.preventDefault());
  imagem.addEventListener("wheel", (e) => { if (!controla() || document.activeElement !== imagem) return; e.preventDefault(); if (tela) void interagir({ tipo: "rolar", delta: Math.max(-2000, Math.min(2000, e.deltaY)), quadro: tela.quadro }); }, { passive: false });
  imagem.addEventListener("keydown", (e) => {
    if (!tela || !controla() || ["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;
    // Esc no controle vai para o site; para fechar, o ✕ (ou Esc com o foco fora da tela).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      teclas += e.key;
      if (timerTeclas) window.clearTimeout(timerTeclas);
      timerTeclas = window.setTimeout(enviarTeclas, 150);
    } else {
      enviarTeclas();
      const tecla = `${e.ctrlKey || e.metaKey ? "Control+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key === " " ? "Space" : e.key}`;
      void interagir({ tipo: "tecla", tecla, quadro: tela.quadro });
    }
  });
  imagem.addEventListener("paste", (e) => { e.preventDefault(); enviarTeclas(); const texto = e.clipboardData?.getData("text/plain"); if (texto && tela) void interagir({ tipo: "digitar", texto, quadro: tela.quadro }); });
  dialog.addEventListener("cancel", (e) => { if (document.activeElement === imagem && controla()) e.preventDefault(); });
  dialog.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
    if (!el) { if (e.target === dialog) dialog.close(); return; }
    const cmd = el.dataset.c;
    if (cmd === "fechar") dialog.close();
    else if (cmd === "antigo") { dialog.close(); opcoes.antigo?.(); }
    else if (cmd === "assumir" || cmd === "devolver") void vez(() => configurar(cmd));
  });
  const timer = window.setInterval(() => { if (!document.hidden && !terminou) void vez(ler, true); }, 2000);
  dialog.addEventListener("close", () => {
    // Fechar devolve ao bot: a pessoa não fica "no controle" de uma tela que não está vendo.
    // Durante "Assumindo…" quem devolve é o fim do configurar('assumir'): devolver antes dele chegaria antes do assumir.
    if (controla() && !assumindo) devolverAoFechar();
    terminou = true;
    desligarVivo();
    window.clearInterval(timer);
    if (timerTeclas) window.clearTimeout(timerTeclas);
    if (timerClique) window.clearTimeout(timerClique);
    dialog.remove();
  });
  pintar();
  void vez(async () => {
    await ler();
    if (terminou) return;
    if (opcoes.assumir && dto?.ativo && dto.computador.controle !== "pessoa") await configurar("assumir");
    else (dialog.querySelector<HTMLElement>(".cb-pilula .cb-link") ?? q<HTMLElement>(".cb-tela-x")).focus();
    // Já no controle ao abrir (pedido de ajuda com o controle dado, ou voltou à tela): ao vivo desde já.
    if (controla()) void ligarVivo();
  });
}
