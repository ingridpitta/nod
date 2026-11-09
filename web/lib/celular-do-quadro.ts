/**
 * ADA-18: o estado e os cliques do quadro no celular (as folhas da visão, do toque longo e do ⋯ do topo). Fica fora de
 * web/lib/quadro-na-tela.ts, que só chama `aoClicar` e `aoTeclar` antes dos seus e lê `folha()` ao desenhar. As ações
 * de dentro das folhas que já existem no quadro (Mover, Pessoas, Atividade, Ordem das colunas) fecham a folha e seguem
 * para o tratamento de sempre (ADR-148: a forma muda, as ações não).
 */
import type { VisaoDoQuadro } from "../../src/contracts/raio-x.ts";
import { VISOES_DO_QUADRO, type FolhaDoCelular, type PassoDaTarefa } from "../telas/quadro-celular.ts";

/** S9: segurar a linha 500 ms abre o menu da tarefa (o gesto é o de web/lib/toque-longo.ts, o mesmo da lista de bots). */
export const TOQUE_LONGO_DA_LINHA_MS = 500;

export interface PortasDoCelular {
  /** Troca a visão (a tela muda na hora; quem chama guarda no Exibir do quadro). */
  trocarVisao(v: VisaoDoQuadro): void;
  redesenhar(): void;
  /** Leva o foco ao primeiro elemento visível que casa com o seletor, dentro da vista do quadro. */
  focar(seletor: string): void;
  /** Atribuir do toque longo: o mesmo `mudar_tarefa {agente}` do Responsável da tarefa aberta. */
  atribuir(tarefa: string, agente: string | null): void;
  /** Copiar link do toque longo: `?tarefa=` (S5). */
  copiarLink(tarefa: string): void;
  /** O prazo do quadro escolhido na folha do ⋯ (null = sem prazo): o mesmo `editar {prazo}` do topo do computador. */
  definirPrazo(prazo: string | null): void;
}

/** De onde a folha abriu: o foco volta para lá ao fechar. */
function origemDa(f: FolhaDoCelular): string {
  if (f.tipo === "visao") return '.qd-cel-topo [data-act="cel-visao"]';
  if (f.tipo === "topo") return '.qd-cel-topo [data-act="cel-topo"]';
  return `.qd-cel [data-tarefa="${cssEsc(f.tarefa)}"] [data-act="abrir-tarefa"]`;
}

function cssEsc(s: string): string {
  const c = (globalThis as { CSS?: { escape(s: string): string } }).CSS;
  return c ? c.escape(s) : s.replace(/["\\]/g, "\\$&");
}

/**
 * QA do PR #700 (medido em 2026-11-08 no Chrome a 390×844): um frame que regrava o quadro com a folha aberta (o turno que
 * termina, a tarefa nova de outra pessoa) recriava os itens e o foco caía no body, fora da folha modal. O item focado
 * vira um seletor (a ação e os data-* que o distinguem) para o desenho devolver o foco ao item recriado; o que não dá para
 * apontar (a própria folha, um valor estranho) volta à folha. Fora da folha, null.
 */
export function seletorDoFocoDaFolha(el: { dataset: Record<string, string | undefined>; closest(sel: string): unknown }): string | null {
  if (!el.closest(".qd-cel-folha")) return null;
  const act = el.dataset["act"];
  if (!act || !/^[a-z-]{1,48}$/.test(act)) return ".qd-cel-folha";
  let s = `.qd-cel-folha [data-act="${act}"]`;
  for (const k of ["visao", "passo", "coluna", "tarefa", "agente", "prazo"]) {
    const v = el.dataset[k];
    if (v === undefined) continue;
    if (!/^[A-Za-z0-9_-]{0,64}$/.test(v)) return ".qd-cel-folha";
    s += `[data-${k}="${v}"]`;
  }
  return s;
}

/** As ações de dentro das folhas que são do quadro de sempre: fecham a folha e seguem. */
const SEGUEM = new Set(["col-folha", "painel-pessoas", "painel-atividade", "tarefa-mover", "tarefa-mover-para", "editar-meta", "abrir-tarefa", "trazer-linear", "remover-quadro"]);

export function criarCelularDoQuadro(p: PortasDoCelular) {
  let aberta: FolhaDoCelular | null = null;

  function abrir(f: FolhaDoCelular | null, foco?: string): void {
    const antes = aberta;
    aberta = f;
    p.redesenhar();
    if (f) p.focar(foco ?? ".qd-cel-folha [role=menuitemradio][aria-checked=true], .qd-cel-folha [role=menuitem], .qd-cel-folha");
    else if (antes) p.focar(foco ?? origemDa(antes));
  }

  return {
    folha: (): FolhaDoCelular | null => aberta,
    abrir,
    fechar(foco?: string): void { if (aberta) abrir(null, foco); },
    /** true = tratou (quem chama para). As que seguem fecham a folha sem redesenhar e devolvem false. */
    aoClicar(el: HTMLElement, act: string | undefined): boolean {
      if (act === "cel-visao") { abrir(aberta?.tipo === "visao" ? null : { tipo: "visao" }); return true; }
      if (act === "cel-topo") { abrir(aberta?.tipo === "topo" ? null : { tipo: "topo" }); return true; }
      if (act === "cel-fechar") { abrir(null); return true; }
      // Revisão do PR #700: o botão Ações da linha (leitor de tela) abre o mesmo menu do toque longo.
      if (act === "cel-menu-tarefa") { const id = el.dataset["id"]; if (id) abrir({ tipo: "tarefa", tarefa: id }, ".qd-cel-folha [role=menuitem]"); return true; }
      if (act === "cel-topo-passo" && aberta?.tipo === "topo") {
        abrir({ tipo: "topo", passo: "prazo" }, ".qd-cel-folha [aria-checked=true]");
        return true;
      }
      if (act === "cel-prazo" && aberta?.tipo === "topo") {
        const v = el.dataset["prazo"] ?? "";
        abrir(null);
        p.definirPrazo(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
        return true;
      }
      if (act === "cel-tarefa-passo" && aberta?.tipo === "tarefa") {
        const passo = el.dataset["passo"];
        if (passo === "mover" || passo === "atribuir") abrir({ tipo: "tarefa", tarefa: aberta.tarefa, passo: passo as PassoDaTarefa }, ".qd-cel-folha [aria-checked=true], .qd-cel-folha [role=menuitemradio]");
        return true;
      }
      if (act === "cel-atribuir" && aberta?.tipo === "tarefa") {
        const tarefa = aberta.tarefa;
        abrir(null);
        p.atribuir(tarefa, el.dataset["agente"] || null);
        return true;
      }
      if (act === "cel-copiar-link" && aberta?.tipo === "tarefa") {
        const tarefa = aberta.tarefa;
        abrir(null);
        p.copiarLink(tarefa);
        return true;
      }
      if (act === "cel-visao-escolher") {
        const v = el.dataset["visao"];
        aberta = null;
        if (v && (VISOES_DO_QUADRO as readonly string[]).includes(v)) p.trocarVisao(v as VisaoDoQuadro);
        else p.redesenhar();
        p.focar('.qd-cel-topo [data-act="cel-visao"]');
        return true;
      }
      if (aberta && act && SEGUEM.has(act) && el.closest(".qd-cel-folha")) aberta = null;
      return false;
    },
    /** A data de "Outra data" na folha do prazo: grava e fecha (data inválida não faz nada). */
    aoEscolherData(valor: string): void {
      if (aberta?.tipo !== "topo" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return;
      abrir(null);
      p.definirPrazo(valor);
    },
    /** O toque longo (ou Shift+F10 / a tecla de menu na linha) abre o menu da tarefa. */
    menuDaTarefa(tarefa: string): void { abrir({ tipo: "tarefa", tarefa }, ".qd-cel-folha [role=menuitem]"); },
    /** Esc fecha a folha aberta (o foco volta a quem a abriu); na escolha do Mover ou do Atribuir, volta ao menu. true = tratou. */
    aoTeclar(ev: KeyboardEvent): boolean {
      if (ev.key !== "Escape" || !aberta) return false;
      if (aberta.tipo === "tarefa" && aberta.passo) {
        ev.preventDefault();
        abrir({ tipo: "tarefa", tarefa: aberta.tarefa }, `.qd-cel-folha [data-passo="${aberta.passo}"]`);
        return true;
      }
      if (aberta.tipo === "topo" && aberta.passo) {
        ev.preventDefault();
        abrir({ tipo: "topo" }, '.qd-cel-folha [data-passo="prazo"]');
        return true;
      }
      ev.preventDefault();
      abrir(null);
      return true;
    },
  };
}

export type CelularDoQuadroNaTela = ReturnType<typeof criarCelularDoQuadro>;
