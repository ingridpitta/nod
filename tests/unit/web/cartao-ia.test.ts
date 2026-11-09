import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ESTADOS_IA, type EstadoIa, type LoginDaIa } from "../../../src/contracts/estado-ia.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import type { IaDaPessoa } from "../../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoDaIa } from "../../../src/domain/estado-ia.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { haQuanto } from "../../../web/lib/relogio.ts";
import { AJUDA_IA, estadoDoServidor, LINKS_AJUDA, pilhaDeAvatares, renderCartaoIa, UI_IAS_INICIAL, vistaDaIa, type ContextoCartao, type IaMac, type UiIas } from "../../../web/telas/cartao-ia.ts";
import { chaveDoMenuDaIa, linhaDaIa, renderProvedores } from "../../../web/telas/provedores.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/**
 * O cartão de IA (plano das IAs, PR 3; protótipos Main = tela 1 e Onboarding = tela 5): o mesmo em Provedores de IA e no
 * onboarding. Cada estado único da IA (src/contracts/estado-ia.ts) vira uma frase curta, um tom e no máximo um botão;
 * instalar, entrar e testar viram passos dentro do cartão, com "Precisa de ajuda?".
 */
const AGORA = Date.UTC(2026, 9, 10, 15, 0);
const inv = (i: Inventario): Inventario => i;
const servidor = (claude: Inventario, codex: Inventario, limite: { claude?: number } = {}): IaDaPessoa[] => HARNESSES.map((h) => ({
  id: h.id, nome: h.nome, integrado: h.integrado,
  inventario: h.id === "claude-cli" ? claude : h.id === "codex-cli" ? codex : { estado: "ausente", motivo: "x", em: 0 },
  limite: h.id === "claude-cli" && limite.claude ? { renovaEm: limite.claude, desde: AGORA - 60_000 } : null,
  recomendado: "recomendado" in h ? h.recomendado : null,
  modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })),
}));
const PRONTO = inv({ estado: "pronto", versao: "2.1.296", em: AGORA - 60_000 });
const AUSENTE = inv({ estado: "ausente", motivo: "binario_nao_encontrado", em: AGORA });
const SEM_LOGIN = inv({ estado: "nao_autenticado", motivo: "x", em: AGORA });
const mac = (ia: IaMac, estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): EstadoIa => ({ ia, estado, mensagem: "", em: AGORA, ...extra });
const naApp = (estados: Partial<Record<IaMac, EstadoIa>>, ui: Partial<UiIas> = {}): UiIas => ({ ...UI_IAS_INICIAL, noApp: true, estados, ...ui });
const ctx = (p: Partial<ContextoCartao> = {}): ContextoCartao => ({ servidor: servidor(PRONTO, AUSENTE), ui: UI_IAS_INICIAL, agora: AGORA, onde: "provedores", ...p });
const login = (p: Partial<LoginDaIa>): LoginDaIa => ({ fase: "aguardando", host: null, codigoDoDispositivo: null, pedeCodigo: false, codigoEnviado: false, expiraEm: null, verificarDeNovo: false, mensagem: "", ...p });

describe("o estado do servidor é o mesmo do app do Mac", () => {
  const amostras: Inventario[] = [
    PRONTO, AUSENTE, SEM_LOGIN,
    { estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0", motivo: "x", em: 0 },
    { estado: "ausente", causa: "sem_node", motivo: "x", em: 0 },
    { estado: "ausente", causa: "config_invalida", motivo: "x", em: 0 },
    { estado: "ausente", causa: "sonda_lenta", motivo: "x", em: 0 },
    { estado: "ausente", causa: "atualizando", motivo: "x", em: 0 },
    { estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "x", em: 0 },
    { estado: "nao_autenticado", causa: "teste_falhou", motivo: "x", em: 0 },
  ];
  it.each(amostras.map((a) => [a.estado, "causa" in a ? a.causa : "-", a] as const))("%s / %s: a cópia da web dá o estado do domínio", (_e, _c, a) => {
    const ia = servidor(a, a)[0]!;
    expect(estadoDoServidor(ia).estado).toBe(estadoDaIa({ ia: "claude-cli", inventario: a, agora: 0 }).estado);
  });

  it("o limite do servidor vira 'no limite' com a hora, por cima da IA pronta do Mac", () => {
    const ate = AGORA + 2 * 3_600_000;
    const v = vistaDaIa("claude-cli", ctx({ servidor: servidor(PRONTO, AUSENTE, { claude: ate }), ui: naApp({ "claude-cli": mac("claude-cli", "pronta") }) }));
    expect(v.estado).toBe("no_limite");
    expect(v.texto).toMatch(/^Chegou ao limite da assinatura · volta às \d\d:\d\d$/);
    expect(v.tom).toBe("aviso");
    // Sem outra IA pronta, o cartão explica o que acontece e o que resolve.
    expect(v.explica).toBe("Enquanto isso, seus bots esperam. Conecte o ChatGPT e eles continuam por ele até o Claude voltar.");
  });
});

describe("tela 1: cada estado do cartão, com um botão só", () => {
  const todos = ESTADOS_IA;
  it.each(todos)("%s: frase curta e no máximo um botão", (estado) => {
    const v = vistaDaIa("codex-cli", ctx({ ui: naApp({ "claude-cli": mac("claude-cli", "pronta"), "codex-cli": mac("codex-cli", estado, estado === "sem_acesso" ? { causa: "conta_sem_acesso" } : {}) }) }));
    expect(v.texto.length).toBeGreaterThan(3);
    expect(v.texto.length).toBeLessThan(70);
    const html = renderCartaoIa(v, UI_IAS_INICIAL);
    expect(html.match(/class="ob-pilula/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("no app: ausente = 'Instalar e entrar'; sem login = 'Entrar'; conta sem acesso = 'Entrar com outra conta' e a explicação", () => {
    const ui = (codex: EstadoIa) => naApp({ "claude-cli": mac("claude-cli", "pronta"), "codex-cli": codex });
    expect(vistaDaIa("codex-cli", ctx({ ui: ui(mac("codex-cli", "nao_instalada")) })).botao).toEqual({ act: "ia-instalar", rotulo: "Instalar e entrar", destaque: false });
    expect(vistaDaIa("codex-cli", ctx({ ui: ui(mac("codex-cli", "falta_entrar")) })).botao?.rotulo).toBe("Entrar");
    const sem = vistaDaIa("codex-cli", ctx({ ui: ui(mac("codex-cli", "sem_acesso", { causa: "conta_sem_acesso" })) }));
    expect(sem.botao?.rotulo).toBe("Entrar com outra conta");
    expect(sem.explica).toContain("o acesso depende do assento ou do papel que ele definiu");
    expect(sem.explica).not.toContain("desativou");
  });

  it("sem nenhuma IA pronta, o botão é cheio (a ação que falta); com uma pronta, é contorno", () => {
    const nenhuma = vistaDaIa("codex-cli", ctx({ ui: naApp({ "claude-cli": mac("claude-cli", "falta_entrar"), "codex-cli": mac("codex-cli", "nao_instalada") }) }));
    expect(nenhuma.botao?.destaque).toBe(true);
    const html = renderCartaoIa(nenhuma, UI_IAS_INICIAL);
    expect(html).toContain('<button type="button" class="ob-pilula" data-act="ia-instalar" data-ia="codex-cli">Instalar e entrar</button>');
  });

  it("no navegador: sem botão de instalar; a nota diz para abrir o app do nod no Mac", () => {
    const v = vistaDaIa("codex-cli", ctx({ servidor: servidor(PRONTO, AUSENTE) }));
    expect(v.botao).toBeNull();
    expect(v.texto).toBe("Não está no seu Mac");
    expect(v.nota).toBe("Para instalar, abra o app do nod no seu Mac.");
  });

  it("a IA pronta diz se está em uso ou se assume quando a de cima parar, pela ordem", () => {
    const c = ctx({ servidor: servidor(PRONTO, PRONTO) });
    expect(vistaDaIa("claude-cli", c).texto).toBe("Conectado · em uso");
    expect(vistaDaIa("codex-cli", c).texto).toBe("Conectado · assume se a de cima parar");
    const limite = ctx({ servidor: servidor(PRONTO, PRONTO, { claude: AGORA + 3_600_000 }) });
    expect(vistaDaIa("codex-cli", limite).texto).toBe("Conectado · em uso até o Claude voltar");
  });

  it("o verificar fica num ícone com a versão e a hora no balão", () => {
    const v = vistaDaIa("claude-cli", ctx({ ui: naApp({ "claude-cli": mac("claude-cli", "pronta", { versao: "2.1.296", em: AGORA - 60_000 }) }) }));
    expect(v.dica).toBe(`Claude Code 2.1.296 · verificado ${haQuanto(60_000)}`);
    const html = renderCartaoIa(v, UI_IAS_INICIAL, { arrastar: { pos: 1 } });
    expect(html).toContain('data-act="ia-verificar" data-ia="claude-cli" aria-label="Verificar o Claude de novo"');
    expect(html).toContain(`<span class="ia-balao" role="tooltip">${v.dica}</span>`);
    expect(html).toContain("data-alca-ordem");
    expect(html).toContain('<span class="prov-pos" aria-hidden="true">1</span>');
  });
});

describe("instalar → entrar → testar dentro do cartão", () => {
  const comFluxo = (codex: EstadoIa, extra: Partial<UiIas> = {}) => ctx({ ui: naApp({ "claude-cli": mac("claude-cli", "pronta"), "codex-cli": codex }, { fluxo: { "codex-cli": { instalar: true } }, ...extra }) });

  it("instalando: o passo 1 gira com a última linha do npm; o botão é Cancelar", () => {
    const v = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "instalando", { instalacao: { fase: "instalando", linha: "added 1 package in 9s", tentativa: 1, mensagem: "" } })));
    expect(v.passos?.map((p) => [p.id, p.marca])).toEqual([["instalar", "girando"], ["entrar", "depois"], ["testar", "depois"]]);
    expect(v.passos?.[0]?.log).toBe("added 1 package in 9s");
    expect(v.botao?.rotulo).toBe("Cancelar");
    // NOD-8: sem linha do npm ainda, o passo 1 diz "Instalando…"; o 2 diz que começa sozinho.
    const semLinha = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "instalando", { instalacao: { fase: "instalando", linha: null, tentativa: 1, mensagem: "" } })));
    expect(semLinha.passos?.[0]?.log).toBe("Instalando…");
    expect(semLinha.passos?.[1]?.texto).toBe("Começa sozinho quando a instalação terminar.");
  });

  it("a instalação falhou: passo âmbar com a frase, 'Tentar de novo' e o detalhe atrás de um link", () => {
    const falhou = mac("codex-cli", "nao_instalada", { instalacao: { fase: "falhou", linha: null, tentativa: 2, causa: "sem_internet", mensagem: "Não deu para instalar: sem conexão com a internet.", registro: "instalar-codex-1.log" } });
    let v = vistaDaIa("codex-cli", comFluxo(falhou));
    expect(v.tom).toBe("aviso");
    expect(v.texto).toBe("A instalação não terminou");
    const p = v.passos?.[0];
    expect(p?.marca).toBe("erro");
    expect(p?.acoes.map((a) => a.rotulo)).toEqual(["Tentar de novo", "Ver detalhe"]);
    expect(p?.detalhe).toBeNull();
    // NOD-8: com o passo 1 falhado, o 2 para (não diz que começa sozinho).
    expect(v.passos?.[1]?.texto).toBeNull();
    v = vistaDaIa("codex-cli", comFluxo(falhou, { detalhe: "codex-cli" }));
    expect(v.passos?.[0]?.detalhe).toBe("Registro da instalação: ~/Library/Logs/nod/instalar-codex-1.log");
    const html = renderCartaoIa(v, UI_IAS_INICIAL);
    expect(html).toContain('<span class="ia-passo-marca falha" aria-hidden="true">!</span>');
  });

  it("Codex entrando: o código no cartão, 'Copiar' e 'Abrir a página da OpenAI'", () => {
    const v = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "entrando", { login: login({ host: "auth.openai.com", codigoDoDispositivo: "NP6Z-V3598" }) })));
    const entrar = v.passos?.find((p) => p.id === "entrar");
    expect(entrar?.codigo).toBe("NP6Z-V3598");
    const html = renderCartaoIa(v, UI_IAS_INICIAL);
    expect(html).toContain("<code>NP6Z-V3598</code>");
    expect(html).toContain('data-act="ia-copiar-codigo" data-ia="codex-cli" data-texto="NP6Z-V3598" aria-live="polite">Copiar');
    expect(html).toContain('data-act="ia-abrir-link" data-ia="codex-cli">Abrir a página da OpenAI');
    expect(html).toContain("Esperando você entrar…");
    // O instalar ficou feito; o entrar é o passo atual.
    expect(v.passos?.map((p) => p.marca)).toEqual(["feito", "ativo", "depois"]);
  });

  it("Claude entrando: 'Abrir a página da Anthropic' e o campo de colar o código, com o que a pessoa já colou", () => {
    const c = ctx({ ui: naApp({ "claude-cli": mac("claude-cli", "entrando", { login: login({ host: "claude.com", pedeCodigo: true }) }) }, { fluxo: { "claude-cli": { instalar: false } }, codigo: { "claude-cli": "abc#def" } }) });
    const v = vistaDaIa("claude-cli", c);
    expect(v.passos?.map((p) => p.id)).toEqual(["entrar", "testar"]);
    const html = renderCartaoIa(v, c.ui);
    expect(html).toContain('<form class="ia-colar" data-form="ia-colar-codigo" data-ia="claude-cli">');
    expect(html).toContain('value="abc#def"');
    expect(html).toContain("Abrir a página da Anthropic");
  });

  it("login expirado: passo âmbar com 'Tentar de novo'; passados os 2 min, 'Verificar de novo'", () => {
    const expirou = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "falta_entrar", { login: login({ fase: "expirou", mensagem: "O código expirou. Comece o login de novo." }) })));
    expect(expirou.texto).toBe("O login não terminou");
    expect(expirou.passos?.[1]).toMatchObject({ marca: "erro", texto: "O código expirou. Comece o login de novo." });
    const lento = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "entrando", { login: login({ host: "auth.openai.com", codigoDoDispositivo: "X", verificarDeNovo: true }) })));
    expect(lento.passos?.[1]?.acoes.map((a) => a.rotulo)).toEqual(["Verificar de novo"]);
  });

  it("testando e depois pronto: o passo 3 gira; com a resposta, o fluxo fecha e o cartão diz 'Conectado'", () => {
    const testando = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "pronta"), { teste: { "codex-cli": { estado: "testando" } } }));
    expect(testando.passos?.map((p) => p.marca)).toEqual(["feito", "feito", "girando"]);
    const pronto = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "pronta"), { teste: { "codex-cli": { estado: "pronto", resposta: "Oi!" } } }));
    expect(pronto.passos).toBeNull();
    expect(pronto.tom).toBe("ok");
  });

  it("a conta entrou e não serve: o passo 3 em âmbar, com 'Entrar com outra conta'", () => {
    const v = vistaDaIa("codex-cli", comFluxo(mac("codex-cli", "sem_acesso", { causa: "conta_sem_acesso" })));
    expect(v.passos?.[2]).toMatchObject({ marca: "erro", acoes: [{ act: "ia-entrar", rotulo: "Entrar com outra conta", contorno: true }] });
  });

  it("'Precisa de ajuda?' em cada passo atual, com o texto curto e o link oficial", () => {
    const c = comFluxo(mac("codex-cli", "entrando", { login: login({ host: "auth.openai.com", codigoDoDispositivo: "X" }) }), { ajuda: "codex-cli:entrar" });
    const html = renderCartaoIa(vistaDaIa("codex-cli", c), c.ui);
    expect(html).toContain('data-act="ia-ajuda" data-ia="codex-cli" data-passo="entrar" aria-expanded="true">Precisa de ajuda?');
    expect(html).toContain(`href="${LINKS_AJUDA.codexEntrar}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain("nas permissões do workspace, pelo administrador");
    expect(html).toContain(`href="${LINKS_AJUDA.codexAdmin}"`);
  });

  it("os links de ajuda são todos https em domínios oficiais da OpenAI e da Anthropic", () => {
    const oficiais = /^https:\/\/(learn\.chatgpt\.com|developers\.openai\.com|help\.openai\.com|openai\.com|chatgpt\.com|docs\.claude\.com|code\.claude\.com|docs\.anthropic\.com|support\.claude\.com|support\.anthropic\.com|claude\.com|claude\.ai|www\.anthropic\.com)\//;
    for (const url of Object.values(LINKS_AJUDA)) expect(url).toMatch(oficiais);
    for (const passos of Object.values(AJUDA_IA)) for (const p of Object.values(passos)) for (const l of p.links) expect(Object.values(LINKS_AJUDA)).toContain(l.url);
    // help.openai.com responde 403 a quem confere: fica fora até dar para abrir.
    for (const url of Object.values(LINKS_AJUDA)) expect(url).not.toContain("help.openai.com");
  });
});

describe("Provedores de IA (a seção que era Conexão)", () => {
  const estado = (p: Partial<Estado> = {}): Estado => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, ias: { ordem: ["claude-cli", "codex-cli"], ordemPadrao: true, ias: servidor(PRONTO, AUSENTE), raciocinios: [] }, ...p });

  it("o título com os logos redondos, a ordem arrastável e o Recomendado", () => {
    const html = renderProvedores(estado());
    expect(html).toContain(`<h2 class="prov-titulo">${pilhaDeAvatares()}Provedores de IA</h2>`);
    expect(html).toContain('<h3 class="lc-grupo-tit">Ordem dos seus bots</h3><div class="lc-lista" data-ordem-lista="pessoa">');
    expect(html.indexOf('data-ordem-item="claude-cli"')).toBeLessThan(html.indexOf('data-ordem-item="codex-cli"'));
    expect(html).toContain("Recomendado: o Claude com <b>Opus</b> e o ChatGPT com <b>Sol</b>.</p></section>");
  });

  it("NOD-373 (#j3-1): cada IA é uma linhaConfig com a alça focável à esquerda, o título e o status com ponto de cor, sem o cartão antigo", () => {
    const html = renderProvedores(estado());
    const itens = [...html.matchAll(/<div class="prov-ia-item" data-ordem-item="([^"]+)"><div class="lc-linha prov-ia">(.*?)<\/div>/g)];
    expect(itens.map((m) => m[1])).toEqual(["claude-cli", "codex-cli"]);
    const [claude, codex] = itens.map((m) => m[2]!);
    // A alça vem primeiro e fora do ícone aria-hidden: é ela que recebe o foco e as setas (ordem-arrastavel.ts).
    expect(claude).toMatch(/^<button type="button" class="prov-alca" data-alca-ordem aria-label="Mover o Claude na ordem \(setas para cima e para baixo\)">/);
    expect(claude).toMatch(/<\/button><span class="lc-ic" aria-hidden="true"><span class="prov-pos">1<\/span><span class="cl-logo"/);
    expect(claude).toContain('<span class="lc-txt"><b>Claude</b><small>Claude Code');
    expect(claude).toContain('<span class="lc-status lc-tom-ok" role="status"><i aria-hidden="true"></i>Conectado · em uso</span>');
    expect(codex).toContain('<span class="prov-pos">2</span>');
    expect(codex).toContain('<span class="lc-status lc-tom-neutro" role="status"><i aria-hidden="true"></i>Não está no seu Mac</span>');
    expect(html).not.toContain('class="ia-linha"');
    expect(html).not.toContain('class="prov-ordem"');
    expect(html.match(/<p class="lc-nota">/g)).toHaveLength(1);
  });

  it("NOD-373: o tom da IA vira o ponto da linha (ok → ok, aviso → atenção, mudo → neutro); a conta vai no detalhe", () => {
    const base = vistaDaIa("claude-cli", { servidor: servidor(PRONTO, PRONTO), ui: UI_IAS_INICIAL, agora: AGORA, onde: "provedores" });
    expect(linhaDaIa({ ...base, tom: "ok" }, UI_IAS_INICIAL, 1)).toContain('lc-status lc-tom-ok"');
    expect(linhaDaIa({ ...base, tom: "aviso", texto: "Tem versão nova" }, UI_IAS_INICIAL, 1)).toContain('<span class="lc-status lc-tom-atencao" role="status"><i aria-hidden="true"></i>Tem versão nova</span>');
    expect(linhaDaIa({ ...base, tom: "mudo" }, UI_IAS_INICIAL, 1)).toContain('lc-status lc-tom-neutro"');
    expect(linhaDaIa({ ...base, conta: "a@b.com" }, UI_IAS_INICIAL, 1)).toContain('<span class="sr-only">Conta: </span>a@b.com');
  });

  it("revisão NOD-373 (WCAG 2.5.7): o “…” da IA tem Subir e Descer, sem Subir na primeira nem Descer na última", () => {
    const fechado = renderProvedores(estado());
    expect(fechado).toContain(`data-act="cl-menu" data-id="${chaveDoMenuDaIa("claude-cli")}" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações de Claude"`);
    expect(fechado).not.toContain("Subir na ordem");
    const aberto = (ia: string) => renderProvedores(estado({ contasUi: { ...estadoInicial.contasUi, menu: chaveDoMenuDaIa(ia) } }));
    const primeira = aberto("claude-cli");
    expect(primeira).toContain('data-act="ia-ordem-passo" data-ia="claude-cli" data-passo="1"><svg');
    expect(primeira).toContain("Descer na ordem");
    expect(primeira).not.toContain("Subir na ordem");
    const ultima = aberto("codex-cli");
    expect(ultima).toContain('data-act="ia-ordem-passo" data-ia="codex-cli" data-passo="-1"');
    expect(ultima).not.toContain("Descer na ordem");
    expect(ultima.match(/role="menu"/g)).toHaveLength(1);
  });

  it("revisão NOD-373: o CSS mostra o Verificar no hover da linha nova, põe a alça na coluna dela até 720px e dá 44px no toque", () => {
    const ler = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");
    expect(ler("navegacao.css")).toMatch(/\.prov-ia:hover \.ia-verificar, \.prov-ia:focus-within \.ia-verificar[^{]*\{ opacity: 1; \}/);
    expect(ler("navegacao.css")).toContain(".lc-linha.prov-ia { gap: 10px; padding-left: 10px; }");
    const cfg = ler("configuracoes.css");
    const bloco720 = cfg.slice(cfg.indexOf("@media (max-width: 720px)"));
    expect(bloco720).toContain(".lc-linha.prov-ia { grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 0;"); // o gap de 10px do desktop não soma às margens no grid
    expect(bloco720).toMatch(/\.prov-ia \.prov-alca \{ grid-column: 1; grid-row: 1 \/ span 2;/);
    const mobile = ler("mobile.css");
    expect(mobile).toContain(".prov-ia .prov-alca { width: 44px; height: 44px; }");
    expect(mobile).toContain(".prov-ia .lc-ctrl button { min-height: 44px; }");
    expect(mobile).toContain(".lc-linha.prov-ia { min-height: 60px; }");
  });

  it("a ordem segue a da pessoa", () => {
    const ias = servidor(PRONTO, PRONTO);
    const html = renderProvedores(estado({ ias: { ordem: ["codex-cli", "claude-cli"], ordemPadrao: false, ias: [ias[1]!, ias[0]!, ...ias.slice(2)], raciocinios: [] } }));
    expect(html.indexOf('data-ordem-item="codex-cli"')).toBeLessThan(html.indexOf('data-ordem-item="claude-cli"'));
    expect(html).toContain("Conectado · em uso");
  });

  it("no modo compartilhado (sem troca de executor) não há 'Configurar conexão'", () => {
    const compartilhado = renderProvedores(estado({ executor: { atual: "catcher", opcoes: [], recusa: null, trocavel: false } }));
    expect(compartilhado).not.toContain("Configurar conexão");
    const local = renderProvedores(estado({ executor: { atual: "catcher", opcoes: [], recusa: null } }));
    expect(local).toContain("Configurar conexão");
  });

  it("'Conexão' virou 'Provedores de IA' na navegação de Seu espaço e no menu da conta", () => {
    expect(SECOES_ESPACO.find((s) => s.id === "conexao")?.nome).toBe("Provedores de IA");
    const menu = htmlMenuConta({ faixa: null, conexao: "Conectada" });
    expect(menu).toContain('<span class="mc-nome">Provedores de IA</span>');
    expect(menu).not.toContain("Conexão");
  });
});
