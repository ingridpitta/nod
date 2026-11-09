import type { CategoriaRelato, Relato, TipoRelato } from "../../src/contracts/relato.ts";
import type { ConfigUi, Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { linhaConfig } from "../lib/linha-config.ts";
import { dataHora, esc } from "../lib/render.ts";

const ROTULOS: Record<CategoriaRelato, string> = {
  resposta_errada: "Respondeu errado",
  nao_fez_o_pedido: "Não fez o que pedi",
  travou_ou_parou: "Travou ou parou no meio",
  lento: "Demorou demais",
  interface: "Problema na tela",
  outro: "Outra coisa",
};

/** definido em 2026-10-07 (0062, a caixa do Nod): o que o relato é. */
const TIPO_HUMANO: Record<TipoRelato, string> = { bug: "Bug", melhoria: "Melhoria", duvida: "Dúvida" };
const FILTROS: readonly { id: "todos" | TipoRelato; nome: string }[] = [
  { id: "todos", nome: "Todos" },
  { id: "bug", nome: "Bugs" },
  { id: "melhoria", nome: "Melhorias" },
  { id: "duvida", nome: "Dúvidas" },
];

/** NOD-367: o título é o texto da pessoa até este tamanho, com reticências. */
export const TETO_TITULO_RELATO = 80;
export const VAZIO_FEEDBACK = "Nenhum envio ainda. O que você mandar aparece aqui.";
/** O resumo da listagem vem cortado em 160 caracteres pelo repositório (relatos.repo.ts). */
const TETO_RESUMO = 160;

function cortar(texto: string, teto: number): string {
  const t = texto.trim().replace(/\s+/g, " ");
  return t.length > teto ? `${t.slice(0, teto - 1).trimEnd()}…` : t;
}

/**
 * NOD-367: o título real. O da própria pessoa é o título que o Nod deu ou o texto dela (até 80 caracteres); sem texto, a
 * categoria (ou o tipo, no contado ao Nod). O de outra pessoa nunca traz prosa (ADR-041/004): fica na categoria.
 */
export function tituloDoRelato(r: Pick<Relato, "titulo" | "resumo" | "origem" | "tipo" | "categoria">): string {
  if (r.titulo?.trim()) return cortar(r.titulo, TETO_TITULO_RELATO);
  if (r.resumo?.trim()) return cortar(r.resumo, TETO_TITULO_RELATO);
  return r.origem === "nod" ? TIPO_HUMANO[r.tipo] : ROTULOS[r.categoria];
}

/**
 * NOD-367 (revisão, ADR-041 "a pessoa só aponta"): o "Enviar feedback" de Configurações não tem mensagem âncora, então
 * nunca anexa a conversa de baixo (que pode ser uma sala com terceiros). Ele leva à conversa com o Nod, onde a pessoa
 * conta e o relato sai com origem nod, sem mensagem. O "Reportar" de uma mensagem continua sendo o caminho com anexo.
 */
export function destinoDoFeedback(estado: Pick<Estado, "frota" | "sessao">): { conversaId: string; agenteId: string } | null {
  const nod = (estado.frota?.agentes ?? []).find((a) => a.papel === "nod" && a.ownerId === estado.sessao?.pessoaId);
  return nod ? { conversaId: nod.conversaId, agenteId: nod.id } : null;
}

/** Um par rótulo/valor só aparece quando há valor: linha vazia não ajuda a investigar. */
function campo(rotulo: string, valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<div><dt>${esc(rotulo)}</dt><dd>${esc(String(valor))}</dd></div>`;
}

/**
 * Os quatro sinais write-ahead do ADR-009 dizem até onde o protocolo chegou: é o metadado que separa "nem tentou" de
 * "tentou e o modelo não respondeu". Só os ligados, na ordem do protocolo.
 */
function sinais(r: Relato): string {
  const s = r.metadados.sinais;
  if (!s) return "";
  const ligados = ([["tentou", s.attempted], ["recusado", s.rejected], ["prompt enviado", s.promptSubmitted], ["produziu saída", s.producedOutput]] as const)
    .filter(([, ligado]) => ligado).map(([nome]) => nome);
  return `<p class="cfg-det-ctx">Sinais: ${ligados.length ? esc(ligados.join(" · ")) : "nenhum"}</p>`;
}

/** O detalhe que abre embaixo do envio: o que a pessoa escreveu, o contexto, os sinais e, recolhido, o técnico. */
function detalhe(r: Relato, ui: ConfigUi): string {
  const m = r.metadados;
  const doNod = r.origem === "nod";
  const anexo = doNod ? "Conversa com o Nod" : r.alcance === "janela" ? `Conversa · ${r.mensagensAnexadas} ${r.mensagensAnexadas === 1 ? "mensagem anexada" : "mensagens anexadas"}` : "Conversa · só a mensagem";
  const diag = r.diagnostico;
  const prosa = r.resumo?.trim() ? `<p class="cfg-det-rot">O que você escreveu</p><p class="cfg-prosa">${esc(r.resumo)}${r.resumo.length >= TETO_RESUMO ? "…" : ""}</p>` : "";
  const tec = [
    campo("estado do turno", m.estadoTurno),
    campo("origem", m.origemTurno),
    campo("modelo", m.modelo),
    campo("harness", m.harness),
    campo("executor", m.executor),
    campo("custo (US$)", m.custoUsd),
    campo("reenvios", m.reenvios),
    campo("confiança da mensagem", m.confiancaMensagem),
    m.mensagemParcial ? campo("fala", "parcial (turno interrompido no meio)") : "",
    campo("versão do app", m.versaoApp),
    campo("correlation id", m.correlationId),
    campo("máquina", m.machineId),
    diag?.erroCru ? campo("erro do fornecedor", diag.erroCru) : "",
    diag && diag.ferramentas.length ? campo("ferramentas chamadas", diag.ferramentas.join(", ")) : "",
    diag && diag.negacoes.length ? campo("negações de permissão", diag.negacoes.join(", ")) : "",
    campo("turno", r.turnoId),
    campo("conversa", r.conversaId),
  ].join("");
  const idTec = `relato-tec-${r.id}`;
  const tecnico = linhaConfig({
    titulo: "Detalhes técnicos",
    detalhe: "Modelo, versão, correlation id",
    classe: "cfg-tec",
    controle: { tipo: "recolhe", id: idTec, acao: "config-recolhe", aberto: ui.abertos.includes(idTec), conteudo: `<dl class="cfg-dl">${tec}</dl>` },
  });
  return `<div class="cfg-det" role="region" aria-label="Detalhe do envio">
    ${prosa}
    ${doNod && r.categoria !== "outro" ? `<p class="cfg-det-rot">Categoria</p><p class="cfg-prosa">${esc(ROTULOS[r.categoria])}</p>` : ""}
    <p class="cfg-det-rot">Contexto</p>
    <p class="cfg-det-ctx">${esc(`${anexo} · ${dataHora(r.criadoEm)}`)}</p>
    ${sinais(r)}
    ${tecnico}
  </div>`;
}

function linhaRelato(r: Relato, ui: ConfigUi): string {
  const id = `relato-${r.id}`;
  const falha = r.metadados.motivoFalha ?? r.metadados.motivoInterrupcao;
  const quando = dataHora(r.criadoEm);
  const tipoECategoria = `${TIPO_HUMANO[r.tipo]} · ${r.origem === "nod" ? "conversa com o Nod" : ROTULOS[r.categoria]}`;
  return linhaConfig({
    titulo: tituloDoRelato(r),
    // A data também vai no detalhe, para o celular (onde a coluna some).
    detalheHtml: `${esc(tipoECategoria)}<span class="cfg-q-inline"> · ${esc(quando)}</span>`,
    status: falha ? { texto: falha.replaceAll("_", " "), tom: "atencao" } : undefined,
    quando,
    classe: "cfg-relato",
    attrs: `data-tipo="${esc(r.tipo)}"`,
    controle: { tipo: "recolhe", id, acao: "config-recolhe", aberto: ui.abertos.includes(id), conteudo: detalhe(r, ui) },
  });
}

/**
 * Configurações › Feedback (NOD-367, antes a tela Relatos do ADR-041). No topo, o "Enviar feedback", que leva à conversa
 * com o Nod (destinoDoFeedback), sem anexar conversa nenhuma; embaixo, "Seus envios": cada relato é uma linha com o
 * título real e a data numa coluna, e o detalhe abre embaixo dela. O filtro por tipo mora em `configUi.filtro`.
 */
export function renderRelatos(estado: Pick<Estado, "relatos" | "relatosErro" | "configUi">): string {
  const ui = estado.configUi;
  const cab = `<header class="cfg-fb-cab"><div><h2>Feedback</h2><p class="intro">Bug, ideia ou dúvida: vai para o time do nod com o estado técnico do momento.</p></div><button type="button" class="cfg-enviar" data-act="enviar-feedback">${ICONE.bandeira}Enviar feedback</button></header>`;
  const sec = (miolo: string) => `<section class="espaco-secao cfg-secao cfg-fb">${cab}<h3 class="lc-grupo-tit">Seus envios</h3>${miolo}</section>`;
  const relatos = estado.relatos;
  if (relatos === null) {
    if (estado.relatosErro) {
      return sec(`<div class="lc-lista">${linhaConfig({ titulo: "Não deu para carregar seus envios", status: { texto: "Erro", tom: "erro" }, controle: { tipo: "html", html: `<button type="button" class="bt" data-act="recarregar-relatos">Tentar de novo</button>` } })}</div>`);
    }
    return sec(`<p class="lc-nota" role="status">Verificando…</p>`);
  }
  if (relatos.length === 0) return sec(`<p class="lc-vazio">${VAZIO_FEEDBACK}</p>`);
  const conta = (id: (typeof FILTROS)[number]["id"]) => (id === "todos" ? relatos.length : relatos.filter((r) => r.tipo === id).length);
  const visiveis = FILTROS.filter((f) => f.id === "todos" || conta(f.id) > 0);
  // Um filtro que deixou de existir (o último daquele tipo sumiu) volta para Todos.
  const filtro = visiveis.some((f) => f.id === ui.filtro) ? ui.filtro : "todos";
  const botoes = visiveis
    .map((f) => `<button type="button" class="filtro-relato" data-act="filtrar-relatos" data-filtro-tipo="${f.id}" aria-pressed="${f.id === filtro}">${esc(f.nome)} · ${conta(f.id)}</button>`).join("");
  const lista = relatos.filter((r) => filtro === "todos" || r.tipo === filtro).map((r) => linhaRelato(r, ui)).join("");
  return sec(`<div class="filtros-relato" role="group" aria-label="Filtrar por tipo">${botoes}</div><div class="lc-lista cfg-relatos">${lista}</div>`);
}
