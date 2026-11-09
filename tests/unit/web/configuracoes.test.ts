import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_UI_INICIAL, estadoInicial, reduzir, secaoDoPedido } from "../../../web/estado/reducer.ts";
import { normalizarBusca } from "../../../web/lib/linha-config.ts";
import { renderConta, type DadosConta } from "../../../web/telas/config-conta.ts";
import { renderGeral, type DadosGeral } from "../../../web/telas/config-geral.ts";
import { renderEspaco, SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/** NOD-367 (protótipo v2 do Gil): o menu do avatar enxuto e as Configurações com 6 seções e a linha única. */
const ler = (f: string): string => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

describe("menu do avatar (critério 1)", () => {
  const base = { faixa: null, conexao: "Conectada", quem: { nome: "Ana Lima", email: "ana@x.com" }, conta: { email: "ana@x.com", senha: true } };

  it("identificação (só texto), Provedores, Configurações, Agentes, Enviar feedback, Ajuda, divisória e Sair, nesta ordem", () => {
    const h = htmlMenuConta(base);
    const ordem = ["mc-quem", 'data-secao="conexao"', 'data-secao="geral"', 'data-secao="agentes"', 'data-secao="feedback"', 'data-secao="ajuda"', "<hr>", 'data-conta="sair"'];
    const pos = ordem.map((t) => h.lastIndexOf(t));
    for (const p of pos) expect(p).toBeGreaterThan(-1);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    // A identificação fica fora do role=menu e não é um item.
    expect(h.indexOf("mc-quem")).toBeLessThan(h.indexOf('role="menu"'));
    expect(h).toContain('aria-label="Menu da conta de Ana Lima"');
    expect(h).toContain("Ana Lima");
    expect(h).toContain("ana@x.com");
  });

  it("sem fileira de interruptores nem ação de conta além de Sair", () => {
    const h = htmlMenuConta(base);
    expect(h).not.toContain("menuitemcheckbox");
    expect(h).not.toContain("data-experimento");
    expect(h).not.toContain("data-modo-dev");
    expect([...h.matchAll(/data-conta="([^"]+)"/g)].map((m) => m[1])).toEqual(["sair"]);
    for (const fora of ["Este Mac", "Máquinas", "Computadores", "Avisos", "Banco", "onboarding"]) expect(h).not.toContain(fora);
  });

  it("a faixa só aparece com problema e leva a Provedores", () => {
    expect(htmlMenuConta(base)).not.toContain("mc-faixa");
    const com = htmlMenuConta({ ...base, faixa: { texto: "Claude desconectada", botao: "Conectar" } });
    expect(com).toContain('<div class="mc-faixa" role="status">');
    expect(com).toMatch(/<button type="button" data-secao="conexao">Conectar<\/button>/);
    // o status fica fora do role=menu (não é item de menu); as setas do diálogo passam pelo botão dele
    expect(com.indexOf("mc-faixa")).toBeLessThan(com.indexOf('role="menu"'));
  });

  it("NOD-367 (#219): o Este Mac sem disco ou ocupado vira uma linha discreta que abre Máquinas", () => {
    const h = htmlMenuConta({ ...base, maquina: { texto: "Este Mac com o disco quase cheio", tom: "atencao" } });
    expect(h).toMatch(/class="mc-faixa mc-faixa-atencao" role="status"><i aria-hidden="true"><\/i><span>Este Mac com o disco quase cheio<\/span><button type="button" data-secao="maquinas">Ver<\/button>/);
    expect(htmlMenuConta(base)).not.toContain("mc-faixa-");
  });

  it("sem contas no servidor, sem Sair; sem nome, a identificação é o e-mail", () => {
    expect(htmlMenuConta({ faixa: null, conexao: "Conectada" })).not.toContain("data-conta");
    expect(htmlMenuConta({ faixa: null, conexao: "Conectada" })).not.toContain("mc-quem");
    const soEmail = htmlMenuConta({ ...base, quem: { nome: null, email: "ana@x.com" } });
    expect(soEmail).toContain("<b>ana@x.com</b>");
    expect(soEmail).toContain('aria-label="Menu da conta"');
  });
});

describe("as 6 seções (critério 2)", () => {
  it("Conta, Geral, Provedores de IA, Máquinas, Agentes, Rotinas e Feedback, nesta ordem (NOD-85)", () => {
    expect(SECOES_ESPACO.map((s) => s.nome)).toEqual(["Conta", "Geral", "Provedores de IA", "Máquinas", "Agentes", "Rotinas", "Feedback"]);
  });

  it("os pedidos de antes caem na seção que os absorveu", () => {
    expect(secaoDoPedido("avisos")).toBe("geral");
    expect(secaoDoPedido("preferencias")).toBe("geral");
    expect(secaoDoPedido("ajuda")).toBe("geral");
    expect(secaoDoPedido("este-mac")).toBe("maquinas");
    expect(secaoDoPedido("computadores")).toBe("maquinas");
    expect(secaoDoPedido("computador-do-bot")).toBe("maquinas");
    expect(secaoDoPedido("relatos")).toBe("feedback");
    expect(secaoDoPedido("agentes")).toBe("agentes");
  });

  it("a lateral se chama Configurações, tem as 6 seções (com ou sem v2) e não tem o rodapé do banco", () => {
    const conta: DadosConta = { contas: false, minhaConta: false, nome: null, email: null, senha: false, legado: false };
    const extras = { conta, contaPagina: null, tema: "sistema" as const };
    const avisos = { onde: "mac" as const, situacao: "ligados" as const };
    const volta = { rotulo: "Início", icone: "" };
    const e = reduzir(estadoInicial, { tipo: "espaco", secao: "geral" });
    for (const estado of [e, { ...e, computadorPessoa: { estado: "pronto", maquina: null, telas: [], esperando: [] } } as never]) {
      const html = renderEspaco(estado, avisos, volta, extras);
      expect(html).toContain('<h1 id="espaco-titulo">Configurações</h1>');
      expect(html).toContain('aria-label="Seções das Configurações"');
      expect([...html.matchAll(/data-act="secao-espaco" data-secao="([^"]+)"/g)].map((m) => m[1])).toEqual(["conta", "geral", "conexao", "maquinas", "agentes", "rotinas", "feedback"]);
      expect(html).not.toContain("espaco-banco");
    }
  });

  it("trocar de seção fecha o '…' e as linhas abertas; fechar zera tudo", () => {
    let e = reduzir(estadoInicial, { tipo: "espaco", secao: "geral" });
    e = reduzir(e, { tipo: "config-recolhe", id: "avancado" });
    e = reduzir(e, { tipo: "config-ui", mudanca: { busca: "téo" } });
    expect(e.configUi).toEqual({ abertos: ["avancado"], busca: "téo", filtro: "todos", lote: CONFIG_UI_INICIAL.lote });
    expect(reduzir(e, { tipo: "espaco", secao: "geral" }).configUi.abertos).toEqual(["avancado"]);
    expect(reduzir(e, { tipo: "espaco", secao: "agentes" }).configUi).toEqual({ abertos: [], busca: "téo", filtro: "todos", lote: CONFIG_UI_INICIAL.lote });
    expect(reduzir(e, { tipo: "espaco", secao: null }).configUi).toEqual(CONFIG_UI_INICIAL);
    expect(reduzir(reduzir(e, { tipo: "config-recolhe", id: "avancado" }), { tipo: "espaco", secao: "geral" }).configUi.abertos).toEqual([]);
  });
});

describe("Conta (critério 3)", () => {
  const com: DadosConta = { contas: true, minhaConta: true, nome: "Ana Lima", email: "ana@x.com", senha: true, legado: false };

  it("com Minha conta: perfil, e-mail, senha, sessões, outro computador, exportar, Sair e Excluir, pelas rotas de antes", () => {
    const h = renderConta(com);
    expect(h).toContain("<h2>Conta</h2>");
    for (const t of ['data-act="cfg-conta-pagina" data-aba="perfil"', 'data-aba="acesso" data-passo="email"', 'data-conta="senha"', 'data-conta="sessoes"', 'data-conta="parear-gerar"', 'data-aba="dados"', 'data-conta="sair"', 'data-aba="dados" data-passo="excluir"']) expect(h).toContain(t);
    expect(h.indexOf('data-conta="sair"')).toBeLessThan(h.indexOf('data-passo="excluir"'));
    expect(h).toMatch(/class="lc-linha lc-perigo lc-link"[^>]*data-passo="excluir"/);
  });

  it("sem Minha conta: e-mail (sem página), senha, sessões, outro computador e Sair; sem perfil, exportar nem excluir", () => {
    const h = renderConta({ ...com, minhaConta: false });
    expect(h).not.toContain("cfg-conta-pagina");
    expect(h).not.toContain("Excluir conta");
    expect(h).not.toContain("Exportar meus dados");
    for (const q of ["senha", "sessoes", "parear-gerar", "sair"]) expect(h).toContain(`data-conta="${q}"`);
  });

  it("sem contas no servidor: só a identificação", () => {
    const h = renderConta({ ...com, contas: false, minhaConta: false });
    expect(h).toContain("Ana Lima");
    expect(h).not.toContain("data-conta");
    expect(h).not.toContain("Como você entra");
  });

  it("conta de antes das contas: sem senha nem pareamento; provisório: o convite", () => {
    const legado = renderConta({ ...com, minhaConta: false, legado: true, senha: false });
    expect(legado).not.toContain('data-conta="senha"');
    expect(legado).not.toContain('data-conta="parear-gerar"');
    expect(legado).toContain('data-conta="sair"');
    const prov = renderConta({ ...com, minhaConta: false, email: null, nome: null });
    expect(prov).toContain('data-conta="inicio"');
    expect(prov).not.toContain('data-conta="sair"');
  });
});

describe("Geral (critérios 4 e 5)", () => {
  const d: DadosGeral = { tema: "claro", avisos: { onde: "mac", situacao: "ligados", som: true }, modoDev: true, experimentos: { calibracao: true, memoriaLonga: false, whatsapp: false, quadro: false } };

  it("Aparência, Avisos, Ajuda e Avançado recolhido; os interruptores só aparecem com Avançado aberto e o banco não aparece (NOD-373)", () => {
    const fechado = renderGeral(d, CONFIG_UI_INICIAL);
    const ordem = ["Aparência", "Avisos", 'id="ajuda"', "Avançado"].map((t) => fechado.indexOf(t));
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(fechado).toContain('aria-expanded="false" aria-controls="lc-sub-avancado"');
    expect(fechado).not.toContain("Banco persistente");
    expect(fechado).not.toContain("alternar-modo-dev");
    const aberto = renderGeral(d, { ...CONFIG_UI_INICIAL, abertos: ["avancado"] });
    expect(aberto).toContain('aria-expanded="true"');
    expect(aberto).not.toMatch(/Banco|Onde o servidor deste nod guarda os dados/);
    expect(aberto).toMatch(/role="switch" aria-checked="true" aria-label="Modo dev" data-act="alternar-modo-dev"/);
    expect(aberto).toMatch(/aria-checked="true" aria-label="Calibração" data-act="alternar-experimento" data-experimento="calibracao"/);
    expect(aberto).toMatch(/aria-checked="false" aria-label="Memória longa" data-act="alternar-experimento" data-experimento="memoriaLonga"/);
    expect(aberto).toMatch(/aria-label="Modo WhatsApp" data-act="alternar-experimento" data-experimento="whatsapp"/);
  });

  it("o atalho ⌘⇧D aparece em Ajuda e continua global no main.ts", () => {
    expect(renderGeral(d, CONFIG_UI_INICIAL, false, "app-mac")).toContain("<kbd>⌘</kbd><kbd>⇧</kbd><kbd>D</kbd>");
    expect(ler("main.ts")).toMatch(/ev\.shiftKey && ev\.key\.toLowerCase\(\) === "d"[^\n]*alternarModoDev/);
  });

  it("NOD-117: o bloco Ajuda é a folha, com os 9 atalhos nas teclas do lugar e texto para leitor de tela", () => {
    const ajudaDe = (html: string) => html.slice(html.indexOf('id="ajuda"'), html.indexOf("Avançado"));
    const titulos = ["Nova conversa (novo bot)", "Ir ao bot 1 a 9 da barra", "Bot anterior e próximo", "Página anterior e próxima do bot", "Mover a página atual na pílula", "Folha de atalhos", "Buscar agentes", "Modo dev", "Fechar e voltar"];
    const casos: [Parameters<typeof renderGeral>[3], string, string][] = [
      ["app-mac", "<kbd>⌘</kbd><kbd>N</kbd>", "Command N"],
      ["navegador-mac", "<kbd>⌃</kbd><kbd>N</kbd>", "Control N"],
      ["outro", "<kbd>Alt</kbd><kbd>N</kbd>", "Alt N"],
    ];
    for (const [lugar, novo, falado] of casos) {
      const ajuda = ajudaDe(renderGeral(d, CONFIG_UI_INICIAL, false, lugar));
      for (const t of titulos) expect(ajuda, `${lugar}: ${t}`).toContain(t);
      expect(ajuda.match(/class="cfg-kbd"/g)).toHaveLength(9);
      expect(ajuda.match(/class="sr-only"/g)).toHaveLength(9);
      expect(ajuda).toContain(novo);
      expect(ajuda).toContain(`<span class="sr-only">${falado}</span>`);
      expect(ajuda).toContain("<kbd>?</kbd> ou ");
    }
    expect(ajudaDe(renderGeral(d, CONFIG_UI_INICIAL, false, "outro"))).toContain("<kbd>Ctrl</kbd><kbd>/</kbd>");
    // No celular não há atalhos.
    expect(ajudaDe(renderGeral(d, CONFIG_UI_INICIAL, true, "app-mac"))).not.toContain("cfg-kbd");
  });

  it("NOD-117: o keydown global chama os atalhos depois de ⌘K e ⌘⇧D, e o + diz o atalho", () => {
    const main = ler("main.ts");
    const k = main.indexOf('ev.key.toLowerCase() === "k") { ev.preventDefault(); abrirBusca()');
    const dev = main.indexOf("void agir(alternarModoDev); return; }");
    const novos = main.indexOf("const atalho = atalhoDoTeclado(teclaSemRepetir, {");
    expect(k).toBeGreaterThan(0);
    expect(dev).toBeGreaterThan(k);
    expect(novos).toBeGreaterThan(dev);
    // O contexto real chega ao atalho: Seu espaço, ditado e diálogo.
    const ctx = main.slice(novos, main.indexOf("});", novos));
    for (const c of ["SELETOR_CAMPO", "SELETOR_MODAL", "espaco: !!estado.espaco", "ditando: ditado.ativo()", "telaOnboarding.cobre()"]) expect(ctx, c).toContain(c);
    expect(main).toMatch(/aria-keyshortcuts="\$\{ATALHO_NOVO_BOT\.aria\} Shift\+Enter Shift\+Space" title="Nova conversa \(\$\{ATALHO_NOVO_BOT\.texto\}\)"/);
  });

  it("toda ação de Geral e de Conta tem tratador no main.ts", () => {
    const main = ler("main.ts");
    const geral = renderGeral(d, { ...CONFIG_UI_INICIAL, abertos: ["avancado"] });
    const conta = renderConta({ contas: true, minhaConta: true, nome: "A", email: "a@x.com", senha: true, legado: false });
    const acoes = new Set([...`${geral}${conta}`.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]!));
    for (const a of acoes) expect(main, a).toMatch(new RegExp(`^\\s+"${a}":`, "m"));
    for (const a of [...geral.matchAll(/data-act-change="([^"]+)"/g)].map((m) => m[1]!)) expect(main).toMatch(new RegExp(`^\\s+"${a}": \\(valor\\)`, "m"));
  });
});

describe("busca sem acento e sem caixa (critério 8)", () => {
  it("normaliza", () => {
    expect(normalizarBusca("  Téo ")).toBe("teo");
    expect(normalizarBusca("CECÍLIA")).toBe(normalizarBusca("cecilia"));
  });
});
