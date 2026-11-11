import { describe, expect, it } from "vitest";
import type { ComentarioDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { RunDaTarefa } from "../../../src/contracts/quadro-comentarios.ts";
import { chipTrabalhando, dialogoDosRuns, entregas, registroDeExecucao } from "../../../web/telas/lado-da-tarefa.ts";
import { chipsDoCampo, comentarioDaPergunta, comMencoes, duracao, entregasDe, gasto, linhaDoTempo, redigir, tempoRelativo, trecho, type DadosDaLinha } from "../../../web/telas/linha-do-tempo.ts";
import { confiar } from "../../../web/telas/quadro.ts";

/** 2026-11-10: a tarefa aberta como a issue do Multica (linha do tempo, chips, lateral). Todo texto de fora é escapado. */
const agora = Date.parse("2026-11-10T12:00:00Z");
const min = 60_000;
const MAL = `<img src=x onerror="alert(1)">`;
const agente = (id: string) => (id === "dev" ? { avatar: confiar('<span class="av">D</span>'), nome: "Dev 1" } : id === "gil" ? { avatar: confiar('<span class="av">G</span>'), nome: "Gil" } : null);
const t = { id: "t1", quadroId: "q", titulo: "T", descricao: "", status: "fazendo", agenteId: "dev", movimentos: [], linhas: [] } as unknown as TarefaDto;
const com = (id: string, o: Partial<ComentarioDto> = {}): ComentarioDto => ({ id, quadroId: "q", tarefaId: "t1", autor: { tipo: "pessoa" }, texto: `texto ${id}`, deFora: false, criadoEm: agora - 30 * min, autorNome: null, acionados: [], paiId: null, ...o });
const run = (turnoId: string, o: Partial<RunDaTarefa> = {}): RunDaTarefa => ({ turnoId, agenteId: "dev", agenteNome: "Dev 1", comentarioId: null, execucao: null, estado: "concluido", turnoAtual: turnoId, criadoEm: agora - 20 * min, comecouEm: agora - 19 * min, terminouEm: agora - 10 * min, custoUsd: null, tokens: null, ultimaFrase: null, motivo: null, ...o });
const dados = (o: Partial<DadosDaLinha>): DadosDaLinha => ({ t, colunas: [{ id: "fazendo", nome: "Fazendo", grupo: "iniciado" } as never], comentarios: [], runs: [], agente, agora, nomes: ["Dev 1", "Gil"], respondendo: null, editando: null, abertos: new Set(), passos: () => null, chips: () => "", pendente: null, criadaPor: null, criadaEm: null, carga: "ok", ...o });

describe("linha do tempo", () => {
  it("a resposta fica dentro da thread da raiz, e o run concluído que respondeu compacta no cabeçalho dela", () => {
    const h = linhaDoTempo(dados({
      comentarios: [com("c1", { texto: "@Gil olha" }), com("c2", { autor: { tipo: "agente", agenteId: "gil" }, autorNome: "Gil", paiId: "c1", criadoEm: agora - 15 * min })],
      runs: [run("r1", { agenteId: "gil", agenteNome: "Gil", comentarioId: "c1", criadoEm: agora - 29 * min, terminouEm: agora - 16 * min })],
    }));
    const th = h.slice(h.indexOf('class="ta-th"'));
    expect(th.indexOf('id="com-c2"')).toBeGreaterThan(th.indexOf('class="ta-resps"'));
    expect(h).toContain("trabalhou 3 min");
    expect(h).not.toContain('class="ta-run"');
    expect(h).toContain('<span class="ta-men">@Gil</span>');
  });

  it("o run vivo é um bloco na thread que o acionou, com o último passo trocável ao vivo; a falha leva o motivo no title", () => {
    const h = linhaDoTempo(dados({
      comentarios: [com("c1")],
      runs: [run("r1", { comentarioId: "c1", estado: "rodando", terminouEm: null, turnoAtual: "tr1" }), run("r2", { comentarioId: "c1", estado: "falhou", motivo: `caiu ${MAL}`, criadoEm: agora - 25 * min })],
      passos: (turno) => (turno === "r1" ? { ultimo: "Lendo o arquivo", n: 3, lista: [], carregado: true } : null),
    }));
    expect(h).toContain('data-run-vivo="tr1">Lendo o arquivo</p>');
    expect(h).toContain("› 3 passos");
    expect(h).toContain('title="caiu &lt;img src=x onerror=&quot;alert(1)&quot;&gt;"');
    expect(h).not.toContain("<img src=x");
  });

  it("os movimentos entram como eventos discretos; o campo do fim e o da thread aberta", () => {
    const tt = { ...t, movimentos: [{ id: "m1", tarefaId: "t1", tipo: "mover", de: "afazer", para: "fazendo", agenteAntes: "dev", agenteDepois: "dev", autor: { tipo: "agente", agenteId: "dev" }, motivo: null, loteId: "l", acionou: false, desfeitoEm: null, criadoEm: agora - 50 * min, autorNome: "Dev 1", agenteAntesNome: "Dev 1", agenteDepoisNome: "Dev 1" }] } as unknown as TarefaDto;
    const h = linhaDoTempo(dados({ t: tt, colunas: [{ id: "afazer", nome: "A fazer" }, { id: "fazendo", nome: "Fazendo" }] as never, comentarios: [com("c1")], respondendo: "c1" }));
    expect(h).toContain("<b>Dev 1</b> moveu de A fazer para Fazendo");
    expect(h).toContain('data-form="comentar-tarefa" data-id="t1" data-responder="c1"');
    expect(h).toContain('id="qd-com-t1"');
  });

  it("o apagado com resposta fica como marcador; o próprio tem Editar e Apagar, o do bot não", () => {
    const h = linhaDoTempo(dados({ comentarios: [com("c1", { apagado: true, texto: "" }), com("c2", { paiId: "c1" }), com("c3", { autor: { tipo: "agente", agenteId: "dev" }, autorNome: "Dev 1" })] }));
    expect(h).toContain("Comentário apagado");
    expect(h.match(/data-act="com-editar"/g)).toHaveLength(1);
  });
});

describe("chips do campo", () => {
  it("avatar + nome + modo, o menu com as escolhas, o aviso com o motivo e nada escapado errado", () => {
    const previa = { chips: [
      { agenteId: "dev", nome: "Dev 1", porque: "responsavel" as const, estado: "rodando" as const, opcoes: ["agora", "depois", "no_lugar", "nao"] as never, padrao: "agora" as const, aviso: null },
      { agenteId: "x", nome: MAL, porque: "mencao" as const, estado: "parado" as const, opcoes: [], padrao: "nao" as const, aviso: "sem conversa própria: não roda" },
    ], pessoas: [], todos: false, nada: null };
    const h = chipsDoCampo({ chave: "nova", previa, escolhas: { dev: "no_lugar" }, aberto: "dev", agente });
    expect(h).toContain('data-modo="no_lugar" data-act="chip-menu"');
    expect(h).toContain("no lugar do atual");
    expect(h).toContain('role="menuitemradio" aria-checked="true" class="ta-chip-op" data-act="chip-modo" data-chave="nova" data-agente="dev" data-modo="no_lugar"');
    expect(h).toContain("sem conversa própria: não roda");
    expect(h).not.toContain("<img src=x");
  });
});

describe("lateral e formatos", () => {
  it("o chip do topo junta quem roda; o Registro diz quando não há custo; Runs no tempo tem uma barra por run", () => {
    const runs = [run("r1", { estado: "rodando", terminouEm: null }), run("r2", { agenteId: "gil", agenteNome: "Gil", estado: "rodando", terminouEm: null })];
    expect(chipTrabalhando(runs, agente)).toContain("2 agentes trabalhando");
    expect(chipTrabalhando([run("r3")], agente)).toBe("");
    expect(registroDeExecucao({ runs: [run("r3")], agente, agora, aberto: true })).toContain("Sem custo registrado");
    expect(registroDeExecucao({ runs: [run("r3", { custoUsd: 0.5, tokens: 12000 })], agente, agora, aberto: true })).toContain("concluído · 9 min · US$ 0,50 · 12 mil tokens");
    expect(dialogoDosRuns({ runs, agente, agora }).match(/class="ta-bar"/g)).toHaveLength(2);
  });

  it("Entregas: os links https dos comentários do agente, o mais novo primeiro, sem repetir; o da pessoa não conta", () => {
    const cs = [
      com("c1", { autor: { tipo: "agente", agenteId: "dev" }, autorNome: "Dev 1", texto: "PR https://github.com/gamefik/nod/pull/7." }),
      com("c2", { texto: "https://exemplo.com/da-pessoa" }),
      com("c3", { autor: { tipo: "agente", agenteId: "gil" }, autorNome: "Gil", texto: "arquivo https://x.com/a/relatorio.pdf e de novo https://github.com/gamefik/nod/pull/7", criadoEm: agora }),
    ];
    expect(entregasDe(cs).map((e) => e.rotulo)).toEqual(["relatorio.pdf", "gamefik/nod #7"]);
    expect(entregas({ comentarios: cs, todas: false, aberto: true })).toContain('href="https://x.com/a/relatorio.pdf"');
  });

  it("redige segredo antes de cortar; tempos e gastos legíveis", () => {
    expect(redigir("token: ghp_abcdefghijklmnopqrstuvwxyz0123")).not.toContain("ghp_");
    expect(trecho("Authorization Bearer abcdefghijklmnopqrstuvwxyz", 20)).not.toContain("abcdefghijklmnop");
    expect(duracao(45_000)).toBe("45 s");
    expect(duracao(65 * min)).toBe("1 h 5 min");
    expect(tempoRelativo(agora - 3 * min, agora)).toBe("há 3 min");
    expect(gasto({ custoUsd: null, tokens: null })).toBe("");
    expect(comMencoes("oi @gil e @Gilberto", ["Gil"])).toBe('oi <span class="ta-men">@gil</span> e @Gilberto');
  });
});

describe("a pergunta do bot como comentário (2026-11-10, pedido do Marlon)", () => {
  const espera = { ...t, esperaPessoa: true, pergunta: "Azul ou verde?" } as TarefaDto;
  const cs = [com("c0", { autor: { tipo: "agente", agenteId: "dev" }, autorNome: "Dev 1", texto: "Comecei" }), com("c1", { autor: { tipo: "agente", agenteId: "dev" }, autorNome: "Dev 1", texto: "@Marlon Azul ou verde?", criadoEm: agora - 5 * min })];
  it("acha o comentário da pergunta; sem espera, nenhum", () => {
    expect(comentarioDaPergunta(espera, cs)).toBe("c1");
    expect(comentarioDaPergunta({ ...espera, esperaPessoa: false }, cs)).toBeNull();
  });
  it("o cabeçalho diz aguardando sua resposta e o reply vem aberto embaixo dele, até a pessoa fechar", () => {
    const h = linhaDoTempo(dados({ t: espera, comentarios: cs }));
    expect(h).toContain('<li class="ta-th ta-th-pergunta">');
    expect(h).toContain("aguardando sua resposta");
    expect(h).toContain('data-responder="c1"');
    expect(linhaDoTempo(dados({ t: espera, comentarios: cs, fechouPergunta: true }))).not.toContain('data-responder="c1"');
  });
});
