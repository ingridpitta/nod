import type { RotinaDto, WebhookDaRotinaDto } from "../../src/contracts/api.ts";
import type { ChamadaWebhook } from "../../src/contracts/rotina.ts";
import { avisoErro } from "../lib/card-proposta.ts";
import { VIVO } from "../lib/copiar.ts";
import { dataHora, esc } from "../lib/render.ts";

/**
 * NOD-84 (protótipo v3 do Gil, ADR-139): o que a tela mostra de uma rotina por webhook. Um módulo só, para a troca pelo
 * componente comum da NOD-399 (PR #607) acontecer num lugar: o bloco do endereço (no card encolhido e na gaveta), as
 * últimas chamadas e o "!" da recusada. O endereço inteiro nunca está no HTML: o Copiar o busca na hora
 * (`GET /rotinas/:id/endereco`, só a dona, no-store); a tela só tem o prefixo mascarado.
 */

/** O raio do "Quando disparar" (no lugar do relógio da rotina de horário). */
export const ICONE_RAIO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>';
const ICONE_COPIAR = '<svg class="wh-cp-a" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const ICONE_COPIADO = '<svg class="wh-cp-b" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
/** O "!" de 13 px em --danger: o único sinal vermelho do webhook. Desenho; o texto vai ao lado ou em sr-only. */
export const EXCLAMACAO = '<span class="wh-excl" aria-hidden="true">!</span>';

/** A origem do nod como a pessoa o abriu (o endereço público é o mesmo host). Fora do navegador (testes), vazia. */
export const origemDaTela = (): string => (globalThis as { location?: { origin: string } }).location?.origin ?? "";

/** HH:MM no fuso da rotina (o mesmo do "mesmo dia"), não no do navegador. */
const horaNoFuso = (em: number, fuso: string): string => dataHora(em, fuso).slice(-5);

export const ehRotinaWebhook = (dto: Pick<RotinaDto, "rotina">): boolean => dto.rotina.gatilho === "webhook";

/** O endereço como a tela mostra: a origem, `/api/w/` e o prefixo, mascarado. O Copiar leva o inteiro. */
export function enderecoMascarado(origem: string, prefixo: string | null): string {
  const host = origem.replace(/^https?:\/\//, "");
  return prefixo ? `${host}/api/w/${prefixo}••••` : `${host}/api/w/••••`;
}

/** O botão-ícone de copiar: ✓ por 2 s e "Copiado" na região viva (o handler `webhook-copiar` em main.ts). */
export function botaoCopiarEndereco(rotinaId: string): string {
  return `<button type="button" class="bt wh-copiar" data-act="webhook-copiar" data-id="${esc(rotinaId)}" aria-label="Copiar endereço" title="Copiar endereço">${ICONE_COPIAR}${ICONE_COPIADO}<span class="sr-only wh-vivo" ${VIVO}></span></button>`;
}

/** "Esperando a primeira chamada." ou "última às 10:42". */
export function fraseDaUltima(w: WebhookDaRotinaDto, fuso: string, agora: number): string {
  const u = w.ultimas[0];
  if (!u) return "Esperando a primeira chamada.";
  const mesmoDia = dataHora(u.em, fuso).slice(0, 5) === dataHora(agora, fuso).slice(0, 5);
  return mesmoDia ? `Última chamada às ${horaNoFuso(u.em, fuso)}.` : `Última chamada em ${dataHora(u.em, fuso)}.`;
}

/** O bloco do endereço no card encolhido (protótipo: `wh-endereco` + o rodapé com "Enviar teste"). */
export function enderecoNoCard(dto: RotinaDto, origem: string, agora: number): string {
  const w = dto.webhook;
  if (!w) return "";
  return `<div class="wh-endereco"><div class="wh-end-campo"><code class="wh-url" title="Copiar leva o endereço inteiro">${esc(enderecoMascarado(origem, w.prefixo))}</code>${botaoCopiarEndereco(dto.rotina.id)}</div>
    <p class="ce-rodape"><span>Só você vê o endereço; o bot não. ${esc(fraseDaUltima(w, dto.rotina.fusoIana, agora))}</span><button type="button" class="bt link wh-teste" data-act="webhook-testar" data-id="${esc(dto.rotina.id)}" data-agente="${esc(dto.rotina.agenteId)}"${dto.rotina.estado === "pausada" ? ' disabled title="Ative a rotina para testar"' : ""}>Enviar teste</button></p></div>`;
}

/** "Recusada": o motivo em palavras e o que fazer. */
const MOTIVO: Record<NonNullable<ChamadaWebhook["motivo"]>, string> = {
  endereco: "Veio com um endereço antigo ou errado; nada rodou. Confira o endereço colado no provedor.",
  assinatura: "A assinatura do GitHub não confere; nada rodou. Copie o segredo de novo no GitHub.",
};

/** O desfecho de cada chamada, escrito (o protótipo: Rodou, Outro evento, ignorei, Fila cheia…, Recusada, Teste). */
export function rotuloDaChamada(c: Pick<ChamadaWebhook, "desfecho" | "evento">, provedor: string | null): string {
  switch (c.desfecho) {
    case "rodou": return "Rodou";
    case "teste": return "Teste";
    case "ignorada": return c.evento === "ping" ? `${provedor ?? "GitHub"} conectou` : "Outro evento, ignorei";
    case "fila_cheia": return "Fila cheia, pedi para tentar depois";
    case "recusada": return "Recusada";
    case "pausada": return "Rotina pausada, não rodou";
    case "bloqueada": return "Parada por falta de acesso";
  }
}

/** "3 chamadas hoje · ! 1 recusada" (o "!" é desenho; o leitor de tela ouve "1 recusada"). */
export function resumoDasChamadas(w: Pick<WebhookDaRotinaDto, "chamadasHoje" | "recusadasHoje">): string {
  const n = w.chamadasHoje;
  const base = `${n} ${n === 1 ? "chamada" : "chamadas"} hoje`;
  if (!w.recusadasHoje) return esc(base);
  return `${esc(base)} · ${EXCLAMACAO}${esc(` ${w.recusadasHoje} ${w.recusadasHoje === 1 ? "recusada" : "recusadas"}`)}`;
}

/** Últimas chamadas na gaveta: as 10 mais novas; a recusada com o "!" no lugar do ponto e o motivo embaixo. */
export function blocoDasChamadas(dto: RotinaDto): string {
  const w = dto.webhook;
  if (!w) return "";
  if (!w.ultimas.length) {
    return `<section class="gv-bloco wh-chamadas"><h3>Últimas chamadas</h3><p class="mudo">Esperando a primeira chamada.</p></section>`;
  }
  const itens = w.ultimas.slice(0, 10).map((c) => {
    const recusada = c.desfecho === "recusada";
    const marca = recusada ? EXCLAMACAO : '<span class="gv-exec-ponto" aria-hidden="true"></span>';
    const evento = c.evento && c.evento !== "ping" ? ` · ${esc(c.evento)}` : "";
    const motivo = recusada && c.motivo ? `<small class="wh-motivo">${esc(MOTIVO[c.motivo])}</small>` : "";
    return `<li class="exec wh-ch wh-ch-${esc(c.desfecho)}">${marca}<span class="gv-exec-quando">${esc(dataHora(c.em, dto.rotina.fusoIana))}</span><span>${esc(rotuloDaChamada(c, w.provedor))}${evento}</span>${motivo}</li>`;
  }).join("");
  // A recusa ainda não superada vira o aviso de erro comum (NOD-399): a frase, o motivo e o que fazer, no topo do bloco.
  const recusa = w.recusaPendente ? w.ultimas.find((c) => c.desfecho === "recusada") : undefined;
  const aviso = recusa ? avisoErro({ frase: "A última chamada foi recusada; nada rodou.", mais: recusa.motivo ? MOTIVO[recusa.motivo] : "Confira o endereço colado no provedor.", solto: true, classe: "wh-aviso" }) : "";
  return `<section class="gv-bloco wh-chamadas"><h3>Últimas chamadas</h3>${aviso}<p class="wh-gv-resumo">${resumoDasChamadas(w)}</p><ul class="gv-execucoes">${itens}</ul></section>`;
}

/** O bloco Endereço da gaveta: mascarado, copiar, "Copiar segredo (GitHub)" e "Gerar novo endereço" com a confirmação no lugar. */
export function blocoDoEndereco(dto: RotinaDto, origem: string, dona: boolean): string {
  const w = dto.webhook;
  if (!w) return "";
  const id = esc(dto.rotina.id);
  if (!dona) return `<section class="gv-bloco"><h3>Endereço</h3><p class="mudo">Só a dona da rotina vê o endereço.</p></section>`;
  const prov = (w.provedor ?? "").trim().toLowerCase();
  const github = prov === "gh" || prov.replace(/[^a-z]/g, "").includes("github"); // o mesmo teste de exigeAssinatura (domínio)
  return `<section class="gv-bloco"><h3>Endereço</h3>
    <div class="wh-endereco"><div class="wh-end-campo"><code class="wh-url" title="Copiar leva o endereço inteiro">${esc(enderecoMascarado(origem, w.prefixo))}</code>${botaoCopiarEndereco(dto.rotina.id)}</div></div>
    <p class="wh-acoes">${github ? `<button type="button" class="bt link" data-act="webhook-copiar-segredo" data-id="${id}" ${VIVO}>Copiar segredo (GitHub)</button>` : ""}<button type="button" class="bt link" data-act="webhook-gerar" data-id="${id}" aria-expanded="false" aria-controls="wh-confirma-${id}">Gerar novo endereço</button></p>
    <div class="wh-confirma" id="wh-confirma-${id}" role="alertdialog" aria-labelledby="wh-confirma-t-${id}" hidden><p id="wh-confirma-t-${id}">Gerar um endereço novo? ${github ? "O antigo e o segredo param na hora; cole o endereço e o segredo novos no GitHub." : `O antigo para na hora; cole o novo no ${esc(w.provedor ?? "provedor")}.`}</p>
      <div class="acoes"><button type="button" class="bt pri" data-act="webhook-gerar-confirmar" data-id="${id}">Gerar novo</button><button type="button" class="bt" data-act="webhook-gerar-cancelar" data-id="${id}">Cancelar</button></div></div>
  </section>`;
}

/** A linha da lista de Rotinas: "Quando o Stripe avisa · última às 10:42" e, com recusa pendente, o "!" (com texto ao leitor). */
export function quandoNaLista(dto: RotinaDto): { quando: string; marca: string } {
  const w = dto.webhook;
  const u = w?.ultimas.find((c) => c.desfecho !== "recusada" && !(c.desfecho === "ignorada" && c.evento === "ping"));
  const quando = [dto.resumo ?? "", u ? `última às ${horaNoFuso(u.em, dto.rotina.fusoIana)}` : ""].filter(Boolean).join(" · ");
  const marca = w?.recusaPendente ? `${EXCLAMACAO}<span class="sr-only">, chamada recusada</span>` : "";
  return { quando, marca };
}

/**
 * A etiqueta da resposta de uma rotina por webhook: "teste" quando o turno é o do "Enviar teste", "webhook" quando
 * veio de uma chamada; null quando a rotina não é webhook (fica a etiqueta de sempre, "da rotina …").
 */
export function etiquetaDoWebhook(dto: RotinaDto | undefined, turnoIds: readonly (string | null)[]): string | null {
  if (!dto || !ehRotinaWebhook(dto)) return null;
  const ids = new Set(turnoIds.filter((t): t is string => !!t));
  const c = dto.webhook?.ultimas.find((x) => x.turnoId && ids.has(x.turnoId));
  return c?.desfecho === "teste" ? "teste" : "webhook";
}
