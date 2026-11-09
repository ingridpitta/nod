import type { Agente, EsforcoAgente } from "../../src/contracts/agente.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { ContaIa } from "../../src/contracts/contas-ia.ts";
import type { IaDaPessoa, PedidoInteligencia } from "../../src/contracts/inteligencia.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc, hora } from "../lib/render.ts";
import { ehIaMac, logoDaIa, PROVEDOR, UI_IAS_INICIAL, type IaMac } from "./cartao-ia.ts";
import { contaEmUso } from "./contas-lista.ts";
import { ALERTA_USO, pctUsado } from "./uso-da-conta.ts";
import {
  conectada, escolhaEfetiva, iaEmUso, iasDaTela, iasDoBot, inteligenciaDoBot, modelosDoMenu, niveisDoModelo, NIVEIS, noLimite, nomeDoModelo,
  nomeDoNivel, type ContextoInteligencia,
} from "./inteligencia.ts";

/**
 * O seletor de IA no campo (definido em 2026-10-16, plano "tela limpa", T6; protótipos B1 e B2 do canvas "limite e
 * troca"): a troca de IA e de modelo saiu da gaveta e foi para o campo, entre o texto e o microfone, como no Claude
 * Code/Conductor e no ChatGPT. O botão mostra o logo da IA em uso dentro de um anel com o uso da janela de 5 h da
 * assinatura e o rótulo "Auto · Opus" (Automático) ou "Opus" (o bot fixo naquele modelo); a partir de 90% o anel e o
 * número ficam âmbar e o rótulo mostra o número.
 *
 * O menu: o cabeçalho com o uso da janela da IA ("62% da janela do Claude"), a conta em uso à parte (só o apelido, nunca
 * o e-mail) e o que acontece se acabar; "Automático"; os modelos de cada IA (um clique fixa o bot no modelo); a régua de
 * raciocínio com os níveis que o modelo do momento aceita; e o link para a fila de contas em Provedores de IA. Grava em
 * `PUT agentes/:id/inteligencia` só o que o clique muda (`pedidoDoSeletor`). A linha "Inteligência" da gaveta continua
 * (ordem, 2B).
 *
 * Funções puras (tests/unit/web/tela-limpa.test.ts); a metade com DOM é web/lib/menu-ia.ts e o miolo é trocado no nó pelo
 * main (o campo nunca é regravado, web/lib/regioes.ts).
 */

/**
 * A partir daqui o anel e o número ficam âmbar (definido em 2026-10-16, canvas B2: "vai acontecer"). Revisto em
 * 2026-10-22 (NOD-12): mora em uso-da-conta.ts, o mesmo limiar das barras de Provedores de IA e do domínio.
 */
export { ALERTA_USO };

/** O botão do campo, criado uma vez com o composer; o miolo é trocado por `mioloDoSeletor` a cada render. */
export const HTML_SELETOR_IA = '<button type="button" class="seletor-ia" id="composer-ia" data-act="seletor-ia" aria-haspopup="menu" aria-expanded="false" hidden></button>';

export type GrupoDoSeletor = { ia: IaMac; serve: boolean; modelos: { id: string; nome: string; marcado: boolean }[] };

/**
 * O que acontece se a conta em uso acabar (`fraseDoLimite`): segue noutra conta da mesma IA, segue noutra IA, o Nod
 * pergunta antes de trocar de conta, ou o bot espera a conta voltar.
 */
export type SeguirSeAcabar = { tipo: "conta"; ia: string; apelido: string } | { tipo: "ia"; nome: string } | { tipo: "perguntar" } | { tipo: "esperar" };

/**
 * NOD-390: a decisão do servidor (`DecisaoDoLimiteDaConta`, src/domain/contas-da-pessoa.ts) vista pela web: "trocou" e
 * "outra_ia" trazem a conta da lista para onde a conversa segue.
 */
export type DecisaoSeAcabar = { tipo: "trocou" | "outra_ia"; para: ContaIa } | { tipo: "perguntar" } | { tipo: "todas_no_limite" };

export type DadosSeletor = {
  agenteId: string;
  nome: string;
  dona: boolean;
  auto: boolean;
  /** A IA que responde agora; null = nenhuma conectada. */
  ia: IaMac | null;
  /** O nome do modelo em uso ("Opus"); vazio sem IA. */
  modelo: string;
  /** O modelo que o Automático usaria agora (o subtítulo do item "Automático"). */
  modeloDoAuto: string;
  /**
   * O uso da janela de 5 h da IA em uso (0 a 1, pode passar de 1). O número é da IA da PESSOA que vê (`uso_do_plano` é
   * por pessoa + IA), por isso só a dona do bot o vê. null = o CLI ainda não informou, a janela já renovou ou quem vê não é
   * a dona.
   */
  uso: number | null;
  renovaEm: number | null;
  /** O apelido da conta em uso (nunca o e-mail); null = a lista de contas não chegou, não há conta logada ou não é a dona. */
  conta: string | null;
  /** O que acontece se a conta acabar. */
  seguir: SeguirSeAcabar;
  raciocinio: EsforcoAgente | null;
  niveis: readonly EsforcoAgente[];
  grupos: GrupoDoSeletor[];
};

const livre = (c: ContaIa, agora: number) => c.noLimiteAte === null || c.noLimiteAte <= agora;
/** Pronta na máquina do bot; sem máquina conhecida, em qualquer uma. */
const prontaNa = (c: ContaIa, maquina: string | null) => c.maquinas.some((v) => v.estado === "pronta" && (maquina === null || v.maquinaId === maquina));

const posicaoNaOrdem = (ordem: readonly IdHarness[], ia: IdHarness) => {
  const i = ordem.indexOf(ia);
  return i < 0 ? ordem.length : i;
};

/**
 * NOD-390: o espelho, na web, de `decidirLimiteDaConta` + `contaDoTurno` (src/domain/contas-da-pessoa.ts, ADR-108) para a
 * conta `atual` que acabasse agora. A web só faz `import type` de src/ (AGENTS.md), então a regra é copiada e
 * tests/unit/web/tela-limpa.test.ts confere as duas sobre muitos estados (mesmo tipo, mesma conta). Na ordem do servidor:
 *  1. Por IA, a conta em uso entre as prontas na máquina (em ordem de posição): a primeira da fila livre; sem conta da IA
 *     na fila ali, a primeira dela se livre; senão nenhuma. Outra conta da MESMA IA assim: segue nela ("trocou"). Não olha
 *     o `modo` (o "Perguntar antes / Trocar sozinho" saiu com a ADR-108; o servidor já o ignora).
 *  2. Sem IA fixa (Automático), a conta em uso de outra IA na máquina, pela ordem do bot ou pela posição: "outra_ia".
 *  3. Outra conta livre (em qualquer máquina, ou em nenhuma): o Nod pergunta. Com a IA fixa, só as contas dela (R2).
 *  4. Senão todas no limite.
 * A web não recebe a conta "escolhida" da pessoa (`contas_escolhidas`, ContasIaDto não a traz): decide como sem escolha.
 * Com uma conta fora da fila escolhida e nenhuma da fila livre, o servidor a usa e a web não a vê (diferença conhecida,
 * NOD-390; mandar a escolhida no DTO é follow-up). A ordem do bot só decide com 3+ IAs com conta (hoje são 2). A máquina é
 * a do bot (null = qualquer máquina com a conta pronta). O filtro da IA fixa em `naMaquina` espelha o do servidor.
 */
export function decidirSeAcabar(contas: readonly ContaIa[], p: { atualId: string; maquina: string | null; iaFixa: IdHarness | null; ordemDoBot: readonly IdHarness[] | null; agora: number }): DecisaoSeAcabar {
  const atual = contas.find((c) => c.id === p.atualId);
  if (!atual) return { tipo: "todas_no_limite" };
  // A conta em uso acabou: fica no limite (a hora não importa, só que passa de agora).
  const marcadas = contas.map((c) => (c.id === atual.id ? { ...c, noLimiteAte: p.agora + 1 } : c));
  const daIaFixa = (c: ContaIa) => p.iaFixa === null || c.ia === p.iaFixa;
  const emOrdem = [...marcadas].sort((a, b) => a.posicao - b.posicao);
  const naMaquina = emOrdem.filter((c) => prontaNa(c, p.maquina) && daIaFixa(c));
  const porIa = new Map<IdHarness, ContaIa | null>();
  for (const c of naMaquina) {
    if (porIa.has(c.ia)) continue;
    const daIa = naMaquina.filter((x) => x.ia === c.ia);
    const daFila = daIa.find((x) => x.entraNaTrocaAutomatica && livre(x, p.agora));
    const [primeira] = daIa;
    porIa.set(c.ia, daFila ?? (!daIa.some((x) => x.entraNaTrocaAutomatica) && primeira && livre(primeira, p.agora) ? primeira : null));
  }
  const mesmaIa = porIa.get(atual.ia);
  if (mesmaIa && mesmaIa.id !== atual.id) return { tipo: "trocou", para: mesmaIa };
  if (p.iaFixa === null) {
    const comConta = [...porIa.values()].filter((c): c is ContaIa => c !== null && c.ia !== atual.ia);
    const ordem = p.ordemDoBot;
    const [outraIa] = comConta.sort((a, b) => (ordem ? posicaoNaOrdem(ordem, a.ia) - posicaoNaOrdem(ordem, b.ia) : a.posicao - b.posicao));
    if (outraIa) return { tipo: "outra_ia", para: outraIa };
  }
  if (emOrdem.some((c) => c.id !== atual.id && livre(c, p.agora) && daIaFixa(c))) return { tipo: "perguntar" };
  return { tipo: "todas_no_limite" };
}

/** A frase sai da decisão: a conta para onde segue (a IA pelo nome da tela e o apelido, nunca o e-mail), perguntar ou esperar. */
export function seguirDaDecisao(d: DecisaoSeAcabar): SeguirSeAcabar {
  if (d.tipo === "trocou" || d.tipo === "outra_ia") return { tipo: "conta", ia: ehIaMac(d.para.ia) ? PROVEDOR[d.para.ia].nome : d.para.ia, apelido: d.para.apelido };
  return d.tipo === "perguntar" ? { tipo: "perguntar" } : { tipo: "esperar" };
}

/**
 * O que acontece se a conta em uso acabar. Com a conta em uso na lista, é a decisão do servidor (`decidirSeAcabar`,
 * NOD-390): segue na próxima conta da fila (da mesma IA, ou de outra no Automático) e a frase diz a IA e o apelido dela.
 * Sem conta (modo local, ADR-092, ou a lista ainda não chegou), vale a regra por IA de antes: no Automático, outra IA
 * pronta e fora do limite; o bot fixo não troca de IA.
 *
 * definido em 2026-10-16 (revisão do PR 1): a máquina é a do bot (`agente.maquinaId`, senão a padrão da pessoa); sem
 * nenhuma das duas, vale qualquer máquina com a conta pronta.
 */
export function seguirSeAcabar(estado: Estado, p: { ia: IaDaPessoa; auto: boolean; ordem: Parameters<typeof iasDoBot>[1]; c: ContextoInteligencia; atual: ContaIa | null; maquina: string | null }): SeguirSeAcabar {
  // NOD-424 (revisão): o menu não pode dizer "segue no X" com o grupo X "não conectado". Por construção, só entram as contas
  // de IA conectada na tela (a conta em uso sempre entra). E o vínculo conta↔máquina guarda "pronta" mesmo com a máquina
  // desligada; o servidor só troca para máquina motor viva com a IA pronta (prontosPorMaquinaDaPessoa, NOD-94). Com a lista
  // de máquinas na tela, o vínculo só vale numa delas; sem a lista (ainda não chegou), vale o filtro por IA.
  const vivas = estado.maquinas ? new Map(estado.maquinas.maquinas.filter((m) => m.conectada && m.papel !== "computador").map((m) => [m.id, m])) : null;
  const iaConectada = (ia: IdHarness) => p.c.ias.some((x) => x.id === ia && conectada(x, p.c));
  const contas = (estado.contasIa?.contas ?? [])
    .filter((c) => c.id === p.atual?.id || iaConectada(c.ia))
    .map((c) => (vivas ? { ...c, maquinas: c.maquinas.filter((v) => vivas.get(v.maquinaId)?.ias[c.ia] === "pronto") } : c));
  if (p.atual) {
    return seguirDaDecisao(decidirSeAcabar(contas, { atualId: p.atual.id, maquina: p.maquina, iaFixa: p.auto ? null : p.atual.ia, ordemDoBot: p.ordem, agora: p.c.agora }));
  }
  if (p.auto) {
    const proxima = iasDoBot(p.c.ias, p.ordem).find((x) => x.id !== p.ia.id && ehIaMac(x.id) && conectada(x, p.c) && !noLimite(x, p.c));
    if (proxima && ehIaMac(proxima.id)) return { tipo: "ia", nome: PROVEDOR[proxima.id].nome };
  }
  return { tipo: "esperar" };
}

/** Tudo o que o botão e o menu mostram para o bot da conversa. null = bot desconhecido (frota ainda não chegou). */
export function dadosDoSeletor(estado: Estado, agenteId: string): DadosSeletor | null {
  const a = estado.frota?.agentes.find((x) => x.id === agenteId);
  if (!a) return null;
  const c: ContextoInteligencia = { ias: iasDaTela(estado), ui: estado.iasMac ?? UI_IAS_INICIAL, agora: estado.agora };
  const i = inteligenciaDoBot(a);
  const auto = i.modo === "auto";
  const uso = iaEmUso(i, c);
  const ia = uso && ehIaMac(uso.id) ? uso.id : null;
  const doAuto = auto ? uso : iaEmUso({ ...i, modo: "auto" }, c);
  const escolha = uso ? escolhaEfetiva(uso, i.escolhas) : null;
  const dona = a.ownerId === estado.sessao?.pessoaId;
  // O uso e a conta são da pessoa que vê: no bot de outra pessoa, nenhum dos dois (seria o uso do visitante).
  const plano = ia && dona ? estado.usoDoPlano?.planos.find((p) => p.harness === ia) ?? null : null;
  // A janela que já renovou (renovaEm no passado) é tratada como nova: sem número até o CLI informar de novo, e sem
  // "Renova às" de uma hora que passou.
  const maquina = a.maquinaId ?? estado.maquinas?.padraoId ?? null;
  const contas = estado.contasIa?.contas ?? [];
  const conta = ia && dona ? contaEmUso(contas, estado.agora, { ia, filtro: maquina }) : null;
  // NOD-12 (2026-10-22): o anel é da conta em uso (a cota é da assinatura, e a leitura é por conta desde a 0077). A leitura
  // por IA fica só para o servidor anterior (sem `cota` no DTO) ou sem conta na lista; conta sem leitura = sem número.
  const cinco = conta && conta.cota !== undefined ? conta.cota?.cincoHoras ?? null : plano?.cincoHoras ?? null;
  const janela = cinco && !(cinco.renovaEm !== null && cinco.renovaEm <= estado.agora) ? cinco : null;
  const grupos = iasDoBot(c.ias, i.ordem).filter((x) => ehIaMac(x.id)).map((x): GrupoDoSeletor => {
    const id = x.id as IaMac;
    const escolhido = !auto && i.fixa === id ? escolhaEfetiva(x, i.escolhas).modelo : null;
    return { ia: id, serve: conectada(x, c), modelos: modelosDoMenu(x, escolhido).map((m) => ({ id: m.id, nome: m.nome, marcado: m.id === escolhido })) };
  });
  return {
    agenteId: a.id,
    nome: a.nome,
    dona,
    auto,
    ia,
    modelo: uso && escolha ? nomeDoModelo(uso, escolha.modelo) : "",
    modeloDoAuto: doAuto ? nomeDoModelo(doAuto, escolhaEfetiva(doAuto, i.escolhas).modelo) : "",
    uso: janela?.utilizacao ?? null,
    renovaEm: janela?.renovaEm ?? null,
    conta: conta?.apelido ?? null,
    seguir: uso && dona ? seguirSeAcabar(estado, { ia: uso, auto, ordem: i.ordem, c, atual: conta, maquina }) : { tipo: "esperar" },
    raciocinio: escolha?.raciocinio ?? null,
    niveis: uso && escolha ? niveisDoModelo(uso, escolha.modelo) : [],
    grupos,
  };
}

/** Revisto em 2026-10-22 (NOD-12): 0,995 é 99%, como nas barras da conta; só o limite atingido é 100%. */
const pct = (uso: number): string => `${pctUsado(uso)}%`;
const SETA = (para: "baixo" | "cima") => `<svg class="seletor-seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${para === "baixo" ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"}"/></svg>`;
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const MAIS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
/** O anel tem raio 8,5 num quadro de 20: a volta inteira mede 2πr. */
const VOLTA = 2 * Math.PI * 8.5;

/** O anel de uso em volta do logo (20 px). Sem número, só o trilho. */
export function anelDeUso(ia: IaMac | null, uso: number | null): string {
  const feito = uso === null ? 0 : Math.max(0, Math.min(1, uso)) * VOLTA;
  const alerta = uso !== null && uso >= ALERTA_USO;
  const arco = uso === null ? "" : `<circle class="anel-uso" cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="${feito.toFixed(1)} ${VOLTA.toFixed(1)}" stroke-linecap="round"/>`;
  return `<span class="anel${alerta ? " anel-alerta" : ""}"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle class="anel-trilho" cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/>${arco}</svg>${ia ? logoDaIa(ia, "anel-logo") : ""}</span>`;
}

/** O rótulo do botão: "Auto · Opus" ou "Opus" (e "Auto" sozinho sem IA conectada). */
export function rotuloDoSeletor(d: Pick<DadosSeletor, "auto" | "modelo" | "ia">): string {
  if (!d.modelo) return d.auto ? "Automático" : "Escolher IA";
  return d.auto ? `Auto · ${d.modelo}` : d.modelo;
}

/** O miolo do botão do campo e o texto que o leitor de tela ouve. */
export function mioloDoSeletor(d: DadosSeletor, aberto = false): { html: string; titulo: string } {
  const alerta = d.uso !== null && d.uso >= ALERTA_USO;
  const numero = alerta && d.uso !== null ? `<span class="seletor-pct">${pct(d.uso)}</span>` : "";
  const ia = d.ia ? `${PROVEDOR[d.ia].nome} ${d.modelo}` : "nenhuma IA conectada";
  const titulo = `IA e modelo: ${d.auto ? "Automático, agora " : ""}${ia}${d.uso !== null ? `, ${pct(d.uso)} da janela usada` : ""}${d.dona ? "" : " · só a dona do bot muda"}`;
  return { html: `${anelDeUso(d.ia, d.uso)}<span class="seletor-rotulo">${esc(rotuloDoSeletor(d))}</span>${numero}${d.dona ? SETA(aberto ? "cima" : "baixo") : ""}`, titulo };
}

/** A frase do cabeçalho do menu: quando renova e o que acontece se a conta acabar. */
export function fraseDoLimite(d: Pick<DadosSeletor, "uso" | "renovaEm" | "seguir">): string {
  const alerta = d.uso !== null && d.uso >= ALERTA_USO;
  const renova = d.renovaEm !== null ? `Renova às ${esc(hora(d.renovaEm))}. ` : "";
  const quando = alerta ? "Se acabar agora," : "Se acabar,";
  const forte = (t: string) => `<span class="ia-sel-forte">${esc(t)}</span>`;
  const s = d.seguir;
  const depois = s.tipo === "conta" ? `segue no ${forte(`${s.ia} · conta ${s.apelido}`)}` : s.tipo === "ia" ? `a conversa segue no ${forte(s.nome)}` : s.tipo === "perguntar" ? "o Nod pergunta antes de trocar de conta" : "espera a conta voltar";
  return `${renova}${quando} ${depois}.`;
}

/**
 * O menu do seletor (puro, para o teste ler o HTML). ARIA (definido em 2026-10-16, revisão do PR 1): o cabeçalho é texto
 * fora do `role="menu"`; dentro dele só itens — `menuitemradio` para o Automático e os modelos (cada IA num
 * `role="group"` rotulado), a régua de raciocínio num `role="group"` com um `menuitemradio` por nível, e o link para a fila
 * de contas como `menuitem`. Os títulos visíveis dos grupos ficam `aria-hidden` (o rótulo do grupo já os diz).
 */
export function renderMenuIa(d: DadosSeletor): string {
  const alerta = d.uso !== null && d.uso >= ALERTA_USO;
  const numero = d.ia && d.uso !== null ? `${pct(d.uso)} da janela do ${PROVEDOR[d.ia].nome}` : null;
  const cab = d.ia
    ? `<div class="ia-sel-cab${alerta ? " ia-sel-alerta" : ""}">
        <div class="ia-sel-conta">${logoDaIa(d.ia, "ia-sel-logo")}${numero ? `<b class="ia-sel-pct">${esc(numero)}</b>` : `<b>${esc(PROVEDOR[d.ia].nome)}</b>`}</div>
        ${d.uso !== null ? `<div class="ia-sel-barra" aria-hidden="true"><span style="width:${(Math.max(0, Math.min(1, d.uso)) * 100).toFixed(1)}%"></span></div>` : ""}
        ${d.conta ? `<p class="ia-sel-quem">conta: ${esc(d.conta)}</p>` : ""}
        ${d.dona ? `<p class="ia-sel-frase">${fraseDoLimite(d)}</p>` : ""}
      </div><hr>`
    : "";
  const auto = `<button type="button" class="ia-sel-op" role="menuitemradio" aria-checked="${d.auto}" data-escolha="auto"><span class="ia-sel-txt"><span>Automático</span><small>${esc(d.modeloDoAuto ? `Agora no ${d.modeloDoAuto}. ` : "")}Troca de provedor sozinho se a conta acabar.</small></span>${d.auto ? CHECK : ""}</button>`;
  const grupos = d.grupos.map((g) => {
    const nome = PROVEDOR[g.ia].nome;
    const sub = g.serve ? "fixa o bot neste modelo" : "não conectado";
    const titulo = `<div class="ia-sel-grupo" aria-hidden="true">${esc(nome)} <span>· ${sub}</span></div>`;
    const modelos = g.modelos.map((m) => `<button type="button" class="ia-sel-op" role="menuitemradio" aria-checked="${m.marcado}" data-escolha="modelo" data-ia="${g.ia}" data-modelo="${esc(m.id)}"${g.serve ? "" : " disabled"}><span class="ia-sel-txt"><span>${esc(m.nome)}</span></span>${m.marcado ? CHECK : ""}</button>`).join("");
    return `<div role="group" aria-label="${esc(`${nome}: ${sub}`)}">${titulo}${modelos}</div>`;
  }).join("");
  return `${cab}<div role="menu" aria-label="IA e modelo de ${esc(d.nome)}">${auto}${grupos}${reguaDeRaciocinio(d)}<hr><button type="button" class="ia-sel-link" role="menuitem" data-escolha="provedores"><span>Fila de contas e regra de troca</span>${MAIS}</button></div>`;
}

/** A régua "Raciocínio · Médio · 2 de 5 no Opus": um ponto por nível que o modelo aceita, um clique troca. */
function reguaDeRaciocinio(d: DadosSeletor): string {
  const niveis = NIVEIS.filter((n) => d.niveis.includes(n.id));
  if (!d.ia || niveis.length === 0) return "";
  const n = niveis.length;
  const atual = Math.max(0, niveis.findIndex((x) => x.id === d.raciocinio));
  const passo = 100 / n;
  const pontos = niveis.map((x, i) => `<button type="button" role="menuitemradio" class="ia-sel-ponto${i < atual ? " feito" : ""}${i === atual ? " atual" : ""}" aria-checked="${i === atual}" aria-label="${esc(x.nome)}" title="${esc(`${x.nome} · ${x.descricao}`)}" data-escolha="raciocinio" data-raciocinio="${x.id}"></button>`).join("");
  const nomes = niveis.map((x, i) => `<span${i === atual ? ' class="atual"' : ""}>${esc(x.nome)}</span>`).join("");
  const colunas = `grid-template-columns: repeat(${n}, minmax(0, 1fr))`;
  return `<hr><div class="ia-sel-regua" role="group" aria-label="${esc(`Raciocínio do ${d.modelo}: ${nomeDoNivel(d.raciocinio)}, ${atual + 1} de ${n}`)}">
      <div class="ia-sel-regua-cab" aria-hidden="true"><span>Raciocínio</span><b>${esc(nomeDoNivel(d.raciocinio))}</b><small>· ${atual + 1} de ${n} no ${esc(d.modelo)}</small></div>
      <div class="ia-sel-trilho" style="${colunas}"><span class="ia-sel-linha" aria-hidden="true" style="left:${(passo / 2).toFixed(2)}%;right:${(passo / 2).toFixed(2)}%"></span><span class="ia-sel-linha feita" aria-hidden="true" style="left:${(passo / 2).toFixed(2)}%;width:${(atual * passo).toFixed(2)}%"></span>${pontos}</div>
      <div class="ia-sel-nomes" aria-hidden="true" style="${colunas}">${nomes}</div>
    </div>`;
}

/** O que um clique no menu escolheu. */
export type EscolhaSeletor = { tipo: "auto" } | { tipo: "modelo"; ia: IaMac; modelo: string } | { tipo: "raciocinio"; raciocinio: EsforcoAgente } | { tipo: "provedores" };

/** Lê a escolha do item clicado (os `data-*` do menu). */
export function escolhaDoItem(dados: { escolha?: string; ia?: string; modelo?: string; raciocinio?: string }): EscolhaSeletor | null {
  if (dados.escolha === "auto") return { tipo: "auto" };
  if (dados.escolha === "provedores") return { tipo: "provedores" };
  if (dados.escolha === "modelo" && ehIaMac(dados.ia) && dados.modelo) return { tipo: "modelo", ia: dados.ia, modelo: dados.modelo };
  const nivel = NIVEIS.find((n) => n.id === dados.raciocinio);
  if (dados.escolha === "raciocinio" && nivel) return { tipo: "raciocinio", raciocinio: nivel.id };
  return null;
}

/**
 * O pedido de `PUT agentes/:id/inteligencia` para uma escolha do menu, só com o que o clique muda (revisão do PR 1,
 * 2026-10-16; campo ausente não muda, src/contracts/inteligencia.ts): Automático → `{modo: "auto"}`; um modelo →
 * `{modo: "fixa", fixa, escolhas}`; o raciocínio → só `{escolhas}`. Antes ia a inteligência inteira (modo, fixa e
 * ordem), e um clique desfazia o que outra aba tinha acabado de gravar.
 *
 * `escolhas` vai inteiro, com a mudança por cima: o servidor troca o mapa todo (`lerEscolhas` em
 * src/domain/inteligencia.ts não mescla por IA), então mandar só `{[ia]: {raciocinio}}` apagaria o modelo dessa IA e as
 * escolhas das outras. Ao trocar de modelo, o raciocínio guardado da IA só fica se o modelo novo o aceita (senão o
 * servidor recusa com `raciocinio` inválido). null = nada a gravar (a escolha é a atual, ou não há IA em uso).
 */
export function pedidoDoSeletor(a: Pick<Agente, "id" | "harness" | "modelo" | "esforco" | "inteligencia">, escolha: EscolhaSeletor, c: ContextoInteligencia): PedidoInteligencia | null {
  const i = inteligenciaDoBot(a);
  if (escolha.tipo === "provedores") return null;
  if (escolha.tipo === "auto") return i.modo === "auto" ? null : { modo: "auto" };
  if (escolha.tipo === "modelo") {
    const ia = c.ias.find((x) => x.id === escolha.ia);
    const atual = ia && i.modo === "fixa" && i.fixa === escolha.ia ? escolhaEfetiva(ia, i.escolhas).modelo : null;
    if (atual === escolha.modelo) return null;
    const guardado = i.escolhas[escolha.ia]?.raciocinio;
    const raciocinio = guardado && ia && niveisDoModelo(ia, escolha.modelo).includes(guardado) ? guardado : undefined;
    return { modo: "fixa", fixa: escolha.ia, escolhas: { ...i.escolhas, [escolha.ia]: { modelo: escolha.modelo, ...(raciocinio ? { raciocinio } : {}) } } };
  }
  const uso = iaEmUso(i, c);
  if (!uso || escolhaEfetiva(uso, i.escolhas).raciocinio === escolha.raciocinio) return null;
  return { escolhas: { ...i.escolhas, [uso.id]: { ...i.escolhas[uso.id], raciocinio: escolha.raciocinio } } };
}
