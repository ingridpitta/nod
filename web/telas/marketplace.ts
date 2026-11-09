import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { avisoErro } from "../lib/card-proposta.ts";
import { haQuanto } from "../lib/relogio.ts";
import { ICONE } from "../lib/icones.ts";
import { voltaDaTela } from "../lib/volta.ts";
import { cartaoCanvas, gavetaCanvas, SLUG_CANVAS } from "./marketplace-canvas.ts";
import { barraDeLote, caixaDoBot, linhaDoPadrao, seguePadrao } from "./acessos-do-app.ts";
import { acoes, blocoEsperando, blocoFalhou, botsQueUsam, conectorDoApp, gruposDe, meusBots, nivelDoBot, podeENao, ROTULO_NIVEL, SETA_EXTERNA, situacaoDoApp, type Nivel, type NivelAtual, type SituacaoApp } from "./app-acesso.ts";

/**
 * definido em 2026-09-29 (ADR-057, "Logos oficiais"): onde o logo que o Composio serve é antigo ou de
 * outra marca, a web usa o arquivo da própria marca, guardado em web/public/logos/. As fontes estão no ADR.
 */
const LOGOS_OFICIAIS: ReadonlySet<string> = new Set(["basecamp", "bitbucket", "confluence", "dynamics365", "freshbooks", "googlesheets", "harvest", "jira", "linear", "prisma"]);

/**
 * revisto em 2026-09-21 (ADR-041): app novo no painel não tem símbolo escrito à mão aqui, então o
 * logo vem do provedor PELO SERVIDOR. A inicial continua desenhada por baixo: é ela que aparece
 * enquanto a imagem carrega e se a busca falhar (onerror some com a <img> e descobre o span).
 *
 * revisto em 2026-09-29: a URL não levava o tenant (/api/marketplace/:slug/logo) e toda busca dava 404 —
 * nenhum logo do provedor chegou à tela, só os símbolos. A rota é escopada (/api/t/:tenant/…, ADR-005),
 * como os anexos em conversa.ts. Os símbolos desenhados à mão (✣, ⌘, 31…) saíram: sem logo, a inicial.
 */
export function logoApp(ctx: Pick<Estado, "marketplace"> & Partial<Pick<Estado, "sessao">>, slug: string, nome: string): string {
  const tenant = ctx.sessao?.tenantId;
  const src = LOGOS_OFICIAIS.has(slug)
    ? `/logos/${slug}.svg`
    : tenant && ctx.marketplace.some((a) => a.slug === slug && a.logo)
      ? `/api/t/${encodeURIComponent(tenant)}/marketplace/${encodeURIComponent(slug)}/logo`
      : null;
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()" />` : "";
  return `<span class="app-logo app-${esc(slug)}" aria-hidden="true">${esc(nome.slice(0, 1).toUpperCase())}${img}</span>`;
}

/**
 * O marketplace (revisto em 2026-09-25, jornadas de conexão). A tela antiga misturava ✓ e erro no mesmo
 * cartão, três botões sem dizer o estado, o login em dois cliques mais um "Verificar" manual e, embaixo,
 * o catálogo cru de cada MCP e a concessão ação por ação. Agora:
 * - cada app tem UM estado (não conectado, conectando, conectado, precisa de atenção) e UMA ação;
 * - "Conectar" no cartão já abre o login, e o cartão espera sozinho (web/lib/conexao.ts);
 * - o login termina e a gaveta abre em "Quem pode usar o {App}?": Nenhum / Ler / Ler e alterar por bot;
 * - clicar no resto do cartão abre a gaveta para ler antes, ou gerenciar;
 * - a parte técnica (chave do Composio, MCP próprio, catálogos, concessão por ação) foi para "Avançado".
 */

type Filtro = "todos" | "conectados" | "atencao";

const PILULA: Record<SituacaoApp, { texto: string; classe: string }> = {
  nao_conectado: { texto: "Não conectado", classe: "neutra" },
  conectando: { texto: "Conectando", classe: "ambar" },
  conectado: { texto: "Conectado", classe: "ok" },
  atencao: { texto: "Precisa de atenção", classe: "ambar" },
};

function pilula(s: SituacaoApp): string {
  const p = PILULA[s];
  return `<span class="pilula pilula-${p.classe}">${esc(p.texto)}</span>`;
}

function avataresQueUsam(estado: Estado, c: Conector): string {
  const bots = botsQueUsam(estado, c);
  if (bots.length === 0) return '<span class="mkt-uso mudo">Nenhum bot usa ainda</span>';
  const rostos = bots.slice(0, 4).map((b) => iconeAgente(b.agente, "sm")).join("");
  return `<span class="mkt-uso"><span class="mkt-rostos">${rostos}</span>${bots.length === 1 ? `${esc(bots[0]!.agente.nome)} usa` : `${bots.length} bots usam`}</span>`;
}

function acaoDoCartao(estado: Estado, app: AppComLogo, s: SituacaoApp): string {
  const login = estado.conectando[app.slug];
  if (s === "conectando") return `${blocoEsperando(app.nome, login?.url ?? null, true, login?.semJanela === true)}${botao("cancelar-conexao", "Cancelar", { classe: "link sm", id: app.slug })}`;
  if (login?.falhou) return `${blocoFalhou(login.falhou)}${botao("conectar-app", "Tentar de novo", { classe: "sm", id: app.slug })}`;
  if (s === "atencao") return botao("conectar-app", "Entrar de novo", { classe: "pri sm", id: app.slug });
  if (s === "conectado") {
    const c = conectorDoApp(estado, app.slug);
    return c ? avataresQueUsam(estado, c) : "";
  }
  return botao("conectar-app", "Conectar", { classe: "sm", id: app.slug });
}

function cartao(estado: Estado, app: AppComLogo, s: SituacaoApp, selecionado: boolean): string {
  return `<article class="app-card sit-${s}${selecionado ? " selected" : ""}" data-app-busca="${esc(`${app.nome} ${app.categoria} ${app.descricao}`.toLowerCase())}" id="app-${esc(app.slug)}">
    <button type="button" class="app-card-abrir" data-act="abrir-app" data-id="${esc(app.slug)}" aria-label="${esc(`Ver ${app.nome}`)}"></button>
    <div class="app-card-heading">${logoApp(estado, app.slug, app.nome)}<span class="app-card-nome"><h3>${esc(app.nome)}</h3><small>${esc(app.categoria)}</small></span>${pilula(s)}</div>
    <p>${esc(app.descricao)}</p>
    <div class="app-card-actions">${acaoDoCartao(estado, app, s)}</div>
  </article>`;
}

function motivoDaFalha(c: Conector | undefined): string {
  const m = c?.ultimaFalha?.motivo;
  if (c?.ultimaFalha?.causa === "acesso_recusado") return "recusou o acesso";
  if (m === "timeout_transporte") return "parou de responder";
  return "não está respondendo";
}

function faixaAtencao(estado: Estado, apps: readonly AppComLogo[]): string {
  const linhas = apps.map((app) => {
    const c = conectorDoApp(estado, app.slug);
    const bots = c ? botsQueUsam(estado, c).map((b) => b.agente.nome) : [];
    const quem = bots.length === 0 ? "Nenhum bot depende dele agora." : `${bots.length === 1 ? bots[0] : `${bots.slice(0, -1).join(", ")} e ${bots.at(-1)}`} ${bots.length === 1 ? "não consegue" : "não conseguem"} usar o ${app.nome}${c?.ultimaFalha ? ` desde ${haQuanto(estado.agora - c.ultimaFalha.em)}` : ""}.`;
    // NOD-399: cada app é o aviso neutro, de largura toda, com a ação à direita (nada de faixa âmbar).
    return avisoErro({ frase: `O ${app.nome} ${motivoDaFalha(c)}.`, mais: `${quem} Entrar de novo costuma resolver.`, acoes: botao("conectar-app", "Entrar de novo", { classe: "cp-acao sm", id: app.slug }), pleno: true, classe: "atencao-linha" });
  });
  return linhas.length ? `<section class="mkt-atencao cp-faixa" aria-label="Precisam de atenção">${linhas.join("")}</section>` : "";
}

function filtros(atual: Filtro, conectados: number, atencao: number): string {
  const f = (id: Filtro, rotulo: string) => botao("filtro-marketplace", rotulo, { classe: `chip-filtro${id === atual ? " ativo" : ""}`, id, ...(id === atual ? { aria: `${rotulo} (selecionado)` } : {}) });
  return `<div class="mkt-filtros" role="group" aria-label="Filtrar apps">${f("todos", "Todos")}${f("conectados", `Conectados · ${conectados}`)}${atencao ? f("atencao", `Precisam de atenção · ${atencao}`) : ""}</div>`;
}

// ------------------------------------------------------------------------------------ gaveta

function seletorNivel(agenteId: string, conectorId: string, atual: NivelAtual, nome: string): string {
  const op = (n: Nivel) => `<button type="button" class="seg${n === atual ? " ativo" : ""}" data-act="nivel-bot" data-id="${esc(agenteId)}" data-conector="${esc(conectorId)}" data-nivel="${n}" aria-pressed="${n === atual}">${esc(ROTULO_NIVEL[n])}</button>`;
  return `<div class="segmentado" role="group" aria-label="${esc(`Acesso de ${nome}`)}">${op("nenhum")}${op("leitura")}${op("escrita")}</div>`;
}

function quemPodeUsar(estado: Estado, c: Conector, titulo: string, nomeApp: string): string {
  const bots = meusBots(estado);
  const linhas = bots.map((a) => {
    const nivel = nivelDoBot(estado, a.id, c);
    // "Personalizado": ações dadas uma a uma (pela rotina, pelo card, na tela avançada). Nenhum botão aceso —
    // escolher um nível mexe só em ler, criar, editar e comentar; apagar e o resto ficam como estão.
    const sub = nivel === "personalizado" ? "Personalizado · ações escolhidas uma a uma" : seguePadrao(c.id, a.id) ? "Segue o padrão do app" : a.titulo || "Seu bot";
    return `<div class="quem-linha">${caixaDoBot(c.id, a.id, a.nome)}${iconeAgente(a, "sm")}<div class="quem-nome"><b>${esc(a.nome)}</b><small>${esc(sub)}</small></div>${seletorNivel(a.id, c.id, nivel, a.nome)}</div>`;
  }).join("");
  // ADA-241: o padrão do app e a barra de lote (web/telas/acessos-do-app.ts).
  const topo = bots.length ? `${linhaDoPadrao(c.id, nomeApp)}${barraDeLote(c.id, nomeApp, bots.map((a) => a.id))}` : "";
  return `<section class="gaveta-secao"><h3>${esc(titulo)}</h3>${topo}${bots.length ? `<div class="quem-lista">${linhas}</div>` : '<p class="mudo">Você ainda não tem bots.</p>'}<p class="mudo">Quem ficar sem acesso pode pedir na conversa quando precisar; você decide ali, com um clique. Apagar fica sempre de fora de "Ler e alterar".</p></section>`;
}

function oQueLibera(estado: Estado, slug: string): string {
  const leitura = podeENao(estado, slug, "leitura");
  return `<section class="gaveta-secao"><h3>O que os bots podem fazer</h3>
    <div class="nivel-caixa"><b>Ler</b><p>${esc(leitura.pode[0] ?? "")}. ${esc(leitura.nao[0] ?? "")}.</p></div>
    <div class="nivel-caixa"><b>Ler e alterar</b><p>Também criar, editar e comentar. Apagar fica sempre de fora.</p></div>
  </section>`;
}

function comoFunciona(nome: string): string {
  return `<section class="gaveta-secao"><h3>Como funciona</h3><ol class="como"><li>Você entra no ${esc(nome)} numa janela. O Nod não vê sua senha.</li><li>Escolhe quais bots podem usar, e com qual nível.</li><li>Cada pessoa do time conecta a própria conta.</li></ol></section>`;
}

function detalhesTecnicos(c: Conector): string {
  const grupos = gruposDe(c.catalogo, c.catalogo.map((x) => x.nome));
  return `<details class="gaveta-tecnico" data-disclosure="gaveta-tecnico-${esc(c.id)}"><summary>Detalhes técnicos (${esc(acoes(c.catalogo.length))})</summary><ul>${grupos.map((g) => `<li><b>${esc(g.rotulo)}</b> · ${esc(acoes(g.capacidades.length))}</li>`).join("")}</ul>${botao("abrir-avancado", "Ver na tela avançada", { classe: "link sm" })}</details>`;
}

function gaveta(estado: Estado, app: AppComLogo, passo: "detalhes" | "quem-usa"): string {
  const s = situacaoDoApp(estado, app.slug);
  const c = conectorDoApp(estado, app.slug);
  const login = estado.conectando[app.slug];
  let corpo: string;
  let rodape: string;
  if (s === "conectando") {
    corpo = `${blocoEsperando(app.nome, login?.url ?? null, false, login?.semJanela === true)}${oQueLibera(estado, app.slug)}`;
    rodape = botao("cancelar-conexao", "Cancelar", { classe: "link", id: app.slug });
  } else if ((s === "conectado" || s === "atencao") && c) {
    const status = s === "atencao"
      ? `<div class="gaveta-status">${blocoFalhou(`O ${app.nome} ${motivoDaFalha(c)}.`, "", "Entrar de novo costuma resolver.")}</div>`
      : `<div class="gaveta-status"><span class="bolinha-ok" aria-hidden="true"></span><div><b>Conectado</b><small>${c.sondadoEm ? `Funcionando · verificado ${esc(haQuanto(estado.agora - c.sondadoEm))}` : "Funcionando"}</small></div></div>`;
    corpo = `${status}${quemPodeUsar(estado, c, passo === "quem-usa" ? `Quem pode usar o ${app.nome}?` : "Quem usa", app.nome)}${detalhesTecnicos(c)}`;
    rodape = passo === "quem-usa"
      ? botao("fechar-gaveta", "Pronto", { classe: "pri" })
      // revisto em 2026-09-25 (revisão do PR #68): "Entrar de novo" só com o app em atenção — refazer o login
      // desliga o conector até o novo terminar, e num app que funciona isso só tira o acesso dos bots.
      : `${s === "atencao" ? botao("conectar-app", "Entrar de novo", { classe: "pri", id: app.slug }) : ""}${botao("desconectar-app", `Desconectar ${esc(app.nome)}`, { classe: "link perigo", id: c.id })}`;
  } else {
    const falha = login?.falhou ? blocoFalhou(login.falhou) : "";
    corpo = `${falha}<p class="gaveta-desc">${esc(app.descricao)}</p>${oQueLibera(estado, app.slug)}${comoFunciona(app.nome)}`;
    rodape = botao("conectar-app", `${login?.falhou ? "Tentar de novo" : `Conectar ${esc(app.nome)}`} ${SETA_EXTERNA}`, { classe: "pri largo", id: app.slug });
  }
  return `<div class="gaveta-fundo" data-act="fechar-gaveta"></div>
  <aside class="gaveta" role="dialog" aria-modal="true" aria-label="${esc(app.nome)}">
    <div class="gaveta-cab">${logoApp(estado, app.slug, app.nome)}<div><h2>${esc(app.nome)}</h2><small>${esc(app.categoria)}</small></div>${botao("fechar-gaveta", "×", { classe: "gaveta-fechar", aria: "Fechar" })}</div>
    <div class="gaveta-corpo">${corpo}</div>
    <div class="gaveta-rodape">${rodape}</div>
  </aside>`;
}

// ------------------------------------------------------------------------------------ tela

export function renderMarketplace(estado: Estado): string {
  const tela = estado.tela.tipo === "conectores" ? estado.tela : null;
  const filtro: Filtro = tela?.filtro ?? "todos";
  const situacoes = estado.marketplace.map((app) => ({ app, s: situacaoDoApp(estado, app.slug) }));
  const conectados = situacoes.filter((x) => x.s === "conectado").length;
  const atencao = situacoes.filter((x) => x.s === "atencao");
  const visiveis = situacoes.filter((x) => filtro === "todos" || (filtro === "conectados" ? x.s === "conectado" : x.s === "atencao"));
  // definido em 2026-09-29 (ADR-057): o catálogo público vem depois do dia a dia, numa seção própria; o app
  // dele que a pessoa conectou sobe para a grade de cima. Enquanto conecta, fica onde foi clicado: o cartão
  // que espera o login (web/lib/conexao.ts) não pode sumir da vista no meio da espera.
  const doCatalogo = (x: { app: AppComLogo; s: SituacaoApp }) => x.app.doCatalogo === true && (x.s === "nao_conectado" || x.s === "conectando");
  const principais = visiveis.filter((x) => !doCatalogo(x));
  const mais = visiveis.filter(doCatalogo);
  const selecionado = (slug: string) => tela?.gaveta?.slug === slug || tela?.app === slug;
  // definido em 2026-10-04: o mesmo "‹ <de onde veio>" de Seu espaço, com o mascote do bot e o Esc.
  const volta = tela?.voltar ? voltaDaTela(estado, tela.voltar) : null;
  const retorno = volta ? `<div class="tela-volta"><button type="button" class="tela-voltar" data-act="voltar-conexao" aria-keyshortcuts="Escape" title="Voltar para ${esc(volta.rotulo)} (Esc)">${ICONE.voltar}${volta.icone}<span>${esc(volta.rotulo)}</span></button><kbd>esc</kbd></div>` : "";
  const semComposio = estado.composioConfigurado ? "" : `<p class="mkt-aviso">Para conectar a maioria dos apps, o Composio do time precisa estar configurado. ${botao("abrir-avancado", "Configurar", { classe: "link" })}</p>`;
  const aviso = estado.avisoConexao ? `<p class="connection-notice" role="status">${esc(estado.avisoConexao)}</p>` : "";
  const aberta = tela?.gaveta ? estado.marketplace.find((a) => a.slug === tela.gaveta?.slug) : undefined;
  return `<div class="mkt">
    ${retorno}
    <div class="mkt-topo"><div><h1>Marketplace</h1><p>Conecte um app uma vez e escolha quais bots podem usar.</p></div>
      <label class="search mkt-busca"><span aria-hidden="true">⌕</span><input id="busca-marketplace" aria-label="Buscar apps" placeholder="Buscar apps" /></label></div>
    ${aviso}${semComposio}
    ${filtros(filtro, conectados, atencao.length)}
    ${filtro === "todos" ? faixaAtencao(estado, atencao.map((x) => x.app)) : ""}
    <div class="apps-grid">${filtro === "todos" ? cartaoCanvas(estado, selecionado(SLUG_CANVAS)) : ""}${principais.map((x) => cartao(estado, x.app, x.s, selecionado(x.app.slug))).join("")}</div>
    ${mais.length ? `<section class="mkt-mais" data-secao-apps aria-labelledby="mkt-mais-titulo">
      <div class="mkt-mais-topo"><h2 id="mkt-mais-titulo">Mais apps <span class="mudo">· ${mais.length}</span></h2><p>O Composio cuida do login destes apps: é só conectar.</p></div>
      <div class="apps-grid">${mais.map((x) => cartao(estado, x.app, x.s, selecionado(x.app.slug))).join("")}</div>
    </section>` : ""}
    <p id="marketplace-vazio" class="mudo" hidden>Nenhum app encontrado.</p>
    <p class="mkt-rodape mudo">Não achou o app? ${botao("abrir-avancado", "Conectar um servidor MCP próprio", { classe: "link" })} · ${botao("abrir-avancado", "Configurações avançadas", { classe: "link" })}</p>
  </div>
  ${tela?.gaveta?.slug === SLUG_CANVAS ? gavetaCanvas(estado) : aberta && tela?.gaveta ? gaveta(estado, aberta, tela.gaveta.passo) : ""}`;
}

