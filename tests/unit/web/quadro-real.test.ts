import { describe, expect, it } from "vitest";
import type { EntradaHistoricoDto, QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { lerCodigo } from "../../../src/domain/codigo-tarefa.ts";
import { FORMATO_CODIGO, botDoLink, fraseDoErroDoMover, reciboDaNovaTarefa, acesos, atalhosDePrazo, codigoDaTarefa, codigoNaUrl, destinosDaTarefa, responsaveisDaTarefa, faltaParaOPrazo, linhaDoHistorico, opcoesDeStatus, fraseDoPrazo, historicoDaFaixa, linhaUnica, respostaDoBot, tarefaNoQuadro, tarefasPorStatus, type Faixa } from "../../../web/lib/quadro-dados.ts";
import { avisoDoGithub, cardDaTarefa, esperandoOutro, faixaDoQuadro, formNovaTarefa, menuDePrazo, pessoasDoQuadro, pilulaDoQuadro, prMaisProblematico, quadroDaMeta, rotuloDoModo, semQuadro, tarefaAberta, tempoDoTurno, tomDoPr, topoDoQuadro } from "../../../web/telas/quadro-real.ts";
import { card, confiar } from "../../../web/telas/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { RECUSAS_DO_MOVER } from "../../../src/use-cases/quadro.ts";

/** NOD-442: o quadro de verdade na tela, sem DOM (o Chrome real fica em tests/concurrency/quadro-jornada-chrome.test.ts). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: null, prioridade: "sem", codigo: `#${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[], extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: null, modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length, ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">A</span>`), nome: "Ada" } : null);
const fala = (id: string, de: "eu" | "a" | "b", texto: string, extra = {}) => ({
  id, texto, kind: "texto" as const, parcial: false, criadoEm: 1,
  autoria: de === "eu" ? { autor_tipo: "pessoa" as const, autor_id: "p" } : { autor_tipo: "agente" as const, autor_id: de }, ...extra,
}) as never;

describe("quadro-dados", () => {
  it("o código do card: o do quadro (NOD-416); de um servidor velho, o do Linear e, sem ele, # e os 4 primeiros do id", () => {
    expect(codigoDaTarefa({ id: "ab-cd-ef", linearId: "NOD-1", codigo: "ZE-7" })).toBe("ZE-7");
    expect(codigoDaTarefa({ id: "ab-cd-ef", linearId: "NOD-1" })).toBe("NOD-1");
    expect(codigoDaTarefa({ id: "ab-cd-ef", linearId: null })).toBe("#abcd");
  });

  it("revisão 3 do PR #623: na URL vai o código do quadro; a tarefa sem número leva o uuid, nunca #ABCD nem o id do Linear", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(codigoNaUrl({ id, numero: 7, codigo: "ZE-7" })).toBe("ZE-7");
    expect(codigoNaUrl({ id, numero: null, codigo: "NOD-1" })).toBe(id);
    expect(codigoNaUrl({ id, numero: null, codigo: "#1000" })).toBe(id);
    expect(codigoNaUrl({ id, numero: 3 })).toBe(id);
  });

  it("revisão 4 do PR #623: com número mas o quadro sem prefixo (janela de deploy), o código provisório não vai à URL", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    // codigoDaTarefa do servidor sem prefixo: `#` + 4 do id, ou o id do Linear.
    expect(codigoNaUrl({ id, numero: 4, codigo: "#ABCD", linearId: null })).toBe(id);
    expect(codigoNaUrl({ id, numero: 4, codigo: "#1000", linearId: null })).toBe(id);
    expect(codigoNaUrl({ id, numero: 4, codigo: "NOD-4", linearId: "NOD-4" })).toBe(id);
    expect(codigoNaUrl({ id, numero: 4, codigo: "NOD-77", linearId: "NOD-77" })).toBe(id);
    expect(codigoNaUrl({ id, numero: 4, codigo: "LIN-PROJ-1", linearId: "LIN-PROJ-1" })).toBe(id);
    // O código do quadro vai, também com o Linear ligado.
    expect(codigoNaUrl({ id, numero: 4, codigo: "ZE2-4", linearId: "NOD-77" })).toBe("ZE2-4");
    expect(codigoNaUrl({ id, numero: 12, codigo: "ZE-12", linearId: null })).toBe("ZE-12");
  });

  it("revisão 4 do PR #623: FORMATO_CODIGO da web aceita o mesmo que lerCodigo do servidor", () => {
    const casos = ["ZE-12", "ze-12", "#ZE-12", "ZE2-3", "Q-1", "ABCD-1", "ZE-0", "ZE-01", "#abcd", "#1000", "NOD-4", "LIN-PROJ-1", "", "-1", "ZE-1234567890", "ZE-123456789"];
    for (const c of casos) expect([c, FORMATO_CODIGO.test(c.trim())]).toEqual([c, lerCodigo(c) !== null]);
  });

  it("revisão 2 do PR #623: o recibo de Nova tarefa diz a coluna e quem começou pela resposta, não um Backlog fixo", () => {
    const lote = (ids: string[]) => ({ id: "l", quadroId: "q1", autor: { tipo: "pessoa" as const }, resumo: "", tarefaIds: ids, desfeitoEm: null, criadoEm: 1 });
    // O quadro sem Backlog: a nova cai na primeira espera (Ideias), e ninguém começa.
    const ideias = colunasDto([{ id: "ideias", nome: "Ideias", grupo: "nao_iniciado" }, ...COLUNAS_PADRAO.filter((c) => c.id !== "backlog")]);
    const nova = t("n", { status: "ideias", titulo: "Planos" });
    expect(reciboDaNovaTarefa("Planos", { quadro: q([t("1"), nova], { colunas: ideias }), lote: lote(["n"]), comecaram: [] }))
      .toBe("Planos: em Ideias. Ninguém começou.");
    // A que começou (quadro só com colunas que acionam ou uma regra do servidor): o recibo diz o bot.
    const comecou = t("n", { status: "fazendo", titulo: "Planos" });
    expect(reciboDaNovaTarefa("Planos", { quadro: q([comecou]), lote: lote(["n"]), comecaram: [{ agenteNome: "Ada" }] }))
      .toBe("Planos: em Fazendo. Ada começou.");
    // Sem quadro na resposta (servidor velho), só o título e ninguém.
    expect(reciboDaNovaTarefa("Planos", { quadro: null, lote: null })).toBe("Planos: criada. Ninguém começou.");
  });

  it("revisão 2 do PR #623: o mover que falha diz o porquê do servidor no 4xx; sem rede, a de sempre", () => {
    expect(fraseDoErroDoMover({ status: 409, codigo: "estado_invalido", motivo: "mudou_de_quadro", message: "Isso não pode ser feito agora." }))
      .toEqual({ texto: "Não deu para mudar a tarefa de quadro: outra mudança levou a tarefa para outro quadro antes. Relendo.", reler: true });
    expect(fraseDoErroDoMover({ status: 400, codigo: "entrada_invalida", motivo: "ja_neste_quadro" }).texto).toContain("ela já está nesse quadro");
    // Sem motivo conhecido, a frase que o servidor mandou (a da tabela, nunca a causa).
    expect(fraseDoErroDoMover({ status: 404, codigo: "nao_encontrado", motivo: "outro", message: "Não encontramos o que você pediu." }).texto)
      .toBe("Não deu para mudar a tarefa de quadro. Não encontramos o que você pediu.");
    expect(fraseDoErroDoMover({ status: 0, codigo: "sem_internet" })).toEqual({ texto: "Sem conexão com o servidor agora. Tente de novo em instantes.", reler: false });
    expect(fraseDoErroDoMover(null).texto).toBe("Não deu para mudar a tarefa de quadro. Relendo.");
    // Toda recusa que a rota manda como motivo tem frase na tela.
    for (const motivo of Object.keys(RECUSAS_DO_MOVER)) expect(fraseDoErroDoMover({ status: 400, motivo }).texto, motivo).toMatch(/^Não deu para mudar a tarefa de quadro: /);
  });

  it("revisão 2 do PR #623: o link da tarefa de um bot que não está na lista avisa na hora, sem esperar o teto", async () => {
    let esperas = 0;
    const esperar = async () => { esperas++; };
    // A lista já chegou e o bot não está: null sem esperar nada.
    expect(await botDoLink(() => undefined, () => true, esperar)).toBeNull();
    expect(esperas).toBe(0);
    // A lista ainda não chegou: espera; quando chega com o bot, devolve o bot.
    let lida = false;
    const bot = await botDoLink(() => (lida ? { id: "a" } : undefined), () => lida, async () => { esperas++; if (esperas === 3) lida = true; });
    expect(bot).toEqual({ id: "a" });
    // A lista que nunca chega: o teto, e null.
    esperas = 0;
    expect(await botDoLink(() => undefined, () => false, esperar, 5)).toBeNull();
    expect(esperas).toBe(5);
  });

  it("as tarefas por status, na ordem", () => {
    const por = tarefasPorStatus(q([t("b", { ordem: 2 }), t("a", { ordem: 1 }), t("c", { status: "feito" })]));
    expect(por.afazer!.map((x) => x.id)).toEqual(["a", "b"]);
    expect(por.feito!.map((x) => x.id)).toEqual(["c"]);
  });

  it("acende o que mudou e o que a dica do frame disse; a primeira leitura e a troca de quadro não acendem nada", () => {
    const a = q([t("1"), t("2")]);
    expect(acesos(null, a).size).toBe(0);
    expect([...acesos(a, q([t("1", { status: "feito" }), t("2"), t("3")]))]).toEqual(["1", "3"]);
    expect([...acesos(a, a, ["2"])]).toEqual(["2"]);
    expect(acesos(a, q([t("1", { status: "feito" })], { id: "q2" })).size).toBe(0);
  });

  it("a frase do prazo", () => {
    expect(fraseDoPrazo("2026-11-06")).toBe("até 6 nov");
    expect(fraseDoPrazo(null)).toBe("sem prazo");
    expect(fraseDoPrazo("amanhã")).toBe("sem prazo");
  });

  it("a resposta do bot: a última fala final dele depois do pedido, sem markdown; de outro bot ou parcial não conta", () => {
    const ms = [fala("0", "a", "antes"), fala("p", "eu", "pedido"), fala("1", "b", "outro bot"), fala("2", "a", "parcial", { parcial: true }), fala("3", "a", "Pus **X** em [A fazer](u).\n\nok")];
    expect(respostaDoBot(ms, "a", "p")).toEqual({ id: "3", texto: "Pus X em A fazer. ok", completo: "Pus **X** em [A fazer](u).\n\nok" });
    expect(respostaDoBot(ms.slice(0, 3), "a", "p")).toBeNull();
    expect(respostaDoBot(ms, "a", "sumiu")).toBeNull();
    // A fala do meio do turno dá lugar à última; a próxima fala da pessoa encerra a busca (codex rodada 5).
    const depois = [...ms, fala("4", "a", "Pronto: 3 tarefas."), fala("5", "eu", "outro pedido"), fala("6", "a", "de outro pedido")];
    expect(respostaDoBot(depois, "a", "p")).toEqual({ id: "4", texto: "Pronto: 3 tarefas.", completo: "Pronto: 3 tarefas." });
  });

  it("revisão 12 do #646: com os turnos do pedido, a fala de outro turno do anfitrião não é a resposta; a sem turno passa", () => {
    const ms = [fala("p", "eu", "pedido"), fala("1", "a", "do pedido", { turnoId: "T1" }), fala("2", "a", "de outro turno", { turnoId: "T9" })];
    expect(respostaDoBot(ms, "a", "p", new Set(["T1"]))).toEqual({ id: "1", texto: "do pedido", completo: "do pedido" });
    expect(respostaDoBot(ms, "a", "p", new Set())).toEqual({ id: "2", texto: "de outro turno", completo: "de outro turno" });
    expect(respostaDoBot([...ms, fala("3", "a", "sem turno")], "a", "p", new Set(["T1"]))).toEqual({ id: "3", texto: "sem turno", completo: "sem turno" });
  });

  it("linhaUnica tira bloco de código e colapsa espaços; o histórico guarda só a pessoa e o anfitrião, até n", () => {
    expect(linhaUnica("a ```x\ny``` b")).toBe("a b");
    const h = historicoDaFaixa([fala("1", "eu", "oi"), fala("2", "b", "outro"), fala("3", "a", "ok"), fala("4", "a", "fim")], "a", 2);
    expect(h.map((x) => [x.id, x.de])).toEqual([["3", "bot"], ["4", "bot"]]);
  });

  it("a tarefa aberta que saiu do quadro volta null", () => {
    expect(tarefaNoQuadro(q([t("1")]), "1")?.id).toBe("1");
    expect(tarefaNoQuadro(q([t("1")]), "2")).toBeNull();
    expect(tarefaNoQuadro(null, "1")).toBeNull();
  });
});

describe("quadro-real (o html)", () => {
  it("o card: a tarefa que espera a pessoa segue com o bot e diz \"te perguntou\" (ADR-162); bloqueado mostra o motivo; PR e Linear viram etiquetas", () => {
    const espera = cardDaTarefa(t("1", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Qual workspace?" }), agente);
    expect(espera.perguntou).toBe("Qual workspace?");
    expect(espera.responsavel?.nome).not.toBe("Você");
    expect(espera.responder).toBeUndefined();
    const h = String(card(espera));
    // 2026-11-10: o chip com sino na linha de cima do card substitui o "te perguntou".
    expect(h).toContain('<div class="qd-card-l1">');
    expect(h.slice(h.indexOf('<div class="qd-card-l1">'), h.indexOf("</div>"))).toContain('<span class="qd-espera qd-espera-voce" title="Esperando você responder">');
    expect(h).not.toContain("qd-perguntou");
    expect(h).not.toContain("qd-voce-frase");
    expect(h).not.toContain("qd-precisa");
    expect(h).toContain("Esperando você responder: Qual workspace?");
    const bloq = cardDaTarefa(t("2", { status: "bloqueado", pergunta: "Falta o token" }), agente);
    expect(JSON.stringify(bloq)).toContain("Falta o token");
    const pr = cardDaTarefa(t("3", { prUrl: "https://github.com/o/r/pull/9", linearId: "NOD-9" }), agente);
    expect(pr.tags).toEqual(expect.arrayContaining(["PR #9", "Linear"]));
    // NOD-416: o código do card é o do quadro (estável); o do Linear fica na etiqueta e em "No Linear".
    expect(pr.codigo).toBe("#3");
  });

  it("texto hostil (título, meta, descrição, pergunta, nome do bot) sai escapado em todo html", () => {
    const tm = t("1", { titulo: MAL, descricao: MAL, pergunta: MAL, status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, agenteNome: MAL });
    const qm = q([tm], { meta: MAL, agenteNome: MAL });
    const htmls = [
      quadroDaMeta({ q: qm, nome: MAL, agente, filtro: "todos", alternadas: new Set(), acesas: new Set() }),
      tarefaAberta({ t: tm, q: qm, agente }),
      faixaDoQuadro({ faixa: { tipo: "resposta", texto: MAL, loteId: MAL, mensagemId: "m" }, avatarBot: null, historico: [{ id: "h", de: "bot", texto: MAL, em: 1 }], aberto: true, hora: () => "10:00" }),
      faixaDoQuadro({ faixa: { tipo: "erro", texto: MAL }, avatarBot: null, historico: [], aberto: false, hora: () => "10:00" }),
      pilulaDoQuadro({ meta: MAL, nome: MAL }),
    ];
    for (const h of htmls) {
      expect(h).not.toContain("<img");
      expect(h).not.toMatch(/onerror="/);
    }
  });

  it("os links da tarefa: só http(s), em aba nova com noopener; javascript: não vira link", () => {
    const boa = tarefaAberta({ t: t("1", { prUrl: "https://github.com/o/r/pull/3", linearId: "NOD-3", linearUrl: "https://linear.app/x/NOD-3" }), q: q([]), agente });
    expect(boa).toContain(`href="https://github.com/o/r/pull/3"`);
    expect(boa).toContain(`rel="noopener noreferrer"`);
    const ruim = tarefaAberta({ t: t("1", { prUrl: "javascript:alert(1)", linearId: "NOD-3", linearUrl: "javascript:alert(1)" }), q: q([]), agente });
    expect(ruim).not.toContain("javascript:");
  });

  it("NOD-421: os PRs ligados nos Entregáveis (estado em texto), as linhas de sistema em Atividade e o +1 no card", () => {
    const prs = [
      { repo: "gamefik/nod", numero: 612, url: "https://github.com/gamefik/nod/pull/612", estado: "aberto" as const, ci: "falhou" as const, conflito: true },
      { repo: "gamefik/nod", numero: 613, url: "javascript:alert(1)", estado: "mergeado" as const, ci: null, conflito: false },
    ];
    const linhas = [{ tipo: "ci_falhou" as const, texto: `GitHub · CI falhou no #612 ${MAL}`, criadoEm: Date.parse("2026-11-02T14:02:00Z") }];
    const h = String(tarefaAberta({ t: t("1", { prs, linhas }), q: q([]), agente }));
    expect(h).toContain(`href="https://github.com/gamefik/nod/pull/612"`);
    expect(h).toContain("gamefik/nod #612</a><span class=\"qd-pr-estado\"> · CI falhou · conflito · aberto</span>");
    expect(h).not.toContain("javascript:");
    // 2026-11-10: os PRs têm a seção própria na lateral (as Entregas são os links dos comentários do agente).
    expect(h).toContain(`Pull requests <span class="qd-n">1</span>`);
    expect(h).toContain("Atividade");
    expect(h).toContain("GitHub · CI falhou no #612");
    expect(h).not.toMatch(/onerror="/);
    // 🧭 da Ada: o card mostra o PR mais problemático (o #612, CI falhou) com o ponto, mais "+N".
    const c = cardDaTarefa(t("1", { prUrl: "https://github.com/gamefik/nod/pull/613", prs }), agente);
    expect(c.pr).toEqual({ texto: "PR #612 +1", tom: "falhou", titulo: "CI falhou · conflito · aberto" });
    expect(c.tags).toBeUndefined();
    expect(String(card(c))).toContain(`<i class="qd-pr-ponto qd-pr-falhou" aria-hidden="true"></i>PR #612 +1<span class="qd-sr"> (CI falhou · conflito · aberto)</span></span>`);
    // Sem PR ligado nem linha: como antes (o pr_url do agente, sem Atividade).
    const antes = String(tarefaAberta({ t: t("1", { prUrl: "https://github.com/o/r/pull/3" }), q: q([]), agente }));
    expect(antes).toContain(`Pull requests <span class="qd-n">1</span>`);
    expect(antes).not.toContain("Atividade");
  });

  it("3ª revisão do PR #621: o ícone de cada PR em Entregáveis segue o estado (CI falhando, fechado sem merge, aberto, mergeado)", () => {
    const pr = (numero: number, o: Partial<NonNullable<TarefaDto["prs"]>[number]>) => ({ repo: "o/r", numero, url: `https://github.com/o/r/pull/${numero}`, estado: "aberto" as const, ci: null, conflito: false, ...o });
    const prs = [pr(1, { ci: "falhou" }), pr(2, { estado: "fechado" }), pr(3, { ci: "ok" }), pr(4, { estado: "mergeado" })];
    const h = String(tarefaAberta({ t: t("1", { prs }), q: q([]), agente }));
    const icones = [...h.matchAll(/<li><svg[^>]*class="([^"]*)"[^>]*>.*?o\/r #(\d+)<\/a>/g)].map((m) => [m[2], /qd-ic-[a-z]+/.exec(m[1]!)?.[0]]);
    expect(icones).toEqual([["1", "qd-ic-falhou"], ["2", "qd-ic-fechado"], ["3", "qd-ic-fila"], ["4", "qd-ic-mergeado"]]);
  });

  it("NOD-421 (🧭): o tom do ponto e o PR mais problemático do card", () => {
    const pr = (numero: number, o: Partial<{ estado: "aberto" | "mergeado" | "fechado"; ci: "pendente" | "ok" | "falhou" | null; conflito: boolean }>) =>
      ({ repo: "o/r", numero, url: `https://github.com/o/r/pull/${numero}`, branch: "x", estado: "aberto" as const, ci: null, conflito: false, ...o });
    expect(tomDoPr(pr(1, { ci: "falhou" }))).toBe("falhou");
    expect(tomDoPr(pr(1, { ci: "ok", conflito: true }))).toBe("conflito");
    expect(tomDoPr(pr(1, { ci: "pendente" }))).toBe("pendente");
    expect(tomDoPr(pr(1, {}))).toBe("pendente");
    expect(tomDoPr(pr(1, { ci: "ok" }))).toBe("ok");
    expect(tomDoPr(pr(1, { estado: "mergeado", ci: "falhou" }))).toBe("mergeado");
    expect(tomDoPr(pr(1, { estado: "fechado" }))).toBe("fechado");
    expect(prMaisProblematico([pr(1, { estado: "mergeado" }), pr(2, { ci: "ok" }), pr(3, { conflito: true })]).numero).toBe(3);
    expect(prMaisProblematico([pr(1, { estado: "mergeado" }), pr(2, { estado: "fechado" })]).numero).toBe(1);
    expect(prMaisProblematico([pr(4, { ci: "ok" }), pr(9, { ci: "ok" })]).numero).toBe(9);
    // Sem PR ligado: a tag de antes, sem ponto.
    expect(cardDaTarefa(t("1", { prUrl: "https://github.com/o/r/pull/3" }), agente).tags).toEqual(["PR #3"]);
  });

  it("coluna recolhida por padrão abre quando tem tarefa; vazia continua recolhida", () => {
    const vazio = quadroDaMeta({ q: q([t("1")]), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() });
    const comCancelada = quadroDaMeta({ q: q([t("1", { status: "cancelado" })]), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() });
    const recolhidas = (h: string) => (h.match(/qd-col-recolhida/g) ?? []).length;
    expect(recolhidas(comCancelada)).toBe(recolhidas(vazio) - 1);
  });

  it("a faixa: aguardando mostra o giro; resposta com lote mostra Desfazer; sem lote, não", () => {
    const base = { avatarBot: null, historico: [], aberto: false, hora: () => "10:00" };
    expect(faixaDoQuadro({ ...base, faixa: trab() })).toContain("Mexendo no quadro");
    expect(faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "ok", loteId: "L1", mensagemId: "m" } })).toContain(`data-act="qc-desfazer" data-id="L1"`);
    expect(faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "ok", loteId: null, mensagemId: "m" } })).not.toContain("qc-desfazer");
  });

  it("ADA-4: a fala da pessoa sobe acima do status; cada estado tem saída (Tentar de novo, Ver na Conversa)", () => {
    const base = { avatarBot: null, historico: [], aberto: false, hora: () => "10:00" };
    const s = (f: Faixa, agora?: number): string => String(faixaDoQuadro({ ...base, faixa: f, ...(agora !== undefined ? { agora } : {}) }));
    const env = s({ tipo: "enviando", fala: "Cria <X>", texto: "Cria <X>", idEnvio: "K", guardados: [] });
    expect(env).toContain(`<span class="qc-fala-txt" title="Cria &lt;X&gt;">Cria &lt;X&gt;</span><span class="qc-fala-est">enviando</span>`);
    expect(env).toContain("Enviando…");
    const fal = s({ tipo: "falhou", fala: "Cria X", texto: "Cria X", idEnvio: "K" });
    expect(fal).toContain("Não saiu.");
    expect(fal).toContain(`data-act="qc-tentar"`);
    expect(fal).not.toMatch(/qc-erro|role="alert"/);
    expect(s(trab({ status: "Usando Linear" }))).toContain("Usando Linear");
    // A fala da pessoa fica fora da região viva (o leitor de tela não a repete a cada status: revisão 1 do #646).
    expect(s(trab({ status: "Usando Linear" }))).toContain(`<p class="qc-fala" aria-hidden="true">`);
    expect(s(trab({ status: "Usando Linear" }))).toContain(`<span class="qd-sr">enviada</span>`);
    expect(s(trab({ retomando: true }))).toContain("Retomando…");
    expect(s(trab({ parando: true }))).toContain("Parando…");
    const dem = s(trab({ demorando: true, parando: true }));
    expect(dem).toContain("Ainda trabalhando…");
    expect(dem).toContain(`data-act="qc-abrir-conversa"`);
    expect(s(trab({ encerrado: true }))).toContain("Terminando…");
    expect(s({ tipo: "parou", fala: "x", pedidoId: "m", porVoce: true })).toContain("Parado por você.");
    const meio = s({ tipo: "parou", fala: "x", pedidoId: "m", porVoce: false });
    expect(meio).toContain("Parou no meio.");
    expect(meio).toContain(`data-act="qc-abrir-conversa"`);
    // O tempo do turno é aria-hidden (a região viva não anuncia a cada segundo) e só aparece depois de 10 s.
    expect(s(trab({ desde: 0 }), 14_000)).toContain(`<span class="qc-tempo" aria-hidden="true" data-desde="0"> · 14 s</span>`);
    expect(tempoDoTurno(0, 9_999)).toBe("");
    expect(tempoDoTurno(0, 125_000)).toBe(" · 2 min");
  });
});

function trab(o: Partial<Extract<Faixa, { tipo: "trabalhando" }>> = {}): Faixa {
  return { tipo: "trabalhando", fala: "Cria X", pedidoId: "m", turnoId: "T", status: null, desde: 0, ultimoFrameEm: 0, demorando: false, retomando: false, segue: null, desisteEm: null, parando: false, encerrado: false, ...o };
}

describe("revisão do PR #621: o estado do PR para leitor de tela e o aviso do GitHub no topo", () => {
  it("o estado do PR do card vai num qd-sr (o ponto é aria-hidden e o title não é lido por todo leitor)", () => {
    const prs = [{ repo: "gamefik/nod", numero: 7, url: "https://github.com/gamefik/nod/pull/7", estado: "mergeado" as const, ci: "ok" as const, conflito: false }];
    const h = String(card(cardDaTarefa(t("1", { prs }), agente)));
    expect(h).toMatch(/<span class="qd-sr"> \([^)]*mergeado[^)]*\)<\/span>/);
  });

  it("o aviso é uma linha discreta (p, sem role de alerta), escapada; sem aviso, nada", () => {
    expect(avisoDoGithub({ avisoGithub: null })).toBe("");
    expect(avisoDoGithub({})).toBe("");
    const h = String(avisoDoGithub({ avisoGithub: "GitHub não conectado no servidor: os PRs não sincronizam" }));
    expect(h).toBe(`<p class="qd-aviso-gh">GitHub não conectado no servidor: os PRs não sincronizam</p>`);
    expect(String(avisoDoGithub({ avisoGithub: MAL }))).not.toContain("<img");
    const tela = String(quadroDaMeta({ q: q([], { avisoGithub: "GitHub · sem acesso a gamefik/privado" }), nome: "Ana", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() }));
    expect(tela).toContain(`<p class="qd-aviso-gh">GitHub · sem acesso a gamefik/privado</p>`);
    expect(tela).not.toMatch(/role="alert"|aria-live="assertive"/);
  });

  it("revisão 5 do PR #630: a importação que falhou é role=status (a releitura do quadro não re-anuncia como alerta)", () => {
    const importacao = { id: "i1", quadroId: "q1", time: "NOD", filtro: null, estado: "falhou" as const, total: 190, trazidas: 120, erro: "Parei em 120 de 190: o Linear não respondeu.", loteId: null, colunas: null, criadoEm: 0, atualizadoEm: 0 };
    const h = String(topoDoQuadro(q([], { importacao }), { agora: 0 }));
    expect(h).toContain(`<span class="qd-imp qd-imp-erro" role="status">Parei em 120 de 190: o Linear não respondeu.</span>`);
    expect(h).not.toContain('role="alert"');
  });
});

describe("NOD-415 (ADR-141): meta opcional, prazo e criar pela tela", () => {
  // Quarta, 04/11/2026, 10h em São Paulo.
  const QUARTA = Date.parse("2026-11-04T13:00:00Z");

  it("os atalhos de prazo: hoje, amanhã, a próxima sexta e sábado, e o fim do mês, pela data de São Paulo", () => {
    expect(atalhosDePrazo(QUARTA)).toEqual([
      { rotulo: "Hoje", valor: "2026-11-04" }, { rotulo: "Amanhã", valor: "2026-11-05" }, { rotulo: "Sexta", valor: "2026-11-06" },
      { rotulo: "Sábado", valor: "2026-11-07" }, { rotulo: "Fim do mês", valor: "2026-11-30" },
    ]);
    // 01h UTC de quinta ainda é quarta em São Paulo.
    expect(atalhosDePrazo(Date.parse("2026-11-05T01:00:00Z"))[0]?.valor).toBe("2026-11-04");
    // Na sexta, "Sexta" é hoje; fim de dezembro vira o 31.
    expect(atalhosDePrazo(Date.parse("2026-12-04T13:00:00Z")).map((a) => a.valor)).toEqual(["2026-12-04", "2026-12-05", "2026-12-04", "2026-12-05", "2026-12-31"]);
  });

  it("quanto falta para o prazo", () => {
    expect(faltaParaOPrazo(null, QUARTA)).toBe("");
    expect(faltaParaOPrazo("2026-11-04", QUARTA)).toBe("vence hoje");
    expect(faltaParaOPrazo("2026-11-05", QUARTA)).toBe("falta 1 dia");
    expect(faltaParaOPrazo("2026-11-11", QUARTA)).toBe("faltam 7 dias");
    expect(faltaParaOPrazo("2026-11-03", QUARTA)).toBe("venceu");
  });

  it("sem meta (fluxo contínuo): só + Meta e o prazo, nenhuma fração nem barra", () => {
    const h = String(topoDoQuadro(q([t("1"), t("2", { status: "feito" })], { meta: null, feitas: 1, total: 2, prazo: "2026-11-11" }), { agora: QUARTA }));
    expect(h).toContain("qd-meta-fluxo");
    expect(h).toContain(">+ Meta<");
    expect(h).toContain("faltam 7 dias");
    expect(h).not.toMatch(/de 2 feitas|progressbar|qd-barra/);
  });

  it("com meta: a meta clicável, a barra, N de M feitas e quanto falta; cumprida no lugar do falta", () => {
    const h = String(topoDoQuadro(q([], { meta: MAL, feitas: 1, total: 4, prazo: "2026-11-05" }), { agora: QUARTA }));
    expect(h).toContain('data-act="editar-meta"');
    expect(h).not.toContain("<img");
    expect(h).toContain('aria-valuenow="1"');
    expect(h).toContain("1 de 4 feitas");
    expect(h).toContain("falta 1 dia");
    expect(String(topoDoQuadro(q([], { meta: "M", feitas: 4, total: 4, cumpridoEm: 9 }), { agora: QUARTA }))).toContain(">cumprida<");
    expect(String(topoDoQuadro(q([], { meta: "M", total: 0 }), { agora: QUARTA }))).toContain("nenhuma tarefa ainda");
  });

  it("editando a meta: o campo com a meta atual, escapada", () => {
    const h = String(topoDoQuadro(q([], { meta: MAL }), { agora: QUARTA, editandoMeta: true }));
    expect(h).toContain('data-form="editar-meta"');
    expect(h).toContain('id="qd-meta-in"');
    expect(h).not.toContain("<img");
  });

  it("o menu de prazo: o atual selecionado, Sem prazo, os atalhos e Outra data", () => {
    const fora = menuDePrazo("2026-12-25", QUARTA);
    expect(fora).toMatch(/<option value="2026-12-25" selected>/);
    expect(fora).toContain('<option value="">Sem prazo</option>');
    expect(fora).toContain('value="outra"');
    expect(menuDePrazo(null, QUARTA)).toContain('<option value="" selected>Sem prazo</option>');
    // O atual se lê "até …" mesmo quando é um atalho; só ele vem selecionado.
    const amanha = menuDePrazo("2026-11-05", QUARTA);
    expect(amanha).toMatch(/^<span class="qd-prazo">.*<select[^>]*><option value="2026-11-05" selected>até /);
    expect(amanha.match(/ selected/g)).toHaveLength(1);
  });

  it("sem quadro: o form de criar com meta opcional e o botão sempre habilitado", () => {
    const h = String(semQuadro(MAL, QUARTA));
    expect(h).toContain('data-form="criar-quadro"');
    expect(h).toContain('id="qd-criar-prazo"');
    expect(h).toMatch(/<button type="submit" class="qd-bt qd-bt-pri">Criar quadro<\/button>/);
    expect(h).not.toMatch(/required|disabled/);
    expect(h).not.toContain("<img");
  });
});

describe("NOD-416 (ADR-144): criar, Status e Responsável na tela, histórico e mudar de quadro", () => {
  const h = (extra: Partial<EntradaHistoricoDto>): EntradaHistoricoDto => ({ id: "h1", autorAgenteId: null, campo: "status", de: "backlog", para: "afazer", deNome: "Backlog", paraNome: "A fazer", autor: "pessoa", autorNome: null, criadoEm: Date.UTC(2026, 10, 2, 17, 32), ...extra });

  it("o card mostra o código do quadro, o título e o responsável", () => {
    const c = cardDaTarefa(t("1", { codigo: "ADA-3", linearId: "NOD-9" }), agente);
    expect(c.codigo).toBe("ADA-3");
    expect(c.titulo).toBe("Tarefa 1");
    expect(c.responsavel?.nome).toBe("Ada");
  });

  it("o histórico diz quem (Você, o bot, Regra), o que mudou e a hora", () => {
    // A hora em São Paulo; a data só quando não é hoje.
    const em = Date.UTC(2026, 10, 2, 17, 32);
    expect(linhaDoHistorico(h({}), em + 60_000)).toEqual({ quem: "Você", oque: "Status: Backlog → A fazer", quando: "14:32" });
    expect(linhaDoHistorico(h({}), em + 86_400_000).quando).toMatch(/^2 de nov, 14:32$/);
    expect(linhaDoHistorico(h({ autor: "regra", deNome: "A fazer", paraNome: "Fazendo" })).quem).toBe("Regra");
    expect(linhaDoHistorico(h({ autor: "agente", autorNome: "Caio", campo: "agente", de: null, deNome: null, para: "a", paraNome: "Ada" }))).toMatchObject({ quem: "Caio", oque: "Responsável: Ada" });
    expect(linhaDoHistorico(h({ campo: "agente", de: "a", deNome: "Ada", para: null, paraNome: null })).oque).toBe("tirou o responsável (Ada)");
    expect(linhaDoHistorico(h({ campo: "criada", de: null, deNome: null, para: "backlog", paraNome: "Backlog" })).oque).toBe("criou em Backlog");
    // Revisão 5 do PR #623: o Desfazer que devolve a tarefa excluída.
    expect(linhaDoHistorico(h({ campo: "restaurada", de: null, deNome: null, para: "backlog", paraNome: "Backlog" })).oque).toBe("restaurou em Backlog");
    expect(linhaDoHistorico(h({ campo: "quadro", deNome: "Ada", paraNome: "Caio" })).oque).toBe("mudou de quadro: Ada → Caio");
    expect(linhaDoHistorico(h({ autor: "agente", autorNome: null })).quem).toBe("Um bot");
  });

  it("o Status agrupa as colunas por grupo, na ordem do quadro; o Mover para tira o quadro da tarefa", () => {
    const g = opcoesDeStatus(colunasDto(COLUNAS_PADRAO));
    expect(g.map((x) => x.grupo)).toEqual(["Não iniciado", "Andamento", "Feito", "Fechado"]);
    expect(g[0]?.colunas.map((c) => c.id)).toContain("backlog");
    expect(destinosDaTarefa([{ id: "q1", agenteId: "a", agenteNome: "Ada", prefixo: "ADA" }, { id: "q2", agenteId: "c", agenteNome: "Caio", prefixo: "CA" }, { id: "q3", agenteId: "b", agenteNome: "Bia", prefixo: null }], "q1"))
      .toEqual([{ id: "q3", nome: "Bia" }, { id: "q2", nome: "Caio (CA)" }]);
  });

  it("a tarefa aberta: o código no cabeçalho, Status e Responsável como campos, o branch, o Mover para e o histórico", () => {
    const tm = t("1", { codigo: "ADA-3", branch: "ada-3-secao-de-planos", titulo: "Seção de planos", status: "backlog" });
    const html = String(tarefaAberta({
      t: tm, q: q([tm]), agente,
      responsaveis: [{ id: "a", nome: "Ada" }, { id: "c", nome: "Caio" }],
      destinos: [{ id: "q2", nome: "Caio (CA)" }],
      historico: [h({ campo: "criada", de: null, deNome: null, para: "backlog", paraNome: "Backlog" })],
    }));
    expect(html).toContain(`<span class="qd-id">ADA-3</span>`);
    expect(html).toMatch(/<select id="qd-t-status"[^>]*data-campo="status" data-id="1">/);
    expect(html).toContain(`<option value="backlog" selected>Backlog</option>`);
    expect(html).toMatch(/<select id="qd-t-resp"[^>]*data-campo="agente"/);
    expect(html).toContain(`<option value="a" selected>Ada</option>`);
    expect(html).toContain(`<option value="">Ninguém</option>`);
    expect(html).toMatch(/data-campo="mover"[\s\S]*<option value="q2" title="Caio \(CA\)">Caio \(CA\)<\/option>/);
    expect(html).toContain(`<code class="qd-branch">ada-3-secao-de-planos</code>`);
    expect(html).toContain("Histórico");
    expect(html).toContain("criou em Backlog");
    // Sem a lista de bots, o Responsável é só leitura; sem outro quadro, sem o Mover para; carregando, o histórico diz.
    const so = String(tarefaAberta({ t: tm, q: q([tm]), agente, historico: null }));
    expect(so).not.toContain(`data-campo="agente"`);
    expect(so).not.toContain(`data-campo="mover"`);
    expect(so).toContain("Carregando…");
    expect(String(tarefaAberta({ t: tm, q: q([tm]), agente, historico: [] }))).toContain("Sem histórico antes desta versão");
  });

  it("revisão do PR #623: Status sem \"Precisa de você\" (ADR-162: não é coluna) e Mover só com o botão; Responsável sem o Nod", () => {
    const tm = t("1", { status: "backlog" });
    const html = String(tarefaAberta({ t: tm, q: q([tm]), agente, responsaveis: [{ id: "a", nome: "Ada" }], destinos: [{ id: "q2", nome: "Caio (CA)" }], historico: [] }));
    expect(html).not.toContain(`<option value="voce"`);
    // A tarefa que espera a pessoa mostra a coluna em que está (ADR-162), sem opção "voce".
    const nv = t("2", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Qual?" });
    const aberta = String(tarefaAberta({ t: nv, q: q([nv]), agente, historico: [] }));
    expect(aberta).toContain(`<option value="fazendo" selected>`);
    expect(aberta).not.toContain(`<option value="voce"`);
    // "Mover para": escolher não move; o botão Mover confirma (WCAG 3.2.2), desligado até haver escolha.
    expect(html).toMatch(/<button type="button" class="[^"]*" data-act="mover-quadro" data-id="1" disabled>Mover<\/button>/);
    // QA do PR #623: o nome do quadro pode não caber no select; a opção e o select levam o title.
    expect(html).toContain(`<option value="q2" title="Caio (CA)">Caio (CA)</option>`);
    expect(html).toMatch(/<select id="qd-t-mover"[^>]* title="Outro quadro…">/);
    // A escolha sobrevive a um redesenho (o histórico ou os comentários chegam depois): o destino e o botão ficam.
    const escolhido = String(tarefaAberta({ t: tm, q: q([tm]), agente, destinos: [{ id: "q2", nome: "Caio (CA)" }], moverPara: "q2", historico: [] }));
    expect(escolhido).toContain(`<option value="q2" selected title="Caio (CA)">`);
    expect(escolhido).toMatch(/data-act="mover-quadro" data-id="1">Mover<\/button>/);
    expect(responsaveisDaTarefa([
      { id: "a", nome: "Ada", papel: "geral", ownerId: "p", excluidoEm: null, oculto: false },
      { id: "n", nome: "Nod", papel: "nod", ownerId: "p", excluidoEm: null, oculto: false },
      { id: "x", nome: "Xis", papel: "geral", ownerId: "p", excluidoEm: 5, oculto: false },
      { id: "o", nome: "Oculto", papel: "geral", ownerId: "p", excluidoEm: null, oculto: true },
      { id: "z", nome: "Zé", papel: "geral", ownerId: "outra", excluidoEm: null, oculto: false },
    ], "p")).toEqual([{ id: "a", nome: "Ada" }]);
  });

  it("revisão 2 do PR #623: o label do Responsável só aponta para o select; a tarefa que espera a pessoa segue com o bot (ADR-162)", () => {
    const tm = t("1", { status: "backlog", agenteId: "a" });
    // Sem a lista, o Responsável é texto: nada de label for= apontando para um <span>.
    const so = String(tarefaAberta({ t: tm, q: q([tm]), agente, historico: [] }));
    expect(so).not.toContain(`for="qd-t-resp"`);
    expect(so).toContain(`<dt>Responsável</dt>`);
    expect(String(tarefaAberta({ t: tm, q: q([tm]), agente, responsaveis: [{ id: "a", nome: "Ada" }], historico: [] }))).toContain(`<label for="qd-t-resp">Responsável</label>`);
    // ADR-162: sem "Você" no select; o bot segue marcado, e a folha diz "<bot> te perguntou".
    const nv = t("2", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, agenteId: "a", pergunta: "Qual?" });
    const html = String(tarefaAberta({ t: nv, q: q([nv]), agente, responsaveis: [{ id: "a", nome: "Ada" }], historico: [] }));
    const sel = html.match(/<select id="qd-t-resp"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(sel).not.toContain(">Você<");
    expect(sel).toContain(`<option value="a" selected>Ada</option>`);
    expect(html).toContain("te perguntou</h2>");
    expect(sel.match(/ selected/g)).toHaveLength(1);
  });

  it("o histórico e as opções escapam o texto hostil", () => {
    const tm = t("1", { titulo: MAL });
    const html = String(tarefaAberta({ t: tm, q: q([tm]), agente, responsaveis: [{ id: MAL, nome: MAL }], destinos: [{ id: MAL, nome: MAL }], historico: [h({ autor: "agente", autorNome: MAL, deNome: MAL, paraNome: MAL })] }));
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/onerror="/);
  });

  it("NOD-460: o \"+\" mora em cada coluna aberta e abre o campo no topo dela (a barra não tem mais Nova tarefa…)", () => {
    expect(String(formNovaTarefa({ id: "afazer", nome: "A fazer" }))).toContain(`data-form="nova-tarefa" data-status="afazer"`);
    const base = { q: q([]), nome: "Ada", agente, filtro: "todos" as const, alternadas: new Set<string>(), acesas: new Set<string>() };
    expect(String(quadroDaMeta(base))).not.toContain(`data-form="nova-tarefa"`);
    expect(String(quadroDaMeta(base))).not.toContain(`data-act="col-nova-tarefa"`);
    const com = String(quadroDaMeta({ ...base, podeCriar: true }));
    expect(com).toContain(`data-act="col-nova-tarefa" data-status="afazer"`);
    const aberto = String(quadroDaMeta({ ...base, podeCriar: true, nova: { coluna: "afazer" } }));
    expect(aberto.match(/data-form="nova-tarefa"/g)).toHaveLength(1);
    expect(aberto).toContain(`id="qd-nova-grade-afazer"`);
    expect(String(quadroDaMeta({ ...base, podeCriar: true, nova: { coluna: "afazer", estreito: true, erro: true } }))).toContain(`id="qd-nova-lista-afazer"`);
    expect(String(quadroDaMeta({ ...base, podeCriar: true, nova: { coluna: "afazer", erro: true } }))).toContain("Não deu para criar. Enter tenta de novo.");
  });
});

describe("NOD-460: a barra do quadro em tela cheia", () => {
  const base = { nome: "Ada", agente, alternadas: new Set<string>(), acesas: new Set<string>() };
  const ts = [t("1", { titulo: "Login no Safari", status: "fazendo", voltarPara: "fazendo", esperaPessoa: true }), t("2", { titulo: "Ação de onboarding", agenteId: "b", agenteNome: "Bia", execucao: "rodando", status: "fazendo", naColunaDesde: 1, trabalhandoDesde: 1 }), t("3", { titulo: "Outra" })];

  it("os chips (Todas, Comigo com a contagem, um por agente) e o Comigo fica à vista com 0 quando ninguém espera você", () => {
    const html = String(quadroDaMeta({ ...base, q: q(ts), filtro: "todos" }));
    expect(html).toContain(`data-filtro="todos" aria-pressed="true"`);
    expect(html).toContain(`data-filtro="comigo"`);
    expect(html).toContain(`data-filtro="agente:a"`);
    expect(html).toContain(`data-filtro="agente:b"`);
    expect(html).toContain(`data-filtro="trabalhando"`);
    expect(String(quadroDaMeta({ ...base, q: q([t("3")]), filtro: "todos" }))).toContain(`aria-label="Comigo, 0"`);
  });

  it("o filtro e a busca escondem os cards de fora e marcam o trecho achado", () => {
    const html = String(quadroDaMeta({ ...base, q: q(ts), filtro: "todos", busca: "acao" }));
    expect(html).toContain(`<mark class="qd-mark">Ação</mark> de onboarding`);
    expect(html).not.toContain("Login no Safari");
    expect(html).toContain(`value="acao"`);
    const so = String(quadroDaMeta({ ...base, q: q(ts), filtro: "agente:b" }));
    expect(so).not.toContain("Login no Safari");
    expect(so).toContain("Ação de onboarding");
  });

  it("sem resultado: uma linha inline (anunciada pela região viva, sem role próprio) com Limpar busca e Ver em todas, sem modal", () => {
    const html = String(quadroDaMeta({ ...base, q: q(ts), filtro: "agente:b", busca: "zzz" }));
    expect(html).toContain(`class="qd-vazio-1"`);
    expect(html).not.toMatch(/class="qd-vazio-1"[^>]*role=/);
    expect(html).toContain("Nada com “zzz” nas tarefas de Bia.");
    expect(html).toContain(`data-act="busca-limpar"`);
    expect(html).toContain(`data-act="filtro-do-quadro" data-filtro="todos">Ver em todas`);
    expect(html).not.toMatch(/role="dialog"|aria-modal/);
    expect(String(quadroDaMeta({ ...base, q: q(ts), filtro: "todos" }))).not.toContain("qd-vazio-1");
  });

  it("QA do PR #645: título, código e termo hostis saem escapados no card, na marca e na linha do vazio", () => {
    const mal = [t("7", { titulo: "Antes <img src=x onerror=alert(1)> depois", codigo: "<s>ZE-7</s>" })];
    const html = String(quadroDaMeta({ ...base, q: q(mal), filtro: "todos", busca: "depois" }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<s>ZE-7");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;s&gt;ZE-7&lt;/s&gt;");
    const codigo = String(quadroDaMeta({ ...base, q: q(mal), filtro: "todos", busca: "ze-7" }));
    expect(codigo).not.toContain("<s>");
    const vazio = String(quadroDaMeta({ ...base, q: q(mal), filtro: "todos", busca: "<b>nada" }));
    expect(vazio).toContain("Nada com “&lt;b&gt;nada” no quadro.");
    expect(vazio).not.toContain("<b>nada");
  });

  it("revisão 2 do PR #645: a busca que só acha numa coluna recolhida diz onde está e oferece abrir (não deixa a grade em branco)", () => {
    const comFeita = [...ts, t("9", { titulo: "Zebra feita", status: "feito" })];
    // A pessoa recolheu o Feito (com tarefa, ele nasce aberto).
    const rec = new Set(["feito"]);
    const html = String(quadroDaMeta({ ...base, q: q(comFeita), filtro: "todos", busca: "zebra", alternadas: rec }));
    expect(html).toContain("Nada nas colunas abertas; 1 tarefa em Feito.");
    expect(html).toContain(`data-act="abrir-coluna" data-status="feito">Abrir Feito</button>`);
    // Sem as recolhidas à vista (Exibir), o mesmo.
    expect(String(quadroDaMeta({ ...base, q: q(comFeita), filtro: "todos", busca: "zebra", alternadas: rec, exibir: { recolhidas: false, compacto: false } }))).toContain("1 tarefa em Feito.");
    // Aberta a coluna, a tarefa aparece e a linha some.
    expect(String(quadroDaMeta({ ...base, q: q(comFeita), filtro: "todos", busca: "zebra" }))).not.toContain("qd-vazio-1");
  });

  it("o card rodando diz \"Trabalhando · há N min\"; Exibir compacto e sem recolhidas mudam a grade", () => {
    const html = String(quadroDaMeta({ ...base, q: q(ts), filtro: "todos", agora: 1 + 5 * 60_000 }));
    expect(html).toContain("Trabalhando · há 5 min");
    // Revisão 2 do PR #645: conta do começo do trabalho, não de quando a tarefa entrou na coluna.
    const velha = ts.map((x) => (x.id === "2" ? { ...x, naColunaDesde: 1, trabalhandoDesde: 1 + 3 * 60_000 } : x));
    expect(String(quadroDaMeta({ ...base, q: q(velha), filtro: "todos", agora: 1 + 5 * 60_000 }))).toContain("Trabalhando · há 2 min");
    const semInicio = ts.map((x) => (x.id === "2" ? { ...x, trabalhandoDesde: null } : x));
    const so = String(quadroDaMeta({ ...base, q: q(semInicio), filtro: "todos", agora: 1 + 5 * 60_000 }));
    expect(so).toContain("Trabalhando");
    expect(so).not.toContain("Trabalhando · há");
    const ajust = String(quadroDaMeta({ ...base, q: q(ts), filtro: "todos", exibir: { recolhidas: false, compacto: true } }));
    expect(ajust).toContain("qd-compacto");
    expect(ajust).toContain("qd-ponto");
    expect(ajust).not.toContain(`data-status="feito"`);
    const menu = String(quadroDaMeta({ ...base, q: q(ts), filtro: "todos", exibir: { recolhidas: true, compacto: false, aberto: true } }));
    expect(menu).toContain(`id="qd-menu-exibir"`);
    expect(menu).toContain(`data-chave="compacto" aria-checked="false"`);
  });

  it("o texto hostil no título e na busca não vira tag", () => {
    const html = String(quadroDaMeta({ ...base, q: q([t("9", { titulo: MAL })]), filtro: "todos", busca: MAL }));
    expect(html).not.toContain("<img");
  });
});

describe("NOD-443: o quadro com várias pessoas na tela", () => {
  const ANA = { pessoaId: "ana", nome: "Ana", adicionadoEm: 1 };
  const pend = (voce: boolean, saiu: string | null = null) => t("p", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Qual plano?", decide: { pessoaId: voce ? "eu" : "ana", nome: voce ? "Dora" : "Ana", voce, saiu } });
  const hora = () => "10:00";

  it("D6: a pendência de outra pessoa não tem o \"te perguntou\" para quem lê; o card diz quem decide", () => {
    const c = cardDaTarefa(pend(false), agente);
    expect(c.perguntou).toBeUndefined();
    expect(c.espera).toEqual({ texto: "Esperando Ana responder", voce: false });
    expect(c.tags ?? []).not.toContain("Esperando Ana");
    expect(esperandoOutro(pend(false))).toBe("Ana");
    // Quem decide vê o "te perguntou"; o quadro de uma pessoa só (sem decide) também.
    expect(cardDaTarefa(pend(true), agente).perguntou).toBe("Qual plano?");
    expect(cardDaTarefa(t("x", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "?" }), agente).perguntou).toBe("?");
  });

  it("D5: só quem decide tem o campo de resposta; a pendência que voltou diz de quem era", () => {
    const fora = String(tarefaAberta({ t: pend(false), q: q([pend(false)], { membros: [ANA] }), agente }));
    expect(fora).toContain("Esperando Ana");
    expect(fora).not.toContain('data-form="responder-tarefa"');
    const minha = String(tarefaAberta({ t: pend(true, "Bruno"), q: q([pend(true, "Bruno")]), agente }));
    expect(minha).toContain('data-form="responder-tarefa"');
    expect(minha).toContain("Era de Bruno, que saiu do quadro.");
  });

  it("D7: os comentários da tarefa aparecem nela, com a assinatura (escapados)", () => {
    const tt = t("c");
    const h = String(tarefaAberta({ t: tt, q: q([tt], { comentarios: [{ id: "k", tarefaId: "c", texto: MAL, assinatura: "Ana, pela Lia", deFora: true, criadoEm: 1 }, { id: "k2", tarefaId: "outra", texto: "não", assinatura: "Bruno", deFora: false, criadoEm: 1 }] }), agente }));
    expect(h).toContain("Ana, pela Lia");
    expect(h).not.toContain("<img");
    expect(h).not.toContain(">não<");
  });

  it("D3: a primeira pessoa traz a escolha do modo, com cada um na sua conversa já marcado; sem botão cheio", () => {
    const h = String(pessoasDoQuadro(q([]), { painel: "pessoas", mural: null, hora }));
    expect(h).toContain('data-form="adicionar-pessoa"');
    expect(h).toMatch(/value="individual" checked/);
    expect(h).not.toContain("qd-bt-pri");
    const com = String(pessoasDoQuadro(q([], { membros: [ANA], dona: { pessoaId: "eu", nome: "Dora" }, voce: { pessoaId: "eu", papel: "dona", podeDesfazer: true } }), { painel: "pessoas", mural: null, hora }));
    expect(com).toContain("Pessoas · 1");
    expect(com).toContain('data-act="tirar-pessoa" data-id="ana"');
    expect(com).not.toContain('name="modo"');
    expect(com).toContain('data-campo="modo-conversa"');
    // Quem participa vê a lista, sem tirar, sem adicionar e sem o modo.
    const membro = String(pessoasDoQuadro(q([], { membros: [ANA], dona: { pessoaId: "eu", nome: "Dora" }, voce: { pessoaId: "ana", papel: "membro", podeDesfazer: false } }), { painel: "pessoas", mural: null, hora }));
    expect(membro).not.toContain("tirar-pessoa");
    expect(membro).not.toContain("adicionar-pessoa");
  });

  it("D1, D8: o mural mostra os pedidos com a assinatura; o desfeito aparece marcado", () => {
    const h = String(pessoasDoQuadro(q([]), { painel: "atividade", hora, mural: [{ id: "l", pessoaId: "ana", assinatura: "Ana, pela Lia", resumo: "moveu a SEC-1", codigos: ["SEC-1"], mudancas: 1, criadoEm: 1, desfeito: true }] }));
    expect(h).toContain("Ana, pela Lia");
    expect(h).toContain("moveu a SEC-1 (desfeito)");
    expect(String(pessoasDoQuadro(q([]), { painel: "atividade", hora, mural: [] }))).toContain("Nada ainda.");
  });

  it("D2: o rótulo da pílula diz quem vê a conversa; ADR-162: não há coluna Precisa de alguém", () => {
    expect(rotuloDoModo(q([]))).toBeNull();
    expect(rotuloDoModo(q([], { membros: [ANA] }))).toBe("Só você vê esta conversa");
    expect(rotuloDoModo(q([], { membros: [ANA], modoConversa: "so_dono" }))).toBe("Só você conversa · quem participa comenta");
    expect(rotuloDoModo(q([], { modoConversa: "so_dono", dona: { pessoaId: "eu", nome: "Dora" }, voce: { pessoaId: "ana", papel: "membro", podeDesfazer: false } }))).toBe("Só Dora conversa · você comenta");
    const base = { nome: "Ada", agente, filtro: "todos" as const, alternadas: new Set<string>(), acesas: new Set<string>() };
    expect(String(quadroDaMeta({ ...base, q: q([], { membros: [ANA] }) }))).not.toContain("Precisa de alguém");
    expect(String(quadroDaMeta({ ...base, q: q([]) }))).not.toContain("Precisa de alguém");
  });
});

describe("ADA-16 (ADR-163): o card diz rodando, na fila há X min ou esperando", () => {
  const base = { nome: "Ada", agente, alternadas: new Set<string>(), acesas: new Set<string>() };
  const agora = 1 + 12 * 60_000;
  const html = (x: Partial<TarefaDto>) => String(quadroDaMeta({ ...base, q: q([t("2", { titulo: "Tela", agenteId: "b", agenteNome: "Bia", status: "fazendo", ...x })]), filtro: "todos", agora }));

  it("na fila com motivo real: \"na fila há 12 min\" e diz qual (a mesma tarefa em série ou o portão da máquina)", () => {
    expect(html({ execucao: "fila", naFilaDesde: 1, motivoFila: "mesma_tarefa" })).toContain("na fila há 12 min · termina a etapa anterior desta tarefa");
    expect(html({ execucao: "fila", naFilaDesde: 1, motivoFila: "memoria" })).toContain("na fila há 12 min · a máquina está sem memória livre");
    expect(html({ execucao: "fila", naFilaDesde: 1, motivoFila: "processador" })).toContain("o processador da máquina está ocupado");
    expect(html({ execucao: "fila", naFilaDesde: 1, motivoFila: "disco" })).toContain("o disco da máquina está cheio");
  });

  // Regression: pedido do Marlon (2026-11-10, "não quero limites"): sem teto próprio, o card não fala de vaga nem de limite.
  it("na fila sem motivo: só \"na fila\", sem a hora e sem falar de vaga ou limite", () => {
    const h = html({ execucao: "fila", naFilaDesde: 1, motivoFila: null });
    expect(h).toContain("na fila");
    expect(h).not.toContain("na fila há");
    expect(h).not.toMatch(/limite|vaga/);
  });

  it("2026-11-10: na fila há menos de um minuto, ou sem a hora (o card otimista do mover): \"começando\"", () => {
    const novo = html({ execucao: "fila", naFilaDesde: agora - 30_000, motivoFila: "mesma_tarefa" });
    expect(novo).not.toContain("na fila há");
    expect(novo).toContain("começando");
    const sem = html({ execucao: "fila", naFilaDesde: null, motivoFila: "memoria" });
    expect(sem).toContain("começando");
    expect(sem).not.toContain("na fila há");
  });

  it("esperando: o selo de pausa e a frase de quem espera a CI; nunca \"Trabalhando\"", () => {
    const h = html({ execucao: "esperando", agenteId: "a", agenteNome: "Ada" });
    expect(h).toContain("qd-e-esperando");
    expect(h).toContain("esperando a CI, um colega ou um comando");
    expect(h).toContain("qd-av-esperando");
    expect(h).not.toContain("Trabalhando");
  });

  it("o \"na fila há\" não vaza para o card rodando", () => {
    const h = html({ execucao: "rodando", trabalhandoDesde: 1, naFilaDesde: 1, motivoFila: "mesma_tarefa" });
    expect(h).toContain("Trabalhando · há 12 min");
    expect(h).not.toContain("na fila");
  });
});

describe("ADA-232: o card numa linha", () => {
  const MAL = `<img src=x onerror="alert(1)">`;
  const volta = { motivo: MAL, em: null, quando: "ci" as const, prUrl: null };
  it("esperando mostra o motivo (escapado) e vence o selo Trabalhando", () => {
    const c = cardDaTarefa(t("1", { status: "fazendo", execucao: "rodando", estadoLinha: { tipo: "esperando", motivo: MAL, volta } }), agente);
    expect(c.esperando).toEqual({ motivo: MAL });
    // 2026-11-10: a volta pela CI vira o chip com sino "Esperando a CI" (wait.pr_checks do Multica).
    expect(c.espera).toEqual({ texto: "Esperando a CI", voce: false });
    const h = String(card(c));
    expect(h).toContain(`<span class="qd-espera" title="Esperando a CI">`);
    expect(h).not.toContain(MAL);
    expect(h).not.toContain("qd-selo");
  });
  it("a frente aberta conta como trabalhando, sem execução própria", () => {
    const c = cardDaTarefa(t("2", { status: "fazendo", estadoLinha: { tipo: "trabalhando", frente: true } }), agente);
    expect(c.estado).toBe("rodando");
    expect(String(card(c))).toContain("qd-selo");
  });
  it("sem estadoLinha, nada muda", () => {
    expect(cardDaTarefa(t("3", { status: "fazendo" }), agente).estado).toBeUndefined();
  });
});
