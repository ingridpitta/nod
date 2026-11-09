import type { CamposEntrevista, EstadoOnboarding, IaNoMac, ModeloDeBot, TamanhoTime } from "../../src/contracts/onboarding.ts";
import type { IaDesktop, ResultadoIaDesktop, TesteDeIa } from "../../src/contracts/desktop.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { VIVO } from "../lib/copiar.ts";
import { COMANDO_ATUALIZAR_IA, desatualizado, versaoLegivel } from "./ia-fora.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";
import { IAS_MAC, logoDaIa, renderCartaoIa, vistaDaIa, type ContextoCartao, type UiIas } from "./cartao-ia.ts";
import { desteMac, nesteMac, terminalDaqui } from "../lib/plataforma-da-tela.ts";

/**
 * O onboarding por ligação na web (definido em 2026-10-04, ADR-077; protótipo "HiFiMac" da Proposta 2, aprovado em
 * 2026-10-03). Região própria `#onboarding`, por cima do app e da ligação, com as camadas de tela cheia ("olá", a IA dos
 * bots, "está te ligando") e o painel "O que você contou" ao lado da entrevista. A configuração guiada (os três cards)
 * entra como um bloco na conversa da guia, e o painel da direita ganha "O que você contou" e "Montado até agora".
 *
 * Aqui só as funções de desenho, puras e sem DOM (tests/unit/web/onboarding.test.ts); o controlador que liga o
 * servidor, a ligação e os timers mora em web/telas/onboarding-controle.ts.
 *
 * definido em 2026-10-05 (protótipos OnbTestando, OnbSemIA, OnbConectando, OnbConectada e OnbChamando): a etapa "A IA
 * dos seus bots" passa a mostrar o TESTE de verdade de cada IA — as decisões e as telas estão na seção 2; o que a
 * tela guarda do teste e faz sozinha mora em web/telas/onboarding-teste.ts.
 */

/** O que a tela mostra agora: as etapas do servidor mais a abertura local ("olá" ainda não passou). */
/** "computador": a tela "Este computador" da jornada A (ADA-242, web/telas/este-computador.ts), só com NOD_ONBOARDING_TEXTO. */
export type FaseTela = "ola" | "computador" | "executor" | "chamando" | "entrevista" | "configurando" | "fim";

export type EstadoTelaOnboarding = {
  dados: EstadoOnboarding;
  fase: FaseTela;
  /** A busca do Claude Code e do Codex ainda gira (os primeiros 2 s da etapa, como no protótipo). */
  procurando: boolean;
  /** O card de IA clicado: o login abriu no navegador e o app sonda. */
  iaEntrando: IaDesktop | null;
  /** Nota sob os cards (o que fazer fora do app, ou o que falhou). */
  notaIa: string | null;
  /** O teste de verdade das IAs deste Mac; null = sem teste (navegador comum ou app antigo): a tela de sempre. */
  teste: TesteNaTela | null;
  /** O clique em Atender ou em "Configurar sem voz" já saiu. */
  atendendo: boolean;
  /** A ligação desta tela está aberta (a pílula fica no alto durante a configuração). */
  emLigacao: boolean;
  /** O app do modelo está com o login aberto no navegador. */
  appConectando: boolean;
  /** Um clique de card em andamento (o botão fica ocupado). */
  ocupado: boolean;
  /**
   * As IAs do app do Mac (`nodDesktop.ias`, rc.7 em diante; web/telas/cartao-ia.ts). Com a ponte, a etapa "A IA dos seus
   * bots" usa o mesmo cartão de Provedores de IA (tela 5 do plano das IAs); sem ela, as telas de 2026-10-05.
   */
  iasMac?: UiIas | null;
};

// ---- textos -------------------------------------------------------------------------------------------------------------
export const TEXTO_VOZ_CURTO = "Sua fala é transcrita pelo Google, nos EUA; nada é gravado";

const ROTULO_TAMANHO: Record<TamanhoTime, string> = { so_eu: "Só você", "2_10": "2 a 10", "11_50": "11 a 50", "51_mais": "Mais de 50" };

/** As linhas de "O que você contou" (Nome / Conheceu por / Quer / Time), só as já respondidas. */
export function linhasContou(c: CamposEntrevista): { rotulo: string; valor: string }[] {
  const linhas: { rotulo: string; valor: string | null }[] = [
    { rotulo: "Nome", valor: c.apelido },
    { rotulo: "Conheceu por", valor: c.comoConheceu },
    { rotulo: "Quer", valor: c.objetivo },
    { rotulo: "Time", valor: c.tamanhoTime ? ROTULO_TAMANHO[c.tamanhoTime] : null },
  ];
  return linhas.filter((l): l is { rotulo: string; valor: string } => !!l.valor);
}

/** "Montado até agora": o bot, o app e a rotina, na ordem em que nascem. */
export function linhasMontado(d: EstadoOnboarding): string[] {
  const linhas: string[] = [];
  if (d.bot) linhas.push(`Bot ${d.bot.nome}`);
  if (d.appConectado) linhas.push(`${d.modelo.app.nome} conectado`);
  if (d.rotinaCriada) linhas.push(`Rotina: ${d.rotinaCriada.resumo.charAt(0).toLowerCase()}${d.rotinaCriada.resumo.slice(1)}`);
  return linhas;
}

export function textoTudoMontado(nomeGuia: string): string {
  return `Tudo montado. Quando quiser, é só chamar o ${nomeGuia} por aqui.`;
}

export function nomeDaGuia(d: EstadoOnboarding): string {
  // revisto em 2026-10-07 (ADR-081): a guia é o Nod, o bot fixo da pessoa.
  return d.guia?.nome ?? "Nod";
}

// ---- ícones -------------------------------------------------------------------------------------------------------------
const svg = (d: string, t = 24, largura = 1.8): string => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${largura}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONE = {
  semVoz: svg('<path d="M5 7h14M5 12h14M5 17h9"/>', 24, 1.7),
  atender: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 26),
  aviso: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 14, 2),
  certo: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14, 2.3),
  abrir: svg('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>', 12, 2),
};
const GIRA = '<span class="ob-gira" aria-hidden="true"></span>';
/** A roda que é o próprio estado (sem botão ao lado): tem nome para o leitor de tela. */
const girando = (rotulo: string, classe = "grande"): string => `<span class="ob-gira ${classe}" role="img" aria-label="${esc(rotulo)}"></span>`;

// ---- 1. "olá" -----------------------------------------------------------------------------------------------------------
/** A abertura: "olá" grande, que some sozinho em ~3,2 s; um clique pula. Nada toca antes de um clique. */
export function htmlOla(): string {
  return `<button type="button" class="ob-ola" data-act="onboarding-pular-ola" aria-label="Pular abertura"><span>olá</span></button>`;
}

// ---- 2. a IA dos bots -----------------------------------------------------------------------------------------------------
type IdLogo = keyof typeof LOGOS_IA;
type ProvedorIa = { id: IdLogo; nome: string; ia: IaDesktop | null };
const CARDS_IA: readonly ProvedorIa[] = [
  { id: "claude", nome: "Claude", ia: "claude-cli" },
  { id: "chatgpt", nome: "ChatGPT", ia: "codex-cli" },
  { id: "grok", nome: "Grok", ia: null },
  { id: "gemini", nome: "Gemini", ia: null },
];

/** definido em 2026-10-05: a IA da guia é a primeira pronta nesta ordem (Claude, depois ChatGPT). */
export const ORDEM_IAS: readonly IaDesktop[] = ["claude-cli", "codex-cli"];
/** Na tela o provedor tem o nome do produto que a pessoa assina; o CLI só aparece quando o assunto é instalar ou entrar. */
export const NOME_IA: Record<IaDesktop, string> = { "claude-cli": "Claude", "codex-cli": "ChatGPT" };
const NOME_CLI: Record<IaDesktop, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };
const LOGO_IA: Record<IaDesktop, IdLogo> = { "claude-cli": "claude", "codex-cli": "chatgpt" };
const EMPRESA_IA: Record<IaDesktop, string> = { "claude-cli": "Anthropic", "codex-cli": "OpenAI" };

/**
 * O teste de verdade das IAs (definido em 2026-10-05). Medido em produção nesse dia: uma conta do Claude Code LOGADA,
 * de uma organização que desativou o uso por assinatura, passava como pronta; a guia ligava, dizia a primeira frase e
 * ficava muda. Agora o app do Mac faz uma pergunta de uma frase a cada IA com login (`nodDesktop.iaTestar`) enquanto o
 * "olá" aparece, e a web só deixa a ligação tocar com uma IA que respondeu.
 */
export type Vereditos = Partial<Record<IaDesktop, TesteDeIa>>;

/** A conexão em três passos aberta para uma IA (instalar, entrar, teste de resposta). */
export type ConexaoIa = {
  ia: IaDesktop;
  /** A conta já estava logada ao começar ("Entrar com outra conta"): o servidor não tem como ver o login novo. */
  outraConta: boolean;
  /** O login do CLI no navegador: "aberto" = o Mac achou o CLI e abriu; "falhou" = o Mac não conseguiu abrir. */
  login: "nao" | "aberto" | "falhou";
  /** O que acabou de acontecer no passo ativo, no lugar do texto padrão dele. */
  nota: string | null;
};

export type TesteNaTela = {
  /** O teste do "olá" ainda não voltou. */
  rodando: boolean;
  /** O último veredito de cada IA, dito pelo Mac. */
  vereditos: Vereditos;
  /** As IAs com um teste avulso em curso ("Testar de novo", o terceiro passo da conexão). */
  testando: readonly IaDesktop[];
  conexao: ConexaoIa | null;
  /** "Continuar" já saiu: falta o servidor reconhecer a IA para a ligação tocar. */
  seguindo: boolean;
  /** O nome que foi na pergunta do teste (null = sem nome). */
  nome: string | null;
};

/**
 * A pergunta que o Mac faz no teste, para a tela mostrar. Cópia de `nomeParaOTeste` e `perguntaDoTeste` de
 * src/domain/conta-da-ia.ts: a web só faz `import type` de src/ e o contrato do teste não traz a pergunta.
 * tests/unit/web/onboarding.test.ts compara as duas cópias.
 */
const FORMA_NOME_TESTE = /^[\p{L}][\p{L} .'-]{0,39}$/u;
const PALAVRAS_NOME_MAX = 4;
export function nomeParaOTeste(v: string | null | undefined): string | null {
  // Só espaço comum é normalizado: quebra de linha e tabulação reprovam o nome; uma frase inteira não é nome.
  const nome = (v ?? "").trim().replace(/ +/g, " ");
  return FORMA_NOME_TESTE.test(nome) && nome.split(" ").length <= PALAVRAS_NOME_MAX ? nome : null;
}
export function perguntaDoTeste(nome: string | null): string {
  return nome ? `Diga oi para ${nome} em uma frase curta, em português. Só a frase.` : "Diga oi em uma frase curta, em português. Só a frase.";
}

/** Cópia de RESPOSTA_TESTE_IA_MAX (src/contracts/desktop.ts), pelo mesmo motivo; o teste compara. */
export const RESPOSTA_TESTE_MAX = 200;
const ESTADOS_DE_IA: readonly string[] = ["pronto", "nao_autenticado", "ausente"];
const CAUSAS: readonly string[] = ["conta_sem_acesso", "teste_falhou", "sonda_lenta"];

/** O que `iaTestar` devolveu, conferido: null quando não é uma lista de vereditos (a web segue então sem teste). */
export function lerTestesDeIa(bruto: unknown): TesteDeIa[] | null {
  if (!Array.isArray(bruto)) return null;
  const lidos: TesteDeIa[] = [];
  for (const item of bruto as unknown[]) {
    if (!item || typeof item !== "object") return null;
    const { ia, estado, causa, resposta } = item as Record<string, unknown>;
    const id = ORDEM_IAS.find((i) => i === ia);
    if (!id || typeof estado !== "string" || !ESTADOS_DE_IA.includes(estado)) return null;
    const texto = typeof resposta === "string" ? resposta.trim().slice(0, RESPOSTA_TESTE_MAX) : "";
    lidos.push({
      ia: id,
      estado: estado as TesteDeIa["estado"],
      ...(estado === "nao_autenticado" && typeof causa === "string" && CAUSAS.includes(causa) ? { causa: causa as NonNullable<TesteDeIa["causa"]> } : {}),
      ...(estado === "pronto" && texto ? { resposta: texto } : {}),
    });
  }
  return lidos;
}

/**
 * O teste vale para esta pessoa? Só dentro do app do Mac com `iaTestar`. definido em 2026-10-05: se o servidor está
 * pronto SEM nenhuma IA do Mac pronta, quem roda os bots é o executor do próprio servidor (o catcher, em
 * desenvolvimento) e a IA do Mac não entra na conta: nada a testar.
 */
export function testeSeAplica(temPonte: boolean, executor: EstadoOnboarding["executor"]): boolean {
  if (!temPonte) return false;
  return !(executor.pronto && !executor.ias.some((i) => i.estado === "pronto"));
}

/** A primeira IA que respondeu ao teste, na ordem do nod. */
export function iaQueRespondeu(vereditos: Vereditos): IaDesktop | null {
  return ORDEM_IAS.find((ia) => vereditos[ia]?.estado === "pronto") ?? null;
}

/** A IA com que a guia vai pensar: o veredito do teste manda; sem teste daquela IA, vale o que o servidor diz. */
export function iaDaLigacao(ias: readonly IaNoMac[], vereditos: Vereditos = {}): IaDesktop | null {
  return ORDEM_IAS.find((ia) => {
    const v = vereditos[ia];
    return v ? v.estado === "pronto" : ias.some((i) => i.id === ia && i.estado === "pronto");
  }) ?? null;
}

/**
 * O servidor já escolheria uma IA que respondeu? O Mac reanuncia o veredito por conta própria e a web pode ler o
 * servidor antes disso: enquanto a primeira IA "pronta" dele for uma que o teste reprovou (ou não testou), pedir a
 * ligação repetiria a guia muda de 2026-10-05.
 */
export function servidorDeAcordo(ias: readonly IaNoMac[], vereditos: Vereditos): boolean {
  const doServidor = iaDaLigacao(ias);
  return doServidor !== null && vereditos[doServidor]?.estado === "pronto";
}

/** Para onde a tela vai quando o "olá" acaba. "como_antes" = sem teste: o que o servidor diz do login decide. */
export type DestinoDoOla = "como_antes" | "ligar" | "testando" | "sem_ia";
export function destinoAoFimDoOla(teste: Pick<TesteNaTela, "rodando" | "vereditos"> | null): DestinoDoOla {
  if (!teste) return "como_antes";
  if (teste.rodando) return "testando";
  return iaQueRespondeu(teste.vereditos) ? "ligar" : "sem_ia";
}

/** A tela da etapa "A IA dos seus bots" quando há teste. */
export type TelaIa = "testando" | "sem_ia" | "conectando" | "conectada";
export function telaDaIa(t: Pick<TesteNaTela, "rodando" | "vereditos" | "conexao">): TelaIa {
  if (t.conexao) return "conectando";
  if (iaQueRespondeu(t.vereditos)) return "conectada";
  return t.rodando ? "testando" : "sem_ia";
}

/**
 * Hora de testar esta IA sozinha? O servidor diz "pronto" quando o app do Mac vê o LOGIN; quem diz que a conta
 * responde é o teste. Então: logada e nunca testada, testa. Com um veredito ruim, só testa de novo depois de o
 * servidor ter passado por "não pronto" (um login novo): sem isso o veredito e o servidor atrasado se alternariam
 * num teste atrás do outro, cada um pago pela assinatura da pessoa.
 */
export function deveTestar(inv: IaNoMac | undefined, veredito: TesteDeIa | undefined, vistoNaoPronto: boolean): boolean {
  if (inv?.estado !== "pronto") return false;
  if (!veredito) return true;
  if (veredito.estado === "pronto") return false;
  // NOD-178: "demorou para responder" não é veredito da conta; com o login de volta, testa de novo.
  if (veredito.causa === "sonda_lenta") return true;
  return vistoNaoPronto;
}

export type SituacaoIa = "testando" | "procurando" | "pronto" | "entrando" | "sonda_lenta" | "conta_sem_acesso" | "teste_falhou" | "falta_entrar" | "desatualizado" | "ausente";

/** Em que pé está uma IA, do que o servidor diz (instalação e login) e do que o teste disse (a conta responde?). */
export function situacaoDaIa(ia: IaDesktop, ias: readonly IaNoMac[], entrando: IaDesktop | null, teste: Pick<TesteNaTela, "rodando" | "vereditos" | "testando"> | null = null): { situacao: SituacaoIa; resposta: string | null } {
  const inv = ias.find((i) => i.id === ia);
  const v = teste?.vereditos[ia];
  const so = (situacao: SituacaoIa): { situacao: SituacaoIa; resposta: string | null } => ({ situacao, resposta: null });
  if (teste?.testando.includes(ia)) return so("testando");
  if (teste?.rodando && !v) return so(inv?.estado === "pronto" ? "testando" : "procurando");
  if (v?.estado === "pronto") return { situacao: "pronto", resposta: v.resposta ?? null };
  if (v?.causa) return so(v.causa === "cli_antigo" ? "desatualizado" : v.causa);
  // NOD-171: o CLI está no Mac, abaixo do piso testado. Quem sabe a versão é a sonda do servidor; o card diz "Atualizar",
  // nunca "não está neste Mac" nem "Instalar".
  if (desatualizado(inv)) return so("desatualizado");
  // Sem veredito de conta logada: da instalação e do login quem sabe é o servidor (a sonda do app), que é mais novo
  // que um veredito "falta entrar". Um "pronto" do servidor aqui é só login: com teste, ele ainda vai ser testado.
  const macDizInstalado = v !== undefined && v.estado !== "ausente";
  if (inv?.estado === "pronto") {
    if (!teste) return so("pronto");
    return so(v ? (macDizInstalado ? "falta_entrar" : "ausente") : "testando");
  }
  if (entrando === ia) return so("entrando");
  // NOD-178: o CLI que só demorou não pede "Instalar" nem "Entrar"; o app sonda de novo sozinho a cada 3 s.
  if (inv?.causa === "sonda_lenta") return so("sonda_lenta");
  // NOD-9: o CLI está sendo atualizado; volta sozinho quando terminar (nunca "Instalar").
  if (inv?.estado === "ausente" && inv.causa === "atualizando") return so("procurando");
  if (inv?.estado === "nao_autenticado") return so(inv.causa && inv.causa !== "cli_antigo" && inv.causa !== "atualizando" ? inv.causa : "falta_entrar");
  // Um CLI não some no meio do onboarding: se o Mac já o viu, o "ausente" do servidor é que está atrasado.
  return so(macDizInstalado ? "falta_entrar" : "ausente");
}

export type AcaoCardIa = "onboarding-ia-entrar" | "onboarding-ia-instalar" | "onboarding-ia-testar";
export type EstadoCardIa = {
  situacao: SituacaoIa;
  estado: string;
  /** "aviso" nunca vem só na cor: o card põe o ícone ao lado da frase. */
  tom: "mudo" | "ok" | "aviso";
  acao: string | null;
  act: AcaoCardIa | null;
  girando: boolean;
  /** O que a IA respondeu ao teste (só no pronto, quando veio). */
  resposta: string | null;
  /** O bloco de explicação sob o card (só na conta sem acesso), com o "Como liberar". */
  explicacao: string | null;
  /** NOD-171: o comando que atualiza o CLI desatualizado, com "Copiar" (só no `desatualizado`). */
  comando: string | null;
};

/** O estado de um card de IA: texto, tom, botão e o que o clique faz. */
export function estadoDoCardIa(ia: IaDesktop, ias: readonly IaNoMac[], entrando: IaDesktop | null, teste: Pick<TesteNaTela, "rodando" | "vereditos" | "testando"> | null = null): EstadoCardIa {
  const cli = NOME_CLI[ia];
  const { situacao, resposta } = situacaoDaIa(ia, ias, entrando, teste);
  const card = (estado: string, tom: EstadoCardIa["tom"], acao: string | null, act: AcaoCardIa | null, girando = false, explicacao: string | null = null, comando: string | null = null): EstadoCardIa => ({ situacao, estado, tom, acao, act, girando, resposta, explicacao, comando });
  switch (situacao) {
    case "pronto":
      return card(resposta ? "Conectado · respondeu ao teste" : "Conectado", "ok", "Conectado", null);
    case "entrando":
      return card("Termine no navegador…", "mudo", "Esperando", null, true);
    case "testando":
      return card(`${cli} encontrado · testando a resposta`, "mudo", null, null, true);
    case "sonda_lenta":
      return card(`${cli} demorou para responder · tentando de novo`, "mudo", "Esperando", null, true);
    case "procurando":
      return card(`Procurando o ${cli} ${nesteMac()}…`, "mudo", null, null, true);
    case "conta_sem_acesso":
      return card(`Conta sem acesso ao ${cli}`, "aviso", "Entrar com outra conta", "onboarding-ia-entrar", false, `A organização desta conta desativou o ${cli} por assinatura. Entre com uma conta pessoal ou peça ao administrador para liberar.`);
    case "teste_falhou":
      return card("Não respondeu ao teste", "aviso", "Testar de novo", "onboarding-ia-testar");
    case "falta_entrar":
      return card(`${cli} instalado · falta entrar`, "mudo", "Entrar", "onboarding-ia-entrar");
    case "desatualizado": {
      // NOD-171 (protótipo do Gil, estado 1): a versão instalada, a mínima e o comando. "Atualizar" abre a página
      // oficial (`iaInstalar`); quem atualiza é a pessoa, no Terminal, e a sonda percebe sozinha a versão nova.
      const d = desatualizado(ias.find((i) => i.id === ia));
      const versoes = d ? `${cli} ${d.versao} · o nod precisa da ${versaoLegivel(d.minima)} ou mais nova` : `${cli} desatualizado ${nesteMac()}`;
      return card(versoes, "aviso", "Atualizar", "onboarding-ia-instalar", false, null, COMANDO_ATUALIZAR_IA[ia]);
    }
    case "ausente":
      return card(`${cli} não está ${nesteMac()}`, "mudo", "Instalar e entrar", "onboarding-ia-instalar");
  }
}

/** "Como liberar" (a conta sem acesso): o que a pessoa pode fazer, sem link nenhum (o caminho é do fornecedor e muda). */
export function textoComoLiberar(ia: IaDesktop): { titulo: string; paragrafos: string[] } {
  const cli = NOME_CLI[ia];
  const nome = NOME_IA[ia];
  return {
    titulo: `Como liberar o ${cli}`,
    paragrafos: [
      `A conta que entrou no ${cli} ${desteMac()} é de uma organização que desativou o uso do ${cli} por assinatura. Por isso ela não respondeu ao teste.`,
      `Quem libera é o administrador dessa organização: peça a ele para ativar o ${cli} para a sua conta. Depois, teste de novo por aqui.`,
      `Se você tem uma conta pessoal do ${nome} com assinatura, use “Entrar com outra conta”.`,
    ],
  };
}

// ---- 2b. conectar em três passos --------------------------------------------------------------------------------------------
export type PassoConexao = {
  id: "instalar" | "entrar" | "testar";
  estado: "feito" | "ativo" | "depois";
  titulo: string;
  texto: string;
  /** `fora` = o clique abre algo fora do nod (o navegador): o link ganha a seta. */
  acoes: { act: "onboarding-ia-pagina" | "onboarding-ia-login" | "onboarding-ia-testar"; rotulo: string; fora?: true }[];
};

/** O CLI está neste Mac? O servidor disse, ou o Mac abriu o login dele agora (só abre se achou o binário). */
function cliInstalado(c: ConexaoIa, inv: IaNoMac | undefined): boolean {
  return c.outraConta || c.login === "aberto" || (inv !== undefined && (inv.estado !== "ausente" || inv.causa === "sonda_lenta"));
}

/**
 * Os três passos, do estado de verdade: o servidor diz se o CLI existe e se há login; o Mac diz se abriu o login e o
 * que o teste respondeu. definido em 2026-10-05: o nod NÃO instala nada (`iaInstalar` só abre a página oficial), então
 * o primeiro passo fica ativo até o CLI aparecer e o texto diz isso.
 */
export function passosDaConexao(c: ConexaoIa, inv: IaNoMac | undefined, testando: boolean): PassoConexao[] {
  const cli = NOME_CLI[c.ia];
  const nome = NOME_IA[c.ia];
  const instalado = cliInstalado(c, inv);
  const lento = instalado && !c.outraConta && c.login !== "aberto" && inv?.estado === "ausente" && inv.causa === "sonda_lenta";
  const instalar: PassoConexao = instalado
    ? lento
      // NOD-178: ausente só porque o CLI demorou a responder; não manda instalar o que provavelmente está lá.
      ? { id: "instalar", estado: "ativo", titulo: `Procurando o ${cli}`, texto: `O ${cli} demorou para responder; o Mac está carregado. Isto tenta de novo sozinho.`, acoes: [] }
      : { id: "instalar", estado: "feito", titulo: `${cli} instalado`, texto: `O ${cli} está ${nesteMac()}.`, acoes: [] }
    : {
        id: "instalar", estado: "ativo", titulo: `Instale o ${cli}`,
        texto: c.nota ?? `A página de instalação abriu. Quando o ${cli} estiver instalado ${nesteMac()}, isto continua sozinho.`,
        acoes: [{ act: "onboarding-ia-pagina", rotulo: "Abrir a página de novo", fora: true }, { act: "onboarding-ia-login", rotulo: "Conferir a instalação" }],
      };
  const tituloEntrar = c.outraConta ? `Entre com outra conta do ${nome}` : `Entre na sua conta do ${nome}`;
  let entrar: PassoConexao;
  if (!instalado || lento) entrar = { id: "entrar", estado: "depois", titulo: tituloEntrar, texto: `O login do ${cli} abre no navegador.`, acoes: [] };
  else if (testando) entrar = { id: "entrar", estado: "feito", titulo: "Login feito", texto: `No navegador, direto com a ${EMPRESA_IA[c.ia]}.`, acoes: [] };
  else {
    const padrao = c.login !== "aberto"
      ? "Abrindo o login no navegador…"
      : c.outraConta
        ? "A janela de login abriu no navegador. Quando terminar lá, volte e teste a conta nova."
        : "A janela de login abriu no navegador. Quando você terminar lá, isto continua sozinho.";
    entrar = { id: "entrar", estado: "ativo", titulo: tituloEntrar, texto: c.nota ?? padrao, acoes: [{ act: "onboarding-ia-login", rotulo: "Abrir o login de novo", fora: true }, { act: "onboarding-ia-testar", rotulo: "Testar agora" }] };
  }
  const testar: PassoConexao = testando
    ? { id: "testar", estado: "ativo", titulo: "Teste de resposta", texto: `O nod fez uma pergunta curta. Esperando o ${nome} responder.`, acoes: [] }
    : { id: "testar", estado: "depois", titulo: "Teste de resposta", texto: "O nod faz uma pergunta curta para confirmar que a conta responde.", acoes: [] };
  return [instalar, entrar, testar];
}

/**
 * O que a conexão faz sozinha a cada leitura do servidor: abrir o login quando o CLI aparece (o "isto continua
 * sozinho" do primeiro passo), ou sair quando o servidor passa a dizer que a conta entrou e foi reprovada (o card da
 * lista explica). O teste em si sai de `deveTestar`, que vale com ou sem conexão aberta.
 */
export function proximoDaConexao(c: ConexaoIa, inv: IaNoMac | undefined): "abrir_login" | "sair" | null {
  if (!c.outraConta && inv?.estado === "nao_autenticado" && inv.causa && inv.causa !== "sonda_lenta") return "sair";
  if (c.login === "nao" && inv !== undefined && inv.estado !== "ausente") return "abrir_login";
  return null;
}

/** A conexão depois de pedir o login ao Mac. */
export function conexaoDepoisDoLogin(c: ConexaoIa, r: ResultadoIaDesktop): ConexaoIa {
  if (r.ok) return { ...c, login: "aberto", nota: null };
  const nota = r.motivo === "nao_instalado" ? `O ${NOME_CLI[c.ia]} ainda não apareceu ${nesteMac()}.` : `Não deu para abrir o login do ${NOME_IA[c.ia]}. ${notaForaDoApp(c.ia, "entrar")}`;
  return { ...c, login: "falhou", nota };
}

/** A conexão depois de um veredito: null = fechou (respondeu, ou entrou e foi reprovada: a lista mostra o porquê). */
export function conexaoDepoisDoVeredito(c: ConexaoIa, v: TesteDeIa): ConexaoIa | null {
  // NOD-178: o CLI só demorou; a conexão continua aberta, sem "ainda não apareceu neste Mac".
  if (v.causa === "sonda_lenta") return c;
  if (v.estado === "pronto" || v.causa) return null;
  if (v.estado === "ausente") return { ...c, outraConta: false, login: "falhou", nota: `O ${NOME_CLI[c.ia]} ainda não apareceu ${nesteMac()}.` };
  return { ...c, nota: `Ainda não há uma conta do ${NOME_IA[c.ia]} ${nesteMac()}. Termine o login no navegador e teste de novo.` };
}

// ---- 2c. as telas da IA -----------------------------------------------------------------------------------------------------
type TelaExecutor = Pick<EstadoTelaOnboarding, "dados" | "procurando" | "iaEntrando" | "notaIa" | "teste" | "iasMac">;

/** A pergunta do nod e a resposta da IA (os três pontinhos enquanto ela não vem). */
function htmlProva(nome: string | null, nomeIa: string, resposta: string | null): string {
  const r = resposta === null ? '<span class="ob-pontos" role="img" aria-label="Esperando a resposta"><i></i><i></i><i></i></span>' : `<b>${esc(resposta)}</b>`;
  return `<div class="ob-prova"><div class="ob-prova-linha"><span class="ob-prova-quem">nod</span><span>${esc(perguntaDoTeste(nome))}</span></div><div class="ob-prova-linha"><span class="ob-prova-quem">${esc(nomeIa)}</span>${r}</div></div>`;
}

/**
 * NOD-171 (protótipo do Gil, estado 1): como atualizar o CLI desatualizado. "Atualizar" abre a página oficial; o comando
 * fica à mão com "Copiar". O nod não roda nada no Terminal.
 */
function htmlComandoDeAtualizar(ia: IaDesktop, comando: string): string {
  const cli = NOME_CLI[ia];
  return `<div class="ob-ia-explica ob-ia-atualizar"><p>“Atualizar” abre a página oficial do ${esc(cli)} no navegador. ${terminalDaqui()}, rode:</p><div class="ob-comando"><code>${esc(comando)}</code><button type="button" class="ob-link" data-act="onboarding-ia-copiar" data-texto="${esc(comando)}" ${VIVO}>Copiar</button></div><p>O nod percebe sozinho quando a versão nova estiver instalada.</p></div>`;
}

function htmlCardIa(p: ProvedorIa & { ia: IaDesktop }, s: EstadoCardIa, nome: string | null, opcoes: { menor?: boolean } = {}): string {
  // O "Conectado" sem a pílula verde ao lado leva o ícone: a frase não fica só na cor.
  const marca = s.tom === "aviso" ? ICONE.aviso : s.tom === "ok" && !s.acao ? ICONE.certo : "";
  const classeEstado = s.tom === "mudo" ? "" : ` class="${s.tom}"`;
  const lado = s.acao
    ? `<button type="button" class="ob-pilula${s.tom === "ok" ? " ok" : ""}${s.situacao === "desatualizado" ? " aviso" : ""}${opcoes.menor ? " contorno" : ""}"${s.act ? ` data-act="${s.act}" data-ia="${p.ia}"` : " disabled"}>${s.girando ? GIRA : ""}${esc(s.acao)}</button>`
    : s.girando ? girando(s.situacao === "procurando" ? "Procurando" : "Testando") : "";
  const prova = s.situacao === "testando" ? htmlProva(nome, p.nome, null) : s.resposta && !opcoes.menor ? htmlProva(nome, p.nome, s.resposta) : "";
  const explica = s.explicacao && !opcoes.menor
    ? `<div class="ob-ia-explica"><p>${esc(s.explicacao)}</p><button type="button" class="ob-link" data-act="onboarding-ia-como-liberar" data-ia="${p.ia}">Como liberar</button></div>`
    : s.comando && !opcoes.menor
      ? htmlComandoDeAtualizar(p.ia, s.comando)
      : "";
  return `<div class="ob-card-ia${s.tom === "aviso" && !opcoes.menor ? " aviso" : ""}${opcoes.menor ? " menor" : ""}"><div class="ob-ia-linha"><span class="ob-logo">${LOGOS_IA[p.id]}</span><div class="ob-ia-txt"><b>${esc(p.nome)}</b><span${classeEstado} role="status">${marca}${esc(s.estado)}</span></div>${lado}</div>${prova}${explica}</div>`;
}

const comIa = (p: ProvedorIa): p is ProvedorIa & { ia: IaDesktop } => p.ia !== null;
const cabecaIa = (titulo: string, texto: string): string => `<div class="ob-cabeca"><h1 tabindex="-1">${esc(titulo)}</h1><p>${esc(texto)}</p></div>`;
const SEM_SENHA = "O nod nunca vê sua senha nem sua chave.";
/** NOD-8 (definido em 2026-10-22): aponta para onde a IA se troca de fato; "Ajustes" não existe no menu. */
const DEPOIS_EM_AJUSTES = "Dá para trocar ou adicionar outra IA depois, em Seu espaço › Provedores de IA.";

/** "A IA dos seus bots" enquanto o teste roda e "Falta conectar uma IA" quando nenhuma respondeu. */
function htmlListaDeIas(e: TelaExecutor, t: TesteNaTela, tela: "testando" | "sem_ia"): string {
  const guia = nomeDaGuia(e.dados);
  const reprovada = ORDEM_IAS.some((ia) => { const causa = t.vereditos[ia]?.causa; return causa !== undefined && causa !== "sonda_lenta"; });
  const cabeca = tela === "testando"
    ? cabecaIa("A IA dos seus bots", `Seus bots trabalham com a conta que você já assina, aqui ${nesteMac()}. Estou testando cada uma com uma pergunta curta.`)
    : cabecaIa("Falta conectar uma IA", `${reprovada ? `Testei as IAs ${desteMac()} e nenhuma respondeu.` : `Não achei uma IA conectada ${nesteMac()}.`} Conecte uma e o ${guia} te liga em seguida.`);
  const cards = CARDS_IA.filter(comIa).map((p) => htmlCardIa(p, estadoDoCardIa(p.ia, e.dados.executor.ias, e.iaEntrando, t), t.nome)).join("");
  const breves = CARDS_IA.filter((p) => !comIa(p)).map((p) => `<div class="ob-breve" aria-disabled="true"><span class="ob-breve-logo">${LOGOS_IA[p.id]}</span><b>${esc(p.nome)}</b><span>Em breve</span></div>`).join("");
  const nota = e.notaIa ?? (tela === "testando" ? `${SEM_SENHA} O teste gasta uma resposta curta da sua assinatura.` : `${SEM_SENHA} ${DEPOIS_EM_AJUSTES}`);
  const titulo = tela === "testando" ? "A IA dos seus bots" : "Falta conectar uma IA";
  return `<section class="ob-tela ob-executor" aria-label="${titulo}">${cabeca}<div class="ob-cards-ia largo">${cards}<div class="ob-breves">${breves}</div></div><p class="ob-nota" role="status">${esc(nota)}</p></section>`;
}

/** "Conectando o {provedor}": os três passos, com o que é da pessoa e o que o nod faz sozinho. */
function htmlConectando(e: TelaExecutor, t: TesteNaTela, c: ConexaoIa): string {
  const nome = NOME_IA[c.ia];
  const passos = passosDaConexao(c, e.dados.executor.ias.find((i) => i.id === c.ia), t.testando.includes(c.ia));
  const itens = passos.map((p, i) => {
    const marca = p.estado === "feito"
      ? `<span class="ob-passo-marca feito">${ICONE.certo}<span class="sr-only">Feito:</span></span>`
      : p.estado === "ativo" ? girando("Em andamento", "passo") : `<span class="ob-passo-marca" aria-hidden="true">${i + 1}</span>`;
    const acoes = p.acoes.length
      ? `<div class="ob-passo-acoes">${p.acoes.map((a) => `<button type="button" class="ob-link" data-act="${a.act}" data-ia="${c.ia}">${esc(a.rotulo)}${a.fora ? ICONE.abrir : ""}</button>`).join("")}</div>`
      : "";
    return `<li class="ob-passo ${p.estado}"${p.estado === "ativo" ? ' aria-current="step"' : ""}>${marca}<div class="ob-passo-txt"><b>${esc(p.titulo)}</b><span>${esc(p.texto)}</span>${acoes}</div></li>`;
  }).join("");
  const comVoce = passos[0]?.estado === "feito" ? "O do meio é com você, no navegador." : "Os dois primeiros são com você.";
  const titulo = `Conectando o ${nome}`;
  return `<section class="ob-tela ob-executor" aria-label="${esc(titulo)}">${cabecaIa(titulo, `São três passos. ${comVoce}`)}
    <div class="ob-conexao"><div class="ob-ia-linha"><span class="ob-logo">${LOGOS_IA[LOGO_IA[c.ia]]}</span><div class="ob-ia-txt"><b>${esc(nome)}</b><span>Pelo ${esc(NOME_CLI[c.ia])}, com a sua conta do ${esc(nome)}</span></div><button type="button" class="ob-pilula contorno" data-act="onboarding-ia-cancelar">Cancelar</button></div>
    <ol class="ob-passos" aria-live="polite">${itens}</ol></div>
    <p class="ob-nota">${esc(`O nod nunca vê sua senha nem sua chave: o login acontece direto com a ${EMPRESA_IA[c.ia]}.`)}</p></section>`;
}

/** "Seus bots já têm uma IA": a pergunta e a resposta de verdade, o Continuar e o outro provedor como está. */
function htmlConectada(e: TelaExecutor, t: TesteNaTela, ia: IaDesktop): string {
  const guia = nomeDaGuia(e.dados);
  const nome = NOME_IA[ia];
  // Nesta tela o "Conectado" é a frase com o ícone, sem a pílula verde: o único botão cheio é o Continuar.
  const cards = CARDS_IA.filter(comIa).map((p) => {
    const s = estadoDoCardIa(p.ia, e.dados.executor.ias, e.iaEntrando, t);
    return { p, s: s.situacao === "pronto" ? { ...s, acao: null } : s };
  });
  const principal = cards.find((c) => c.p.ia === ia);
  const outros = cards.filter((c) => c.p.ia !== ia).map((c) => htmlCardIa(c.p, c.s, t.nome, { menor: true })).join("");
  const respondeu = principal?.s.resposta ? "respondeu ao teste" : "está conectado";
  const titulo = "Seus bots já têm uma IA";
  return `<section class="ob-tela ob-executor" aria-label="${titulo}">${cabecaIa(titulo, `O ${nome} ${respondeu} ${nesteMac()}. O ${guia} vai te ligar para montar o seu primeiro bot.`)}
    <div class="ob-cards-ia largo">${principal ? htmlCardIa(principal.p, principal.s, t.nome) : ""}${outros}</div>
    <div class="ob-seguir"><button type="button" class="ob-pilula grande" data-act="onboarding-ia-continuar"${t.seguindo ? " disabled" : ""}>${t.seguindo ? GIRA : ""}Continuar</button><p class="ob-nota" role="status">${esc(e.notaIa ?? DEPOIS_EM_AJUSTES)}</p></div></section>`;
}

/**
 * A etapa "A IA dos seus bots". Com teste (dentro do app do Mac): testando, "Falta conectar uma IA", os três passos ou
 * "Seus bots já têm uma IA". Sem teste (navegador comum ou app de antes de 2026-10-05): os quatro cards de sempre, com
 * o que o servidor diz de cada IA — inclusive a causa, quando outro Mac da pessoa já a testou.
 */
export function htmlExecutor(e: TelaExecutor): string {
  const t = e.teste;
  if (t && e.iasMac?.noApp) return htmlExecutorNoApp(e, t, e.iasMac);
  if (t) {
    const tela = telaDaIa(t);
    const pronta = iaQueRespondeu(t.vereditos);
    if (tela === "conectando" && t.conexao) return htmlConectando(e, t, t.conexao);
    if (tela === "conectada" && pronta) return htmlConectada(e, t, pronta);
    return htmlListaDeIas(e, t, tela === "testando" ? "testando" : "sem_ia");
  }
  const cabeca = `<div class="ob-cabeca"><h1>A IA dos seus bots</h1><p>Seus bots trabalham com a conta que você já assina, aqui ${nesteMac()}. O nod nunca vê sua senha nem sua chave.</p></div>`;
  if (e.procurando) return `<section class="ob-tela ob-executor" aria-label="A IA dos seus bots">${cabeca}<div class="ob-procurando" role="status">${GIRA}Procurando o Claude Code e o Codex ${nesteMac()}…</div><p class="ob-nota"></p></section>`;
  const cards = CARDS_IA.map((c) => {
    if (!comIa(c)) {
      return `<div class="ob-card-ia em-breve" aria-disabled="true"><div class="ob-ia-linha"><span class="ob-logo">${LOGOS_IA[c.id]}</span><div class="ob-ia-txt"><b>${esc(c.nome)}</b><span>Em breve</span></div></div></div>`;
    }
    return htmlCardIa(c, estadoDoCardIa(c.ia, e.dados.executor.ias, e.iaEntrando), null);
  }).join("");
  const nota = e.notaIa ?? "Dá para trocar ou adicionar outra depois, em Seu espaço › Provedores de IA.";
  return `<section class="ob-tela ob-executor" aria-label="A IA dos seus bots">${cabeca}<div class="ob-cards-ia">${cards}</div><p class="ob-nota" role="status">${esc(nota)}</p></section>`;
}

/**
 * Tela 5 do plano das IAs (protótipo Onboarding, 2026-10-09): dentro do app do Mac com a ponte `ias`, a etapa é a lista
 * de cartões de Provedores de IA. O app já procurou durante o "olá"; instalar, entrar e testar acontecem dentro do
 * cartão, em até três passos com "Precisa de ajuda?"; a falha fica no passo, em âmbar, com "Tentar de novo". O teste de
 * uma frase continua sendo o do onboarding (onboarding-teste.ts): é ele que diz quem respondeu e libera o Continuar.
 */
function htmlExecutorNoApp(e: TelaExecutor, t: TesteNaTela, ui: UiIas): string {
  const vereditos = Object.fromEntries(Object.entries(t.vereditos).map(([ia, v]) => [ia, { estado: v.estado, ...(v.causa ? { causa: v.causa } : {}), ...(v.resposta ? { resposta: v.resposta } : {}) }]));
  // O teste do "olá" ainda roda: a IA logada sem veredito está sendo testada.
  const testando = IAS_MAC.filter((ia) => t.testando.includes(ia) || (t.rodando && !t.vereditos[ia] && ui.estados[ia]?.estado === "pronta"));
  const c: ContextoCartao = { servidor: null, ui, agora: Date.now(), onde: "onboarding", vereditos, testandoNoOnboarding: testando };
  const prontas = ORDEM_IAS.filter((ia) => t.vereditos[ia]?.estado === "pronto");
  const procurando = IAS_MAC.every((ia) => !ui.estados[ia] || ui.estados[ia]?.estado === "procurando");
  const titulo = prontas.length ? "Seus bots já têm uma IA" : "A IA dos seus bots";
  const cabeca = cabecaIa(titulo, `Seus bots trabalham com a conta que você já assina, aqui ${nesteMac()}. O nod nunca vê sua senha.`);
  if (procurando) return `<section class="ob-tela ob-executor" aria-label="${titulo}">${cabeca}<div class="ob-procurando" role="status">${GIRA}Procurando o Claude e o ChatGPT ${nesteMac()}…</div><p class="ob-nota"></p></section>`;
  const cards = ORDEM_IAS.map((ia) => {
    const v = vistaDaIa(ia, c);
    return `<div class="ob-card-ia${v.passos ? " aberto" : ""}${v.tom === "aviso" ? " aviso" : ""}">${renderCartaoIa(v, ui, { verificar: false })}</div>`;
  }).join("");
  const [primeira, segunda] = prontas;
  const ordem = primeira && segunda
    ? `<div class="ordem-final"><span>Seus bots usam</span>${logoDaIa(primeira)}<b>${esc(NOME_IA[primeira])}</b><span>e, se ele parar,</span>${logoDaIa(segunda)}<b>${esc(NOME_IA[segunda])}</b></div>`
    : "";
  const rotulo = prontas.length === 1 && primeira ? `Continuar com o ${NOME_IA[primeira]}` : "Continuar";
  // NOD-209: enquanto a pessoa entra com a outra conta, a IA fica fora do Continuar (cancelar volta para a de agora).
  const trocando = IAS_MAC.find((ia) => ui.troca[ia]?.fase === "abrindo" || ui.troca[ia]?.fase === "entrando");
  const nota = e.notaIa ?? (trocando
    ? `Enquanto você troca, o ${NOME_IA[trocando]} fica de fora. Cancelar volta para a conta atual.`
    : prontas.length === 0
      ? "Conecte pelo menos uma IA para seus bots começarem."
      : prontas.length === 1 ? "Dica: conecte as duas. Se uma chegar ao limite, a outra assume. Dá para fazer depois em Provedores de IA." : "Dá para trocar a conta ou a ordem depois em Provedores de IA.");
  const desab = prontas.length === 0 || t.seguindo;
  return `<section class="ob-tela ob-executor" aria-label="${titulo}">${cabeca}<div class="ob-cards-ia largo">${cards}</div>
    <div class="ob-seguir">${ordem}<button type="button" class="ob-pilula grande" data-act="onboarding-ia-continuar"${desab ? " disabled" : ""}>${t.seguindo ? GIRA : ""}${esc(rotulo)}</button><p class="ob-nota" role="status">${esc(nota)}</p></div></section>`;
}

/** A orientação quando o clique não chega a um app do Mac (navegador comum ou app antigo). */
export function notaForaDoApp(ia: IaDesktop, acao: "entrar" | "instalar"): string {
  if (ia === "claude-cli") return acao === "entrar" ? `${terminalDaqui()}, rode “claude auth login” e entre na sua conta; o nod percebe sozinho.` : "Instale o Claude Code (claude.com/product/claude-code) e rode “claude auth login”; o nod percebe sozinho.";
  return acao === "entrar" ? `${terminalDaqui()}, rode “codex login” e entre na sua conta; o nod percebe sozinho.` : "Instale o Codex (developers.openai.com/codex/cli) e rode “codex login”; o nod percebe sozinho.";
}

// ---- 3. "está te ligando" --------------------------------------------------------------------------------------------------
export function htmlChamando(e: Pick<EstadoTelaOnboarding, "dados" | "atendendo" | "teste">): string {
  const nome = nomeDaGuia(e.dados);
  const guia = e.dados.guia;
  const mascote = guia ? iconeAgente(guia, "xxl") : "";
  const desab = e.atendendo ? " disabled" : "";
  // definido em 2026-10-05: a pessoa vê com qual conta dela a guia vai pensar (some quando quem roda é o servidor).
  const ia = iaDaLigacao(e.dados.executor.ias, e.teste?.vereditos);
  const pensa = ia ? `<p class="ob-pensa"><span class="ob-pensa-logo">${LOGOS_IA[LOGO_IA[ia]]}</span>${esc(nome)} vai pensar com o ${esc(NOME_IA[ia])} ${desteMac()}</p>` : "";
  return `<section class="ob-tela ob-chamando" aria-label="${esc(nome)} está te ligando">
    <div class="ob-toque"><span class="ob-anel"></span><span class="ob-anel b"></span><div class="ob-toque-mascote">${mascote}</div></div>
    <div class="ob-quem"><b>${esc(nome)}</b><span>está te ligando</span></div>
    ${pensa}
    <div class="ob-botoes-ligacao">
      <div class="ob-botao-ligacao"><button type="button" class="ob-redondo" data-act="onboarding-sem-voz"${desab}>${ICONE.semVoz}</button><span>Configurar sem voz</span></div>
      <div class="ob-botao-ligacao"><button type="button" class="ob-redondo atender" data-act="onboarding-atender"${desab} aria-describedby="ob-aviso-voz">${ICONE.atender}</button><span>Atender</span>
        <p class="ob-aviso-voz" id="ob-aviso-voz">${esc(TEXTO_VOZ_CURTO)} · <button type="button" class="ob-link" data-act="onboarding-saber-mais">saber mais</button></p></div>
    </div>
  </section>`;
}

// ---- 4. painel da entrevista -------------------------------------------------------------------------------------------------
function blocoContou(c: CamposEntrevista): string {
  const linhas = linhasContou(c);
  const corpo = linhas.length
    ? linhas.map((l) => `<div class="ob-linha"><span>${esc(l.rotulo)}</span><b>${esc(l.valor)}</b></div>`).join("")
    : '<p class="ob-vazio">Aparece aqui durante a ligação.</p>';
  return `<div class="ob-bloco"><h3>O que você contou</h3>${corpo}</div>`;
}

/** Ao lado da tela cheia da ligação, durante a entrevista (por cima, à direita, sem cobrir os controles). */
export function htmlPainelEntrevista(d: EstadoOnboarding): string {
  return `<aside class="ob-painel-entrevista" aria-label="O que você contou" aria-live="polite">${blocoContou(d.campos)}</aside>`;
}

/** No painel da guia (detalhes) durante a configuração: "O que você contou" e "Montado até agora". */
export function secaoOnboardingDetalhes(d: EstadoOnboarding): string {
  const montado = linhasMontado(d);
  const lista = montado.length
    ? montado.map((t) => `<div class="ob-montado"><span class="ob-check" aria-hidden="true">✓</span>${esc(t)}</div>`).join("")
    : '<p class="ob-vazio">Nada ainda.</p>';
  return `<section class="gv-secao ob-detalhes">${blocoContou(d.campos)}<div class="ob-bloco"><h3>Montado até agora</h3>${lista}</div></section>`;
}

// ---- 5. configuração guiada ------------------------------------------------------------------------------------------------
function cardBot(d: EstadoOnboarding, ocupado: boolean): string {
  const p = d.pendentes.bot;
  const m = d.modelo;
  const nome = p?.nome ?? m.nome;
  const descricao = p?.descricao ?? m.descricao;
  const mascote = iconeAgente({ nome, forma: p?.forma ?? m.forma, cor: p?.cor ?? m.cor }, "lg");
  return `<form class="ob-card" data-form="onboarding-bot"${p ? ` data-decisao-bot="${esc(p.decisaoId)}"` : ""}>
    <div class="ob-card-cab">${mascote}<div><span class="ob-sobre">Novo bot · preenchido com o que você contou</span><b class="ob-titulo">${esc(nome)}</b></div></div>
    <label class="ob-campo">Nome<input name="nome" id="ob-bot-nome" maxlength="60" value="${esc(nome)}" autocomplete="off" required /></label>
    <label class="ob-campo">O que ele faz<textarea name="descricao" id="ob-bot-descricao" rows="3" maxlength="600">${esc(descricao)}</textarea></label>
    <div class="ob-card-acoes">${p ? botao("onboarding-recusar-bot", "Agora não", { id: p.decisaoId, classe: "ob-secundario" }) : ""}<button type="submit" class="ob-pilula"${ocupado ? " disabled" : ""}>${ocupado ? GIRA : ""}Criar bot</button></div>
  </form>`;
}

function marcaApp(m: ModeloDeBot, grande = true): string {
  // A cor do app vem do servidor (marca de terceiros): única cor fora dos tokens neste card.
  return `<span class="ob-app${grande ? "" : " sm"}" style="background:${esc(m.app.cor)}" aria-hidden="true">${esc(m.app.letra)}</span>`;
}

function cardApp(d: EstadoOnboarding, e: Pick<EstadoTelaOnboarding, "appConectando" | "ocupado">): string {
  const m = d.modelo;
  const bot = d.bot?.nome ?? m.nome;
  const pode = m.pode.map((t) => `<li><span class="ob-sim" aria-hidden="true">✓</span>${esc(t)}</li>`).join("");
  const nao = `<li><span class="ob-nao" aria-hidden="true">×</span>${esc(m.nao)}</li>`;
  const pendente = d.pendentes.acesso;
  let acao: string;
  if (d.appConectado) acao = '<span class="ob-conectado">Conectado</span>';
  else if (pendente && !pendente.conectar) acao = `<button type="button" class="ob-pilula" data-act="onboarding-permitir-app" data-id="${esc(pendente.decisaoId)}"${e.ocupado ? " disabled" : ""}>Permitir</button>`;
  else acao = `<button type="button" class="ob-pilula" data-act="onboarding-conectar-app" data-slug="${esc(m.app.slug)}"${e.appConectando || e.ocupado ? " disabled" : ""}>${e.appConectando ? `${GIRA}Esperando o navegador` : "Entrar e conectar"}</button>`;
  return `<div class="ob-card">
    <div class="ob-card-cab">${marcaApp(m)}<div><span class="ob-sobre">Conectar para o ${esc(bot)}</span><b class="ob-titulo">${esc(m.app.nome)}</b></div></div>
    <ul class="ob-permissoes">${pode}${nao}</ul>
    <div class="ob-card-acoes">${acao}</div>
  </div>`;
}

function cardRotina(d: EstadoOnboarding, ocupado: boolean): string {
  const m = d.modelo;
  const bot = d.bot?.nome ?? m.nome;
  const pendente = d.pendentes.rotina;
  const proposta = pendente
    ? `<div class="ob-rotina proposta"><span class="ob-radio on" aria-hidden="true"></span><span class="ob-oque">${esc(pendente.resumo)}</span>${botao("onboarding-criar-rotina-proposta", "Criar rotina", { id: pendente.decisaoId, classe: "ob-pilula sm" })}</div>`
    : "";
  const opcoes = m.rotinas.map((r, i) => `<button type="button" class="ob-rotina" data-act="onboarding-escolher-rotina" data-indice="${i}"${ocupado ? " disabled" : ""}><span class="ob-radio" aria-hidden="true"></span><span class="ob-oque">${esc(r.oque)}</span><span class="ob-quando">${esc(r.quando)}</span></button>`).join("");
  return `<div class="ob-card ob-card-rotina"><span class="ob-sobre ob-sobre-lista">Rotina do ${esc(bot)}</span>${proposta}${opcoes}</div>`;
}

/**
 * O bloco da configuração guiada na conversa da guia: a fala de abertura e o card do passo (um por vez); no fim,
 * "Tudo montado" e "Ver o onboarding de novo".
 */
export function htmlGuia(e: EstadoTelaOnboarding): string {
  const d = e.dados;
  const nome = nomeDaGuia(d);
  const apelido = d.campos.apelido;
  const abertura = e.emLigacao
    ? `Oi, ${apelido ?? "tudo bem"}. Seguimos na ligação; eu vou montando tudo aqui enquanto a gente conversa.`
    : `Oi${apelido ? `, ${apelido}` : ""}. Vamos montar o seu primeiro bot: são três passos rápidos.`;
  const balao = `<div class="ob-balao">${esc(abertura)}</div>`;
  if (e.fase === "fim" || d.passo === "fim") {
    return `<section class="ob-guia" aria-label="Configuração inicial">${balao}<div class="ob-fim" role="status">${esc(textoTudoMontado(nome))}<button type="button" class="ob-link" data-act="onboarding-de-novo">Ver o onboarding de novo</button></div></section>`;
  }
  const card = d.passo === "bot" ? cardBot(d, e.ocupado) : d.passo === "app" ? cardApp(d, e) : cardRotina(d, e.ocupado);
  return `<section class="ob-guia" aria-label="Configuração inicial">${balao}${card}</section>`;
}

/** A camada de tela cheia de cada fase (vazia na entrevista e na configuração: aí mandam a ligação e a conversa). */
export function htmlCamada(e: EstadoTelaOnboarding, ligacaoCheia: boolean): string {
  switch (e.fase) {
    case "ola":
      return htmlOla();
    case "executor":
      return htmlExecutor(e);
    case "chamando":
      return htmlChamando(e);
    case "entrevista":
      return ligacaoCheia ? htmlPainelEntrevista(e.dados) : "";
    default:
      return "";
  }
}
