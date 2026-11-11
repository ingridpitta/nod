/**
 * Quadro minimalista (definido em 2026-11-10, pedido do Marlon; referência: o board do Multica). O estado e os cliques da
 * barra nova do quadro em tela cheia: o funil dos Filtros, a pílula de quem trabalha, o popover das Opções e o modal de
 * Nova tarefa. Mora fora de web/lib/quadro-na-tela.ts (que já passa de 3 mil linhas): ela só repassa os eventos e
 * desenha com o que `ui()` devolve.
 *
 * Onde fica cada coisa: as Opções vão para as preferências de quem lê (o Exibir do quadro, 0149, pelo `gravarExibir` da
 * tela, que já guarda em fila); os Filtros ficam na memória desta tela, por quadro, enquanto ela está aberta.
 */
import type { ColunaDto, QuadroDto } from "../../src/contracts/quadro.ts";
import type { ExibirDoQuadro } from "../../src/contracts/raio-x.ts";
import type { Prioridade, PropriedadeDoCard } from "../../src/contracts/quadro-opcoes.ts";
import { LIMITES_OPCOES, ORDENS_DO_QUADRO, PRIORIDADES, AGRUPAMENTOS_DO_QUADRO, PROPRIEDADES_DO_CARD, alternarCondicao, CAMPOS_DO_FILTRO, ehCampo, ehCondicao, opcoesEfetivas, type CampoDoFiltro, type CondicaoDoFiltro } from "./opcoes-do-quadro.ts";
import type { ModalDaNovaTarefa, PopoverDaBarra, UiDaBarra } from "../telas/opcoes-quadro.ts";

export type { PopoverDaBarra, UiDaBarra } from "../telas/opcoes-quadro.ts";

export interface DepsDaBarra {
  quadro(): QuadroDto | null;
  colunas(): readonly ColunaDto[];
  exibir(): ExibirDoQuadro;
  /** Muda o Exibir deste quadro (a tela mostra na hora; o servidor guarda em fila). */
  gravarExibir(m: Partial<ExibirDoQuadro>): void;
  desenhar(): void;
  focar(seletor: string): void;
  anunciar(texto: string): void;
  podeCriar(): boolean;
  /** Cria a tarefa (o mesmo POST do "+"); true = criou. */
  criarTarefa(campos: { titulo: string; descricao?: string; status: string; agente: string | null; prioridade: Prioridade }): Promise<boolean>;
  /** A pessoa está no modo Quadro (o atalho C só vale lá). */
  noQuadro(): boolean;
  /** Celular: o "+" da coluna segue no campo inline; o modal é do computador. */
  celular(): boolean;
}

const SEL_MODAL = ".qm-modal";
const focaveisDe = (raiz: Element): HTMLElement[] =>
  [...raiz.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((e) => e.getClientRects().length);

/** Os itens do menu do quadro (as setas andam entre eles). */
const MENU_ITENS = '#qm-pop-quadro [role="menuitem"]';
/** As ações do menu do quadro que levam a outro lugar (painel, importação, seletor, remover): o menu fecha antes. */
const SAEM_DO_MENU = new Set(["painel-pessoas", "painel-atividade", "trazer-linear", "quadro-seletor", "remover-quadro"]);
/** O botão que abriu cada popover (o foco volta para ele ao fechar). */
function voltaDo(p: PopoverDaBarra): string {
  return p === "filtros" ? '[data-act="fil-abrir"]' : p === "opcoes" ? '[data-act="op-abrir"]' : p === "quadro" ? '.qm-cab-bt' : '[data-act="ativos-abrir"]';
}

export function criarBarraDoQuadro(d: DepsDaBarra) {
  let aberto: PopoverDaBarra = null;
  /** O campo aberto dentro do menu do quadro (o Prazo). */
  let passo: "prazo" | null = null;
  let campo: CampoDoFiltro | null = null;
  let buscaFiltro = "";
  const filtrosPorQuadro = new Map<string, CondicaoDoFiltro[]>();
  let modal: ModalDaNovaTarefa | null = null;
  /** O botão que abriu o modal (o foco volta para ele ao fechar). */
  let voltaDoModal = '[data-act="nt-abrir"]';

  const filtros = (): CondicaoDoFiltro[] => { const q = d.quadro(); return q ? filtrosPorQuadro.get(q.id) ?? [] : []; };
  const porFiltros = (f: CondicaoDoFiltro[]): void => { const q = d.quadro(); if (q) filtrosPorQuadro.set(q.id, f); };
  /** Os campos em "não é", por quadro (como os filtros). */
  const negadosPorQuadro = new Map<string, CampoDoFiltro[]>();
  const negados = (): CampoDoFiltro[] => { const q = d.quadro(); return q ? negadosPorQuadro.get(q.id) ?? [] : []; };
  const porNegados = (n: CampoDoFiltro[]): void => { const q = d.quadro(); if (q) negadosPorQuadro.set(q.id, n); };

  function abrir(p: PopoverDaBarra, foco?: string): void {
    aberto = aberto === p ? null : p;
    campo = null;
    passo = null;
    if (aberto !== "filtros") buscaFiltro = "";
    d.desenhar();
    d.focar(aberto ? foco ?? (p === "filtros" ? "#qm-fil-busca" : p === "opcoes" ? "#qm-pop-op button" : p === "quadro" ? MENU_ITENS : "#qm-pop-ativos .qm-it") : voltaDo(p));
  }

  function anunciarFiltros(): void {
    const n = filtros().length;
    d.anunciar(n ? `${n} ${n === 1 ? "filtro ligado" : "filtros ligados"}.` : "Sem filtros.");
  }

  /* ---------- Opções ---------- */
  function alternarNaLista<T extends string>(lista: readonly T[], v: T): T[] { return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]; }

  function mudarOpcao(m: Partial<ExibirDoQuadro>, foco: string): void {
    d.gravarExibir(m);
    d.focar(foco);
  }

  /* ---------- Nova tarefa ---------- */
  function colunaPadrao(): string {
    const cs = d.colunas();
    return (cs.find((c) => c.id === "backlog") ?? cs.find((c) => c.grupo === "nao_iniciado") ?? cs[0])?.id ?? "backlog";
  }

  function abrirModal(coluna?: string, volta = '[data-act="nt-abrir"]'): void {
    if (!d.podeCriar() || !d.quadro()) return;
    aberto = null;
    voltaDoModal = volta;
    modal = { titulo: "", descricao: "", coluna: coluna && d.colunas().some((c) => c.id === coluna) ? coluna : colunaPadrao(), prioridade: "sem", agente: "", criarOutra: modal?.criarOutra ?? false };
    d.desenhar();
    d.focar("#qm-nt-tit");
  }

  function fecharModal(): void {
    if (!modal) return;
    modal = null;
    d.desenhar();
    d.focar(voltaDoModal);
  }

  async function enviarModal(): Promise<void> {
    if (!modal || modal.enviando) return;
    const titulo = modal.titulo.trim();
    if (!titulo) { modal = { ...modal, erro: "Dê um título à tarefa." }; d.desenhar(); d.focar("#qm-nt-tit"); return; }
    const m = modal;
    modal = { ...m, enviando: true, erro: null };
    d.desenhar();
    const ok = await d.criarTarefa({ titulo, ...(m.descricao.trim() ? { descricao: m.descricao.trim() } : {}), status: m.coluna, agente: m.agente || null, prioridade: m.prioridade });
    if (!modal) return;
    if (!ok) { modal = { ...m, enviando: false, erro: "Não deu para criar. Tente de novo." }; d.desenhar(); d.focar("#qm-nt-tit"); return; }
    if (m.criarOutra) {
      modal = { ...m, titulo: "", descricao: "", enviando: false, erro: null };
      d.desenhar();
      d.focar("#qm-nt-tit");
      d.anunciar(`Tarefa criada: ${titulo}. Pode escrever a próxima.`);
    } else {
      modal = null;
      d.desenhar();
      d.focar(voltaDoModal);
    }
  }

  return {
    ui(): UiDaBarra { return { aberto, campo, buscaFiltro, filtros: filtros(), negados: negados(), modal, passo }; },
    filtros,
    /** Algum popover ou o modal aberto (o Esc e o clique fora são da barra). */
    algoAberto(): boolean { return aberto !== null || modal !== null; },

    /** Os cliques da barra; true = tratou. */
    aoClicar(el: HTMLElement, act: string | undefined): boolean {
      if (aberto === "quadro" && act && SAEM_DO_MENU.has(act) && el.closest("#qm-pop-quadro")) { aberto = null; passo = null; return false; }
      switch (act) {
        // O nome do quadro abre o menu; a meta e o prazo em cinza abrem já no item da Meta.
        case "qmenu-abrir": abrir("quadro", el.dataset["foco"] === "meta" ? '#qm-pop-quadro [data-act="editar-meta"]' : undefined); return true;
        case "qmenu-prazo": passo = "prazo"; d.desenhar(); d.focar("#qm-pop-quadro #qd-prazo"); return true;
        case "fil-abrir": abrir("filtros"); return true;
        case "ativos-abrir": abrir("ativos"); return true;
        case "op-abrir": abrir("opcoes"); return true;
        case "fil-campo": {
          const c = el.dataset["campo"] as CampoDoFiltro;
          if (!(CAMPOS_DO_FILTRO as readonly string[]).includes(c)) return true;
          campo = campo === c ? null : c;
          d.desenhar();
          d.focar(campo ? `#qm-sub-${c} .qm-it` : `[data-act="fil-campo"][data-campo="${c}"]`);
          return true;
        }
        case "fil-alternar": {
          const cond = { campo: el.dataset["campo"], valor: el.dataset["valor"] };
          if (!ehCondicao(cond)) return true;
          porFiltros(alternarCondicao(filtros(), cond));
          d.desenhar();
          d.focar(`#qm-pop-fil [data-act="fil-alternar"][data-campo="${cond.campo}"][data-valor="${CSS.escape(cond.valor)}"]`);
          anunciarFiltros();
          return true;
        }
        case "fil-modo": {
          const c = el.dataset["campo"];
          if (!ehCampo(c)) return true;
          const nao = el.dataset["modo"] === "nao";
          porNegados(nao ? [...new Set([...negados(), c])] : negados().filter((x) => x !== c));
          d.desenhar();
          d.focar(`#qm-sub-${c} [data-act="fil-modo"][data-modo="${nao ? "nao" : "e"}"]`);
          if (filtros().some((f) => f.campo === c)) anunciarFiltros();
          return true;
        }
        case "fil-tirar": {
          const c = el.dataset["campo"];
          porFiltros(filtros().filter((f) => f.campo !== c));
          porNegados(negados().filter((x) => x !== c));
          d.desenhar();
          d.focar('[data-act="fil-abrir"]');
          anunciarFiltros();
          return true;
        }
        case "fil-limpar": porFiltros([]); porNegados([]); campo = null; d.desenhar(); d.focar('[data-act="fil-abrir"]'); anunciarFiltros(); return true;
        case "op-vista": { const v = el.dataset["valor"]; if (v === "quadro" || v === "lista") mudarOpcao({ vista: v }, `#qm-pop-op [data-act="op-vista"][data-valor="${v}"]`); return true; }
        case "op-inverter": mudarOpcao({ inverter: !opcoesEfetivas(d.exibir()).inverter }, '#qm-pop-op [data-act="op-inverter"]'); return true;
        case "op-coluna": {
          const id = el.dataset["coluna"] ?? "";
          const atual = opcoesEfetivas(d.exibir()).ocultas;
          const ocultas = alternarNaLista([...atual], id).filter((x) => d.colunas().some((c) => c.id === x)).slice(0, LIMITES_OPCOES.ocultas);
          mudarOpcao({ ocultas }, `#qm-pop-op [data-act="op-coluna"][data-coluna="${CSS.escape(id)}"]`);
          return true;
        }
        case "op-prop": {
          const p = el.dataset["prop"] as PropriedadeDoCard;
          if (!(PROPRIEDADES_DO_CARD as readonly string[]).includes(p)) return true;
          // Na ordem do catálogo (a lista guardada não muda de ordem a cada clique).
          const on = alternarNaLista([...opcoesEfetivas(d.exibir()).props], p);
          mudarOpcao({ propriedades: PROPRIEDADES_DO_CARD.filter((x) => on.includes(x)) }, `#qm-pop-op [data-act="op-prop"][data-prop="${p}"]`);
          return true;
        }
        case "exibir-alternar": {
          const k = el.dataset["chave"];
          if (k !== "recolhidas" && k !== "compacto") return false;
          const e = d.exibir();
          mudarOpcao(k === "recolhidas" ? { recolhidas: !e.recolhidas } : { compacto: !e.compacto }, `[data-act="exibir-alternar"][data-chave="${k}"]`);
          return true;
        }
        case "nt-abrir": abrirModal(); return true;
        case "nt-fechar": case "nt-fora": fecharModal(); return true;
        case "col-nova-tarefa": {
          if (d.celular()) return false;
          const st = el.dataset["status"] ?? "";
          abrirModal(st, `.qd-so-largo [data-act="col-nova-tarefa"][data-status="${CSS.escape(st)}"]`);
          return true;
        }
        case "filtro-do-quadro": if (aberto === "ativos") aberto = null; return false;
      }
      return false;
    },

    /** O clique fora do popover aberto fecha (o modal fecha só pelo fundo, ×, Esc). */
    aoClicarFora(alvo: Element | null): boolean {
      if (!aberto || alvo?.closest?.(".qm-fil-l, .qm-op-l, .qm-ativos-l, .qm-cab-l")) return false;
      aberto = null;
      campo = null;
      passo = null;
      return true;
    },

    /** Os selects e caixas (Opções e o modal); true = tratou. */
    aoMudar(el: HTMLElement): boolean {
      const c = el.dataset["campo"];
      if (el instanceof HTMLSelectElement && c === "op-agrupar") {
        if ((AGRUPAMENTOS_DO_QUADRO as readonly string[]).includes(el.value)) mudarOpcao({ agrupar: el.value as ExibirDoQuadro["agrupar"] }, "#qm-agrupar");
        return true;
      }
      if (el instanceof HTMLSelectElement && c === "op-ordenar") {
        if ((ORDENS_DO_QUADRO as readonly string[]).includes(el.value)) mudarOpcao({ ordenar: el.value as ExibirDoQuadro["ordenar"] }, "#qm-ordenar");
        return true;
      }
      const nt = el.dataset["nt"];
      if (!nt || !modal) return false;
      if (nt === "outra" && el instanceof HTMLInputElement) { modal = { ...modal, criarOutra: el.checked }; return true; }
      if (!(el instanceof HTMLSelectElement)) return false;
      if (nt === "coluna" && d.colunas().some((x) => x.id === el.value)) modal = { ...modal, coluna: el.value };
      else if (nt === "prioridade" && (PRIORIDADES as readonly string[]).includes(el.value)) modal = { ...modal, prioridade: el.value as Prioridade };
      else if (nt === "agente") modal = { ...modal, agente: el.value };
      else return true;
      d.desenhar();
      d.focar(`.qm-modal [data-nt="${nt}"]`);
      return true;
    },

    /** O que a pessoa digita (a busca do funil e os campos do modal); true = tratou. */
    aoDigitar(el: HTMLElement): boolean {
      if (el instanceof HTMLInputElement && el.id === "qm-fil-busca") {
        buscaFiltro = el.value.slice(0, 80);
        campo = null;
        d.desenhar();
        d.focar("#qm-fil-busca");
        return true;
      }
      if (!modal) return false;
      if (el instanceof HTMLInputElement && el.id === "qm-nt-tit") { modal = { ...modal, titulo: el.value, erro: null }; return true; }
      if (el instanceof HTMLTextAreaElement && el.id === "qm-nt-desc") { modal = { ...modal, descricao: el.value }; return true; }
      return false;
    },

    aoEnviar(form: HTMLFormElement): boolean {
      if (form.dataset["form"] !== "nova-tarefa-modal") return false;
      void enviarModal();
      return true;
    },

    /** Esc, ⌘↵, o Tab preso no modal, a seta no funil e o atalho C; true = tratou (e já preveniu o padrão). */
    aoTeclar(ev: KeyboardEvent, digitando: boolean): boolean {
      const doc = (ev.target as Node | null)?.ownerDocument ?? (typeof document === "undefined" ? null : document);
      const raiz = doc?.querySelector(SEL_MODAL);
      if (modal && doc && raiz) {
        if (ev.key === "Escape") { ev.preventDefault(); fecharModal(); return true; }
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void enviarModal(); return true; }
        if (ev.key === "Enter" && (ev.target as Element | null)?.id === "qm-nt-tit") { ev.preventDefault(); d.focar("#qm-nt-desc"); return true; }
        if (ev.key === "Tab") {
          const fs = focaveisDe(raiz);
          const i = fs.indexOf(doc.activeElement as HTMLElement);
          if (i === -1 || (ev.shiftKey ? i === 0 : i === fs.length - 1)) { ev.preventDefault(); (ev.shiftKey ? fs.at(-1) : fs[0])?.focus(); }
          return true;
        }
        return false;
      }
      const alvo = ev.target as Element | null;
      // O Esc no campo da meta é de quadro-na-tela.ts (desiste e devolve o foco ao item Meta, com o menu aberto).
      if (aberto === "quadro" && ev.key === "Escape" && alvo?.id === "qd-meta-in") return false;
      if (aberto === "quadro" && ev.key === "Escape" && passo) { ev.preventDefault(); passo = null; d.desenhar(); d.focar('#qm-pop-quadro [data-act="qmenu-prazo"]'); return true; }
      if (aberto && ev.key === "Escape") {
        ev.preventDefault();
        if (aberto === "filtros" && campo) { const c = campo; campo = null; d.desenhar(); d.focar(`[data-act="fil-campo"][data-campo="${c}"]`); return true; }
        const p = aberto;
        aberto = null;
        campo = null;
        passo = null;
        d.desenhar();
        d.focar(voltaDo(p));
        return true;
      }
      // O menu do quadro: setas, Home e End andam entre os itens (o foco dá a volta).
      if (aberto === "quadro" && /^(ArrowDown|ArrowUp|Home|End)$/.test(ev.key) && alvo?.closest?.("#qm-pop-quadro") && alvo.getAttribute("role") === "menuitem") {
        const itens = [...(alvo.ownerDocument?.querySelectorAll<HTMLElement>(MENU_ITENS) ?? [])];
        const i = itens.indexOf(alvo as HTMLElement);
        const n = itens.length;
        const j = ev.key === "Home" ? 0 : ev.key === "End" ? n - 1 : (i + (ev.key === "ArrowDown" ? 1 : -1) + n) % n;
        ev.preventDefault();
        itens[j]?.focus();
        return true;
      }
      if (aberto === "filtros" && ev.key === "ArrowRight") {
        const bt = (ev.target as Element | null)?.closest?.<HTMLElement>('[data-act="fil-campo"]');
        if (bt && !campo) { ev.preventDefault(); campo = bt.dataset["campo"] as CampoDoFiltro; d.desenhar(); d.focar(`#qm-sub-${campo} .qm-it`); return true; }
      }
      if (aberto === "filtros" && ev.key === "ArrowLeft" && campo && (ev.target as Element | null)?.closest?.(".qm-sub")) {
        ev.preventDefault(); const c = campo; campo = null; d.desenhar(); d.focar(`[data-act="fil-campo"][data-campo="${c}"]`); return true;
      }
      if ((ev.key === "c" || ev.key === "C") && !digitando && !ev.metaKey && !ev.ctrlKey && !ev.altKey && d.noQuadro() && d.podeCriar() && !d.celular()) {
        ev.preventDefault();
        abrirModal();
        return true;
      }
      return false;
    },
  };
}

export type BarraDoQuadro = ReturnType<typeof criarBarraDoQuadro>;
