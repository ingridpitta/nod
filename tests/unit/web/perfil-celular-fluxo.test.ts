import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrotaDto, RotinaDto } from "../../../src/contracts/api.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import { criarMarcaDoPerfil, planoDaSaida } from "../../../web/lib/lista-apos-saida.ts";
import { linhaMaquinaDoBot, nivelAjustes } from "../../../web/telas/detalhes.ts";
import { renderListaBiblioteca } from "../../../web/telas/biblioteca.ts";
import { abrirFolhaCompartilhar, confirmarExclusaoNaFolha, corpoDoMenu, itensDoMenuCelular, type BotGerido } from "../../../web/telas/gestao-agentes.ts";
import { perfilAoAbrir, perfilAoAbrirNivel, renderPerfilCelular, saidaDoPerfil, valorRotinas } from "../../../web/telas/perfil-celular.ts";

/**
 * NOD-382, rodada 1 da revisão: o comportamento (não o texto da fonte) da saída do perfil, do toque longo, das folhas de
 * Compartilhar e de Excluir, do erro das rotinas, das rotinas paradas e das descrições de Ajustes no celular.
 */
type AgenteFrota = FrotaDto["agentes"][number];
const nina = (extra: Partial<AgenteFrota> = {}): AgenteFrota => ({ tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "Assistente", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null, ...extra });
const com = (a: AgenteFrota, extra: Partial<Estado> = {}): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [a], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, ...extra } as Estado);
const rotina = (id: string, extra: Record<string, unknown> = {}): RotinaDto => ({ rotina: { id, agenteId: "a1", instrucao: `Rotina ${id}`, estado: "ativa" }, proximaExecucao: 0, bloqueio: null, resumo: "Todo dia às 9:00", ...extra }) as never;
const carregadas = (rotinas: RotinaDto[]): Partial<Estado> => ({ rotinas, carregado: { ...estadoInicial.carregado, rotinas: true } });

describe("saída do perfil (critério 1: ‹ volta à origem; Mensagem fica no chat do bot)", () => {
  const inicio = { tipo: "inicio" } as const;
  it("do chat, o ‹ volta ao chat com o foco na pílula", () => {
    expect(saidaDoPerfil({ agenteId: "a1", origem: "chat" }, "origem")).toEqual({ abrirLista: false, foco: "pilula" });
  });
  it("da lista, o ‹ volta à tela de antes com a lista aberta e o foco na linha do bot", () => {
    expect(saidaDoPerfil({ agenteId: "a1", origem: "lista", voltar: inicio }, "origem")).toEqual({ navegar: inicio, abrirLista: true, foco: "linha-do-bot" });
    expect(saidaDoPerfil({ agenteId: "a1", origem: "lista" }, "origem")).toEqual({ abrirLista: true, foco: "linha-do-bot" });
  });
  it("Mensagem, venha de onde vier, fica no chat do bot: não navega, não abre a lista, foca o campo", () => {
    for (const perfil of [{ agenteId: "a1", origem: "lista" as const, voltar: inicio }, { agenteId: "a1", origem: "chat" as const }]) {
      expect(saidaDoPerfil(perfil, "chat")).toEqual({ abrirLista: false, foco: "composer" });
    }
  });
});

describe("valores e estados (critérios 2 e 8)", () => {
  it("rotina ligada mas parada conta como parada, não como pausada", () => {
    expect(valorRotinas(com(nina(), carregadas([rotina("r1", { bloqueio: { slug: "gmail" } })])), "a1")).toEqual({ tipo: "texto", texto: "1 parada" });
    expect(valorRotinas(com(nina(), carregadas([rotina("r1", { rotina: { id: "r1", agenteId: "a1", instrucao: "x", estado: "pausada" } })])), "a1")).toEqual({ tipo: "texto", texto: "1 pausada" });
  });
  it("uma falha depois de as rotinas carregarem não troca a lista pelo aviso de erro", () => {
    const e = reduzir(com(nina(), carregadas([rotina("r1")])), { tipo: "rotinas-falharam" });
    expect(e.rotinasFalharam).toBe(false);
    expect(renderPerfilCelular({ ...e, gaveta: { agenteId: "a1", nivel: { tipo: "rotinas" } } })).not.toContain("As rotinas não carregaram");
  });
  it("a rotina parada mantém o conserto de um toque (Conectar) no celular", () => {
    const h = renderPerfilCelular({ ...com(nina(), carregadas([rotina("r1", { bloqueio: { slug: "gmail" } })])), gaveta: { agenteId: "a1", nivel: { tipo: "rotinas" } } });
    expect(h).toMatch(/class="pfc-rotina-conserto"><button[^>]*data-act="abrir-conexao"/);
  });
  it("NOD-84: a rotina webhook no celular não diz 'próxima'; mostra o 'quando' do webhook e o '!' da recusa pendente (Codex, revisão)", () => {
    const wh = { prefixo: "Ab3", provedor: "Stripe", eventos: [], chamadasHoje: 0, recusadasHoje: 1, recusaPendente: true, ultimas: [{ id: "c", rotinaId: "r1", em: 0, desfecho: "recusada", motivo: "endereco", evento: null, turnoId: null }] };
    const dto = rotina("r1", { resumo: "Quando o Stripe avisa", webhook: wh, rotina: { id: "r1", agenteId: "a1", instrucao: "Lançar a venda", estado: "ativa", gatilho: "webhook", fusoIana: "America/Sao_Paulo", cron: "0 0 31 2 *" } });
    const h = renderPerfilCelular({ ...com(nina(), carregadas([dto])), gaveta: { agenteId: "a1", nivel: { tipo: "rotinas" } } });
    expect(h).toContain("Quando o Stripe avisa");
    expect(h).not.toContain("próxima");
    expect(h).toContain("chamada recusada");
  });
  it("o avatar do bot da pessoa troca forma e cor; o do bot de outra pessoa não", () => {
    expect(renderPerfilCelular(com(nina()))).toContain('data-act="gaveta-avatar" data-id="a1"');
    expect(renderPerfilCelular(com(nina({ ownerId: "outra" })))).not.toContain("gaveta-avatar");
  });
});

describe("critério 7: Ajustes do celular sem descrições longas em cinza", () => {
  const maquina: MaquinaDto = { id: "vm", nome: "vm-sp", prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false } as MaquinaDto;
  const e = com(nina(), { maquinas: { maquinas: [maquina], padraoId: null } } as Partial<Estado>);
  it("sem o <small> da Máquina, sem a nota do Ambiente e sem a frase longa de Acessos", () => {
    const corpo = nivelAjustes(e, nina(), true, true).corpo;
    expect(corpo).toContain("Máquina");
    expect(corpo).not.toContain("roda o Claude Code ou o Codex");
    expect(corpo).not.toContain("Sua conta de IA");
    expect(corpo).not.toContain("nenhuma ferramenta externa");
    expect(corpo).toContain("Nenhum acesso");
  });
  it("o desktop mantém as descrições", () => {
    const corpo = nivelAjustes(e, nina(), true).corpo;
    expect(corpo).toContain("Sua conta de IA");
    expect(corpo).toContain("nenhuma ferramenta externa");
    expect(linhaMaquinaDoBot(e, nina())).toContain("roda o Claude Code ou o Codex");
  });
});

// ---- as folhas, num DOM de mentira (o unit não tem jsdom) ------------------------------------------------------------
type Ev = { preventDefault: () => void; stopPropagation: () => void; currentTarget: unknown; target: unknown };
class El {
  id = "";
  className = "";
  innerHTML = "";
  textContent = "";
  disabled = false;
  isConnected = true;
  open = false;
  dataset: Record<string, string> = {};
  classList = { add: (c: string) => { this.className += ` ${c}`; } };
  ouvintes: Record<string, ((e: Ev) => void)[]> = {};
  filhos = new Map<string, El>();
  botoes: El[] = [];
  pai: El | null = null;
  setAttribute(): void {}
  querySelector(s: string): El | null { if (s === "h2" || s === "input") return null; let f = this.filhos.get(s); if (!f) { f = new El(); f.pai = this; this.filhos.set(s, f); } return f; }
  querySelectorAll(): El[] { return this.botoes; }
  closest(s: string): El | null { return s === "[data-gestao]" && this.dataset.gestao ? this : null; }
  contains(o: unknown): boolean { return o === this; }
  addEventListener(tipo: string, fn: (e: Ev) => void): void { (this.ouvintes[tipo] ??= []).push(fn); }
  disparar(tipo: string, alvo: El = this): void { for (const fn of this.ouvintes[tipo] ?? []) fn({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: alvo }); }
  focus(): void {}
  remove(): void { this.isConnected = false; }
  showModal(): void { this.open = true; }
  close(): void { if (!this.open) return; this.open = false; setTimeout(() => this.disparar("close"), 0); }
}
const esvaziar = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const gerido = (extra: Partial<BotGerido> = {}) => ({ ...nina(), ...extra }) as never;

describe("as folhas de Compartilhar e de Excluir (critério 5)", () => {
  let criados: El[];
  beforeEach(() => {
    criados = [];
    vi.stubGlobal("document", { activeElement: null, body: { append() {} }, createElement: () => { const e = new El(); criados.push(e); return e; }, getElementById: () => null });
    vi.stubGlobal("HTMLElement", El);
  });
  afterEach(async () => { await esvaziar(); vi.unstubAllGlobals(); });

  it("Excluir: Cancelar fecha sem excluir", async () => {
    const excluir = vi.fn(async () => {});
    confirmarExclusaoNaFolha(gerido(), excluir);
    const d = criados[0]!;
    expect(d.innerHTML).toContain("<h2>Excluir Nina?</h2>");
    d.querySelector("[data-cancelar]")!.disparar("click");
    await esvaziar();
    expect(excluir).not.toHaveBeenCalled();
    expect(d.open).toBe(false);
  });
  it("Excluir: confirmar exclui, fecha e chama o depois", async () => {
    const ordem: string[] = [];
    confirmarExclusaoNaFolha(gerido(), async () => { ordem.push("excluir"); }, (aberto) => ordem.push(`depois:${aberto}`));
    const d = criados[0]!;
    const form = d.querySelector("form")!;
    form.disparar("submit", form);
    await esvaziar();
    expect(ordem).toEqual(["excluir", "depois:true"]);
    expect(d.open).toBe(false);
  });
  it("Excluir: se falha, a folha fica aberta com o erro e os botões voltam", async () => {
    const depois = vi.fn();
    confirmarExclusaoNaFolha(gerido(), async () => { throw new Error("rede"); }, depois);
    const d = criados[0]!;
    const form = d.querySelector("form")!;
    const botao = new El();
    form.botoes = [botao];
    form.disparar("submit", form);
    expect(botao.disabled).toBe(true);
    await esvaziar();
    expect(depois).not.toHaveBeenCalled();
    expect(d.open).toBe(true);
    expect(botao.disabled).toBe(false);
    expect(d.querySelector(".dialogo-erro")!.textContent).toMatch(/Não deu para excluir/);
  });
  it("Compartilhar: Copiar ID e Duplicar no bot da pessoa; o Nod sem Duplicar; tocar executa e fecha", async () => {
    const executar = vi.fn();
    abrirFolhaCompartilhar(gerido(), executar);
    const d = criados[0]!;
    expect(d.innerHTML).toContain('data-gestao="copiar"');
    expect(d.innerHTML).toContain('data-gestao="duplicar"');
    const item = new El();
    item.dataset.gestao = "duplicar";
    d.disparar("click", item);
    expect(executar).toHaveBeenCalledWith("duplicar");
    expect(d.open).toBe(false);
    abrirFolhaCompartilhar(gerido({ papel: "nod" } as Partial<BotGerido>), vi.fn());
    expect(criados[1]!.innerHTML).not.toContain("duplicar");
    // O close do diálogo dispara num setTimeout: drena antes de o afterEach tirar o document.
    await esvaziar();
  });
});

describe("revisão 2: ocultar, arrasto, Tentar de novo e o CSS no bloco do celular", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("ocultar fecha o perfil, volta à lista e avisa como o desktop; tocar de novo num bot já oculto não reexibe", () => {
    const bloco = main.slice(main.indexOf('"perfil-ocultar": (el) => {'), main.indexOf('"perfil-copiar-pasta"'));
    expect(bloco).toContain("if (!a || a.oculto ||");
    expect(bloco).toContain("api!.ocultar(a.id, true)");
    expect(bloco).not.toContain("ocultar(a.id, false)");
    const sai = bloco.indexOf("sairDoPerfilDoBotQueSaiu(a, perfil, marca)");
    const avisa = bloco.indexOf('depoisDeTirarDaLista(a, "Ocultos")(false)');
    expect(sai).toBeGreaterThanOrEqual(0);
    expect(avisa).toBeGreaterThan(sai);
    const sair = main.slice(main.indexOf("function sairDoPerfilDoBotQueSaiu"));
    expect(sair.slice(0, sair.indexOf("\n}"))).toContain("celular.voltarAoInicio()");
  });
  it("no celular a linha do bot não é arrastável (o arrasto nativo cancela o toque longo)", () => {
    // A regra é da NOD-379 (ehCelular aqui é o celular.ativo() local da barra).
    expect(main).toMatch(/const arrastavel = [^\n]*\(ehCelular \? "" :/);
  });
  it("Tentar de novo volta ao carregando", () => {
    const e = reduzir(com(nina()), { tipo: "rotinas-falharam" });
    expect(reduzir(e, { tipo: "rotinas-tentando" }).rotinasFalharam).toBe(false);
    expect(main).toContain('"perfil-tentar-rotinas": () => { dispatch({ tipo: "rotinas-tentando" }); dispatch({ tipo: "invalidar", quais: ["rotinas"] }); }');
    // Sem rotinas carregadas (o único caso do erro), a tela pede a releitura sozinha.
    expect(invalidacoesDaTela({ ...e, rotinasFalharam: false })).toContain("rotinas");
  });
  it("todas as regras .pfc-* do mobile.css estão dentro do @media do celular", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    let nivel = 0;
    let dentroDoCelular = false;
    let fora = 0;
    const re = /@media[^{]*\{|\{|\}|\.pfc-[a-z-]+/g;
    for (const m of css.matchAll(re)) {
      const t = m[0];
      if (t.startsWith("@media")) { if (nivel === 0) dentroDoCelular = t.slice(6, -1).trim() === CONSULTA_CELULAR; nivel++; }
      else if (t === "{") nivel++;
      else if (t === "}") { nivel--; if (nivel === 0) dentroDoCelular = false; }
      else if (!dentroDoCelular) fora++;
    }
    expect(fora).toBe(0);
    expect(css).toMatch(/\.pfc-[a-z-]+/);
  });
  it("avisos e explicações dentro do perfil ficam sem fundo chapado", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toContain(".detalhes:has(.pfc-corpo) :is(.gv-aviso, .ia-comando, .ia-explica) { background: none; border: 0; color: var(--ink-2); }");
  });
});

describe("revisão 3: a lista fica aberta depois de excluir/ocultar, atalhos do chat e a Biblioteca do celular", () => {
  it("main.ts: a saída da conversa pela frota não fecha a inicial que o perfil abriu (NOD-379); a volta passa pelo histórico", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const red = main.slice(main.indexOf("function reduzirVendoSaida"), main.indexOf("function depoisDeSair"));
    expect(red.slice(red.indexOf("if (!saiu) return false;"))).not.toContain("celular.fecharBots()");
    const sair = main.slice(main.indexOf("function sairDoPerfilDoBotQueSaiu"), main.indexOf("function excluirNoCelular"));
    expect(sair).toContain("celular.voltarAoInicio();");
    expect(sair).not.toContain("celular.abrirBots()");
    const abrir = main.slice(main.indexOf("function abrirPerfil"), main.indexOf("function fecharPerfil"));
    expect(abrir).toContain("else celular.entrarNaConversa();");
  });
  it("um atalho do chat que abre um nível no celular abre o perfil do bot com origem no chat; no desktop, nada", () => {
    expect(perfilAoAbrirNivel(null, "a1", true)).toEqual({ agenteId: "a1", origem: "chat" });
    const lista = { agenteId: "a1", origem: "lista" as const };
    expect(perfilAoAbrirNivel(lista, "a1", true)).toBe(lista);
    expect(perfilAoAbrirNivel(lista, "a2", true)).toEqual({ agenteId: "a2", origem: "chat" });
    expect(perfilAoAbrirNivel(null, "a1", false)).toBeNull();
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const abrir = main.slice(main.indexOf("function abrirNivel("), main.indexOf("function abrirPerfil("));
    expect(abrir).toContain("perfilAoAbrirNivel(estado.perfilCelular, a.id, ehCelular())");
  });
  it("Biblioteca no celular: vazio só com o título; erro com — · Tentar de novo de 44 px; o desktop igual", () => {
    const ctx = { conversaId: "c1", url: (id: string) => id, bot: "Nina", sumiram: new Set<string>(), agora: 0 };
    const vazia = { itens: [], proximo: null, erro: false, carregandoMais: false, mostrando: {} } as never;
    const erro = { itens: [], proximo: null, erro: true, carregandoMais: false, mostrando: {} } as never;
    expect(renderListaBiblioteca(vazia, { ...ctx, celular: true })).toBe('<div class="pfc-vazio"><b>Nenhum arquivo ainda</b></div>');
    expect(renderListaBiblioteca(erro, { ...ctx, celular: true })).toContain('class="pfc-link" data-act="biblioteca-tentar" data-id="c1">Tentar de novo');
    expect(renderListaBiblioteca(vazia, ctx)).toContain("Os arquivos que Nina criar aparecem aqui.");
    expect(renderListaBiblioteca(erro, ctx)).toContain('class="bt sm" data-act="biblioteca-tentar"');
  });
});

describe("revisão 4: bot oculto, Seu espaço e Ir para a mensagem", () => {
  it("no celular, o bot oculto da pessoa tem Mostrar na lista e Excluir (sem Ver perfil: ele não está na frota)", () => {
    expect(itensDoMenuCelular(nina({ oculto: true }), true)).toEqual(["ocultar", "excluir"]);
    const h = corpoDoMenu(nina({ oculto: true }) as never, true, true);
    expect(h).toContain('data-gestao="ocultar"');
    expect(h).toContain("Mostrar na lista");
    expect(h).not.toContain('data-gestao="ver-perfil"');
    // O de outra pessoa e o Nod seguem como antes; o desktop do oculto, também.
    expect(itensDoMenuCelular(nina({ oculto: true, ownerId: "outra" }), false)).toEqual(["ver-perfil"]);
    expect(corpoDoMenu(nina({ oculto: true }) as never, true, false)).toContain("Mostrar na barra lateral");
  });
  it("de Configurações › Agentes, o perfil guarda a seção e o ‹ reabre Seu espaço", () => {
    const tela = { tipo: "conversa", conversaId: "c9", agenteId: "a9" } as const;
    const p = perfilAoAbrir({ agenteId: "a1", tela, lista: false, espaco: "agentes" });
    expect(p).toEqual({ agenteId: "a1", origem: "espaco", espaco: "agentes", voltar: tela });
    expect(saidaDoPerfil(p, "origem")).toEqual({ navegar: tela, abrirLista: false, abrirEspaco: "agentes", foco: "espaco" });
    expect(saidaDoPerfil(p, "chat")).toEqual({ abrirLista: false, foco: "composer" });
  });
  it("da lista e do chat, a origem de sempre; sem voltar quando a tela já é a do bot", () => {
    const doBot = { tipo: "conversa", conversaId: "c1", agenteId: "a1" } as const;
    const outra = { tipo: "inicio" } as never;
    expect(perfilAoAbrir({ agenteId: "a1", tela: outra, lista: true, espaco: null })).toEqual({ agenteId: "a1", origem: "lista", voltar: outra });
    expect(perfilAoAbrir({ agenteId: "a1", tela: doBot, lista: true, espaco: null })).toEqual({ agenteId: "a1", origem: "lista" });
    expect(perfilAoAbrir({ agenteId: "a1", tela: doBot, lista: false, espaco: null })).toEqual({ agenteId: "a1", origem: "chat" });
  });
  it("main.ts: abrir o perfil fecha Seu espaço antes; fechar reabre; Ir para a mensagem fecha o perfil com o estado", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const abrir = main.slice(main.indexOf("function abrirPerfil("), main.indexOf("function fecharPerfil("));
    expect(abrir).toContain("if (estado.espaco) fecharEspaco();");
    const fechar = main.slice(main.indexOf("function fecharPerfil("), main.indexOf("function sairDoPerfilDoBotQueSaiu"));
    expect(fechar).toContain("if (saida.abrirEspaco) { abrirEspaco(saida.abrirEspaco); return; }");
    expect(main).toContain('if (ehCelular() && estado.perfilCelular) fecharPerfil("chat", false);');
  });
});

describe("revisão 5: Seu espaço ao sair, o resumo das rotinas e o — da tela Computador", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("excluir/ocultar com o perfil vindo de Seu espaço volta a Seu espaço, sem abrir a lista por baixo", () => {
    const sair = main.slice(main.indexOf("function sairDoPerfilDoBotQueSaiu"), main.indexOf("function excluirNoCelular"));
    // O comportamento está em planoDaSaida (revisão 8); aqui, que main.ts sai antes de abrir a lista.
    const espaco = sair.indexOf("if (!plano.abrirLista) return;");
    expect(espaco).toBeGreaterThanOrEqual(0);
    expect(sair.indexOf("celular.voltarAoInicio()")).toBeGreaterThan(espaco);
    // O foco do Excluir é calculado depois de fechar o perfil.
    expect(main).toContain('(aberto) => depoisDeTirarDaLista(a, "Excluídos")(aberto));');
  });
  it("ativas e paradas aparecem juntas; só paradas, só elas", () => {
    const e = com(nina(), { rotinas: [rotina("r1"), rotina("r2"), rotina("r3", { bloqueio: { tipo: "x" } })], carregado: { ...estadoInicial.carregado, rotinas: true } } as never);
    expect(valorRotinas(e, "a1")).toEqual({ tipo: "texto", texto: "2 ativas · 1 parada" });
  });
});

describe("revisão 7: excluir/ocultar com o perfil fechado ou zerado pela frota no meio do pedido", () => {
  it("a frota que zera o perfil antes da resposta não conta: a pessoa ainda vai para a lista", () => {
    const m = criarMarcaDoPerfil();
    const marca = m.marca();
    // reduzirVendoSaida zera estado.perfilCelular sem passar por fecharPerfil: nada a marcar.
    expect(m.intacto(marca)).toBe(true);
  });
  it("a pessoa fechou ou abriu outro perfil no meio do pedido: fica onde está", () => {
    const m = criarMarcaDoPerfil();
    const marca = m.marca();
    m.mexeu();
    expect(m.intacto(marca)).toBe(false);
    expect(m.intacto(m.marca())).toBe(true);
  });
  it("main.ts mexe na marca ao abrir e ao fechar o perfil, e a saída a confere", () => {
    const main = readFileSync("web/main.ts", "utf8");
    const corpo = (nome: string) => main.slice(main.indexOf(`function ${nome}(`), main.indexOf(`function ${nome}(`) + 900);
    expect(corpo("abrirPerfil")).toContain("marcaDoPerfil.mexeu();");
    expect(corpo("fecharPerfil")).toContain("marcaDoPerfil.mexeu();");
    expect(corpo("excluirNoCelular")).toContain("sairDoPerfilDoBotQueSaiu(a, perfil, marca)");
    expect(corpo("excluirNoCelular")).not.toContain("mudarGestao");
  });
});

describe("revisão 8: a saída do perfil depois de excluir/ocultar, nas três ordens", () => {
  const daLista = { agenteId: "a1", origem: "lista" as const };
  const doEspaco = { agenteId: "a1", origem: "espaco" as const, espaco: "agentes" as const };
  it("REST antes do SSE: o perfil ainda aberto fecha e a lista abre", () => {
    expect(planoDaSaida("a1", daLista, true, "a1", false)).toEqual({ fecharPerfil: true, limparPainel: false, abrirEspaco: null, abrirLista: true });
  });
  it("SSE antes do REST: a frota já zerou o perfil; limpa o painel e a lista abre mesmo assim", () => {
    expect(planoDaSaida("a1", daLista, true, null, false)).toEqual({ fecharPerfil: false, limparPainel: true, abrirEspaco: null, abrirLista: true });
  });
  it("outro perfil aberto ou o perfil fechado pela pessoa no meio: fica onde está", () => {
    expect(planoDaSaida("a1", daLista, false, "a2", false)).toBeNull();
    expect(planoDaSaida("a1", daLista, false, null, false)).toBeNull();
  });
  it("sem perfil do bot no início do pedido (excluiu pelo menu): nada a fazer", () => {
    expect(planoDaSaida("a1", null, true, null, false)).toBeNull();
    expect(planoDaSaida("a1", { agenteId: "a2", origem: "lista" }, true, "a2", false)).toBeNull();
  });
  it("veio de Seu espaço: volta a ele, sem abrir a lista; o fecharPerfil já reabre quando o perfil estava aberto", () => {
    expect(planoDaSaida("a1", doEspaco, true, "a1", false)).toEqual({ fecharPerfil: true, limparPainel: false, abrirEspaco: null, abrirLista: false });
    expect(planoDaSaida("a1", doEspaco, true, null, false)).toEqual({ fecharPerfil: false, limparPainel: true, abrirEspaco: "agentes", abrirLista: false });
    expect(planoDaSaida("a1", doEspaco, true, null, true)?.abrirEspaco).toBeNull();
  });
});

describe("revisão 9: as classes do perfil não colidem com as das telas do computador", () => {
  it("nenhuma classe .pfc-* do mobile.css existe em outro CSS, e o perfil não usa o prefixo pc- do computador", async () => {
    const { readdirSync } = await import("node:fs");
    const outros = readdirSync("web").filter((f) => f.endsWith(".css") && f !== "mobile.css" && f !== "navegacao.css").map((f) => readFileSync(`web/${f}`, "utf8")).join("\n");
    const doPerfil = new Set(readFileSync("web/mobile.css", "utf8").match(/\.pfc-[a-z0-9-]+/g) ?? []);
    expect(doPerfil.size).toBeGreaterThan(20);
    for (const c of doPerfil) expect(outros).not.toContain(c);
    // Seu espaço › Computador usa .pc-acao e .pc-vazio (computador-do-bot.css): o perfil não os desenha nem os estiliza.
    const perfil = readFileSync("web/telas/perfil-celular.ts", "utf8");
    expect(perfil).not.toMatch(/(?<![\w-])pc-[a-z]/);
    expect(readFileSync("web/mobile.css", "utf8")).not.toMatch(/\.pc-(acao|vazio|rotulo|titulo|cancelar|acoes)\b/);
  });
});

describe("QA: alvos de 44 px que faltavam e o toque longo que não abriu", () => {
  it("os itens do menu do toque longo e as linhas de Ajustes do perfil têm alvo de 44 / 52 px no celular", () => {
    const css = readFileSync("web/mobile.css", "utf8");
    const bloco = css.slice(css.indexOf("NOD-382: o perfil do bot no celular"));
    // :where: não passa por cima dos 48 px do menu segurado (NOD-379) nem dos 56 px da folha.
    expect(bloco).toContain(':where(dialog#gestao-dialogo) [role="menu"] [data-gestao] { min-height: 44px; }');
    expect(bloco).toContain(".com-detalhes.detalhes-abertos .detalhes:has(.pfc-corpo) .gv-linha { min-height: 52px; }");
  });
});
