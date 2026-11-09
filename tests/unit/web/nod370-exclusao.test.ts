import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";

type Agente = FrotaDto["agentes"][number];

const base: Agente = {
  tenantId: "t",
  id: "a1",
  ownerId: "p",
  visibility: "privado",
  nome: "LGPD",
  titulo: "",
  descricao: "x",
  dono: "pessoa",
  forma: "shape-square",
  cor: "c-pink",
  fixado: false,
  oculto: false,
  confirmado: true,
  modelo: "claude-haiku-4-5-20251001",
  duplicadoDe: null,
  criadoEm: 1,
  conversaId: "c1",
  descricaoEstado: "",
  computadorForaDoAr: null,
  ultimaMensagem: null,
};
const a2: Agente = { ...base, id: "a2", nome: "Outro", conversaId: "c2" };
const frotaCom = (...agentes: Agente[]): FrotaDto => ({ agentes, inventario: { estado: "pronto", versao: "v", em: 1 }, negacoes: [] });

/** A pessoa na conversa do a1, com Seu espaço › Agentes aberto por cima e a gaveta do a1 aberta. */
function naConversaDoA1ComAgentesAberto(): Estado {
  let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
  e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(base, a2) });
  e = reduzir(e, { tipo: "navegar", tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } });
  e = { ...e, gaveta: { agenteId: "a1", nivel: { tipo: "memoria" } as never } };
  return reduzir(e, { tipo: "espaco", secao: "agentes" });
}

describe("NOD-370: excluir ou ocultar o bot da conversa aberta", () => {
  it("a frota nova sem o bot leva a conversa de baixo para Início e mantém Seu espaço › Agentes aberto", () => {
    const e = reduzir(naConversaDoA1ComAgentesAberto(), { tipo: "hidratar-frota", frota: frotaCom(a2) });
    expect(e.tela).toEqual({ tipo: "conversa", conversaId: "c2", agenteId: "a2" });
    expect(e.espaco).toEqual({ secao: "agentes" });
    expect(e.gaveta).toBeNull();
    expect(e.frota?.agentes.map((a) => a.id)).toEqual(["a2"]);
  });

  it("a gestão que chega antes, com o bot excluído, já tira a pessoa da conversa sem escolher o próprio bot", () => {
    const e0 = naConversaDoA1ComAgentesAberto();
    const gestao = frotaCom({ ...base, excluidoEm: 5 }, a2);
    const e = reduzir(e0, { tipo: "hidratar-gestao", gestao });
    expect(e.tela).toEqual({ tipo: "conversa", conversaId: "c2", agenteId: "a2" });
    expect(e.espaco).toEqual({ secao: "agentes" });
    expect(e.gestao).toBe(gestao);
    // A frota velha fica como estava até a nova chegar.
    expect(e.frota?.agentes.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("pela barra lateral, sem Seu espaço aberto, a conversa vai para Início e Seu espaço continua fechado", () => {
    let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(base, a2) });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } });
    e = { ...e, avatarAberto: "menu" as never, novasDesde: { c1: 3 } as never };
    e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(a2) });
    expect(e.espaco).toBeNull();
    expect(e.tela).toEqual({ tipo: "conversa", conversaId: "c2", agenteId: "a2" });
    // O que `navegar` limparia ao sair da conversa também é limpo.
    expect(e.avatarAberto).toBeNull();
    expect(e.novasDesde).toEqual({});
  });

  it("a task aberta por cima da conversa do bot que saiu volta para Início, não para a conversa morta", () => {
    let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(base, a2) });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "trabalho", id: "w1", voltar: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } } });
    const depois = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(a2) });
    expect(depois.tela).toEqual({ tipo: "trabalho", id: "w1", voltar: { tipo: "inicio" } });
    // A de outro bot não muda.
    const outro = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(base) });
    expect(outro.tela).toEqual(e.tela);
  });

  it("o voltar de vários níveis (Conectores › task › conversa do bot que saiu) também passa a dar em Início", () => {
    let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(base, a2) });
    const task = { tipo: "trabalho", id: "w1", voltar: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } } as const;
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "conectores", voltar: task } as never });
    const depois = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(a2) });
    expect(depois.tela).toEqual({ tipo: "conectores", voltar: { tipo: "trabalho", id: "w1", voltar: { tipo: "inicio" } } });
  });

  it("sem outro bot próprio, Início abre Novo bot", () => {
    let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom(base) });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } });
    e = reduzir(e, { tipo: "espaco", secao: "agentes" });
    e = reduzir(e, { tipo: "hidratar-frota", frota: frotaCom() });
    expect(e.tela).toEqual({ tipo: "novo-bot" });
    expect(e.espaco).toEqual({ secao: "agentes" });
  });

  it("ocultar outro bot ou um bot recém-criado fora da frota velha não mexe na conversa aberta", () => {
    const e0 = naConversaDoA1ComAgentesAberto();
    const e = reduzir(e0, { tipo: "hidratar-frota", frota: frotaCom(base) });
    expect(e.tela).toEqual({ tipo: "conversa", conversaId: "c1", agenteId: "a1" });
    expect(e.gaveta?.agenteId).toBe("a1");
    // Conversa de um bot que a frota ainda não trazia (recém-criado): a frota nova sem ele não é saída.
    const novo = reduzir({ ...e0, tela: { tipo: "conversa", conversaId: "c9", agenteId: "a9" } }, { tipo: "hidratar-frota", frota: frotaCom(base, a2) });
    expect(novo.tela).toEqual({ tipo: "conversa", conversaId: "c9", agenteId: "a9" });
    const gestaoSemExcluir = reduzir(e0, { tipo: "hidratar-gestao", gestao: frotaCom({ ...base, excluidoEm: null }, a2) });
    expect(gestaoSemExcluir.tela).toEqual({ tipo: "conversa", conversaId: "c1", agenteId: "a1" });
  });
});

describe("NOD-370: a fiação em main.ts", () => {
  const ler = async (rel: string) => (await import("node:fs")).readFileSync(new URL(rel, import.meta.url), "utf8");
  const corpo = (fonte: string, inicio: string) => {
    const i = fonte.indexOf(inicio);
    expect(i, inicio).toBeGreaterThanOrEqual(0);
    const fim = fonte.indexOf("\n}\n", i);
    return fonte.slice(i, fim < 0 ? undefined : fim);
  };

  it("Excluir e Ocultar não abrem Seu espaço por nenhum caminho (critério 2): nem o confirmar, nem o depois, nem a releitura", async () => {
    const main = await ler("../../../web/main.ts");
    const bloco = (acao: string) => main.slice(main.indexOf(`if (acao === "${acao}"`), main.indexOf("return;", main.indexOf(`if (acao === "${acao}"`)));
    const caminhos = [bloco("excluir"), bloco("ocultar"), corpo(main, "async function mudarGestao("), corpo(main, "function depoisDeTirarDaLista("), corpo(main, "function reduzirVendoSaida(")];
    for (const c of caminhos) {
      expect(c).not.toContain("abrirEspaco(");
      expect(c).not.toMatch(/tipo: "espaco"/);
      expect(c).not.toContain("navegar(");
    }
    expect(bloco("excluir")).toContain('depoisDeTirarDaLista(a, "Excluídos")');
    expect(bloco("ocultar")).toContain('depoisDeTirarDaLista(a, "Ocultos")');
  });

  it("a rolagem é guardada no elemento que rola de Seu espaço, e o foco pendente é aplicado a cada desenho (critério 1)", async () => {
    const [main, espaco, css] = await Promise.all([ler("../../../web/main.ts"), ler("../../../web/telas/espaco.ts"), ler("../../../web/navegacao.css")]);
    expect(main).toMatch(/regiaoReabrindo\("espaco", estado\.espaco \? renderEspaco\([\s\S]{0,400}?\) : "", \{ seletor: "\.espaco-conteudo", chave: secaoAberta\(estado\) === "agentes" \|\| secaoAberta\(estado\) === "rotinas" \? secaoAberta\(estado\) : null \}\);/);
    expect(espaco).toContain('<main class="espaco-conteudo">');
    expect(css).toMatch(/\.espaco-conteudo \{[^}]*overflow: auto/);
    expect(corpo(main, "function render(): void {")).toMatch(/focoPendente\.aplicar\(\);\s*$/);
  });

  it("a ligação passa à lista o Agentes aberto de verdade e o grupo da ação ao anúncio (QA: mutantes M6 e M8)", async () => {
    const main = await ler("../../../web/main.ts");
    const fiacao = corpo(main, "function depoisDeTirarDaLista(");
    // NOD-383: a lista do celular não é o Agentes aberto (secaoAberta é null nela).
    expect(fiacao).toContain('agentesAberto: secaoAberta(estado) === "agentes"');
    expect(fiacao).toMatch(/nome: a\.nome, grupo, anunciar: anunciarGestao/);
    expect(fiacao).toMatch(/function depoisDeTirarDaLista\(a: BotGerido, grupo: "Excluídos" \| "Ocultos"\)/);
  });

  it("Esc com o confirmar aberto (o foco no <body> enquanto o pedido anda) não fecha Seu espaço por trás dele (QA)", async () => {
    const main = await ler("../../../web/main.ts");
    // NOD-383: o bloco do Esc ganhou o ramo do celular (volta para a lista); a guarda do diálogo é a mesma.
    const linha = main.split("\n").find((l) => l.includes('ev.key === "Escape" && estado.espaco &&'));
    expect(linha).toContain('!document.querySelector("dialog[open]")');
  });

  it("depois de desenhar a tela para onde a saída levou, o dispatch e a releitura leem a conversa nova", async () => {
    const main = await ler("../../../web/main.ts");
    expect(corpo(main, "function dispatch(acao: Acao): void {")).toMatch(/const saiu = reduzirVendoSaida\(acao\);[\s\S]*render\(\);\s*if \(saiu\) depoisDeSair\(\);/);
    expect(corpo(main, "async function reidratar(")).toMatch(/if \(acao && reduzirVendoSaida\(acao\)\) saiu = true;[\s\S]*render\(\);[\s\S]*if \(saiu\) depoisDeSair\(\);/);
    expect(corpo(main, "function depoisDeSair(): void {")).toContain("lerConversaDaTela();");
  });

  it("o anúncio vai para uma região viva fora da .app (que fica inerte com Seu espaço aberto)", async () => {
    const [main, html] = await Promise.all([ler("../../../web/main.ts"), ler("../../../web/index.html")]);
    expect(corpo(main, "function depoisDeTirarDaLista(")).toContain("anunciar: anunciarGestao");
    const app = html.indexOf('class="app"');
    const regiao = html.indexOf('id="anuncio-gestao"');
    expect(regiao).toBeGreaterThan(0);
    expect(regiao).toBeLessThan(app);
  });
});
