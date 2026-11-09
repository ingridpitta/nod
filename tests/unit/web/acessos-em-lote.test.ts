import { beforeEach, describe, expect, it } from "vitest";
import type { Conector } from "../../../src/contracts/conector.ts";
import { acessosNaTela, chaveDoClique, criarAcessosOtimistas, PRAZO_CONFIRMADO_MS } from "../../../web/lib/acessos-otimistas.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { caixaDoBot, gavetaDeAcessos, loteDeEscritaPedeConfirmacao } from "../../../web/telas/acessos-do-app.ts";
import { nivelDoBot } from "../../../web/telas/app-acesso.ts";
import { renderConectores } from "../../../web/telas/conectores.ts";

/** ADA-241 (ADR-158): o clique otimista, a seleção, o padrão do app e a confirmação de Ler e alterar na gaveta. */

const ANA = { agenteId: "a1", conectorId: "c-gmail" };
const BETO = { agenteId: "a2", conectorId: "c-gmail" };

describe("camada otimista (critério 3)", () => {
  it("mostra o pedido na hora; o real volta quando confirma e a recarga bate", () => {
    const o = criarAcessosOtimistas();
    const s = o.marcar([ANA], "leitura");
    expect(o.nivel(ANA, "nenhum", 0)).toBe("leitura");
    expect(o.pendente("c-gmail")).toBe(true);
    o.confirmar([ANA], s, 10);
    expect(o.pendente("c-gmail")).toBe(false);
    // Entre a resposta e a recarga, o real velho não pisca.
    expect(o.nivel(ANA, "nenhum", 20)).toBe("leitura");
    expect(o.nivel(ANA, "leitura", 30)).toBe("leitura");
    // Depois de limpo, o real manda.
    expect(o.nivel(ANA, "escrita", 40)).toBe("escrita");
  });

  it("confirmado e outro caminho mudou no meio: depois do prazo o real vence", () => {
    const o = criarAcessosOtimistas();
    const s = o.marcar([ANA], "leitura");
    o.confirmar([ANA], s, 0);
    expect(o.nivel(ANA, "personalizado", PRAZO_CONFIRMADO_MS)).toBe("leitura");
    expect(o.nivel(ANA, "personalizado", PRAZO_CONFIRMADO_MS + 1)).toBe("personalizado");
  });

  it("erro: volta ao real e diz que voltou; o último clique vence a resposta atrasada do primeiro", () => {
    const o = criarAcessosOtimistas();
    const s1 = o.marcar([ANA, BETO], "leitura");
    const s2 = o.marcar([ANA], "escrita");
    // O primeiro falha: Ana é do segundo clique e fica; Beto volta.
    expect(o.reverter([ANA, BETO], s1)).toBe(true);
    expect(o.nivel(ANA, "nenhum", 0)).toBe("escrita");
    expect(o.nivel(BETO, "nenhum", 0)).toBe("nenhum");
    // A confirmação atrasada do primeiro não mexe na Ana.
    o.confirmar([ANA], s1, 0);
    expect(o.pendente("c-gmail")).toBe(true);
    expect(o.reverter([ANA], s2)).toBe(true);
    expect(o.reverter([ANA], s2)).toBe(false);
    expect(o.nivel(ANA, "nenhum", 0)).toBe("nenhum");
  });

  it("revisão independente do PR #706: o pedido do segundo clique no mesmo par só sai depois do primeiro responder (o servidor aplica na ordem: o último clique vence lá também)", async () => {
    const o = criarAcessosOtimistas();
    const ordem: string[] = [];
    let soltar1!: () => void;
    const p1 = o.emOrdem([ANA, BETO], () => { ordem.push("1:saiu"); return new Promise<void>((ok) => (soltar1 = () => { ordem.push("1:voltou"); ok(); })); });
    const p2 = o.emOrdem([ANA], async () => { ordem.push("2:saiu"); });
    // Outro par não espera.
    const p3 = o.emOrdem([{ agenteId: "a3", conectorId: "c-gmail" }], async () => { ordem.push("3:saiu"); });
    await p3;
    await new Promise((ok) => setTimeout(ok, 0));
    expect(ordem).toEqual(["1:saiu", "3:saiu"]);
    soltar1();
    await Promise.all([p1, p2]);
    expect(ordem).toEqual(["1:saiu", "3:saiu", "1:voltou", "2:saiu"]);
    // O erro do primeiro não impede o seguinte de sair, e chega a quem pediu.
    const e1 = o.emOrdem([ANA], async () => { throw new Error("falhou"); });
    const e2 = o.emOrdem([ANA], async () => "ok");
    await expect(e1).rejects.toThrow("falhou");
    await expect(e2).resolves.toBe("ok");
  });

  it("a chave do clique cabe na regra do servidor (8 a 80 de [A-Za-z0-9:_-]) e muda a cada clique", () => {
    const a = chaveDoClique();
    expect(a).toMatch(/^[A-Za-z0-9:_-]{8,80}$/);
    expect(chaveDoClique(() => 0, 0)).toMatch(/^[A-Za-z0-9:_-]{8,80}$/);
    expect(chaveDoClique()).not.toBe(a);
  });
});

const conector: Conector = {
  tenantId: "t", id: "c-gmail", ownerId: "p", visibility: "privado", nome: "gmail", slug: "gmail", transporte: "http", comando: null, args: [], url: "https://x/mcp", env: {}, declaracao: "toca",
  habilitado: true, catalogo: [{ nome: "GMAIL_LER", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }, { nome: "GMAIL_ENVIAR", descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" }],
  sondadoEm: 100, ultimaFalha: null, criadoEm: 0,
};
const bot = (id: string, nome: string) => ({ id, tenantId: "t", ownerId: "p", nome, titulo: "", descricao: "", cor: "c-black", forma: "quadrado", conversaId: `c-${id}`, confirmado: true });
const base: Estado = {
  ...estadoInicial,
  agora: 10_000,
  sessao: { tenantId: "t", pessoaId: "p" },
  tela: { tipo: "conectores", gaveta: { slug: "gmail", passo: "quem-usa" } },
  frota: { agentes: [bot("a1", "Ana"), bot("a2", "Beto"), bot("a3", "Caio")], negacoes: [] } as never,
  marketplace: [{ slug: "gmail", nome: "Gmail", descricao: "E-mails.", categoria: "Comunicação", logo: null }],
  composioConfigurado: true,
  conectores: [conector],
  concessoes: { a1: [{ tenantId: "t", id: "g1", agenteId: "a1", conectorId: "c-gmail", capacidade: "GMAIL_LER", criadoEm: 0 } as never] },
};

describe("gaveta Quem pode usar (critérios 1, 2 e 5)", () => {
  beforeEach(() => {
    gavetaDeAcessos.limpar("c-gmail");
    gavetaDeAcessos.esquecer("c-gmail");
    gavetaDeAcessos.pedirConfirmacao(null);
  });

  it("caixinha por bot, Selecionar todos e a barra Aplicar a todos; com seleção, Aplicar a N selecionados", () => {
    let html = renderConectores(base);
    expect(html).toContain('aria-label="Selecionar Ana"');
    expect(html).toContain('data-act="selecionar-todos-acessos"');
    expect(html).toContain("Aplicar a todos:");
    expect(html.match(/data-act="lote-acesso"/g)).toHaveLength(3);
    gavetaDeAcessos.alternar("c-gmail", "a1");
    gavetaDeAcessos.alternar("c-gmail", "a2");
    html = renderConectores(base);
    expect(html).toContain("Aplicar a 2 selecionados:");
    expect(html).toContain('data-misto="1"');
    gavetaDeAcessos.alternarTodos("c-gmail", ["a1", "a2", "a3"]);
    expect([...gavetaDeAcessos.selecao("c-gmail")].sort()).toEqual(["a1", "a2", "a3"]);
    gavetaDeAcessos.alternarTodos("c-gmail", ["a1", "a2", "a3"]);
    expect(gavetaDeAcessos.selecao("c-gmail").size).toBe(0);
  });

  it("Bots novos começam com: acende o padrão carregado e marca quem segue o padrão", () => {
    let html = renderConectores(base);
    expect(html).toContain("Bots novos começam com");
    expect(html).toContain('aria-busy="true"');
    gavetaDeAcessos.guardar("c-gmail", { padrao: "leitura", seguePadrao: new Set(["a3"]) });
    html = renderConectores(base);
    expect(html).toMatch(/class="seg ativo" data-act="padrao-app" data-conector="c-gmail" data-nivel="leitura" aria-pressed="true"/);
    expect(html).toContain("Segue o padrão do app");
  });

  it("Ler e alterar em lote troca a barra pela confirmação (alertdialog, Liberar com o foco, Cancelar com Esc)", () => {
    gavetaDeAcessos.pedirConfirmacao({ conectorId: "c-gmail", alvo: "lote", bots: "todos" });
    const html = renderConectores(base);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Liberar Ler e alterar no Gmail para 3 bots?");
    expect(html).toContain('data-act="confirmar-escrita"');
    expect(html).toContain('aria-keyshortcuts="Escape"');
    expect(html).not.toContain('data-act="lote-acesso"');
    gavetaDeAcessos.pedirConfirmacao({ conectorId: "c-gmail", alvo: "padrao", bots: "todos" });
    expect(renderConectores(base)).toContain("para os bots novos e quem segue o padrão?");
  });

  it("o clique otimista aparece no segmentado da linha antes do servidor", () => {
    expect(nivelDoBot(base, "a2", conector)).toBe("nenhum");
    const s = acessosNaTela.marcar([BETO], "escrita");
    expect(nivelDoBot(base, "a2", conector)).toBe("escrita");
    expect(renderConectores(base)).toMatch(/class="seg ativo" data-act="nivel-bot" data-id="a2" data-conector="c-gmail" data-nivel="escrita"/);
    acessosNaTela.reverter([BETO], s);
    expect(nivelDoBot(base, "a2", conector)).toBe("nenhum");
  });
});

describe("gaveta Quem pode usar: revisão do PR #706", () => {
  it("fechar e reabrir a gaveta busca o padrão de novo (o chat ou outra aba podem ter mudado)", () => {
    gavetaDeAcessos.abrir("c-x");
    expect(gavetaDeAcessos.precisaCarregar("c-x")).toBe(true);
    gavetaDeAcessos.guardar("c-x", { padrao: "nenhum", seguePadrao: new Set() });
    // Re-render com a mesma gaveta aberta: usa o carregado.
    gavetaDeAcessos.abrir("c-x");
    expect(gavetaDeAcessos.precisaCarregar("c-x")).toBe(false);
    // Fechou e reabriu: busca de novo.
    gavetaDeAcessos.abrir(null);
    gavetaDeAcessos.abrir("c-x");
    expect(gavetaDeAcessos.acessos("c-x")).toBeNull();
    expect(gavetaDeAcessos.precisaCarregar("c-x")).toBe(true);
  });

  it("a caixinha do bot tem um alvo de toque que a envolve (44×44 no celular, ADR-094)", () => {
    const html = caixaDoBot("c-x", "a1", "Ana");
    expect(html).toMatch(/^<label class="acessos-caixa-alvo">\s*<input type="checkbox" class="acessos-caixa"[^>]*\/>\s*<\/label>$/);
  });
});

describe("QA do PR #706: quem decide a confirmação do lote na tela (critério 5)", () => {
  it("Ler e alterar para todos ou para vários selecionados pede confirmação; Ler, Nenhum e um bot só não pedem", () => {
    expect(loteDeEscritaPedeConfirmacao("escrita", "todos", 3)).toBe(true);
    expect(loteDeEscritaPedeConfirmacao("escrita", ["a1", "a2"], 3)).toBe(true);
    expect(loteDeEscritaPedeConfirmacao("escrita", ["a1"], 3)).toBe(false);
    expect(loteDeEscritaPedeConfirmacao("escrita", "todos", 1)).toBe(false);
    expect(loteDeEscritaPedeConfirmacao("leitura", "todos", 3)).toBe(false);
    expect(loteDeEscritaPedeConfirmacao("nenhum", ["a1", "a2"], 3)).toBe(false);
  });
});
