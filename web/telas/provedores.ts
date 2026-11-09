import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { grupoConfig, itemMenu, linhaConfig, menuLinha, type TomStatus } from "../lib/linha-config.ts";
import { ICONE } from "../lib/icones.ts";
import { nesteMac } from "../lib/plataforma-da-tela.ts";
import { chaveDoMenuDaIa } from "../lib/ordem.ts";
import { abaixoDaIa, acoesDaIa, alcaDaIa, logoDaIa, ordemDasIas, pilhaDeAvatares, renderCartaoIa, UI_IAS_INICIAL, vistaDaIa, type ContextoCartao, type UiIas, type VistaIa } from "./cartao-ia.ts";
import { renderContasDaIa } from "./contas-ia.ts";
import { nomeCurto, renderListaDeContas } from "./contas-lista.ts";
import { botsDaPessoa, maquinaDoBot, maquinasDeTrabalho } from "./maquinas.ts";
import { renderExecutor } from "./frota.ts";
import { logoApp } from "./marketplace.ts";
import type { Negacao } from "../../src/contracts/negacao.ts";
import { naTela, renderNegacoes } from "./negacao.ts";

/**
 * Seu espaço › Provedores de IA (definido em 2026-10-10, protótipo Main aprovado; antes "Conexão"). As IAs que os bots
 * usam, uma por linha, NA ORDEM do Automático da pessoa: a primeira pronta responde e, se ela parar ou chegar ao limite,
 * a próxima assume. A linha se arrasta pela alça (mouse, dedo ou setas do teclado) e a ordem vai a `PUT preferencias
 * {ordemIas}`; cada bot pode ter a dele (tela 2B). Cada linha é o cartão de web/telas/cartao-ia.ts: estado curto, um
 * botão e o ícone de verificar que aparece no hover, com a versão e a hora no balão.
 *
 * Embaixo, quando há: os conectores fora do ar (um por linha, com "Tentar de novo"), o plano ausente da frota e, só no modo
 * local (o servidor diz `trocavel`), o interruptor de simulação, atrás de "Configurar conexão".
 */
export function renderProvedores(estado: Estado): string {
  // ADR-102 (2026-10-13): no modo compartilhado, a lista única de contas; no modo local e no app do Mac antigo, a de antes.
  if (estado.contasIa?.disponivel && !estado.contasUi.appAntigo) return renderProvedoresContas(estado);
  const ui = estado.iasMac ?? UI_IAS_INICIAL;
  const servidor = estado.ias?.ias ?? null;
  const c: ContextoCartao = { servidor, ui, agora: estado.agora, onde: "provedores" };
  const ordem = ordemDasIas(servidor);
  const linhas = ordem.map((ia, i) => {
    const v = vistaDaIa(ia, c);
    const ordemUi = { aberto: estado.contasUi.menu === chaveDoMenuDaIa(ia), primeira: i === 0, ultima: i === ordem.length - 1 };
    // ADR-101 (NOD-211): as várias contas da IA, embaixo da linha, só no app do Mac.
    const contas = renderContasDaIa(ia, ui, estado.agora, Boolean(ui.estados[ia]?.conta));
    return `<div class="prov-ia-item" data-ordem-item="${ia}">${linhaDaIa(v, ui, i + 1, ordemUi)}${abaixoDaIa(v, ui)}${contas}</div>`;
  });
  const executor = estado.executor && estado.executor.trocavel !== false ? `<div class="espaco-cartao prov-avancado">${renderExecutor(estado)}</div>` : "";
  const nota = `Arraste a alça (ou use as setas nela, ou o “…”) para mudar a ordem; cada bot pode ter a dele, na Inteligência. Recomendado: o Claude com <b>Opus</b> e o ChatGPT com <b>Sol</b>.`;
  return `<section class="espaco-secao cfg-secao provedores">
      <h2 class="prov-titulo">${pilhaDeAvatares()}Provedores de IA</h2>
      ${estado.contasIa?.disponivel ? '<p class="cl-faixa" role="status">Atualize o app do nod para ver e gerenciar as contas de todas as máquinas numa lista só.</p>' : ""}
      <p class="intro">As IAs que seus bots usam${ui.noApp ? ` ${nesteMac()}` : ""}. No automático, a primeira pronta responde e, se ela parar ou chegar ao limite, a próxima assume.</p>
      ${grupoConfig("Ordem dos seus bots", linhas, { classe: "prov-ordem-grupo", listaAttrs: 'data-ordem-lista="pessoa"', notaHtml: nota })}
      ${executor}
      ${foraDoAr(estado)}
    </section>`;
}

const TOM_DA_IA: Record<VistaIa["tom"], TomStatus> = { ok: "ok", aviso: "atencao", mudo: "neutro" };

/**
 * NOD-373 (#j3-1/proposta, critério 10 da NOD-367): cada IA numa `linhaConfig` — a alça à esquerda (fora do ícone, que é
 * aria-hidden), a posição e o logo, o nome, a versão e a verificação no detalhe, e o status com o ponto de cor. Os botões
 * do estado (instalar, entrar, Trocar conta, Verificar) ficam à direita; o fluxo e as notas, embaixo da linha.
 */
export function linhaDaIa(v: VistaIa, ui: UiIas, pos: number, ordem: OrdemDaLinha = { aberto: false, primeira: false, ultima: false }): string {
  const conta = v.conta ? ` · <span class="ia-conta-txt"><span class="sr-only">Conta: </span>${esc(v.conta)}</span>` : "";
  const acoes = acoesDaIa(v, ui);
  return linhaConfig({
    titulo: v.nome,
    detalheHtml: `${esc(v.dica)}${conta}`,
    antes: alcaDaIa(v),
    icone: `<span class="prov-pos">${pos}</span>${logoDaIa(v.ia, "cl-logo")}`,
    status: { texto: v.texto, tom: TOM_DA_IA[v.tom], vivo: true },
    classe: `prov-ia${v.girando ? " girando" : ""}`,
    controle: { tipo: "html", html: `${acoes}${menuDaOrdem(v, ordem)}` },
  });
}

/** O "…" de cada IA na ordem: a chave dele em `contasUi.menu` (o mesmo estado do "…" das contas). */
export { chaveDoMenuDaIa };

export type OrdemDaLinha = { aberto: boolean; primeira: boolean; ultima: boolean };

/**
 * Revisão NOD-373 (WCAG 2.5.7, #j3-1/proposta): "Subir" e "Descer" no "…" da linha, a alternativa de um toque ao arrasto
 * — quem usa leitor de tela no celular não arrasta nem tem setas. Sem "Subir" na primeira e sem "Descer" na última.
 */
function menuDaOrdem(v: VistaIa, o: OrdemDaLinha): string {
  const itens = [
    o.primeira ? "" : itemMenu("ia-ordem-passo", ICONE.recolher, "Subir na ordem", { dados: { ia: v.ia, passo: "-1" } }),
    o.ultima ? "" : itemMenu("ia-ordem-passo", ICONE.abrir, "Descer na ordem", { dados: { ia: v.ia, passo: "1" } }),
  ].join("");
  if (!itens) return "";
  return menuLinha({ tipo: "menu", acao: "cl-menu", dados: { id: chaveDoMenuDaIa(v.ia) }, aberto: o.aberto, rotulo: v.nome, itens });
}

/** A lista única de contas (web/telas/contas-lista.ts), com o filtro por máquina vindo de Máquinas. */
function renderProvedoresContas(estado: Estado): string {
  const ui = estado.iasMac ?? UI_IAS_INICIAL;
  const contexto: ContextoCartao = { servidor: estado.ias?.ias ?? null, ui, agora: estado.agora, onde: "provedores" };
  // NOD-94: a só-computador não tem conta de IA (nenhum bot trabalha nela).
  const maquinas = maquinasDeTrabalho(estado.maquinas?.maquinas ?? []);
  const filtro = estado.contasUi.filtro ? maquinas.find((m) => m.id === estado.contasUi.filtro) ?? null : null;
  const lista = renderListaDeContas({
    contas: estado.contasIa!,
    maquinas,
    detalhes: estado.detalhesContas,
    ui: estado.contasUi,
    agora: estado.agora,
    noApp: ui.noApp && estado.detalhesContas !== null,
    botsNaMaquina: (id) => botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === id).map((b) => b.nome),
    cartaoDoMac: (ia) => renderCartaoIa(vistaDaIa(ia, contexto), ui),
    simulacao: estado.executor?.atual === "catcher",
  });
  const executor = estado.executor && estado.executor.trocavel !== false ? `<div class="espaco-cartao prov-avancado">${renderExecutor(estado)}</div>` : "";
  const intro = filtro
    ? `Mostrando as contas d${filtro.plataforma === "darwin" ? "o" : "a"} ${esc(nomeCurto(filtro, maquinas))}. A ordem é a mesma em todas as máquinas: os bots dela pulam as que não estão logadas lá.`
    : "Suas contas de IA numa fila só. Quando uma acaba, o Nod passa para a próxima ligada, na máquina onde o bot trabalha. Arraste para mudar a ordem; desligue a que não deve entrar sozinha.";
  return `<section class="espaco-secao cfg-secao provedores prov-contas">
      <h2 class="prov-titulo">${pilhaDeAvatares()}Provedores de IA</h2>
      <p class="intro">${intro}</p>
      ${lista}
      ${executor}
      ${foraDoAr(estado)}
    </section>`;
}

/**
 * definido em 2026-10-26 (NOD-374): o cartão de Fora do ar diz o que houve, desde quando e o que o nod faz sozinho —
 * "<App> · parou de responder · desde HH:MM (há N) · o nod tenta de novo sozinho; próxima às HH:MM". O acesso recusado
 * (401/403) não volta sozinho: pede para entrar de novo no app.
 */
export function linhaForaDoAr(n: Pick<Negacao, "motivo" | "desde" | "causa" | "proximaEm" | "lento" | "semRessonda">, agora: number): { motivo: string; detalhe: string } {
  const desde = `desde ${hora(n.desde)} (${haQuanto(agora - n.desde)})`;
  if (n.causa === "acesso_recusado") return { motivo: "recusou o acesso", detalhe: `${desde} · entre de novo no app` };
  // Desabilitado (a 1ª sonda falhou, ou a pessoa desligou): o laço não sonda — não prometer o que não vem (revisão 4).
  if (n.semRessonda) return { motivo: "parou de responder", detalhe: `${desde} · toque em Tentar de novo` };
  // Os 5 timeouts seguidos: o app responde à sonda, mas não executa — volta com uma ação que dá certo ou sozinho, depois
  // de ~30 min sem estourar o tempo (aposSondaOk).
  if (n.lento) return { motivo: "está demorando demais", detalhe: `${desde} · o nod confere de novo sozinho; próxima às ${hora(n.proximaEm ?? agora)}` };
  const proxima = n.proximaEm && n.proximaEm > agora ? `próxima às ${hora(n.proximaEm)}` : "próxima em instantes";
  return { motivo: "parou de responder", detalhe: `${desde} · o nod tenta de novo sozinho; ${proxima}` };
}

/**
 * Os conectores fora do ar e as negações da frota (o que era o rodapé da antiga seção Conexão).
 * definido em 2026-10-27 (NOD-384, decisão do Marlon): a ferramenta negada não aparece mais aqui — a tela mostra só as
 * contas, a ordem e o consumo. O dado continua gravado (trilha, Raio-X, Atividade) e a pílula segue na conversa; o lugar
 * no admin fica para depois. O plano ausente ("nenhum trabalho começa") continua: é alerta de que nada roda.
 */
function foraDoAr(estado: Estado): string {
  const negacoes = [...(estado.frota?.negacoes ?? []), ...estado.negacoes.filter((n) => n.classe !== "conector_indisponivel")];
  const fora = negacoes.filter((n) => n.classe === "conector_indisponivel");
  const outras = negacoes.filter((n) => n.classe !== "conector_indisponivel").filter(naTela);
  const linhaFora = (n: (typeof fora)[number]) => {
    const c = estado.conectores.find((x) => x.slug === n.nome || x.nome === n.nome);
    const nome = c?.nome ?? n.nome;
    const tentar = c ? botao("sondar-conector", "Tentar de novo", { classe: "sm", id: c.id }) : "";
    const l = linhaForaDoAr(n, estado.agora);
    return `<div class="espaco-fora" role="status">${logoApp(estado, c?.slug ?? n.nome, nome)}<div><b>${esc(nome)}</b> <span>· ${esc(l.motivo)}</span><small>${esc(l.detalhe)}</small></div>${tentar}</div>`;
  };
  return `${fora.length ? `<h3 class="espaco-subtitulo">Fora do ar</h3>${fora.map(linhaFora).join("")}` : ""}${renderNegacoes(outras, estado.agora)}`;
}
