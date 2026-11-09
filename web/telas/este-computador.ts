import type { IaDesktop, NodDesktop } from "../../src/contracts/desktop.ts";
import type { EstadoIa } from "../../src/contracts/estado-ia.ts";
import type { IaNoMac } from "../../src/contracts/onboarding.ts";
import { esc } from "../lib/escape.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";

/**
 * ADA-242 (spec `docs/specs/onboarding-jornada-a.md` §3, protótipo `prancha-a.html` 2a–2g; ADR-157 §4): a tela "Este
 * computador", uma por máquina, com o que o app detectou. Claude é a linha principal; ChatGPT a segunda, com o mesmo
 * "Instalar e entrar". "Pular por agora" leva ao app sem IA (jornada C). Sem "Outras IAs" aqui (fica no card de conexão).
 *
 * A fonte é o estado único da IA (`nodDesktop.ias`, Mac) ou, sem essa ponte (Windows, que tem só iaEntrar/iaInstalar),
 * o inventário do motor que o servidor manda no onboarding (`executor.ias`). O "já vi" é do app, por máquina
 * (`nodDesktop.esteComputador`); a web comum (sem app) não mostra a tela.
 *
 * Aqui o desenho é puro (testes em tests/unit/web/este-computador.test.ts); o controlador fica no fim do arquivo.
 */
export type TelaComputador = "procurando" | "instalando" | "2a" | "2b" | "2c" | "2d" | "2e" | "2f" | "2g";

export const IAS_COMPUTADOR: readonly IaDesktop[] = ["claude-cli", "codex-cli"];
const NOME: Record<IaDesktop, string> = { "claude-cli": "Claude", "codex-cli": "ChatGPT" };
const LOGO: Record<IaDesktop, string> = { "claude-cli": LOGOS_IA.claude, "codex-cli": LOGOS_IA.chatgpt };
/** O login que passou disso sem terminar vira 2f (o campo do código só aparece aí). Alinhado aos 2 min do app do Mac. */
export const LOGIN_DEMOROU_MS = 2 * 60_000;

/** O que a tela sabe de uma IA: o estado do app (Mac), o do inventário (Windows) e o clique local em curso. */
export type FonteIa = { mac?: EstadoIa; inventario?: IaNoMac; aguardandoDesde?: number | null; falhouInstalar?: boolean };

/** A tela de UMA IA. Pura: os 7 estados do protótipo, mais o "procurando" e o "instalando" de passagem. */
export function telaDaIa(f: FonteIa, agora: number): TelaComputador {
  const demorou = f.aguardandoDesde != null && agora - f.aguardandoDesde >= LOGIN_DEMOROU_MS;
  const m = f.mac;
  if (m) {
    if (m.instalacao?.fase === "falhou" && (m.estado === "nao_instalada" || m.estado === "sem_node")) return "2e";
    switch (m.estado) {
      case "pronta": case "no_limite": return "2a";
      case "sem_acesso": return "2g";
      case "instalando": case "atualizando": return "instalando";
      // O CLI abaixo do piso não roda turno nenhum (AGENTS.md, piso de versão): só entrar não resolve, a saída é atualizar.
      case "nao_instalada": case "sem_node": case "desatualizada": return f.falhouInstalar ? "2e" : "2c";
      case "entrando": case "testando":
        return m.login?.verificarDeNovo || (m.estado === "entrando" && demorou) ? "2f" : "2d";
      case "falta_entrar": case "config_invalida": {
        const fase = m.login?.fase;
        if (fase === "expirou" || (fase === "falhou" && m.login?.causa === "nao_confirmou")) return "2f";
        return f.aguardandoDesde != null ? (demorou ? "2f" : "2d") : "2b";
      }
      default: return "procurando";
    }
  }
  const i = f.inventario;
  if (f.falhouInstalar) return "2e";
  if (!i) return f.aguardandoDesde != null ? (demorou ? "2f" : "2d") : "procurando";
  if (i.estado === "pronto") return "2a";
  if (i.causa === "conta_sem_acesso") return "2g";
  if (f.aguardandoDesde != null) return demorou ? "2f" : "2d";
  return i.estado === "ausente" || i.causa === "cli_antigo" ? "2c" : "2b";
}

/** O CLI está aqui, mas abaixo do piso de versão: o 2c vira "Atualizar e entrar". */
const desatualizado = (f: FonteIa | undefined): boolean => f?.mac?.estado === "desatualizada" || (!f?.mac && f?.inventario?.causa === "cli_antigo");

/**
 * A tela inteira segue a IA principal: a que está pronta (2a), senão a que a pessoa está conectando, senão o Claude.
 * `estadoDaTela` é o que a spec chama de "uma função pura sobre ESTADOS_IA" (2a…2g).
 */
export function estadoDaTela(fontes: Partial<Record<IaDesktop, FonteIa>>, agora: number, emFoco: IaDesktop | null = null): { tela: TelaComputador; principal: IaDesktop; linhas: Record<IaDesktop, TelaComputador> } {
  const linhas = Object.fromEntries(IAS_COMPUTADOR.map((ia) => [ia, telaDaIa(fontes[ia] ?? {}, agora)])) as Record<IaDesktop, TelaComputador>;
  const pronta = IAS_COMPUTADOR.find((ia) => linhas[ia] === "2a");
  const principal = pronta ?? emFoco ?? "claude-cli";
  return { tela: linhas[principal], principal, linhas };
}

const CABECA: Record<TelaComputador, (ia: string) => [string, string]> = {
  procurando: () => ["Procurando as IAs deste computador…", "Leva só alguns segundos."],
  instalando: (ia) => [`Instalando o ${ia}…`, "O nod instala a parte que trabalha neste computador. Depois, o login é no site deles."],
  "2a": (ia) => [`O ${ia} já está aqui. Seus bots podem começar.`, "Os bots pensam com a IA que você já assina, neste computador. O nod não vê sua senha."],
  "2b": () => ["Conecte uma IA e seus bots começam a responder.", "A IA já está neste computador; falta entrar com a sua conta, no site deles."],
  "2c": () => ["Conecte uma IA e seus bots começam a responder.", "Use a mesma conta do Claude ou do ChatGPT que você usa no navegador. O nod instala a parte que trabalha neste computador; o login é no site deles."],
  "2d": (ia) => [`Entre no ${ia} no navegador. Eu continuo daqui.`, `A página de login do ${ia} abriu no seu navegador. Quando você terminar lá, isto segue sozinho; se nada abriu, use "Abrir de novo".`],
  "2e": () => ["A instalação não terminou.", "Pode ser a internet ou o antivírus. Tente de novo; se continuar, pule por agora e volte depois em Configurações › Suas IAs."],
  "2f": (ia) => ["Ainda não vi o login terminar.", `Se você já entrou no site do ${ia}, confira de novo. Se a página não abriu, abra outra vez ou cole o código que ela mostrar.`],
  "2g": (ia) => [`Sua conta entrou, mas não tem acesso ao ${ia} por aqui.`, `A conta que entrou é de uma organização que não liberou o uso do ${ia} por assinatura. Peça ao administrador para liberar, ou entre com uma conta pessoal que assine o ${ia}.`],
};

const bt = (act: string, rotulo: string, ia: IaDesktop | null, o: { pri?: boolean; ocupado?: boolean } = {}) =>
  `<button type="button" class="bt${o.pri ? " pri" : ""}" data-act="${act}"${ia ? ` data-ia="${ia}"` : ""}${o.ocupado ? " disabled" : ""}>${esc(rotulo)}</button>`;

/** Uma linha (Claude ou ChatGPT): o estado em uma frase e o botão do protótipo. */
function htmlLinha(ia: IaDesktop, tela: TelaComputador, v: VistaComputador, principal: boolean): string {
  const nome = NOME[ia];
  const conta = v.fontes[ia]?.mac?.conta?.email ?? null;
  const o = v.ocupado;
  const secundaria = ia === "codex-cli";
  let estado: string;
  let acao = "";
  switch (tela) {
    case "2a": estado = conta ? `Conectado como ${conta}` : "Conectado"; break;
    case "2b": estado = "Está neste computador; falta entrar."; acao = bt("computador-entrar", "Entrar", ia, { pri: principal, ocupado: o }); break;
    case "2c":
      if (desatualizado(v.fontes[ia])) { estado = `Está neste computador, mas desatualizado. O nod atualiza e segue para o login.`; acao = bt("computador-instalar", "Atualizar e entrar", ia, { pri: principal, ocupado: o }); break; }
      estado = secundaria ? "Também funciona sozinho ou como reserva do Claude." : "Recomendado. Instala em menos de um minuto."; acao = bt("computador-instalar", "Instalar e entrar", ia, { pri: principal && !secundaria, ocupado: o }); break;
    case "instalando": estado = "Instalando…"; break;
    case "2d": {
      const cod = v.fontes[ia]?.mac?.login?.codigoDoDispositivo;
      estado = cod ? `Digite o código ${cod} na página da OpenAI.` : "Esperando o login no navegador…";
      acao = bt("computador-abrir", "Abrir de novo", ia, { ocupado: o });
      break;
    }
    case "2e": estado = `Não consegui baixar o ${nome}. Nada foi alterado no computador.`; acao = bt("computador-instalar", "Tentar de novo", ia, { pri: true, ocupado: o }); break;
    case "2f": {
      estado = "O login não chegou até aqui.";
      const codigo = v.colarCodigo && ia === "claude-cli"
        ? `<form class="ec-codigo" data-form="computador-codigo" data-ia="${ia}"><label class="cc-campo">Se o site do ${nome} mostrar um código, cole aqui:<input name="codigo" autocomplete="off" spellcheck="false" maxlength="200" required aria-label="Código do ${nome}"></label><button type="submit" class="bt"${o ? " disabled" : ""}>Enviar ao ${nome}</button></form>`
        : "";
      acao = `${bt("computador-abrir", "Abrir de novo", ia, { ocupado: o })}${bt("computador-conferir", "Conferir de novo", ia, { pri: true, ocupado: o })}${codigo}`;
      break;
    }
    case "2g": estado = `Conta sem acesso ao ${nome}.${conta ? ` ${conta}` : ""}`; acao = bt("computador-entrar", "Entrar com outra conta", ia, { pri: true, ocupado: o }); break;
    default: estado = "Procurando…";
  }
  // Com uma IA pronta, a outra só avisa que dá para ligar depois (protótipo 2a).
  if (!principal && v.principalPronta && tela !== "2a") { estado = "Dá para ligar depois, em Configurações › Suas IAs. Se o Claude chegar ao limite, ele assume."; acao = ""; }
  else if (!principal && tela === "2c") estado = secundaria ? estado : "Não está neste computador.";
  return `<div class="ec-ia${principal ? " principal" : ""}" data-tela="${tela}"><span class="ob-logo">${LOGO[ia]}</span><div class="ec-ia-txt"><b>${esc(nome)}</b><span role="status">${esc(estado)}</span></div><div class="ec-acoes">${acao}</div></div>`;
}

export type VistaComputador = {
  fontes: Partial<Record<IaDesktop, FonteIa>>;
  agora: number;
  emFoco: IaDesktop | null;
  ocupado: boolean;
  /** A ponte do Mac aceita colar o código do Claude (só aí o campo aparece no 2f). */
  colarCodigo: boolean;
  nota: string | null;
  principalPronta?: boolean;
};

/** A tela inteira (camada cheia do onboarding). */
export function htmlEsteComputador(v: VistaComputador): string {
  const { tela, principal, linhas } = estadoDaTela(v.fontes, v.agora, v.emFoco);
  const [titulo, texto] = CABECA[tela](NOME[principal]);
  const vista = { ...v, principalPronta: tela === "2a" };
  const ordem = [principal, ...IAS_COMPUTADOR.filter((ia) => ia !== principal)];
  const lista = ordem.map((ia) => htmlLinha(ia, linhas[ia], vista, ia === principal)).join("");
  const esperando = tela === "2d" || tela === "2f";
  const pe = tela === "2a"
    ? `<p class="ob-nota">Dá para mudar depois em Configurações › Suas IAs.</p>${bt("computador-continuar", "Continuar", null, { pri: true })}`
    : `<p class="ob-nota">Sem IA, você vê a plataforma; os bots avisam que estão sem IA.</p>${esperando ? bt("computador-cancelar", "Cancelar", principal) : bt("computador-pular", "Pular por agora", null)}`;
  const nota = v.nota ? `<p class="ec-nota" role="alert">${esc(v.nota)}</p>` : "";
  return `<section class="ob-tela ec-tela" aria-label="Este computador" data-estado="${tela}"><div class="ob-cabeca"><span class="ec-selo">Este computador</span><h1 tabindex="-1">${esc(titulo)}</h1><p>${esc(texto)}</p></div><div class="ec-lista">${lista}</div>${nota}<div class="ec-pe">${pe}</div></section>`;
}

// ---- o controlador ---------------------------------------------------------------------------------------------------

export type DepsEsteComputador = {
  ponte: () => NodDesktop | undefined;
  /** O estado do app (UiIas.estados, Mac) e o inventário do motor (EstadoOnboarding.executor.ias, Windows). */
  estadosMac: () => Partial<Record<IaDesktop, EstadoIa>>;
  inventario: () => readonly IaNoMac[];
  /** Pede ao servidor o inventário de novo (Windows: o motor manda o estado novo depois do login). */
  reler: () => Promise<void>;
  agora: () => number;
  aoMudar: () => void;
};

/**
 * Liga a tela às pontes. `mostrar()` decide se a tela aparece: só no app (com a ponte das IAs ou as de antes) e só se
 * esta máquina ainda não a viu. `passar()` grava o "já vi" (Continuar ou Pular).
 */
export function criarEsteComputador(d: DepsEsteComputador) {
  let jaViu: boolean | null = null;
  let lendo = false;
  let ocupado = false;
  let emFoco: IaDesktop | null = null;
  let nota: string | null = null;
  const aguardando: Partial<Record<IaDesktop, number>> = {};
  const falhou: Partial<Record<IaDesktop, boolean>> = {};
  /** Windows: a página de instalação abriu e o CLI ainda não apareceu no inventário. */
  const instalandoFora: Partial<Record<IaDesktop, boolean>> = {};

  const temApp = () => {
    const p = d.ponte();
    return !!p && (!!p.ias || !!p.iaInstalar || !!p.iaEntrar);
  };
  /** App sem a ponte do "já vi" (ADR-157 §4): sem memória por máquina, a tela aparece só enquanto a IA não estiver pronta. */
  const semPonteJaViu = () => !d.ponte()?.esteComputador;
  const iaPronta = () => estadoDaTela(fontes(), d.agora(), emFoco).tela === "2a";
  function lerJaViu(): void {
    if (jaViu !== null || lendo) return;
    const p = d.ponte()?.esteComputador;
    if (!p) { jaViu = false; return; }
    lendo = true;
    void p.jaViu().catch(() => false).then((v) => { jaViu = v; lendo = false; d.aoMudar(); });
  }

  const fontes = (): Partial<Record<IaDesktop, FonteIa>> => {
    const mac = d.ponte()?.ias ? d.estadosMac() : {};
    const inv = d.inventario();
    return Object.fromEntries(IAS_COMPUTADOR.map((ia) => [ia, { mac: mac[ia], inventario: inv.find((i) => i.id === ia), aguardandoDesde: aguardando[ia] ?? null, falhouInstalar: falhou[ia] ?? false }]));
  };

  async function agir(ia: IaDesktop, fn: () => Promise<void>): Promise<void> {
    if (ocupado) return;
    ocupado = true;
    emFoco = ia;
    nota = null;
    d.aoMudar();
    try { await fn(); } catch { nota = `Não deu para falar com o ${NOME[ia]} agora. Tente de novo.`; } finally { ocupado = false; d.aoMudar(); }
  }

  async function entrar(ia: IaDesktop): Promise<void> {
    const p = d.ponte();
    if (p?.ias) { await p.ias.entrar(ia); aguardando[ia] = d.agora(); return; }
    const r = await p?.iaEntrar?.(ia);
    if (r?.ok) aguardando[ia] = d.agora();
    else nota = `Não deu para abrir o login do ${NOME[ia]}. Tente de novo.`;
  }

  async function instalar(ia: IaDesktop): Promise<void> {
    const p = d.ponte();
    falhou[ia] = false;
    if (p?.ias) {
      const atualizar = d.estadosMac()[ia]?.estado === "desatualizada" ? p.ias.atualizar : undefined;
      const e = atualizar ? await atualizar(ia) : await p.ias.instalar(ia);
      if (e.estado === "nao_instalada" || e.estado === "sem_node" || e.instalacao?.fase === "falhou") { falhou[ia] = true; return; }
      await entrar(ia);
      return;
    }
    const r = await p?.iaInstalar?.(ia);
    if (!r?.ok) { falhou[ia] = true; return; }
    // Windows: iaInstalar só abre a página de instalação; enquanto o CLI não existe, iaEntrar responde "nao_instalado".
    // Não é erro de login: avisa e deixa a sonda reler o inventário até o CLI aparecer, então segue para o login.
    const e = await p?.iaEntrar?.(ia);
    if (e?.ok) { aguardando[ia] = d.agora(); return; }
    if (e && e.motivo === "nao_instalado") { instalandoFora[ia] = true; nota = `Termine a instalação do ${NOME[ia]} na página que abriu. Quando acabar, o nod segue para o login.`; return; }
    nota = `Não deu para abrir o login do ${NOME[ia]}. Tente de novo.`;
  }

  return {
    /** null = ainda lendo o "já vi" (a tela espera um instante); true = mostra; false = segue para a conversa. */
    mostrar(): boolean | null {
      if (!temApp()) return false;
      lerJaViu();
      if (jaViu === null) return null;
      return !jaViu && !(semPonteJaViu() && iaPronta());
    },
    /** O mesmo que `mostrar`, esperando a leitura do "já vi" (o fim do "olá" decide aqui). */
    async decidir(): Promise<boolean> {
      if (!temApp()) return false;
      if (jaViu === null) {
        const p = d.ponte()?.esteComputador;
        jaViu = p ? await p.jaViu().catch(() => false) : false;
      }
      return !jaViu && !(semPonteJaViu() && iaPronta());
    },
    html(): string {
      const p = d.ponte();
      return htmlEsteComputador({ fontes: fontes(), agora: d.agora(), emFoco, ocupado, colarCodigo: !!p?.ias, nota });
    },
    estado: () => estadoDaTela(fontes(), d.agora(), emFoco),
    async passar(): Promise<void> {
      jaViu = true;
      await d.ponte()?.esteComputador?.marcar().catch(() => undefined);
    },
    /** A sonda (Windows): sem o estado ao vivo do app, relê o inventário do servidor enquanto espera o login. */
    async sondar(): Promise<void> {
      if (d.ponte()?.ias) return;
      if (!IAS_COMPUTADOR.some((ia) => aguardando[ia] != null || instalandoFora[ia])) return;
      await d.reler().catch(() => undefined);
      for (const ia of IAS_COMPUTADOR) {
        if (!instalandoFora[ia] || ocupado) continue;
        const i = d.inventario().find((x) => x.id === ia);
        if (!i || i.estado === "ausente") continue;
        delete instalandoFora[ia];
        if (nota?.startsWith("Termine a instalação")) nota = null;
        if (i.estado !== "pronto") await agir(ia, () => entrar(ia));
      }
      d.aoMudar();
    },
    acoes: {
      "computador-instalar": (ia: IaDesktop) => agir(ia, () => instalar(ia)),
      "computador-entrar": (ia: IaDesktop) => agir(ia, () => entrar(ia)),
      "computador-abrir": (ia: IaDesktop) => agir(ia, async () => {
        const p = d.ponte();
        if (p?.ias) { if (!(await p.ias.abrirLink(ia))) await entrar(ia); return; }
        await entrar(ia);
      }),
      "computador-conferir": (ia: IaDesktop) => agir(ia, async () => {
        const p = d.ponte();
        if (p?.ias) await p.ias.verificar(ia);
        else await d.reler();
        aguardando[ia] = d.agora();
      }),
      "computador-cancelar": (ia: IaDesktop) => agir(ia, async () => {
        delete aguardando[ia];
        await d.ponte()?.ias?.cancelar(ia);
      }),
    } satisfies Record<string, (ia: IaDesktop) => Promise<void>>,
    async colarCodigo(ia: IaDesktop, codigo: string): Promise<void> {
      await agir(ia, async () => {
        const r = await d.ponte()?.ias?.colarCodigo(ia, codigo.trim());
        if (r && !r.ok) nota = r.motivo === "codigo_invalido" ? "Esse código não parece o do site. Copie de novo." : "O login aberto não está esperando um código. Clique em Abrir de novo.";
        else aguardando[ia] = d.agora();
      });
    },
    descartar(): void { jaViu = null; ocupado = false; emFoco = null; nota = null; for (const ia of IAS_COMPUTADOR) { delete aguardando[ia]; delete falhou[ia]; delete instalandoFora[ia]; } },
  };
}
