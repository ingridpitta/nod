import type { DonoDto } from "../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { acaoLocal, comAcaoLocal, htmlDasAcoes } from "../lib/esperas-de-colega.ts";
import { conversaViva, esperaNaTela, fraseDoDono, frentesDoBot, grupoDaLinha, linhaDoDono, quemPediu, temDonos, type GrupoDoBot, type LinhaDoDono } from "../lib/dono.ts";
import { ICONE } from "../lib/icones.ts";
import { duracaoCurta } from "../lib/relogio.ts";
import { esc, hora, iconeAgente } from "../lib/render.ts";
import { aberto, abertosDoBot, maquinasDe, meiaNoiteDe, memoriaDosBots, naFilaDaCota, pilulaDaCota, textoNaFilaDaCota, pilulaDasMaquinas, pilulaMac, pilulaMemoria, leituraDoMac, maquinasDoAviso, rodandoNoMac, textoDaContagemDeMemoria, pontoTrabalho, seguradoPeloMac, situacaoDe, tempoDe, tituloCurto } from "../lib/trabalhos.ts";
import { agente, chipTrabalhosDoBot } from "./trabalhos.ts";

/**
 * O dono de cada bot na tela (definido em 2026-10-12, ADR-099 item 10, parte 5; protótipo docs/prototipos/um-dono-por-bot/,
 * quadros 01 e 05): o sinal do bot na barra lateral e a tela Trabalhos com uma linha por bot. As frases saem de
 * web/lib/dono.ts; aqui, o HTML. Servidor sem o dono (anterior ao I10): as telas de antes (o chip com o número, a lista por
 * task). A linha acima do campo virou a pílula que se alarga (chat limpo, PR 8: web/telas/pilula-do-bot.ts).
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/** As decisões abertas do bot (a mais nova primeiro): o "Esperando você" leva até a mensagem dela na conversa. */
function decisoesDoBot(estado: Estado, agenteId: string): { id: string; frase: string; desde: number }[] {
  const itens = (estado.suaVez?.itens ?? []).filter((i) => i.decisao.agenteId === agenteId && i.estadoColuna !== "vencido");
  return itens.map((i) => ({ id: i.decisao.id, frase: i.decisao.frase, desde: Date.parse(i.decisao.criadoEm) })).sort((a, b) => b.desde - a.desde);
}

/**
 * O estado da memória (ou do disco cheio que segura tudo) do Mac agora, com a frase, a cor e para onde leva: o ponto da
 * pílula do bot e do progresso na fala (PR 8) e a linha "Agora" da Atividade (ADR-114) leem daqui. null = nada pede a pessoa.
 */
export function memoriaDoMac(estado: Estado, agenteId: string, conversaId: string | null | undefined): { texto: string; nivel: "amarela" | "vermelha"; alvo: string; abertos: number; rodandoAqui: number; disco: boolean } | null {
  const maquinas = maquinasDe(estado.trabalhos);
  // NOD-372: com as máquinas no DTO, a memória conta só os trabalhos do bot rodando no Mac (sem nenhum, ela some); o
  // servidor anterior segue com os abertos. `abertos` segue sendo os abertos do bot: é por ele que a pílula e a fala
  // mostram o disco cheio, que vale mesmo sem nada rodando no Mac (a fila parada é justamente o caso dele).
  const doBot = abertosDoBot(estado, agenteId, conversaId);
  const abertos = doBot.length;
  const rodandoAqui = maquinas ? rodandoNoMac(doBot).length : abertos;
  const legado = estado.trabalhos?.motivoEspera === "disco" && estado.trabalhos.seguraTudoNovo === true;
  const disco = maquinas ? maquinas.find((m) => m.motivoEspera === "disco" && m.seguraTudoNovo) : legado ? { ehMac: true, nome: "seu Mac" } : undefined;
  const nivel = maquinas ? leituraDoMac(estado.trabalhos).pressao : estado.pressao;
  const n = textoDaContagemDeMemoria(rodandoAqui, maquinas ? "rodando" : "abertos");
  const semMemoria = maquinas !== undefined && rodandoAqui === 0;
  const alvo = disco ? `data-act="secao-espaco" data-secao="${disco.ehMac ? "este-mac" : "maquinas"}"` : 'data-act="navegar" data-tela="trabalhos"';
  const texto = disco
    ? `${disco.ehMac ? "Pouco espaço no disco do seu Mac" : `Pouco espaço no disco em ${disco.nome}`} · nenhuma task nova começa`
    : semMemoria ? null : nivel === "amarela" ? `Pouca memória no seu Mac · ${n}` : nivel === "vermelha" ? `Seu Mac está quase sem memória · pode travar; ${n}` : null;
  if (!texto) return null;
  return { texto, nivel: disco || nivel === "vermelha" ? "vermelha" : "amarela", alvo, abertos, rodandoAqui, disco: Boolean(disco) };
}

// ---- a barra lateral (quadro 01 × o desenho) ----------------------------------------------------------------------------

/**
 * O sinal do bot ao lado do nome: um só — ponto vivo trabalhando (com o número de frentes, se mais de uma), vazado só
 * esperando (ou só com fila), azul quando precisa de você; o `title` diz a frase inteira ("1 trabalhando · 10
 * esperando"). Só lê `GET trabalhos` (a barra é lembrada pelo que lê, web/lib/lembrar.ts); por isso o turno da própria
 * conversa não conta aqui — o mascote já anima. Sem o dono no servidor, o chip de antes.
 */
export function sinalDoBot(estado: Estado, a: Pick<Agente, "id" | "cor" | "conversaId">): string {
  if (!temDonos(estado)) return chipTrabalhosDoBot(estado, a);
  const dono = estado.trabalhos?.donos?.find((d) => d.estado.agenteId === a.id);
  const l = dono ? linhaDoDono(dono, 0) : null;
  if (!dono || !l) return "";
  const frase = fraseDoDono({ ...dono, estado: { ...dono.estado, conversaTrabalhando: false, conversaPropriaTrabalhando: false } });
  const ponto = l.sinal === "voce" ? "precisa" : l.sinal === "vivo" ? `${esc(a.cor)} pulso-trab` : "fora-do-mac";
  const n = l.sinal === "vivo" && dono.estado.frentes > 1 ? `<span class="sinal-n">${dono.estado.frentes}</span>` : "";
  return `<span class="chip-trab sinal-dono" data-sinal="${l.sinal}" title="${esc(frase)}" aria-label="${esc(frase)}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span>${n}</span>`;
}

// ---- Trabalhos com uma linha por bot (quadro 05) ----------------------------------------------------------------------

const GRUPOS: { chave: GrupoDoBot; titulo: string }[] = [
  { chave: "precisa", titulo: "Precisa de você" },
  { chave: "trabalhando", titulo: "Trabalhando" },
  { chave: "esperando", titulo: "Esperando" },
];

type LinhaDoBot = { bot: Agente; dono: DonoDto; linha: LinhaDoDono; grupo: GrupoDoBot };

/** A frase e o detalhe curto do bot em Trabalhos: a pergunta (ou "Esperando você"), a frente que trabalha, a espera. */
function fraseDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): { frase: string; detalhe: string; tempo: string } {
  const e = x.dono.estado;
  const desde = e.desde ?? estado.agora;
  if (x.grupo === "precisa") {
    const d = decisoesDoBot(estado, x.bot.id)[0];
    // A frase da fila da pergunta é "parei para perguntar a Marlon: <a pergunta>"; aqui só a pergunta.
    const frase = d?.frase.replace(/^parei para perguntar a [^:]{1,60}:\s*/, "") || "Esperando você";
    return { frase, detalhe: x.linha.extras.join(" · "), tempo: `há ${duracaoCurta(estado.agora - desde)}` };
  }
  if (x.grupo === "trabalhando") {
    // Uma frente só trabalhando: o título dela é a frase (quadro 05); mais de uma, "Trabalhando em N frentes".
    const vivas = todos.filter((t) => t.agenteId === x.bot.id && t.estado === "rodando" && t.turnoVivoId);
    const frase = vivas.length === 1 && vivas[0] ? tituloCurto(vivas[0].titulo) : x.linha.texto;
    return { frase, detalhe: x.linha.extras.join(" · "), tempo: `desde ${hora(desde)}` };
  }
  // Esperando: o tempo já vai à direita ("desde 17:58"); a duração sai do detalhe. NOD-377: a única espera, de colega
  // vencida, diz "sem resposta há 26h" no lugar do "desde".
  // Revisão do PR #544: com a ação local por cima (a cobrada já não está vencida; a desistida sai).
  const esperas = x.dono.esperas.map((e) => comAcaoLocal(e)).filter((e) => e !== null);
  const [unica] = esperas;
  const vencida = esperas.length === 1 && unica?.tipo === "colega" && unica.colega?.vencida === true && unica.colega.tarefaId ? esperaNaTela(unica, estado.agora).colega?.resumo : undefined;
  return { frase: x.linha.texto, detalhe: x.linha.extras.filter((s) => !/^(\d+ min|menos de 1 min|\d+h|\d+ d)$/.test(s)).join(" · "), tempo: vencida ?? `desde ${hora(desde)}` };
}

/** "2 bots trabalhando · 1 esperando · 1 precisa de você" e, quando há leitura, a memória dos bots em cada máquina. */
function resumoPorBot(linhas: readonly LinhaDoBot[], memoria: string): string {
  const n = (g: GrupoDoBot) => linhas.filter((l) => l.grupo === g).length;
  const t = n("trabalhando");
  const partes = [
    `${t} ${t === 1 ? "bot trabalhando" : "bots trabalhando"}`,
    n("esperando") ? `${n("esperando")} esperando` : "",
    n("precisa") ? `${n("precisa")} ${n("precisa") === 1 ? "precisa" : "precisam"} de você` : "",
    memoria,
  ];
  return partes.filter(Boolean).join(" · ");
}

/**
 * Trabalhos com uma linha por bot (ADR-099 item 10): Precisa de você, Trabalhando e Esperando (pelo sinal da linha do
 * dono), e "Livres: …" numa linha no fim. Cada linha: ponto, mascote, nome, a frase e o detalhe curto, o tempo; o clique
 * abre as frentes do bot embaixo dela (quadro 05). As pílulas da cota e das máquinas ficam no topo
 * (NOD-369: o custo de hoje saiu).
 */
export function renderTrabalhosPorBot(estado: Estado): string {
  if (!estado.trabalhos) return '<section class="tela-trabalhos"><p class="mudo">carregando…</p></section>';
  const todos = estado.trabalhos.trabalhos;
  const linhas: LinhaDoBot[] = [];
  const livres: Agente[] = [];
  for (const dono of estado.trabalhos.donos ?? []) {
    const bot = agente(estado, dono.estado.agenteId);
    if (!bot) continue;
    const vivaAgora = conversaViva(estado, bot.conversaId);
    const viva = { ...dono, estado: { ...dono.estado, conversaTrabalhando: vivaAgora, conversaPropriaTrabalhando: vivaAgora } };
    const linha = linhaDoDono(viva, estado.agora, { comConversa: true });
    const grupo = grupoDaLinha(linha);
    if (linha && grupo) linhas.push({ bot, dono: viva, linha, grupo });
    else livres.push(bot);
  }
  const secoes = GRUPOS.map((g) => {
    const doGrupo = linhas.filter((l) => l.grupo === g.chave).sort((a, b) => (a.dono.estado.desde ?? 0) - (b.dono.estado.desde ?? 0));
    if (!doGrupo.length) return "";
    return `<section class="tt-grupo tb-grupo" data-grupo="${g.chave}"><h2>${g.titulo} · ${doGrupo.length}</h2><div class="tt-lista">${doGrupo.map((x) => linhaDoBot(estado, x, todos)).join("")}</div></section>`;
  }).join("");
  const nomesLivres = livres.map((b) => b.nome);
  const livresHtml = nomesLivres.length ? `<p class="tb-livres">Livres: ${esc(nomesLivres.join(", "))}</p>` : "";
  const vazio = linhas.length ? "" : `<p class="tt-vazio">Nenhum bot está trabalhando agora. Quando um bot começar uma frente, esperar algo ou precisar de você, aparece aqui.</p>`;
  return `<section class="tela-trabalhos" aria-label="Trabalhos">
    <header class="tt-cab"><div><h1>Trabalhos</h1><p>${esc(resumoPorBot(linhas, memoriaDosBots(estado.trabalhos)))}</p></div></header>
    ${pilulaDaCota(estado.trabalhos.cota, todos, estado.agora, estado.trabalhos.pedidosNaFila)}${pilulaDoTopo(estado)}
    ${secoes}${vazio}${livresHtml}
  </section>`;
}

/** A pílula das máquinas ou da memória no topo (a mesma regra de "Todos os trabalhos": o disco primeiro, uma pílula só). */
function pilulaDoTopo(estado: Estado): string {
  const dto = estado.trabalhos;
  if (!dto) return "";
  const todos = dto.trabalhos;
  const abertos = todos.filter(aberto).length;
  const segurando = dto.segurando === true;
  const maquinas = maquinasDe(dto);
  if (maquinas) return pilulaDasMaquinas(maquinas.filter((m) => m.motivoEspera === "disco"), todos) || pilulaMemoria(leituraDoMac(dto).pressao, rodandoNoMac(todos).length, false) || pilulaDasMaquinas(maquinasDoAviso(maquinas, todos), todos);
  const motivo = dto.motivoEspera ?? null;
  const esperam = todos.filter((t) => seguradoPeloMac(t, segurando)).length;
  return (motivo === "disco" ? pilulaMac(segurando, esperam, true, motivo) : "") || pilulaMemoria(estado.pressao, abertos, false, "abertos") || pilulaMac(segurando, esperam, true, motivo);
}

function linhaDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const { frase, detalhe, tempo } = fraseDoBot(estado, x, todos);
  const aberta = estado.botAbertoEmTrabalhos === x.bot.id;
  const ponto = x.linha.sinal === "voce" ? "precisa" : x.linha.sinal === "vivo" ? `${esc(x.bot.cor)} pulso-trab` : "fora-do-mac";
  const linha = `<button type="button" class="tt-linha tb-linha" data-act="bot-trabalhos" data-agente="${esc(x.bot.id)}" aria-expanded="${aberta}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span><span class="tt-bot">${iconeAgente(x.bot, "sm")}<b>${esc(x.bot.nome)}</b></span><span class="tt-meio"><span class="tt-titulo">${esc(frase)}</span>${detalhe ? `<span class="tt-passo">${esc(detalhe)}</span>` : ""}</span><span class="tt-fim">${esc(tempo)}</span>${aberta ? ICONE.recolher : ICONE.seta}</button>`;
  return aberta ? linha + frentesAbertasDoBot(estado, x, todos) : linha;
}

/** As frentes do bot aberto em Trabalhos (quadro 05): abertas, terminadas hoje, as esperas da conversa e a fila. */
function frentesAbertasDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const { abertas, terminadas } = frentesDoBot(todos, x.bot.id, meiaNoiteDe(estado.agora));
  const frente = (t: TrabalhoDto): string => {
    const fim = aberto(t) ? (t.estado === "na_fila" ? "na fila" : `frente · ${tempoDe(t, estado.agora)}`) : hora(t.terminadoEm ?? t.criadoEm);
    // Revisão do Gil no #340: a linha corta com reticências e o fim (a hora da volta) some primeiro — o title mostra a frase inteira.
    const passo = aberto(t) ? situacaoDe(t, todos, false, estado.agora) : "";
    return `<button type="button" class="tb-frente" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, x.bot.cor)}<span class="tb-frente-titulo">${esc(tituloCurto(t.titulo))}</span><span class="tb-frente-passo"${passo ? ` title="${esc(passo)}"` : ""}>${esc(passo)}</span><span class="tb-frente-fim">${esc(fim)}</span></button>`;
  };
  const daConversa = x.dono.esperas.filter((e) => e.trabalhoId === null).map((d) => comAcaoLocal(d)).filter((e) => e !== null).map((e) => {
    const v = esperaNaTela(e, estado.agora);
    const c = v.colega;
    // NOD-377 (protótipo, passo 10): vencida, "sem resposta há 26h" à direita e a linha de Cobrar/Desistir embaixo.
    const fim = c?.vencida ? c.resumo : v.tempo;
    const passo = c?.resumo && !c.vencida ? `${c.resumo} · ${v.linhas.at(-1) ?? ""}` : v.linhas.at(-1) ?? "";
    const acoes = c?.acoes ? htmlDasAcoes({ agenteId: x.bot.id, tarefaId: c.tarefaId, colega: c.nome, podeCobrar: c.podeCobrar, fase: acaoLocal.fase(c.tarefaId), classe: "p377-acoes-tb" }) : "";
    return `<div class="tb-frente estatica${c?.vencida ? " p377-frente" : ""}"><span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span><span class="tb-frente-titulo">${esc(v.titulo)}</span><span class="tb-frente-passo">${esc(passo)}</span><span class="tb-frente-fim${c?.vencida ? " p377-venc" : ""}">${esc(fim)}</span></div>${acoes}`;
  }).join("");
  const fila = x.dono.fila.map((p, i) => {
    // NOD-302: o pedido que a cota da IA segura diz "na fila (cota)" e quando volta.
    const cota = naFilaDaCota(estado.trabalhos, p.turnoId);
    return `<div class="tb-frente estatica"${cota ? ' data-cota="1"' : ""}><span class="ld-ordem" aria-hidden="true">${i + 1}</span><span class="tb-frente-titulo">Na fila: ${esc(quemPediu(p))}</span><span class="tb-frente-passo">${cota ? esc(textoNaFilaDaCota(cota, estado.agora)) : ""}</span><span class="tb-frente-fim">${esc(hora(p.desde))}</span></div>`;
  }).join("");
  const corpo = [...abertas.map(frente), daConversa, ...terminadas.map(frente), fila].join("");
  const conversa = `<button type="button" class="tb-abrir-conversa" data-act="abrir-conversa" data-conversa="${esc(x.bot.conversaId)}" data-agente="${esc(x.bot.id)}">Abrir a conversa com ${esc(x.bot.nome)} ›</button>`;
  return `<div class="tb-frentes" role="group" aria-label="Frentes de ${esc(x.bot.nome)}">${corpo || '<p class="tb-sub">Nenhuma frente hoje.</p>'}${conversa}</div>`;
}
