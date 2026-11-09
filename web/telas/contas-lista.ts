import type { ContaIa, ContasIaDto, FrenteAtivaDaConta, IaComConta, LoginNaMaquina } from "../../src/contracts/contas-ia.ts";
import type { DetalheDaConta, DetalhesDasContas } from "../../src/contracts/desktop.ts";
import type { CausaFalhaLogin, ResultadoColarCodigo } from "../../src/contracts/estado-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import { rotuloDoMac } from "../lib/aparelho.ts";
import { VIVO } from "../lib/copiar.ts";
import { comandoDoTerminal, fraseDaAtualizacao } from "../lib/atualizacao-ia.ts";
import { logoDaIa, PROVEDOR } from "./cartao-ia.ts";
import { planoNaTela } from "./contas-ia.ts";
import { quandoNaTela, usoDaConta } from "./uso-da-conta.ts";

/**
 * Seu espaço › Provedores de IA, a lista única (definido em 2026-10-13, ADR-102; protótipos G1 e CM1-A aprovados pelo
 * Marlon). Uma linha por conta, sem agrupar por provedor, na ordem de uso (arrasta-se pela alça; a ordem vai a
 * `PUT contas-ia/ordem`). Cada linha: o logo, "Claude · apelido", o plano, o selo Corporativa, o e-mail e a organização
 * (do servidor desde 2026-10-15, ADR-105, em qualquer máquina) e uma pílula por máquina: logada, ou "Entrar na
 * <máquina>" tracejada. O ⋯ abre Renomear, Detalhes, Sair de cada máquina e Remover de todas. Os cliques
 * (`data-act="cl-…"`) são de web/lib/contas-da-pessoa.ts; o render não guarda nada.
 * ADR-108 (2026-10-16, canvas Main): a lista é a FILA. Cada linha tem o liga/desliga "na fila" (o opt-in de antes, que
 * era só da corporativa, agora vale para toda conta) e o "Perguntar antes / Trocar sozinho" saiu: no lugar, as três
 * linhas que dizem como o Nod age quando uma conta acaba.
 */

/**
 * NOD-293 C11 (definido em 2026-10-20): `frentes` = o que roda agora com a conta (na máquina, ou em todas na remoção);
 * null = a busca falhou (a tela pergunta se sai mesmo assim); ausente ou vazia = nada roda, o texto de sempre.
 */
export type ConfirmacaoContas =
  | { tipo: "sair"; contaId: string; maquinaId: string; frentes?: FrenteAtivaDaConta[] | null }
  | { tipo: "remover"; contaId: string; frentes?: FrenteAtivaDaConta[] | null };

/** O login de uma conta numa máquina aberto na tela: o da VM (pela API) ou o do Mac (pela ponte do app). */
export type LoginNaTela =
  | { onde: "vm"; login: LoginNaMaquina; codigo: string; enviando: boolean; erroEnvio: string | null }
  | { onde: "mac"; id: string; maquinaId: string; ia: IaComConta; contaId: string | null; apelido: string | null; desde: number; antes: string[] };

export type UiContas = {
  menu: string | null;
  renomear: string | null;
  detalhe: string | null;
  /** "Adicionar conta" aberto. */
  nova: { ia: IaComConta; apelido: string; maquinas: string[] } | null;
  confirmar: ConfirmacaoContas | null;
  /** Provedores filtrado por máquina (vindo de Máquinas › Gerenciar contas). */
  filtro: string | null;
  logins: LoginNaTela[];
  /** O login cujo "Prefere o terminal?" está aberto. */
  terminal: string | null;
  nota: string | null;
  /** Seu espaço › Máquinas (G2): o ⋯ da máquina, o renomear e o "Desconectar" com "sair das contas". */
  maquinaMenu: string | null;
  maquinaRenomear: string | null;
  desconectar: { maquinaId: string; sair: boolean } | null;
  /** Dentro do app do Mac sem a ponte `contas.detalhes` (anterior a 2026-10-13): a tela de antes, com a faixa. */
  appAntigo: boolean;
};

export const UI_CONTAS_INICIAL: UiContas = { menu: null, renomear: null, detalhe: null, nova: null, confirmar: null, filtro: null, logins: [], terminal: null, nota: null, maquinaMenu: null, maquinaRenomear: null, desconectar: null, appAntigo: false };

export type ContextoContas = {
  contas: ContasIaDto;
  maquinas: readonly MaquinaDto[];
  detalhes: DetalhesDasContas | null;
  ui: UiContas;
  agora: number;
  /** Dentro do app do Mac com a ponte nova (sabe qual máquina é este Mac e faz o login nele). */
  noApp: boolean;
  /** Os bots que trabalham em cada máquina (o aviso do "Sair"). */
  botsNaMaquina: (maquinaId: string) => string[];
  /** O cartão da IA do Mac com os passos do login dele (web/telas/cartao-ia.ts), para o login "Entrar no Mac". */
  cartaoDoMac: (ia: IaComConta) => string;
  /** NOD-12: modo simulação (executor catcher): a lista não mostra o uso do plano (nenhum trabalho real o mede). */
  simulacao?: boolean;
};

export const nomeDaContaNaTela = (c: Pick<ContaIa, "ia" | "apelido">): string => `${PROVEDOR[c.ia].nome} · ${c.apelido}`;

/** O nome curto da máquina na pílula: "Mac" quando a pessoa tem um Mac só; senão o nome que ela anunciou. */
export function nomeCurto(m: MaquinaDto, maquinas: readonly MaquinaDto[]): string {
  return m.plataforma === "darwin" && maquinas.filter((x) => x.plataforma === "darwin").length === 1 ? "Mac" : m.nome;
}

const ehEsteMac = (m: MaquinaDto, x: ContextoContas) => x.noApp && x.detalhes?.maquinaId === m.id;
const noLimite = (c: ContaIa, agora: number) => c.noLimiteAte !== null && c.noLimiteAte > agora;
const prontaEm = (c: ContaIa, maquinaId: string) => c.maquinas.some((v) => v.maquinaId === maquinaId && v.estado === "pronta");

/**
 * O e-mail e a organização da conta. ADR-105: vêm do servidor, que guarda o último que alguma máquina anunciou; o app do
 * Mac que conhece a conta tem o que o CLI disse agora (pela impressão) e ganha, por ser o mais novo.
 */
function identidadeDe(c: ContaIa, x: ContextoContas): { email: string | null; organizacao: string | null } {
  const d: DetalheDaConta | undefined = x.detalhes?.contas.find((y) => y.impressao === c.impressao && y.ia === c.ia);
  return d ? { email: d.email, organizacao: d.organizacao } : { email: c.email, organizacao: c.organizacao };
}

/**
 * A conta que os bots usam agora: a primeira da fila fora do limite (na máquina do filtro, se há filtro). ADR-108 (E4):
 * sem nenhuma conta na fila, a primeira da lista.
 */
function emUso(x: ContextoContas): string | null {
  return contaEmUso(x.contas.contas, x.agora, { filtro: x.ui.filtro })?.id ?? null;
}

/**
 * A conta em uso, pura (extraída em 2026-10-16 para o seletor de IA do campo, plano "tela limpa", T6): por IA, a primeira
 * da fila fora do limite e logada em alguma máquina (na do filtro, se há filtro); sem conta da IA na fila, a primeira dela
 * (ADR-108, E4). Com `ia`, só entre as contas daquela IA.
 * QA do PR #306 (ISSUE-008): só conta logada em alguma máquina está "em uso".
 */
export function contaEmUso(contas: readonly ContaIa[], agora: number, p: { filtro?: string | null; ia?: ContaIa["ia"] } = {}): ContaIa | null {
  const logadas = contas.filter((c) => (p.ia === undefined || c.ia === p.ia) && (p.filtro ? prontaEm(c, p.filtro) : c.maquinas.some((v) => v.estado === "pronta"))).sort((a, b) => a.posicao - b.posicao);
  // NOD-390 (revisão): a mesma regra de `contaEmUsoDaIa` (src/domain/contas-da-pessoa.ts), por IA: a primeira da fila
  // livre; sem conta da IA na fila, a PRIMEIRA dela, só se livre (a segunda livre não entra sem a pessoa escolher).
  const daIa = (ia: ContaIa["ia"]): ContaIa | null => {
    const lista = logadas.filter((c) => c.ia === ia);
    const daFila = lista.find((c) => c.entraNaTrocaAutomatica && !noLimite(c, agora));
    if (daFila) return daFila;
    const [primeira] = lista;
    return primeira && !lista.some((c) => c.entraNaTrocaAutomatica) && !noLimite(primeira, agora) ? primeira : null;
  };
  return logadas.find((c) => daIa(c.ia) === c) ?? null;
}

function pilulas(c: ContaIa, x: ContextoContas): string {
  return x.maquinas.map((m) => {
    const v = c.maquinas.find((y) => y.maquinaId === m.id);
    const nome = nomeCurto(m, x.maquinas);
    const ic = m.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor;
    if (v?.estado === "pronta") return `<span class="cl-pil"><i class="cl-ponto${m.conectada ? "" : " fora"}" aria-hidden="true"></i>${ic}${esc(nome)}</span>${alvoPendente(c, m)}`;
    if (!m.conectada) return "";
    const entrando = x.ui.logins.some((l) => maquinaDoLogin(l) === m.id && contaDoLogin(l) === c.id);
    if (entrando) return `<span class="cl-pil tracejada"><span class="ob-gira" aria-hidden="true"></span>Entrando na ${esc(nome)}…</span>`;
    // O Mac só entra pelo app aberto nele; noutra tela, a pílula explica.
    const podeEntrar = m.plataforma !== "darwin" || ehEsteMac(m, x);
    const texto = v?.estado === "sem_login" ? `Entrar de novo na ${nome}` : `Entrar na ${nome}`;
    return podeEntrar
      ? `<button type="button" class="cl-pil tracejada" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(m.id)}">${ic}${esc(texto)}</button>`
      : `<span class="cl-pil tracejada mudo">${ic}${esc(`Entre pelo app do nod no ${nome}`)}</span>`;
  }).join("");
}

/**
 * NOD-8 J5 (passo 11): na VM, a IA da conta abaixo do piso (o alvo pendente que a máquina anunciou em `iasDetalhe`) ganha
 * "Atualizar" na linha da conta — só com a máquina conectada e que atende o pedido remoto (`atualizaIas`). "Há versão nova"
 * (latest) fica fora. O Mac fica de fora: o cartão da IA do #498 já mostra o estado e o botão dele.
 */
function alvoPendente(c: ContaIa, m: MaquinaDto): string {
  if (m.plataforma === "darwin" || !m.conectada || m.atualizaIas !== true) return "";
  const d = m.iasDetalhe?.[c.ia];
  if (d?.causa !== "cli_antigo" || !d.minima) return "";
  const { cli } = PROVEDOR[c.ia];
  return `<button type="button" class="cl-pil tracejada" data-act="cl-atualizar-maquina" data-maquina="${esc(m.id)}" data-ia="${esc(c.ia)}" title="${esc(`${cli} ${d.versao ?? ""} na ${m.nome}; o nod precisa da ${d.minima} ou mais nova`)}">${esc(`Atualizar o ${cli}`)}</button>`;
}

export const maquinaDoLogin = (l: LoginNaTela): string => (l.onde === "vm" ? l.login.maquinaId : l.maquinaId);
export const contaDoLogin = (l: LoginNaTela): string | null => (l.onde === "vm" ? l.login.contaId : l.contaId);
export const idDoLogin = (l: LoginNaTela): string => (l.onde === "vm" ? l.login.id : l.id);

/** Revisão do PR #306: os códigos que o motor manda de verdade (motor/contas.ts, CausaFalhaLogin, ResultadoColarCodigo). */
const ERROS_LOGIN: Partial<Record<CausaFalhaLogin | Exclude<ResultadoColarCodigo, { ok: true }>["motivo"] | "tempo_esgotado" | "codigo_ilegivel" | "contas_demais" | "preparo_falhou", string>> = {
  tempo_esgotado: "O login demorou demais e foi cancelado. Tente de novo.",
  codigo_ilegivel: "A máquina não conseguiu ler o código. Gere outro na página e cole de novo.",
  contas_demais: "Essa máquina já tem contas demais dessa IA. Saia de uma antes.",
  nao_confirmou: "O login terminou, mas a máquina não confirmou a conta. Tente de novo.",
  nao_instalada: "A IA não está instalada nessa máquina. Rode a instalação do motor de novo.",
  codigo_invalido: "A página não aceitou o código. Gere outro e cole de novo.",
  login_por_codigo_bloqueado: "A conta não permite entrar por código. Entre pelo terminal da máquina.",
  sem_link: "A máquina não conseguiu abrir o login. Tente de novo.",
  link_nao_oficial: "O login abriu um endereço que não é o oficial e foi cancelado por segurança.",
  config_invalida: "A configuração da IA nessa máquina está com problema. Rode a instalação do motor de novo.",
  sem_login_aberto: "O login dessa máquina já tinha terminado. Tente de novo.",
  ja_enviado: "O código já foi enviado. Espere a máquina conferir.",
  // NOD-8: o passo 1 (instalar ou atualizar a IA antes do login) não terminou; com o motivo, a frase é a da atualização.
  preparo_falhou: "Não deu para preparar a IA nessa máquina. Tente de novo.",
};
const erroDoLogin = (e: string | null): string => (e ? (ERROS_LOGIN as Record<string, string | undefined>)[e] : undefined) ?? "O login não terminou. Tente de novo.";
/**
 * `cli_antigo` (devolução do #501, 2026-10-23): o comando é o da IA do login (`codex` para o Codex) e o "Clique em
 * Atualizar" só aparece quando a máquina anunciou que atende o pedido remoto (`atualizaIas`).
 */
export function erroDeCliAntigo(ia: "claude-cli" | "codex-cli", comBotao: boolean): string {
  const cmd = `nod-motor atualizar-ia ${ia === "codex-cli" ? "codex" : "claude"}`;
  return comBotao
    ? `A IA dessa máquina está desatualizada. Clique em Atualizar, ou rode ${cmd} no terminal dela.`
    : `A IA dessa máquina está desatualizada. Rode ${cmd} no terminal dela.`;
}

/** O bloco de um login aberto (G1-P3): os passos da VM, ou o cartão do Mac com os passos do app. */
function blocoDoLogin(l: LoginNaTela, x: ContextoContas, conta: ContaIa | null): string {
  const m = x.maquinas.find((y) => y.id === maquinaDoLogin(l));
  const nome = m ? nomeCurto(m, x.maquinas) : "máquina";
  const ic = m?.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor;
  const id = esc(idDoLogin(l));
  const cab = (direita: string) => `<div class="cl-login-cab">${ic}<b>${m?.plataforma === "darwin" ? rotuloDoMac() : esc(nome)}</b><span>${direita}</span></div>`;
  if (l.onde === "mac") {
    return `<div class="cl-login" data-login="${id}">${cab(`<button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${id}">Fechar</button>`)}<div class="cl-login-mac">${x.cartaoDoMac(l.ia)}</div></div>`;
  }
  const g = l.login;
  const empresa = PROVEDOR[g.ia].empresa;
  const cancelar = `<button type="button" class="ob-link" data-act="cl-login-cancelar" data-login="${id}">Cancelar</button>`;
  if (g.fase === "pronto") {
    const pronto = g.preparo ? `✓ ${PROVEDOR[g.ia].nome} pronto na ${nome}${versaoNova(g, m) ? ` · ${PROVEDOR[g.ia].cli} ${versaoNova(g, m)}` : ""}` : "✓ Entrou";
    const outra = g.contaId && g.contaFinalId && g.contaFinalId !== g.contaId;
    // QA do PR #306 (ISSUE-003): a "conta nova" era uma conta que já estava na lista — a tela diz qual, em vez de só sumir.
    const jaNaLista = !g.contaId && g.contaFinalId ? x.contas.contas.find((c) => c.id === g.contaFinalId) : undefined;
    const aviso = outra
      ? `<p class="cl-aviso">Você entrou com outra conta, não a ${esc(conta ? nomeDaContaNaTela(conta) : "pedida")}. Ela entrou na lista como uma conta nova.</p>`
      : jaNaLista ? `<p class="cl-aviso">Essa conta já estava na lista: <b>${esc(nomeDaContaNaTela(jaNaLista))}</b>. A ${esc(nome)} ficou com ela. <button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${id}">Fechar</button></p>` : "";
    return `<div class="cl-login ok" data-login="${id}">${cab(`<span class="cl-ok">${esc(pronto)}</span>`)}${aviso}</div>`;
  }
  if (g.fase === "falhou" || g.fase === "cancelado") {
    // NOD-9 PR4: com a IA abaixo do piso, o "Atualizar" pede à máquina que atualize (POST .../ias/:ia/atualizar).
    const antiga = g.fase === "falhou" && g.erro === "cli_antigo";
    // O botão só com a máquina conectada e que atende o pedido remoto: senão o pedido ficaria guardado para ninguém.
    const podeAtualizar = antiga && m?.conectada === true && m.atualizaIas === true;
    const atualizar = podeAtualizar ? `<button type="button" class="bt pri sm" data-act="cl-atualizar-ia" data-login="${id}"${l.enviando ? " disabled" : ""}>Atualizar</button>` : "";
    const tentar = `${atualizar}<button type="button" class="bt sm" data-act="cl-login-de-novo" data-login="${id}">Tentar de novo</button><button type="button" class="ob-link" data-act="cl-login-fechar" data-login="${id}">Fechar</button>`;
    const nota = antiga && l.erroEnvio ? `<p class="mudo">${esc(l.erroEnvio)}</p>` : "";
    // NOD-8 passo 11: o preparo que falhou diz o motivo (sem internet, sem espaço…) e, só agora, o terminal — recolhido
    // atrás de "Prefere o terminal?", como no resto do login (protótipo v2.2: "o terminal escondido").
    const preparo = g.fase === "falhou" && g.erro === "preparo_falhou" ? fraseDaAtualizacao(g.preparo?.atualizacao, PROVEDOR[g.ia].cli, g.preparo?.acao === "instalar" ? "instalar" : "atualizar") : null;
    const cmd = g.fase === "falhou" && g.erro === "preparo_falhou" ? comandoDoTerminal("vm", g.ia) : null;
    const terminal = !cmd ? ""
      : x.ui.terminal === g.id
        ? `<p class="cl-terminal">No terminal da ${esc(nome)}: <code>${esc(cmd)}</code> <button type="button" class="ob-link" data-act="copiar-texto" data-texto="${esc(cmd)}" ${VIVO}>Copiar</button></p>`
        : `<button type="button" class="cl-terminal-link" data-act="cl-terminal" data-login="${id}">Prefere o terminal?</button>`;
    return `<div class="cl-login erro" data-login="${id}" role="alert">${cab("")}<p class="cl-erro">${esc(g.fase === "cancelado" ? "Login cancelado." : antiga ? erroDeCliAntigo(g.ia, podeAtualizar) : preparo ?? erroDoLogin(g.erro))}</p>${nota}${terminal}<div class="cl-login-acoes">${tentar}</div></div>`;
  }
  if (g.fase === "preparando") return blocoDoPreparo(g, nome, id, cab(cancelar));
  if (g.fase === "pedido" || g.fase === "abrindo" || !g.url) {
    return `<div class="cl-login" data-login="${id}" role="status">${cab(cancelar)}<p class="cl-passo-txt"><span class="ob-gira" aria-hidden="true"></span>Abrindo o login na ${esc(nome)}…${m && !m.conectada ? " A máquina está sem contato; o login começa quando ela voltar." : ""}</p></div>`;
  }
  const conferindo = g.fase === "conferindo" || g.codigoEnviado;
  const passo1 = `<li class="feito"><span class="cl-n" aria-hidden="true">✓</span><div><b>Entre na página da ${esc(empresa)} com ${conta ? `a conta ${esc(conta.apelido)}` : "a conta que quer usar"}</b><a class="cl-link" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">Abrir a página da ${esc(empresa)} ↗</a></div></li>`;
  const passo2 = g.codigoDispositivo
    ? `<li><span class="cl-n" aria-hidden="true">2</span><div><b>Digite este código na página</b><div class="ia-codigo"><code>${esc(g.codigoDispositivo)}</code><button type="button" class="ob-link" data-act="copiar-texto" data-texto="${esc(g.codigoDispositivo)}" ${VIVO}>Copiar</button></div><small class="mudo">A ${esc(nome)} percebe sozinha quando terminar.</small></div></li>`
    : g.pedeCodigo
      ? `<li><span class="cl-n" aria-hidden="true">2</span><div><b>Cole aqui o código que a página mostrar</b>${conferindo
        ? `<p class="cl-passo-txt"><span class="ob-gira" aria-hidden="true"></span>Conferindo na ${esc(nome)}…</p>`
        : `<form class="cl-codigo" data-form="cl-codigo" data-login="${id}"><input name="codigo" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="Cole aqui o código que a página mostrar" value="${esc(l.codigo)}" data-cl-codigo="${id}" data-manter-foco="cl-codigo-${id}" aria-label="Código da página da ${esc(empresa)}"><button type="submit" class="bt pri"${l.enviando ? " disabled" : ""}>Enviar</button></form>${l.erroEnvio ? `<p class="cl-erro">${esc(l.erroEnvio)}</p>` : ""}`}
        <p class="cl-cadeado">${ICONE.cadeado}O código vai cifrado direto para a ${esc(nome)}. O servidor do nod só repassa e não consegue ler.</p></div></li>`
      : "";
  // ADR-102 (2A): o caminho do terminal fica escondido, uma linha só, para quem prefere.
  const terminal = g.ia === "claude-cli"
    ? x.ui.terminal === g.id
      ? `<p class="cl-terminal">No terminal da ${esc(nome)}: <code>nod-motor entrar claude</code> <button type="button" class="ob-link" data-act="copiar-texto" data-texto="nod-motor entrar claude" ${VIVO}>Copiar</button></p>`
      : `<button type="button" class="cl-terminal-link" data-act="cl-terminal" data-login="${id}">Prefere o terminal?</button>`
    : "";
  return `<div class="cl-login" data-login="${id}">${cab(cancelar)}<ol class="cl-passos">${passo1}${passo2}</ol>${terminal}</div>`;
}

/** A versão que a máquina ficou depois do passo 1: a do preparo ou, sem ela, a que a máquina anunciou (`iasDetalhe`). */
const versaoNova = (g: LoginNaMaquina, m: MaquinaDto | undefined): string | null => g.preparo?.depois ?? m?.iasDetalhe?.[g.ia]?.versao ?? null;

/**
 * NOD-8 (definido em 2026-10-22, protótipo v2.2): o passo 1 do login, quando a máquina instala ou atualiza a IA antes de
 * abrir a página (a fase `preparando`). O 2 espera e começa sozinho; o Cancelar para o preparo.
 */
function blocoDoPreparo(g: LoginNaMaquina, nome: string, id: string, cab: string): string {
  const { nome: ia, cli, empresa } = PROVEDOR[g.ia];
  const p = g.preparo;
  const atualizar = p?.acao === "atualizar";
  const titulo = atualizar ? `Atualizar o ${cli} na ${nome}` : `Preparar o ${ia} na ${nome}`;
  const versoes = atualizar && p.antes && p.depois ? `${p.antes} → ${p.depois}` : null;
  const linha = p?.linha || versoes || (p ? (atualizar ? `Atualizando o ${cli}` : `Instalando o ${cli}`) : "Preparando…");
  const passo1 = `<li><span class="cl-n" aria-hidden="true">1</span><div><b>${esc(titulo)}</b><p class="cl-passo-txt"><span class="ob-gira" aria-hidden="true"></span>${esc(p ? `${linha} · leva até 2 minutos` : linha)}</p></div></li>`;
  const passo2 = `<li class="mudo"><span class="cl-n" aria-hidden="true">2</span><div><b>Entrar na conta da ${esc(empresa)}</b><small class="mudo">Começa sozinho quando a ${atualizar ? "atualização" : "instalação"} terminar.</small></div></li>`;
  return `<div class="cl-login" data-login="${id}" role="status">${cab}<ol class="cl-passos">${passo1}${passo2}</ol></div>`;
}

function menu(c: ContaIa, x: ContextoContas): string {
  const id = esc(c.id);
  const nomes = (ids: string[]) => ids.map((mid) => { const m = x.maquinas.find((y) => y.id === mid); return m ? nomeCurto(m, x.maquinas) : ""; }).filter(Boolean);
  const logadas = c.maquinas.filter((v) => v.estado !== "sem_acesso").map((v) => v.maquinaId);
  const sair = logadas.map((mid) => {
    const m = x.maquinas.find((y) => y.id === mid);
    if (!m) return "";
    const outras = nomes(logadas.filter((o) => o !== mid));
    return `<button type="button" data-act="cl-sair" data-id="${id}" data-maquina="${esc(mid)}">${ICONE.sair}<span>Sair d${m.plataforma === "darwin" ? "o" : "a"} ${esc(nomeCurto(m, x.maquinas))}<small>${outras.length ? `continua n${outras.length === 1 && x.maquinas.find((y) => y.id === logadas.find((o) => o !== mid))?.plataforma === "darwin" ? "o" : "a"} ${esc(outras.join(", "))}` : "fica sem nenhuma máquina"}</small></span></button>`;
  }).join("");
  return `<div class="cl-menu" aria-label="${esc(nomeDaContaNaTela(c))}">
      <span class="cl-menu-tit">${esc(nomeDaContaNaTela(c))}</span>
      <button type="button" data-act="cl-renomear" data-id="${id}">${ICONE.lapis}<span>Renomear</span></button>
      <button type="button" data-act="cl-detalhe" data-id="${id}">${ICONE.info}<span>Detalhes da conta<small>plano, organização e onde ela está logada</small></span></button>
      ${sair ? `<hr><span class="cl-menu-tit">Máquinas</span>${sair}` : ""}
      <hr><button type="button" class="perigo" data-act="cl-remover" data-id="${id}">${ICONE.lixo}<span>Remover de todas as máquinas</span></button>
    </div>`;
}

/** NOD-12 (protótipo do Gil, quadro 16): de onde vem o número das barras, nos detalhes para não ocupar a linha. */
const DE_ONDE_VEM_O_USO: Record<ContaIa["ia"], string> = {
  "claude-cli": "O próprio Claude Code informa o uso a cada trabalho. O nod só lê esse número; não pergunta ao provedor nem gasta cota.",
  "codex-cli": "O próprio Codex informa o uso no fim de cada conversa. O nod só lê esse número; não pergunta ao provedor nem gasta cota.",
};

function detalhes(c: ContaIa, x: ContextoContas, d:{ email: string | null; organizacao: string | null }): string {
  const maqs = c.maquinas.map((v) => {
    const m = x.maquinas.find((y) => y.id === v.maquinaId);
    const estado = v.estado === "pronta" ? "logada" : v.estado === "sem_login" ? "o login venceu" : "sem acesso";
    return `<li>${esc(m ? nomeCurto(m, x.maquinas) : v.nome)}: ${esc(estado)}</li>`;
  }).join("");
  return `<div class="cl-detalhes">
      <dl>
        <dt>Provedor</dt><dd>${esc(PROVEDOR[c.ia].nome)}, pelo ${esc(PROVEDOR[c.ia].cli)}</dd>
        <dt>Plano</dt><dd>${esc(c.plano ? planoNaTela(c.plano) : "o CLI não disse")}${c.corporativa ? " · corporativa" : ""}</dd>
        ${d.email || d.organizacao ? `<dt>Conta</dt><dd>${esc([d.email, d.organizacao].filter(Boolean).join(" · "))}</dd>` : ""}
        <dt>Máquinas</dt><dd>${maqs ? `<ul>${maqs}</ul>` : "nenhuma ainda"}</dd>
        ${c.cota !== undefined && !x.simulacao ? `<dt>Uso do plano</dt><dd>${esc(DE_ONDE_VEM_O_USO[c.ia])}</dd>` : ""}
      </dl>
      <button type="button" class="ob-link" data-act="cl-detalhe" data-id="${esc(c.id)}">Fechar detalhes</button>
    </div>`;
}

function linha(c: ContaIa, pos: number, x: ContextoContas, usada: string | null): string {
  const filtro = x.ui.filtro;
  const fora = filtro !== null && !prontaEm(c, filtro);
  const d = identidadeDe(c, x);
  const nome = nomeDaContaNaTela(c);
  const [classe, estado] = noLimite(c, x.agora)
    ? ["e-limite", `No limite até ${quandoNaTela(c.noLimiteAte!, x.agora)}`]
    : c.id === usada ? ["e-uso", filtro ? `Em uso na ${nomeCurto(x.maquinas.find((m) => m.id === filtro)!, x.maquinas)}` : "Em uso"]
    : c.entraNaTrocaAutomatica ? ["e-disp", "Disponível"] : ["e-fora", "Fora da fila"];
  const ident = [d?.email, d?.organizacao ? `organização ${d.organizacao}` : null, `pelo ${PROVEDOR[c.ia].cli}`].filter(Boolean).join(" · ");
  const renomear = x.ui.renomear === c.id
    ? `<form class="cl-renomear" data-form="cl-renomear" data-id="${esc(c.id)}"><input name="apelido" maxlength="40" value="${esc(c.apelido)}" aria-label="Apelido de ${esc(nome)}" data-cl-autofoco data-manter-foco="cl-renomear"><button type="submit" class="bt pri sm">Salvar</button><button type="button" class="bt sm" data-act="cl-renomear-fechar">Cancelar</button></form>`
    : "";
  const logins = x.ui.logins.filter((l) => contaDoLogin(l) === c.id).map((l) => blocoDoLogin(l, x, c)).join("");
  // No filtro, a conta que não está na máquina vira um botão grande (G2-M2).
  const direita = fora && x.maquinas.find((m) => m.id === filtro)?.conectada && !logins
    ? `<button type="button" class="bt sm" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(filtro!)}">Entrar na ${esc(nomeCurto(x.maquinas.find((m) => m.id === filtro)!, x.maquinas))}</button>`
    : classe === "e-limite"
      // NOD-280: a conta pode ter voltado antes do prazo — "Tentar de novo" limpa o limite e acorda as falas que esperavam.
      ? `<span class="contas-estado ${classe}">${esc(estado)}</span><button type="button" class="ob-link" data-act="cl-tentar-de-novo" data-id="${esc(c.id)}">Tentar de novo</button>${chaveDaFila(c)}`
      : `<span class="contas-estado ${classe}">${esc(estado)}</span>${chaveDaFila(c)}`;
  return `<li class="cl-linha${fora ? " fora" : ""}${logins ? " entrando" : ""}" data-ordem-item="${esc(c.id)}">
      <button type="button" class="cl-alca" data-alca-ordem aria-label="Mover ${esc(nome)} (setas para cima e para baixo)">${ICONE.alca}</button>
      <span class="cl-pos" aria-hidden="true">${pos}</span>
      ${logoDaIa(c.ia, "cl-logo")}
      <div class="cl-corpo">
        <div class="cl-nome"><b>${esc(PROVEDOR[c.ia].nome)} · ${esc(c.apelido)}</b>${c.plano ? `<span class="cl-plano">${esc(planoNaTela(c.plano))}</span>` : ""}${c.corporativa ? '<span class="selo">Corporativa</span>' : ""}</div>
        <div class="cl-ident">${ICONE.pessoa}<span>${esc(ident)}</span></div>
        ${x.simulacao ? "" : usoDaConta(c, { agora: x.agora, contas: x.contas.contas, nomeDaMaquina: (id) => { const m = x.maquinas.find((y) => y.id === id); return m ? nomeCurto(m, x.maquinas) : null; } })}
        ${filtro ? "" : `<div class="cl-maqs">${pilulas(c, x)}</div>`}
        ${renomear}
        ${x.ui.detalhe === c.id ? detalhes(c, x, d) : ""}
        ${logins}
      </div>
      <div class="cl-dir">${direita}</div>
      <div class="cl-mais"><button type="button" class="cl-mais-bt" data-act="cl-menu" data-id="${esc(c.id)}" aria-expanded="${x.ui.menu === c.id}" aria-label="Mais ações de ${esc(nome)}">${ICONE.pontos}</button>${x.ui.menu === c.id ? menu(c, x) : ""}</div>
    </li>`;
}

/**
 * ADR-108 (R8): o liga/desliga "na fila" da conta. Ligado, o Nod pode passar sozinho para ela quando a anterior da mesma
 * IA acaba; desligado, ela só é usada quando você escolhe ("Seguir com"). Ligar a 2ª da mesma IA mostra os termos de uso
 * antes (NOD-308: a corporativa segue a mesma regra) (web/lib/contas-da-pessoa.ts).
 */
function chaveDaFila(c: ContaIa): string {
  const nome = nomeDaContaNaTela(c);
  return `<button type="button" class="chave cl-fila" role="switch" aria-checked="${c.entraNaTrocaAutomatica}" data-act="cl-fila" data-id="${esc(c.id)}" aria-label="${esc(`${nome} na fila`)}" title="${c.entraNaTrocaAutomatica ? "Na fila: o Nod pode passar sozinho para ela" : "Fora da fila: só quando você escolher"}"><span></span></button>`;
}

/** ADR-108 (R8, canvas Main): não há regra para configurar — só como o Nod age quando uma conta acaba. */
export const REGRAS_DA_FILA: readonly { titulo: string; texto: string }[] = [
  { titulo: "Mesma IA", texto: "passa sozinho para a próxima conta ligada na fila. No Claude, nada se perde. No ChatGPT, a task com sessão recomeçaria do resumo noutra conta: o Nod recomenda esperar ou seguir, e você decide." },
  { titulo: "Outra IA", texto: "só nos bots em Automático. A conversa segue na hora." },
  { titulo: "Tasks em andamento", texto: "trocar de IA faz a task recomeçar do resumo. Por isso o Nod recomenda esperar ou trocar, pela hora em que a conta volta, e você decide." },
];

/** O formulário "Adicionar conta" (G1-P2): provedor, apelido e em quais máquinas entrar. */
function formNova(x: ContextoContas): string {
  const n = x.ui.nova;
  if (!n) return `<button type="button" class="bt cl-adicionar" data-act="cl-nova">${ICONE.mais}Adicionar conta</button>`;
  // O login mora numa máquina (a impressão da conta só existe depois dele): sem uma que receba o login, não há formulário,
  // e sim o porquê e o caminho (pedido do Marlon no PR #306: "não entendi esse ponto de conectar em uma máquina").
  const recebem = x.maquinas.filter((m) => m.conectada && (m.plataforma !== "darwin" || ehEsteMac(m, x)));
  if (recebem.length === 0) return semMaquina(x);
  const ias: IaComConta[] = ["claude-cli", "codex-cli"];
  const provedor = ias.map((ia) => `<label class="cl-prov${n.ia === ia ? " ativo" : ""}"><input type="radio" name="ia" value="${ia}" data-cl-nova-ia${n.ia === ia ? " checked" : ""}>${logoDaIa(ia, "cl-logo")}<span><b>${esc(PROVEDOR[ia].nome)}</b><small>pelo ${esc(PROVEDOR[ia].cli)}</small></span></label>`).join("");
  const maqs = x.maquinas.filter((m) => m.conectada).map((m) => {
    const mac = m.plataforma === "darwin";
    const pode = !mac || ehEsteMac(m, x);
    const dica = mac ? (pode ? "abre o navegador" : "abra o app do nod nesse Mac") : preparoNaNova(m, n.ia) ?? "o login aparece aqui na tela";
    return `<label class="cl-maq${pode ? "" : " mudo"}"><input type="checkbox" value="${esc(m.id)}" data-cl-nova-maq${n.maquinas.includes(m.id) && pode ? " checked" : ""}${pode ? "" : " disabled"}>${mac ? ICONE.laptop : ICONE.servidor}<span><b>${esc(mac && pode ? rotuloDoMac() : m.nome)}</b><small>${esc(dica)}</small></span></label>`;
  }).join("");
  const marcadas = n.maquinas.filter((id) => x.maquinas.some((m) => m.id === id && m.conectada)).length;
  return `<form class="espaco-cartao cl-nova" data-form="cl-nova">
      <b class="cl-nova-tit">Nova conta</b>
      <div class="cl-provs" role="radiogroup" aria-label="Provedor">${provedor}</div>
      <label class="cl-campo">Apelido<input name="apelido" maxlength="40" placeholder="ex.: Lumen, Pessoal, Freela" value="${esc(n.apelido)}" data-cl-nova-apelido data-manter-foco="cl-nova-apelido"></label>
      <small class="mudo">Aparece na lista e na conversa. E-mail e organização ficam só nas suas máquinas.</small>
      <span class="cl-campo-tit">Entrar em</span>
      <div class="cl-maqs-form">${maqs}</div>
      <div class="cl-nova-acoes"><button type="button" class="bt" data-act="cl-nova-fechar">Cancelar</button><button type="submit" class="bt pri"${marcadas === 0 ? " disabled" : ""}>${marcadas > 1 ? `Entrar nas ${marcadas} máquinas` : "Entrar"}</button></div>
    </form>`;
}

/**
 * NOD-8 (definido em 2026-10-22): na VM sem a IA (ou abaixo do piso), a Nova conta avisa que o nod instala (ou atualiza)
 * antes do login, lendo o que a máquina anunciou (`MaquinaDto.ias`/`iasDetalhe`). null = a IA já está lá (ou não se sabe).
 */
function preparoNaNova(m: MaquinaDto, ia: IaComConta): string | null {
  if (m.ias[ia] !== "ausente") return null;
  const causa = m.iasDetalhe?.[ia]?.causa;
  if (causa === "sonda_lenta" || causa === "sem_node" || causa === "config_invalida") return null;
  return `o nod ${causa === "cli_antigo" ? "atualiza" : "instala"} o ${PROVEDOR[ia].nome} nela e o login aparece aqui`;
}

/** "Adicionar conta" sem nenhuma máquina que receba o login: diz por que e leva a conectar uma. */
function semMaquina(x: ContextoContas): string {
  const macFechado = x.maquinas.some((m) => m.conectada && m.plataforma === "darwin");
  const mac = x.noApp
    ? ""
    : macFechado
      ? "<p>Seu Mac já está conectado: abra o app do nod nele para entrar por lá.</p>"
      : "<p>No Mac, o login é feito pelo app do nod: abra o app e ele se conecta sozinho.</p>";
  return `<div class="espaco-cartao cl-nova cl-sem-maquina" role="group" aria-labelledby="cl-sem-maquina-tit">
      <b class="cl-nova-tit" id="cl-sem-maquina-tit">Nova conta</b>
      <p>Suas contas de IA ficam nas suas máquinas: o login do Claude e do ChatGPT é feito no Mac, pelo app do nod, ou numa VM. O nod guarda só o apelido. Conecte uma máquina para entrar.</p>
      ${mac}
      <div class="cl-nova-acoes"><button type="button" class="bt" data-act="cl-nova-fechar">Cancelar</button><button type="button" class="bt pri" data-act="cl-conectar-vm">${ICONE.servidor}Conectar uma VM</button></div>
    </div>`;
}

/** "A", "A e B", "A, B e C". */
const emLista = (itens: readonly string[]): string => (itens.length < 2 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)!}`);

/**
 * NOD-293 C11 (definido em 2026-10-20): antes de sair ou remover, o diálogo diz quais frentes param. A conversa sem frente
 * aparece como "a conversa com {bot}"; na remoção (várias máquinas), a máquina vai entre parênteses. Sem conferir (a busca
 * falhou), o aviso diz o risco e não bloqueia: a pessoa decide. Os quatro estados ficam em role="status".
 */
function avisoDasFrentes(x: ContextoContas, frentes: readonly FrenteAtivaDaConta[] | null | undefined, acao: "sair" | "remover"): string {
  if (frentes === undefined) return `<p class="cl-caixa" role="status">Conferindo as frentes que usam esta conta…</p>`;
  if (frentes === null) return `<p class="cl-caixa cl-caixa-aviso" role="status">Não deu para conferir se alguma frente usa esta conta. Se houver alguma, ela para ao ${acao}.</p>`;
  if (!frentes.length) return `<p class="cl-caixa" role="status">Nenhuma frente usa esta conta agora.</p>`;
  const itens = frentes.map((f) => {
    const rotulo = `<b>${esc(f.titulo ?? `a conversa com ${f.agente}`)}</b>`;
    if (acao === "sair") return rotulo;
    const m = x.maquinas.find((y) => y.id === f.maquinaId);
    const onde = m ? nomeCurto(m, x.maquinas) : f.maquina;
    return onde ? `${rotulo} (${esc(onde)})` : rotulo;
  });
  return `<p class="cl-caixa" role="status">Vão parar: ${emLista(itens)}.</p>`;
}

/** As confirmações (G1-P5 Sair, G1-P6 Remover) num diálogo sobre a tela. */
function confirmacao(x: ContextoContas): string {
  const q = x.ui.confirmar;
  if (!q) return "";
  const c = x.contas.contas.find((y) => y.id === q.contaId);
  if (!c) return "";
  const nome = nomeDaContaNaTela(c);
  let titulo = "";
  let corpo = "";
  let botao = "";
  if (q.tipo === "sair") {
    const m = x.maquinas.find((y) => y.id === q.maquinaId);
    const nm = m ? nomeCurto(m, x.maquinas) : "máquina";
    const outrasMaqs = c.maquinas.filter((v) => v.maquinaId !== q.maquinaId && v.estado === "pronta").map((v) => { const o = x.maquinas.find((y) => y.id === v.maquinaId); return o ? nomeCurto(o, x.maquinas) : v.nome; });
    const outrasContas = x.contas.contas.filter((o) => o.id !== c.id && prontaEm(o, q.maquinaId)).map(nomeDaContaNaTela);
    const bots = x.botsNaMaquina(q.maquinaId);
    titulo = `Sair da ${nome} na ${nm}?`;
    corpo = `${avisoDasFrentes(x, q.frentes, "sair")}<p>A ${esc(nm)} esquece o login desta conta.${outrasMaqs.length ? ` Na ${esc(outrasMaqs.join(", "))} ela continua.` : ""}</p>
      ${bots.length ? `<div class="cl-caixa">${outrasContas.length
        ? `Os bots da ${esc(nm)} (${esc(bots.join(", "))}) seguem com as outras contas logadas lá: ${outrasContas.map((o) => `<b>${esc(o)}</b>`).join(" e ")}.`
        : `A ${esc(nm)} fica sem conta de IA: os bots dela (${esc(bots.join(", "))}) esperam até você entrar numa conta lá.`}</div>` : ""}`;
    botao = `<button type="button" class="bt perigo" data-act="cl-confirmar"${q.frentes === undefined ? " disabled aria-busy=\"true\"" : ""}>Sair da ${esc(nm)}</button>`;
  } else {
    const nomes = c.maquinas.map((v) => { const o = x.maquinas.find((y) => y.id === v.maquinaId); return o ? nomeCurto(o, x.maquinas) : v.nome; });
    titulo = `Remover a ${nome}?`;
    corpo = `${avisoDasFrentes(x, q.frentes, "remover")}<p>${nomes.length ? `O nod sai desta conta ${nomes.length === 1 ? "na" : "no"} ${esc(nomes.join(" e na "))} e apaga a pasta dela${nomes.length > 1 ? ` nas ${nomes.length === 2 ? "duas" : nomes.length}` : ""}. ` : ""}Ela some da lista; as outras continuam.</p><p class="mudo sm">Para usar de novo, é só adicionar a conta outra vez.</p>`;
    botao = `<button type="button" class="bt perigo" data-act="cl-confirmar"${q.frentes === undefined ? " disabled aria-busy=\"true\"" : ""}>${nomes.length > 1 ? `Remover das ${nomes.length} máquinas` : "Remover"}</button>`;
  }
  return `<div class="cl-fundo" data-act="cl-confirmar-fechar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="cl-dialogo-tit"><h3 id="cl-dialogo-tit">${esc(titulo)}</h3>${corpo}<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="cl-confirmar-fechar" data-cl-autofoco>Cancelar</button>${botao}</div></div>`;
}

/** QA do PR #306 (ISSUE-009): "Entrando…" só enquanto algum login corre; terminado, a linha diz como acabou. */
function estadoDosLogins(ls: readonly LoginNaTela[]): string {
  const fases = ls.map((l) => (l.onde === "vm" ? l.login.fase : "abrindo"));
  if (fases.some((f) => f !== "pronto" && f !== "falhou" && f !== "cancelado")) return '<span class="contas-estado e-disp">Entrando…</span>';
  return fases.includes("pronto") ? '<span class="contas-estado e-uso">Entrou</span>' : "";
}

/** Os logins de contas novas (sem conta na lista ainda) aparecem embaixo da lista. */
function loginsSemConta(x: ContextoContas): string {
  const soltos = x.ui.logins.filter((l) => {
    const id = contaDoLogin(l);
    return id === null || !x.contas.contas.some((c) => c.id === id);
  });
  if (soltos.length === 0) return "";
  const porConta = new Map<string, LoginNaTela[]>();
  for (const l of soltos) {
    const ia = l.onde === "vm" ? l.login.ia : l.ia;
    const apelido = l.onde === "vm" ? l.login.apelido : l.apelido;
    const k = `${ia}:${apelido ?? ""}`;
    porConta.set(k, [...(porConta.get(k) ?? []), l]);
  }
  return [...porConta.entries()].map(([k, ls]) => {
    const [ia, apelido] = k.split(":") as [IaComConta, string];
    return `<li class="cl-linha entrando"><span class="cl-alca" aria-hidden="true"></span><span class="cl-pos" aria-hidden="true">+</span>${logoDaIa(ia, "cl-logo")}<div class="cl-corpo"><div class="cl-nome"><b>${esc(PROVEDOR[ia].nome)}${apelido ? ` · ${esc(apelido)}` : ""}</b></div><div class="cl-ident"><span>conta nova · pelo ${esc(PROVEDOR[ia].cli)}</span></div>${ls.map((l) => blocoDoLogin(l, x, null)).join("")}</div><div class="cl-dir">${estadoDosLogins(ls)}</div><div class="cl-mais"></div></li>`;
  }).join("");
}

export function renderListaDeContas(x: ContextoContas): string {
  const filtro = x.ui.filtro ? x.maquinas.find((m) => m.id === x.ui.filtro) ?? null : null;
  const usada = emUso(x);
  const linhas = x.contas.contas.map((c, i) => linha(c, i + 1, x, usada)).join("");
  const n = x.contas.contas.length;
  const abas = filtro
    ? `<div class="cl-filtro"><div class="segmentado" role="group" aria-label="Máquina">${[{ id: "", nome: "Todas as máquinas" }, ...x.maquinas.map((m) => ({ id: m.id, nome: m.plataforma === "darwin" && ehEsteMac(m, x) ? "Este Mac" : nomeCurto(m, x.maquinas) }))].map((o) => `<button type="button" class="seg${(x.ui.filtro ?? "") === o.id ? " ativo" : ""}" aria-pressed="${(x.ui.filtro ?? "") === o.id}" data-act="cl-filtro" data-maquina="${esc(o.id)}">${esc(o.nome)}</button>`).join("")}</div><button type="button" class="ob-link" data-act="secao-espaco" data-secao="maquinas">‹ Voltar para Máquinas</button></div>`
    : "";
  const vazio = n === 0 && x.ui.logins.length === 0
    ? `<div class="espaco-cartao cl-vazio"><p>Nenhuma conta de IA ainda.${x.maquinas.length === 0 ? " Conecte o app do Mac ou uma VM em Máquinas e entre numa conta nela." : " Adicione uma conta e escolha em quais máquinas entrar."}</p></div>`
    : "";
  const regras = n > 0
    ? `<div class="espaco-cartao cl-regras"><b>Quando uma conta acabar</b><small>Não há nada para configurar aqui. É assim que o Nod age:</small><ul>${REGRAS_DA_FILA.map((r) => `<li><b>${esc(r.titulo)}:</b> ${esc(r.texto)}</li>`).join("")}</ul></div>`
    : "";
  const nota = x.ui.nota ? `<p class="cl-nota" role="status">${esc(x.ui.nota)}</p>` : "";
  return `${abas}
    ${vazio}
    ${n > 0 || x.ui.logins.length > 0 ? `<div class="prov-ordem"><span>${n} ${n === 1 ? "conta" : "contas"} · em ordem de uso</span><span>arraste para mudar</span></div>
    <ol class="espaco-cartao cl-lista" data-ordem-lista="contas" aria-label="Suas contas de IA, em ordem de uso">${linhas}${loginsSemConta(x)}</ol>` : ""}
    ${nota}
    ${filtro ? "" : formNova(x)}
    ${regras}
    <p class="contas-privado">E-mail e organização ficam só nas suas máquinas: o servidor do nod recebe o apelido, o plano e uma impressão da conta, nunca o e-mail.</p>
    ${confirmacao(x)}`;
}

/**
 * As contas numa máquina, no passo "Contas" do Conectar (CMJ, 2026-10-13): cada conta da pessoa com "Entrar" (ou ✓ se
 * já está logada nela), os logins abertos e o atalho para uma conta nova direto nesta máquina.
 */
export function renderContasNaMaquina(x: ContextoContas, maquinaId: string): string {
  const m = x.maquinas.find((y) => y.id === maquinaId);
  if (!m) return "";
  const nome = nomeCurto(m, x.maquinas);
  const linhas = x.contas.contas.map((c) => {
    const pronta = prontaEm(c, maquinaId);
    const logins = x.ui.logins.filter((l) => contaDoLogin(l) === c.id && maquinaDoLogin(l) === maquinaId);
    const direita = pronta ? '<span class="contas-estado e-uso">✓ logada</span>'
      : logins.length ? '<span class="contas-estado e-disp">Entrando…</span>'
      : `<button type="button" class="bt sm" data-act="cl-entrar" data-id="${esc(c.id)}" data-maquina="${esc(maquinaId)}">Entrar</button>`;
    return `<li class="cl-linha${pronta ? "" : " fora"}">${logoDaIa(c.ia, "cl-logo")}<div class="cl-corpo"><div class="cl-nome"><b>${esc(nomeDaContaNaTela(c))}</b>${c.plano ? `<span class="cl-plano">${esc(planoNaTela(c.plano))}</span>` : ""}</div>${logins.map((l) => blocoDoLogin(l, x, c)).join("")}</div><div class="cl-dir">${direita}</div></li>`;
  }).join("");
  const novas = x.ui.logins.filter((l) => maquinaDoLogin(l) === maquinaId && (contaDoLogin(l) === null || !x.contas.contas.some((c) => c.id === contaDoLogin(l)))).map((l) => blocoDoLogin(l, x, null)).join("");
  const atalhos = (["claude-cli", "codex-cli"] as const).map((ia) => `<button type="button" class="bt sm" data-act="cl-nova-na-maquina" data-ia="${ia}" data-maquina="${esc(maquinaId)}">${logoDaIa(ia, "cl-logo mini")}Conta nova do ${esc(PROVEDOR[ia].nome)}</button>`).join("");
  return `<ol class="espaco-cartao cl-lista cl-na-maquina" aria-label="Suas contas na ${esc(nome)}">${linhas || `<li class="cl-linha cl-vazia"><span class="mudo">Você ainda não tem contas de IA. Entre na primeira aqui.</span></li>`}</ol>
    ${novas ? `<div class="cl-novas">${novas}</div>` : ""}
    <div class="cl-atalhos">${atalhos}</div>`;
}

/** O resumo das contas no cartão da máquina (G2-M1): logos, nomes e quantas ainda não estão nela. */
export function resumoDasContasNaMaquina(contas: ContasIaDto, m: MaquinaDto): string {
  const aqui = contas.contas.filter((c) => prontaEm(c, m.id));
  const faltam = contas.contas.length - aqui.length;
  const logos = aqui.slice(0, 6).map((c) => logoDaIa(c.ia, "cl-logo mini")).join("");
  const texto = aqui.length === 0
    ? "Nenhuma conta de IA aqui ainda"
    : faltam === 0 && contas.contas.length > 1 ? `${aqui.length} contas · todas as suas` : `${aqui.length} ${aqui.length === 1 ? "conta" : "contas"} · ${aqui.map(nomeDaContaNaTela).join(", ")}`;
  const aviso = aqui.length > 0 && faltam > 0 ? `<small class="cl-aviso-txt">${faltam === 1 ? "1 conta sua ainda não está aqui" : `${faltam} contas suas ainda não estão aqui`}</small>` : "";
  return `<div class="maq-contas"><span class="maq-contas-logos">${logos}</span><span class="maq-contas-txt"><span>${esc(texto)}</span>${aviso}</span><button type="button" class="ob-link" data-act="cl-gerenciar" data-maquina="${esc(m.id)}">${aqui.length === 0 ? "Entrar numa conta" : "Gerenciar contas"} ›</button></div>`;
}
