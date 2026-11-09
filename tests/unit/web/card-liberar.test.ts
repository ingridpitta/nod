import { describe, expect, it } from "vitest";
import type { CapacidadeConector, Conector } from "../../../src/contracts/conector.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { appsParaLiberar, JANELA_LIBERAR_MS, oQuePodem, renderCardLiberar, rotuloPermitir, type EntradaAppsParaLiberar } from "../../../web/telas/card-liberar.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * O cartão que oferece liberar apps recém-conectados para o bot da conversa (definido em 2026-10-05, canvas "Acesso:
 * você conectou pelo Marketplace e o nod oferece liberar"). A regra de quem entra é uma função pura; o desenho sai
 * pela timeline, como a pessoa o vê.
 */
const AGORA = Date.parse("2026-10-05T15:00:00-03:00");
const HA_UMA_HORA = AGORA - 3_600_000;
const cap = (nome: string, grupo: CapacidadeConector["grupo"]): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint: grupo === "ler", grupo });
const LER_E_CRIAR = [cap("LISTAR", "ler"), cap("ENVIAR", "criar"), cap("APAGAR", "apagar")];

function conector(slug: string, nome: string, extra: Partial<Conector> = {}): Conector {
  return { tenantId: "t", id: `k-${slug}`, ownerId: "p", visibility: "privado", nome, slug, transporte: "http", comando: null, args: [], url: "https://x", env: {}, declaracao: "toca", habilitado: true, catalogo: LER_E_CRIAR, sondadoEm: HA_UMA_HORA, ultimaFalha: null, criadoEm: 0, ...extra };
}
const gmail = conector("gmail", "Gmail");
const slack = conector("slack", "Slack", { sondadoEm: HA_UMA_HORA + 60_000 });
const pedido = (slug: string, extra: Partial<Proposta> = {}): Proposta => ({ tenantId: "t", id: `pr-${slug}`, conversaId: "c1", agenteId: "a1", kind: "acesso", estado: "pendente", criadoEm: AGORA, payload: { kind: "acesso", conector: slug, capacidades: [], nivel: "leitura", naoPedido: [], conectar: true }, ...extra });

const base: EntradaAppsParaLiberar = {
  agora: AGORA,
  pessoaId: "p",
  conversa: { tipo: "propria", agenteId: "a1" },
  agente: { id: "a1", ownerId: "p" },
  conectores: [gmail, slack],
  concessoes: [],
  dispensadas: {},
  propostas: [],
};
const slugs = (e: Partial<EntradaAppsParaLiberar>) => appsParaLiberar({ ...base, ...e }).map((a) => a.slug);

describe("quais apps entram no cartão de liberar", () => {
  it("apps da pessoa, conectados há menos de 24 h e sem nenhuma concessão deste bot entram, na ordem em que foram conectados", () => {
    expect(appsParaLiberar(base)).toEqual([
      { conectorId: "k-gmail", slug: "gmail", nome: "Gmail", conectadoEm: HA_UMA_HORA, niveis: ["leitura", "escrita"] },
      { conectorId: "k-slack", slug: "slack", nome: "Slack", conectadoEm: HA_UMA_HORA + 60_000, niveis: ["leitura", "escrita"] },
    ]);
  });

  it("o bot já tem alguma concessão no app: o app sai, mesmo que seja uma ação só", () => {
    expect(slugs({ concessoes: [{ conectorId: "k-gmail" }] })).toEqual(["slack"]);
  });

  it("app de outra pessoa, desconectado, nunca verificado ou com falha mais nova que a verificação não entra", () => {
    expect(slugs({ conectores: [conector("gmail", "Gmail", { ownerId: "ana" }), slack] })).toEqual(["slack"]);
    expect(slugs({ conectores: [conector("gmail", "Gmail", { habilitado: false }), slack] })).toEqual(["slack"]);
    expect(slugs({ conectores: [conector("gmail", "Gmail", { sondadoEm: null }), slack] })).toEqual(["slack"]);
    expect(slugs({ conectores: [conector("gmail", "Gmail", { ultimaFalha: { motivo: "conector_indisponivel", em: HA_UMA_HORA + 1 } }), slack] })).toEqual(["slack"]);
    // NOD-374: a falha que ainda não persistiu (sem foraDoArDesde; o carimbo antigo também) não esconde a oferta; a que
    // persiste esconde mesmo se a última sonda (o "Tentar de novo" que falhou) é posterior ao começo dela.
    expect(slugs({ conectores: [conector("gmail", "Gmail", { ultimaFalha: { motivo: "conector_indisponivel", em: HA_UMA_HORA - 1 }, foraDoArDesde: null })] })).toEqual(["gmail"]);
    expect(slugs({ conectores: [conector("gmail", "Gmail", { ultimaFalha: { motivo: "conector_indisponivel", em: HA_UMA_HORA - 1 }, foraDoArDesde: HA_UMA_HORA - 1 })] })).toEqual([]);
  });

  it("a janela é de 24 h a partir da última verificação boa: no limite entra, um milissegundo depois não", () => {
    expect(slugs({ conectores: [conector("gmail", "Gmail", { sondadoEm: AGORA - JANELA_LIBERAR_MS })] })).toEqual(["gmail"]);
    expect(slugs({ conectores: [conector("gmail", "Gmail", { sondadoEm: AGORA - JANELA_LIBERAR_MS - 1 })] })).toEqual([]);
  });

  it("só na conversa própria de um bot da pessoa: sala, bot de colega, bot excluído e conversa de outro bot ficam sem cartão", () => {
    expect(slugs({ conversa: { tipo: "sala", agenteId: "a1" } })).toEqual([]);
    expect(slugs({ conversa: { tipo: "propria", agenteId: "a2" } })).toEqual([]);
    expect(slugs({ agente: { id: "a1", ownerId: "ana" } })).toEqual([]);
    expect(slugs({ agente: { id: "a1", ownerId: "p", excluidoEm: AGORA } })).toEqual([]);
    expect(slugs({ agente: undefined })).toEqual([]);
  });

  it("fecha no que não sabe: sem sessão, sem as concessões ou sem as dispensas carregadas não há cartão", () => {
    expect(slugs({ pessoaId: undefined })).toEqual([]);
    expect(slugs({ concessoes: undefined })).toEqual([]);
    expect(slugs({ dispensadas: undefined })).toEqual([]);
  });

  it("pedido de acesso do bot ainda aberto para o app (conectar ou permitir) já é o cartão dele; decidido, não conta", () => {
    expect(slugs({ propostas: [pedido("gmail")] })).toEqual(["slack"]);
    expect(slugs({ propostas: [pedido("gmail", { payload: { kind: "acesso", conector: "gmail", capacidades: ["LISTAR"], nivel: "leitura", naoPedido: [] } })] })).toEqual(["slack"]);
    expect(slugs({ propostas: [pedido("gmail", { estado: "recusada" })] })).toEqual(["gmail", "slack"]);
  });

  it("'Agora não' vale para a conexão que a pessoa viu: reconectar depois da dispensa traz a oferta de volta", () => {
    expect(slugs({ dispensadas: { "k-gmail": HA_UMA_HORA + 10 } })).toEqual(["slack"]);
    expect(slugs({ dispensadas: { "k-gmail": HA_UMA_HORA } })).toEqual(["slack"]);
    expect(slugs({ dispensadas: { "k-gmail": HA_UMA_HORA - 10 } })).toEqual(["gmail", "slack"]);
  });

  it("os níveis seguem o catálogo: só leitura não oferece 'Ler e alterar'; sem leitura sobra só ele; sem nenhum, o app não entra", () => {
    const niveis = (catalogo: CapacidadeConector[]) => appsParaLiberar({ ...base, conectores: [conector("gmail", "Gmail", { catalogo })] }).map((a) => a.niveis);
    expect(niveis([cap("LISTAR", "ler")])).toEqual([["leitura"]]);
    expect(niveis([cap("ENVIAR", "criar")])).toEqual([["escrita"]]);
    expect(niveis([cap("APAGAR", "apagar"), cap("MISTERIO", "outras")])).toEqual([]);
    expect(niveis([])).toEqual([]);
  });
});

describe("o botão e a lista seguem o que está marcado", () => {
  const ler = (slug: string) => ({ slug, nivel: "leitura" as const });
  const alterar = (slug: string) => ({ slug, nivel: "escrita" as const });
  const ctx = { conectores: [gmail, slack, conector("notion", "Notion")], marketplace: [] };

  it("um app em leitura → 'Permitir leitura'; dois → 'nos dois'; três → 'nos 3'; nível diferente ou 'Ler e alterar' → 'Permitir'", () => {
    expect(rotuloPermitir([ler("gmail")])).toBe("Permitir leitura");
    expect(rotuloPermitir([ler("gmail"), ler("slack")])).toBe("Permitir leitura nos dois");
    expect(rotuloPermitir([ler("gmail"), ler("slack"), ler("notion")])).toBe("Permitir leitura nos 3");
    expect(rotuloPermitir([ler("gmail"), alterar("slack")])).toBe("Permitir");
    expect(rotuloPermitir([alterar("gmail")])).toBe("Permitir");
    expect(rotuloPermitir([])).toBe("Permitir");
  });

  it("a lista junta os apps por nível e só diz 'neles' quando todos estão em leitura", () => {
    expect(oQuePodem(ctx, [ler("gmail"), ler("slack")])).toEqual({ pode: ["Ver e ler o que está no Gmail e no Slack"], nao: ["Não cria, altera nem apaga nada neles"] });
    expect(oQuePodem(ctx, [ler("gmail"), ler("slack"), ler("notion")]).pode).toEqual(["Ver e ler o que está no Gmail, no Slack e no Notion"]);
    expect(oQuePodem(ctx, [ler("gmail"), alterar("slack")])).toEqual({
      pode: ["Ver e ler o que está no Gmail", "Ler, criar, editar e comentar no Slack"],
      nao: ["Não cria, altera nem apaga nada no Gmail", "Apagar, desfazer e outras ações ficam de fora no Slack"],
    });
    expect(oQuePodem(ctx, [alterar("gmail"), alterar("slack")])).toEqual({ pode: ["Ler, criar, editar e comentar no Gmail e no Slack"], nao: ["Apagar, desfazer e outras ações ficam de fora"] });
    expect(oQuePodem(ctx, [])).toEqual({ pode: [], nao: [] });
  });

  it("um app só usa as frases do card de acesso, com o 'não inclui' curado do app", () => {
    expect(oQuePodem(ctx, [ler("gmail")])).toEqual({ pode: ["Ver e ler o que está no Gmail"], nao: ["Não cria, altera nem apaga nada no Gmail"] });
    const curado = { ...ctx, marketplace: [{ slug: "gmail", nome: "Gmail", descricao: "", categoria: "", naoIncluiNaLeitura: ["enviar e-mail"] }] as never };
    expect(oQuePodem(curado, [ler("gmail")]).nao).toEqual(["Não inclui: enviar e-mail"]);
  });
});

describe("o desenho do cartão na conversa", () => {
  const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Assistente pessoal", titulo: "", descricao: "", descricaoEstado: "", cor: "c-amber", forma: "shape-square", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;
  const conversa = (propostas: Proposta[] = [], tipo: "propria" | "sala" = "propria"): ConversaEstado => ({ conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo, agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 });
  const estado: Estado = {
    ...estadoInicial,
    agora: AGORA,
    sessao: { tenantId: "t", pessoaId: "p" } as never,
    frota: { agentes: [agente], negacoes: [] } as never,
    conectores: [gmail, slack],
    carregado: { ...estadoInicial.carregado, conectores: true },
    concessoes: { a1: [] },
    liberacoesDispensadas: { a1: {} },
  };

  it("2026-10-06: a conversa não mostra mais o cartão sozinho (bot novo, reconexão) — o card de acesso nasce do pedido do bot", () => {
    const html = renderTimeline(conversa(), estado);
    expect(html).not.toContain("liberar-card");
    expect(html).not.toContain("no Marketplace.");
  });

  // O desenho fica guardado em renderCardLiberar, fora da timeline, para o dia em que a oferta voltar com outra regra.
  it("dois apps: título, subtítulo, uma linha por app com checkbox marcado, 'Conectado' e seletor em 'Ler', a lista e o rodapé", () => {
    const html = renderCardLiberar(conversa(), estado);
    expect(html).toContain('<div class="msg-sistema">Você conectou o Gmail e o Slack no Marketplace.</div>');
    expect(html).toContain('<section class="acesso-card liberar-card" data-liberar="a1" aria-label="Liberar apps para Assistente pessoal">');
    expect(html).toContain("<b>O Assistente pessoal ainda não pode usar esses apps</b><small>Conectar o app é o primeiro passo. Falta dizer o que este bot pode fazer neles.</small>");
    expect(html.match(/class="lib-app"/g)).toHaveLength(2);
    expect(html).toContain('<input type="checkbox" checked data-liberar-app="k-gmail" data-slug="gmail" />');
    expect(html).toContain('<select class="lib-nivel" data-liberar-nivel="k-slack" aria-label="Nível de acesso ao Slack"><option value="leitura" selected>Ler</option><option value="escrita">Ler e alterar</option></select>');
    expect(html.match(/<\/svg>Conectado<\/small>/g)).toHaveLength(2);
    expect(html).toContain("Ver e ler o que está no Gmail e no Slack</li>");
    expect(html).toContain("Não cria, altera nem apaga nada neles</li>");
    expect(html).toContain('data-act="liberar-apps" data-id="a1">Permitir leitura nos dois</button>');
    expect(html).toContain('<button type="button" class="bt link" data-act="dispensar-liberar" data-id="a1" data-conectores="k-gmail,k-slack">Agora não</button>');
    expect(html).toContain('<span class="ac-nota">Dá para revogar no painel do bot</span>');
    // O checkbox está dentro do rótulo dele e o seletor fica fora: nenhum controle dentro de outro.
    expect(html).toMatch(/<label class="lib-marca"><input type="checkbox"[^>]*\/><span class="app-logo[^>]*>.*?<\/span><span class="lib-nome"><b>Gmail<\/b>.*?<\/label><select/s);
  });

  it("um app só: texto no singular, 'Permitir leitura', e o app sem 'Ler e alterar' mostra o nível sem deixar escolher", () => {
    const soLeitura = conector("gmail", "Gmail", { catalogo: [cap("LISTAR", "ler")] });
    const html = renderCardLiberar(conversa(), { ...estado, conectores: [soLeitura] });
    expect(html).toContain("Você conectou o Gmail no Marketplace.");
    expect(html).toContain("<b>O Assistente pessoal ainda não pode usar esse app</b><small>Conectar o app é o primeiro passo. Falta dizer o que este bot pode fazer nele.</small>");
    expect(html).toContain('aria-label="Nível de acesso ao Gmail" disabled><option value="leitura" selected>Ler</option></select>');
    expect(html).toContain('data-act="liberar-apps" data-id="a1">Permitir leitura</button>');
    expect(html).toContain('data-conectores="k-gmail"');
  });

  it("some quando o bot ganha acesso, quando a pessoa dispensa, numa sala e enquanto as concessões não carregaram", () => {
    const comAcesso = reduzir(estado, { tipo: "hidratar-concessoes", agenteId: "a1", concessoes: [{ conectorId: "k-gmail" }, { conectorId: "k-slack" }] as never, liberacoesDispensadas: {} });
    expect(renderCardLiberar(conversa(), comAcesso)).not.toContain("liberar-card");
    const dispensado = reduzir(estado, { tipo: "hidratar-concessoes", agenteId: "a1", concessoes: [], liberacoesDispensadas: { "k-gmail": AGORA, "k-slack": AGORA } });
    expect(renderCardLiberar(conversa(), dispensado)).not.toContain("liberar-card");
    expect(renderCardLiberar(conversa([], "sala"), estado)).not.toContain("liberar-card");
    expect(renderCardLiberar(conversa(), { ...estado, concessoes: {} })).not.toContain("liberar-card");
    expect(renderCardLiberar(conversa(), { ...estado, liberacoesDispensadas: {} })).not.toContain("liberar-card");
    expect(renderCardLiberar(conversa(), { ...estado, carregado: { ...estado.carregado, conectores: false } })).not.toContain("liberar-card");
  });

  it("com o card de pedido do bot aberto para o Gmail, o Gmail fica só nele e o cartão oferece o Slack", () => {
    expect(renderTimeline(conversa([pedido("gmail")]), estado).match(/data-proposta="pr-gmail"/g)).toHaveLength(1);
    const html = renderCardLiberar(conversa([pedido("gmail")]), estado);
    expect(html).toContain('data-conectores="k-slack"');
    expect(html).not.toContain('data-liberar-app="k-gmail"');
  });

  it("a resposta das concessões sem as dispensas não apaga as que a tela já tinha", () => {
    const antes = { ...estado, liberacoesDispensadas: { a1: { "k-gmail": AGORA } } };
    expect(reduzir(antes, { tipo: "hidratar-concessoes", agenteId: "a1", concessoes: [] }).liberacoesDispensadas).toEqual({ a1: { "k-gmail": AGORA } });
  });
});
