import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Decisao } from "../../src/contracts/decisao.ts";
import type { Estado } from "../estado/reducer.ts";
import { linhaNaoRodaram } from "../lib/execucao.ts";
import { botao, esc } from "../lib/render.ts";
import { acoes, blocoFalhou, checkboxesDosGrupos, conectorDoApp, gruposDe, ICONE_OK, nomeDoApp, podeENao, SETA_EXTERNA } from "./app-acesso.ts";
import { MAX_LINHAS, paraBot, cardProposta, linhaProposta, rotulada } from "../lib/card-proposta.ts";
import { logoApp } from "./marketplace.ts";
import { marcaGemeas, marcaRotinaParada, rotulosAcesso } from "./sua-vez.ts";

/**
 * O card de acesso do chat (definido em 2026-09-25, jornadas de conexão): UM card do pedido até a
 * permissão. "Conectar {App}" abre o login ali mesmo — sem ir ao marketplace —, o card espera sozinho e,
 * quando o login termina, o servidor o troca pelo de permitir (ao-conectar-app.ts). Escrita também: o
 * pedido já traz o nível, e a pessoa desmarca grupos (Ler, Criar e enviar, Editar, Comentar) antes de
 * permitir. Conceder continua sendo o clique em Permitir (ADR-044).
 */

type ItemAberto = NonNullable<Estado["suaVez"]>["itens"][number];

/**
 * A linha embaixo do título: o "para quê" que o agente deu; sem ele, num pedido de rotina, a frase do
 * domínio (que diz qual rotina pediu, fraseDoPedidoDeAcesso).
 */
function subtitulo(p: Proposta, decisao: Decisao | null): string {
  if (p.payload.kind !== "acesso") return "";
  if (p.payload.para) {
    // Texto do modelo (revisão do PR #68): entre aspas e atribuído ao bot, nunca como frase do sistema.
    const t = p.payload.para.trim().replace(/^para\s+/i, "");
    return `“Para ${t.charAt(0).toLowerCase()}${t.slice(1)}”`;
  }
  return p.payload.rotinaId && decisao ? decisao.frase : "";
}

function nomeDoBot(estado: Estado, p: Proposta): string | null {
  return estado.frota?.agentes.find((a) => a.id === p.agenteId)?.nome ?? null;
}

function notaRevogar(bot: string | null): string {
  return `Dá para revogar no painel do ${bot ?? "bot"}.`;
}

/** "ler" → "leia": o verbo do título do permitir ("Permitir que a Ada leia seu Gmail"). */
function noSubjuntivo(verbo: string): string {
  return verbo.replace(/\bler\b/g, "leia").replace(/\balterar\b/g, "altere");
}

/** QA do PR #607: até 3 linhas no card; o que passa vai para o começo de Detalhes ("Também"), não some. */
function ateTres(todas: string[], detalhes: [string, string][]): string[] {
  if (todas.length > MAX_LINHAS) detalhes.unshift(["Também", todas.slice(MAX_LINHAS).join("<br>")]);
  return todas.slice(0, MAX_LINHAS);
}

/** Os grupos do pedido e o verbo do título ("ler", "alterar", "ler e alterar"); o mesmo no card e na linha expirada. */
function gruposDoPedido(estado: Estado, c: Extract<Proposta["payload"], { kind: "acesso" }>) {
  const catalogo = conectorDoApp(estado, c.conector)?.catalogo ?? [];
  // Sem o catálogo à mão (conector de outra pessoa, estado ainda carregando), o nível do pedido decide —
  // nunca chamar de "alterar" o que não se sabe.
  const conhecidas = c.capacidades.length > 0 && c.capacidades.every((n) => catalogo.some((x) => x.nome === n));
  const grupos = conhecidas ? gruposDe(catalogo, c.capacidades) : [{ id: c.nivel === "leitura" ? ("ler" as const) : ("alterar" as const), rotulo: "", capacidades: c.capacidades }];
  const soLer = grupos.every((g) => g.id === "ler");
  const verbo = soLer ? "ler" : grupos.some((g) => g.id === "ler") || !conhecidas ? "ler e alterar" : "alterar";
  return { conhecidas, grupos, soLer, verbo };
}

/** O título do permitir de um pedido de acesso (revisão 4: o verbo vem dos grupos, igual ao card aberto). */
export function tituloDoPedidoDeAcesso(estado: Estado, p: Proposta, bot: string | null | undefined): string {
  if (p.payload.kind !== "acesso") return "";
  return tituloDoPermitir(bot, gruposDoPedido(estado, p.payload).verbo, nomeDoApp(estado, p.payload.conector));
}

/** O título do permitir, igual no card aberto e na linha que expirou (QA do PR #607). Texto, sem escape. */
export function tituloDoPermitir(bot: string | null | undefined, verbo: string, nomeDoApp: string): string {
  return `Permitir que ${bot ?? "o bot"} ${noSubjuntivo(verbo)} seu ${nomeDoApp}`;
}

/** As linhas de "pode" e o "não pode" em Detalhes, a partir de podeENao. */
function podeEmLinhas(pn: { pode: string[]; nao: string[] }): { linhas: string[]; fora: [string, string][] } {
  return {
    linhas: pn.pode.map((t) => rotulada("Vai poder", t)),
    fora: pn.nao.length ? [["Fica de fora", pn.nao.map((t) => esc(t)).join("<br>")]] : [],
  };
}

/**
 * O card de conexão: o app ainda não está pronto para este pedido. NOD-399 (definido em 2026-10-30): o componente
 * comum — "Conectar o Figma à Ada", o "para quê" e o que vai poder; servidor, o que fica de fora e o login em Detalhes.
 * Esperando o login, o card encolhe numa linha que gira ("Esperando você entrar no Figma · Abrir o login de novo");
 * o login falhou, o aviso neutro dentro do card e o verbo vira "Tentar de novo".
 */
function cardConectar(p: Proposta, estado: Estado): string {
  if (p.payload.kind !== "acesso") return "";
  const slug = p.payload.conector;
  const nome = nomeDoApp(estado, slug);
  const bot = nomeDoBot(estado, p);
  const login = estado.conectando[slug];
  const conector = conectorDoApp(estado, slug);
  if (login && !login.falhou) {
    const abrir = login.url ? `<a class="cp-link" href="${esc(login.url)}" target="_blank" rel="noopener noreferrer">${login.semJanela ? "Abrir o login" : "Abrir o login de novo"}</a> <span class="cp-sep" aria-hidden="true">·</span> ` : "";
    return linhaProposta({
      tipo: "aguarda",
      texto: login.url ? `Esperando você entrar no ${esc(nome)}…` : `Preparando o login do ${esc(nome)}…`,
      link: `${abrir}${botao("cancelar-conexao", "Cancelar", { classe: "cp-link", id: slug })}`,
      classe: "cp-esperando",
      attrs: ` data-proposta="${esc(p.id)}"`,
    });
  }
  const pn = podeEmLinhas(podeENao(estado, slug, p.payload.nivel, p.payload.naoPedido));
  const sub = subtitulo(p, null);
  const agoraNao = botao("recusar-proposta", "Agora não", { classe: "cp-nao", id: p.id });
  const detalhes: [string, string][] = [
    ...pn.fora,
    ["Passos", esc(`1. Entrar no ${nome} · 2. Permitir ${paraBot(bot)}`)],
    ["Login", esc(`Você entra no ${nome}; o Nod não vê sua senha.`)],
  ];
  const base = { id: p.id, titulo: `Conectar o ${nome} ${paraBot(bot)}`, logo: logoApp(estado, slug, nome), chaveDetalhes: `cp-acesso-${p.id}` };
  if (conector?.habilitado) {
    // O login terminou por outro caminho e o card ainda não virou: um clique abre o de permitir.
    return cardProposta({
      ...base,
      linhas: ateTres([`${ICONE_OK} ${esc(nome)} conectado`, ...(sub ? [esc(sub)] : []), ...pn.linhas], detalhes),
      detalhes,
      acoes: botao("confirmar-proposta", "Continuar", { classe: "cp-sim", id: p.id }) + agoraNao,
    });
  }
  const falha = login?.falhou ? blocoFalhou(login.falhou) : "";
  return cardProposta({
    ...base,
    linhas: ateTres([...(sub ? [esc(sub)] : []), ...pn.linhas], detalhes),
    detalhes,
    extra: falha,
    acoes: botao("conectar-app", `${login?.falhou ? "Tentar de novo" : "Conectar"} ${SETA_EXTERNA}`, { classe: "cp-sim", id: slug, aria: login?.falhou ? `Tentar conectar o ${nome} de novo` : `Conectar o ${nome}` }) + agoraNao,
  });
}

/** O card de permitir: proposta e decisão de mesmo id, o app conectado. */
function cardPermitir(p: Proposta, decisao: Decisao, aberto: ItemAberto | undefined, estado: Estado): string {
  if (p.payload.kind !== "acesso") return "";
  const c = p.payload;
  const nome = nomeDoApp(estado, c.conector);
  const bot = nomeDoBot(estado, p);
  const conector = conectorDoApp(estado, c.conector);
  const catalogo = conector?.catalogo ?? [];
  const { grupos, soLer, verbo } = gruposDoPedido(estado, c);
  const marcas = `${marcaRotinaParada(p, aberto?.rotinaParada, estado.agora)}${marcaGemeas(aberto)}`;
  const sub = subtitulo(p, decisao);
  let linhas: string[];
  let fora: [string, string][];
  let caixas = "";
  if (soLer || grupos.length <= 1) {
    const pn = podeEmLinhas(podeENao(estado, c.conector, soLer ? "leitura" : "escrita", c.naoPedido));
    linhas = pn.linhas;
    fora = pn.fora;
  } else {
    // Mais de um grupo: a pessoa desmarca o que não quer dar. O input fica sob [data-decisao] para o
    // render preservar a marcação (main.ts), e Permitir manda só as capacidades dos grupos marcados.
    const pedidos = new Set(c.capacidades);
    const deFora = catalogo.filter((x) => !pedidos.has(x.nome) && (x.grupo === "apagar" || x.grupo === "outras")).length;
    const nao = [...(deFora > 0 ? [`${acoes(deFora)} de apagar, desfazer e outras`] : []), ...c.naoPedido.map((n) => `Não inclui: ${n}`)];
    linhas = [];
    fora = nao.length ? [["Fica de fora", nao.map((t) => esc(t)).join("<br>")]] : [];
    caixas = checkboxesDosGrupos(catalogo, c.capacidades);
  }
  const r = rotulosAcesso(p);
  const permitir = botao("permitir-acesso", r.permitir, { classe: "cp-sim", id: decisao.id });
  // NOD-399: "Agora não" em toda proposta; "Pausar rotina" fica, porque recusar ali pausa a rotina (outra consequência).
  const recusar = botao("recusar-decisao", r.recusar === "Não permitir" ? "Agora não" : r.recusar, { classe: "cp-nao", id: decisao.id });
  const conectado = conector?.habilitado ? `${ICONE_OK} ${esc(nome)} conectado` : "";
  const naoRodaram = linhaNaoRodaram(aberto?.rotinaParada ?? null, estado.agora);
  const detalhes: [string, string][] = [
    ...fora,
    ...(c.capacidades.length ? [["Ações", c.capacidades.map((cap) => `<code>${esc(c.conector)}.${esc(cap)}</code>`).join(" ")] as [string, string]] : []),
    ...(c.naoPedido.length ? [["Não pedido", esc(c.naoPedido.join(", "))] as [string, string]] : []),
    ["Revogar", esc(notaRevogar(bot))],
  ];
  const visiveis = ateTres([...(sub ? [esc(sub)] : []), ...linhas, ...(conectado ? [conectado] : [])], detalhes);
  return cardProposta({
    id: p.id,
    attrs: ` data-decisao="${esc(decisao.id)}"`,
    titulo: tituloDoPermitir(bot, verbo, nome),
    logo: logoApp(estado, c.conector, nome),
    linhas: visiveis,
    // As permissões (os grupos para desmarcar) ficam dentro de Detalhes, todas marcadas (padrão do protótipo v2).
    detalhes: `${caixas ? `<p class="cp-rot cp-permissoes">Permissões</p>${caixas}` : ""}<dl>${detalhes.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${d}</dd>`).join("")}</dl>`,
    chaveDetalhes: `cp-acesso-${p.id}`,
    extra: `${marcas ? `<p class="cp-marcas">${marcas}</p>` : ""}${naoRodaram}`,
    acoes: permitir + recusar,
  });
}

/** null = não é um card que este arquivo desenha (pedido antigo sem decisão: o card de revisão de antes). */
export function renderCardAcesso(p: Proposta, aberto: ItemAberto | undefined, estado: Estado): string | null {
  if (p.payload.kind !== "acesso") return null;
  if (p.payload.conectar) return cardConectar(p, estado);
  if (aberto) return cardPermitir(p, aberto.decisao, aberto, estado);
  return null;
}
