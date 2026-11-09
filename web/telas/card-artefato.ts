import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { botao, esc } from "../lib/render.ts";

export type PayloadArtefato = Extract<NonNullable<Mensagem["payload"]>, { kind: "artefato" }>;

/**
 * O card do artefato (ADR-051) como STRING da timeline: cabeçalho (▣ título · vN; a hora fica no nome do bot acima
 * desde 2026-10-03, conversa.ts renderMensagem), "Tela cheia",
 * "Baixar .html" e um slot VAZIO. O iframe entra depois, por artefatos-vivos.ts — assim o HTML da timeline
 * não muda quando a pessoa marca algo ou quando a altura se ajusta, e a região não é regravada por isso
 * (web/lib/regioes.ts só troca o innerHTML quando o texto muda). Versão anterior fica recolhida num
 * <details data-disclosure>, que main.ts reabre entre renders; só a versão atual grava estado.
 * Sem DOM aqui: conversa.ts (e o teste unitário) importam este arquivo.
 */
const EXTERNO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>';

/**
 * definido em 2026-10-03: "Abrir em nova aba" antes de "Tela cheia" (artefatos-vivos.ts novaAba). Fora do app do Mac:
 * lá o Electron recusa abrir janela que não seja http(s) (desktop/main.ts setWindowOpenHandler), e o botão não faria nada.
 */
function novaAba(dados: Record<string, string>): string {
  if ("nodDesktop" in globalThis) return "";
  return botao("artefato-nova-aba", `Abrir em nova aba ${EXTERNO}`, { classe: "link sm artefato-nova-aba", dados, titulo: "Abre o artefato sozinho numa aba nova do navegador" });
}

export function renderCardArtefato(m: Mensagem, p: PayloadArtefato, versaoMaisRecente: number): string {
  const anterior = p.versao < versaoMaisRecente;
  const naoConfiavel = m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="publicado num turno que leu conteúdo de fora">não confiável</span>' : "";
  const dados = { mensagem: m.id };
  const slot = `<div class="artefato-corpo" data-artefato-slot="${esc(m.id)}"></div>`;
  return `<section class="artefato" data-artefato="${esc(p.artefatoId)}" data-versao="${p.versao}" data-mensagem-artefato="${esc(m.id)}" data-titulo="${esc(p.titulo)}">
    <header class="artefato-cab"><span class="artefato-marca" aria-hidden="true">▣</span><b class="artefato-titulo">${esc(p.titulo)}</b><span class="artefato-meta">v${p.versao}</span>${naoConfiavel}<span class="artefato-status" role="status"></span><span class="artefato-acoes">${novaAba(dados)}${botao("artefato-tela-cheia", "Tela cheia", { classe: "link sm", dados })}${botao("artefato-baixar", "Baixar .html", { classe: "link sm", dados })}</span></header>
    ${anterior ? `<details class="artefato-anterior" data-disclosure="artefato-${esc(m.id)}"><summary>Versão anterior · a atual é a v${versaoMaisRecente}</summary>${slot}</details>` : slot}
  </section>`;
}
