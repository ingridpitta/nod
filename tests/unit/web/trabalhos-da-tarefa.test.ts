import { describe, expect, it } from "vitest";
import type { ExecucaoDto, ExecucoesDaTarefa } from "../../../src/contracts/quadro-execucoes.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { atividadeComFrame, criarTrabalhosDaTarefa, turnoEscutado, type ApiDosTrabalhos } from "../../../web/lib/trabalhos-da-tarefa.ts";
import { fraseDaVolta, logDoTrabalho, secaoDoTrabalho, type VistaDoTrabalho } from "../../../web/telas/trabalhos-da-tarefa.ts";

/** NOD-418, direção C "só o atual": o trabalho da tarefa aberta (a linha, os passos ao vivo, os anteriores, as ações). */

const MAL = `<img src=x onerror="alert(1)">`;
const hora = () => "10:00";
const exec = (p: Partial<ExecucaoDto> & Pick<ExecucaoDto, "id" | "numero" | "estado">): ExecucaoDto =>
  ({ origem: "inicio", turnoId: `t-${p.id}`, turnoAtual: `t-${p.id}`, motivo: null, criadoEm: 0, comecouEm: null, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null, ...p });
const dados = (execucoes: ExecucaoDto[], extra: Partial<ExecucoesDaTarefa> = {}): ExecucoesDaTarefa => ({ execucoes, recados: [], conversaId: "conv-beto", semAgente: false, ...extra });
const vista = (p: Partial<VistaDoTrabalho>): VistaDoTrabalho => ({
  tarefaId: "tar", dados: null, erro: false, bloqueada: false, agenteId: "beto", conversaAtual: "conv-ana", atividade: undefined,
  passosAbertos: false, anterioresAbertos: false, aviso: null, ocupado: false, ...p,
});
const secao = (p: Partial<VistaDoTrabalho>) => secaoDoTrabalho(vista(p), hora);

describe("os 5 estados", () => {
  it.each([
    ["fila", "○", "na fila"], ["rodando", "◐", "rodando"], ["concluido", "✓", "concluído"], ["falhou", "⊗", "falhou"], ["cancelado", "⊘", "cancelado"],
  ] as const)("%s: o selo e o texto", (estado, selo, nome) => {
    const h = secao({ dados: dados([exec({ id: "a", numero: 1, estado })]) });
    expect(h).toContain(`data-estado="${estado}" aria-hidden="true">${selo}</span>`);
    expect(h).toContain(`#1 · ${nome}`);
  });

  it("a nova tentativa diz qual é, e a falha mostra o motivo", () => {
    const h = secao({ dados: dados([exec({ id: "b", numero: 2, estado: "falhou", origem: "automatica", tentativa: 2, motivo: "A máquina ficou sem contato." })]) });
    expect(h).toContain("Nova tentativa 2 de 2");
    expect(h).toContain("A máquina ficou sem contato.");
  });
});

describe("o título", () => {
  it("a seção se chama Execuções (critério 1 e protótipo C; revisão 2 do PR #625)", () => {
    expect(secao({ dados: dados([]) })).toContain('<h2 class="qd-t-sec" id="qd-trab-tit">Execuções</h2>');
  });
});

describe("as ações", () => {
  const acoes = (h: string) => [...h.matchAll(/data-act="(trab-[a-z]+|qc-abrir-conversa|abrir-conversa)"/g)].map((m) => m[1]);
  it("rodando ou na fila, só Cancelar", () => {
    expect(acoes(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando" })]) }))).toEqual(["trab-cancelar"]);
    expect(acoes(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "fila" })]), bloqueada: true }))).toEqual(["trab-cancelar"]);
  });
  it("Repetir no falhou, no concluído e na tarefa Bloqueada; o cancelado sem Repetir fora da Bloqueada", () => {
    expect(acoes(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "falhou" })]) }))).toEqual(["trab-repetir"]);
    expect(acoes(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "cancelado" })]) }))).toEqual([]);
    expect(acoes(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "cancelado" })]), bloqueada: true }))).toEqual(["trab-repetir"]);
  });
  it("o concluído mostra o resumo e Ver na conversa (a do responsável; a mesma conversa só troca de modo)", () => {
    const fim = dados([exec({ id: "a", numero: 1, estado: "concluido", ultimaFrase: "Abri o PR.\nPronto: PR #12." })]);
    const h = secao({ dados: fim });
    expect(h).toContain("Pronto: PR #12.");
    expect(acoes(h)).toEqual(["abrir-conversa", "trab-repetir"]);
    expect(h).toContain('data-conversa="conv-beto" data-agente="beto"');
    expect(acoes(secao({ dados: fim, conversaAtual: "conv-beto" }))).toEqual(["qc-abrir-conversa", "trab-repetir"]);
  });
  it("sem agente responsável, sem ações nem recado; o erro de leitura tem Tentar de novo", () => {
    const h = secao({ dados: dados([], { semAgente: true }) });
    expect(h).toContain("Sem agente responsável");
    expect(h).not.toContain("recado-trabalho");
    expect(secao({ erro: true })).toContain('Não consegui ler os trabalhos · <button type="button" class="qd-link" data-act="trab-reler">Tentar de novo</button>');
  });
  it("› N anteriores recolhe os de antes; o recado tem o teto de 4000", () => {
    const d = dados([exec({ id: "c", numero: 3, estado: "rodando" }), exec({ id: "b", numero: 2, estado: "falhou" }), exec({ id: "a", numero: 1, estado: "falhou" })]);
    expect(secao({ dados: d })).toContain("› 2 anteriores");
    expect(secao({ dados: d })).not.toContain("#2 · falhou");
    expect(secao({ dados: d, anterioresAbertos: true })).toContain("#2 · falhou");
    expect(secao({ dados: d })).toContain('maxlength="4000"');
  });
});

describe("as notas do recado", () => {
  const rec = (entregue: boolean) => ({ id: "r", texto: "use a branch y", criadoEm: 0, entregue });
  it("rodando: entra no próximo passo; na fila: quando começar; lido: Leu seu recado", () => {
    expect(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando" })], { recados: [rec(false)] }) })).toContain("Seu recado “use a branch y” · entra no próximo passo");
    expect(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "fila" })], { recados: [rec(false)] }) })).toContain("Seu recado “use a branch y” · entra quando o trabalho começar");
    expect(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando" })], { recados: [rec(true)] }) })).toContain("Leu seu recado “use a branch y”");
  });

  it("revisão 5 do PR #625: sem trabalho vivo (Backlog, o Parar de fora) o recado fica guardado para o próximo Repetir/início", () => {
    for (const estado of ["concluido", "cancelado", "falhou"] as const) {
      const h = secao({ dados: dados([exec({ id: "a", numero: 1, estado })], { recados: [rec(false)] }) });
      expect(h).toContain("Seu recado “use a branch y” · fica guardado: vai no próximo trabalho (Repetir ou início)");
      expect(h).not.toContain("entra quando o trabalho começar");
    }
  });

  it("revisão 5 do PR #625: a nova tentativa agendada aparece com a hora", () => {
    const h = secao({ dados: dados([exec({ id: "a", numero: 1, estado: "falhou", novaTentativaEm: Date.UTC(2026, 10, 2, 13, 1) })]) });
    expect(h).toContain(`Nova tentativa sozinha às <time datetime="2026-11-02T13:01:00.000Z">10:00</time>`);
  });
});

describe("XSS: todo texto de fora é escapado", () => {
  it("revisão 4 do PR #625: o log não é região viva; a hora tem datetime ISO. Revisão 5: nenhuma região role=status no bloco redesenhado", () => {
    const h = secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando", criadoEm: Date.UTC(2026, 10, 2, 13, 0) })]), aviso: "Recado mandado" });
    expect(h).not.toContain("aria-live");
    expect(h).toContain(`<time class="qd-trab-hora" datetime="2026-11-02T13:00:00.000Z">10:00</time>`);
    expect(h).not.toContain(`role="status"`);
    expect(h).toContain("Recado mandado");
  });

  it("frase, motivo, recado, passo e aviso", () => {
    const a = atividadeComFrame(undefined, { tipo: "turno.atividade", dados: { rotulo: MAL, id: "c1" } });
    const d = dados([exec({ id: "b", numero: 2, estado: "rodando", ultimaFrase: MAL }), exec({ id: "a", numero: 1, estado: "falhou", motivo: MAL })],
      { recados: [{ id: "r", texto: MAL, criadoEm: 0, entregue: false }], conversaId: `"><script>` });
    const h = secao({ dados: d, atividade: a, passosAbertos: true, anterioresAbertos: true, aviso: MAL, tarefaId: `"><b>` });
    expect(h).not.toMatch(/<img|<script|<b>/);
    expect(h).toContain("&lt;img");
    expect(logDoTrabalho(exec({ id: "b", numero: 2, estado: "rodando" }), a, true)).not.toContain("<img");
  });
});

describe("o log ao vivo", () => {
  it("junta texto, ferramenta e o fim dela com as funções da conversa", () => {
    let a = atividadeComFrame(undefined, { tipo: "turno.atividade", dados: { rotulo: "Leu um arquivo", id: "c1", emUso: { texto: "Lendo src/x.ts" } } });
    expect(a?.acoes).toEqual([expect.objectContaining({ id: "c1", estado: "rodando" })]);
    a = atividadeComFrame(a, { tipo: "turno.acao_fim", dados: { id: "c1", falhou: true } });
    expect(a?.acoes[0]?.estado).toBe("falhou");
    expect(atividadeComFrame(a, { tipo: "mensagem.nova", dados: {} })).toBe(a);
    expect(logDoTrabalho(exec({ id: "a", numero: 1, estado: "rodando" }), a, false)).toContain("› 1 passo");
  });

  it("escuta o turno atual da cadeia (a retomada) só do trabalho vivo", () => {
    expect(turnoEscutado(dados([exec({ id: "b", numero: 2, estado: "rodando", turnoAtual: "retomada" })]))).toBe("retomada");
    expect(turnoEscutado(dados([exec({ id: "a", numero: 1, estado: "concluido" })]))).toBeNull();
  });
});

describe("o controle", () => {
  function montar(inicial: ExecucoesDaTarefa, falhaNoRepetir?: Error) {
    const chamadas: string[] = [];
    let atual = inicial;
    const api: ApiDosTrabalhos = {
      trabalhosDaTarefa: async () => { chamadas.push("listar"); return atual; },
      repetirTrabalho: async () => { chamadas.push("repetir"); if (falhaNoRepetir) throw falhaNoRepetir; atual = dados([exec({ id: "c", numero: 3, estado: "fila", origem: "repetir" }), ...atual.execucoes]); return { ok: true, quadro: null, trabalhos: atual }; },
      cancelarTrabalho: async () => { chamadas.push("cancelar"); return { ok: true, quadro: null, trabalhos: atual }; },
      acordarTrabalho: async () => { chamadas.push("acordar"); return { ok: true, quadro: null, trabalhos: atual }; },
      recadoTrabalho: async (_a, _t, texto) => { chamadas.push(`recado:${texto}`); return { ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: atual }; },
    };
    const log = { dataset: { trabalho: "" } as Record<string, string | undefined>, innerHTML: "" };
    const quadros: unknown[] = [];
    const t = criarTrabalhosDaTarefa({ api: () => api, redesenhar: () => {}, log: () => log, aplicarQuadro: (q) => quadros.push(q), juntarEm: 0 });
    const h = () => t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora }) ?? "";
    return { t, chamadas, log, h, quadros, api };
  }
  const esperar = () => new Promise((r) => setTimeout(r, 5));

  it("atualiza só o log com os frames do turno atual da cadeia", async () => {
    const m = montar(dados([exec({ id: "b", numero: 2, estado: "rodando", turnoAtual: "vivo" })]));
    m.t.abrir("ag", "tar");
    await esperar();
    expect(m.h()).toContain('data-trabalho="b"');
    m.log.dataset["trabalho"] = "b";
    m.t.aoFrame({ tipo: "turno.atividade", dados: { turnoId: "outro", rotulo: "Nada", id: "x" } });
    expect(m.log.innerHTML).toBe("");
    m.t.aoFrame({ tipo: "turno.atividade", dados: { turnoId: "vivo", rotulo: "Rodou os testes", id: "x" } });
    expect(m.log.innerHTML).toContain("› 1 passo");
    m.t.aoClicar("trab-passos");
    m.t.aoFrame({ tipo: "turno.atividade", dados: { turnoId: "vivo", rotulo: "Abriu o PR", id: "y" } });
    expect(m.log.innerHTML).toContain("Abriu o PR");
  });

  it("Repetir mostra o trabalho novo e manda o quadro; o fim de um turno da cadeia relê", async () => {
    const m = montar(dados([exec({ id: "a", numero: 1, estado: "falhou" })]));
    m.t.abrir("ag", "tar");
    await esperar();
    expect(m.t.aoClicar("trab-repetir")).toBe(true);
    await esperar();
    expect(m.chamadas).toEqual(["listar", "repetir"]);
    expect(m.h()).toContain("#3 · na fila");
    expect(m.quadros).toEqual([null]);
    m.t.aoFrame({ tipo: "turno.encerrado", dados: { turnoId: "t-a" } });
    await esperar();
    expect(m.chamadas.at(-1)).toBe("listar");
    expect(m.t.aoClicar("outra-coisa")).toBe(false);
  });

  it("o 409 do Repetir diz o porquê: rodando, cancele antes; parado fora do andamento, mova a tarefa (revisão 2 do PR #625)", async () => {
    const rodando = montar(dados([exec({ id: "a", numero: 1, estado: "rodando" })]), new ErroApi(409, "estado_invalido", "x"));
    rodando.t.abrir("ag", "tar");
    await esperar();
    rodando.t.aoClicar("trab-repetir");
    await esperar();
    expect(rodando.h()).toContain("Já está rodando: cancele antes.");
    const parado = montar(dados([exec({ id: "a", numero: 1, estado: "concluido" })]), new ErroApi(409, "estado_invalido", "x"));
    parado.t.abrir("ag", "tar");
    await esperar();
    parado.t.aoClicar("trab-repetir");
    await esperar();
    expect(parado.h()).toContain("A tarefa não está em andamento: mova-a antes.");
  });

  it("ADA-232: Acordar agora chama a API e relê", async () => {
    const m = montar(dados([exec({ id: "a", numero: 1, estado: "rodando", esperando: true, volta: { motivo: "x", em: 1, quando: null, prUrl: null } })]));
    m.t.abrir("ag", "tar");
    await esperar();
    expect(m.t.aoClicar("trab-acordar")).toBe(true);
    await esperar();
    expect(m.chamadas).toEqual(["listar", "acordar"]);
  });

  it("o recado manda o texto e avisa onde entrou", async () => {
    const m = montar(dados([exec({ id: "a", numero: 1, estado: "rodando" })]));
    m.t.abrir("ag", "tar");
    await esperar();
    const campo = { value: "  use a branch y " };
    m.t.enviarRecado({ dataset: { id: "tar" }, querySelector: () => campo, ownerDocument: { getElementById: () => campo } });
    await esperar();
    expect(m.chamadas.at(-1)).toBe("recado:use a branch y");
    expect(campo.value).toBe("");
    expect(m.h()).toContain("entra no próximo passo");
  });

  it("revisão 4 do ADA-5: trocou de tarefa no meio do recado, o rascunho da de origem sai e o campo da outra fica", async () => {
    const m = montar(dados([exec({ id: "a", numero: 1, estado: "rodando" })]));
    let soltar: () => void = () => {};
    m.api.recadoTrabalho = (_a, _t, texto) => new Promise((r) => { soltar = () => { m.chamadas.push(`recado:${texto}`); r({ ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: dados([]) }); }; });
    m.t.abrir("ag", "tar");
    await esperar();
    const enviado = { value: "use a branch y" };
    const daOutra = { value: "rascunho da outra" };
    const aceitos: unknown[] = [];
    const limpos: unknown[] = [];
    m.t.enviarRecado({ dataset: { id: "tar" }, querySelector: () => enviado, ownerDocument: { getElementById: () => daOutra } }, (c) => limpos.push(c), (c, texto) => aceitos.push([c, texto]));
    m.t.abrir("ag", "outra");
    soltar();
    await esperar();
    // Revisão 7: o texto enviado vai junto, para quem limpa o rascunho conferir que ainda é ele.
    expect(aceitos).toEqual([[enviado, "use a branch y"]]);
    // ADA-4: o campo esvaziou no envio (otimista) e só aí foi "limpo" (o rascunho acompanha); o da outra tarefa não.
    expect(enviado.value).toBe("");
    expect(limpos).toEqual([enviado]);
    expect(daOutra.value).toBe("rascunho da outra");
  });

  it("revisão 5 do ADA-5: o que a pessoa digitou no recado durante o voo fica (e não vira rascunho vazio)", async () => {
    const m = montar(dados([exec({ id: "a", numero: 1, estado: "rodando" })]));
    let soltar: () => void = () => {};
    m.api.recadoTrabalho = (_a, _t, texto) => new Promise((r) => { soltar = () => { m.chamadas.push(`recado:${texto}`); r({ ok: true, quadro: null, trabalho: { entregue: "agora" }, trabalhos: dados([]) }); }; });
    m.t.abrir("ag", "tar");
    await esperar();
    const campo = { value: "use a branch y" };
    const limpos: unknown[] = [];
    m.t.enviarRecado({ dataset: { id: "tar" }, querySelector: () => campo, ownerDocument: { getElementById: () => campo } }, (c) => limpos.push(structuredClone(c)));
    // ADA-4: o campo esvazia no envio (otimista); o que a pessoa escreve no voo é o recado seguinte.
    expect(campo.value).toBe("");
    campo.value = "e roda o lint";
    soltar();
    await esperar();
    expect(m.chamadas.at(-1)).toBe("recado:use a branch y");
    expect(campo.value).toBe("e roda o lint");
    // Só o esvaziar do envio avisou (com o campo vazio); a volta do servidor não mexe no que a pessoa escreveu.
    expect(limpos).toEqual([{ value: "" }]);
  });

  it("revisão 5 do PR #625: a mudança de estado vai à região persistente (só o textContent, só quando a chave muda); a primeira leitura não", async () => {
    const m = montar(dados([exec({ id: "a", numero: 1, estado: "falhou" })]));
    const escritas: string[] = [];
    let texto = "";
    const regiao = { get textContent() { return texto; }, set textContent(v: string) { texto = v; escritas.push(v); } };
    const t = criarTrabalhosDaTarefa({ api: () => m.api, redesenhar: () => {}, log: () => m.log, anuncio: () => regiao, juntarEm: 0 });
    t.abrir("ag", "tar");
    await esperar();
    expect(escritas).toEqual([]);
    t.aoClicar("trab-repetir");
    await esperar();
    expect(regiao.textContent).toBe("Trabalho #3: na fila");
    // A mesma chave (o redesenho, uma releitura igual) não reescreve a região.
    t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora });
    await t.reler();
    expect(escritas).toEqual(["Trabalho #3: na fila"]);
    expect(t.html("tar", { bloqueada: false, agenteId: "beto", conversaAtual: null, hora })).not.toContain(`role="status"`);
  });

  it("fechado, não lê nem desenha", async () => {
    const m = montar(dados([]));
    m.t.abrir("ag", "tar");
    m.t.fechar();
    await esperar();
    expect(m.t.html("tar", { bloqueada: false, agenteId: null, conversaAtual: null, hora })).toBeUndefined();
    m.t.aoFrame({ tipo: "turno.encerrado", dados: {} });
    await esperar();
    expect(m.chamadas).toEqual(["listar"]);
  });
});

describe("ADA-232: Volto quando… · Acordar agora", () => {
  const ci = { motivo: "a CI", em: 1, quando: "ci" as const, prUrl: "https://github.com/o/r/pull/705" };
  it("a frase diz a condição e o motivo (escapado na seção)", () => {
    expect(fraseDaVolta(ci, hora)).toBe("Volto quando a CI do PR #705 terminar · a CI");
    expect(fraseDaVolta({ motivo: null, em: 5, quando: null, prUrl: null }, hora)).toBe("Volto às 10:00");
    expect(fraseDaVolta({ motivo: MAL, em: null, quando: null, prUrl: null }, hora)).toBe(`Volto depois · ${MAL}`);
    const h = secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando", esperando: true, volta: { ...ci, motivo: MAL } })]) });
    expect(h).not.toContain(MAL);
    expect(h).toContain('data-act="trab-acordar"');
    expect(h).toContain("Acordar agora");
  });
  it("sem volta marcada não há Acordar agora", () => {
    expect(secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando" })]) })).not.toContain("trab-acordar");
  });
  // Regression: QA do PR #705 — a espera de um comando de fundo (esperar_comando) não se acorda: o servidor recusa
  // ("termina sozinho"). O botão aparecia e o clique dava erro. Found by /qa on 2026-11-08.
  it("QA: o comando de fundo mostra Volto depois, sem Acordar agora (o servidor recusa)", () => {
    const h = secao({ dados: dados([exec({ id: "a", numero: 1, estado: "rodando", esperando: true, volta: { motivo: "os testes", em: null, quando: null, prUrl: null } })]) });
    expect(h).toContain("Volto depois · os testes");
    expect(h).not.toContain("trab-acordar");
  });
});
