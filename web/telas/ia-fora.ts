import type { IdHarness } from "../../src/contracts/harness.ts";
import type { CausaSemIa, Inventario } from "../../src/contracts/inventario.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ContasIaDto, ContasNoLimite, MotivoDaNota } from "../../src/contracts/contas-ia.ts";
import type { PayloadTrocaDeIa } from "../../src/contracts/troca-de-ia.ts";
import type { Estado } from "../estado/reducer.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { atualizacaoEmCurso, comandoDoTerminal, fraseDaAtualizacao } from "../lib/atualizacao-ia.ts";
import { formatoData } from "../lib/formato-data.ts";
import { botao, esc, hora, paragrafos } from "../lib/render.ts";
import { CARONA_TEXTO, ICONE_TROCA, caronaClicavel, explicacaoDaCarona, fraseDoDetalheDaIa, type AlvoDoRecomeco } from "../lib/recomeco.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";
import { estadoParaOBot, type UiIas } from "./cartao-ia.ts";
import type { IaDaPessoa } from "../../src/contracts/inteligencia.ts";
import { desteMac, nesteMac, terminalDaqui } from "../lib/plataforma-da-tela.ts";

/**
 * A conversa quando a conta da IA não serve (definido em 2026-10-05; protótipo "Nod — primeira sessão sem tropeços",
 * jornada 3). Medido em produção nesse dia: a recusa do Claude Code aparecia em inglês como se fosse fala do bot,
 * seguida de "Turno interrompido: erro_execucao". Agora:
 * - bot em automático com outra IA pronta: o pedido é repetido nela (assentar-turno.ts) e a conversa ganha UMA linha
 *   dizendo por quem o bot passou a responder (`linhaIaTrocada`);
 * - sem outra IA: um aviso que diz o que houve e traz o botão que resolve (`avisoContaSemAcesso`). A fala fica
 *   guardada: quando uma IA fica pronta, o servidor a repete sozinho (repetir-barrados-por-ia.ts).
 * Funções puras de desenho; os cliques (`ia-entrar`, `ia-conectar`) são tratados em web/main.ts.
 */

export type IdIa = Extract<IdHarness, "claude-cli" | "codex-cli">;
/** Como a tela chama cada IA (o mesmo do onboarding): o provedor, o CLI e o logo. */
export const PROVEDOR_DA_IA: Record<IdIa, { nome: string; cli: string; logo: keyof typeof LOGOS_IA }> = {
  "claude-cli": { nome: "Claude", cli: "Claude Code", logo: "claude" },
  "codex-cli": { nome: "ChatGPT", cli: "Codex", logo: "chatgpt" },
};
const OUTRA: Record<IdIa, IdIa> = { "claude-cli": "codex-cli", "codex-cli": "claude-cli" };

export const ehIa = (v: unknown): v is IdIa => v === "claude-cli" || v === "codex-cli";

const logo = (ia: IdIa): string => `<span class="ia-logo" aria-hidden="true">${LOGOS_IA[PROVEDOR_DA_IA[ia].logo]}</span>`;

/**
 * NOD-213/NOD-220: a sonda prova que a IA voltou só se for "pronto" e MAIS NOVA que a negação. Os dois horários são epoch
 * ms do relógio do SERVIDOR (o anúncio do Mac é carimbado na chegada, em lerAnuncio; a negação, no `agora` do servidor):
 * fuso e relógio do Mac não entram. Sonda ausente, horário ausente/não numérico ou igual ao da negação: não voltou.
 */
export function prontaDepois(inv: Inventario | null | undefined, negadaEm: number): boolean {
  return inv?.estado === "pronto" && typeof inv.em === "number" && Number.isFinite(inv.em) && typeof negadaEm === "number" && Number.isFinite(negadaEm) && inv.em > negadaEm;
}

/** O inventário de uma IA no catálogo que a tela já tem (GET executor); null quando ainda não chegou. */
export function inventarioDaIa(estado: Pick<Estado, "executor">, ia: IdIa): Inventario | null {
  return estado.executor?.harnesses?.opcoes.find((o) => o.id === ia)?.inventario ?? null;
}

/**
 * A IA não está no Mac: o botão instala. NOD-178: o CLI que só demorou ("ausente" por sonda lenta) não pede instalação.
 * NOD-171: nem o CLI abaixo do piso (`cli_antigo`): ele está instalado, e o botão diz "Atualizar".
 */
export function pedeInstalar(inv: Inventario | null): boolean {
  // NOD-9: o CLI que o nod está atualizando está lá; nunca "Instalar".
  return inv?.estado === "ausente" && inv.causa !== "sonda_lenta" && inv.causa !== "cli_antigo" && inv.causa !== "atualizando";
}

/** NOD-171: o CLI está no Mac, mas abaixo do piso testado (`PISO_CLI`); null quando não é o caso. */
export function desatualizado(inv: { estado: string; causa?: string; versao?: string; minima?: string } | null | undefined): { versao: string; minima: string } | null {
  return inv?.estado === "ausente" && inv.causa === "cli_antigo" && inv.versao && inv.minima ? { versao: inv.versao, minima: inv.minima } : null;
}

/** A mínima como a pessoa lê: "0.159.0" vira "0.159" (protótipo do Gil, NOD-171); "2.1.290" fica como está. */
export const versaoLegivel = (v: string): string => v.replace(/^(\d+\.\d+)\.0$/, "$1");

/** "Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova." — a mesma frase no rodapé e no menu. */
export function fraseDesatualizado(ia: IdIa, d: { versao: string; minima: string }): string {
  return `Seu ${PROVEDOR_DA_IA[ia].cli} está na versão ${d.versao}. O nod precisa da ${versaoLegivel(d.minima)} ou mais nova.`;
}

/**
 * O comando que atualiza cada CLI, mostrado com "Copiar" (NOD-171). O nod não roda nada: `iaInstalar` abre a página
 * oficial e a pessoa atualiza no Terminal; a sonda percebe sozinha a versão nova.
 */
export const COMANDO_ATUALIZAR_IA: Record<IdIa, string> = {
  "claude-cli": "claude update",
  "codex-cli": "npm install -g @openai/codex@latest",
};

const FRASE_DA_CAUSA:Record<CausaSemIa, (cli: string) => string> = {
  conta_sem_acesso: (cli) => `a conta do ${cli} ${desteMac()} está sem acesso (a organização dela desativou o uso por assinatura)`,
  teste_falhou: (cli) => `a conta do ${cli} ${desteMac()} entrou, mas não respondeu`,
};

/**
 * O aviso no lugar da fala: o que houve, e os botões que resolvem. `noApp` = a página roda dentro do app do Mac (só
 * ele sabe abrir o login de uma IA); fora dele o botão leva à seção Conexão, que explica o que fazer no Terminal.
 */
export function avisoContaSemAcesso(m: Mensagem, estado: Pick<Estado, "executor">, p: { nomeDoBot: string; ia: IdIa; causa: CausaSemIa; aindaFora: boolean; noApp: boolean }): string {
  const { cli } = PROVEDOR_DA_IA[p.ia];
  const outra = OUTRA[p.ia];
  const invOutra = inventarioDaIa(estado, outra);
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  if (!p.aindaFora) {
    return avisoDeEstado({
      tom: "info",
      titulo: `${p.nomeDoBot} não conseguiu começar.`,
      texto: `Na hora, ${FRASE_DA_CAUSA[p.causa](cli)}. Já há uma IA pronta: se a resposta não chegou, mande a mensagem de novo.`,
      extra: detalhes,
    });
  }
  const entrar = botao("ia-entrar", `${logo(p.ia)}Entrar com outra conta`, { classe: "pri sm com-logo", dados: { ia: p.ia } });
  // NOD-171 (QA): a outra IA desatualizada pede "Atualizar"; "Conectar" abriria o login de um CLI que o nod não usa.
  const conectarOutra = desatualizado(invOutra)
    ? botao("ia-atualizar", `${logo(outra)}Atualizar o ${PROVEDOR_DA_IA[outra].cli}`, { classe: "sm com-logo", dados: { ia: outra } })
    : botao("ia-conectar", `${logo(outra)}${pedeInstalar(invOutra) ? `Instalar o ${PROVEDOR_DA_IA[outra].cli}` : `Conectar o ${PROVEDOR_DA_IA[outra].nome}`}`, { classe: "sm com-logo", dados: { ia: outra } });
  const acao = p.noApp ? `<span class="aviso-estado-acoes">${entrar}${conectarOutra}</span>` : botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } });
  return avisoDeEstado({
    tom: "alerta",
    titulo: `${p.nomeDoBot} não conseguiu começar.`,
    texto: `Nenhum trabalho começou: ${FRASE_DA_CAUSA[p.causa](cli)}. Sua mensagem fica guardada: quando uma IA estiver pronta, ${p.nomeDoBot} responde sozinho.`,
    extra: detalhes,
    acao,
    classe: "aviso-ia-fora",
  });
}

/**
 * NOD-171 (protótipo do Gil, estado 2): o bot fixado numa IA que não está pronta. O aviso diz QUAL IA e em que pé ela
 * está — desatualizada (com a versão e a mínima), sem login ou fora do Mac — e traz o botão que resolve e "Trocar a IA".
 * NOD-220: também o bot no Automático cuja IA do turno (payload `ia`) recusou. Sem estado que explique (sonda "pronto" de
 * antes da negação, sonda lenta, sem catálogo), o aviso nomeia a IA e manda conferir a Conexão. Quem chama só o usa com a
 * IA ainda fora (prontaDepois falso).
 */
export function avisoHarnessFora(m: Mensagem, estado: Pick<Estado, "executor">, p: { nomeDoBot: string | null; agenteId: string | null; ia: IdIa; noApp: boolean }): string {
  const inv = inventarioDaIa(estado, p.ia);
  const { nome, cli } = PROVEDOR_DA_IA[p.ia];
  const bot = p.nomeDoBot ?? "O bot";
  const botNoMeio = p.nomeDoBot ?? "o bot";
  const dados = { ia: p.ia };
  const antigo = desatualizado(inv);
  if (inv && (antigo || (inv.estado === "ausente" && inv.causa === "atualizando"))) return avisoDaAtualizacao(m, inv, p);
  const conectar = botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } });
  // NOD-220: a IA segue fora sem estado que o catálogo explique (sonda "pronto" anterior à negação, sonda lenta ou servidor
  // sem catálogo): o aviso ainda nomeia a IA e diz o que conferir — nunca "sua conta de IA" sem dizer qual.
  const semEstado = !inv || inv.estado === "pronto" || inv.causa === "sonda_lenta";
  const [titulo, situacao, resolve] = semEstado
    ? ["Nenhum trabalho começou.", `${bot} não pôde começar: o ${cli} (${nome}) estava indisponível. Confira em Conexão se o ${cli} está instalado e com a conta conectada.`, conectar]
    // NOD-213: no limite da assinatura a IA está logada; "falta entrar" seria falso. Resolve trocando de IA (ou esperando).
    : inv.estado === "nao_autenticado" && inv.causa === "limite"
      ? [`${bot} não começou: a conta do ${nome} chegou ao limite da assinatura.`, `${bot} usa o ${nome} (${cli}), e a conta conectada está no limite de uso.`, ""]
    : inv.estado === "nao_autenticado"
      ? [`${bot} não começou: falta entrar no ${cli}.`, `${bot} usa o ${nome} (${cli}). Ele está instalado ${nesteMac()}, mas sem conta conectada.`, p.noApp ? botao("ia-entrar", `${logo(p.ia)}Entrar no ${nome}`, { classe: "pri sm com-logo", dados }) : conectar]
      : [`${bot} não começou: o ${cli} não está ${nesteMac()}.`, `${bot} usa o ${nome} (${cli}), que não foi encontrado ${nesteMac()}.`, p.noApp ? botao("ia-conectar", `${logo(p.ia)}Instalar o ${cli}`, { classe: "pri sm com-logo", dados }) : conectar];
  const trocar = p.agenteId ? botao("inteligencia", p.nomeDoBot ? `Trocar a IA de ${esc(p.nomeDoBot)}` : "Trocar a IA", { classe: "sm", id: p.agenteId }) : "";
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  // O comando vai no próprio aviso: fora do app, a Conexão só mostra o da IA em uso, que pode não ser esta.
  return avisoDeEstado({
    tom: "erro",
    titulo,
    texto: `${situacao} Sua mensagem fica guardada: quando o ${cli} estiver pronto, ${botNoMeio} responde sozinho.`,
    extra: detalhes,
    acao: `<span class="aviso-estado-acoes">${resolve}${trocar}</span>`,
    classe: "aviso-ia-fora",
  });
}

const FILA: ReadonlySet<string> = new Set(["esperando", "aviso", "segurando"]);

/**
 * NOD-8 passo 11 (definido em 2026-10-24, protótipo v2.2 sobre o estado da NOD-9): o bot fixado numa IA abaixo do piso.
 *  - J3: a pílula com uma frase ("Gil precisa do Claude Code mais novo.") e "Atualizar" (`iaAtualizar`, gatilho
 *    clique, sem esperar os bots: data-agora="1");
 *  - J2: na fila (`esperando`/`aviso`/`segurando`), a mesma pílula diz "Na fila · …"; rodando, gira;
 *  - depois de uma falha (`falhou`/`insuficiente`), o cartão com o motivo, "Tentar de novo", "Trocar a IA" e o terminal
 *    atrás de "Prefere o terminal?"; fora do app, onde não há botão, o cartão traz o comando aberto;
 *  - no `sucesso` a sonda fica pronta e o aviso dá lugar à linha de sistema (linhaIaVoltou, com as versões).
 */
function avisoDaAtualizacao(m: Mensagem, inv: Inventario, p: { nomeDoBot: string | null; agenteId: string | null; ia: IdIa; noApp: boolean }): string {
  const { cli } = PROVEDOR_DA_IA[p.ia];
  const bot = p.nomeDoBot ?? "O bot";
  const antigo = desatualizado(inv);
  const a = inv.atualizacao;
  const falhou = a?.fase === "falhou" || a?.fase === "insuficiente";
  const frase = fraseDaAtualizacao(a, cli);
  const versoes = antigo ? ` Este Mac tem a ${antigo.versao}, e o nod precisa da ${versaoLegivel(antigo.minima)} ou mais nova.` : "";
  // Protótipo v2.2 (J2/J3): fora da falha, no lugar do cartão alto, uma pílula da família da linha de sistema — uma
  // frase e uma ação. Trocar a IA e o terminal ficam para quando o clique não resolve (o cartão de falha, abaixo).
  // QA do #511 (protótipo v2.2, j3-1): a pílula do "Atualizar" leva o cadeado; na fila e rodando, o relógio.
  const pilula = (corpo: string, icone = ICONE_RELOGIO) => `<div class="linha-centro-wrap linha-espera linha-ia-atualizar" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${icone}</span>${corpo}</span></div>`;
  if (atualizacaoEmCurso(a) || (inv.estado === "ausente" && inv.causa === "atualizando")) return pilula(`<span>${esc(frase ?? `Atualizando o ${cli}…`)}</span>${GIRA_LINHA}`);
  if (a && FILA.has(a.fase)) return pilula(`<span>${esc(`Na fila · ${frase ?? "atualiza quando os bots terminarem"}`)}</span>`);
  if (!falhou && p.noApp) return pilula(`<span>${esc(`${bot} precisa do ${cli} mais novo.`)}</span>${botao("ia-atualizar", "Atualizar", { classe: "pri sm", dados: { ia: p.ia, agora: "1" } })}`, ICONE_CADEADO);
  const resolve = p.noApp ? botao("ia-atualizar", "Tentar de novo", { classe: "pri sm", dados: { ia: p.ia, agora: "1" } }) : "";
  const comando = comandoDoTerminal("mac", p.ia) ?? COMANDO_ATUALIZAR_IA[p.ia];
  // Depois da falha, no app, o terminal fica num link discreto embaixo do motivo (protótipo v2.2, "Prefere o terminal?").
  const terminal = p.noApp
    ? `<details class="ia-terminal" data-disclosure="ia-terminal-${esc(m.id)}"><summary class="cl-terminal-link">Prefere o terminal?</summary>${linhaAtualizarIa(p.ia, false, comando)}</details>`
    : linhaAtualizarIa(p.ia, false, comando);
  const trocar = p.agenteId ? botao("inteligencia", p.nomeDoBot ? `Trocar a IA de ${esc(p.nomeDoBot)}` : "Trocar a IA", { classe: "sm", id: p.agenteId }) : "";
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  return avisoDeEstado({
    tom: falhou ? "erro" : "info",
    titulo: `${bot} precisa do ${cli} mais novo.`,
    texto: `${falhou && frase ? `${frase} ` : ""}${versoes.trim()} Sua mensagem fica guardada: quando o ${cli} estiver pronto, ${p.nomeDoBot ?? "o bot"} responde sozinho.`.trim(),
    extra: `${terminal}${detalhes}`,
    acao: `<span class="aviso-estado-acoes">${resolve}${trocar}</span>`,
    classe: "aviso-ia-fora aviso-ia-atualizar",
  });
}

/**
 * NOD-8 (definido em 2026-10-22, protótipo v2.2: "todo aviso de IA fora do ar some sozinho quando a condição deixa de
 * valer, e no lugar fica só a linha do que mudou"): a IA que recusou voltou (sonda pronta e mais nova que a negação).
 * Uma linha de sistema, na largura do texto; sem IA nomeável (o catcher), "A IA". A linha com a versão de antes e a de
 * depois ("atualizado na vm: A → B") vem com a atualização da NOD-9.
 */
export function linhaIaVoltou(ia: IdIa | null, atualizada?: { antes?: string; depois?: string } | null): string {
  // NOD-8 passo 11: a IA voltou porque o nod a atualizou — a linha diz de qual versão para qual.
  if (ia && atualizada?.depois) {
    const de = atualizada.antes ? `${atualizada.antes} → ` : "";
    // Protótipo v2.2: a linha do sucesso leva o ✓ (linha-ok), não o logo da IA.
    return `<div class="linha-centro-wrap linha-ia linha-ia-voltou"><span class="linha-centro estatica"><span class="linha-ok" aria-hidden="true">✓</span><span>${esc(`${PROVEDOR_DA_IA[ia].cli} atualizado: ${de}${atualizada.depois}`)} ·</span><span>se a resposta não chegou, mande a mensagem de novo.</span></span></div>`;
  }
  return `<div class="linha-centro-wrap linha-ia linha-ia-voltou"><span class="linha-centro estatica">${ia ? logo(ia) : ""}<span>${esc(ia ? `O ${PROVEDOR_DA_IA[ia].cli}` : "A IA")} já voltou ·</span><span>se a resposta não chegou, mande a mensagem de novo.</span></span></div>`;
}

/** NOD-8 (copy nova da v2.2): a pessoa trocou a IA do bot depois da recusa, e a nova está pronta; o aviso da antiga sai. */
export function linhaIaDoBotTrocada(nomeDoBot: string | null, para: IdIa): string {
  return `<div class="linha-centro-wrap linha-ia linha-ia-do-bot"><span class="linha-centro estatica">${logo(para)}<span>${esc(nomeDoBot ? `IA de ${nomeDoBot} trocada` : "IA do bot trocada")} ·</span><b>respondendo pelo ${esc(PROVEDOR_DA_IA[para].nome)}</b></span></div>`;
}

/**
 * NOD-171: a IA do bot está pronta, mas não aceita o modelo escolhido no agente (payload `modelo` da negação). Trocar a
 * IA não resolve e esperar também não: o aviso pede outro modelo e a mensagem de novo, nunca "a IA já voltou".
 */
export function avisoModeloRecusado(m: Mensagem, p: { nomeDoBot: string | null; agenteId: string | null; ia: IdIa; modelo: string }): string {
  const { cli } = PROVEDOR_DA_IA[p.ia];
  const bot = p.nomeDoBot ?? "O bot";
  const trocar = p.agenteId ? botao("inteligencia", p.nomeDoBot ? `Trocar o modelo de ${esc(p.nomeDoBot)}` : "Trocar o modelo", { classe: "pri sm", id: p.agenteId }) : undefined;
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  return avisoDeEstado({
    tom: "erro",
    titulo: `${bot} não começou: o ${cli} não aceita o modelo ${p.modelo}.`,
    texto: `Escolha outro modelo para ${p.nomeDoBot ?? "o bot"} e mande a mensagem de novo.`,
    extra: detalhes,
    acao: trocar,
    classe: "aviso-ia-fora",
  });
}

/**
 * Tela 4 do plano das IAs (protótipo SemOutra, aprovado em 2026-10-09; antes NOD-171 era um cartão âmbar grande): o turno
 * parou no limite da assinatura e NÃO havia outra IA pronta para assumir. Uma linha centralizada, com acento âmbar
 * discreto, que diz até quando e traz o passo que resolve, pelo estado da OUTRA IA: "Continuar pelo ChatGPT" (instalada,
 * falta entrar), "Instalar o ChatGPT", o código do login enquanto ela entra. A linha acompanha o login ela mesma
 * (`data-fica`); o Claude, que pede o código colado, termina em Provedores de IA. Passado o limite (ou uma hora sem prazo),
 * vira um registro sem cor. null quando a mensagem não é desse aviso.
 */
/**
 * O limite do plano ainda vale (a hora em que a IA volta não passou; sem hora, por uma hora desde o aviso). Fora disso a
 * linha vira registro ("esteve no limite até 14:00") e, na conversa limpa (ADR-114), sai do chat para a Atividade.
 */
export function limiteVigente(m: Pick<Mensagem, "payload" | "criadoEm">, agora: number): boolean {
  const l = m.payload;
  if (l?.kind !== "limite_do_plano") return false;
  return l.voltaEm !== null ? l.voltaEm > agora : agora - m.criadoEm < 60 * 60_000;
}

export function linhaLimiteSemOutra(m: Mensagem, p: { nomeDoBot: string | null; agenteId: string | null; agora: number; ui: UiIas; ias: readonly IaDaPessoa[] | null; fixa: boolean; contasIa?: ContasIaDto | null }): string | null {
  const l = m.payload;
  if (l?.kind !== "limite_do_plano") return null;
  const ia = ehIa(l.harness) ? l.harness : null;
  const nome = ia ? PROVEDOR_DA_IA[ia].nome : "Sua IA";
  const vigente = limiteVigente(m, p.agora);
  if (!vigente) {
    const quando = l.voltaEm !== null ? `até ${hora(l.voltaEm)}` : `às ${hora(m.criadoEm)}`;
    return `<div class="linha-centro-wrap linha-limite-passou"><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span><span>${esc(nome)} esteve no limite ${esc(quando)}</span></span></div>`;
  }
  // ADR-102: a conta da lista (servidor) bateu no limite — a frase do servidor e um passo por saída.
  // NOD-280: com a nota de contas, a linha sai sempre — mesmo sem conta livre, "Tentar de novo" e a espera ficam.
  if (l.contas) return linhaContasNoLimite(m, comContasDeAgora(l.contas, p.contasIa ?? null), p.agora);
  if (l.conta?.tipo === "perguntar" && ia) return linhaSeguirComConta(ia, l.conta, m.texto, p);
  // ADR-101: todas as contas da IA no limite — a frase do servidor diz quando a primeira volta; o passo segue o de sempre.
  const limite = l.conta?.tipo === "todas_no_limite" ? m.texto : l.voltaEm !== null ? `${nome} no limite até ${quandoVolta(l.voltaEm, p.agora).replace(/^às /, "")}` : `${nome} chegou ao limite`;
  const acao = ia ? acaoSemOutra(ia, p) : null;
  const corpo = acao?.substitui ? acao.html : `<span>${esc(limite)}</span>${acao ? `<span aria-hidden="true">·</span>${acao.html}` : ""}`;
  return `<div class="linha-centro-wrap linha-espera" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span>${corpo}</span></div>`;
}

/**
 * ADR-101 (2026-10-12, NOD-211): a conta em uso bateu no limite e há outra livre, em "Perguntar antes de trocar" (o
 * padrão). A frase do servidor ("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2 ou 3?") e um botão por
 * conta livre. No app do Mac o clique troca a conta (nodDesktop.contas); a pessoa manda a mensagem de novo. Fora do app,
 * a escolha é no Mac (o servidor não sabe das contas). Escolhida, a linha diz com qual seguiu.
 */
function linhaSeguirComConta(
  ia: IdIa,
  conta: { livres: readonly number[]; foraDaTroca: readonly number[]; voltaEm: number | null },
  frase: string,
  p: { nomeDoBot: string | null; agenteId: string | null; agora: number; ui: UiIas; ias: readonly IaDaPessoa[] | null },
): string {
  const { livres } = conta;
  const { ui } = p;
  const emUso = ui.contas[ia]?.contas.find((c) => c.emUso)?.posicao;
  const escolhida = emUso !== undefined && livres.includes(emUso) ? emUso : null;
  const sep = '<span aria-hidden="true">·</span>';
  const extras = [
    ...(conta.voltaEm !== null ? [`<span>ou esperar a conta voltar ${esc(quandoVolta(conta.voltaEm, p.agora))}</span>`] : []),
  ];
  const fim = escolhida !== null
    ? `<span>Seguindo com a conta ${escolhida} · mande a mensagem de novo</span>`
    : [
      ui.noApp && ui.contas[ia]
        ? livres.map((n) => `<button type="button" class="linha-link" data-act="conta-usar" data-ia="${ia}" data-posicao="${n}">Seguir com a conta ${n}</button>`).join(sep)
        : "<span>Escolha a conta no app do nod no Mac</span>",
      ...extras,
    ].join(sep);
  return `<div class="linha-centro-wrap linha-espera" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span><span>${esc(frase)}</span><span aria-hidden="true">·</span>${fim}</span></div>`;
}

/**
 * NOD-280 (critério 9): a nota é congelada no servidor, mas a conta pode entrar na máquina depois dela. Com a lista de
 * contas carregada (`GET contas-ia`), "está na máquina do turno" sai dela: a conta "pronta" na máquina da nota vira
 * "Seguir com"; a que saiu de lá deixa de ser. Sem a lista, sem a máquina na nota ou com a conta fora da lista, vale o
 * payload. Só a tela se recalcula: o fim do login não refaz o turno sozinho (compor.ts).
 */
export function comContasDeAgora(c: ContasNoLimite, contasIa: ContasIaDto | null): ContasNoLimite {
  const maquina = c.maquina;
  if (!contasIa || !maquina) return c;
  const livres = c.livres.map((l) => {
    const conta = contasIa.contas.find((x) => x.id === l.id);
    if (!conta) return l;
    const naMaquina = conta.maquinas.some((x) => x.maquinaId === maquina.id && x.estado === "pronta");
    return naMaquina === l.naMaquina ? l : { ...l, naMaquina };
  });
  return { ...c, livres };
}

/**
 * ADR-102 (2026-10-13, protótipo CMD-1): a conta bateu no limite e há outra livre do mesmo provedor ("Perguntar antes"),
 * ou só noutra máquina. A frase do servidor ("Claude · Pessoal no limite na vm-bots até 14:00. Seguir com …?") e um passo
 * por saída: "Seguir com <conta>" (logada na máquina do turno; o turno é refeito nela), "Rodar no <máquina> desta vez"
 * (a conta livre só noutra máquina), "Entrar com <conta> na <máquina>" (o login abre em Provedores de IA) e a espera.
 */
function linhaContasNoLimite(m: Mensagem, c: ContasNoLimite, agora: number): string {
  const sep = '<span aria-hidden="true">·</span>';
  const conversa = esc(m.conversaId);
  // NOD-280: cada botão leva o turno da nota, para o servidor refazer exatamente a fala cortada (ou dizer por que não).
  const turno = m.turnoId ? ` data-turno="${esc(m.turnoId)}"` : "";
  const passos: string[] = [];
  const maquinasJa = new Set<string>();
  // NOD-224: a nota nunca oferece outra IA — só as contas da mesma IA da que bateu no limite.
  for (const l of c.livres.filter((x) => x.ia === c.de.ia)) {
    const nome = `${PROVEDOR_DA_IA[l.ia].nome} · ${l.apelido}`;
    if (l.naMaquina) {
      passos.push(`<button type="button" class="linha-link forte" data-act="cl-seguir" data-id="${esc(l.id)}" data-conversa="${conversa}"${turno}>Seguir com ${esc(nome)}</button>`);
      continue;
    }
    // Um "Rodar no X desta vez" por máquina, por mais contas livres que ela tenha.
    if (l.outraMaquina && !maquinasJa.has(l.outraMaquina.id)) {
      maquinasJa.add(l.outraMaquina.id);
      passos.push(`<button type="button" class="linha-link" data-act="rodar-desta-vez" data-conversa="${conversa}" data-maquina="${esc(l.outraMaquina.id)}"${turno}>Rodar no ${esc(l.outraMaquina.nome)} desta vez</button>`);
    }
    if (c.maquina) passos.push(`<button type="button" class="linha-link" data-act="cl-entrar-chat" data-id="${esc(l.id)}" data-ia="${l.ia}" data-apelido="${esc(l.apelido)}" data-maquina="${esc(c.maquina.id)}">Entrar com ${esc(nome)} na ${esc(c.maquina.nome)}</button>`);
  }
  // NOD-280: a conta pode ter voltado antes do prazo; "Tentar de novo" limpa o limite dela e refaz a fala.
  passos.push(`<button type="button" class="linha-link" data-act="cl-tentar-de-novo" data-id="${esc(c.de.id)}" data-conversa="${conversa}"${turno}>Tentar de novo com ${esc(c.de.apelido)}</button>`);
  if (c.voltaEm !== null) passos.push(`<span>ou esperar ${esc(quandoVolta(c.voltaEm, agora).replace(/^às /, "até "))}</span>`);
  return `<div class="linha-centro-wrap linha-espera" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span><span>${esc(m.texto)}</span>${sep}${passos.join(sep)}</span></div>`;
}

/**
 * NOD-284: a frase do aviso quando um passo da nota não refez a fala — a nota nunca diz "seguindo" sem ter seguido.
 * null = refez (nada a avisar).
 */
export function fraseDoMotivoDaNota(motivo: MotivoDaNota | null | undefined): string | null {
  switch (motivo) {
    case "ja_refeito": return "Essa fala já foi refeita; nada foi repetido.";
    case "turno_nao_interrompido": return "Essa fala não está parada no limite; nada foi repetido.";
    case "conta_de_outra_ia": return "Essa conta é de outra IA; escolha uma conta da IA deste bot.";
    case "conta_no_limite": return "Essa conta também está no limite. Escolha outra ou espere ela voltar.";
    case "conta_fora_da_maquina": return "Essa conta não está pronta nesta máquina; nada foi repetido.";
    case "orcamento_da_sala": return "A sala esfriou: o bot só fala de novo depois que uma pessoa falar na sala.";
    case "bot_fora_da_sala": return "O bot não está mais na sala; nada foi repetido.";
    case "maquina_sem_contato": return "Essa máquina não responde agora; nada foi repetido. Escolha outra ou espere ela voltar.";
    default: return null;
  }
}

/** ADR-102: o turno seguiu noutra conta sozinho ("Trocar sozinho" ou outra IA), ou na conta que a pessoa escolheu. */
export function linhaContaSeguiu(m: Mensagem, recomeco?: AlvoDoRecomeco): string | null {
  if (m.payload?.kind !== "conta_seguiu" && m.payload?.kind !== "conta_escolhida") return null;
  return linhaDeTroca(m, recomeco);
}

/**
 * A linha de troca de conta (ADR-101/102), com o ↻ em SVG. NOD-312: quando o turno logo depois recomeçou sem a sessão,
 * a carona "· relê o necessário" vai na mesma frase (quebra inteira no celular) e abre a explicação logo abaixo.
 */
function linhaDeTroca(m: Mensagem, recomeco?: AlvoDoRecomeco, texto: string = m.texto): string {
  const carona = recomeco?.tipo === "carona" ? caronaClicavel(m.id) : "";
  const explica = recomeco?.tipo === "carona" ? explicacaoDaCarona(m.id, recomeco) : "";
  return `<div class="linha-centro-wrap linha-ia"><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_TROCA}</span><span class="p312-frase">${esc(texto)}${carona}</span></span>${explica}</div>`;
}

/**
 * NOD-312: a consequência de "Continuar na conta X" diz a verdade da sessão (ADR-107). No Codex a sessão é da conta: a
 * outra conta recomeça sem a memória e relê o necessário. No Claude Code as contas dividem a pasta das sessões e, na
 * mesma máquina, a sessão segue: lá "continua de onde parou" é verdade e fica.
 */
export function mesmaIaOutraConta(ia: IdHarness): string {
  return ia === "claude-cli" ? "Mesmo modelo, continua de onde parou." : "Mesmo modelo, mas relê o necessário.";
}

/** "11 min", "16 horas": quanto falta para a conta voltar, para a frase da recomendação. */
function quantoFalta(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const horas = Math.round(min / 60);
  return horas === 1 ? "1 hora" : `${horas} horas`;
}

const nomeDaIa = (ia: string): string => (ehIa(ia) ? PROVEDOR_DA_IA[ia].nome : ia);

/** O desfecho de um aviso já fechado: uma linha leve, sem botões. */
function desfechoDaTroca(p: PayloadTrocaDeIa, nomeDoBot: string): string {
  const de = nomeDaIa(p.iaDe);
  const para = p.iaPara ? nomeDaIa(p.iaPara) : "a outra IA";
  const tasks = p.tasks === 1 ? "A task" : "As tasks";
  switch (p.decisao) {
    case "esperar": return `${tasks} esperam o ${de}, como você escolheu.`;
    case "levar": return p.contaDe ? `${tasks} seguiram noutra conta do ${de}.` : `${tasks} foram para o ${para}.`;
    case "expirou": return `Sem escolha em 10 min: ${tasks.toLowerCase()} ${p.contaDe ? `seguiram noutra conta do ${de}` : `foram para o ${para}`}, como recomendado.`;
    case "voltou": return `O ${de} voltou: ${p.fixo ? `o ${nomeDoBot} seguiu` : `${tasks.toLowerCase()} seguiram`} de onde parou.`;
    case "outra_ia": return `O ${nomeDoBot} segue no ${para} até o ${de} voltar.`;
    case "conta": return `O ${nomeDoBot} seguiu ${p.conta ? `na conta ${de} · ${p.conta.apelido}` : "noutra conta"}.`;
    default: return "";
  }
}

/** Uma opção do aviso de troca: o que faz e a consequência escrita; a recomendada leva o selo. */
function opcaoDaTroca(o: { act: string; dados: string; rotulo: string; consequencia: string; recomendada: boolean }): string {
  const selo = o.recomendada ? '<span class="troca-reco">Recomendado</span>' : "";
  return `<li><button type="button" class="troca-opcao${o.recomendada ? " recomendada" : ""}" data-act="${o.act}"${o.dados}><span class="troca-opcao-tit">${esc(o.rotulo)}${selo}</span><small>${esc(o.consequencia)}</small></button></li>`;
}

/**
 * ADR-108 (R4/R6, canvas C1/C2/C3): o aviso de troca de IA na conversa do bot. Não fixo: a IA das tasks chegou ao
 * limite e elas esperam — o título com a volta, a frase da recomendação, as duas opções com a consequência (a recomendada
 * primeiro, marcada) e o rodapé do que acontece sem escolha. Fixo: o bot está parado até a volta e os dois caminhos
 * (a conta fora da fila, a outra IA até a volta). Fechado: uma linha com o desfecho. null = não é esse aviso.
 */
export function cartaoTrocaDeIa(m: Mensagem, p: { nomeDoBot: string | null; agora: number; recomeco?: AlvoDoRecomeco }): string | null {
  const t = m.payload;
  if (t?.kind !== "troca_de_ia") return null;
  const bot = p.nomeDoBot ?? "bot";
  // NOD-312 (revisão 2): o desfecho é a linha da troca; quando o turno seguinte recomeçou, ela leva a carona.
  if (t.decisao) return linhaDeTroca(m, p.recomeco, desfechoDaTroca(t, bot));
  const de = nomeDaIa(t.iaDe);
  const para = t.iaPara ? nomeDaIa(t.iaPara) : null;
  const volta = t.voltaEm !== null ? quandoVolta(t.voltaEm, p.agora) : null;
  const dados = ` data-id="${esc(t.agenteId)}" data-conversa="${esc(m.conversaId)}" data-troca="${esc(t.trocaId)}"`;
  if (t.fixo) {
    const ate = volta ? volta.replace(/^(às|em) /, "") : null;
    const opcoes = [
      ...(t.conta ? [opcaoDaTroca({ act: "cl-seguir", dados: ` data-id="${esc(t.conta.id)}" data-conversa="${esc(m.conversaId)}"`, rotulo: `Continuar na conta ${de} · ${t.conta.apelido}`, consequencia: `${mesmaIaOutraConta(t.iaDe)}${t.conta.corporativa ? " É a conta da empresa." : ""}`, recomendada: false })] : []),
      ...(para ? [opcaoDaTroca({ act: "troca-outra-ia", dados, rotulo: `Continuar no ${para}${ate ? ` até ${ate}` : ""}`, consequencia: `Outro provedor: ${bot} relê o necessário e as tasks recomeçam do resumo.${volta ? ` ${volta[0]!.toUpperCase()}${volta.slice(1)} volta ao ${de}.` : ""}`, recomendada: false })] : []),
    ].join("");
    // QA do PR 2 (16/10): sem artigo nem gênero para o nome do bot ("Vera parou", não "O Vera está parado").
    const texto = `Este bot usa só o ${de}, e as contas do ${de} da sua fila acabaram. Se você não fizer nada, ${bot} volta sozinho${volta ? ` ${volta}` : ""}.${opcoes ? " Para continuar agora, escolha um caminho:" : ""}`;
    return `<div class="aviso-estado tom-info aviso-troca" role="status"><div class="aviso-estado-txt"><b>${esc(bot)} parou${ate ? ` até ${esc(ate)}` : ""}</b><p>${esc(texto)}</p>${opcoes ? `<ul class="troca-opcoes">${opcoes}</ul>` : ""}</div></div>`;
  }
  const tasks = t.tasks === 1 ? "a task" : `as ${t.tasks} tasks`;
  // Revisão do PR 2 (I1): no ChatGPT, a conta da sessão parou e "levar" é para outra conta dele (a sessão fica na que parou).
  const mesmaIa = t.contaDe !== undefined && t.iaPara === t.iaDe;
  const destino = mesmaIa ? `outra conta do ${de}` : `o ${para}`;
  const levar = t.recomendacao === "levar" && para !== null;
  const falta = t.voltaEm !== null ? t.voltaEm - p.agora : null;
  const frase = levar
    ? `Para ${tasks}, recomendo levar para ${destino}: ${falta !== null ? `esperar seriam ${quantoFalta(falta)} paradas` : `o ${de} não disse quando volta`}.`
    : `Para ${tasks}, recomendo esperar: ${falta !== null ? `o ${de} volta em ${quantoFalta(falta)} e ` : ""}elas continuam de onde pararam.`;
  // C5: a outra IA existe, mas não na máquina do bot — o cartão diz por que não oferece "levar".
  const fora = !para && t.foraDaMaquina ? `O ${nomeDaIa(t.foraDaMaquina.ia)} não está ${t.foraDaMaquina.maquina ? `em ${t.foraDaMaquina.maquina}, ` : "n"}a máquina do ${bot}. ` : "";
  const esperar = opcaoDaTroca({ act: "troca-esperar", dados, rotulo: `Esperar o ${de}`, consequencia: volta ? `Voltam ${volta} com tudo o que já fizeram.` : "Voltam quando a conta voltar, com tudo o que já fizeram.", recomendada: !levar });
  const levarOp = para ? opcaoDaTroca({ act: "troca-levar", dados, rotulo: mesmaIa ? `Seguir noutra conta do ${de}` : `Levar as tasks para o ${para}`, consequencia: mesmaIa ? "Seguem agora, mas recomeçam do resumo: a sessão fica na conta que parou." : "Seguem agora, mas recomeçam do resumo de cada frente.", recomendada: levar }) : "";
  const rodape = levar ? "Se você não escolher em 10 min, eu sigo a recomendação." : "Se você não escolher, eu sigo a recomendação.";
  // NOD-401: a IA inteira parou na máquina do bot — o título diz a conta que parou (o apelido, nunca o e-mail).
  const apelido = mesmaIa ? t.contaDe!.apelido : (t.contaQueParou?.apelido ?? null);
  const titulo = apelido ? `A conta ${apelido} do ${de} chegou ao limite` : `O ${de} chegou ao limite`;
  // NOD-390: com a conta da outra IA (a da fila na máquina do bot), o apelido junto, como no seletor de IA.
  const conversa = para && !mesmaIa ? `A conversa segue no ${para}${t.contaPara ? ` · conta ${t.contaPara.apelido}` : ""}. ` : "";
  return `<div class="aviso-estado tom-info aviso-troca" role="status"><div class="aviso-estado-txt"><b>${esc(titulo)}${volta ? ` · volta ${esc(volta)}` : ""}</b><p>${esc(conversa)}${esc(fora)}${esc(frase)}</p><ul class="troca-opcoes">${levar ? levarOp + esperar : esperar + levarOp}</ul><small class="troca-rodape">${esc(rodape)}</small></div></div>`;
}

/**
 * ADR-101: em "Trocar sozinho", o nod seguiu com a próxima conta da mesma IA e repetiu o turno. Uma linha discreta, só
 * com posições ("Conta 1 do Claude Code no limite até 14:00. Seguindo com a conta 3."); o apelido fica no Mac.
 */
export function linhaContaTrocada(m: Mensagem, recomeco?: AlvoDoRecomeco): string | null {
  if (m.payload?.kind !== "conta_trocada") return null;
  return linhaDeTroca(m, recomeco);
}

const ICONE_CADEADO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
const ICONE_RELOGIO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>';
const GIRA_LINHA = '<span class="ob-gira" aria-hidden="true"></span>';

/** O passo da linha do limite, pelo estado da outra IA para o bot (NOD-424: pronta numa máquina da pessoa ou no Mac). */
function acaoSemOutra(ia: IdIa, p: { agenteId: string | null; agora: number; ui: UiIas; ias: readonly IaDaPessoa[] | null; fixa: boolean; nomeDoBot: string | null }): { html: string; substitui?: true } | null {
  const outra = OUTRA[ia];
  const { nome, cli } = PROVEDOR_DA_IA[outra];
  const e = estadoParaOBot(outra, p.ias?.find((x) => x.id === outra), p.ui, p.agora);
  const link = (act: string, rotulo: string, dados = "") => `<button type="button" class="linha-link" data-act="${act}" data-ia="${outra}"${dados}>${esc(rotulo)}</button>`;
  const provedores = (rotulo: string) => `<button type="button" class="linha-link" data-act="secao-espaco" data-secao="conexao">${esc(rotulo)}</button>`;
  const noApp = p.ui.noApp;
  switch (e.estado) {
    case "pronta":
      if (p.fixa && p.agenteId) return { html: `<button type="button" class="linha-link" data-act="inteligencia" data-id="${esc(p.agenteId)}">Usar o ${esc(nome)}</button>` };
      return { html: `<span>${esc(nome)} conectado · mande a mensagem de novo</span>`, substitui: true };
    case "falta_entrar":
    case "sem_acesso":
      return { html: noApp ? link("ia-entrar", `Continuar pelo ${nome}`) : provedores(`Conectar o ${nome}`) };
    case "nao_instalada":
    case "sem_node":
    case "desatualizada":
      return { html: noApp ? link("ia-instalar", `Instalar o ${nome}`) : provedores(`Conectar o ${nome}`) };
    case "instalando":
      return { html: `<span>Instalando o ${esc(cli)}…</span>${GIRA_LINHA}`, substitui: true };
    case "entrando": {
      const login = e.mac?.login;
      if (outra === "codex-cli" && login?.codigoDoDispositivo) {
        return { html: `<span>Digite</span><code class="linha-codigo">${esc(login.codigoDoDispositivo)}</code><span>na página da OpenAI</span><span aria-hidden="true">·</span>${link("ia-abrir-link", "Abrir")}${GIRA_LINHA}`, substitui: true };
      }
      return { html: `<span>Entre no ${esc(nome)}</span><span aria-hidden="true">·</span>${provedores("Terminar em Provedores de IA")}`, substitui: true };
    }
    case "testando":
      return { html: `<span>${esc(nome)} conectado · testando</span>${GIRA_LINHA}`, substitui: true };
    case "atualizando":
      return { html: `<span>Atualizando o ${esc(cli)}…</span>${GIRA_LINHA}`, substitui: true };
    case "no_limite":
      return { html: `<span>${esc(nome)} também está no limite</span>`, substitui: true };
    case "procurando":
    case "lenta":
    case "config_invalida":
      return { html: provedores("Ver Provedores de IA") };
  }
}

/** "às 17:00" no mesmo dia; "em 09/10 às 17:00" noutro — na hora LOCAL de quem lê (o texto gravado é de São Paulo). */
function quandoVolta(voltaEm: number, agora: number): string {
  const dia = (t: number) => formatoData("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(t));
  return dia(voltaEm) === dia(agora) ? `às ${hora(voltaEm)}` : `em ${dia(voltaEm)} às ${hora(voltaEm)}`;
}

/** NOD-171: o comando que atualiza a IA, com "Copiar"; no app do Mac, "Atualizar" abre a página oficial. */
export function linhaAtualizarIa(ia: IdIa, noApp: boolean, comando: string = COMANDO_ATUALIZAR_IA[ia]): string {
  const abrir = noApp ? botao("ia-atualizar", `Atualizar o ${PROVEDOR_DA_IA[ia].cli}`, { classe: "pri sm", dados: { ia } }) : "";
  return `<div class="ia-atualizar"><p>${terminalDaqui()}, rode:</p><div class="ia-comando"><code>${esc(comando)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: comando }, vivo: true })}</div><p class="mudo">O nod percebe sozinho quando a versão nova estiver instalada.</p>${abrir}</div>`;
}

/**
 * Tela 3 do plano das IAs (protótipo Troca, aprovado em 2026-10-09): o bot em automático passou a responder por outra IA.
 * Uma linha centralizada e discreta — "O Claude chegou ao limite · respondendo pelo ChatGPT" —, dita uma vez por troca;
 * o porquê, até quando e "Ver em Provedores de IA" ficam atrás do clique. `modelo` = o modelo do bot na IA que assumiu.
 */
export function linhaIaTrocada(m: Mensagem, extra: { modelo?: string | null; recomeco?: AlvoDoRecomeco } = {}): string | null {
  const p = m.payload;
  if (p?.kind !== "ia_trocada" || !ehIa(p.de) || !ehIa(p.para)) return null;
  const de = PROVEDOR_DA_IA[p.de];
  const para = PROVEDOR_DA_IA[p.para];
  const comModelo = extra.modelo ? `o ${para.nome} (${extra.modelo})` : `o ${para.nome}`;
  const [motivo, detalhe] = p.causa === "limite"
    ? [`O ${de.nome} chegou ao limite`, `A assinatura do ${de.nome} chegou ao limite${p.renovaEm ? ` e renova ${quandoVolta(p.renovaEm, m.criadoEm)}` : ""}. Até lá, seus bots em automático usam ${comModelo}. Depois, voltam sozinhos para o ${de.nome}.`]
    : p.causa === "conta_sem_acesso"
      ? [`A conta do ${de.nome} está sem acesso`, `A conta do ${de.nome} ${desteMac()} entrou, mas não tem acesso ao ${de.cli} pela assinatura. Seus bots em automático usam ${comModelo} até ela voltar.`]
      : [`O ${de.nome} não respondeu`, `O ${de.cli} ${desteMac()} não respondeu. Seus bots em automático usam ${comModelo} até ele voltar.`];
  const ver = `<button type="button" class="linha-link" data-act="secao-espaco" data-secao="conexao">Ver em Provedores de IA</button>`;
  // NOD-312: a carona em texto (o summary já é o controle) e a frase a mais no detalhe, quando o turno recomeçou.
  const recomecou = extra.recomeco?.tipo === "carona";
  const carona = recomecou ? CARONA_TEXTO : "";
  // Revisão 1: com a carona, motivo, destino e carona viram uma frase só (quebra inteira no celular, não em colunas).
  const frase = recomecou
    ? `<span class="p312-frase">${esc(motivo)} · <b>respondendo pelo ${esc(para.nome)}</b> ${carona}</span>`
    : `<span>${esc(motivo)} ·</span><b>respondendo pelo ${esc(para.nome)}</b>`;
  const det = recomecou ? fraseDoDetalheDaIa(de.nome, para.nome, extra.recomeco?.nomeDoBot ?? null) : "";
  return `<div class="linha-centro-wrap linha-ia"><details class="linha-ia-troca" data-disclosure="ia-trocada-${esc(m.id)}"><summary class="linha-centro">${logo(p.para)}${frase}</summary><p class="linha-ia-detalhe">${esc(detalhe)}${det} ${ver}</p></details></div>`;
}
