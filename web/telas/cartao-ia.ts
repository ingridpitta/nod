import type { ContasNaTela, IaDesktop } from "../../src/contracts/desktop.ts";
import type { AtualizacaoDaIa, ContaDaIa, EstadoDaIa, EstadoIa } from "../../src/contracts/estado-ia.ts";
import { comandoDoTerminal, fraseDaAtualizacao } from "../lib/atualizacao-ia.ts";
import type { IaDaPessoa } from "../../src/contracts/inteligencia.ts";
import type { CausaSemIa } from "../../src/contracts/inventario.ts";
import { esc, hora } from "../lib/render.ts";
import { ROTULO_COPIADO, VIVO } from "../lib/copiar.ts";
import { haQuanto } from "../lib/relogio.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";
import { nesteMac, noSeuMac, terminalDaqui } from "../lib/plataforma-da-tela.ts";

/**
 * O cartão de uma IA (definido em 2026-10-10, plano "IAs: conexão, troca e escolha de modelo", PR 3; protótipos aprovados
 * Main, a tela 1 "Provedores de IA", e Onboarding, a tela 5). O MESMO cartão nas duas telas: logo redondo, nome, estado
 * curto e um botão só; instalar, entrar e testar acontecem DENTRO dele, em até três passos, com "Precisa de ajuda?" em
 * cada passo. Funções puras (tests/unit/web/cartao-ia.test.ts); os cliques (`data-act="ia-…"`) são tratados em
 * web/main.ts, que fala com o app do Mac por `window.nodDesktop.ias` (src/contracts/desktop.ts, PonteIas).
 *
 * De onde vem o estado: dentro do app do Mac (rc.7 em diante), o estado único que o app monta (src/contracts/estado-ia.ts);
 * no navegador, no celular ou num app antigo, o inventário que o servidor junta das máquinas da pessoa (`GET /ias`). O
 * limite da assinatura é do servidor e vale por cima dos dois.
 */

export type IaMac = IaDesktop;
export const IAS_MAC: readonly IaMac[] = ["claude-cli", "codex-cli"];
export const ehIaMac = (v: unknown): v is IaMac => v === "claude-cli" || v === "codex-cli";

/** Como a tela chama cada IA: o produto que a pessoa assina, o programa que o nod usa e quem o faz. */
export const PROVEDOR: Record<IaMac, { nome: string; cli: string; empresa: string; logo: keyof typeof LOGOS_IA }> = {
  "claude-cli": { nome: "Claude", cli: "Claude Code", empresa: "Anthropic", logo: "claude" },
  "codex-cli": { nome: "ChatGPT", cli: "Codex", empresa: "OpenAI", logo: "chatgpt" },
};

/**
 * A troca de conta (definido em 2026-10-12, NOD-209; protótipo aprovado pelo Matheus no mesmo dia). "Trocar conta" abre o
 * mesmo login dentro do cartão; a conta de antes fica aqui para o passo dizer "Agora: …" e a nota dizer se mudou.
 *  - abrindo: o clique saiu, o login ainda não abriu (um login antigo terminado não conta);
 *  - entrando: o login está aberto;
 *  - entrou: o login terminou bem e a conta nova ainda não chegou do Mac;
 *  - concluida: a nota já foi escrita.
 */
export type TrocaDeConta = { antes: ContaDaIa | null; fase: "abrindo" | "entrando" | "entrou" | "concluida" };

/** O que a tela guarda das IAs do Mac (o reducer, `estado.iasMac`): a ponte, o último estado de cada IA e o que é só da tela. */
export type UiIas = {
  /** Dentro do app do Mac com a ponte `ias` (rc.7 em diante). false = navegador, celular ou app antigo. */
  noApp: boolean;
  estados: Partial<Record<IaMac, EstadoIa>>;
  /** O fluxo aberto no cartão; `instalar` = começou instalando (o passo 1 aparece). */
  fluxo: Partial<Record<IaMac, { instalar: boolean }>>;
  /** O teste de uma frase pedido no fim do fluxo (Provedores de IA); o onboarding tem o dele (onboarding-teste.ts). */
  teste: Partial<Record<IaMac, { estado: "testando" } | { estado: "pronto"; resposta: string | null } | { estado: "reprovada"; causa: CausaSemIa }>>;
  /** "Precisa de ajuda?" aberto: `<ia>:<passo>`. */
  ajuda: string | null;
  /** O detalhe da falha da instalação aberto. */
  detalhe: IaMac | null;
  /** O ícone de verificar girando. */
  verificando: IaMac | null;
  /** O resultado da última ação, quando ela não muda o estado (o erro de um clique, o que fazer fora do app). */
  nota: Partial<Record<IaMac, string>>;
  copiado: IaMac | null;
  /** O código do Claude que a pessoa está colando (atravessa o redesenho do cartão). */
  codigo: Partial<Record<IaMac, string>>;
  /** NOD-209: a troca de conta de cada IA (a em curso ou a última). */
  troca: Partial<Record<IaMac, TrocaDeConta>>;
  /** ADR-101 (NOD-211): as várias contas de cada IA, como o app do Mac as manda (só no app; nunca vão ao servidor). */
  contas: Partial<Record<IaMac, ContasNaTela>>;
  /** "+ Adicionar outra conta" aberto: o apelido digitado até agora. */
  contaNova: Partial<Record<IaMac, string>>;
};

export const UI_IAS_INICIAL: UiIas = { noApp: false, estados: {}, fluxo: {}, teste: {}, ajuda: null, detalhe: null, verificando: null, nota: {}, copiado: null, codigo: {}, troca: {}, contas: {}, contaNova: {} };

/** A linha da conta no cartão: "e-mail · organização · plano" (o que faltar, sai). */
export const textoDaConta = (c: ContaDaIa): string => [c.email, c.organizacao, c.plano].filter(Boolean).join(" · ");
/** A conta no passo da troca: "e-mail · organização" (ou o plano, quando não há organização). */
export const contaCurta = (c: ContaDaIa): string => [c.email, c.organizacao ?? c.plano].filter(Boolean).join(" · ");
/** No navegador e no celular a conta não aparece (ADR-019: ela só existe no app do Mac). */
export const NOTA_CONTA_FORA_DO_APP = "Para ver ou trocar a conta, abra o app do nod no Mac.";
/** A nota depois da troca: a conta mudou ou é a mesma de antes. */
export function notaDaTroca(antes: ContaDaIa | null, agora: ContaDaIa): string {
  return antes?.email === agora.email ? `A conta continua a mesma: ${agora.email}.` : `Conta trocada: agora com ${agora.email}.`;
}
/** A dica do navegador na troca: a página pode entrar sozinha com a conta que já está aberta nele. */
export const DICA_DA_TROCA: Record<IaMac, string> = {
  "claude-cli": "A página da Anthropic pode entrar sozinha com a conta já aberta no navegador. Se aparecer a conta errada, clique no seu nome no canto da página, saia e entre com a outra.",
  "codex-cli": "A página da OpenAI pode entrar sozinha com a conta já aberta no navegador. Se aparecer a conta errada, clique em “Usar outra conta” antes de digitar o código.",
};

/** O estado de uma IA como a tela lê: o do Mac (no app) ou o do servidor, com o limite por cima. */
export type EstadoNaTela = {
  estado: EstadoDaIa;
  versao?: string;
  minima?: string;
  causa?: CausaSemIa;
  /** no_limite: até quando. */
  ate?: number;
  /** Quando foi verificado (o `em` do Mac ou do inventário). */
  em?: number;
  mac?: EstadoIa;
  /** NOD-9: a atualização do CLI (a em curso ou a última), do Mac ou do inventário da máquina. */
  atualizacao?: AtualizacaoDaIa;
};

/**
 * O inventário do servidor no estado único. Cópia de `doInventario` (src/domain/estado-ia.ts): a web só faz `import type`
 * de src/ (ADR-018); tests/unit/web/cartao-ia.test.ts compara as duas em cada inventário possível.
 */
export function estadoDoServidor(ia: IaDaPessoa | undefined): EstadoNaTela {
  if (!ia) return { estado: "procurando" };
  const inv = ia.inventario;
  const em = { em: inv.em, ...(inv.atualizacao ? { atualizacao: inv.atualizacao } : {}) };
  if (inv.estado === "pronto") return { estado: "pronta", versao: inv.versao, ...em };
  const versao = inv.versao ? { versao: inv.versao } : {};
  if (inv.causa === "sonda_lenta") return { estado: "lenta", ...versao, ...em };
  if (inv.estado === "ausente") {
    if (inv.causa === "cli_antigo") return { estado: "desatualizada", ...versao, ...(inv.minima ? { minima: inv.minima } : {}), ...em };
    if (inv.causa === "atualizando") return { estado: "atualizando", ...versao, ...em };
    if (inv.causa === "sem_node") return { estado: "sem_node", ...em };
    if (inv.causa === "config_invalida") return { estado: "config_invalida", ...em };
    return { estado: "nao_instalada", ...em };
  }
  if (inv.causa === "limite") return { estado: "no_limite", ...versao, ...(inv.renovaEm ? { ate: inv.renovaEm } : ia.limite ? { ate: ia.limite.renovaEm } : {}), ...em };
  if (inv.causa === "conta_sem_acesso" || inv.causa === "teste_falhou") return { estado: "sem_acesso", causa: inv.causa, ...versao, ...em };
  return { estado: "falta_entrar", ...versao, ...em };
}

/** O estado que vale: no app, o do Mac; o limite do servidor vale por cima de uma IA pronta. */
export function estadoNaTela(ia: IaMac, servidor: IaDaPessoa | undefined, ui: UiIas, agora: number): EstadoNaTela {
  const mac = ui.noApp ? ui.estados[ia] : undefined;
  const limite = servidor?.limite && servidor.limite.renovaEm > agora ? servidor.limite : null;
  if (!mac) {
    const e = estadoDoServidor(servidor);
    return e.estado === "pronta" && limite ? { ...e, estado: "no_limite", ate: limite.renovaEm } : e;
  }
  const base: EstadoNaTela = { estado: mac.estado, ...(mac.versao ? { versao: mac.versao } : {}), ...(mac.minima ? { minima: mac.minima } : {}), ...(mac.causa ? { causa: mac.causa } : {}), ...(mac.ate ? { ate: mac.ate } : {}), em: mac.em, mac, ...(mac.atualizacao ? { atualizacao: mac.atualizacao } : {}) };
  if (mac.estado === "pronta" && limite) return { ...base, estado: "no_limite", ate: limite.renovaEm };
  return base;
}

/** Pronta ou no limite: conectada (no limite volta sozinha). */
export const iaServe = (e: EstadoNaTela): boolean => e.estado === "pronta" || e.estado === "no_limite";

/**
 * NOD-424 (2026-10-29, bug em produção): o estado da IA para o BOT — o seletor do campo, a linha e o painel Inteligência,
 * o Automático, a linha do limite (ia-fora.ts). O bot roda numa máquina da pessoa, não no Mac da tela: a IA serve se estiver pronta em alguma máquina viva
 * dela (o inventário do `GET /ias`, que já junta as máquinas com "pronto" vencendo) OU no Mac da tela (o servidor pode
 * ainda não saber). Pronta vence no_limite (outra conta/máquina atende); o limite do servidor vale por cima das duas
 * (`estadoNaTela`). Sem nenhuma das duas servindo, vale o estado do Mac no app (o que a pessoa resolve ali). O cartão de
 * Provedores de IA continua no `estadoNaTela` (instalar e entrar NESTE Mac).
 */
export function estadoParaOBot(ia: IaMac, servidor: IaDaPessoa | undefined, ui: UiIas, agora: number): EstadoNaTela {
  const daTela = estadoNaTela(ia, servidor, ui, agora);
  if (!ui.noApp || !servidor) return daTela;
  const dasMaquinas = estadoNaTela(ia, servidor, { ...ui, noApp: false }, agora);
  if (daTela.estado === "pronta") return daTela;
  if (dasMaquinas.estado === "pronta") return dasMaquinas;
  if (iaServe(daTela)) return daTela;
  return iaServe(dasMaquinas) ? dasMaquinas : daTela;
}

// ---- a vista do cartão --------------------------------------------------------------------------------------------------

export type AcaoIa = "ia-instalar" | "ia-atualizar" | "ia-entrar" | "ia-trocar" | "ia-cancelar" | "ia-testar" | "ia-verificar" | "ia-abrir-link" | "ia-colar-codigo" | "ia-copiar-codigo" | "ia-ajuda" | "ia-detalhe" | "secao-espaco";
/** `agora` (NOD-9): o "Atualizar agora" do aviso e da espera segurada — roda já, sem esperar a brecha dos turnos. */
export type BotaoIa = { act: AcaoIa; rotulo: string; destaque: boolean; agora?: boolean };

export type IdPasso = "instalar" | "entrar" | "testar";
export type PassoIa = {
  id: IdPasso;
  titulo: string;
  marca: "feito" | "ativo" | "girando" | "erro" | "depois";
  texto: string | null;
  /** A última linha da instalação. */
  log: string | null;
  /** Codex: o código de uso único para digitar na página da OpenAI. */
  codigo: string | null;
  /** O link oficial do login está pronto: o botão "Abrir a página da …" aparece. */
  abrir: boolean;
  /** Claude: o campo para colar o código que a página da Anthropic mostra. */
  colar: boolean;
  esperando: string | null;
  acoes: { act: AcaoIa; rotulo: string; contorno?: true }[];
  /** O detalhe da falha da instalação (o arquivo de registro, para o suporte). */
  detalhe: string | null;
  /** Troca de conta: a conta de agora, que continua se a pessoa cancelar. */
  contaAtual: string | null;
  /** Troca de conta: a dica de escolher a outra conta na página. */
  dica: string | null;
  /** Troca de conta terminada: a conta nova e a de antes. */
  trocou: { agora: string; antes: string | null } | null;
};

export type VistaIa = {
  ia: IaMac;
  nome: string;
  cli: string;
  estado: EstadoDaIa;
  texto: string;
  tom: "mudo" | "ok" | "aviso";
  girando: boolean;
  botao: BotaoIa | null;
  /** O bloco que explica um problema que a pessoa resolve fora daqui (conta sem acesso, limite sem outra IA). */
  explica: string | null;
  nota: string | null;
  /** O balão do ícone de verificar: a versão e quando foi verificado. */
  dica: string;
  podeVerificar: boolean;
  passos: PassoIa[] | null;
  /** NOD-209: a conta logada ("e-mail · organização · plano"), só no app do Mac. */
  conta: string | null;
  /** "Trocar conta": um link no onboarding, um botão de contorno em Provedores de IA. */
  trocar: "link" | "botao" | null;
  /** NOD-9: o comando de atualizar, recolhido em "Prefere o terminal?"; só depois de uma falha (ADR-102, 2A). */
  terminal?: string | null;
};

export type ContextoCartao = {
  /** As IAs do servidor, na ordem da pessoa; null/undefined = ainda não leu (ou servidor antigo). */
  servidor: readonly IaDaPessoa[] | null | undefined;
  ui: UiIas;
  agora: number;
  /** Onde o cartão aparece: muda só a frase da IA pronta. */
  onde: "provedores" | "onboarding";
  /** Onboarding: o veredito do teste dele (onboarding-teste.ts), que manda sobre a frase da IA pronta. */
  vereditos?: Partial<Record<IaMac, { estado: "pronto" | "nao_autenticado" | "ausente"; causa?: string; resposta?: string }>>;
  /** Onboarding: as IAs com o teste dele em curso. */
  testandoNoOnboarding?: readonly IaMac[];
};

const ONDE = (ui: UiIas): string => (ui.noApp ? nesteMac() : noSeuMac());

/** A ordem das IAs do Mac na lista da pessoa (as do servidor primeiro, na ordem dela; as que faltam no fim). */
export function ordemDasIas(servidor: readonly IaDaPessoa[] | null | undefined): IaMac[] {
  const daPessoa = (servidor ?? []).map((i) => i.id).filter(ehIaMac);
  return [...daPessoa, ...IAS_MAC.filter((ia) => !daPessoa.includes(ia))];
}

/** A IA está pronta para trabalhar (conectada e fora do limite)? */
const pronta = (e: EstadoNaTela): boolean => e.estado === "pronta";

/** O teste de uma frase visto pelo cartão: o do onboarding (vereditos) ou o pedido no fim do fluxo de Provedores. */
function testeDa(ia: IaMac, c: ContextoCartao): "testando" | { resposta: string | null } | { causa: CausaSemIa } | null {
  if (c.onde === "onboarding") {
    if (c.testandoNoOnboarding?.includes(ia)) return "testando";
    const v = c.vereditos?.[ia];
    if (v?.estado === "pronto") return { resposta: v.resposta ?? null };
    if (v?.causa === "conta_sem_acesso" || v?.causa === "teste_falhou") return { causa: v.causa };
    return null;
  }
  const t = c.ui.teste[ia];
  if (!t) return null;
  if (t.estado === "testando") return "testando";
  return t.estado === "pronto" ? { resposta: t.resposta } : { causa: t.causa };
}

/** A frase da IA pronta: em Provedores, se ela está em uso ou é a reserva; no onboarding, se respondeu ao teste. */
function textoPronta(ia: IaMac, c: ContextoCartao, estados: Record<IaMac, EstadoNaTela>): string {
  if (c.onde === "onboarding") return "Conectado · respondeu ao teste";
  const ordem = ordemDasIas(c.servidor);
  const acima = ordem.slice(0, ordem.indexOf(ia));
  if (acima.some((x) => pronta(estados[x]))) return "Conectado · assume se a de cima parar";
  const parada = acima.find((x) => estados[x].estado === "no_limite");
  if (parada) return `Conectado · em uso até o ${PROVEDOR[parada].nome} voltar`;
  return "Conectado · em uso";
}

/** "às 14:00" no mesmo dia; "em 11/10 às 14:00" noutro. */
export function quandoRenova(ate: number, agora: number): string {
  const dia = (t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return dia(ate) === dia(agora) ? `às ${hora(ate)}` : `em ${dia(ate)} às ${hora(ate)}`;
}

/**
 * Os passos do fluxo aberto no cartão, do estado de verdade do Mac: o que o app está fazendo (instalando, o login aberto,
 * o teste), o que acabou (a instalação ou o login que falhou) e o teste de uma frase. null = sem fluxo (o cartão fica
 * numa linha só).
 */
export function passosDaIa(ia: IaMac, e: EstadoNaTela, c: ContextoCartao): PassoIa[] | null {
  const { nome, cli, empresa } = PROVEDOR[ia];
  const mac = e.mac;
  const aberto = c.ui.fluxo[ia] ?? (e.estado === "instalando" ? { instalar: true } : e.estado === "entrando" ? { instalar: false } : null);
  if (!aberto || !mac) return null;
  const teste = testeDa(ia, c);
  // A IA respondeu (ou ficou pronta sem teste a pedir): o fluxo fecha e o cartão diz "Conectado".
  if (e.estado === "pronta" && (teste === null || (typeof teste === "object" && "resposta" in teste))) return null;
  if (e.estado === "no_limite") return null;
  const inst = mac.instalacao;
  const login = mac.login;
  const instalacaoFalhou = e.estado !== "instalando" && inst?.fase === "falhou";
  const loginFalhou = e.estado === "falta_entrar" && (login?.fase === "falhou" || login?.fase === "expirou");
  const reprovada = e.estado === "sem_acesso" ? e.causa ?? "teste_falhou" : typeof teste === "object" && teste !== null && "causa" in teste ? teste.causa : null;
  const testando = e.estado === "testando" || teste === "testando" || (e.estado === "pronta" && teste === null);
  const passo = (id: IdPasso, titulo: string, resto: Partial<PassoIa> = {}): PassoIa => ({ id, titulo, marca: "depois", texto: null, log: null, codigo: null, abrir: false, colar: false, esperando: null, acoes: [], detalhe: null, contaAtual: null, dica: null, trocou: null, ...resto });
  const troca = c.ui.troca[ia];
  const trocando = troca !== undefined && !aberto.instalar && (troca.fase !== "concluida" || e.estado !== "entrando");
  const lista: PassoIa[] = [];

  if (aberto.instalar) {
    const titulo = `Instalar o ${cli}`;
    if (e.estado === "instalando") lista.push(passo("instalar", titulo, { marca: "girando", log: inst?.linha || "Instalando…" }));
    else if (instalacaoFalhou) {
      lista.push(passo("instalar", titulo, {
        marca: "erro",
        texto: inst?.mensagem || "A instalação não terminou.",
        acoes: [{ act: "ia-instalar", rotulo: "Tentar de novo", contorno: true }, ...(inst?.registro ? [{ act: "ia-detalhe" as const, rotulo: c.ui.detalhe === ia ? "Esconder detalhe" : "Ver detalhe" }] : [])],
        detalhe: c.ui.detalhe === ia && inst?.registro ? `Registro da instalação: ~/Library/Logs/nod/${inst.registro}` : null,
      }));
    } else if (e.estado === "nao_instalada" || e.estado === "sem_node" || e.estado === "desatualizada") lista.push(passo("instalar", titulo, { marca: "ativo", texto: "Começando…" }));
    else lista.push(passo("instalar", titulo, { marca: "feito" }));
  }

  const tituloEntrar = trocando ? `Entrar com outra conta do ${nome}` : `Entrar na sua conta do ${nome}`;
  // A troca: o passo diz qual conta continua valendo e como escolher a outra na página.
  const naTroca: Partial<PassoIa> = trocando ? { contaAtual: troca.antes ? contaCurta(troca.antes) : null, dica: DICA_DA_TROCA[ia] } : {};
  const outra = trocando ? " com a outra conta" : "";
  const antesDeEntrar = e.estado === "instalando" || instalacaoFalhou || e.estado === "nao_instalada" || e.estado === "sem_node" || e.estado === "desatualizada";
  // NOD-8 (definido em 2026-10-22): enquanto o passo 1 corre, o 2 diz que começa sozinho; com a instalação falhada, ele espera.
  if (antesDeEntrar) lista.push(passo("entrar", tituloEntrar, instalacaoFalhou ? {} : { texto: "Começa sozinho quando a instalação terminar." }));
  else if (e.estado === "entrando" && login) {
    if (login.verificarDeNovo) {
      lista.push(passo("entrar", tituloEntrar, { marca: "ativo", texto: "Ainda não vimos o login terminar. Se você já entrou, confira de novo.", abrir: login.host !== null, acoes: [{ act: "ia-verificar", rotulo: "Verificar de novo", contorno: true }] }));
    } else if (!login.host) lista.push(passo("entrar", tituloEntrar, { marca: "girando", texto: "Abrindo o login…" }));
    else if (ia === "codex-cli") {
      lista.push(passo("entrar", tituloEntrar, { marca: "ativo", texto: trocando ? `Na página da ${empresa}, entre com a outra conta e digite este código:` : `Na página da ${empresa}, digite este código:`, codigo: login.codigoDoDispositivo, abrir: true, esperando: "Esperando você entrar…", ...naTroca }));
    } else {
      const colar = login.pedeCodigo && !login.codigoEnviado;
      lista.push(passo("entrar", tituloEntrar, {
        marca: "ativo",
        texto: colar ? `Entre na página da ${empresa}${outra} e cole aqui o código que ela mostrar.` : login.codigoEnviado ? "Conferindo o código…" : `Entre na página da ${empresa}${outra}. Quando terminar, volte aqui: o nod percebe sozinho.`,
        abrir: true,
        colar,
        esperando: colar ? null : "Esperando você entrar…",
        ...naTroca,
      }));
    }
  } else if (loginFalhou) lista.push(passo("entrar", tituloEntrar, { marca: "erro", texto: login?.mensagem || "O login não terminou.", acoes: [{ act: "ia-entrar", rotulo: "Tentar de novo", contorno: true }] }));
  else if (e.estado === "falta_entrar") lista.push(passo("entrar", tituloEntrar, { marca: "girando", texto: "Abrindo o login…" }));
  else {
    // A troca terminou: o passo diz a conta nova (e a de antes) enquanto o teste roda.
    const agora = trocando && (troca.fase === "entrou" || troca.fase === "concluida") ? mac.conta : undefined;
    lista.push(passo("entrar", tituloEntrar, { marca: "feito", trocou: agora ? { agora: agora.email, antes: troca?.antes?.email ?? null } : null }));
  }

  const tituloTestar = "Testar a resposta";
  if (reprovada) {
    lista.push(passo("testar", tituloTestar, reprovada === "conta_sem_acesso"
      ? { marca: "erro", texto: `A conta entrou, mas não tem acesso ao ${cli} pela assinatura. Entre com outra conta ou, se for conta da empresa, peça ao administrador: o acesso depende do assento ou do papel que ele definiu para você.`, acoes: [{ act: "ia-entrar", rotulo: "Entrar com outra conta", contorno: true }] }
      : { marca: "erro", texto: "A conta entrou, mas não respondeu ao teste.", acoes: [{ act: "ia-testar", rotulo: "Testar de novo", contorno: true }] }));
  } else if (testando && lista.every((p) => p.marca === "feito")) lista.push(passo("testar", tituloTestar, { marca: "girando", texto: `Mandando uma frase de teste para o ${nome}…` }));
  else lista.push(passo("testar", tituloTestar));
  return lista;
}

/** O estado do cartão: a frase, o tom, o botão e o fluxo. */
/**
 * NOD-9: fora do app, o caminho é o app do Mac — só isso. O comando do terminal aparece no app, recolhido em "Prefere o
 * terminal?", e só depois de uma falha (ADR-102, 2A); no navegador, o rodapé da NOD-171 já dá o comando com Copiar.
 */
const NOTA_ATUALIZAR_FORA_DO_APP = `Para atualizar, abra o app do nod ${noSeuMac()}.`;

/** Quanto tempo o "atualizado para a X." fica no cartão pronto depois do sucesso. */
export const AVISO_SUCESSO_MS = 24 * 60 * 60 * 1000;

/**
 * "Prefere o terminal?" no app: o `claude update` só faz sentido para um binário de fora. O que o próprio nod instalou
 * (origem `nod`) se atualiza pela reserva do instalador; o comando mexeria em outro `claude` do PATH.
 */
function terminalDaAtualizacao(ia: IaMac, e: EstadoNaTela): string | null {
  return e.mac?.detalhe?.origem === "nod" ? null : comandoDoTerminal("mac", ia);
}

export function vistaDaIa(ia: IaMac, c: ContextoCartao): VistaIa {
  const { nome, cli } = PROVEDOR[ia];
  const porId = new Map((c.servidor ?? []).map((s) => [s.id, s]));
  const estados = Object.fromEntries(IAS_MAC.map((x) => [x, estadoNaTela(x, porId.get(x), c.ui, c.agora)])) as Record<IaMac, EstadoNaTela>;
  const e = estados[ia];
  const outra = IAS_MAC.find((x) => x !== ia)!;
  const outraPronta = pronta(estados[outra]);
  const algumaPronta = IAS_MAC.some((x) => pronta(estados[x]));
  const noApp = c.ui.noApp;
  const onde = ONDE(c.ui);
  const passos = passosDaIa(ia, e, c);
  const teste = testeDa(ia, c);
  const destaque = !algumaPronta;
  const b = (act: AcaoIa, rotulo: string, forte = destaque): BotaoIa => ({ act, rotulo, destaque: forte });
  const quando = e.em ? haQuanto(Math.max(0, c.agora - e.em)) : null;
  const dica = e.versao ? `${cli} ${e.versao}${quando ? ` · verificado ${quando}` : ""}` : `Procurado ${onde}${quando ? ` ${quando}` : ""}`;
  // A conta logada: só no app do Mac, e não enquanto o login de outra está aberto (o passo já diz qual continua).
  const conta = noApp && e.mac?.conta && e.estado !== "entrando" && e.estado !== "instalando" ? textoDaConta(e.mac.conta) : null;
  const vista = (texto: string, tom: VistaIa["tom"], resto: Partial<VistaIa> = {}): VistaIa => ({
    ia, nome, cli, estado: e.estado, texto, tom, girando: false, botao: null, explica: null, nota: c.ui.nota[ia] ?? null, dica, podeVerificar: true, passos, conta, trocar: null, ...resto,
  });
  /** "Trocar conta" na IA logada (no app); fora dele, a nota diz onde ver e trocar a conta. */
  const trocar: Partial<VistaIa> = noApp ? { trocar: c.onde === "onboarding" ? "link" : "botao" } : { nota: c.ui.nota[ia] ?? NOTA_CONTA_FORA_DO_APP };
  // O cartão com um fluxo aberto: a frase acompanha o passo, e o botão (quando há) é o Cancelar.
  if (passos) {
    const erro = passos.find((p) => p.marca === "erro");
    if (erro) return vista(erro.id === "instalar" ? "A instalação não terminou" : erro.id === "entrar" ? "O login não terminou" : "A conta não respondeu ao teste", "aviso");
    const ativo = passos.find((p) => p.marca === "ativo" || p.marca === "girando");
    const cancelar = e.estado === "instalando" || e.estado === "entrando" ? b("ia-cancelar", "Cancelar", false) : null;
    const texto = ativo?.id === "instalar" ? "Instalando…" : ativo?.id === "entrar" ? (c.ui.troca[ia] && !c.ui.fluxo[ia]?.instalar ? "Trocando de conta… termine no navegador" : "Termine no navegador…") : "Testando…";
    return vista(texto, "mudo", { girando: !cancelar, botao: cancelar, podeVerificar: false });
  }
  switch (e.estado) {
    case "procurando":
      return vista(`Procurando ${onde}…`, "mudo", { girando: true, podeVerificar: false });
    case "lenta":
      return vista(`O ${cli} demorou para responder · tentando de novo`, "mudo", { girando: true });
    case "nao_instalada":
      return vista(`Não está ${onde}`, "mudo", noApp ? { botao: b("ia-instalar", "Instalar e entrar") } : { nota: c.ui.nota[ia] ?? `Para instalar, abra o app do nod ${noSeuMac()}.` });
    case "desatualizada": {
      // NOD-9: o "Atualizar" roda o atualizador do próprio CLI no Mac (com a reserva do instalador do nod); a frase da
      // última tentativa (ou da espera) vai no explica.
      const frase = fraseDaAtualizacao(e.atualizacao, cli);
      const explica = frase ? { explica: frase } : {};
      const texto = e.versao && e.minima ? `${cli} ${e.versao} · o nod precisa da ${legivel(e.minima)} ou mais nova` : `${cli} desatualizado`;
      // Depois de uma falha (ou da recusa da senha), o comando fica recolhido em "Prefere o terminal?"; antes, nunca.
      const a = e.atualizacao;
      const falhou = a?.fase === "falhou" || a?.fase === "insuficiente";
      // Esperando a brecha dos turnos: já está na fila, sem botão. No aviso e com os pedidos segurados: "Atualizar
      // agora" (roda já, sem esperar os turnos abertos). Depois de "subiu pouco" ou da recusa: "Tentar de novo".
      const rotulo = a?.fase === "insuficiente" || (a?.fase === "falhou" && a.motivo === "recusou") ? "Tentar de novo" : "Atualizar";
      const botao = a?.fase === "esperando" ? null : a?.fase === "aviso" || a?.fase === "segurando" ? { ...b("ia-atualizar", "Atualizar agora"), agora: true } : b("ia-atualizar", rotulo);
      return vista(texto, "aviso", noApp ? { botao, ...explica, terminal: falhou ? terminalDaAtualizacao(ia, e) : null } : { nota: c.ui.nota[ia] ?? NOTA_ATUALIZAR_FORA_DO_APP, ...explica });
    }
    case "atualizando":
      return vista(fraseDaAtualizacao(e.atualizacao, cli) ?? `Atualizando o ${cli}…`, "mudo", { girando: e.atualizacao?.fase !== "pedindo_aprovacao", podeVerificar: false });
    case "sem_node":
      return vista(`O ${cli} ${onde} precisa do Node.js`, "aviso", noApp ? { botao: b("ia-instalar", "Instalar") } : { nota: c.ui.nota[ia] ?? `Para instalar a versão do nod, abra o app do nod ${noSeuMac()}.` });
    case "config_invalida":
      return vista(`A configuração do ${cli} tem um erro`, "aviso", { explica: `O ${cli} ${onde} não abriu por causa de um erro no arquivo de configuração dele. Entrar de novo não resolve: corrija ou apague a linha com erro e verifique de novo.` });
    case "falta_entrar":
      return vista(`${cli} instalado · falta entrar`, "mudo", noApp ? { botao: b("ia-entrar", "Entrar") } : { nota: c.ui.nota[ia] ?? `Para entrar, abra o app do nod ${noSeuMac()}.` });
    case "instalando":
      return vista("Instalando…", "mudo", { girando: true, podeVerificar: false });
    case "entrando":
      return vista("Esperando você entrar…", "mudo", noApp ? { botao: b("ia-cancelar", "Cancelar", false), podeVerificar: false } : { girando: true });
    case "testando":
      return vista("Encontrado · testando a resposta", "mudo", { girando: true, podeVerificar: false });
    case "sem_acesso":
      return e.causa === "conta_sem_acesso"
        ? vista(`Conta sem acesso ao ${cli}`, "aviso", { ...(noApp ? { botao: b("ia-entrar", "Entrar com outra conta") } : {}), explica: `A conta entrou, mas não tem acesso ao ${cli} pela assinatura. Entre com outra conta ou, se for conta da empresa, peça ao administrador: o acesso depende do assento ou do papel que ele definiu para você.` })
        : vista("Não respondeu ao teste", "aviso", noApp ? { botao: b("ia-testar", "Testar de novo") } : {});
    case "no_limite": {
      const ate = e.ate ? ` · volta ${quandoRenova(e.ate, c.agora)}` : "";
      return vista(`Chegou ao limite da assinatura${ate}`, "aviso", { ...trocar, ...(outraPronta ? {} : { explica: `Enquanto isso, seus bots esperam. Conecte o ${PROVEDOR[outra].nome} e eles continuam por ele até o ${nome} voltar.` }) });
    }
    case "pronta": {
      if (c.onde === "onboarding" && teste === "testando") return vista("Encontrado · testando a resposta", "mudo", { girando: true, podeVerificar: false });
      if (teste && typeof teste === "object" && "causa" in teste) {
        return teste.causa === "conta_sem_acesso"
          ? vista(`Conta sem acesso ao ${cli}`, "aviso", { ...(noApp ? { botao: b("ia-entrar", "Entrar com outra conta") } : {}), explica: `A conta entrou, mas não tem acesso ao ${cli} pela assinatura. Entre com outra conta ou, se for conta da empresa, peça ao administrador: o acesso depende do assento ou do papel que ele definiu para você.` })
          : vista("Não respondeu ao teste", "aviso", noApp ? { botao: b("ia-testar", "Testar de novo") } : {});
      }
      const respondeu = teste !== null && typeof teste === "object" && "resposta" in teste;
      // No onboarding, o Continuar só libera com o teste: sem veredito ainda, a IA está achada, não "conectada".
      if (c.onde === "onboarding" && !respondeu) return vista(`Encontrado ${onde} · falta testar`, "mudo", noApp ? { botao: b("ia-testar", "Testar", false), ...trocar } : trocar);
      // NOD-9: pronta, mas um modelo pediu CLI mais novo — a espera (ou o que deu errado) vai no explica; o sucesso
      // ("atualizado para a X.") fica um dia. Depois de "subiu pouco" ou de uma falha, "Tentar de novo" e o terminal.
      const a = e.atualizacao;
      const aviso = a && (a.fase !== "sucesso" || c.agora - a.em < AVISO_SUCESSO_MS) ? fraseDaAtualizacao(a, cli) : null;
      const deNovo = noApp && a && (a.fase === "insuficiente" || (a.fase === "falhou" && a.motivo !== "configurado"))
        ? { botao: b("ia-atualizar", "Tentar de novo", false), terminal: terminalDaAtualizacao(ia, e) }
        : {};
      // "em uso"/"assume" fala de qual IA o BOT usa: mesma regra do chip (estadoParaOBot), não só o Mac (NOD-424).
      return vista(textoPronta(ia, c, Object.fromEntries(IAS_MAC.map((x) => [x, estadoParaOBot(x, porId.get(x), c.ui, c.agora)])) as Record<IaMac, EstadoNaTela>), "ok", { ...trocar, ...(aviso ? { explica: aviso } : {}), ...deNovo });
    }
  }
}

/** "0.159.0" vira "0.159"; "2.1.290" fica como está. */
const legivel = (v: string): string => v.replace(/^(\d+\.\d+)\.0$/, "$1");

// ---- a ajuda de cada passo ----------------------------------------------------------------------------------------------

/**
 * "Precisa de ajuda?" (exigência do Marlon em 09/10: "conferir o link, conferir que vai jogar o usuário na página correta,
 * ter um help"). Texto curto por passo e por IA, com UM link oficial conferido (a data e o que a página diz estão no PR
 * do plano). O link abre fora do nod (`target=_blank`, `rel=noopener`): na janela do app, o processo principal só deixa
 * sair para o navegador.
 */
export type AjudaDoPasso = { textos: readonly string[]; links: readonly { rotulo: string; url: string }[] };

/**
 * Conferidos em 2026-10-11 (WebFetch, uma página por vez; a frase que prova o assunto está no PR do plano). Os endereços
 * antigos da OpenAI (developers.openai.com/codex/…) redirecionam com 308 para learn.chatgpt.com, e o docs.claude.com,
 * com 301 para code.claude.com: aqui ficam os de chegada.
 */
export const LINKS_AJUDA = {
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  codexEntrar: "https://learn.chatgpt.com/docs/auth",
  codexAdmin: "https://learn.chatgpt.com/docs/enterprise/admin-setup",
  codexPlanos: "https://learn.chatgpt.com/docs/pricing",
  claudeCode: "https://code.claude.com/docs/en/setup",
  claudeEntrar: "https://code.claude.com/docs/en/authentication",
  claudePlanos: "https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan",
  claudeEquipe: "https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan",
} as const;

export const AJUDA_IA: Record<IaMac, Record<IdPasso, AjudaDoPasso>> = {
  "codex-cli": {
    instalar: {
      textos: ["O nod instala o Codex, o programa oficial da OpenAI que liga o ChatGPT aos seus bots. Ele fica numa pasta do nod e não mexe no resto do Mac.", "Leva menos de um minuto e precisa de internet."],
      links: [{ rotulo: "O Codex no site da OpenAI", url: LINKS_AJUDA.codex }],
    },
    entrar: {
      textos: ["Na página da OpenAI, entre com a conta do seu ChatGPT e digite o código acima. Depois volte aqui: o nod percebe sozinho.", "A página não aceitou o código? O login por código precisa estar ligado: na conta pessoal, nas configurações de segurança do ChatGPT; na conta da empresa, nas permissões do workspace, pelo administrador."],
      links: [{ rotulo: "Como entrar no Codex com o ChatGPT", url: LINKS_AJUDA.codexEntrar }, { rotulo: "O que o administrador libera", url: LINKS_AJUDA.codexAdmin }],
    },
    testar: {
      textos: ["O nod manda uma frase curta para o ChatGPT para ter certeza de que a sua conta responde. Gasta uma resposta curta da assinatura.", "Se não responder, confira se o seu plano do ChatGPT inclui o Codex. Na conta da empresa, o administrador precisa permitir o Codex no computador."],
      links: [{ rotulo: "Planos do ChatGPT que incluem o Codex", url: LINKS_AJUDA.codexPlanos }, { rotulo: "O que o administrador libera", url: LINKS_AJUDA.codexAdmin }],
    },
  },
  "claude-cli": {
    instalar: {
      textos: ["O nod instala o Claude Code, o programa oficial da Anthropic que liga o Claude aos seus bots. Ele fica numa pasta do nod e não mexe no resto do Mac.", "Leva menos de um minuto e precisa de internet."],
      links: [{ rotulo: "O Claude Code no site da Anthropic", url: LINKS_AJUDA.claudeCode }],
    },
    entrar: {
      textos: ["Na página da Anthropic, entre com a conta do seu plano do Claude (Pro, Max, Team ou Enterprise) e autorize.", "Se a página mostrar um código, copie e cole no campo acima.", "Conta da empresa? Entre com a conta para a qual o administrador te convidou. No Enterprise, o acesso ao Claude Code depende do assento ou do papel que ele definiu."],
      links: [{ rotulo: "Como entrar no Claude Code", url: LINKS_AJUDA.claudeEntrar }, { rotulo: "Claude Code nos planos Team e Enterprise", url: LINKS_AJUDA.claudeEquipe }],
    },
    testar: {
      textos: ["O nod manda uma frase curta para o Claude para ter certeza de que a sua conta responde. Gasta uma resposta curta da assinatura.", "O plano gratuito do Claude não inclui o Claude Code. No Enterprise, o acesso depende do assento ou do papel definido pelo administrador."],
      links: [{ rotulo: "Claude Code com o plano Pro ou Max", url: LINKS_AJUDA.claudePlanos }, { rotulo: "Claude Code nos planos Team e Enterprise", url: LINKS_AJUDA.claudeEquipe }],
    },
  },
};

// ---- desenho ------------------------------------------------------------------------------------------------------------

const svg = (d: string, t = 14, largura = 2): string => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${largura}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONE_IA = {
  certo: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  aviso: svg('<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.01"/>', 14, 1.8),
  verificar: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>', 16, 1.8),
  alca: '<svg width="10" height="14" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.4"/><circle cx="8.5" cy="3" r="1.4"/><circle cx="3.5" cy="8" r="1.4"/><circle cx="8.5" cy="8" r="1.4"/><circle cx="3.5" cy="13" r="1.4"/><circle cx="8.5" cy="13" r="1.4"/></svg>',
  abrir: svg('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>', 12, 2),
  pessoa: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.6 7-5.6s6.1 2 7 5.6"/>', 12, 1.8),
};
const GIRA = '<span class="ob-gira grande" aria-hidden="true"></span>';

export const logoDaIa = (ia: IaMac, classe = "ob-logo"): string => `<span class="${classe}" aria-hidden="true">${LOGOS_IA[PROVEDOR[ia].logo]}</span>`;

/** A pilha de logos redondos (título de Provedores de IA, item do menu e da navegação de Seu espaço). */
export function pilhaDeAvatares(mini = false): string {
  return `<span class="prov-pilha${mini ? " prov-mini" : ""}" aria-hidden="true">${IAS_MAC.map((ia) => `<span class="prov-av">${LOGOS_IA[PROVEDOR[ia].logo]}</span>`).join("")}</span>`;
}

function htmlPasso(v: VistaIa, p: PassoIa, n: number, ui: UiIas): string {
  const marca = p.marca === "feito"
    ? `<span class="ia-passo-marca feito">${ICONE_IA.certo}<span class="sr-only">Feito:</span></span>`
    : p.marca === "erro"
      ? '<span class="ia-passo-marca falha" aria-hidden="true">!</span>'
      : p.marca === "girando"
        ? '<span class="ia-passo-marca"><span class="ob-gira" role="img" aria-label="Em andamento"></span></span>'
        : `<span class="ia-passo-marca${p.marca === "ativo" ? " ativo" : ""}" aria-hidden="true">${n}</span>`;
  const empresa = PROVEDOR[v.ia].empresa;
  const partes: string[] = [`<b>${esc(p.titulo)}</b>`];
  if (p.contaAtual) partes.push(`<span class="ia-conta-atual">Agora: <b>${esc(p.contaAtual)}</b> · continua valendo se você cancelar</span>`);
  if (p.trocou) {
    partes.push(p.trocou.antes === p.trocou.agora
      ? `<span class="ia-trocou">A conta continua a mesma: <b>${esc(p.trocou.agora)}</b>.</span>`
      : `<span class="ia-trocou">Agora com <b>${esc(p.trocou.agora)}</b>.${p.trocou.antes ? ` Antes era ${esc(p.trocou.antes)}.` : ""}</span>`);
  }
  if (p.texto) partes.push(`<span class="${p.marca === "erro" ? "ia-erro-txt" : ""}">${esc(p.texto)}</span>`);
  if (p.log) partes.push(`<span class="ia-log">${esc(p.log)}</span>`);
  if (p.codigo) partes.push(`<div class="ia-codigo"><code>${esc(p.codigo)}</code><button type="button" class="ob-link" data-act="ia-copiar-codigo" data-ia="${v.ia}" data-texto="${esc(p.codigo)}" ${VIVO}>${ui.copiado === v.ia ? ROTULO_COPIADO : "Copiar"}</button></div>`);
  if (p.dica) partes.push(`<div class="ia-troca-dica">${ICONE_IA.aviso}<p>${esc(p.dica)}</p></div>`);
  if (p.abrir || p.esperando) {
    const abrir = p.abrir ? `<button type="button" class="ob-link" data-act="ia-abrir-link" data-ia="${v.ia}">Abrir a página da ${esc(empresa)}${ICONE_IA.abrir}</button>` : "";
    const esperando = p.esperando ? `<span class="ia-esperando"><span class="ob-gira" aria-hidden="true"></span>${esc(p.esperando)}</span>` : "";
    partes.push(`<div class="ia-acoes">${abrir}${esperando}</div>`);
  }
  if (p.colar) {
    const valor = ui.codigo[v.ia] ?? "";
    partes.push(`<form class="ia-colar" data-form="ia-colar-codigo" data-ia="${v.ia}"><input type="text" name="codigo" value="${esc(valor)}" autocomplete="off" spellcheck="false" placeholder="Cole aqui o código que a ${esc(empresa)} mostrou" aria-label="Código da ${esc(empresa)}" data-ia-codigo="${v.ia}" /><button type="submit" class="ob-pilula contorno">Confirmar</button></form>`);
  }
  if (p.acoes.length) partes.push(`<div class="ia-acoes">${p.acoes.map((a) => `<button type="button" class="${a.contorno ? "ob-pilula contorno" : "ob-link"}" data-act="${a.act}" data-ia="${v.ia}">${esc(a.rotulo)}</button>`).join("")}</div>`);
  if (p.detalhe) partes.push(`<span class="ia-log ia-detalhe">${esc(p.detalhe)}</span>`);
  if (p.marca === "ativo" || p.marca === "girando" || p.marca === "erro") {
    const chave = `${v.ia}:${p.id}`;
    const aberta = ui.ajuda === chave;
    const ajuda = AJUDA_IA[v.ia][p.id];
    partes.push(`<button type="button" class="ia-ajuda-link" data-act="ia-ajuda" data-ia="${v.ia}" data-passo="${p.id}" aria-expanded="${aberta}">Precisa de ajuda?</button>`);
    if (aberta) {
      const link = ajuda.links.length ? `<span class="ia-ajuda-links">${ajuda.links.map((l) => `<a class="ob-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.rotulo)}${ICONE_IA.abrir}</a>`).join("")}</span>` : "";
      partes.push(`<div class="ia-ajuda">${ajuda.textos.map((t) => `<p>${esc(t)}</p>`).join("")}${link}</div>`);
    }
  }
  const classe = `ia-passo${p.marca === "depois" ? " depois" : ""}`;
  return `<li class="${classe}"${p.marca === "ativo" || p.marca === "girando" ? ' aria-current="step"' : ""}>${marca}<div class="ia-passo-txt">${partes.join("")}</div></li>`;
}

/**
 * O cartão: a linha (logo, nome, estado, um botão, o ícone de verificar que aparece no hover) e, embaixo, o fluxo, a
 * explicação e a nota. `arrastar` = a alça e a posição da ordem (Provedores de IA).
 */
export function renderCartaoIa(v: VistaIa, ui: UiIas, opcoes: { arrastar?: { pos: number }; verificar?: boolean } = {}): string {
  const marca = v.tom === "ok" ? ICONE_IA.certo : v.tom === "aviso" ? ICONE_IA.aviso : "";
  const classeEstado = v.tom === "mudo" ? "" : ` class="${v.tom}"`;
  const alca = opcoes.arrastar ? `${alcaDaIa(v)}<span class="prov-pos" aria-hidden="true">${opcoes.arrastar.pos}</span>` : "";
  const conta = v.conta ? `<span class="ia-conta" title="${esc(v.conta)}">${ICONE_IA.pessoa}<span class="ia-conta-txt"><span class="sr-only">Conta: </span>${esc(v.conta)}</span></span>` : "";
  const linha = `<div class="ia-linha">${alca}${logoDaIa(v.ia)}<div class="ob-ia-txt"><b>${esc(v.nome)}</b><span${classeEstado} role="status">${marca}${esc(v.texto)}</span>${conta}</div>${acoesDaIa(v, ui, opcoes)}</div>`;
  return linha + abaixoDaIa(v, ui);
}

/** A alça de arrastar (ordem-arrastavel.ts: arraste ou setas para cima e para baixo). */
export function alcaDaIa(v: VistaIa): string {
  return `<button type="button" class="prov-alca" data-alca-ordem aria-label="Mover o ${esc(v.nome)} na ordem (setas para cima e para baixo)">${ICONE_IA.alca}</button>`;
}

/** Os botões à direita da IA: o giro, Trocar conta, a ação do estado e o Verificar. */
export function acoesDaIa(v: VistaIa, ui: UiIas, opcoes: { verificar?: boolean } = {}): string {
  const gira = v.girando ? GIRA : "";
  const botao = v.botao ? `<button type="button" class="ob-pilula${v.botao.destaque ? "" : " contorno"}" data-act="${v.botao.act}" data-ia="${v.ia}"${v.botao.agora ? ' data-agora="1"' : ""}>${esc(v.botao.rotulo)}</button>` : "";
  const trocar = v.trocar ? `<button type="button" class="${v.trocar === "link" ? "ob-link ia-trocar" : "ob-pilula contorno"}" data-act="ia-trocar" data-ia="${v.ia}" aria-label="Trocar a conta do ${esc(v.nome)}">Trocar conta</button>` : "";
  const verificar = opcoes.verificar !== false && v.podeVerificar
    ? `<span class="ia-dica"><button type="button" class="ia-verificar${ui.verificando === v.ia ? " girando" : ""}" data-act="ia-verificar" data-ia="${v.ia}" aria-label="Verificar o ${esc(v.nome)} de novo">${ICONE_IA.verificar}</button><span class="ia-balao" role="tooltip">${esc(v.dica)}</span></span>`
    : "";
  return `${gira}${trocar}${botao}${verificar}`;
}

/** O que vem embaixo da linha da IA: o fluxo de passos, a explicação, a nota e o "Prefere o terminal?". */
export function abaixoDaIa(v: VistaIa, ui: UiIas): string {
  const fluxo = v.passos ? `<ol class="ia-fluxo" aria-live="polite">${v.passos.map((p, i) => htmlPasso(v, p, i + 1, ui)).join("")}</ol>` : "";
  const explica = v.explica ? `<div class="ia-explica" role="status"><p>${esc(v.explica)}</p></div>` : "";
  const nota = v.nota ? `<p class="ia-aviso-nota" role="status">${esc(v.nota)}</p>` : "";
  const terminal = v.terminal
    ? `<details class="ia-terminal"><summary class="cl-terminal-link">Prefere o terminal?</summary><p class="cl-terminal">${terminalDaqui()}: <code>${esc(v.terminal)}</code> <button type="button" class="ob-link" data-act="copiar-texto" data-texto="${esc(v.terminal)}">Copiar</button></p></details>`
    : "";
  return fluxo + explica + nota + terminal;
}
