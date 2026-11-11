import { describe, expect, it } from "vitest";
import type { ComentarioDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { RunDaTarefa } from "../../../src/contracts/quadro-comentarios.ts";
import { fraseDaEsperaDoRun, rotuloCompletoDoRun, voltaDoRun } from "../../../web/lib/estado-do-trabalho.ts";
import { chipDaEspera, chipTrabalhando, registroDeExecucao } from "../../../web/telas/lado-da-tarefa.ts";
import { casarRuns, comentarioDaPergunta, linhaDoTempo, reciboDoComentario, type DadosDaLinha } from "../../../web/telas/linha-do-tempo.ts";
import { confiar } from "../../../web/telas/quadro.ts";
import { dialogoDaTranscricao } from "../../../web/telas/transcricao-do-run.ts";

/** 2026-11-10 (Passos 1, 3 e 4 da comparação Multica × nod): o run com o estado verdadeiro na tarefa aberta. */
const agora = new Date(2026, 10, 10, 12, 0).getTime();
const min = 60_000;
const agente = (id: string) => (id === "dev" ? { avatar: confiar('<span class="av">D</span>'), nome: "Dev 1" } : null);
const t = { id: "t1", quadroId: "q", titulo: "T", descricao: "", status: "fazendo", agenteId: "dev", movimentos: [], linhas: [] } as unknown as TarefaDto;
const com = (id: string, o: Partial<ComentarioDto> = {}): ComentarioDto => ({ id, quadroId: "q", tarefaId: "t1", autor: { tipo: "pessoa" }, texto: `texto ${id}`, deFora: false, criadoEm: agora - 30 * min, autorNome: null, acionados: [], paiId: null, ...o });
const run = (turnoId: string, o: Partial<RunDaTarefa> = {}): RunDaTarefa => ({ turnoId, agenteId: "dev", agenteNome: "Dev 1", comentarioId: null, execucao: null, estado: "concluido", turnoAtual: turnoId, criadoEm: agora - 20 * min, comecouEm: agora - 19 * min, terminouEm: agora - 10 * min, custoUsd: null, tokens: null, ultimaFrase: null, motivo: null, ...o });
const dados = (o: Partial<DadosDaLinha>): DadosDaLinha => ({ t, colunas: [], comentarios: [], runs: [], agente, agora, nomes: ["Dev 1"], respondendo: null, editando: null, abertos: new Set(), passos: () => null, chips: () => "", pendente: null, criadaPor: null, criadaEm: null, carga: "ok", ...o });

describe("os rótulos do run (uma fonte só)", () => {
  it("esperando a CI / volta às HH:MM / na fila com motivo / falhou com rótulo", () => {
    expect(fraseDaEsperaDoRun({ tipo: "ci", texto: "a CI do PR #12", em: null, prUrl: null, podeAcordar: true }, agora)).toBe("esperando a CI do PR #12");
    expect(fraseDaEsperaDoRun({ tipo: "hora", texto: "a hora marcada", em: agora + 2 * 60 * min, prUrl: null, podeAcordar: true }, agora)).toBe("volta às 14:00");
    expect(voltaDoRun({ tipo: "ci", texto: "a CI do PR #12", em: null, prUrl: null, podeAcordar: true }, agora)).toBe("Volto quando a CI do PR #12 terminar");
    expect(rotuloCompletoDoRun(run("r", { estado: "fila", motivoFila: "memoria" }), agora)).toContain("na fila");
    expect(rotuloCompletoDoRun(run("r", { estado: "fila", motivoFila: "memoria" }), agora)).toContain("sem memória livre");
    expect(rotuloCompletoDoRun(run("r", { estado: "falhou", rotuloFalha: "Limite do plano da IA" }), agora)).toBe("falhou · Limite do plano da IA");
    expect(rotuloCompletoDoRun(run("r", { estado: "rodando", esperando: true, espera: { tipo: "pessoa", texto: "sua resposta", em: null, prUrl: null, podeAcordar: false } }), agora)).toBe("esperando sua resposta");
  });
});

describe("o bloco do run", () => {
  it("esperando a CI: sobe o 'Volto quando… · Acordar agora', sem 'está trabalhando' e sem tempo correndo", () => {
    const h = linhaDoTempo(dados({ runs: [run("r1", { estado: "rodando", esperando: true, terminouEm: null, execucao: 2, espera: { tipo: "ci", texto: "a CI do PR #12", em: null, prUrl: null, podeAcordar: true } })] }));
    expect(h).toContain("esperando a CI do PR #12");
    expect(h).toContain("Volto quando a CI do PR #12 terminar");
    expect(h).toContain('data-act="run-acordar"');
    expect(h).not.toContain("está trabalhando");
    expect(h).not.toContain("data-run-desde");
    expect(h).toContain('data-act="run-repetir"');
    expect(h).toContain('data-act="run-parar"');
  });

  it("trabalhando: o tempo é um span que o tick troca; Parar pede confirmação no 2º clique", () => {
    const r = run("r1", { estado: "rodando", terminouEm: null });
    expect(linhaDoTempo(dados({ runs: [r] }))).toContain(`data-run-desde="${r.comecouEm}"`);
    expect(linhaDoTempo(dados({ runs: [r], parando: "r1" }))).toContain("Confirmar parar");
  });

  it("a falha que pede a pessoa mostra o erro inline; a transitória fica no rótulo e na linha", () => {
    const h = linhaDoTempo(dados({ runs: [run("r1", { estado: "falhou", rotuloFalha: "IA sem login na máquina", precisaDeVoce: true, motivo: "a IA do bot não está autenticada <b>" })] }));
    expect(h).toContain('class="ta-run-erro"');
    expect(h).toContain("falhou · IA sem login na máquina");
    expect(h).not.toContain("autenticada <b>");
  });

  it("'inclui N comentários' quando o run juntou vários; o gatilho aparece fora do comentário", () => {
    const h = linhaDoTempo(dados({ comentarios: [com("c1"), com("c2")], runs: [run("r1", { estado: "fila", terminouEm: null, comentarioId: "c1", comentariosJuntos: ["c1", "c2"] }), run("r2", { origem: "repetir" })] }));
    expect(h).toContain("inclui 2 comentários");
    expect(h).toContain("Repetir");
  });

  it("run concluído mantém '› N passos' pelo número do servidor, mesmo sem nada no cache", () => {
    expect(linhaDoTempo(dados({ runs: [run("r1", { nPassos: 14 })] }))).toContain("14 passos");
  });

  it("a resposta liga ao run pelo turno (0169), não pela janela de 120 s", () => {
    const r = run("r1");
    const longe = com("c9", { autor: { tipo: "agente", agenteId: "dev" }, autorNome: "Dev 1", criadoEm: agora + 60 * min, turnoId: "r1" });
    const perto = com("c8", { autor: { tipo: "agente", agenteId: "dev" }, autorNome: "Dev 1", criadoEm: r.terminouEm! + 1000, turnoId: "outro" });
    expect([...casarRuns([perto, longe], [r]).keys()]).toEqual(["c9"]);
  });

  it("a pergunta gravada como tal vence o casamento pelo texto", () => {
    const tt = { ...t, esperaPessoa: true, pergunta: "Qual branch?" } as TarefaDto;
    const cs = [com("p1", { autor: { tipo: "agente", agenteId: "dev" }, pergunta: true, texto: "@Marlon decide aí" }), com("p2", { autor: { tipo: "agente", agenteId: "dev" }, texto: "Qual branch?", criadoEm: agora })];
    expect(comentarioDaPergunta(tt, cs)).toBe("p1");
  });
});

describe("o recibo do manda agora", () => {
  it("lido, aguardando e não entrou (com Mandar como run novo)", () => {
    const r = (estado: "lido" | "aguardando" | "nao_entrou") => reciboDoComentario(com("c1", { recibo: { agenteId: "dev", agenteNome: "Dev 1", estado, entregueEm: estado === "lido" ? agora : null, turnoId: null } }));
    expect(r("lido")).toContain("entregue a Dev 1 · lido");
    expect(r("aguardando")).toContain("esperando Dev 1 ler");
    expect(r("nao_entrou")).toContain('data-act="com-reenviar"');
  });

  it("o recado lido entra dentro do run como 'Você acrescentou', no ponto em que foi lido", () => {
    const passos = () => ({ ultimo: null, n: 2, carregado: true, lista: [
      { seq: 1, tipo: "ferramenta" as const, classe: "comando" as const, ferramenta: "Bash", rotulo: "Rodando", resumo: null, acaoId: null, falhou: false, em: agora - 15 * min },
      { seq: 2, tipo: "ferramenta" as const, classe: "arquivo" as const, ferramenta: "Read", rotulo: "Lendo", resumo: null, acaoId: null, falhou: false, em: agora - 5 * min },
    ] });
    const c = com("c1", { recibo: { agenteId: "dev", agenteNome: "Dev 1", estado: "lido", entregueEm: agora - 10 * min, turnoId: "r1" }, texto: "use a main" });
    const h = linhaDoTempo(dados({ comentarios: [c], runs: [run("r1", { estado: "rodando", terminouEm: null })], abertos: new Set(["r1"]), passos }));
    expect(h.indexOf("Você acrescentou")).toBeGreaterThan(h.indexOf("Rodando"));
    expect(h.indexOf("Você acrescentou")).toBeLessThan(h.indexOf("Lendo"));
  });
});

describe("o chip do topo e o Registro", () => {
  it("trabalhando / na fila / esperando, com popover por run (ir até o run, Parar)", () => {
    expect(chipTrabalhando([run("r1", { estado: "fila", terminouEm: null })], agente)).toContain("Dev 1 está na fila");
    expect(chipTrabalhando([run("r1", { estado: "rodando", esperando: true, terminouEm: null })], agente)).toContain("Dev 1 está esperando");
    const aberto = chipTrabalhando([run("r1", { estado: "rodando", terminouEm: null })], agente, { aberto: true, agora });
    expect(aberto).toContain('data-act="run-ir"');
    expect(aberto).toContain('data-act="run-parar"');
    expect(chipTrabalhando([run("r1")], agente)).toBe("");
  });

  it("o chip de espera: você leva à pergunta; a CI leva ao run que espera", () => {
    expect(chipDaEspera({ esperaPessoa: true, decide: null, estadoLinha: null } as unknown as TarefaDto, [], agora)).toContain('data-act="ir-pergunta"');
    const ci = chipDaEspera({ esperaPessoa: false, decide: null, estadoLinha: { tipo: "esperando", motivo: null, volta: { quando: "ci", em: null, motivo: null, prUrl: null } } } as unknown as TarefaDto, [run("r1", { estado: "rodando", esperando: true })], agora);
    expect(ci).toContain("Esperando a CI");
    expect(ci).toContain('data-turno="r1"');
  });

  it("o Registro mostra o gatilho e não leva mais o bloco antigo de Execuções", () => {
    const h = registroDeExecucao({ runs: [run("r1", { origem: "comentario", comentarioId: "c1" }), run("r2", { origem: "automatica" })], agente, agora, aberto: true, comentarios: [com("c1", { texto: "corrige o teste" })] });
    expect(h).toContain("“corrige o teste”");
    expect(h).toContain("nova tentativa");
    expect(h).toContain('data-act="run-repetir"');
  });
});

describe("Ver o trabalho", () => {
  it("passos, resposta, custo, branch e busca (filtra os passos)", () => {
    const passos = { ultimo: null, n: 2, carregado: true, lista: [
      { seq: 1, tipo: "ferramenta" as const, classe: "comando" as const, ferramenta: "Bash", rotulo: "Rodando", resumo: "npm test", acaoId: null, falhou: false, em: 1 },
      { seq: 2, tipo: "ferramenta" as const, classe: "arquivo" as const, ferramenta: "Read", rotulo: "Lendo", resumo: "quadro.ts", acaoId: null, falhou: false, em: 2 },
    ] };
    const h = dialogoDaTranscricao({ run: run("r1", { custoUsd: 0.12, origem: "repetir" }), nome: "Dev 1", passos, resposta: "Feito: PR #3", branch: "nod-1-x", maquina: null, busca: "quadro", agora });
    expect(h).toContain("O trabalho de Dev 1");
    expect(h).toContain("US$ 0,12");
    expect(h).toContain("branch nod-1-x");
    expect(h).toContain("Feito: PR #3");
    expect(h).toContain("quadro.ts");
    expect(h).not.toContain("npm test");
  });
});
