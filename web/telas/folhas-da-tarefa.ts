/**
 * ADA-17 (ADR-148, F2): o corpo das folhas da tarefa aberta no celular. Cada chip da bandeja abre uma folha com o valor
 * atual marcado (✓ e aria-checked), sem `<select>` nativo. HTML puro; todo texto de fora passa por `esc`.
 *
 * Os toques voltam por `data-folha-acao` (web/lib/folha.ts) e caem no MESMO caminho do select do computador
 * (`mudarNaTarefaAberta` em web/lib/quadro-na-tela.ts → quadro.mudar_tarefa). Nenhuma ação nova.
 */
import type { ColunaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/escape.ts";
import { opcoesDeStatus } from "../lib/quadro-dados.ts";
import { linkSeguro, numeroDoPr } from "./quadro-real.ts";

const MARCA = '<span class="qd-fo-marca" aria-hidden="true">✓</span>';

const item = (acao: string, valor: string, rotulo: string, marcado: boolean, extra = ""): string =>
  `<li><button type="button" class="qd-fo-op" role="radio" aria-checked="${marcado}" data-folha-acao="${esc(acao)}" data-valor="${esc(valor)}"${extra}>` +
  `<span class="qd-fo-rot">${esc(rotulo)}</span>${marcado ? MARCA : ""}</button></li>`;

/** Status: as colunas do quadro por grupo; "Precisa de você" só aparece se a tarefa já está lá (como no select). */
export function folhaDeStatus(t: Pick<TarefaDto, "status">, colunas: readonly Pick<ColunaDto, "id" | "nome" | "grupo">[]): string {
  const grupos = opcoesDeStatus(colunas);
  const conhecida = colunas.some((c) => c.id === t.status);
  return grupos.map((g) => {
    const itens = g.colunas.filter((c) => c.id !== "voce" || c.id === t.status).map((c) => item("status", c.id, c.nome, c.id === t.status)).join("");
    return itens ? `<div class="qd-fo-g" role="radiogroup" aria-label="${esc(g.grupo)}"><p class="qd-fo-gtit">${esc(g.grupo)}</p><ul class="qd-fo-ops">${itens}</ul></div>` : "";
  }).join("") + (conhecida ? "" : `<ul class="qd-fo-ops">${item("status", t.status, t.status, true)}</ul>`);
}

/**
 * Cancelar pede confirmação. Sem o "por quê": a rota PATCH da tarefa só repassa os campos da tarefa
 * (src/adapters/http/rotas/quadro.ts, CAMPOS_DA_TAREFA) e o `motivo` não chegaria (follow-up registrado no PR #699).
 */
export function folhaDeCancelar(titulo: string): string {
  return `<p class="qd-fo-frase">Cancelar <strong>${esc(titulo)}</strong>? O bot para e a tarefa sai do quadro ativo.</p>` +
    `<div class="qd-fo-acoes"><button type="button" class="qd-bt" data-folha-acao="status-voltar">Voltar</button>` +
    `<button type="button" class="qd-bt qd-bt-perigo" data-folha-acao="cancelar-ok" data-folha-foco>Cancelar tarefa</button></div>`;
}

/**
 * Responsável: busca, "Sem responsável" e os bots. Em "Precisa de você" o atual é Você (o responsável efetivo, como no
 * chip): nenhum bot aparece marcado. Sem a lista de bots, só leitura (quem chama não abre a folha).
 */
export function folhaDoResponsavel(t: Pick<TarefaDto, "status" | "agenteId" | "agenteNome">, bots: readonly { id: string; nome: string }[]): string {
  const comVoce = t.status === "voce";
  const lista = t.agenteId && !bots.some((b) => b.id === t.agenteId) ? [...bots, { id: t.agenteId, nome: t.agenteNome ?? "Outro bot" }] : bots;
  const busca = lista.length > 6
    ? `<label class="qd-sr" for="qd-fo-busca">Buscar bot</label><input id="qd-fo-busca" class="qd-fo-campo" type="search" data-folha-busca placeholder="Buscar" autocomplete="off">` : "";
  const voce = comVoce ? `<ul class="qd-fo-ops">${`<li><span class="qd-fo-op qd-fo-op-fixo" role="radio" aria-checked="true" aria-disabled="true"><span class="qd-fo-rot">Você</span>${MARCA}</span></li>`}</ul>` : "";
  const ninguem = `<ul class="qd-fo-ops">${item("agente", "", "Sem responsável", !comVoce && !t.agenteId)}</ul>`;
  const bots_ = lista.map((b) => item("agente", b.id, b.nome, !comVoce && b.id === t.agenteId, ` data-busca="${esc(b.nome.toLowerCase())}"`)).join("");
  return `${busca}<div role="radiogroup" aria-label="Responsável">${voce}${ninguem}${bots_ ? `<p class="qd-fo-gtit">Bots</p><ul class="qd-fo-ops">${bots_}</ul>` : ""}</div>`;
}

/** O filtro da busca do responsável: o que não casa fica escondido (o "Sem responsável" sempre fica). */
export function casaNaBusca(nome: string, termo: string): boolean {
  const n = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return !termo.trim() || n(nome).includes(n(termo));
}

/** O branch numa linha só (rola de lado dentro da linha, nunca a página) e o Copiar. */
export function folhaDoBranch(branch: string): string {
  return `<p class="qd-fo-linha"><code class="qd-fo-branch">${esc(branch)}</code></p>` +
    `<div class="qd-fo-acoes"><button type="button" class="qd-bt" data-folha-acao="copiar" data-valor="${esc(branch)}" data-folha-foco>Copiar</button></div>`;
}

/** "Mover para…" (S4): os outros quadros; escolher move (é a confirmação, como o botão Mover do computador). */
export function folhaDeMover(destinos: readonly { id: string; nome: string }[]): string {
  return `<ul class="qd-fo-ops">${destinos.map((d) => `<li><button type="button" class="qd-fo-op" data-folha-acao="mover" data-valor="${esc(d.id)}"><span class="qd-fo-rot">${esc(d.nome)}</span></button></li>`).join("")}</ul>`;
}

/** O toque longo no comentário: Responder (também no link visível do card) e Copiar texto. */
export function folhaDoComentario(): string {
  return `<ul class="qd-fo-ops"><li><button type="button" class="qd-fo-op" data-folha-acao="responder"><span class="qd-fo-rot">Responder</span></button></li>` +
    `<li><button type="button" class="qd-fo-op" data-folha-acao="copiar-com"><span class="qd-fo-rot">Copiar texto</span></button></li></ul>`;
}

/**
 * Ajustes: o painel de propriedades (chave → valor, linhas de 52). Status e Responsável abrem a folha deles; Quadro abre o
 * "Mover para…" quando há outro quadro; o branch fica numa linha só.
 */
export function folhaDeAjustes(o: { t: TarefaDto; q: QuadroDto; nomeStatus: string; nomeResp: string; podeResp: boolean; podeMover: boolean }): string {
  const { t, q } = o;
  const linha = (chave: string, valor: string, acao?: string): string => acao
    ? `<li><button type="button" class="qd-prop" data-folha-acao="${esc(acao)}"><span class="qd-prop-k">${esc(chave)}</span><span class="qd-prop-v">${valor}</span><span class="qd-prop-seta" aria-hidden="true">›</span></button></li>`
    : `<li><div class="qd-prop"><span class="qd-prop-k">${esc(chave)}</span><span class="qd-prop-v">${valor}</span></div></li>`;
  const pr = linkSeguro(t.prUrl);
  const prs = (t.prs ?? []).flatMap((p) => { const u = linkSeguro(p.url); return u ? [`<a class="qd-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(`${p.repo} #${p.numero}`)}</a>`] : []; });
  const lin = linkSeguro(t.linearUrl);
  return `<ul class="qd-props-cel">` +
    linha("Status", esc(o.nomeStatus), "abrir-status") +
    linha("Responsável", esc(o.nomeResp), o.podeResp ? "abrir-resp" : undefined) +
    linha("Quadro", esc(`${q.agenteNome}${q.meta ? ` · ${q.meta}` : ""}`), o.podeMover ? "abrir-mover" : undefined) +
    (t.branch ? linha("Branch", `<code class="qd-prop-branch">${esc(t.branch)}</code>`, "abrir-branch") : "") +
    (prs.length ? linha("PR", prs.join(", ")) : pr ? linha("PR", `<a class="qd-link" href="${esc(pr)}" target="_blank" rel="noopener noreferrer">${esc(numeroDoPr(pr))}</a>`) : "") +
    (t.linearId ? linha("Linear", lin ? `<a class="qd-link" href="${esc(lin)}" target="_blank" rel="noopener noreferrer">${esc(t.linearId)}</a>` : esc(t.linearId)) : "") +
    (t.pedidoPorNome ? linha("Pedida por", esc(t.pedidoPorNome)) : "") +
    `</ul>`;
}
