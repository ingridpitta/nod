import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESTADOS_ABERTOS_TRABALHO, type TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { esperaDoTrabalho } from "../../../src/domain/trabalho.ts";
import { aplicarFrame, conversaIdNaTela, estadoInicial, faixaAbertaAoNavegar, invalidacoesDaTela, reduzir, type Estado, type Tela } from "../../../web/estado/reducer.ts";
import { ESPERA_TELEMETRIA_MS, LOTE_TELEMETRIA, criarTelemetria } from "../../../web/lib/telemetria-linhas.ts";
import { ESTADOS_ABERTOS, agrupar, filtrar, foraDoMac, listaPararTasks, memoriaLegivel, pilulaMemoria, pontoTrabalho, resumoDaPilula, telaAoFechar, telaDaTask, textoPararTasks, tituloCurto } from "../../../web/lib/trabalhos.ts";
import { comFerramenta, comTexto, ATIVIDADE_VAZIA } from "../../../web/lib/atividade.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { renderTaxasLinhas } from "../../../web/telas/modo-dev.ts";
import { chipTrabalhosDoBot, htmlAcoesDaTask, renderFaixaTrabalhos, renderGavetaTrabalhos, renderIconeTrabalhos, renderTelaTrabalho, renderTodosOsTrabalhos, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/** As telas dos trabalhos (#195, filha 07; #196, filha 08): faixa, tela da task, barra, gaveta, "Todos os trabalhos", memória. */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 7, 21, 0).getTime();
const HOJE = new Date(2026, 9, 7, 20, 0).getTime();
const ONTEM = new Date(2026, 9, 6, 18, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "leo", conversaId: "c-leo", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: HOJE, iniciadoEm: HOJE, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true },
      { id: "dev1", nome: "Dev 1", conversaId: "c-dev1", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null },
    tela: { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" },
    ...extra,
  };
}

/**
 * O cliente REST da web usa XMLHttpRequest (DOM), e o tsconfig.server.json — que também checa tests/ — não tem a lib DOM:
 * o módulo entra por `vi.importActual`, que o tsc não segue; o tipo abaixo é só o que estes testes chamam.
 */
type ApiDeTeste = { criarApi: (escopo: { tenantId: string; pessoaId: string }) => {
  escreverNoTrabalho(id: string, texto: string): Promise<unknown>;
  pararTrabalho(id: string): Promise<unknown>;
  trabalhoDepois(id: string, depoisDe: string): Promise<unknown>;
  trabalhoFazerAqui(id: string): Promise<unknown>;
} };
const criarApi = async (escopo: { tenantId: string; pessoaId: string }) => (await vi.importActual<ApiDeTeste>("../../../web/lib/api.ts")).criarApi(escopo);

const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");

describe("faixa de Trabalhos e pílula (#195, K1/K6)", () => {
  const migrar = trabalho("migrar", { titulo: "Migrar relatórios", ultimoPasso: "18 de 42", iniciadoEm: AGORA - 15 * MIN });
  const churn = trabalho("churn", { titulo: "Dashboard de churn Q3", criadoEm: HOJE + MIN, estado: "na_fila", depoisDeTrabalhoId: "migrar" });
  const pedido = trabalho("rev", { titulo: "Revisar dados do #505", origem: "colega", pedidoPorAgenteId: "chico", pedidoPorNome: "Chico", criadoEm: HOJE + 2 * MIN });

  it("aberta, uma linha por trabalho do bot (ponto, título, status curto, seta → tela da task); origem e tempo só no hover", () => {
    const html = renderFaixaTrabalhos(estadoCom([migrar, churn, pedido, trabalho("feito", { estado: "terminado", terminadoEm: AGORA })], { faixaTrabalhosAberta: "leo" }), "leo");
    // revisto em 2026-10-09: "Trabalhos · Leonardo" — o print do Marlon tinha "Trabalhos do Cecília".
    expect(html).toContain("<span>Trabalhos · Leonardo</span><span class=\"ft-n\">3</span>");
    expect(html.match(/class="ft-linha"/g)).toHaveLength(3);
    expect(html).toContain('data-act="abrir-trabalho" data-id="migrar"');
    expect(html).toContain('<span class="ponto-trabalho c-purple pulso-trab"');
    // A etiqueta saiu da linha (revisto em 2026-10-09): a origem vai no detalhe do hover, antes do status, junto do tempo.
    expect(html).not.toContain("etiqueta-origem");
    expect(html).toContain('<span class="ft-titulo">Migrar relatórios</span><span class="ft-tempo">de você · trabalhou menos de 1 min · aberta há 15 min</span><span class="ft-passo">18 de 42</span>');
    expect(html).toContain('<span class="ft-tempo">pedido do Chico · trabalhou');
    // Na fila ainda não há tempo a contar: o detalhe é só a origem.
    expect(html).toContain('<span class="ft-tempo">de você</span><span class="ft-passo">começa depois da Migrar relatórios</span>');
    expect(html).toContain('data-act="faixa-trabalhos" data-recolher="1" aria-expanded="true"');
    expect(html).not.toContain("feito");
  });

  it("o título longo perde o id técnico entre parênteses na linha; o inteiro fica no title", () => {
    const longo = "Orquestrar a etapa de engenharia do time EngApp no Linear (team 55113aca-122d-4…)";
    const html = renderFaixaTrabalhos(estadoCom([trabalho("orq", { titulo: longo, origem: "rotina" })], { faixaTrabalhosAberta: "leo" }), "leo");
    expect(html).toContain(`<span class="ft-titulo" title="${longo}">Orquestrar a etapa de engenharia do time EngApp no Linear</span>`);
    expect(tituloCurto(longo)).toBe("Orquestrar a etapa de engenharia do time EngApp no Linear");
    expect(tituloCurto("Orquestrar (team 55113aca-122d-4")).toBe("Orquestrar");
    expect(tituloCurto("Ler o log (id 9f8e7d6c5b4a)")).toBe("Ler o log");
    // Parêntese sem id fica; título que é só o id também.
    expect(tituloCurto("Dashboard de churn (Q3)")).toBe("Dashboard de churn (Q3)");
    expect(tituloCurto("Revisar o PR #212 (commit 6c83a82)")).toBe("Revisar o PR #212 (commit 6c83a82)");
    expect(tituloCurto("Ler (decafbad feed)")).toBe("Ler (decafbad feed)");
    expect(tituloCurto("(55113aca-122d-4abc)")).toBe("(55113aca-122d-4abc)");
    expect(renderFaixaTrabalhos(estadoCom([migrar], { faixaTrabalhosAberta: "leo" }), "leo")).toContain('<span class="ft-titulo">Migrar relatórios</span>');
  });

  it("some sem trabalho aberto (o terminado não conta; o de outro bot também não)", () => {
    expect(renderFaixaTrabalhos(estadoCom([trabalho("x", { estado: "terminado" }), trabalho("y", { agenteId: "dev1" })]), "leo")).toBe("");
    expect(renderFaixaTrabalhos(estadoCom([]), "leo")).toBe("");
  });

  it("com task aberta, o padrão é a pílula '● N trabalhando' (pedido do Marlon em 2026-10-09: ela é muito mais sutil)", () => {
    const html = renderFaixaTrabalhos(estadoCom([migrar, churn]), "leo");
    expect(estadoInicial.faixaTrabalhosAberta).toBeNull();
    expect(html).toContain('<span class="ponto-trabalho c-purple pulso-trab" aria-hidden="true"></span><span><b>2</b> trabalhando</span>');
    expect(html).toContain('data-act="faixa-trabalhos" data-recolher="0" aria-expanded="false"');
    expect(html).not.toContain("ft-linha");
    // Aberta para outro bot não abre a deste.
    expect(renderFaixaTrabalhos(estadoCom([migrar], { faixaTrabalhosAberta: "dev1" }), "leo")).toContain("pilula-trab");
  });

  it("a pílula diz o estado que mais importa: precisa de você > trabalhando > esperando fora do Mac > na fila", () => {
    const fora = trabalho("fora", { esperandoColega: { nome: "Eng 1", desde: AGORA - MIN, trabalhoId: null } });
    const precisa = trabalho("precisa", { estado: "precisa_de_voce" });
    expect(resumoDaPilula([migrar, fora])).toEqual({ ponto: "trabalhando", texto: "trabalhando", precisa: 0 });
    expect(resumoDaPilula([fora, churn])).toEqual({ ponto: "fora-do-mac", texto: "esperando", precisa: 0 });
    expect(resumoDaPilula([churn])).toEqual({ ponto: "na-fila", texto: "esperando", precisa: 0 });
    expect(resumoDaPilula([precisa])).toEqual({ ponto: "precisa", texto: "precisa de você", precisa: 1 });
    expect(resumoDaPilula([precisa, { ...precisa, id: "p2" }])).toMatchObject({ texto: "precisam de você" });
    expect(resumoDaPilula([migrar, precisa])).toEqual({ ponto: "precisa", texto: "trabalhando", precisa: 1 });

    const esperando = renderFaixaTrabalhos(estadoCom([fora, { ...fora, id: "fora2" }]), "leo");
    expect(esperando).toContain('<span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span><span><b>2</b> esperando</span>');
    const comVoce = renderFaixaTrabalhos(estadoCom([migrar, precisa]), "leo");
    expect(comVoce).toContain('<span class="ponto-trabalho precisa" aria-hidden="true"></span><span><b>2</b> trabalhando</span><span class="pt-precisa">· 1 precisa de você</span>');
    expect(renderFaixaTrabalhos(estadoCom([precisa]), "leo")).not.toContain("pt-precisa");
  });

  it("a pessoa abre a faixa no clique; ela fica aberta na conversa e na ida e volta da task, e recolhe ao entrar de outro lugar", () => {
    const leo: Tela = { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" };
    const dev1: Tela = { tipo: "conversa", conversaId: "c-dev1", agenteId: "dev1" };
    const task: Tela = { tipo: "trabalho", id: "migrar", voltar: leo };
    const aberta = reduzir(estadoCom([migrar]), { tipo: "faixa-trabalhos", agenteId: "leo" });
    expect(aberta.faixaTrabalhosAberta).toBe("leo");
    expect(renderFaixaTrabalhos(aberta, "leo")).toContain("ft-linha");
    expect(reduzir(aberta, { tipo: "faixa-trabalhos", agenteId: null }).faixaTrabalhosAberta).toBeNull();

    const naTask = reduzir(aberta, { tipo: "navegar", tela: task });
    expect(naTask.faixaTrabalhosAberta).toBe("leo");
    expect(reduzir(naTask, { tipo: "navegar", tela: leo }).faixaTrabalhosAberta).toBe("leo");
    expect(reduzir(aberta, { tipo: "navegar", tela: dev1 }).faixaTrabalhosAberta).toBeNull();
    const deFora = reduzir(reduzir(aberta, { tipo: "navegar", tela: { tipo: "trabalhos" } }), { tipo: "navegar", tela: leo });
    expect(deFora.faixaTrabalhosAberta).toBeNull();

    expect(faixaAbertaAoNavegar(null, leo, leo)).toBeNull();
    expect(faixaAbertaAoNavegar("leo", leo, leo)).toBe("leo");
    expect(faixaAbertaAoNavegar("leo", { tipo: "linha", conversaId: "c-leo", mensagens: [], titulo: "x", voltar: leo }, leo)).toBe("leo");
    expect(faixaAbertaAoNavegar("leo", task, dev1)).toBeNull();
    expect(faixaAbertaAoNavegar("leo", dev1, leo)).toBeNull();
  });

  it("CSS: a faixa cola no campo (o campo perde os cantos de cima) e a região some vazia", () => {
    expect(css).toMatch(/\.lugar-faixa-trabalhos:empty \{ display: none; \}/);
    expect(css).toMatch(/\.lugar-faixa-trabalhos:has\(\.faixa-trab\) \+ \.composer-wrap \.composer \.box \{ border-top-left-radius: 0; border-top-right-radius: 0; \}/);
    // QA do épico (2026-10-08): com algo acima do campo entre a faixa de Trabalhos e o campo (desde 2026-10-18, a caixa
    // "Respondendo" ou "N coisas esperam você", no lugar da faixa da pergunta), a faixa fecha e o campo fica redondo.
    expect(css).toMatch(/\.lugar-faixa-trabalhos:has\(\+ \.composer-wrap \.composer-pergunta:not\(:empty\)\) \.faixa-trab \{ margin-bottom: 8px; border-bottom: 1px solid var\(--line\); border-radius: 16px; \}/);
    expect(css).toMatch(/\.composer-wrap:has\(\.composer-pergunta:not\(:empty\)\) \.composer \.box \{ border-top-left-radius: 28px; border-top-right-radius: 28px; \}/);
    expect(readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8")).toMatch(/id="pilula-novas"[^\n]*\n[^\n]*\n\s*<div class="lugar-faixa-trabalhos" id="faixa-trabalhos"><\/div>\n\s*<footer class="composer-wrap" id="composer">/);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("a tela da task (#195, K2/K7)", () => {
  const login = trabalho("login", {
    agenteId: "dev1", conversaId: "c-dev1", titulo: "Login do app", origem: "colega", pedidoPorAgenteId: "chico", pedidoPorNome: "Chico", pasta: "~/nod/Dev 1/lumen-86akr9u9u",
    iniciadoEm: AGORA - 19 * MIN, turnoVivoId: "tv", esperandoComputadorDe: "Soft delete",
  });

  it("o topo: chip com ponto vivo, mascote, título e o status curto (sem tempo); a linha de quem pediu, acessos e pasta; a espera do computador", () => {
    const html = renderTopoTrabalho(estadoCom([login]), "login");
    expect(html).toContain('<span class="tk-chip"><span class="ponto-trabalho c-green pulso-trab"');
    expect(html).toContain('<span class="tk-titulo">Login do app</span><button type="button" class="tk-status" data-act="tempo-task" data-id="login" aria-expanded="false" title="Ver o tempo da task">trabalhando<svg');
    expect(html).not.toContain("tk-pop");
    expect(html).toContain("task do Dev 1, pedida pelo Chico · com os acessos do Dev 1 · pasta ~/nod/Dev 1/lumen-86akr9u9u");
    expect(html).toContain("esperando o computador do Dev 1 (em uso por: Soft delete)");
  });

  it("o corpo: a conversa com quem pediu (com as falas do meio) e os passos centralizados do ao vivo", () => {
    const autoria = (id: string) => ({ autor_tipo: "agente", autor_id: id, sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 });
    const mensagens = [
      { tenantId: "t", id: "m1", conversaId: "c-dev1", turnoId: "tv", autoria: autoria("chico"), kind: "texto", texto: "Dev 1, pega o login", payload: { kind: "peer_pedido", conversaOrigemId: "c-chico", turnoOrigemId: "tc" }, confianca: "confiavel", parcial: false, criadoEm: HOJE, trabalhoId: "login", fimDoTurno: false },
      { tenantId: "t", id: "m2", conversaId: "c-dev1", turnoId: "tv", autoria: autoria("dev1"), kind: "texto", texto: "Pego. Reproduzi o bug.", payload: null, confianca: "confiavel", parcial: false, criadoEm: HOJE + MIN, trabalhoId: "login", fimDoTurno: false },
    ];
    let atividade = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Criou a worktree."), "Bash");
    atividade = comTexto(atividade, "Gravando o vídeo do QA:");
    atividade = comFerramenta(atividade, "Bash");
    const e = reduzir(estadoCom([login], { tela: { tipo: "trabalho", id: "login", voltar: { tipo: "inicio" } } }), { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: mensagens as never }, agora: AGORA });
    const html = renderTelaTrabalho({ ...e, atividades: { "c-dev1": { tv: { ...atividade, atual: "" } } } }, "login");
    expect(html).toContain("· pedido do Chico · a resposta volta para o Chico");
    expect(html).toContain("Dev 1, pega o login");
    expect(html).toContain("Pego. Reproduzi o bug.");
    expect(html).toContain('<div class="passo"><span class="passo-ok" aria-hidden="true">✓</span><span>Criou a worktree.</span></div>');
    expect(html).toContain('<div class="passo passo-agora">');
    expect(css).toMatch(/\.passo \{ display: flex; align-items: center; justify-content: center;/);
  });

  it("Parar task usa a rota do trabalho; Fechar volta à tela de antes (e não empilha tasks)", async () => {
    const acoes = htmlAcoesDaTask("login");
    expect(acoes).toContain('data-act="parar-trabalho" data-id="login"');
    expect(acoes).toContain(">Parar task<");
    expect(acoes).toContain('data-act="fechar-trabalho"');
    const conversa: Tela = { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" };
    const task = telaDaTask(conversa, "login");
    expect(task).toEqual({ tipo: "trabalho", id: "login", voltar: conversa });
    expect(telaAoFechar(task)).toEqual(conversa);
    expect(telaDaTask(task, "outra").voltar).toEqual(conversa);
    expect(telaAoFechar(conversa)).toBeNull();
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ ok: true, ids: {} })); });
    const api = await criarApi({ tenantId: "t", pessoaId: "p" });
    await api.escreverNoTrabalho("login", "cobre o cadastro também");
    await api.pararTrabalho("login");
    await api.trabalhoDepois("churn", "migrar");
    await api.trabalhoFazerAqui("churn");
    expect(chamadas.map((c) => `${c.init.method} ${c.url}`)).toEqual(["POST /api/t/t/trabalhos/login/mensagens", "POST /api/t/t/trabalhos/login/parar", "POST /api/t/t/trabalhos/churn/depois", "POST /api/t/t/trabalhos/churn/fazer-aqui"]);
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({ texto: "cobre o cadastro também" });
    expect(JSON.parse(String(chamadas[2]?.init.body))).toEqual({ depoisDe: "migrar" });
  });

  it("o Parar do chat com tasks abertas lista antes", () => {
    // QA do épico (2026-10-08): os títulos vão numa lista no corpo; o título do diálogo fica curto.
    const duas = [{ titulo: "Migrar relatórios" }, { titulo: "Dashboard <churn>" }];
    expect(textoPararTasks(duas, "Dev 1")).toBe("Parar as 2 tasks do Dev 1?");
    expect(listaPararTasks(duas)).toBe('<ul class="parar-lista"><li>Migrar relatórios</li><li>Dashboard &lt;churn&gt;</li></ul>');
    expect(textoPararTasks([{ titulo: "Migrar relatórios" }], "Dev 1")).toBe("Parar a task Migrar relatórios?");
    expect(listaPararTasks([{ titulo: "Migrar relatórios" }])).toBe("");
  });
});

describe("reducer: trabalhos, a tela da task e a memória", () => {
  const frame = (tipo: FrameSse["tipo"], dados: Record<string, unknown>): FrameSse => ({ tipo, dados } as FrameSse);

  it("trabalho.mudou relê os trabalhos e a conversa do bot; a tela da task aberta também", () => {
    const e = aplicarFrame(estadoCom([]), frame("trabalho.mudou", { trabalhoId: "migrar", agenteId: "leo", conversaId: "c-leo", estado: "rodando" }), AGORA);
    expect(e.invalidacoes).toEqual(expect.arrayContaining(["trabalhos", "conversa:c-leo"]));
    expect(e.invalidacoes).not.toContain("trabalho:migrar");
    const naTask = aplicarFrame(estadoCom([], { tela: { tipo: "trabalho", id: "migrar", voltar: { tipo: "inicio" } } }), frame("trabalho.mudou", { trabalhoId: "migrar", conversaId: "c-leo" }), AGORA);
    expect(naTask.invalidacoes).toContain("trabalho:migrar");
  });

  it("memoria.mudou atualiza a pressão na hora e relê os trabalhos; nível fora do formato é ignorado", () => {
    const e = aplicarFrame(estadoCom([]), frame("memoria.mudou", { nivel: "amarela" }), AGORA);
    expect(e.pressao).toBe("amarela");
    expect(e.invalidacoes).toContain("trabalhos");
    const lixo = estadoCom([]);
    expect(aplicarFrame(lixo, frame("memoria.mudou", { nivel: "roxa" }), AGORA)).toBe(lixo);
    expect(reduzir(estadoInicial, { tipo: "hidratar-trabalhos", trabalhos: { trabalhos: [], pressao: "vermelha", memoriaTotalMb: 9800 } }).pressao).toBe("vermelha");
  });

  it("a tela da task: pede o detalhe, guarda o ao vivo do turno dela (mesmo de outro bot) e recarregada volta a ser viva", () => {
    const tela: Tela = { tipo: "trabalho", id: "login", voltar: { tipo: "inicio" } };
    const base = { ...estadoCom([]), tela };
    expect(invalidacoesDaTela(base)).toContain("trabalho:login");
    const login = trabalho("login", { agenteId: "dev1", conversaId: "c-dev1", turnoVivoId: "tv", iniciadoEm: AGORA - MIN });
    const e = reduzir(base, { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: [] }, agora: AGORA });
    expect(conversaIdNaTela(e)).toBe("c-dev1");
    expect(e.turnosVivos.tv).toMatchObject({ conversaId: "c-dev1", estado: "rodando", trabalhoId: "login" });
    const comDelta = aplicarFrame(e, frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: "gravando" }), AGORA);
    expect(comDelta.atividades["c-dev1"]?.tv?.atual).toBe("gravando");
    // Fala nova na conversa do bot da task: a tela da task relê as mensagens dela.
    expect(aplicarFrame(e, frame("turno.fala", { turnoId: "tv", conversaId: "c-dev1" }), AGORA).invalidacoes).toContain("trabalho:login");
    expect(aplicarFrame(e, frame("turno.fala", { turnoId: "tx", conversaId: "c-outra" }), AGORA).invalidacoes).not.toContain("trabalho:login");
    // O frame turno.iniciado marca o turno do trabalho (o chat não o desenha).
    const iniciado = aplicarFrame(estadoCom([]), frame("turno.iniciado", { turnoId: "t9", conversaId: "c-leo", kind: "turno_despachado", trabalhoId: "migrar" }), AGORA);
    expect(iniciado.turnosVivos.t9?.trabalhoId).toBe("migrar");
  });

  it("QA do NOD-314 (achado 2): a tela da task aberta direto hidrata a frota e as contas", () => {
    const tela: Tela = { tipo: "trabalho", id: "login", voltar: { tipo: "inicio" } };
    const faltas = invalidacoesDaTela({ ...estadoCom([]), sessao: { tenantId: "t", pessoaId: "p" }, tela });
    expect(faltas).toContain("maquinas");
    expect(faltas).toContain("contas");
  });

  it("trabalhos são lidos com a sessão; trocar de pessoa os esquece", () => {
    expect(invalidacoesDaTela({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } })).toContain("trabalhos");
    const outra = reduzir(estadoCom([trabalho("x")], { pressao: "amarela" }), { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } });
    expect(outra.trabalhos).toBeNull();
    expect(outra.pressao).toBeNull();
  });

  it("os estados abertos da web são os do contrato", () => {
    expect([...ESTADOS_ABERTOS]).toEqual([...ESTADOS_ABERTOS_TRABALHO]);
  });
});

describe("barra lateral (#196, K8 variante 3)", () => {
  it("bot com trabalho rodando: chip com o número e o ponto na cor do bot piscando; sem trabalho, nada", () => {
    const e = estadoCom([trabalho("a"), trabalho("b", { estado: "na_fila" })]);
    expect(chipTrabalhosDoBot(e, { id: "leo", cor: "c-purple", conversaId: "c-leo" })).toBe('<span class="chip-trab" title="2 trabalhos abertos"><span class="ponto-trabalho c-purple pulso-trab" aria-hidden="true"></span>2</span>');
    expect(chipTrabalhosDoBot(e, { id: "dev1", cor: "c-green", conversaId: "c-dev1" })).toBe("");
    // Só na fila (nenhum rodando): o número fica, o ponto não pisca.
    expect(chipTrabalhosDoBot(estadoCom([trabalho("b", { estado: "na_fila" })]), { id: "leo", cor: "c-purple", conversaId: "c-leo" })).not.toContain("pulso-trab");
  });

  it("ADR-099 (parte 1): só esperando (volta marcada ou colega), o ponto vazado da espera, sem piscar; com um trabalhando, pisca", () => {
    const leo = { id: "leo", cor: "c-purple" as const, conversaId: "c-leo" };
    const volta = trabalho("volta", { acordaEm: AGORA + 20 * MIN });
    const colega = trabalho("colega", { esperandoColega: { nome: "Ze 1", desde: AGORA - 10 * MIN, trabalhoId: null } });
    expect(chipTrabalhosDoBot(estadoCom([volta, colega]), leo)).toBe('<span class="chip-trab" title="2 trabalhos abertos · 2 esperando"><span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span>2</span>');
    const comUm = chipTrabalhosDoBot(estadoCom([volta, colega, trabalho("vivo", { turnoVivoId: "t1" })]), leo);
    expect(comUm).toContain("ponto-trabalho c-purple pulso-trab");
    expect(comUm).toContain('title="3 trabalhos abertos · 2 esperando"');
    // Precisa de você junto com a espera: o ponto do bot, sem piscar (o azul por bot fica para a parte 5 da ADR-099).
    expect(chipTrabalhosDoBot(estadoCom([volta, trabalho("p", { estado: "precisa_de_voce" })]), leo)).toContain('class="ponto-trabalho c-purple"');
  });

  it("CSS: opacidade em 1,6 s e nenhuma animação com prefers-reduced-motion", () => {
    expect(css).toMatch(/@keyframes pulsa-trab \{ 0%, 100% \{ opacity: 1; \} 50% \{ opacity: \.3; \} \}/);
    expect(css).toMatch(/\.pulso-trab \{ animation: pulsa-trab 1\.6s ease-in-out infinite; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.pulso-trab \{ animation: none; \} \}/);
    expect(css).toMatch(/\.ponto-trabalho \{[^}]*background: var\(--mascote-cor, var\(--ink-3\)\);/);
  });

  it("o ícone 'Trabalhos' do topo só com trabalho aberto, com o número", () => {
    expect(renderIconeTrabalhos(estadoCom([trabalho("x", { estado: "terminado" })]))).toBe("");
    const html = renderIconeTrabalhos(estadoCom([trabalho("a"), trabalho("b", { agenteId: "dev1" })]));
    expect(html).toContain('data-act="navegar" data-tela="trabalhos"');
    expect(html).toContain('aria-label="Trabalhos: 2 abertos"');
    expect(html).toContain('<span class="contagem-topo" aria-hidden="true">2</span>');
  });
});

describe("gaveta e 'Todos os trabalhos' (#196, K3/K9/M3)", () => {
  const lista = [
    trabalho("churn", { titulo: "Dashboard de churn Q3", estado: "precisa_de_voce", ultimoPasso: "pergunta: por plano ou por segmento?" }),
    trabalho("migrar", { titulo: "Migrar relatórios", memoriaMb: 800 }),
    trabalho("rev", { titulo: "Revisar dados", origem: "colega", pedidoPorNome: "Chico", memoriaMb: 1400 }),
    trabalho("nps", { titulo: "Relatório de NPS", estado: "na_fila" }),
    trabalho("vendas", { titulo: "Atualizar vendas", origem: "rotina", rotinaNome: "Vendas", estado: "terminado", terminadoEm: HOJE + 30 * MIN }),
    trabalho("velho", { titulo: "De ontem", estado: "terminado", terminadoEm: ONTEM }),
    trabalho("dev", { agenteId: "dev1", titulo: "Login do app", origem: "colega", pedidoPorNome: "Chico", memoriaMb: 2100 }),
  ];

  it("os grupos: Precisa de você, Trabalhando (os que mais usam memória primeiro), Na fila e Terminados hoje (o de ontem sai)", () => {
    const g = agrupar(lista, AGORA);
    expect(g.precisa.map((t) => t.id)).toEqual(["churn"]);
    expect(g.trabalhando.map((t) => t.id)).toEqual(["dev", "rev", "migrar"]);
    expect(g.fila.map((t) => t.id)).toEqual(["nps"]);
    expect(g.terminados.map((t) => t.id)).toEqual(["vendas"]);
  });

  it("a gaveta do bot: o nível 'Trabalhos' com os grupos dele; a visão geral leva até lá", () => {
    const e = estadoCom(lista);
    const html = renderGavetaTrabalhos(e, "leo");
    const ordem = ["Precisa de você · 1", "Trabalhando · 2", "Na fila · 1", "Terminados hoje · 1"].map((t) => html.indexOf(t));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).not.toContain("De ontem");
    expect(html).not.toContain("Login do app");
    expect(html).toContain('data-act="abrir-trabalho" data-id="rev"');
    // ADR-125: a linha Trabalhos mora nos Atalhos do nível Ajustes.
    expect(renderDetalhes({ ...e, gaveta: { agenteId: "leo", nivel: { tipo: "ajustes" } } })).toContain('data-act="gaveta" data-nivel="trabalhos" data-agente="leo"');
    expect(renderDetalhes({ ...e, gaveta: { agenteId: "leo", nivel: { tipo: "trabalhos" } } })).toContain("Trabalhos de Leonardo");
  });

  it("'Todos os trabalhos': todos os bots, o resumo, a memória de cada um e os filtros De você / Rotinas / Entre bots", () => {
    const e = estadoCom(lista, { tela: { tipo: "trabalhos" }, trabalhos: { trabalhos: lista, pressao: null, memoriaTotalMb: 3174 } });
    const html = renderTodosOsTrabalhos(e);
    expect(html).toContain("3 trabalhando · 1 na fila · 1 precisa de você · os bots usam 3,1 GB do seu Mac");
    // QA (2026-10-08): com 0 MB (nenhum harness com processo próprio) a frase da memória some, em vez de "0 MB".
    expect(renderTodosOsTrabalhos({ ...e, trabalhos: { trabalhos: lista, pressao: null, memoriaTotalMb: 0 } })).not.toContain("os bots usam");
    expect(html.indexOf("Login do app")).toBeLessThan(html.indexOf("Revisar dados"));
    expect(html.indexOf("Revisar dados")).toBeLessThan(html.indexOf("Migrar relatórios"));
    expect(html).toContain("2,1 GB");
    expect(html).toContain("os que mais usam memória primeiro");
    expect(html).toContain('data-act="filtro-trabalhos" data-id="bots" aria-pressed="false"');
    const bots = renderTodosOsTrabalhos(e, "bots");
    expect(bots).toContain("Login do app");
    expect(bots).not.toContain("Migrar relatórios");
    expect(filtrar(lista, "rotinas").map((t) => t.id)).toEqual(["vendas"]);
    expect(filtrar(lista, "voce").map((t) => t.id)).toEqual(["churn", "migrar", "nps", "velho"]);
    expect(memoriaLegivel(620)).toBe("620 MB");
  });
});

describe("esperar não é trabalhar (ADR-099, parte 1)", () => {
  // O dia 11/10: um trabalhando de fato, onze voltas marcadas do Ze 1 e duas tasks do Leonardo esperando o Ze 1.
  const vivo = trabalho("vivo", { titulo: "Corrigir o teste", turnoVivoId: "turno-vivo", memoriaMb: 300 });
  const voltas = Array.from({ length: 11 }, (_, i) => trabalho(`volta-${i}`, { agenteId: "dev1", titulo: `PR ${i}`, acordaEm: AGORA + (11 - i) * MIN }));
  const colegas = [0, 1].map((i) => trabalho(`colega-${i}`, { titulo: `Orquestrar ${i}`, esperandoColega: { nome: "Dev 1", desde: AGORA - (i + 1) * 10 * MIN, trabalhoId: null } }));
  const fila = trabalho("fila", { titulo: "Relatório de NPS", estado: "na_fila" });
  const dia = [vivo, ...voltas, ...colegas, fila];

  it("agrupar: Trabalhando só com turno vivo; quem espera a volta ou um colega vai para Esperando (a volta mais cedo primeiro)", () => {
    const g = agrupar(dia, AGORA);
    expect(g.trabalhando.map((t) => t.id)).toEqual(["vivo"]);
    expect(g.esperando).toHaveLength(13);
    expect(g.esperando.slice(0, 2).map((t) => t.id)).toEqual(["volta-10", "volta-9"]);
    expect(g.esperando.slice(-2).map((t) => t.id)).toEqual(["colega-1", "colega-0"]);
    expect(g.fila.map((t) => t.id)).toEqual(["fila"]);
    // A volta já vencida que ninguém pegou ainda (o Mac fora, ou segurado) também não trabalha.
    expect(agrupar([trabalho("vencida", { acordaEm: AGORA - MIN })], AGORA).esperando.map((t) => t.id)).toEqual(["vencida"]);
    // Com o turno vivo, a volta já acordou: trabalha.
    expect(agrupar([trabalho("acordou", { acordaEm: AGORA - MIN, turnoVivoId: "t" })], AGORA).trabalhando.map((t) => t.id)).toEqual(["acordou"]);
  });

  it("'Todos os trabalhos': '1 trabalhando · 13 esperando · 1 na fila' e o grupo Esperando entre Trabalhando e Na fila", () => {
    const e = estadoCom(dia, { tela: { tipo: "trabalhos" }, trabalhos: { trabalhos: dia, pressao: null, memoriaTotalMb: 300 } });
    const html = renderTodosOsTrabalhos(e);
    expect(html).toContain("1 trabalhando · 13 esperando · 1 na fila · os bots usam 300 MB do seu Mac");
    const ordem = ["Trabalhando · 1", "Esperando · 13", "Na fila · 1"].map((t) => html.indexOf(t));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain('data-grupo="esperando"');
    expect(html).toContain("esperando Dev 1");
    expect(html).not.toContain("Trabalhando · 14");
  });

  it("a gaveta do bot: Esperando separado de Trabalhando", () => {
    const html = renderGavetaTrabalhos(estadoCom(dia), "leo");
    expect(html).toContain("Trabalhando · 1");
    expect(html).toContain("Esperando · 2");
    const ze = renderGavetaTrabalhos(estadoCom(dia), "dev1");
    expect(ze).toContain("Esperando · 11");
    expect(ze).not.toContain("Trabalhando ·");
  });

  it("a web repete a regra do domínio (esperaDoTrabalho) em foraDoMac", () => {
    for (const t of [...dia, trabalho("x", { estado: "precisa_de_voce", acordaEm: AGORA + MIN }), trabalho("vencida", { acordaEm: AGORA - MIN })]) {
      expect(foraDoMac(t)).toBe(esperaDoTrabalho(t) !== null);
    }
  });
});

describe("memória (#196, M1/M2/M3)", () => {
  it("amarela e vermelha, centralizadas, com 'Ver' que abre 'Todos os trabalhos'; verde ou sem leitura, nada", () => {
    expect(pilulaMemoria("verde", 3)).toBe("");
    expect(pilulaMemoria(null, 3)).toBe("");
    const amarela = pilulaMemoria("amarela", 18);
    expect(amarela).toMatch(/^<div class="linha-centro-wrap"/);
    expect(amarela).toContain("<b>Pouca memória no seu Mac</b><span class=\"pm-detalhe\">· 18 rodando aqui</span><span class=\"pm-ver\">Ver ›</span>");
    // QA × pranchas M1–M3 (2026-10-08): a pílula abre com o chip de memória, nas duas cores.
    expect(amarela).toMatch(/data-tela="trabalhos"><svg class="pm-icone"/);
    expect(pilulaMemoria("vermelha", 24, false)).toMatch(/<span class="pilula-memoria vermelha"><svg class="pm-icone"/);
    expect(amarela).toContain('data-act="navegar" data-tela="trabalhos"');
    expect(pilulaMemoria("vermelha", 24)).toContain("<b>Seu Mac está quase sem memória</b><span class=\"pm-detalhe\">· pode travar; 24 rodando aqui</span>");
  });

  it("no topo de 'Todos os trabalhos' sob pressão", () => {
    const e = estadoCom([trabalho("a")], { tela: { tipo: "trabalhos" }, pressao: "amarela" });
    const html = renderTodosOsTrabalhos(e);
    expect(html.indexOf("Pouca memória no seu Mac")).toBeGreaterThan(-1);
    expect(html.indexOf("Pouca memória no seu Mac")).toBeLessThan(html.indexOf("Trabalhando ·"));
    expect(css).toMatch(/\.pilula-memoria\.amarela \{ background: var\(--warning-soft\);/);
    expect(css).toMatch(/\.pilula-memoria\.vermelha \{ background: var\(--danger-soft\);/);
  });
});

describe("telemetria das linhas (#191)", () => {
  it("'mostrada' uma vez por linha por carga; 'aberta' a cada clique; sai em lote depois da espera", () => {
    const enviados: unknown[][] = [];
    const agenda: (() => void)[] = [];
    const t = criarTelemetria(async (e) => { enviados.push(e); }, (fn, ms) => { expect(ms).toBe(ESPERA_TELEMETRIA_MS); agenda.push(fn); });
    const linha = { tipo: "rotina" as const, agenteId: "leo", chaveLinha: "rotina:trabalho:r1" };
    t.mostrada(linha);
    t.mostrada(linha);
    t.aberta(linha);
    t.aberta(linha);
    expect(enviados).toEqual([]);
    expect(agenda).toHaveLength(1);
    agenda[0]!();
    expect(enviados).toEqual([[{ ...linha, acao: "mostrada" }, { ...linha, acao: "aberta" }, { ...linha, acao: "aberta" }]]);
  });

  it("o lote cheio sai na hora; a falha de rede não quebra nada", () => {
    let lotes = 0;
    const t = criarTelemetria(() => { lotes++; return Promise.reject(new Error("sem rede")); }, () => undefined);
    for (let i = 0; i < LOTE_TELEMETRIA; i++) t.mostrada({ tipo: "bots", agenteId: "a", chaveLinha: `k${i}` });
    expect(lotes).toBe(1);
    const lança = criarTelemetria(() => { throw new Error("sem sessão"); }, () => undefined);
    lança.aberta({ tipo: "task", agenteId: "a", chaveLinha: "x" });
    expect(() => lança.descarregar()).not.toThrow();
  });

  it("o Modo dev mostra a taxa por tipo", () => {
    const e = { ...estadoInicial, modoDev: { ligado: true, raioX: {}, taxasLinhas: [{ tipo: "rotina" as const, mostradas: 50, abertas: 6, taxa: 0.12 }, { tipo: "task" as const, mostradas: 0, abertas: 0, taxa: null }] } };
    expect(renderTaxasLinhas(e)).toContain("Linhas abertas: rotina 12% · task —");
    expect(renderTaxasLinhas({ ...e, modoDev: { ...e.modoDev, ligado: false } })).toBe("");
  });
});

describe("tempo da task: esperando x trabalhando (protótipo aprovado em 2026-10-08)", () => {
  const pedidoAoDev = { nome: "Dev 1", desde: AGORA - 80 * MIN, trabalhoId: "w-dev1" };
  const esperando = trabalho("resumo", { titulo: "Resumo do time", iniciadoEm: AGORA - 300 * MIN, trabalhouMs: 21 * MIN, esperandoColega: pedidoAoDev });

  it("rodando sem turno vivo e com pedido em aberto é \"esperando Dev 1\": ponto vazado, sem pulsar; com turno vivo volta a trabalhar", () => {
    const e = estadoCom([esperando], { faixaTrabalhosAberta: "leo" });
    const faixa = renderFaixaTrabalhos(e, "leo");
    expect(faixa).toContain('<span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span>');
    // revisto em 2026-10-09: o status é texto discreto, sem classe própria (a cor do estado fica só no ponto).
    expect(faixa).toContain('<span class="ft-tempo">de você · trabalhou 21 min · aberta há 5h</span><span class="ft-passo">esperando Dev 1</span>');
    const vivo = renderFaixaTrabalhos(estadoCom([{ ...esperando, turnoVivoId: "tv" }], { faixaTrabalhosAberta: "leo" }), "leo");
    expect(vivo).not.toContain("esperando Dev 1");
    expect(vivo).toContain("pulso-trab");
  });

  it("no topo, o status curto abre o cartão: aberta há, trabalhando, esperando e o atalho para a task do colega", () => {
    const fechado = renderTopoTrabalho(estadoCom([esperando]), "resumo");
    expect(fechado).toContain('class="tk-status fora-do-mac" data-act="tempo-task" data-id="resumo" aria-expanded="false" title="Ver o tempo da task">esperando Dev 1<svg');
    expect(fechado).not.toContain("tk-pop");

    const e = reduzir(estadoCom([esperando]), { tipo: "tempo-task", id: "resumo" });
    const aberto = renderTopoTrabalho(e, "resumo");
    expect(aberto).toContain('aria-expanded="true"');
    expect(aberto).toContain("<span>Aberta há</span><b>5h</b>");
    expect(aberto).toContain("<span>Trabalhando</span><b>21 min</b>");
    expect(aberto).toContain("<span>Esperando</span><b>5h</b>");
    expect(aberto).toContain('<span style="width:7%"></span>');
    expect(aberto).toContain("Dev 1 recebeu o pedido às");
    expect(aberto).toContain('data-act="abrir-trabalho" data-id="w-dev1">Ver task</button>');
    expect(reduzir(e, { tipo: "tempo-task", id: null }).tempoTaskAberto).toBeNull();
  });

  it("o tempo trabalhado nunca passa do tempo aberto, e o resto é espera", () => {
    const e = reduzir(estadoCom([{ ...esperando, trabalhouMs: 999 * MIN, esperandoColega: null }]), { tipo: "tempo-task", id: "resumo" });
    const html = renderTopoTrabalho(e, "resumo");
    expect(html).toContain("<span>Trabalhando</span><b>5h</b>");
    expect(html).toContain("<span>Esperando</span><b>menos de 1 min</b>");
    expect(html).not.toContain("recebeu o pedido");
  });

  it("o ponto e o status da espera não usam a classe `esperando` — ela é a caixa do cartão de acesso (o anel de ~36 px do print)", () => {
    // revisto em 2026-10-09: `.esperando` (interface.css) dá padding de 12×14 px, fundo e margem ao elemento. O ponto de 8 px
    // de "esperando Eng 1" virava um anel enorme, e o status da faixa e do topo da task, uma caixa cinza.
    expect(css).toMatch(/^\.esperando\{[^}]*padding:12px 14px/m);
    const html = [
      pontoTrabalho(esperando, "c-purple"),
      renderFaixaTrabalhos(estadoCom([esperando], { faixaTrabalhosAberta: "leo" }), "leo"),
      renderTopoTrabalho(estadoCom([esperando]), "resumo"),
      renderTodosOsTrabalhos(estadoCom([esperando])),
    ].join("");
    expect(html).not.toMatch(/class="[^"]*\besperando\b[^"]*"/);
    expect(css).not.toContain(".ponto-trabalho.esperando");
  });

  it("o CSS tem o ponto de espera, o cartão e o tempo que só aparece no hover ou no foco", () => {
    expect(css).toContain(".ponto-trabalho.fora-do-mac {");
    expect(css).toContain(".ft-tempo { display: none;");
    expect(css).toContain(".ft-linha:hover .ft-tempo, .ft-linha:focus-visible .ft-tempo { display: inline; }");
    expect(css).toContain(".tk-pop {");
  });
});

describe("Fazer aqui e Fazer depois (chat limpo, PR 2; ADR-114)", () => {
  it("saem da linha 'Abriu a task' do chat e ficam no topo da tela da task e embaixo da linha dela em Trabalhos", () => {
    const antiga = trabalho("antiga", { titulo: "Relatório", criadoEm: HOJE - MIN });
    const nova = trabalho("nova", { titulo: "Planilha", estado: "na_fila" });
    const e = estadoCom([antiga, nova]);
    const topo = renderTopoTrabalho(e, "nova");
    expect(topo).toContain('data-act="trabalho-fazer-aqui" data-id="nova"');
    expect(topo).toContain('data-act="trabalho-depois" data-id="nova" data-depois="antiga"');
    const gaveta = renderGavetaTrabalhos(e, "leo");
    expect(gaveta).toContain('<div class="tr-item"><button type="button" class="gv-linha tr-linha" data-act="abrir-trabalho" data-id="nova">');
    expect(gaveta).toContain('data-act="trabalho-fazer-aqui" data-id="nova"');
    // A task terminada, ou que não foi a pessoa que pediu, não tem os botões.
    const fim = estadoCom([trabalho("x", { estado: "terminado", terminadoEm: HOJE }), trabalho("r", { origem: "rotina" })]);
    expect(renderTopoTrabalho(fim, "x")).not.toContain("trabalho-fazer-aqui");
    expect(renderTopoTrabalho(fim, "r")).not.toContain("trabalho-fazer-aqui");
  });

  // QA do PR 2: as três frentes de um lote paralelo ganhavam "Fazer depois da <irmã>" e "Fazer aqui" em Trabalhos; no chat de
  // antes a linha "Começou N frentes" nunca teve os botões.
  it("a frente de um lote com várias frentes não leva os botões; a frente única do lote leva, como a 'Abriu a task' de antes", () => {
    const lote = ["a", "b", "c"].map((id, i) => trabalho(id, { titulo: `NOD-${id}`, forma: "frente", loteId: "L", criadoEm: HOJE - (3 - i) * MIN }));
    const e = estadoCom(lote);
    for (const id of ["a", "b", "c"]) expect(renderTopoTrabalho(e, id), id).not.toContain("trabalho-fazer-aqui");
    expect(renderGavetaTrabalhos(e, "leo")).not.toContain("trabalho-depois");
    const unica = estadoCom([trabalho("u", { titulo: "Roteiros", forma: "frente", loteId: "L2" })]);
    expect(renderTopoTrabalho(unica, "u")).toContain('data-act="trabalho-fazer-aqui" data-id="u"');
  });
});
