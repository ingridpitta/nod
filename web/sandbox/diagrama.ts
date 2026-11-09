import mermaid from "mermaid";
import { LIMITE_CARACTERES, type TemaDoDiagrama } from "../lib/diagrama.ts";
import { configDoMermaid, svgComTamanho } from "../lib/diagrama-config.ts";

/**
 * O renderizador de diagramas (NOD-328): roda SÓ dentro do iframe sandbox de origem opaca (web/lib/diagrama.ts,
 * documentoDoRenderizador) e nunca na página do nod. Recebe o código, devolve o texto do SVG; o pai confere e mostra
 * como <img>. Um pedido por vez (fila serial): o render pesado não empilha.
 */

const canal = document.documentElement.dataset.canal ?? "";
const pai = window.parent;
let temaAtual = "";
let fila: Promise<void> = Promise.resolve();
let contador = 0;

function enviar(m: Record<string, unknown>): void {
  try {
    pai.postMessage({ ...m, canal }, "*");
  } catch {
    // o pai sumiu: nada a fazer
  }
}

const CAMPOS_DO_TEMA = ["fundo", "superficie", "tinta", "tinta2", "linha", "linhaForte", "fonte"] as const;

function lerTema(v: unknown): TemaDoDiagrama | null {
  if (typeof v !== "object" || v === null) return null;
  const t = v as Record<string, unknown>;
  if (typeof t.escuro !== "boolean") return null;
  const campo = (c: (typeof CAMPOS_DO_TEMA)[number]): string | null => {
    const valor = t[c];
    return typeof valor === "string" && !/[<>]/.test(valor) ? valor : null;
  };
  const [fundo, superficie, tinta, tinta2, linha, linhaForte, fonte] = CAMPOS_DO_TEMA.map(campo);
  if (fundo == null || superficie == null || tinta == null || tinta2 == null || linha == null || linhaForte == null || fonte == null) return null;
  return { escuro: t.escuro, fundo, superficie, tinta, tinta2, linha, linhaForte, fonte };
}

function motivoDoErro(e: unknown): "limite" | "erro" {
  const msg = e instanceof Error ? e.message : String(e);
  return /maximum text size|edge limit|too many edges|maxEdges/i.test(msg) ? "limite" : "erro";
}

async function desenhar(id: string, codigo: string, tema: TemaDoDiagrama): Promise<void> {
  try {
    const chave = JSON.stringify(tema);
    if (chave !== temaAtual) {
      mermaid.initialize(configDoMermaid(tema));
      temaAtual = chave;
    }
    if (codigo.length > LIMITE_CARACTERES) return enviar({ nod: "diagrama-falhou", id, motivo: "limite" });
    const valido = await mermaid.parse(codigo, { suppressErrors: true });
    if (!valido) return enviar({ nod: "diagrama-falhou", id, motivo: "invalido" });
    contador += 1;
    const { svg } = await mermaid.render(`nod-diagrama-${contador}`, codigo);
    const pronto = svgComTamanho(svg);
    if (!pronto) return enviar({ nod: "diagrama-falhou", id, motivo: "erro" });
    enviar({ nod: "diagrama-svg", id, svg: pronto.svg, largura: pronto.largura, altura: pronto.altura });
  } catch (e) {
    enviar({ nod: "diagrama-falhou", id, motivo: motivoDoErro(e) });
  } finally {
    // O mermaid deixa o contêiner temporário quando o render falha no meio.
    for (const sobra of document.querySelectorAll("body > div[id^='dnod-diagrama-'], body > svg[id^='nod-diagrama-']")) sobra.remove();
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== pai) return;
  const d: unknown = ev.data;
  if (typeof d !== "object" || d === null) return;
  const m = d as Record<string, unknown>;
  if (m.nod !== "diagrama" || m.canal !== canal || typeof m.id !== "string" || typeof m.codigo !== "string") return;
  const tema = lerTema(m.tema);
  if (!tema) return;
  const { id, codigo } = m;
  fila = fila.then(() => desenhar(id, codigo, tema));
});

enviar({ nod: "diagrama-pronto" });
