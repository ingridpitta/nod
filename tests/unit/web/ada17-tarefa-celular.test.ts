import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ComentarioDto, QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { ExecucaoDto } from "../../../src/contracts/quadro-execucoes.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { alturaDoTeclado, ligarTecladoVisivel } from "../../../web/lib/teclado-visivel.ts";
import { casaNaBusca, folhaDeAjustes, folhaDeCancelar, folhaDeStatus, folhaDoBranch, folhaDoResponsavel } from "../../../web/telas/folhas-da-tarefa.ts";
import { tarefaAberta } from "../../../web/telas/quadro-real.ts";
import { LIMITE_COMENTARIO } from "../../../web/telas/linha-do-tempo.ts";
import { engolirCliqueDoToque, focaveisVisiveis } from "../../../web/lib/folha-gestos.ts";
import { confiar } from "../../../web/telas/quadro.ts";
import {
  bandejaDeChips, fimDaTrocaCel, citacaoDe, composerDaTarefa, linhaDaExecucao, linhaDoTempo, separarExecucoes, tarefaAbertaCelular, textoDaResposta, trechoDe,
  type VistaDaTarefaCelular,
} from "../../../web/telas/tarefa-celular.ts";
import type { VistaDoTrabalho } from "../../../web/telas/trabalhos-da-tarefa.ts";

/** ADA-17 (ADR-148, F2): a tarefa aberta no celular, sem DOM (o Chrome real fica no QA do PR). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id: "t1", quadroId: "q1", titulo: "Tarefa um", descricao: "", status: "fazendo", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1_000, mudadoEm: 1_000, terminadaEm: null, execucao: null, agenteNome: "Vera", numero: 1, prioridade: "sem", codigo: "VER-1", branch: "", ...extra,
});
const q = (extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: "VER", modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Vera",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas: [], ultimoLote: null, feitas: 0, total: 0, ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">V</span>`), nome: "Vera" } : null);
const hora = (em: number) => `h${em}`;
const v = (extra: Partial<VistaDaTarefaCelular> = {}): VistaDaTarefaCelular => ({ t: t(), q: q(), agente, hora, responsaveis: [{ id: "a", nome: "Vera" }], agora: 10 * 60_000, ...extra });
const com = (id: string, texto: string, em: number, extra: Partial<ComentarioDto> = {}): ComentarioDto => ({
  id, quadroId: "q1", tarefaId: "t1", autor: { tipo: "pessoa" } as ComentarioDto["autor"], texto, deFora: false, criadoEm: em, autorNome: null, acionados: [], ...extra,
});
const exec = (id: string, extra: Partial<ExecucaoDto> = {}): ExecucaoDto => ({
  id, numero: 1, origem: "coluna", turnoId: "tu", motivo: null, criadoEm: 2_000, estado: "rodando", turnoAtual: "tu", comecouEm: 2 * 60_000, ultimaFrase: null, tentativa: null,
  esperando: false, novaTentativaEm: null, ...extra,
} as ExecucaoDto);
const trab = (execucoes: ExecucaoDto[], extra: Partial<VistaDoTrabalho> = {}): VistaDoTrabalho => ({
  tarefaId: "t1", dados: { execucoes, recados: [], conversaId: null, semAgente: false }, erro: false, bloqueada: false, agenteId: "a", conversaAtual: null,
  atividade: undefined, passosAbertos: false, anterioresAbertos: false, aviso: null, ocupado: false, ...extra,
});

describe("ADA-17: a tarefa aberta no celular", () => {
  it("critério 1: título grande na largura toda, código acima, sem select e sem cartão de propriedades", () => {
    const h = String(tarefaAbertaCelular(v({ t: t({ descricao: "Fazer X" }) })));
    expect(h).toContain('class="qd-tarefa qd-tarefa-cel"');
    expect(h).toMatch(/<h1 class="qd-t-tit" id="qd-t-tit" tabindex="-1">Tarefa um<\/h1>/);
    expect(h).toContain('<span class="qd-id">VER-1</span>');
    expect(h).toContain('<div class="qd-t-desc" data-ancora="desc">Fazer X</div>');
    expect(h).not.toContain("<select");
    expect(h).not.toContain("qd-t-lado");
    expect(h).toContain('data-titulo="VER-1 · Tarefa um"');
  });

  it("critério 2: a bandeja tem Status, Responsável e Ajustes; Branch só com branch (o prazo mora na seção de labels e prazo, 0161)", () => {
    const sem = bandejaDeChips(v());
    expect(sem).toContain('id="qd-t-status"');
    expect(sem).toContain('data-folha="status"');
    expect(sem).toContain('id="qd-t-resp"');
    expect(sem).toContain('data-folha="ajustes"');
    expect(sem).not.toContain('data-folha="branch"');
    expect(sem).not.toContain('data-folha="prazo"');
    const com_ = bandejaDeChips(v({ t: t({ branch: "frente/x" }) }));
    expect(com_).toContain('data-folha="branch"');
    expect(com_).toContain("frente/x");
    expect(sem).toMatch(/aria-label="Status: Fazendo"/);
    expect(sem).toMatch(/aria-label="Responsável: Vera"/);
  });

  it("critério 2: a troca otimista aparece no chip antes de voltar; a tarefa que espera você segue com o bot (ADR-162)", () => {
    expect(bandejaDeChips(v({ otimista: { status: "revisao" } }))).toContain("Status: Em revisão");
    expect(bandejaDeChips(v({ otimista: { agente: null } }))).toContain("Sem responsável");
    expect(bandejaDeChips(v({ t: t({ status: "fazendo", esperaPessoa: true }) }))).toContain("Responsável: Vera");
    expect(bandejaDeChips(v({ responsaveis: undefined }))).toMatch(/id="qd-t-resp"[^>]* disabled/);
  });

  it("critério 3: a falha diz para onde voltou e oferece Tentar de novo", () => {
    const h = String(tarefaAbertaCelular(v({ naoSalvou: "status" })));
    expect(h).toContain('role="alert"');
    expect(h).toContain("Não salvou. Voltou para Fazendo.");
    expect(h).toContain('data-act="cel-tentar"');
  });

  it("critério 6: a atividade é uma linha do tempo só, por hora, com evento, execução e comentário misturados", () => {
    const h = linhaDoTempo(v({
      t: t({ linhas: [{ tipo: "sistema", texto: "Linear ligado", criadoEm: 1_500 }] as unknown as TarefaDto["linhas"] }),
      coms: { lista: [com("c1", "Oi", 3_000)], carga: "pronta" as never, atividade: [], criadaPor: "Ana", pendente: null },
      trabalho: trab([exec("e1")]),
    }));
    const pos = ["Ana criou a tarefa", "Linear ligado", "Vera</strong> está trabalhando", "qd-com-txt\">Oi"].map((s) => h.indexOf(s));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(h.match(/<ol class="qd-linha-tempo">/g)).toHaveLength(1);
  });

  it("#294: a execução é uma linha (mascote, verbo, tempo), com o log ao vivo e as ações; as antigas recolhem", () => {
    const l = linhaDaExecucao(exec("e1"), { nome: "Vera", avatar: "<i></i>", hora, agora: 10 * 60_000, atual: true, v: trab([exec("e1")]) });
    expect(l).toContain('class="qd-exec"');
    expect(l).toContain("<strong>Vera</strong> está trabalhando");
    expect(l).toContain("8 min");
    expect(l).toContain('data-trabalho="e1"');
    expect(l).toContain('data-act="trab-cancelar"');
    expect(linhaDaExecucao(exec("e2", { estado: "falhou", motivo: MAL }), { nome: "Vera", avatar: "", hora, agora: 0, atual: false })).not.toContain("<img");
    const ontem = exec("e0", { criadoEm: 2_000 - 86_400_000 * 2, estado: "concluido" });
    expect(separarExecucoes([exec("e1"), ontem])).toEqual({ vistas: [exec("e1")], antigas: [ontem] });
    const h = linhaDoTempo(v({ trabalho: trab([exec("e1"), ontem]) }));
    expect(h).toContain("Ver 1 execução anterior");
    expect(h).not.toContain('data-estado="concluido"');
    expect(linhaDoTempo(v({ trabalho: trab([exec("e1"), ontem], { anterioresAbertos: true }) }))).toContain('data-estado="concluido"');
  });

  it("critério 7 e 8: composer único com o nome do bot; Responder põe a barra \"Respondendo a Ana ✕\"", () => {
    const c = composerDaTarefa({ t: t(), agente, respondendo: null });
    expect(c).toContain('data-form="comentar-tarefa"');
    expect(c).toContain('id="qd-com-t1"');
    expect(c).toContain('class="qd-com-in"');
    expect(c).toContain('placeholder="Comentar ou pedir para Vera…"');
    const r = composerDaTarefa({ t: t(), agente, respondendo: { comentario: "c1", nome: "Ana", trecho: "x" } });
    expect(r).toContain("Respondendo a <strong>Ana</strong>");
    expect(r).toContain('data-act="cel-responder-sair"');
    expect(String(tarefaAbertaCelular(v())).match(/data-form="comentar-tarefa"/g)).toHaveLength(1);
  });

  it("S2: a citação vai no texto e volta como bloco; texto de fora escapado", () => {
    expect(trechoDe("> Bo: a\n\nlinha   um\ndois")).toBe("linha um dois");
    expect(trechoDe("x".repeat(200))).toHaveLength(80);
    const txt = textoDaResposta({ nome: "Ana", trecho: "o que acha?" }, "Acho bom");
    expect(txt).toBe("> Ana: o que acha?\n\nAcho bom");
    expect(citacaoDe(txt)).toEqual({ cita: { nome: "Ana", trecho: "o que acha?" }, corpo: "Acho bom" });
    expect(citacaoDe("sem cita")).toEqual({ cita: null, corpo: "sem cita" });
    const h = linhaDoTempo(v({ coms: { lista: [com("c1", textoDaResposta({ nome: MAL, trecho: MAL }, MAL), 3_000)], carga: "pronta" as never, atividade: [], criadaPor: null, pendente: null } }));
    expect(h).toContain('class="qd-com-cita"');
    expect(h).not.toContain("<img");
    expect(h).toContain('data-act="cel-responder"');
  });

  it("critério 13: o computador continua com a tarefa de sempre (select, lado), sem bandeja", () => {
    const h = String(tarefaAberta({ t: t(), q: q(), agente }));
    expect(h).toContain("<select");
    expect(h).not.toContain("qd-bandeja");
    expect(h).not.toContain("qd-cel-composer");
  });

  it("tudo de fora escapado no celular", () => {
    const h = String(tarefaAbertaCelular(v({ t: t({ titulo: MAL, descricao: MAL, branch: MAL, agenteNome: MAL, agenteId: "x" }), q: q({ meta: MAL }) })));
    expect(h).not.toContain("<img");
  });
});

describe("ADA-17: as folhas", () => {
  it("status: o atual marcado, por grupo, sem Precisa de você quando não está lá", () => {
    const f = folhaDeStatus({ status: "fazendo" }, colunasDto(COLUNAS_PADRAO));
    expect(f).toMatch(/aria-checked="true" data-folha-acao="status" data-valor="fazendo"/);
    expect(f.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(f).not.toContain('data-valor="voce"');
    expect(folhaDeStatus({ status: "voce" }, colunasDto(COLUNAS_PADRAO))).toContain('data-valor="voce"');
  });

  it("cancelar pede confirmação (sem select), com Voltar", () => {
    const f = folhaDeCancelar(MAL);
    expect(f).toContain('data-folha-acao="status-voltar"');
    expect(f).toContain('data-folha-acao="cancelar-ok"');
    expect(f).not.toContain("<img");
  });

  it("responsável: Sem responsável, os bots, busca acima de 6; sem o \"Você\" de Precisa de você (ADR-162)", () => {
    const bots = [{ id: "a", nome: "Vera" }, { id: "b", nome: "Bia" }];
    const f = folhaDoResponsavel({ status: "fazendo", agenteId: "a", agenteNome: "Vera" }, bots);
    expect(f).toMatch(/aria-checked="true" data-folha-acao="agente" data-valor="a"/);
    expect(f).not.toContain("data-folha-busca");
    const muitos = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, nome: `Bot ${i}` }));
    expect(folhaDoResponsavel({ status: "fazendo", agenteId: null, agenteNome: null }, muitos)).toContain("data-folha-busca");
    const espera = folhaDoResponsavel({ status: "fazendo", agenteId: "a", agenteNome: "Vera" }, bots);
    expect(espera).not.toContain(">Você<");
    expect(espera).toMatch(/aria-checked="true" data-folha-acao="agente" data-valor="a"/);
    expect(casaNaBusca("Júlia", "jul")).toBe(true);
    expect(casaNaBusca("Vera", "bia")).toBe(false);
    expect(casaNaBusca("Vera", "  ")).toBe(true);
  });

  it("branch numa linha com Copiar; ajustes chave → valor com links seguros", () => {
    expect(folhaDoBranch(MAL)).not.toContain("<img");
    expect(folhaDoBranch("a/b")).toContain('data-folha-acao="copiar" data-valor="a/b"');
    const a = folhaDeAjustes({ t: t({ branch: "a/b", prUrl: "javascript:alert(1)", linearId: "NOD-1", linearUrl: "https://linear.app/x" }), q: q(), nomeStatus: "Fazendo", nomeResp: "Vera", podeResp: true, podeMover: false });
    expect(a).toContain('data-folha-acao="abrir-status"');
    expect(a).toContain('data-folha-acao="abrir-resp"');
    expect(a).not.toContain('data-folha-acao="abrir-mover"');
    expect(a).not.toContain("javascript:");
    expect(a).toContain('href="https://linear.app/x"');
  });
});

describe("ADA-17: o teclado", () => {
  it("a altura coberta: janela − viewport visual − deslocamento, nunca negativa; zoom e sem visualViewport dão 0", () => {
    expect(alturaDoTeclado(800, { height: 500, offsetTop: 0, scale: 1 })).toBe(300);
    expect(alturaDoTeclado(800, { height: 500, offsetTop: 40, scale: 1 })).toBe(260);
    expect(alturaDoTeclado(800, { height: 900, offsetTop: 0, scale: 1 })).toBe(0);
    expect(alturaDoTeclado(800, { height: 300, offsetTop: 0, scale: 2 })).toBe(0);
    expect(alturaDoTeclado(800, null)).toBe(0);
  });

  it("liga e desliga o --teclado no :root seguindo o resize", () => {
    const props = new Map<string, string>();
    const ouvintes = new Map<string, () => void>();
    const vv = { height: 800, offsetTop: 0, scale: 1, addEventListener: (n: string, f: () => void) => ouvintes.set(n, f), removeEventListener: (n: string) => ouvintes.delete(n) };
    const win = { innerHeight: 800, visualViewport: vv, document: { documentElement: { style: { setProperty: (n: string, x: string) => props.set(n, x), removeProperty: (n: string) => props.delete(n) } } } };
    const desligar = ligarTecladoVisivel(win as never);
    expect(props.get("--teclado")).toBe("0px");
    vv.height = 480;
    ouvintes.get("resize")!();
    expect(props.get("--teclado")).toBe("320px");
    desligar();
    expect(props.has("--teclado")).toBe(false);
    expect(ouvintes.size).toBe(0);
  });
});

describe("ADA-17: revisão do PR #699", () => {
  it("a troca otimista: a resposta velha (ou a que chega depois de sair) não apaga a nova nem diz 'Não salvou' do que salvou", () => {
    const falha = (tarefa: string) => ({ tarefa, qual: "status" as const, refazer: () => {} });
    const minha = { tarefa: "t1", seq: 1, status: "revisao" };
    // Deu certo: a otimista sai e um "Não salvou" antigo da mesma tarefa some.
    expect(fimDaTrocaCel({ otimista: minha, naoSalvou: falha("t1") }, minha, true, () => falha("t1"))).toEqual({ otimista: null, naoSalvou: null });
    // Falhou: "Não salvou".
    expect(fimDaTrocaCel({ otimista: minha, naoSalvou: null }, minha, false, () => falha("t1")).naoSalvou?.tarefa).toBe("t1");
    // Outra troca já está no ar: esta resposta não mexe em nada.
    const nova = { tarefa: "t1", seq: 2, status: "feito" };
    expect(fimDaTrocaCel({ otimista: nova, naoSalvou: null }, minha, false, () => falha("t1"))).toEqual({ otimista: nova, naoSalvou: null });
    // A pessoa saiu (fechar zerou o estado): a resposta que chega depois não grava "Não salvou".
    expect(fimDaTrocaCel({ otimista: null, naoSalvou: null }, minha, false, () => falha("t1"))).toEqual({ otimista: null, naoSalvou: null });
  });

  it("a resposta com citação nunca passa do limite do comentário (o servidor recusaria)", () => {
    const longa = "x".repeat(LIMITE_COMENTARIO);
    const txt = textoDaResposta({ nome: "Ana", trecho: "y".repeat(80) }, longa);
    expect(txt.length).toBeLessThanOrEqual(LIMITE_COMENTARIO);
    expect(txt).toBe(longa);
    const c = composerDaTarefa({ t: t(), agente, respondendo: { comentario: "c1", nome: "Ana", trecho: "abc" } });
    const max = Number(/maxlength="(\d+)"/.exec(c)![1]);
    expect(max + textoDaResposta({ nome: "Ana", trecho: "abc" }, "").length).toBeLessThanOrEqual(LIMITE_COMENTARIO);
  });

  it("o foco preso na folha ignora o que está dentro de um item escondido (a busca do responsável)", () => {
    const el = (escondido: boolean) => ({ hidden: false, closest: (s: string) => (s === "[hidden]" && escondido ? {} : null) });
    const a = el(false), b = el(true), c = el(false);
    expect(focaveisVisiveis([a, b, c] as never)).toEqual([a, c]);
  });

  it("o clique que vem ao soltar o toque longo é engolido mesmo segurando mais de 700 ms", () => {
    const ouvintes: { tipo: string; f: (e: Event) => void; capture: boolean }[] = [];
    const doc = {
      addEventListener: (tipo: string, f: (e: Event) => void, o?: { capture?: boolean }) => { ouvintes.push({ tipo, f, capture: !!o?.capture }); },
      removeEventListener: (tipo: string, f: (e: Event) => void) => { const i = ouvintes.findIndex((x) => x.tipo === tipo && x.f === f); if (i >= 0) ouvintes.splice(i, 1); },
    };
    const timers: { em: number; f: () => void }[] = [];
    let agora = 0;
    const setT = (f: () => void, ms: number) => { timers.push({ em: agora + ms, f }); return 0 as never; };
    const passar = (ms: number) => { agora += ms; for (const x of timers.filter((x) => x.em <= agora)) { timers.splice(timers.indexOf(x), 1); x.f(); } };
    const disparar = (tipo: string) => { let parado = false; const e = { stopPropagation: () => { parado = true; }, preventDefault: () => {} } as unknown as Event; for (const x of [...ouvintes].filter((x) => x.tipo === tipo)) x.f(e); return parado; };
    engolirCliqueDoToque(doc as never, setT);
    passar(1500); // o dedo continua parado
    disparar("pointerup");
    expect(disparar("click")).toBe(true);
    // Depois disso, os cliques voltam ao normal.
    passar(1000);
    expect(disparar("click")).toBe(false);
    expect(ouvintes).toHaveLength(0);
  });
});

// Regression: QA do PR #699 (ADA-17), achados por /qa em 2026-11-08: mutantes sobreviventes e o "Não salvou" que mentia.
describe("ADA-17: QA do PR #699", () => {
  it("o \"Não salvou\" diz onde a tarefa está AGORA (depois da releitura), não o que estava antes do toque", () => {
    // A troca falhou porque o quadro mudou (outra pessoa pôs em Feito): a releitura traz Feito, o chip mostra Feito.
    expect(String(tarefaAbertaCelular(v({ t: t({ status: "feito" }), naoSalvou: "status" })))).toContain("Não salvou. Voltou para Feito.");
    expect(String(tarefaAbertaCelular(v({ naoSalvou: "resp" })))).toContain("Não salvou. Continua com Vera.");
    expect(String(tarefaAbertaCelular(v({ t: t({ agenteId: null }), naoSalvou: "resp" })))).toContain("Não salvou. Continua sem responsável.");
    expect(String(tarefaAbertaCelular(v({ t: t({ status: "fazendo", esperaPessoa: true }), naoSalvou: "resp" })))).toContain("Não salvou. Continua com Vera.");
  });

  it("a folha do responsável marca só o atual; sem responsável, marca \"Sem responsável\"", () => {
    const bots = [{ id: "a", nome: "Vera" }, { id: "b", nome: "Bia" }];
    const f = folhaDoResponsavel({ status: "fazendo", agenteId: "a", agenteNome: "Vera" }, bots);
    expect(f.match(/aria-checked="true"/g)).toHaveLength(1);
    const sem = folhaDoResponsavel({ status: "fazendo", agenteId: null, agenteNome: null }, bots);
    expect(sem.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(sem).toMatch(/aria-checked="true" data-folha-acao="agente" data-valor=""/);
  });

  it("deu certo numa tarefa: o \"Não salvou\" de OUTRA tarefa fica", () => {
    const outra = { tarefa: "t2", qual: "status" as const, refazer: () => {} };
    const minha = { tarefa: "t1", seq: 1, status: "revisao" };
    expect(fimDaTrocaCel({ otimista: minha, naoSalvou: outra }, minha, true, () => outra)).toEqual({ otimista: null, naoSalvou: outra });
  });

  it("a citação cabe exatamente no limite: vai junto; o nome com quebra de linha não quebra a citação", () => {
    const r = { nome: "Ana", trecho: "abc" };
    const resto = "x".repeat(LIMITE_COMENTARIO - textoDaResposta(r, "").length);
    expect(textoDaResposta(r, resto)).toBe(`> Ana: abc\n\n${resto}`);
    const txt = textoDaResposta({ nome: "Ana\nBo", trecho: "oi" }, "ok");
    expect(citacaoDe(txt)).toEqual({ cita: { nome: "Ana Bo", trecho: "oi" }, corpo: "ok" });
  });

  it("critério 13: só o celular troca a árvore (a escolha é ehCelular() no render da tarefa aberta)", () => {
    const fonte = readFileSync(new URL("../../../web/lib/quadro-na-tela.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/if \(ehCelular\(\)\) \{\n(?:[^\n]*\n){0,4}?\s*return tarefaAbertaCelular\(/);
    expect(fonte).toMatch(/return tarefaAbertaCelular\([\s\S]*?\}\);\n\s*\}\n\s*return tarefaAberta\(/);
  });
});

describe("ADA-17: o CSS do celular (lido como texto; celular.test.ts garante que tudo está na consulta do celular)", () => {
  const css = readFileSync(new URL("../../../web/celular-base.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /** A última declaração de `prop` nas regras cujo seletor tem `alvo` (item exato da lista de seletores). */
  const ultimo = (alvo: string, prop: string): string | undefined => {
    let v: string | undefined;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(alvo)) continue;
      for (const par of m[2]!.split(";")) { const i = par.indexOf(":"); if (i > 0 && par.slice(0, i).trim() === prop) v = par.slice(i + 1).trim(); }
    }
    return v;
  };
  it("critério 1: título 26, descrição 17", () => {
    expect(ultimo(".qd-t-tit", "font-size")).toBe("26px");
    expect(ultimo(".qd-t-desc", "font-size")).toBe("17px");
  });
  it("critério 3: linhas de 52; a folha fica acima do teclado e cabe na área visível (nunca vh)", () => {
    expect(ultimo(".qd-fo-op", "min-height")).toBe("52px");
    expect(ultimo(".qd-prop", "min-height")).toBe("52px");
    expect(ultimo(".qd-folha.qd-folha-cel", "bottom")).toBe("var(--teclado, 0px)");
    expect(ultimo(".qd-folha.qd-folha-cel", "max-height")).toMatch(/^calc\(100dvh - var\(--teclado, 0px\)/);
  });
  it("critério 6: o ponto do evento tem 6 px", () => {
    expect(ultimo(".qd-ev::before", "width")).toBe("6px");
    expect(ultimo(".qd-ev::before", "height")).toBe("6px");
  });
  it("critério 7: um composer só, colado embaixo; a pílula do quadro sai com a tarefa aberta", () => {
    expect(ultimo(".qd-cel-composer", "position")).toBe("sticky");
    expect(ultimo(".qd-cel-composer", "bottom")).toBe("0");
    expect(ultimo(".qd-vista:has(> .qd-conteudo > .qd-tarefa-cel) > .qc-wrap > :not(.qd-anuncio)", "display")).toBe("none");
  });
  it("critério 10: alvos de 44 e campos de 16", () => {
    for (const s of [".qd-chip-cel", ".qd-cel-enviar"]) expect(ultimo(s, "height"), s).toBe("var(--cel-alvo)");
    for (const s of [".qd-cel-resp-x", ".qd-com-resp", ".qd-ativ-antigas", ".qd-ev .qd-hist-desfazer", ".qd-exec-acoes .qd-link", ".qd-cel-erro .qd-link", ".qd-folha-cel .qd-folha-ok", ".qd-fo-acoes .qd-bt", ".qd-fo-campo"]) {
      expect(ultimo(s, "min-height"), s).toBe("var(--cel-alvo)");
    }
    expect(ultimo(".qd-com-in", "font-size")).toBe("var(--cel-campo)");
    expect(ultimo(".qd-fo-campo", "font-size")).toBe("var(--cel-campo)");
  });
  it("critério 12: o topo encolhido mostra o data-titulo (VER-1 · título) numa linha", () => {
    const sel = ".stage.qd-no-quadro:has(.qd-tarefa-cel) .cabecalho.topo-encolhido[data-titulo]::after";
    expect(ultimo(sel, "content")).toBe("attr(data-titulo)");
    expect(ultimo(sel, "white-space")).toBe("nowrap");
  });
});

describe("2026-11-11: a tarefa no celular com o aviso do Backlog e a Prioridade do computador (PR #725)", () => {
  it("no Backlog com responsável, o aviso de parada do computador (avisoDeParada) aparece sob o título", () => {
    const h = String(tarefaAbertaCelular(v({ t: t({ status: "backlog" }) })));
    expect(h).toContain('<p class="ta-parada">Parada no Backlog: o responsável só começa quando ela for para A fazer</p>');
    expect(String(tarefaAbertaCelular(v({ t: t({ status: "backlog", agenteId: null }) })))).not.toContain("ta-parada");
  });

  it("a Prioridade preenchida vira um chip da bandeja que abre a folha dela; vazia, fica em Ajustes", () => {
    const h = bandejaDeChips(v({ t: t({ prioridade: "urgente" }) }));
    expect(h).toMatch(/<button type="button" class="qd-chip qd-chip-cel" id="qd-t-prioridade" data-act="cel-folha" data-folha="prioridade" data-id="t1" aria-haspopup="dialog" aria-label="Prioridade: Urgente">/);
    expect(h.indexOf("qd-t-prioridade")).toBeGreaterThan(h.indexOf("qd-t-resp"));
    expect(bandejaDeChips(v())).not.toContain("qd-t-prioridade");
    expect(folhaDeAjustes({ t: t(), q: q(), nomeStatus: "Fazendo", nomeResp: "Vera", podeResp: true, podeMover: false })).toContain('data-folha-acao="abrir-prioridade"');
  });
});

describe("2026-11-11: os diálogos da linha do tempo na tarefa do celular", () => {
  it("o diálogo de Ver o trabalho (e o Registro) entra na tarefa do celular, como no computador", () => {
    const d = `<dialog open class="ta-dialogo ta-trans" id="ta-trans"><p class="ta-lado-nota">máquina nod-motor-teste</p></dialog>`;
    const h = String(tarefaAbertaCelular(v({ linha: "<section></section>", dialogo: d })));
    expect(h).toContain(d);
    expect(h.indexOf(d)).toBeLessThan(h.lastIndexOf("</article>"));
    expect(String(tarefaAbertaCelular(v()))).not.toContain("ta-trans");
  });
});
