import type { EntradaDiario, Memoria, TipoMemoria } from "../../src/contracts/memoria.ts";
import type { Estado, MemoriaApagadaNaTela, NivelGaveta } from "../estado/reducer.ts";
import { formatoData } from "../lib/formato-data.ts";
import { esc, hora } from "../lib/render.ts";

/**
 * Memória do bot (Grok Bot): injetada no prompt com "não substitui fonte autoritativa".
 * NOD-58 (protótipo v2, Editar opção A, aprovado): duas abas, Memórias | Histórico · N. Em Memórias, cada memória se lê
 * por padrão e edita no lugar (texto em cima, tipo e Cancelar/Salvar embaixo); Apagar mora no "…", longe do Salvar, e a
 * apagada fica no lugar com Desfazer. O Histórico mostra cada mudança (do bot e da pessoa) por dia, com Desfazer e, nas
 * do bot, Revisado. O "N" conta só as mudanças do bot que faltam revisar. Sem Refazer e sem Desfazer no chat.
 */
type Contexto = { nome: string; dona: boolean; nivel: Extract<NivelGaveta, { tipo: "memoria" }> };

const ROTULO: Record<TipoMemoria, string> = { preferencia: "Preferência", fato: "Fato", resumo: "Resumo" };
const ARTIGO: Record<TipoMemoria, string> = { preferencia: "uma preferência", fato: "um fato", resumo: "um resumo" };
const DIA_MS = 86_400_000;

const aspas = (t: string) => `“${esc(t)}”`;

/** NOD-58 (QA): há rascunho de verdade se algum campo do editor ou do Anotar difere do que veio desenhado. */
export const rascunhoMudou = (campos: Iterable<{ value: string; defaultValue: string }>): boolean => [...campos].some((c) => c.value !== c.defaultValue);

function opcoesDeTipo(atual: TipoMemoria): string {
  return (Object.keys(ROTULO) as TipoMemoria[]).map((t) => `<option value="${t}"${t === atual ? " selected" : ""}>${ROTULO[t]}</option>`).join("");
}

const seletorDeTipo = (atual: TipoMemoria, rotulo: string) => `<label class="mem-tipo"><span class="sr-only">${esc(rotulo)}</span><select name="tipo">${opcoesDeTipo(atual)}</select></label>`;

// O retorno das ações (apagada, desfeita…) é anunciado pela região viva fixa (`#anuncio-gestao`), não aqui: o `#detalhes`
// é redesenhado a cada mudança e uma região viva recém-inserida não é lida.
// Bot de equipe (quem usa não é a dona): as memórias são da pessoa (RLS por owner_id) e ela as anota, edita e apaga; o
// Histórico e o Desfazer ficam só com a dona do bot.
export function renderMemoriaNaGaveta(estado: Estado, agenteId: string, ctx: Contexto = { nome: "o bot", dona: true, nivel: { tipo: "memoria" } }): string {
  if (!ctx.dona) return `<div class="gv-aba-painel mem-painel">${painelMemorias(estado, agenteId, ctx)}</div>`;
  const aba = ctx.nivel.aba === "historico" ? "historico" : "memorias";
  const n = estado.memoriasARevisar[agenteId] ?? 0;
  const botaoAba = (id: "memorias" | "historico", rotulo: string) =>
    `<button type="button" role="tab" class="gv-aba mem-aba" id="mem-aba-${id}" data-act="memoria-aba" data-aba="${id}" data-agente="${esc(agenteId)}" ${aba === id ? `aria-controls="mem-painel-${id}" ` : ""}aria-selected="${aba === id}" tabindex="${aba === id ? 0 : -1}">${rotulo}</button>`;
  const abas = `<div class="gv-abas mem-abas" role="tablist" aria-label="Memória de ${esc(ctx.nome)}">
      ${botaoAba("memorias", "Memórias")}
      ${botaoAba("historico", `Histórico${n > 0 ? `<span class="mem-conta"> · ${n}</span><span class="sr-only"> para revisar</span>` : ""}`)}
    </div>`;
  const corpo = aba === "historico" ? painelHistorico(estado, agenteId, ctx) : painelMemorias(estado, agenteId, ctx);
  return `${abas}<div class="gv-aba-painel mem-painel" role="tabpanel" id="mem-painel-${aba}" aria-labelledby="mem-aba-${aba}">${corpo}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Memórias

type Item = { tipo: "viva"; m: Memoria } | { tipo: "apagada"; a: MemoriaApagadaNaTela };

function painelMemorias(estado: Estado, agenteId: string, ctx: Contexto): string {
  const memorias = estado.memorias[agenteId];
  const nota = `<p class="mudo gv-nota">O que está aqui entra no prompt do bot como memória. Não substitui a fonte: se um dado importa, confira na origem.</p>`;
  const anotar = `<form class="mem-editor mem-anotar" data-form="criar-memoria" data-id="${esc(agenteId)}">
      <textarea class="mem-editor-texto" name="texto" rows="1" placeholder="Anotar uma memória…" required maxlength="500" aria-label="Nova memória"></textarea>
      <div class="mem-editor-pe">${seletorDeTipo("fato", "Tipo da nova memória")}<span class="mem-editor-acoes"><button type="submit" class="mem-salvar">Anotar</button></span></div>
    </form>`;
  if (memorias === undefined) return `${nota}${anotar}<p class="mudo">carregando…</p>`;
  const itens: Item[] = [
    ...memorias.map((m): Item => ({ tipo: "viva", m })),
    ...(ctx.dona ? (estado.memoriasApagadas[agenteId] ?? []).filter((a) => !memorias.some((m) => m.id === a.memoriaId)).map((a): Item => ({ tipo: "apagada", a })) : []),
  ].sort((x, y) => (x.tipo === "viva" ? x.m.criadoEm : x.a.criadoEm) - (y.tipo === "viva" ? y.m.criadoEm : y.a.criadoEm));
  if (itens.length === 0) return `${nota}${anotar}<p class="mudo mem-vazio">Nenhuma memória ainda. O bot anota pelo <code>lembrar</code>; você também pode escrever aqui.</p>`;
  const linhas = itens.map((i) => (i.tipo === "apagada" ? linhaApagada(i.a, agenteId) : linhaMemoria(i.m, agenteId, ctx))).join("");
  return `${nota}${anotar}<ul class="mem-mems">${linhas}</ul>`;
}

function linhaMemoria(m: Memoria, agenteId: string, ctx: Contexto): string {
  const ag = esc(agenteId);
  const id = esc(m.id);
  const quem = m.origem === "agente" ? `anotada ${ctx.nome === "o bot" ? "pelo bot" : `por ${esc(ctx.nome)}`}` : "escrita por você";
  if (ctx.nivel.editando === m.id) {
    return `<li class="mem-mem mem-editando" data-memoria="${id}">
      <form class="mem-editor" data-form="salvar-memoria" data-id="${id}" data-agente="${ag}">
        <textarea class="mem-editor-texto" name="texto" rows="2" required maxlength="500" aria-label="Texto da memória">${esc(m.texto)}</textarea>
        <div class="mem-editor-pe">${seletorDeTipo(m.tipo, "Tipo da memória")}<span class="mem-editor-acoes">
          <button type="button" class="mem-cancelar" data-act="cancelar-edicao" data-id="${id}" data-agente="${ag}" title="Cancelar (Esc)">Cancelar</button>
          <button type="submit" class="mem-salvar" title="Salvar (⌘↵)">Salvar</button>
        </span></div>
      </form>
      <p class="mem-meta mem-editor-meta">${quem} · ${hora(m.criadoEm)}</p>
    </li>`;
  }
  const corpo = `<span class="mem-mem-texto">${esc(m.texto)}</span><span class="mem-mem-meta"><span class="mem-mem-tipo">${ROTULO[m.tipo]}</span> · ${quem} · ${hora(m.criadoEm)}</span>`;
  const aberto = ctx.nivel.menu === m.id;
  const menu = aberto
    ? `<div class="mem-menu" role="menu" aria-label="Ações da memória">
        <p class="mem-menu-cab" aria-hidden="true">${esc(m.texto)}</p>
        <button type="button" class="mem-menu-item" role="menuitem" data-act="editar-memoria" data-id="${id}" data-agente="${ag}">Editar</button>
        ${ctx.dona ? `<button type="button" class="mem-menu-item" role="menuitem" data-act="ver-no-historico" data-id="${id}" data-agente="${ag}">Ver no Histórico</button>` : ""}
        <hr class="mem-menu-sep" />
        <button type="button" class="mem-menu-item mem-menu-perigo" role="menuitem" data-act="apagar-memoria" data-id="${id}" data-agente="${ag}">Apagar</button>
      </div>`
    : "";
  return `<li class="mem-mem${aberto ? " mem-com-menu" : ""}" data-memoria="${id}">
      <button type="button" class="mem-mem-corpo" data-act="editar-memoria" data-id="${id}" data-agente="${ag}" data-mem-corpo="${id}" aria-label="Editar: ${esc(m.texto)}">${corpo}</button>
      <button type="button" class="mem-mem-mais" data-act="memoria-mais" data-id="${id}" data-agente="${ag}" aria-haspopup="menu" aria-expanded="${aberto}" aria-label="Mais ações: ${esc(m.texto)}" title="Mais ações">…</button>
      ${menu}
    </li>`;
}

function linhaApagada(a: MemoriaApagadaNaTela, agenteId: string): string {
  return `<li class="mem-mem mem-apagada" data-memoria="${esc(a.memoriaId)}">
      <p class="mem-apagada-txt"><span>Apagada</span><span class="mem-meta">${aspas(a.texto)}</span></p>
      <button type="button" class="mem-acao mem-desfazer" data-act="desfazer-apagada" data-id="${esc(a.memoriaId)}" data-agente="${esc(agenteId)}" aria-label="Desfazer: trazer de volta ${esc(a.texto)}">Desfazer</button>
    </li>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Histórico

/** "Hoje", "Ontem" ou "24 de out." no fuso da pessoa. */
export function tituloDoDia(instante: number, agora: number): string {
  const dia = (t: number) => formatoData("pt-BR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  if (dia(instante) === dia(agora)) return "Hoje";
  if (dia(instante) === dia(agora - DIA_MS)) return "Ontem";
  return formatoData("pt-BR", { day: "numeric", month: "short" }).format(new Date(instante));
}

/** "<b>Ada</b> anotou uma preferência", "<b>Você</b> apagou um fato", "<b>Você</b> desfez a edição de um resumo". */
export function fraseDaEntrada(e: EntradaDiario, nome: string): string {
  const tipo = ARTIGO[(e.depois ?? e.antes)?.tipo ?? "fato"];
  if (e.desfazId) {
    const o = e.acao === "criada" ? `trouxe de volta ${tipo}` : e.acao === "apagada" ? `desfez a anotação de ${tipo}` : `desfez a edição de ${tipo}`;
    return `<b>Você</b> ${o}`;
  }
  const quem = e.autor === "agente" ? `<b>${esc(nome)}</b>` : "<b>Você</b>";
  const verbo = e.acao === "criada" ? (e.autor === "agente" ? "anotou" : "escreveu") : e.acao === "editada" ? "editou" : "apagou";
  return `${quem} ${verbo} ${e.acao === "editada" ? ARTIGO[e.antes?.tipo ?? e.depois?.tipo ?? "fato"] : tipo}`;
}

function textoDaEntrada(e: EntradaDiario): string {
  if (e.acao === "editada" && e.antes && e.depois) {
    const tipoMudou = e.antes.tipo !== e.depois.tipo ? `<span class="mem-meta">${ROTULO[e.antes.tipo]} → ${ROTULO[e.depois.tipo]}</span>` : "";
    if (e.antes.texto === e.depois.texto) return `<p class="mem-texto">${aspas(e.depois.texto)}${tipoMudou}</p>`;
    return `<p class="mem-texto"><del>${aspas(e.antes.texto)}</del><span class="sr-only"> passou a ser </span><ins>${aspas(e.depois.texto)}</ins>${tipoMudou}</p>`;
  }
  const v = e.depois ?? e.antes;
  return v ? `<p class="mem-texto">${aspas(v.texto)}</p>` : "";
}

function linhaEntrada(estado: Estado, e: EntradaDiario, agenteId: string, ctx: Contexto, realce: boolean): string {
  const ag = esc(agenteId);
  const frase = fraseDaEntrada(e, ctx.nome);
  // Já escapado (o nome passa por esc na frase): vai direto no atributo, sem escapar de novo.
  const rotulo = frase.replace(/<[^>]+>/g, "");
  const aRevisar = e.autor === "agente" && e.revisadaEm === null && e.desfeitaEm === null;
  const desfeita = e.desfeitaEm !== null;
  const acoes = [
    !desfeita && !e.desfazId ? `<button type="button" class="mem-acao mem-desfazer" data-act="desfazer-entrada" data-id="${esc(e.id)}" data-memoria="${esc(e.memoriaId)}" data-agente="${ag}" aria-label="Desfazer: ${rotulo}">Desfazer</button>` : "",
    aRevisar ? `<button type="button" class="mem-acao mem-revisado" data-act="revisar-entrada" data-id="${esc(e.id)}" data-agente="${ag}" aria-label="Marcar como revisada: ${rotulo}">Revisado</button>` : "",
  ].join("");
  const aviso = estado.avisoDiario?.entradaId === e.id ? avisoDaEntrada(estado.avisoDiario.tipo, e, ag, estado.diarios[agenteId]?.entradas ?? []) : "";
  const classes = ["mem-entrada", aRevisar ? "mem-a-revisar" : "", desfeita ? "mem-desfeita" : "", realce ? "mem-realce" : ""].filter(Boolean).join(" ");
  return `<li class="${classes}" data-entrada="${esc(e.id)}">
      ${aRevisar ? '<span class="mem-ponto" aria-hidden="true"></span><span class="sr-only">Não revisada. </span>' : ""}
      <p class="mem-quem">${frase}</p>
      ${textoDaEntrada(e)}
      <div class="mem-pe"><span class="mem-meta"><time>${hora(e.criadoEm)}</time>${desfeita ? ` · desfeita às ${hora(e.desfeitaEm ?? 0)}` : ""}</span><span class="mem-acoes">${acoes}</span></div>
      ${aviso}
    </li>`;
}

function avisoDaEntrada(tipo: "conflito" | "rede", e: EntradaDiario, ag: string, entradas: readonly EntradaDiario[]): string {
  // A mais nova da memória é um desfazer (que não se desfaz, sem Refazer): "desfaça a mais nova" seria um beco sem saída.
  if (tipo === "conflito" && entradas.find((x) => x.memoriaId === e.memoriaId)?.desfazId) {
    return `<p class="mem-aviso">Esta memória já teve uma mudança desfeita depois. Para mudá-la, edite ou apague em Memórias. <button type="button" class="mem-acao mem-link" data-act="memoria-aba" data-aba="memorias" data-agente="${ag}">Ver em Memórias</button></p>`;
  }
  if (tipo === "conflito") {
    return `<p class="mem-aviso">Esta memória mudou depois. Desfaça a mudança mais nova primeiro. <button type="button" class="mem-acao mem-link" data-act="ver-mais-nova" data-memoria="${esc(e.memoriaId)}" data-agente="${ag}" aria-label="Ver a mudança mais nova desta memória">Ver a mais nova</button></p>`;
  }
  return `<p class="mem-aviso">Não deu para desfazer agora. <button type="button" class="mem-acao mem-link" data-act="desfazer-entrada" data-id="${esc(e.id)}" data-memoria="${esc(e.memoriaId)}" data-agente="${ag}">Tentar de novo</button></p>`;
}

function painelHistorico(estado: Estado, agenteId: string, ctx: Contexto): string {
  const diario = estado.diarios[agenteId];
  if (!diario) return '<p class="mudo">carregando…</p>';
  const n = estado.memoriasARevisar[agenteId] ?? 0;
  const cab = n > 0
    ? `<div class="mem-hist-cab"><p class="mem-meta">${n} ${n === 1 ? "mudança" : "mudanças"} ${ctx.nome === "o bot" ? "do bot" : `de ${esc(ctx.nome)}`} para revisar</p><button type="button" class="mem-acao mem-marcar" data-act="revisar-tudo" data-agente="${esc(agenteId)}" aria-label="Marcar ${n === 1 ? "a mudança" : `as ${n} mudanças`} como ${n === 1 ? "revisada" : "revisadas"}">Marcar tudo como revisado</button></div>`
    : "";
  if (diario.entradas.length === 0) return `${cab}<p class="mudo mem-vazio">Nenhuma mudança ainda. Quando ${esc(ctx.nome)} anotar, editar ou apagar uma memória, aparece aqui.</p>`;
  const agora = estado.agora > 0 ? estado.agora : Date.now();
  // Só a mais nova da memória apontada ganha o realce ("Ver no Histórico", "Ver a mais nova").
  const realce = ctx.nivel.realce ? diario.entradas.find((e) => e.memoriaId === ctx.nivel.realce)?.id : undefined;
  const dias: { titulo: string; entradas: EntradaDiario[] }[] = [];
  for (const e of diario.entradas) {
    const titulo = tituloDoDia(e.criadoEm, agora);
    const ultimo = dias.at(-1);
    if (ultimo?.titulo === titulo) ultimo.entradas.push(e);
    else dias.push({ titulo, entradas: [e] });
  }
  const secoes = dias
    .map((d) => `<section class="mem-dia" aria-label="${esc(d.titulo)}"><h3 class="mem-dia-titulo">${esc(d.titulo)}</h3><ol class="mem-entradas">${d.entradas.map((e) => linhaEntrada(estado, e, agenteId, ctx, e.id === realce)).join("")}</ol></section>`)
    .join("");
  const mais = diario.mais
    ? `<div class="mem-mais"><button type="button" class="mem-acao mem-link" data-act="diario-mais" data-agente="${esc(agenteId)}">Mostrar mais</button><span class="mem-meta">mostrando as ${diario.entradas.length} mais novas</span></div>`
    : "";
  return `${cab}${secoes}${mais}`;
}
