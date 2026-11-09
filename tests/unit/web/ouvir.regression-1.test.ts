import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { criarTocadorDeLeitura, type ContextoDeAudio } from "../../../web/lib/ouvir.ts";
import { podeOuvir, renderMensagem, renderMensagensAgrupadas } from "../../../web/telas/conversa.ts";
import { textoPedidoDeTela } from "../../../src/domain/computador.ts";

/**
 * NOD-106, testes de regressão do QA por mutação do PR #381 (topo fdee03bc).
 * Cada bloco mata um mutante que sobreviveu à suíte do PR.
 * Regression: mutantes sobreviventes do PR #381. Found by /qa on 2026-10-17.
 */

const C = "c1";
function cenario(): Estado {
  const conversa: ConversaDto = { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never, mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [] };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
  const disp = { disponivel: true as const, consentimentoNecessario: false, versaoConsentimento: 3, provedor: "google", ouvir: true };
  return {
    ...base,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: {
      agentes: [
        { id: "a", nome: "Nina", conversaId: C, cor: "c-blue", forma: "shape-square", ownerId: "p" },
        { id: "x", nome: "Velha", conversaId: "c3", cor: "c-blue", forma: "shape-square", ownerId: "p", excluidoEm: 5 },
      ],
    } as never,
    disponibilidadeLigacao: { a: disp, x: disp },
  };
}
const resposta = (o: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id: "m1", conversaId: C, turnoId: null, autoria: { autor_tipo: "agente", autor_id: "a" }, kind: "texto", texto: "Oi! Tudo certo.", payload: null, confianca: "confiavel", parcial: false, criadoEm: Date.UTC(2026, 9, 17, 14, 0), ...o,
} as Mensagem);

describe("regressão /qa #381: quem tem o botão Ouvir", () => {
  // Mutante M04: sem o filtro de autor_tipo, uma mensagem de pessoa cujo id coincide com o de um bot próprio ganhava o botão.
  it("mensagem de pessoa não tem Ouvir, mesmo com o id de um bot próprio", () => {
    expect(podeOuvir(resposta({ autoria: { autor_tipo: "pessoa", autor_id: "a" } as never }), cenario(), false)).toBe(false);
  });

  // Mutante M06: bot excluído (excluidoEm) continuava com o botão.
  it("resposta de bot excluído não tem Ouvir", () => {
    expect(podeOuvir(resposta({ autoria: { autor_tipo: "agente", autor_id: "x" } as never }), cenario(), false)).toBe(false);
  });

  // Mutantes M08/M09: o teste do PR só chamava podeOuvir(…, true); o render e o agrupado podiam ignorar a sala.
  it("em sala, nem o render da mensagem nem o agrupado mostram o botão", () => {
    const e = cenario();
    expect(renderMensagem(resposta(), e, false)).toContain('data-act="ouvir-mensagem"');
    expect(renderMensagem(resposta(), e, true)).not.toContain('data-act="ouvir-mensagem"');
    expect(renderMensagensAgrupadas([resposta()], e, false)).toContain('data-act="ouvir-mensagem"');
    expect(renderMensagensAgrupadas([resposta()], e, true)).not.toContain('data-act="ouvir-mensagem"');
  });
});

describe("regressão /qa #381: trocar de sessão zera a leitura", () => {
  // Mutantes M44/M45/M46: o plano diz que o reducer zera leitura e falha ao trocar de pessoa OU de tenant; nada testava.
  const lendo = (): Estado => ({ ...cenario(), leitura: { mensagemId: "m1", fase: "tocando" }, falhaLeitura: { mensagemId: "m0" } });
  it("outra pessoa: leitura e falha somem", () => {
    const e = reduzir(lendo(), { tipo: "sessao", escopo: { pessoaId: "q", tenantId: "t" } as never });
    expect(e.leitura).toBeNull();
    expect(e.falhaLeitura).toBeNull();
  });
  it("mesma pessoa, outro tenant: leitura e falha somem", () => {
    const e = reduzir(lendo(), { tipo: "sessao", escopo: { pessoaId: "p", tenantId: "t2" } as never });
    expect(e.leitura).toBeNull();
    expect(e.falhaLeitura).toBeNull();
  });
  it("mesma sessão de novo: nada muda", () => {
    const e = reduzir(lendo(), { tipo: "sessao", escopo: { pessoaId: "p", tenantId: "t" } as never });
    expect(e.leitura).toEqual({ mensagemId: "m1", fase: "tocando" });
    expect(e.falhaLeitura).toEqual({ mensagemId: "m0" });
  });
});

describe("regressão /qa #381: um AudioContext por sessão", () => {
  // Mutante M32: `ctx = criarContexto()` a cada clique passava, porque o falso do PR devolve sempre o mesmo objeto.
  it("destravar e ouvir várias vezes criam o contexto uma vez só", async () => {
    let criados = 0;
    const ctx = { currentTime: 0, state: "running", destination: {}, resume: () => Promise.resolve(), createBuffer: () => { throw new Error("sem uso"); }, createBufferSource: () => { throw new Error("sem uso"); } } as unknown as ContextoDeAudio;
    const t = criarTocadorDeLeitura({ fetch: () => Promise.resolve(new Response(null, { status: 502 })), criarContexto: () => { criados++; return ctx; }, aoMudar: () => undefined });
    t.destravar();
    await t.ouvir("t", "m1");
    t.destravar();
    await t.ouvir("t", "m2");
    expect(criados).toBe(1);
  });
});

/** Contexto falso com fontes contáveis (o mesmo desenho do ouvir.test.ts). */
function contexto() {
  const fontes: { onended: (() => void) | null; parada: boolean }[] = [];
  const ctx = {
    currentTime: 0, state: "running", destination: {}, resume: () => Promise.resolve(),
    createBuffer: (_c: number, q: number, taxa: number) => { const dados = new Float32Array(q); return { duration: q / taxa, getChannelData: () => dados }; },
    createBufferSource: () => { const f = { buffer: null, onended: null as (() => void) | null, parada: false, connect: () => undefined, start: () => undefined, stop: () => { f.parada = true; } }; fontes.push(f); return f; },
  };
  return { ctx: ctx as unknown as ContextoDeAudio, fontes };
}
const esperar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
type Leitura = { done: boolean; value?: Uint8Array };

describe("regressão /qa #381: o tocador", () => {
  // Mutante M35: sem o `acabou`, o primeiro pedaço terminando antes do segundo chegar (rede lenta) encerrava a leitura no meio.
  it("o fim de um pedaço antes de o corpo acabar não encerra a leitura", async () => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const corpo = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } });
    const { ctx, fontes } = contexto();
    const t = criarTocadorDeLeitura({ fetch: () => Promise.resolve(new Response(corpo)), criarContexto: () => ctx, aoMudar: () => undefined });
    const fim = t.ouvir("t", "m1");
    ctl.enqueue(new Uint8Array(200));
    await esperar();
    fontes[0]?.onended?.();
    expect(t.atual()).toEqual({ mensagemId: "m1", fase: "tocando" });
    ctl.enqueue(new Uint8Array(200));
    ctl.close();
    await fim;
    expect(t.atual()?.fase).toBe("tocando");
    fontes[1]?.onended?.();
    expect(t.atual()).toBeNull();
  });

  // Mutante M29: um leitor que não larga o read pendente ao cancelar (WebView antigo) agendava som depois do Parar.
  it("pedaço que chega depois do Parar não vira som", async () => {
    let soltar!: (r: Leitura) => void;
    const leitor = { read: () => new Promise<Leitura>((r) => { soltar = r; }), cancel: () => Promise.resolve() };
    const resposta = { ok: true, status: 200, body: { getReader: () => leitor } } as unknown as Response;
    const { ctx, fontes } = contexto();
    const t = criarTocadorDeLeitura({ fetch: () => Promise.resolve(resposta), criarContexto: () => ctx, aoMudar: () => undefined });
    const fim = t.ouvir("t", "m1");
    await esperar();
    soltar({ done: false, value: new Uint8Array(200) });
    await esperar();
    expect(fontes).toHaveLength(1);
    t.parar();
    soltar({ done: false, value: new Uint8Array(200) });
    expect(await fim).toEqual({ ok: true });
    expect(fontes).toHaveLength(1);
    expect(t.atual()).toBeNull();
  });

  // Mutante M37: só o 409 é falta de consentimento; outro status com o mesmo código é falha.
  it("estado_invalido fora do 409 é falha", async () => {
    for (const status of [400, 422, 500]) {
      const t = criarTocadorDeLeitura({ fetch: () => Promise.resolve(Response.json({ codigo: "estado_invalido" }, { status })), criarContexto: () => contexto().ctx, aoMudar: () => undefined });
      expect(await t.ouvir("t", "m1")).toEqual({ ok: false, motivo: "falha" });
    }
  });
});

describe("regressão /qa #381: fiação em main.ts e nos diálogos", () => {
  // Sem DOM no projeto unit: main.ts não é importável; estes testes de fonte seguem o padrão do próprio ouvir.test.ts.
  const ler = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  const main = ler("web/main.ts");

  // M47, M49, M48, M63: sair da conversa, fechar a página, ligação em outro aparelho e troca de sessão param a leitura.
  it("as quatro saídas param a leitura", () => {
    // NOD-370: a parada saiu para `aoTrocarDeTela`, chamado por `navegar` antes do dispatch e por `reidratar` quando o
    // bot da conversa sai da frota.
    expect(main).toMatch(/antes\.conversaId !== tela\.conversaId\)\) tocador\.parar\("saiu"\);/);
    expect(main).toMatch(/aoTrocarDeTela\(antes, tela\);\s*dispatch\(\{ tipo: "navegar", tela \}\)/);
    expect(main).toMatch(/function reduzirVendoSaida[\s\S]*?aoTrocarDeTela\(antes, estado\.tela\);/);
    expect(main).toContain('window.addEventListener("pagehide", () => tocador.parar("saiu"));');
    expect(main).toContain('if (acao.tipo === "ligacao-viva" && acao.viva && tocador.atual()) tocador.parar("ligacao");');
    expect(main).toMatch(/escopo\.tenantId !== estado\.sessao\?\.tenantId \|\| escopo\.pessoaId !== estado\.sessao\?\.pessoaId\) tocador\.parar\("saiu"\)/);
  });

  // M50, M51, M53: o clique com ligação viva não lê; na resposta ativa para; um clique novo limpa o aviso antes de ler.
  it("o clique em Ouvir respeita ligação viva, para a ativa e limpa o aviso", () => {
    const acao = main.slice(main.indexOf('"ouvir-mensagem": (el) => {'), main.indexOf('"relatar-mensagem": (el) => {'));
    expect(acao).toContain('if (!id || el.getAttribute("aria-disabled") === "true" || estado.ligacaoViva) return;');
    expect(acao).toContain('if (tocador.atual()?.mensagemId === id) return tocador.parar("parou");');
    expect(acao).toMatch(/tocador\.destravar\(\);\s*limparFalhaLeitura\(\);\s*void ouvirMensagem\(id\);/);
  });

  // M52, M54: o aviso dura 6 s; só "falha" mostra o aviso, o 409 abre o diálogo.
  it("o aviso dura 6 s e só a falha o mostra; sem consentimento abre o diálogo", () => {
    expect(main).toMatch(/function mostrarFalhaLeitura[\s\S]{0,700}\}, 6000\);/);
    expect(main).toMatch(/if \(r\.motivo === "falha"\) return mostrarFalhaLeitura\(mensagemId\);\s*\/\/[^\n]*\n\s*const concordou = await pedirConsentimentoVoz\(/);
  });

  // M57: o callback do "Concordo" roda dentro do clique; M61: o ditado grava o aceite nesse callback.
  it("o diálogo chama aoConcordar no clique do Concordo, e o ditado grava o aceite ali", () => {
    expect(ler("web/telas/consentimento-voz.ts")).toContain("if (v) p.aoConcordar?.();");
    expect(ler("web/telas/ditado-controle.ts")).toMatch(/aoConcordar: \(\) => \{[\s\S]{0,120}const aceite = d\.consentir\(VERSAO_CONSENTIMENTO\)[\s\S]{0,700}gravar\(aceite\);/);
  });

  // M58: o diálogo único mostra o texto B no corpo (o teste do PR só via o nome no import).
  it("o diálogo mostra o texto do aviso", () => {
    expect(ler("web/telas/consentimento-voz.ts")).toContain("<p>${esc(TEXTO_CONSENTIMENTO)}</p>");
  });

  // M60: ligar para a leitura ANTES do primeiro await (o som não pode atravessar a busca da disponibilidade).
  it("ligar para a leitura antes de qualquer await", () => {
    const fonte = ler("web/telas/ligacao-controle.ts");
    const depois = fonte.slice(fonte.indexOf("iniciando = true;"));
    expect(depois.indexOf("deps.pararLeitura?.()")).toBeGreaterThan(-1);
    expect(depois.indexOf("deps.pararLeitura?.()")).toBeLessThan(depois.indexOf("await "));
  });
});

describe("regressão re-QA #381 (20/10): classes da fala e balão ouvível no celular", () => {
  const classesDe = (html: string): string[] => (/class="(message [^"]*)"/.exec(html)?.[1] ?? "").split(" ");
  const pedidoDeTela = (): Mensagem => resposta({ id: "m2", texto: textoPedidoDeTela("verificar que é humano no LinkedIn"), payload: { kind: "pedido_a_pessoa", decisaoId: "d1" } as never });

  // Mutante que tira `${motivoTela !== null ? " com-tela" : ""}`: o pedido de tela leva a classe; a pergunta comum e a resposta não.
  it("pedido de tela leva com-tela; pergunta comum e resposta não", () => {
    const e = cenario();
    expect(classesDe(renderMensagem(pedidoDeTela(), e, false))).toContain("com-tela");
    expect(classesDe(renderMensagem(resposta({ id: "m3", texto: "Posso arquivar o PR?", payload: { kind: "pedido_a_pessoa", decisaoId: "d2" } as never }), e, false))).not.toContain("com-tela");
    expect(classesDe(renderMensagem(resposta(), e, false))).not.toContain("com-tela");
  });

  it("lendo só na fala que está sendo lida", () => {
    const e: Estado = { ...cenario(), leitura: { mensagemId: "m1", fase: "tocando" } };
    expect(classesDe(renderMensagem(resposta(), e, false))).toContain("lendo");
    expect(classesDe(renderMensagem(resposta({ id: "m9" }), e, false))).not.toContain("lendo");
  });

  // Bug 1 do re-QA: a reserva de 216 px do desktop (interface.css) ganhava da regra do celular por especificidade e
  // encolhia o balão para 150 px em 390 px. O mobile.css precisa sobrescrever com o mesmo seletor, dentro do media query.
  it("no celular o balão ouvível volta à largura da coluna", () => {
    const ler = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
    const mobile = ler("web/mobile.css");
    const bloco = mobile.slice(mobile.indexOf("@media"), mobile.indexOf("\n}\n", mobile.indexOf("@media")));
    expect(bloco).toMatch(/\.message\.bot\.ouvivel \.bubble-wrap \{ max-width: calc\(100% - 36px\); \}/);
    expect(ler("web/index.html").indexOf("/mobile.css")).toBeGreaterThan(ler("web/index.html").indexOf("/interface.css"));
  });
});

describe("regressão da devolução do Revisor #381 (20/10): resposta curta e dica no celular (390 px)", () => {
  const ler = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  const blocoCelular = (): string => {
    const mobile = ler("web/mobile.css");
    return mobile.slice(mobile.indexOf("@media"), mobile.indexOf("\n}\n", mobile.indexOf("@media")));
  };

  // ALTO: numa resposta curta a barra ancorada à direita do balão saía pela esquerda (x -59..123): o Ouvir sumia da tela.
  it("na fala do bot a barra de ações cresce da esquerda, com e sem autor", () => {
    const bloco = blocoCelular();
    expect(bloco).toContain(".message.bot .msg-actions, .message.bot .bubble-wrap:has(> .msg-autor) > .msg-actions { left: 0; right: auto; }");
    // Vem depois da regra geral (right: 0), para ganhar também quando a especificidade empatar.
    expect(bloco.indexOf(".message.bot .msg-actions,")).toBeGreaterThan(bloco.indexOf(".message .msg-actions, .bubble-wrap:has(> .msg-autor) > .msg-actions { top: -12px; right: 0;"));
  });

  // MÉDIO: a dica "Desligue a ligação para ouvir" ficava com 76 px (uma palavra por linha).
  it("a dica do Ouvir tem a largura do texto, limitada à tela", () => {
    const regra = /\.ouvir-dica \{([^}]*)\}/.exec(blocoCelular())?.[1] ?? "";
    expect(regra).toContain("width: max-content;");
    expect(regra).toContain("max-width: calc(100vw - 24px);");
    expect(regra).toContain("left: 0;");
  });

  // MÉDIO (2ª devolução): com a ligação viva, o Ouvir desabilitado ficava translúcido (opacity .5, e sem fundo no toque)
  // por cima de "Nina 14:00". No celular ele fica opaco, com o fundo e a borda dos outros alvos.
  it("o Ouvir desabilitado fica opaco no celular, também no hover", () => {
    const bloco = blocoCelular();
    const sel = '.msg-actions button.bt[aria-disabled="true"], .msg-actions button.bt[aria-disabled="true"]:hover {';
    const regra = bloco.slice(bloco.indexOf(sel), bloco.indexOf("}", bloco.indexOf(sel)));
    expect(bloco).toContain(sel);
    for (const d of ["opacity: 1;", "color: var(--ink-3);", "background: var(--surface);", "border-color: var(--line);"]) expect(regra).toContain(d);
    // Vem depois da regra geral dos botões de 44 px.
    expect(bloco.indexOf(sel)).toBeGreaterThan(bloco.indexOf(".msg-actions button.bt { width: 44px;"));
    // No desktop o estado translúcido continua (estilos.css).
    expect(ler("web/estilos.css")).toContain('.msg-actions button.bt[aria-disabled="true"] { color: var(--ink-3); opacity: .5; cursor: not-allowed; }');
  });
});
