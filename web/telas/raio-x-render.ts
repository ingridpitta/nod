import type { ChamadaRaioX, CompactacaoRaioX, ComposicaoRaioX, ExecucaoRaioX, GrupoDeFerramentas, RaioXTurno, SecaoDoPrompt } from "../../src/contracts/raio-x.ts";
import type { MotivoRecomeco } from "../../src/contracts/turno.ts";
import { esc } from "../lib/render.ts";
import { ALERTA_JANELA, CUSTO_DESCONHECIDO, custoDoTurno, mil, modeloCurto, usd } from "./modo-dev.ts";

/**
 * O conteúdo do Raio-X (modo dev, 0036), só strings: a gaveta (raio-x.ts) mexe no DOM e este módulo não, para
 * os testes o importarem sem navegador.
 *
 * definido em 2026-09-28 (revisão contra o canvas, página modo-dev, D2 e D3): gaveta encostada à direita com
 * a conversa visível ao lado, a parte fixa numa barra só dividida por partes, uma linha por chamada e as cores
 * da paleta do nod (tinta e azul; âmbar só no que passa do limite).
 */
const SECOES: Record<SecaoDoPrompt, string> = {
  identidade: "Identidade e “o que você faz”",
  modo: "Modo do turno",
  computador: "Computador e pastas",
  colegas: "Colaboração e diretório de colegas",
  rotinas: "Rotinas",
  apps: "Apps e conexões",
  ferramentas: "Ferramentas, capacidades e forma de trabalho",
  memoria: "Memória",
  contexto: "Contexto recente da conversa",
};

const GRUPOS_FIXOS: Record<Exclude<GrupoDeFerramentas["origem"], "conector">, string> = {
  nod: "nod",
  computador: "Computador do bot",
  workspace: "Pastas do Mac",
};

/** Estimativa de tokens a partir de caracteres, marcada como estimada onde aparece. */
const CARACTERES_POR_TOKEN = 4;
/** A parte fixa já come metade da janela: a maior parte dela fica em âmbar. */
const PARTE_FIXA_PESADA = 0.5;
/** Uma seção do prompt com isto do total é a que pesa. */
const SECAO_PESADA = 0.3;
/** Abaixo disto da janela, as barras mostram a composição em vez da janela inteira (que seria quase vazia). */
const JANELA_FOLGADA = 0.35;
/** Resultado de ferramenta a partir daqui aparece em negrito na linha da chamada. */
const RESULTADO_GRANDE = 20_000;

/** "+ 3 compactações" não se parte em duas linhas no cartão estreito. */
const ESPACO_FIXO = "\u00a0";
const tokens = (chars: number) => Math.round(chars / CARACTERES_POR_TOKEN);
const pct = (valor: number, base: number) => (base > 0 ? Math.max(0, Math.min(100, (valor / base) * 100)) : 0);
const largura = (p: number) => `width:${p.toFixed(2)}%`;

function relogio(instante: number): string {
  return new Date(instante).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ---------------------------------------------------------------------------------------------
// Custo e contexto

type Parte = { classe: string; nome: string; tokens: number; nota: string; pesada?: boolean };

/** O que a primeira chamada leva, parte por parte: caracteres exatos do nod, tokens estimados; o resto é do Claude Code. */
export function partesFixas(r: RaioXTurno, x: ExecucaoRaioX, primeira: ChamadaRaioX): Parte[] {
  const c = r.composicao!;
  const apps = c.ferramentas.filter((g) => g.origem === "conector");
  const doNod = c.ferramentas.filter((g) => g.origem !== "conector");
  const catalogo = c.prompt.find((p) => p.secao === "apps")?.chars ?? 0;
  const charsNod = doNod.reduce((s, g) => s + g.chars, 0);
  const charsApps = apps.reduce((s, g) => s + g.chars, 0);
  const qtdApps = apps.reduce((s, g) => s + g.quantidade, 0);
  const partes: Parte[] = [
    { classe: "rx-p-prompt", nome: "Prompt do nod", tokens: tokens(c.promptChars - catalogo), nota: `${mil(c.promptChars - catalogo)} caract.` },
    ...(catalogo ? [{ classe: "rx-p-catalogo", nome: "Catálogo de apps no prompt", tokens: tokens(catalogo), nota: `${mil(catalogo)} caract.` }] : []),
    { classe: "rx-p-nod", nome: `Ferramentas do nod${doNod.some((g) => g.origem === "computador") ? " e do computador" : ""}`, tokens: tokens(charsNod), nota: `${mil(charsNod)} caract.` },
    ...(apps.length ? [x.buscaDeFerramentas
      ? { classe: "rx-p-apps", nome: `Ferramentas de apps (${qtdApps})`, tokens: 0, nota: "sob demanda" }
      : { classe: "rx-p-apps", nome: `Definições das ${qtdApps} ferramentas de apps`, tokens: tokens(charsApps), nota: `${mil(charsApps)} caract.` }] : []),
  ];
  const doNodEstimado = partes.reduce((s, p) => s + p.tokens, 0);
  partes.push({
    classe: "rx-p-claude",
    nome: `Claude Code: prompt base, nativas${c.sessaoRetomada ? ", histórico da sessão" : ""} e a mensagem`,
    tokens: Math.max(0, primeira.contexto - doNodEstimado),
    nota: "estimado",
  });
  partes.sort((a, b) => b.tokens - a.tokens);
  if (x.janela && primeira.contexto >= x.janela * PARTE_FIXA_PESADA && partes[0]) partes[0].pesada = true;
  return partes;
}

function secaoParteFixa(r: RaioXTurno, x: ExecucaoRaioX, primeira: ChamadaRaioX): string {
  const partes = partesFixas(r, x, primeira);
  // definido em 2026-09-28: com a janela de 1 mi do opus, 42 mil viravam uma lasca de 4% e as partes sumiam.
  // Folgada (menos de JANELA_FOLGADA), a barra mostra a composição; apertada, a janela, e o vazio é o que sobra.
  const folgada = !x.janela || primeira.contexto < x.janela * JANELA_FOLGADA;
  const base = folgada ? primeira.contexto : x.janela!;
  const segmentos = partes.filter((p) => p.tokens > 0).map((p) => `<span class="${p.classe}${p.pesada ? " rx-pesada" : ""}" style="${largura(pct(p.tokens, base))}"></span>`).join("");
  const resumo = partes.filter((p) => p.tokens > 0).map((p) => `${p.nome} ~${mil(p.tokens)}`).join(", ");
  const sobra = x.janela ? `<p class="rx-sobra">${folgada ? `${esc(String(Math.max(1, Math.round((primeira.contexto / x.janela) * 100))))}% da janela · ` : ""}sobram ${esc(mil(Math.max(0, x.janela - primeira.contexto)))} para a conversa e os resultados</p>` : "";
  const legenda = partes.map((p) => `<li${p.pesada ? ' class="rx-pesada"' : ""}><span class="rx-cor ${p.classe}" aria-hidden="true"></span><span>${esc(p.nome)}</span><span class="rx-num">${p.tokens ? `~${esc(mil(p.tokens))}` : "—"}</span><span class="rx-nota">${esc(p.nota)}</span></li>`).join("");
  const titulo = r.composicao!.sessaoRetomada ? "Primeira chamada · parte fixa e histórico" : "Parte fixa · vai em toda chamada";
  return `<section class="rx-secao">
      <div class="rx-secao-cab"><h3>${titulo}</h3><span class="rx-num">${esc(mil(primeira.contexto))}${x.janela ? ` de ${esc(mil(x.janela))}` : ""}</span></div>
      <div class="rx-pilha" role="img" aria-label="${esc(resumo)}">${segmentos}</div>${sobra}
      <ul class="rx-legenda">${legenda}</ul>
    </section>`;
}

/** O id técnico sem o prefixo do servidor MCP: o Raio-X é diagnóstico do modo dev e mostra o id (NOD-352). */
function idDaFerramenta(nome: string): string {
  return nome.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
}

/** NOD-352: o nome amigável (do servidor, `nomesDasFerramentas`) vai no `title`; servidor antigo, sem `title`. */
function ferramentaNaLinha(nome: string, nomes: Readonly<Record<string, string>> | undefined): string {
  const amigavel = nomes && Object.hasOwn(nomes, nome) ? nomes[nome] : undefined;
  return `<code${amigavel ? ` title="${esc(amigavel)}"` : ""}>${esc(idDaFerramenta(nome))}</code>`;
}

function linhaChamada(c: ChamadaRaioX, inicio: number, janela: number | null, fixa: number, base: number, nomes?: Readonly<Record<string, string>>): { html: string; perto: boolean } {
  const perto = janela !== null && c.contexto >= janela * ALERTA_JANELA;
  const parteFixa = Math.min(fixa, c.contexto);
  const mini = `<span class="rx-mini" aria-hidden="true"><span class="rx-mini-fixa" style="${largura(pct(parteFixa, base))}"></span><span class="rx-mini-conversa${perto ? " rx-pesada" : ""}" style="${largura(pct(c.contexto - parteFixa, base))}"></span></span>`;
  const detalhe = `${mil(c.cacheLido)} do cache · ${mil(c.entrada + c.cacheNovo)} novos · ${mil(c.saida)} de saída${c.pensamento ? ` (${mil(c.pensamento)} pensando)` : ""}`;
  const ferramentas = c.ferramentas.map((f) => {
    const tamanho = f.resultadoChars === null ? "" : f.resultadoChars >= RESULTADO_GRANDE ? ` → <b>${esc(mil(f.resultadoChars))}</b>` : ` → ${esc(mil(f.resultadoChars))} caract.`;
    return `<span class="rx-ferramenta">${ferramentaNaLinha(f.nome, nomes)}${tamanho}${f.erro ? ' <span class="rx-erro">erro</span>' : ""}</span>`;
  }).join('<span class="rx-sep" aria-hidden="true"> · </span>');
  const descricao = ferramentas || `<span class="rx-nota">${esc(`${mil(c.saida)} de saída${c.pensamento ? ` (${mil(c.pensamento)} pensando)` : ""}`)}</span>`;
  return {
    perto,
    html: `<li class="rx-chamada${c.subagente ? " rx-subagente" : ""}" title="${esc(detalhe)}"><time>${esc(relogio(inicio + c.em))}</time><span class="rx-ctx">${mini}<span class="rx-num${perto ? " rx-pesada" : ""}">${esc(mil(c.contexto))}</span></span><span class="rx-desc">${c.subagente ? '<span class="rx-nota">subagente · </span>' : ""}${descricao}</span></li>`,
  };
}

function linhaCompactacao(c: CompactacaoRaioX, inicio: number): string {
  const de = c.antes !== null ? mil(c.antes) : "?";
  return `<li class="rx-evento rx-compactou"><time>${esc(relogio(inicio + c.em))}</time><span>⟳ compactou${c.gatilho === "auto" ? "" : ` (${esc(c.gatilho)})`}: ${esc(de)}${c.depois !== null ? ` → ${esc(mil(c.depois))}` : ""}</span></li>`;
}

function abaCusto(r: RaioXTurno): string {
  const x = r.execucao;
  if (!x) {
    return `<p class="rx-intro">Este turno não tem o registro das chamadas: rodou antes do modo dev existir, no Codex ou na simulação, ou caiu antes de chegar ao Claude Code. ${r.custoUsd !== null ? `Custo registrado: ${esc(usd(r.custoUsd))}.` : ""}</p>`;
  }
  const principais = x.chamadas.filter((c) => !c.subagente);
  const pico = x.chamadas.length ? Math.max(0, ...(principais.length ? principais : x.chamadas).map((c) => c.contexto)) : null;
  const soma = (k: "cacheLido" | "saida") => x.chamadas.reduce((s, c) => s + c[k], 0);
  const novos = x.chamadas.reduce((s, c) => s + c.entrada + c.cacheNovo, 0);
  const primeira = principais[0] ?? x.chamadas[0];
  const perto = x.janela !== null && pico !== null && pico >= x.janela * ALERTA_JANELA;
  // A sessão só acumula além do turno quando foi retomada; numa sessão nova os dois números são o mesmo.
  const acumulado = x.custoSessaoUsd !== null && r.composicao?.sessaoRetomada ? `<span class="rx-sub">sessão: ${esc(usd(x.custoSessaoUsd))} acumulado</span>` : "";
  const cartoes = `<div class="rx-cartoes">
      <div class="rx-cartao"><span class="rx-rotulo">Custo do turno</span>${r.custoUsd === null && x.chamadas.length + x.chamadasOmitidas > 0 ? `<span class="rx-sub mudo" title="${CUSTO_DESCONHECIDO}">${esc(custoDoTurno(null, true))}</span>` : `<b class="rx-valor">${esc(custoDoTurno(r.custoUsd, x.chamadas.length + x.chamadasOmitidas > 0))}</b>`}${acumulado}</div>
      <div class="rx-cartao"><span class="rx-rotulo">Chamadas</span><b class="rx-valor">${x.chamadas.length + x.chamadasOmitidas}</b>${x.compactacoes.length ? `<span class="rx-sub rx-atencao">+${ESPACO_FIXO}${x.compactacoes.length}${ESPACO_FIXO}${x.compactacoes.length === 1 ? "compactação" : "compactações"}</span>` : ""}</div>
      <div class="rx-cartao"><span class="rx-rotulo">Pico do contexto</span><b class="rx-valor${perto ? " rx-atencao" : ""}">${pico === null ? "—" : esc(mil(pico))}</b>${x.janela ? `<span class="rx-sub">de ${esc(mil(x.janela))}</span>` : ""}</div>
      <div class="rx-cartao"><span class="rx-rotulo">Tokens</span><span class="rx-tokens">${esc(mil(soma("cacheLido")))} cache<br>${esc(mil(novos))} novos<br>${esc(mil(soma("saida")))} saída</span></div>
    </div>`;
  const fixa = primeira && r.composicao ? secaoParteFixa(r, x, primeira) : "";
  const escala = x.janela && pico !== null && pico >= x.janela * JANELA_FOLGADA ? x.janela : Math.max(pico ?? 0, 1);
  const linhas = x.chamadas.map((c) => ({ em: c.em, ...linhaChamada(c, r.criadoEm, x.janela, primeira?.contexto ?? 0, escala, r.nomesDasFerramentas) }));
  const eventos = [...linhas, ...x.compactacoes.map((c) => ({ em: c.em, html: linhaCompactacao(c, r.criadoEm), perto: false }))].sort((a, b) => a.em - b.em);
  const omitidas = x.chamadasOmitidas ? `<li class="rx-evento rx-nota"><span>… ${x.chamadasOmitidas} chamadas do meio não guardadas</span></li>` : "";
  const fim = r.estado === "interrompido" ? `<li class="rx-evento rx-falhou"><span>✕ turno interrompido</span></li>` : "";
  const chaves = `<div class="rx-chaves" aria-hidden="true"><span><i class="rx-mini-fixa"></i>parte fixa</span><span><i class="rx-mini-conversa"></i>conversa e resultados</span>${linhas.some((l) => l.perto) ? '<span><i class="rx-pesada"></i>perto do limite</span>' : ""}</div>`;
  // Silêncio nunca significa vazio (ADR-029): turno que caiu antes da primeira chamada diz isso.
  const lista = eventos.length || omitidas || fim
    ? `<ol class="rx-linha">${eventos.map((e) => e.html).join("")}${omitidas}${fim}</ol>${linhas.length ? chaves : ""}`
    : `<p class="rx-texto rx-vazio">Nenhuma chamada chegou a ser registrada neste turno.</p>`;
  return `${cartoes}${fixa}<section class="rx-secao"><h3>Chamadas à API</h3>${lista}</section>`;
}

// ---------------------------------------------------------------------------------------------
// O que foi enviado

function itemDaLista(nome: string, tamanho: string, texto: string | undefined, chave: string, pesada = false): string {
  const classe = `rx-item${pesada ? " rx-pesada" : ""}`;
  return texto !== undefined
    ? `<details class="${classe}" data-disclosure="${esc(chave)}"><summary><span class="rx-seta" aria-hidden="true"></span><span class="rx-item-nome">${nome}</span><span class="rx-num">${esc(tamanho)}</span></summary><pre>${esc(texto)}</pre></details>`
    : `<div class="${classe}"><span class="rx-seta rx-seta-vazia" aria-hidden="true"></span><span class="rx-item-nome">${nome}</span><span class="rx-num">${esc(tamanho)}</span></div>`;
}

function abaEnviado(r: RaioXTurno): string {
  const c = r.composicao;
  if (!c) return `<p class="rx-intro">Este turno não tem a composição: rodou antes do modo dev existir.</p>`;
  const semTexto = c.comTexto ? "" : `<p class="rx-aviso">O modo dev estava desligado quando este turno saiu: ficaram os tamanhos, não os textos.</p>`;
  const prompt = c.prompt.map((p) => itemDaLista(esc(SECOES[p.secao]), `${mil(p.chars)} caract.`, p.texto, `rx-${p.secao}`, c.promptChars > 0 && p.chars >= c.promptChars * SECAO_PESADA)).join("");
  const totalFerramentas = c.ferramentas.reduce((s, g) => s + g.chars, 0);
  const grupos = c.ferramentas.map((g) => itemDaLista(`${esc(g.origem === "conector" ? g.grupo : GRUPOS_FIXOS[g.origem])} · ${g.quantidade} ${g.quantidade === 1 ? "ferramenta" : "ferramentas"}`, `${mil(g.chars)} caract.`, undefined, "")).join("");
  const nativas = c.nativas.length ? `<div class="rx-item rx-item-bloco"><span class="rx-seta rx-seta-vazia" aria-hidden="true"></span><span class="rx-item-nome">Nativas do Claude Code<span class="rx-nota">${esc(c.nativas.join(", "))}</span></span><span class="rx-num">${c.nativas.length}</span></div>` : "";
  const busca = r.execucao
    ? `<p class="rx-quadro">Busca de ferramentas do Claude Code: <b>${r.execucao.buscaDeFerramentas ? "ligada" : "desligada"}</b> ${r.execucao.buscaDeFerramentas ? "— as definições dos apps só entram quando o modelo as busca." : "neste turno — todas as definições foram carregadas de uma vez."}</p>`
    : "";
  const compactacoes = r.execucao?.compactacoes ?? [];
  // NOD-312: o chip do histórico diz o motivo do recomeço ou "lembrando" (a sessão retomada, o padrão silencioso).
  const chip = rotuloDaSessao(c);
  const rec = c.recomeco;
  // Revisão 1 (baixo 8): o aviso e o resumo vão na entrada do turno (seção 4); as últimas falas, no prompt (seção 3).
  const itemDoRecomeco = (nome: string, n: number): string => (n > 0 ? `<div class="rx-item"><span class="rx-seta rx-seta-vazia" aria-hidden="true"></span><span class="rx-item-nome">${esc(nome)}</span><span class="rx-num">${esc(mil(n))} caract.</span></div>` : "");
  const falasDoRecomeco = rec ? itemDoRecomeco("Últimas falas", rec.historicoChars) : "";
  const entradaDoRecomeco = rec ? itemDoRecomeco("Aviso de recomeço", rec.avisoChars) + itemDoRecomeco("Resumo do trabalho", rec.resumoChars) : "";
  const historico = rec
    ? rec.avisoChars > 0
      ? "Sem a sessão anterior: as últimas falas vão dentro do prompt, na seção “Contexto recente da conversa”; o aviso de recomeço e o resumo do trabalho vão na entrada do turno."
      : "Sem a sessão anterior: as últimas falas vão dentro do prompt, na seção “Contexto recente da conversa”. A entrada começa com “/” e vai crua para a IA, sem o aviso de recomeço."
    : c.sessaoRetomada
    ? `Fica na sessão do Claude Code no Mac, não no nod.${compactacoes.length ? ` Depois de cada compactação, o que sobrou: ${compactacoes.map((k) => (k.depois !== null ? mil(k.depois) : "?")).join(" → ")} tokens.` : ""}`
    : "Sessão nova: as últimas falas vão dentro do prompt, na seção “Contexto recente da conversa”.";
  const anexos = c.entrada.anexos ? ` · ${c.entrada.anexos} ${c.entrada.anexos === 1 ? "anexo" : "anexos"}` : "";
  // ADR-111: as chaves de experimento que valeram neste turno — é o que deixa comparar turnos com e sem elas. ADR-112: o
  // Modo WhatsApp também (ausente nos turnos de antes da 0089 = desligado; na ligação não vale, o prompt é o de voz).
  const x = c.experimentos;
  const experimentos = x
    ? `<p class="rx-quadro">Experimentos: Calibração <b>${x.calibracao ? "ligada" : "desligada"}</b> · Memória longa <b>${x.memoriaLonga ? "ligada" : "desligada"}</b>${x.memoriaLonga && c.sessaoRetomada ? " (sem efeito: a sessão foi retomada)" : ""}${x.anexosAnteriores ? ` · ${x.anexosAnteriores} ${x.anexosAnteriores === 1 ? "anexo anterior voltou" : "anexos anteriores voltaram"}` : ""} · Modo WhatsApp <b>${x.whatsapp ? "ligado" : "desligado"}</b></p>`
    : "";
  return `<p class="rx-intro">Na ordem em que o Claude Code monta cada chamada. Tamanho em caracteres, exato; tokens estimados a ${CARACTERES_POR_TOKEN} caracteres por token.</p>${semTexto}${experimentos}${linhaDaMemoriaNoTurno(c.memoria)}
    <section class="rx-secao rx-lista"><div class="rx-secao-cab"><h3>1 · Prompt de sistema do nod</h3><span class="rx-num">${esc(mil(c.promptChars))} caract.</span></div>${prompt}</section>
    <section class="rx-secao rx-lista"><div class="rx-secao-cab"><h3>2 · Definições de ferramentas</h3><span class="rx-num">${esc(mil(totalFerramentas))} caract.</span></div>${grupos}${nativas}${busca}</section>
    <section class="rx-secao rx-lista"><div class="rx-secao-cab"><h3>3 · Histórico da conversa</h3><span class="rx-num${chip === "sessão nova" ? "" : " p312-chip"}">${esc(chip)}</span></div><p class="rx-texto">${esc(historico)}</p>${falasDoRecomeco}</section>
    <section class="rx-secao rx-lista"><div class="rx-secao-cab"><h3>4 · Entrada do turno</h3><span class="rx-num">${esc(mil(c.entrada.chars))} caract.${esc(anexos)}</span></div>${c.entrada.texto !== undefined ? `<p class="rx-texto rx-citacao">“${esc(c.entrada.texto)}”</p>` : ""}${entradaDoRecomeco}</section>`;
}

/**
 * NOD-60 (ADR-136): quantas memórias o bot tem e quantas entraram no prompt, pelo núcleo (preferências e recentes; todas,
 * quando cabem) e pela busca do turno. Ausente (ligação, turno antigo) = sem a linha.
 */
export function linhaDaMemoriaNoTurno(m: ComposicaoRaioX["memoria"]): string {
  if (!m) return "";
  const noPrompt = m.nucleo + m.recall;
  return `<p class="rx-quadro">Memória: <b>${noPrompt}</b> de ${m.total} no prompt · núcleo <b>${m.nucleo}</b> · busca do turno <b>${m.recall}</b></p>`;
}

// ---------------------------------------------------------------------------------------------
// A gaveta

/** O mesmo fechar da gaveta do Marketplace (redondo, fundo suave), com o X no desenho dos ícones do nod. */
export const BOTAO_FECHAR = '<button type="button" class="rx-fechar" data-rx="fechar" aria-label="Fechar o Raio-X"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';

const MOTIVO_NO_CHIP: Record<MotivoRecomeco, string> = { troca_de_conta: "troca de conta", troca_de_ia: "troca de IA", troca_de_maquina: "troca de máquina", sessao_recusada: "sessão recusada", autocompactacao: "histórico enchia" };

/** NOD-312: "recomeçou · troca de conta" (ou de IA, de máquina, sessão recusada), "lembrando" (retomada) ou "sessão nova". */
export function rotuloDaSessao(c: Pick<ComposicaoRaioX, "sessaoRetomada" | "recomeco">): string {
  // Revisão 9: um motivo que esta web não conhece (servidor mais novo) fica só "recomeçou", nunca "undefined".
  if (c.recomeco) return MOTIVO_NO_CHIP[c.recomeco.motivo] ? `recomeçou · ${MOTIVO_NO_CHIP[c.recomeco.motivo]}` : "recomeçou";
  return c.sessaoRetomada ? "lembrando" : "sessão nova";
}

function cabecalho(r: RaioXTurno, nome: string, onde: string): string {
  const x = r.execucao;
  const fim = x ? ` → ${new Date(r.criadoEm + x.duracaoMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  const quando = `${new Date(r.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${fim}`;
  const partes = [nome, quando, modeloCurto(x?.modelo ?? r.composicao?.modelo ?? null), x?.versaoCli ? `Claude Code ${x.versaoCli}` : "", x?.versaoApp ? `app ${x.versaoApp}` : "", r.composicao ? rotuloDaSessao(r.composicao) : "", onde].filter(Boolean);
  return `<header class="rx-cab"><div><h2 id="rx-titulo">Raio-X do turno</h2><p class="rx-meta">${partes.map(esc).join(" · ")}</p></div>${BOTAO_FECHAR}</header>`;
}

/**
 * O conteúdo da gaveta, sem DOM: cabeçalho, as duas abas e o rodapé. `onde` (chat limpo, PR 6, 2026-10-18): "catcher" ou
 * "rodou em <máquina>", da fala que abriu o Raio-X (`ondeRodou`); saiu do balão e fica aqui e na faixa do modo dev.
 */
export function renderRaioX(r: RaioXTurno, nome: string, onde = ""): string {
  return `${cabecalho(r, nome, onde)}
    <div class="rx-abas" role="tablist" aria-label="Raio-X do turno">
      <button type="button" role="tab" id="rx-aba-custo" aria-controls="rx-painel-custo" aria-selected="true" tabindex="0" data-aba="custo">Custo e contexto</button>
      <button type="button" role="tab" id="rx-aba-enviado" aria-controls="rx-painel-enviado" aria-selected="false" tabindex="-1" data-aba="enviado">O que foi enviado</button>
    </div>
    <div class="rx-corpo" role="tabpanel" id="rx-painel-custo" aria-labelledby="rx-aba-custo" tabindex="0" data-painel="custo">${abaCusto(r)}</div>
    <div class="rx-corpo" role="tabpanel" id="rx-painel-enviado" aria-labelledby="rx-aba-enviado" tabindex="0" data-painel="enviado" hidden>${abaEnviado(r)}</div>
    <footer class="rx-rodape"><button type="button" class="bt" data-rx="copiar"><span>Copiar o turno em JSON</span></button></footer>`;
}
