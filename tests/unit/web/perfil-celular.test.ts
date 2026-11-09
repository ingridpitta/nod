import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FrotaDto, RotinaDto } from "../../../src/contracts/api.ts";
import { bibliotecaAberta, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { nivelAjustes, nivelDaGaveta, paiDoNivel, renderDetalhes } from "../../../web/telas/detalhes.ts";
import { corpoDoMenu, itensDoMenuCelular } from "../../../web/telas/gestao-agentes.ts";
import { renderPerfilCelular, valorBiblioteca, valorComputador, valorRotinas } from "../../../web/telas/perfil-celular.ts";

/**
 * NOD-382: o perfil do bot no celular, no estilo do iOS. Um bloco por critério de aceite da issue.
 */
type AgenteFrota = FrotaDto["agentes"][number];
const nina = (extra: Partial<AgenteFrota> = {}): AgenteFrota => ({ tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "Assistente de e-mail", descricao: "Cuida da caixa", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null, ...extra });
const com = (a: AgenteFrota, extra: Partial<Estado> = {}): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [a], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, ...extra } as Estado);
const nivel = (e: Estado, n: NonNullable<Estado["gaveta"]>["nivel"]): Estado => ({ ...e, gaveta: { agenteId: "a1", nivel: n } });
const rotina = (id: string, estado: "ativa" | "pausada", extra: Partial<RotinaDto> = {}): RotinaDto => ({ rotina: { id, agenteId: "a1", instrucao: `Rotina ${id}`, estado }, proximaExecucao: 0, bloqueio: null, resumo: "Todo dia às 9:00", ...extra } as never);
const carregadas = (rotinas: RotinaDto[]): Partial<Estado> => ({ rotinas, carregado: { ...estadoInicial.carregado, rotinas: true } });
const biblioteca = (n: number, proximo: string | null = null, erro = false): Partial<Estado> => ({ bibliotecaDoBot: { c1: { itens: Array.from({ length: n }, (_, i) => ({ id: `i${i}` })), proximo, erro, carregandoMais: false, mostrando: {} } } }) as never;
const itens = (html: string) => (html.match(/role="menuitem"/g) ?? []).length;
const linhas = (html: string) => [...html.matchAll(/data-act="gaveta" data-nivel="([a-z-]+)"/g)].map((m) => m[1]);
const ehDeOutra = (extra: Partial<AgenteFrota> = {}) => nina({ ownerId: "outra", ...extra });

describe("1: a pílula e o toque longo abrem o perfil; ‹ volta à origem", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("no celular, a pílula (alternar-detalhes) abre o perfil com origem chat", () => {
    const pilula = main.slice(main.indexOf('"alternar-detalhes": () => {'), main.indexOf('"preencher-prompt"'));
    expect(pilula).toMatch(/if \(ehCelular\(\)\) \{[\s\S]*abrirPerfil\(t\.agenteId, "chat"\)/);
  });
  it("Ver perfil do menu abre com origem lista quando a lista de bots está aberta", () => {
    expect(main).toContain('if (acao === "ver-perfil") { abrirPerfil(a.id, celular.botsAbertos() ? "lista" : "chat"); return; }');
  });
  it("o toque longo numa linha da lista abre o menu do bot (o da NOD-379, web/lib/toque-longo.ts)", () => {
    const segurado = main.slice(main.indexOf("function abrirMenuSegurado"), main.indexOf("function linhaRedesenhada"));
    expect(segurado).toContain("abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, row, (acao) => acaoDoBot(a, acao)");
    expect(main).toContain("criarToqueLongo<HTMLElement>(");
  });
  it("Ocultar/Excluir não tiram a pessoa de onde ela foi se o perfil fechou durante o pedido (revisão 6)", () => {
    const saida = main.slice(main.indexOf("function sairDoPerfilDoBotQueSaiu"), main.indexOf("function sairDoPerfilDoBotQueSaiu") + 600);
    expect(saida).toContain("planoDaSaida(a.id, perfil, marcaDoPerfil.intacto(marca)");
  });
  it("Ajustar a rotina fecha o perfil no celular para o campo aparecer (revisão 6)", () => {
    const pp = main.slice(main.indexOf('"preencher-prompt": (el) =>'), main.indexOf('"preencher-prompt": (el) =>') + 300);
    expect(pp).toContain('if (ehCelular() && estado.perfilCelular) fecharPerfil("chat", false);');
  });
  it("o ‹ da visão geral é perfil-voltar; o dos níveis é gaveta-voltar", () => {
    expect(renderPerfilCelular(com(nina()))).toContain('data-act="perfil-voltar"');
    expect(renderPerfilCelular(nivel(com(nina()), { tipo: "rotinas" }))).toContain('data-act="gaveta-voltar" aria-label="Voltar para Nina"');
  });
  it("o reducer guarda a origem e a esquece ao trocar de bot", () => {
    let e = reduzir(com(nina()), { tipo: "perfil-celular", perfil: { agenteId: "a1", origem: "lista", voltar: { tipo: "inicio" } } });
    expect(e.perfilCelular).toEqual({ agenteId: "a1", origem: "lista", voltar: { tipo: "inicio" } });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "conversa", conversaId: "c2", agenteId: "a2" } });
    expect(e.perfilCelular).toBeNull();
  });
  it("ficar na mesma conversa mantém o perfil", () => {
    const e = reduzir(reduzir(com(nina()), { tipo: "perfil-celular", perfil: { agenteId: "a1", origem: "chat" } }), { tipo: "navegar", tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } });
    expect(e.perfilCelular?.agenteId).toBe("a1");
  });
});

describe("2: avatar, nome, título, ações rápidas e a lista agrupada com os valores certos", () => {
  const e = com(nina(), { ...carregadas([rotina("r1", "ativa"), rotina("r2", "ativa"), rotina("r3", "pausada")]), ...biblioteca(12), computadorVisto: { a1: "ligado" } } as Partial<Estado>);
  const html = renderPerfilCelular(e);
  it("avatar xl, nome e título editáveis no lugar (gvn-nome/gvn-sub) com lápis", () => {
    expect(html).toMatch(/class="icon mascote [^"]* xl"/);
    expect(html).toMatch(/class="gvn-nome pfc-nome" data-campo="nome" data-id="a1" data-salvo="Nina"/);
    expect(html).toMatch(/class="gvn-sub pfc-sub" data-campo="titulo" data-id="a1" data-salvo="Assistente de e-mail"/);
    expect(html).toContain('data-act="perfil-editar" data-campo="nome"');
    expect(html).toContain('data-act="perfil-editar" data-campo="titulo"');
  });
  it("as ações rápidas: Mensagem e Compartilhar (Ligar só quando o bot liga)", () => {
    expect(html).toContain('data-act="perfil-mensagem"');
    expect(html).toContain('data-act="perfil-compartilhar"');
    expect(html).not.toContain('data-act="iniciar-ligacao"');
    const ligavel = renderPerfilCelular({ ...e, disponibilidadeLigacao: { a1: { disponivel: true } } } as never);
    expect(ligavel).toContain('data-act="iniciar-ligacao"');
  });
  it("as linhas do bot da pessoa, na ordem do protótipo", () => {
    // Sem catálogo e no harness legado, o executor mostra a pasta: a linha Código aparece primeiro.
    expect(linhas(html)).toEqual(["codigo", "rotinas", "biblioteca", "computador", "ajustes"]);
    expect(html).toMatch(/<span class="pfc-rotulo">Código<\/span><span class="pfc-valor">[^<]+<\/span>/);
    expect(html).toContain('data-act="perfil-excluir"');
  });
  it("valores: 2 ativas · 12 itens · Ligado", () => {
    expect(html).toContain('<span class="pfc-valor">2 ativas</span>');
    expect(html).toContain('<span class="pfc-valor">12 itens</span>');
    expect(html).toContain('<span class="pfc-valor">Ligado</span>');
  });
  it("os textos dos valores", () => {
    expect(valorRotinas(com(nina(), carregadas([])), "a1")).toEqual({ tipo: "texto", texto: "Nenhuma" });
    expect(valorRotinas(com(nina(), carregadas([rotina("r1", "ativa")])), "a1")).toEqual({ tipo: "texto", texto: "1 ativa" });
    expect(valorRotinas(com(nina(), carregadas([rotina("r1", "pausada"), rotina("r2", "pausada")])), "a1")).toEqual({ tipo: "texto", texto: "2 pausadas" });
    expect(valorBiblioteca(com(nina(), biblioteca(0)), nina())).toEqual({ tipo: "texto", texto: "Vazia" });
    expect(valorBiblioteca(com(nina(), biblioteca(1)), nina())).toEqual({ tipo: "texto", texto: "1 item" });
    expect(valorBiblioteca(com(nina(), biblioteca(20, "cur")), nina())).toEqual({ tipo: "texto", texto: "20+ itens" });
    expect(valorComputador(com(nina(), { computadorVisto: { a1: "dormindo" } } as Partial<Estado>), nina())).toEqual({ tipo: "texto", texto: "Dormindo" });
    expect(valorComputador(com(nina()), nina({ computadorForaDoAr: { desde: 0, motivo: "sem_resposta" } } as Partial<AgenteFrota>))).toEqual({ tipo: "texto", texto: "Fora do ar" });
  });
  it("mantém a leitura do estado do computador (data-comp-bot) na visão geral", () => {
    expect(html).toContain('<span hidden data-comp-bot="a1"></span>');
  });
});

describe("3: cada linha abre a tela certa, com ‹ de volta ao perfil", () => {
  it("as telas das linhas existem e voltam ao perfil (null) no celular", () => {
    for (const t of ["codigo", "rotinas", "biblioteca", "computador"] as const) {
      expect(nivelDaGaveta(t)).toEqual({ tipo: t });
      expect(paiDoNivel({ tipo: t }, true)).toBeNull();
    }
    expect(paiDoNivel({ tipo: "ajustes" }, true)).toBeNull();
  });
  it("rotina e nova rotina voltam para Rotinas no celular; no desktop, à visão geral (sem mudança)", () => {
    expect(paiDoNivel({ tipo: "rotina", id: "r1" }, true)).toEqual({ tipo: "rotinas" });
    expect(paiDoNivel({ tipo: "nova-rotina" }, true)).toEqual({ tipo: "rotinas" });
    expect(paiDoNivel({ tipo: "rotina", id: "r1" })).toBeNull();
    expect(paiDoNivel({ tipo: "nova-rotina" })).toBeNull();
    expect(paiDoNivel({ tipo: "memoria" }, true)).toEqual({ tipo: "ajustes" });
  });
  it("o título de cada tela e o ‹ de volta", () => {
    const titulos = { rotinas: "Rotinas", codigo: "Código", biblioteca: "Biblioteca", computador: "Computador", ajustes: "Ajustes" } as const;
    for (const [t, titulo] of Object.entries(titulos)) {
      const h = renderPerfilCelular(nivel(com(nina()), { tipo: t } as never));
      expect(h).toContain(`<h2 class="gv-titulo pfc-titulo" title="${titulo}">${titulo}</h2>`);
      expect(h).toContain('data-act="gaveta-voltar"');
      expect(h).not.toContain('data-act="alternar-detalhes"');
    }
    expect(renderPerfilCelular(nivel(com(nina(), carregadas([rotina("r1", "ativa")])), { tipo: "rotina", id: "r1" }))).toContain('aria-label="Voltar para Rotinas"');
  });
  it("Código e Computador não abrem no bot de outra pessoa, nem por um data-nivel solto (revisão 11)", () => {
    for (const tipo of ["codigo", "computador"] as const) {
      const h = renderPerfilCelular(nivel(com(ehDeOutra()), { tipo }));
      expect(h).not.toContain("data-caminho");
      expect(h).not.toContain('data-comp-bot="a1"');
    }
  });
  it("Código: a Pasta copia o caminho, sem nota longa em cinza", () => {
    const h = renderPerfilCelular(nivel(com(nina()), { tipo: "codigo" }));
    expect(h).toMatch(/data-act="perfil-copiar-pasta" data-caminho="[^"]+"/);
    expect(h).not.toContain("pfc-nota");
  });
  it("Computador: a ação do estado, como no desktop (revisão 8)", () => {
    const tela = (extra: Partial<Estado>, bot = nina()) => renderPerfilCelular(nivel(com(bot, extra), { tipo: "computador" }));
    expect(tela({ computadorVisto: { a1: "dormindo" } } as Partial<Estado>)).toContain('data-act="computador-acordar" data-id="a1">Acordar</button>');
    expect(tela({ computadorVisto: { a1: "dormindo" }, computadorAcao: { agenteId: "a1", tipo: "acordar" } } as Partial<Estado>)).toContain('data-act="computador-acordar" data-id="a1" disabled>Acordando…</button>');
    expect(tela({}, nina({ computadorForaDoAr: { desde: 0, motivo: "sem_resposta" } } as Partial<AgenteFrota>))).toContain('data-act="religar-computador" data-id="a1">Tentar de novo</button>');
    const ligado = tela({ computadorVisto: { a1: "ligado" } } as Partial<Estado>);
    expect(ligado).not.toContain("computador-acordar");
    expect(ligado).not.toContain("religar-computador");
  });
  it("Computador: a linha Estado e Abrir computador, com a leitura do estado", () => {
    const h = renderPerfilCelular(nivel(com(nina(), { computadorVisto: { a1: "ligado" } } as Partial<Estado>), { tipo: "computador" }));
    expect(h).toContain('<span class="pfc-rotulo">Estado</span><span class="pfc-valor">Ligado</span>');
    expect(h).toContain('class="pfc-contorno" data-act="abrir-computador" data-id="a1">Abrir computador');
    expect(h).toContain('data-comp-bot="a1"');
  });
  it("a Biblioteca carrega com o perfil aberto (sem esperar a aba do desktop)", () => {
    const base = com(nina());
    expect(bibliotecaAberta(base)).toBe(false);
    expect(bibliotecaAberta({ ...base, perfilCelular: { agenteId: "a1", origem: "chat" } })).toBe(true);
    expect(bibliotecaAberta({ ...nivel(base, { tipo: "biblioteca" }), perfilCelular: { agenteId: "a1", origem: "chat" } })).toBe(true);
    expect(bibliotecaAberta({ ...nivel(base, { tipo: "ajustes" }), perfilCelular: { agenteId: "a1", origem: "chat" } })).toBe(false);
  });
});

describe("4: o menu do celular tem no máximo 5 itens; o desktop segue com os 9", () => {
  it("bot da pessoa: Fixar, Marcar como lido, Mover, Ver perfil e Excluir", () => {
    expect(itensDoMenuCelular(nina(), true)).toEqual(["fixar", "nao-lido", "mover", "ver-perfil", "excluir"]);
    expect(itens(corpoDoMenu(nina(), true, true))).toBe(5);
    expect(corpoDoMenu(nina(), true, true)).toContain('data-gestao="excluir" class="danger"');
  });
  it("o Nod e o bot de outra pessoa não têm Excluir", () => {
    expect(itensDoMenuCelular(nina({ papel: "nod" } as Partial<AgenteFrota>), true)).toEqual(["fixar", "nao-lido", "ver-perfil"]);
    expect(itensDoMenuCelular(ehDeOutra(), false)).toEqual(["ver-perfil"]);
  });
  it("desktop: os 9 itens de sempre, sem Ver perfil", () => {
    const d = corpoDoMenu(nina(), true, false);
    expect(itens(d)).toBe(9);
    expect(d).not.toContain("ver-perfil");
    for (const acao of ["fixar", "mover", "nao-lido", "renomear", "perfil", "duplicar", "copiar", "ocultar", "excluir"]) expect(d).toContain(`data-gestao="${acao}"`);
  });
  it("NOD-437: o item Time · X escapa o nome do time no celular e no desktop", () => {
    for (const celular of [true, false]) {
      const m = corpoDoMenu(nina({ secao: '<img src=x onerror=alert(1)>' } as Partial<AgenteFrota>), true, celular);
      expect(m).not.toContain("<img");
      expect(m).toContain("Time · &lt;img");
    }
  });
});

describe("5: Excluir pede confirmação e não aparece no Nod nem no bot de outra pessoa", () => {
  it("o bot da pessoa tem Excluir bot; o Nod e o bot de outra pessoa, não", () => {
    expect(renderPerfilCelular(com(nina()))).toContain('data-act="perfil-excluir" data-id="a1" aria-haspopup="dialog">Excluir bot');
    expect(renderPerfilCelular(com(nina({ papel: "nod" } as Partial<AgenteFrota>)))).not.toContain("perfil-excluir");
    expect(renderPerfilCelular(com(ehDeOutra()))).not.toContain("perfil-excluir");
  });
  it("a confirmação é uma folha com o nome, a frase curta e Cancelar", () => {
    const fonte = readFileSync(new URL("../../../web/telas/gestao-agentes.ts", import.meta.url), "utf8");
    const folha = fonte.slice(fonte.indexOf("export function confirmarExclusaoNaFolha"));
    expect(folha).toContain("<h2>Excluir ${esc(a.nome)}?</h2><p>As rotinas pausam, os acessos são revogados e o que está rodando para. Dá para restaurar em Configurações › Agentes.</p>");
    expect(folha).toContain("data-cancelar>Cancelar");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toContain('if (a.papel === "nod" || a.ownerId !== estado.sessao?.pessoaId) return;');
  });
  it("o bot de outra pessoa: sem Código, Computador, Excluir nem lápis, com a linha de compartilhado", () => {
    const h = renderPerfilCelular(com(ehDeOutra(), { computadorVisto: { a1: "ligado" } } as Partial<Estado>));
    expect(linhas(h)).toEqual(["rotinas", "biblioteca", "ajustes"]);
    expect(h).not.toContain("perfil-editar");
    expect(h).not.toContain('class="gvn-nome');
    expect(h).toContain("Bot compartilhado com você");
  });
  it("o Nod: sem Excluir, sem Duplicar, sem lápis no nome (o título se edita)", () => {
    const h = renderPerfilCelular(com(nina({ papel: "nod", nome: "Nod" } as Partial<AgenteFrota>)));
    expect(h).not.toContain('data-campo="nome"');
    expect(h).toContain('data-act="perfil-editar" data-campo="titulo"');
    const fonte = readFileSync(new URL("../../../web/telas/gestao-agentes.ts", import.meta.url), "utf8");
    expect(fonte.slice(fonte.indexOf("export function abrirFolhaCompartilhar"))).toContain('a.papel === "nod" ? "" : item("duplicar", "Duplicar")');
  });
  it("Ocultar da lista é um interruptor em Ajustes › Na lista (não no Nod nem no bot de outra pessoa)", () => {
    const meu = renderPerfilCelular(nivel(com(nina()), { tipo: "ajustes" }));
    expect(meu).toContain("<h3>Na lista</h3>");
    expect(meu).toContain('class="pfc-chave" role="switch" aria-checked="false" data-act="perfil-ocultar" data-id="a1" aria-label="Ocultar da lista"');
    expect(renderPerfilCelular(nivel(com(nina({ papel: "nod" } as Partial<AgenteFrota>)), { tipo: "ajustes" }))).not.toContain("Na lista");
    expect(renderPerfilCelular(nivel(com(ehDeOutra()), { tipo: "ajustes" }))).not.toContain("Na lista");
  });
});

describe("6: alvos de 44 px, inclusive os interruptores das rotinas e Nova rotina", () => {
  const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
  it("o interruptor 51 × 31 numa área 52 × 44; linhas de 52 e de 64", () => {
    expect(css).toContain(".pfc-chave { flex: none; width: 52px; height: 44px;");
    expect(css).toContain(".pfc-trilho { position: relative; width: 51px; height: 31px;");
    expect(css).toMatch(/\.pfc-linha \{[^}]*min-height: 52px/);
    expect(css).toMatch(/\.pfc-rotina \{[^}]*min-height: 64px/);
    expect(css).toMatch(/\.pfc-lapis \{[^}]*width: 44px; height: 44px/);
    expect(css).toMatch(/\.pfc-contorno \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.pfc-link \{[^}]*min-height: 44px/);
  });
  it("Rotinas: Nova rotina é a primeira linha; cada rotina tem o interruptor do celular", () => {
    const h = renderPerfilCelular(nivel(com(nina(), carregadas([rotina("r1", "ativa"), rotina("r2", "pausada")])), { tipo: "rotinas" }));
    // NOD-444: "Nova rotina" leva à conversa do bot, não ao formulário.
    expect(h.indexOf('data-act="rotina-no-chat" data-agente="a1"')).toBeGreaterThan(-1);
    expect(h.indexOf('data-act="rotina-no-chat"')).toBeLessThan(h.indexOf('data-nivel="rotina"'));
    expect(h).not.toContain('data-nivel="nova-rotina"');
    expect(h).toContain('class="pfc-chave" role="switch" aria-checked="true" data-act="pausar-rotina" data-id="r1"');
    expect(h).toContain('class="pfc-chave" role="switch" aria-checked="false" data-act="ativar-rotina" data-id="r2"');
  });
});

describe("7: nada de descrições longas em cinza no perfil", () => {
  it("a visão geral e Ajustes do celular não têm <small> de descrição", () => {
    expect(renderPerfilCelular(com(nina()))).not.toContain("<small>");
    const aj = nivelAjustes(com(nina()), nina(), true, true).corpo;
    expect(aj).not.toContain("O que Nina faz e como fala nas ligações");
    // O desktop mantém a descrição.
    expect(nivelAjustes(com(nina()), nina(), true).corpo).toContain("O que Nina faz e como fala nas ligações");
  });
});

describe("8: carregando, erro e vazio sem fundo colorido chapado", () => {
  it("carregando: o esqueleto de 40 × 12 no valor", () => {
    const h = renderPerfilCelular(com(nina()));
    expect(h).toContain('<span class="pfc-valor"><span class="pfc-esqueleto" aria-hidden="true"></span>');
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.pfc-esqueleto \{[^}]*width: 40px; height: 12px/);
  });
  it("erro: — no valor e o aviso com Tentar de novo na tela Rotinas", () => {
    const e = reduzir(com(nina()), { tipo: "rotinas-falharam" });
    expect(e.rotinasFalharam).toBe(true);
    expect(renderPerfilCelular(e)).toContain('<span class="pfc-valor"><span aria-hidden="true">—</span><span class="sr-only">não carregou</span></span>');
    const r = renderPerfilCelular(nivel(e, { tipo: "rotinas" }));
    expect(r).toContain('As rotinas não carregaram · <button type="button" class="pfc-link" data-act="perfil-tentar-rotinas">Tentar de novo</button>');
    // Carregar de novo limpa o erro.
    expect(reduzir(e, { tipo: "hidratar-rotinas", rotinas: [] }).rotinasFalharam).toBe(false);
  });
  it("vazio: Nenhuma rotina ainda e a dica da conversa; um botão só (Nova rotina), sem o Criar rotina duplicado", () => {
    const h = renderPerfilCelular(nivel(com(nina(), carregadas([])), { tipo: "rotinas" }));
    expect(h).toContain("<b>Nenhuma rotina ainda</b>");
    expect(h).not.toContain("repete uma tarefa");
    expect(h).toContain("<p class=\"pfc-dica\">Peça na conversa, do seu jeito: «todo dia útil às 8, me mande as pautas»</p>");
    expect(h).not.toContain("Criar rotina");
    expect(h.match(/data-act="rotina-no-chat"/g)).toHaveLength(1);
  });
  it("Biblioteca e Computador com erro mostram —", () => {
    expect(valorBiblioteca(com(nina(), biblioteca(0, null, true)), nina())).toEqual({ tipo: "erro" });
    expect(valorComputador(com(nina(), { computadorVisto: { a1: "erro" } } as Partial<Estado>), nina())).toEqual({ tipo: "erro" });
  });
  it("o CSS dos estados não pinta fundo com cor chapada (só tons do --ink)", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    const bloco = css.slice(css.indexOf("NOD-382"));
    for (const sel of [".pfc-erro", ".pfc-vazio", ".pfc-esqueleto"]) {
      const regras = [...bloco.matchAll(new RegExp(`\\${sel}[^{,]*\\{([^}]*)\\}`, "g"))].map((m) => m[1] ?? "");
      expect(regras.length).toBeGreaterThan(0);
      for (const regra of regras) {
        // Fundo, se houver, só transparente ou um tom do --ink (o esqueleto).
        for (const [, valor] of regra.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) expect(valor!.trim()).toMatch(/^(none|transparent|color-mix\(in srgb, var\(--ink\) \d+%, transparent\))$/);
      }
    }
  });
});

describe("9: o desktop fica intacto", () => {
  it("renderDetalhes segue com Compartilhar e Fechar no topo e as abas", () => {
    const h = renderDetalhes(com(nina()));
    expect(h).toContain('data-act="gaveta-compartilhar"');
    expect(h).toContain('data-act="alternar-detalhes" aria-label="Fechar painel"');
    expect(h).toContain('role="tablist"');
    expect(h).not.toContain("pfc-");
  });
  it("Ajustes do desktop sem o grupo Na lista", () => {
    expect(renderDetalhes(nivel(com(nina()), { tipo: "ajustes" }))).not.toContain("Na lista");
  });
  it("o render escolhe o perfil só no celular", () => {
    const fonte = readFileSync(new URL("../../../web/lib/gaveta-render.ts", import.meta.url), "utf8");
    expect(fonte).toContain("celular ? renderPerfilCelular : renderDetalhes");
  });
  it("as regras novas do CSS moram dentro da consulta do celular (a não ser o reduced-motion)", () => {
    const nav = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    expect(nav.match(/\.pfc-[a-z-]+/g) ?? []).toEqual([".pfc-corpo", ".pfc-folha"]);
  });
});
