import { ajustarAltura, arquivosDaColagem, criarBarra, escolherMencao, htmlSugestoes, sugestoesDaMencao, teclaDoCampo, type Barra, type ContextoDaBarra } from "./composer.ts";

/**
 * ADA-5 (definido em 2026-11-04): a parte de DOM do composer (os ouvintes no documento). Fica fora de composer.ts para
 * que os testes unitários das peças puras não puxem os tipos do DOM para o typecheck do servidor.
 */

/** O que a pílula (ou outro composer ligado por `ligarComposer`) pede a quem a monta. */
export interface DepsDoComposer {
  /** O seletor do composer (o form): os eventos de fora dele não são deste composer. */
  raiz: string;
  celular(): boolean;
  /** Os nomes da menção @ (os bots da pessoa). */
  sugestoes(): readonly string[];
  barra?: { contexto(): ContextoDaBarra; recarregar?(): Promise<void> | null };
  /** Colar ou escolher arquivos no clipe. Sem isto, o composer não anexa. */
  anexar?(arquivos: File[]): void;
  /** O bot da tela lê anexo agora? Sem isto, sim. Não: colar segue como texto. */
  aceitaAnexo?(): boolean;
  /** Este composer está à vista? Sem isto, sim. O Quadro escondido (de volta à Conversa) não toma o soltar do chat. */
  ativo?(): boolean;
  /** O ditado grava neste composer: o Esc é dele (ADR-095, descarta), não do campo. */
  gravando?(): boolean;
  /** Esc com texto: quem sai do campo (sem isto, blur). O Quadro manda o foco à tarefa aberta (QA do ADA-5). */
  sair?(ta: HTMLTextAreaElement): void;
  /** A cada mudança do texto (o rascunho, o Enviar ⇄ Parar). */
  aoMudar?(ta: HTMLTextAreaElement): void;
  enviar(ta: HTMLTextAreaElement): void;
}

export interface ComposerLigado {
  barra: Barra;
  /** Depois de escrever no campo por fora (rascunho, ditado, envio): altura, listas e o aoMudar. */
  atualizar(ta: HTMLTextAreaElement): void;
}

/**
 * Liga um composer por delegação no documento (o nó do composer pode ser regravado: os ouvintes ficam). O campo é o
 * `textarea` dentro da raiz; as listas são `[data-composer="mencao"]`, `[data-composer="barra"]` e
 * `[data-composer="dica"]`; o clipe é `[data-composer="clipe"]` com o `input[type=file]` `[data-composer="arquivos"]`.
 * Os ouvintes de teclado entram na fase de captura: as listas e o Esc com texto vêm antes de quem fecha a tarefa.
 */
export function ligarComposer(doc: Document, d: DepsDoComposer): ComposerLigado {
  const raizDe = (el: EventTarget | null): HTMLElement | null => (el instanceof Element ? el.closest<HTMLElement>(d.raiz) : null);
  const raiz = (): HTMLElement | null => doc.querySelector<HTMLElement>(d.raiz);
  const peca = (nome: string): HTMLElement | null => raiz()?.querySelector<HTMLElement>(`[data-composer="${nome}"]`) ?? null;
  const campoDe = (r: HTMLElement | null): HTMLTextAreaElement | null => r?.querySelector<HTMLTextAreaElement>("textarea") ?? null;
  const barra = criarBarra({
    lista: () => peca("barra"),
    dica: () => peca("dica"),
    contexto: () => d.barra?.contexto() ?? { dto: null, recentes: [], atalhos: false, botProprio: false, bot: "o bot" },
    ...(d.barra?.recarregar ? { recarregar: () => d.barra?.recarregar?.() ?? null } : {}),
  });
  const fecharMencao = () => { const m = peca("mencao"); if (m) { m.hidden = true; m.innerHTML = ""; } };
  const atualizar = (ta: HTMLTextAreaElement) => {
    ajustarAltura(ta);
    d.aoMudar?.(ta);
    if (d.barra) barra.atualizar(ta);
    const m = peca("mencao");
    if (!m) return;
    const lista = sugestoesDaMencao(ta.value, ta.selectionStart ?? ta.value.length, d.sugestoes());
    m.hidden = lista.length === 0;
    m.innerHTML = htmlSugestoes(lista);
  };

  doc.addEventListener("input", (ev) => {
    const ta = ev.target;
    if (!(ta instanceof HTMLTextAreaElement) || !raizDe(ta)) return;
    atualizar(ta);
  });
  doc.addEventListener("keydown", (ev) => {
    const ta = ev.target;
    if (!(ta instanceof HTMLTextAreaElement) || !raizDe(ta) || ev.defaultPrevented) return;
    if (ev.key === "Escape" && d.gravando?.()) return;
    if (d.barra && barra.tecla(ev, ta)) { ev.preventDefault(); ev.stopPropagation(); return; }
    const m = peca("mencao");
    if (ev.key === "Escape" && m && !m.hidden) { ev.preventDefault(); ev.stopPropagation(); fecharMencao(); return; }
    const acao = teclaDoCampo(ev, { celular: d.celular(), valor: ta.value });
    if (acao === "sair") { ev.preventDefault(); ev.stopPropagation(); fecharMencao(); barra.fechar(); if (d.sair) d.sair(ta); else ta.blur(); return; }
    if (acao === "enviar") { ev.preventDefault(); ev.stopPropagation(); fecharMencao(); barra.fechar(); d.enviar(ta); }
  }, true);
  doc.addEventListener("mousedown", (ev) => {
    const r = raizDe(ev.target);
    const ta = campoDe(r);
    if (!r || !ta || !(ev.target instanceof Element)) return;
    const item = ev.target.closest<HTMLElement>(".barra-item");
    if (item) { ev.preventDefault(); barra.escolherIndice(ta, Number(item.dataset["indice"])); atualizar(ta); return; }
    const sug = ev.target.closest<HTMLElement>(".sug");
    if (sug) { ev.preventDefault(); escolherMencao(ta, sug.dataset["nome"] ?? ""); fecharMencao(); atualizar(ta); }
  });
  doc.addEventListener("paste", (ev) => {
    if (!d.anexar || !raizDe(ev.target) || d.aceitaAnexo?.() === false) return;
    const arquivos = arquivosDaColagem(ev.clipboardData);
    if (arquivos.length === 0) return;
    ev.preventDefault();
    d.anexar(arquivos);
  });
  doc.addEventListener("change", (ev) => {
    const input = ev.target;
    if (!d.anexar || !(input instanceof HTMLInputElement) || input.dataset["composer"] !== "arquivos" || !raizDe(input)) return;
    const arquivos = Array.from(input.files ?? []);
    input.value = "";
    if (arquivos.length > 0) d.anexar(arquivos);
  });
  // Revisão 4 do ADA-5 (definido em 2026-11-04): arrastar arquivos com este composer na tela anexa nele, sem depender
  // do campo do chat. Captura e preventDefault: o soltar do chat (web/main.ts) vê defaultPrevented e não anexa de novo.
  const aceitaSoltar = (ev: DragEvent): boolean =>
    !!d.anexar && !!raiz() && d.ativo?.() !== false && d.aceitaAnexo?.() !== false && [...(ev.dataTransfer?.types ?? [])].includes("Files");
  let arrastos = 0;
  const marcar = (sim: boolean) => { const r = raiz(); if (r && r.hasAttribute("data-soltando") !== sim) r.toggleAttribute("data-soltando", sim); };
  doc.addEventListener("dragenter", (ev) => { if (!aceitaSoltar(ev)) return; ev.preventDefault(); arrastos += 1; marcar(true); }, true);
  doc.addEventListener("dragover", (ev) => { if (aceitaSoltar(ev)) ev.preventDefault(); }, true);
  doc.addEventListener("dragleave", (ev) => { if (!aceitaSoltar(ev)) return; arrastos = Math.max(0, arrastos - 1); if (arrastos === 0) marcar(false); }, true);
  doc.addEventListener("drop", (ev) => {
    if (!aceitaSoltar(ev)) return;
    ev.preventDefault();
    arrastos = 0;
    marcar(false);
    const arquivos = Array.from(ev.dataTransfer?.files ?? []);
    if (arquivos.length > 0) d.anexar?.(arquivos);
    campoDe(raiz())?.focus();
  }, true);
  doc.addEventListener("focusout", (ev) => {
    // A lista fecha quando o foco sai do composer (o clique numa sugestão é mousedown com preventDefault: o foco fica).
    const r = raizDe(ev.target);
    if (!r || (ev.relatedTarget instanceof Node && r.contains(ev.relatedTarget))) return;
    fecharMencao();
    barra.fechar();
  });
  return { barra, atualizar };
}
