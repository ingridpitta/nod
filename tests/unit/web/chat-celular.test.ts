import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type Estado, type TurnoVivo } from "../../../web/estado/reducer.ts";
import { CONSULTA_CELULAR } from "../../../web/lib/celular.ts";
import { htmlComposer, renderCabecalhoConversa, renderTimeline } from "../../../web/telas/conversa.ts";
import { controleDaFolha, linhasDoBot, linhasVisiveis, MS_TOQUE_DUPLO, renderFolhaMais, rotuloDoMais, toqueCedoDemais, travarToqueDuploEm } from "../../../web/telas/folha-mais.ts";
import { folgaDoTopo } from "../../../web/lib/rolagem-na-tela.ts";
import { tecladoAberto } from "../../../web/lib/gaveta-bots.ts";

/**
 * NOD-381 (protótipo nod-381, aprovado em 2026-10-27): o chat no celular — o topo flutuante com ‹ e a pílula, o campo em
 * pílula de três peças com a folha do +, os alvos de 44 px e os estados. O computador não muda: tudo o que é novo no
 * mobile.css mora na consulta do celular, e fora dela só há o que esconde as peças novas.
 */
const C = "c1";
const AGORA = Date.UTC(2026, 9, 27, 15, 0);
const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

function cenario(extra: Partial<Estado> = {}): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return {
    ...e,
    agora: AGORA,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
    frota: { agentes: [{ id: "a", nome: "Eng 1", conversaId: C, cor: "c-blue", forma: "shape-circle", ownerId: "p", harness: "auto", modelo: "auto", esforco: null }] } as never,
    ...extra,
  };
}
const vivo = (): Record<string, TurnoVivo> => ({ t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } });

/** O CSS de fora das consultas @media (o que vale no computador), com os blocos @media tirados. */
function foraDasConsultas(texto: string): string {
  let fora = "";
  let i = 0;
  while (i < texto.length) {
    const m = texto.indexOf("@media", i);
    if (m < 0) { fora += texto.slice(i); break; }
    fora += texto.slice(i, m);
    let j = texto.indexOf("{", m) + 1;
    for (let prof = 1; prof > 0; j++) prof += texto[j] === "{" ? 1 : texto[j] === "}" ? -1 : 0;
    i = j;
  }
  return fora.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("NOD-381: o topo da conversa", () => {
  it("a presença vai dentro da pílula só quando não é Disponível; o nome segue no mesmo lugar", () => {
    const livre = renderCabecalhoConversa(cenario(), "a");
    expect(livre).toContain('<span class="pilula-txt"><span class="pilula-nome">Eng 1</span></span>');
    expect(livre).not.toContain("pilula-presenca");
    const ocupado = renderCabecalhoConversa(cenario({ turnosVivos: vivo() }), "a");
    expect(ocupado).toContain('<span class="pilula-presenca" aria-hidden="true">Trabalhando</span>');
    // O aria-label continua dizendo tudo: a presença visível é só desenho.
    expect(ocupado).toContain('aria-label="Painel de Eng 1 · Trabalhando"');
  });

  it("no celular a faixa flutua sem tomar o toque, e a primeira mensagem começa abaixo da pílula (sa + 64)", () => {
    const m = css("mobile.css");
    expect(m).toMatch(/\.cabecalho\.cabecalho-pilula \{ position: absolute;[^}]*pointer-events: none;/);
    expect(m).toContain(".cabecalho.cabecalho-pilula > * { pointer-events: auto; }");
    expect(m).toMatch(/\.cabecalho\.cabecalho-pilula \.pilula-bot \{[^}]*height: 44px; max-width: min\(254px, 100%\);[^}]*border-radius: 22px;/);
    expect(m).toContain(".cabecalho.cabecalho-pilula ~ .timeline-wrap { padding-top: calc(env(safe-area-inset-top) + 64px);");
    expect(m).toMatch(/\.cabecalho\.cabecalho-pilula \.voltar-bots \{ position: absolute; left: max\(12px/);
  });
});

describe("NOD-381: o campo em pílula", () => {
  it("o + nasce na conversa própria e no campo que aceita anexo, antes do texto; a sala não ganha +", () => {
    const proprio = htmlComposer("Mensagem", [], { aprovacao: true, anexos: "tudo" as never });
    expect(proprio).toContain('class="box com-anexos com-modo com-mais"');
    expect(proprio).toContain('<button type="button" class="mais-campo" data-act="abrir-mais" aria-label="Anexar, modo e IA" aria-haspopup="menu" aria-expanded="false">');
    expect(proprio.indexOf('class="mais-campo"')).toBeLessThan(proprio.indexOf('id="composer-texto"'));
    // Os botões de antes continuam no DOM: o computador os usa e a folha chama o mesmo input de arquivo.
    expect(proprio).toContain('data-act="anexar"');
    expect(proprio).toContain('id="composer-arquivos"');
    expect(proprio).toContain('id="composer-modo"');
    expect(proprio).toContain('id="composer-ia"');
    const sala = htmlComposer("Mensagem", ["Eng 1"]);
    expect(sala).not.toContain("mais-campo");
    expect(sala).not.toContain("com-mais");
  });

  it("no celular clipe, modo e IA saem do campo; o texto cresce até 6 linhas de 22 px; um botão por vez na ponta", () => {
    const m = css("mobile.css");
    expect(m).toContain(".composer .box.com-mais > .clipe, .composer .box.com-mais > .modo-chip, .composer .box.com-mais > .seletor-ia { display: none; }");
    expect(m).toMatch(/\.composer textarea \{ min-height: 44px; max-height: calc\(6 \* 22px \+ 22px\);[^}]*line-height: 22px;/);
    expect(m).toMatch(/\.composer \.box \{ min-height: 46px;[^}]*border-radius: 23px;/);
    // Campo vazio com o ditado disponível: o mic, sem o Enviar. Com texto ou anexo, o mic sai; com o bot trabalhando e o
    // campo vazio ele fica ao lado do Parar (revisão 1: ditar enquanto o bot trabalha já existia).
    expect(m).toContain(".composer .box:not(.gravando):has(.mic:not([hidden])):has(textarea:placeholder-shown):not(:has(.anexos-fila:not([hidden]))) .send { display: none; }");
    expect(m).toContain(".composer .box:has(textarea:not(:placeholder-shown)) .mic, .composer .box:has(.anexos-fila:not([hidden])) .mic { display: none; }");
    expect(m).not.toContain(".parar-envio:not([hidden])) .mic");
    // O Parar nunca é escondido pelo CSS do celular (revisão do PR 1: ele fica alcançável enquanto o bot trabalha).
    for (const linha of m.split("\n")) if (/\.parar-envio(::after)?\s*(,|\{)/.test(linha)) expect(linha).not.toContain("display: none");
    // Enviar e Parar: 32 px de desenho, 44 de toque.
    expect(m).toContain(".composer .box:not(.gravando) .send::after, .composer .box:not(.gravando) .parar-envio::after { content: \"\"; position: absolute; inset: -6px; }");
    // Revisão 1: o Parar perdia a cascata para o `min-width: 44px` antigo (mesma especificidade, regra depois) e a caixa
    // pulava de 46 para 58 px. A regra dos 32 px tem de vencer a dos 44 para os dois botões.
    const regra32 = /\.composer \.box:not\(\.gravando\) \.send, \.composer \.box:not\(\.gravando\) \.parar-envio \{[^}]*width: 32px; min-width: 32px; height: 32px; min-height: 32px;/;
    expect(m).toMatch(regra32);
    // Com anexo, a fila sobe para a primeira linha e o + fica na linha do texto.
    expect(m).toContain(".composer .box .anexos-fila { order: -1; }");
  });
});

describe("NOD-381: a folha do +", () => {
  it("dona com anexo: Anexar, Modo de aprovação e IA, nessa ordem, com o valor de hoje embaixo", () => {
    const l = { anexar: true, modo: { valor: "Aprovar manualmente", atencao: false }, ia: "Auto · Opus" };
    expect(linhasVisiveis(l)).toEqual(["anexar", "modo", "ia"]);
    const html = renderFolhaMais(l);
    expect(html).toContain('role="menu"');
    const ordem = ["anexar", "modo", "ia"].map((q) => html.indexOf(`data-mais="${q}"`));
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(html).toContain("<b>Modo de aprovação</b><small>Aprovar manualmente</small>");
    expect(html).toContain("<b>IA</b><small>Auto · Opus</small>");
    expect(html).not.toContain("fm-atencao");
  });

  it("Ignorar todas as aprovações sai em --warning; bot de outra pessoa só tem Anexar; nada = folha vazia", () => {
    const total = renderFolhaMais({ anexar: false, modo: { valor: "Ignorar todas as aprovações", atencao: true }, ia: null });
    expect(total).toContain('<small class="fm-atencao">Ignorar todas as aprovações</small>');
    expect(total).not.toContain('data-mais="anexar"');
    expect(linhasVisiveis({ anexar: true, modo: null, ia: null })).toEqual(["anexar"]);
    expect(linhasVisiveis({ anexar: false, modo: null, ia: null })).toEqual([]);
  });

  it("o texto da folha é escapado", () => {
    expect(renderFolhaMais({ anexar: false, modo: null, ia: "<img onerror=x>" })).toContain("&lt;img onerror=x&gt;");
  });

  it("no celular a folha sobe da base em toda a largura, com linhas de 60 px", () => {
    const m = css("mobile.css");
    expect(m).toMatch(/dialog\.bot-menu\.folha-mais \{ inset: auto 0 0 0; width: 100%;/);
    expect(m).toMatch(/\.bot-menu\.folha-mais \.fm-linha \{[^}]*min-height: 60px;/);
  });
});

describe("NOD-381: alvos de 44 px e estados", () => {
  it("o ✕ do anexo, as frentes e as ações do artefato têm 44 px de toque", () => {
    const m = css("mobile.css");
    expect(m).toContain(".anexo-x::after { content: \"\"; position: absolute; inset: -11px; }");
    // A miniatura cortava o alvo do ✕ (overflow: hidden); no celular o corte fica só na foto.
    expect(m).toContain(".anexo-thumb { overflow: visible; }");
    expect(m).toContain(".pf-cab { min-height: 44px; }");
    expect(m).toContain(".pf-lista .progresso-item, .pf-item { min-height: 44px; }");
    expect(m).toContain(".pf-ver, .pf-parar { min-height: 44px; min-width: 44px; }");
    expect(m).toMatch(/\.artefato-acoes \.bt\.link, \.artefato-dialogo \.artefato-acoes \.bt\.sm \{ min-width: 44px; min-height: 44px; \}/);
  });

  it("carregando: o texto continua (leitor de tela e computador) e o esqueleto de três balões vem junto, escondido do leitor", () => {
    const html = renderTimeline(null, cenario());
    expect(html).toContain("carregando conversa…");
    expect(html).toMatch(/<div class="esqueleto-conversa" aria-hidden="true">(<i[^>]*><\/i>){3}<\/div>/);
  });

  it("não enviada no celular: o balão claro sem opacidade (NOD-431) e a linha em 13 px sem o vermelho", () => {
    const m = css("mobile.css");
    expect(m).toMatch(/\.fala-pendente\[data-envio="falhou"\] \.message\.you \.bubble \{ --balao-fundo: var\(--surface\); --balao-tinta: var\(--ink\); --balao-codigo: var\(--surface-raised\); border: 1px dashed var\(--line-strong\); background: var\(--surface\); color: var\(--ink\); \}/);
    expect(m).toContain(".fala-pendente .envio-erro { font-size: 13px; color: var(--ink-2); }");
  });
});

describe("NOD-381: o computador não muda", () => {
  it("fora da consulta do celular só há o que esconde as peças novas (e o que já existia)", () => {
    const fora = foraDasConsultas(css("mobile.css")).replace(/\s+/g, " ").trim();
    // NOD-379: os @keyframes da inicial ficam no topo (só rodam dentro da consulta) e o fundo da gaveta saiu com ela.
    expect(fora).toBe(
      "@keyframes inicio-chat-entra { from { transform: translateX(100%); box-shadow: -10px 0 30px rgba(0, 0, 0, .12); } to { transform: none; box-shadow: none; } } " +
      "@keyframes inicio-pulso { 0%, 100% { opacity: 1; } 50% { opacity: .55; } } " +
      "@keyframes inicio-segurar { from { transform: none; } to { transform: scale(1.02); } } " +
      "@keyframes inicio-folha { from { transform: translateY(100%); } to { transform: none; } } " +
      ".abrir-bots { display: none; } .cabecalho.so-menu { display: none; } " +
      ".mais-campo, .pilula-presenca, .esqueleto-conversa { display: none; } .pilula-txt { display: contents; } " +
      "@keyframes esqueleto-pulsa { 50% { opacity: .55; } } " +
      // NOD-449: o aviso do Desfazer sobe do pé no celular (só a consulta usa este nome).
      "@keyframes nl-sobe-c { from { opacity: 0; transform: translateY(8px); } }",
    );
  });

  it("toda consulta do mobile.css é a do celular", () => {
    for (const m of css("mobile.css").matchAll(/@media ([^{]+)\{/g)) expect(m[1]!.trim()).toBe(CONSULTA_CELULAR);
  });
});

describe("NOD-381 (revisão 1): a folha do + no main", () => {
  it("as linhas do bot: dona vê os três; colega só Anexar; o modo total sai em --warning; sem modo vale o manual", () => {
    expect(linhasDoBot({ temArquivo: true, dona: true, modo: undefined, ia: "Auto" })).toEqual({ anexar: true, modo: { valor: "Aprovar manualmente", atencao: false }, ia: "Auto" });
    expect(linhasDoBot({ temArquivo: false, dona: true, modo: "total", ia: null }).modo).toEqual({ valor: "Ignorar todas as aprovações", atencao: true });
    expect(linhasDoBot({ temArquivo: true, dona: false, modo: "total", ia: "Auto" })).toEqual({ anexar: true, modo: null, ia: null });
  });

  const fake = () => {
    const attrs: Record<string, string> = {};
    const feito: string[] = [];
    let valido = true;
    const mais = { setAttribute: (n: string, v: string) => { attrs[n] = v; } };
    const agir = { anexar: () => feito.push("anexar"), modo: () => feito.push("modo"), ia: () => feito.push("ia"), valido: () => valido };
    return { attrs, feito, mais, agir, invalidar: () => { valido = false; } };
  };

  it("Modo e IA abrem só depois que a folha fecha, e o + termina aberto (o menu é dele)", () => {
    const f = fake();
    const c = controleDaFolha(f.mais, f.agir);
    expect(f.attrs["aria-expanded"]).toBe("true");
    c.escolher("modo");
    expect(f.feito).toEqual([]);
    c.fechou();
    // A ordem é a que importa: primeiro o + volta a "false", depois o menu (que põe "true" no +) abre.
    expect(f.feito).toEqual(["modo"]);
    expect(f.attrs["aria-expanded"]).toBe("false");
  });

  it("Anexar abre o arquivo no próprio toque (gesto da pessoa); fechar sem escolher não faz nada", () => {
    const f = fake();
    const c = controleDaFolha(f.mais, f.agir);
    c.escolher("anexar");
    expect(f.feito).toEqual(["anexar"]);
    c.fechou();
    expect(f.feito).toEqual(["anexar"]);
    const g = fake();
    controleDaFolha(g.mais, g.agir).fechou();
    expect(g.feito).toEqual([]);
    expect(g.attrs["aria-expanded"]).toBe("false");
  });

  it("a conversa trocou entre o toque e o fechar: nada abre no bot errado", () => {
    const f = fake();
    const c = controleDaFolha(f.mais, f.agir);
    c.escolher("ia");
    f.invalidar();
    c.fechou();
    expect(f.feito).toEqual([]);
  });
});

describe("NOD-381 (revisão 1): \"ir para as novas\" não para embaixo do topo", () => {
  it("usa o scroll-padding-top da caixa (o topo flutuante) e, sem ele, os 12 px de sempre", () => {
    const original = globalThis.getComputedStyle;
    try {
      globalThis.getComputedStyle = (() => ({ scrollPaddingTop: "111px" })) as never;
      expect(folgaDoTopo({} as Element)).toBe(111);
      globalThis.getComputedStyle = (() => ({ scrollPaddingTop: "auto" })) as never;
      expect(folgaDoTopo({} as Element)).toBe(12);
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it("a linha do computador do bot fica na base da pílula, não na do véu", () => {
    expect(css("mobile.css")).toContain(".cabecalho.cabecalho-pilula .pilula-bot:has(> .cb-fio) { position: relative; }");
  });
});

describe("NOD-381 (revisão 2)", () => {
  const m = css("mobile.css");
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");

  it("modo total: o + avisa em --warning (o chip do modo saiu do campo) e o rótulo diz o modo", () => {
    expect(m).toContain(".composer .mais-campo[data-atencao] { position: relative; color: var(--warning); }");
    expect(rotuloDoMais(linhasDoBot({ temArquivo: true, dona: true, modo: "total", ia: "Auto" }))).toBe("Anexar, modo e IA · Ignorar todas as aprovações");
    expect(rotuloDoMais(linhasDoBot({ temArquivo: true, dona: true, modo: "manual", ia: "Auto" }))).toBe("Anexar, modo e IA");
    expect(rotuloDoMais(linhasDoBot({ temArquivo: true, dona: false, modo: "total", ia: null }))).toBe("Anexar");
    expect(main).toMatch(/toggleAttribute\("data-atencao", atencao\)/);
  });

  it("✕ de 20 px da miniatura com alvo de 44 (20 + 2 × 12)", () => {
    expect(m).toContain(".anexo-thumb .anexo-x::after { inset: -12px; }");
  });

  it("NOD-354 (QA): o toque do Parar fora do ditado tem 44 px — o ::after conta a borda de 1 px (32 − 2 + 2 × 7)", () => {
    const m = readFileSync("web/mobile.css", "utf8");
    expect(m).toContain(".composer .box:not(.gravando) .parar-envio::after { inset: -7px; }");
    expect(readFileSync("web/interface.css", "utf8")).toMatch(/\.composer \.parar-envio \{[^}]*border: 1px solid/);
  });

  it("NOD-354: gravando o ditado, o Parar do bot segue à vista (é o único Parar da conversa), em âmbar e com 44 px", () => {
    const m = readFileSync("web/mobile.css", "utf8");
    const gravando = m.split("\n").filter((l) => l.includes(".box.gravando") && l.includes("display: none"));
    // Toda regra que esconde peças no modo gravando poupa o Parar (seletor genérico com :not) e nenhuma o cita direto.
    for (const linha of gravando) {
      if (/>\s*:not\(/.test(linha)) expect(linha).toContain(":not(.parar-envio)");
      expect(linha).not.toMatch(/\.parar-envio\s*(,|\{)/);
    }
    expect(m).toMatch(/\.composer \.box\.gravando \.parar-envio \{[^}]*width: 44px; min-width: 44px; height: 44px; min-height: 44px;[^}]*color: var\(--warning\)/);
    // O ■ do ditado e o Enviar não caem abaixo de 44 px com o Parar na linha (320 px).
    expect(m).toContain(".composer .box.gravando .ditado-parar, .composer .box.gravando .send { min-width: 44px; }");
  });

  it("Parar e Enviar lado a lado sem alvos sobrepostos", () => {
    expect(m).not.toContain(".parar-envio + .send { margin-left: 0; }");
  });

  it("Anexar: a folha fecha antes do clique no input (com o modal aberto ele fica inerte)", () => {
    expect(main).toContain('if (escolha === "anexar") { d.close(); controle.escolher(escolha); } else { controle.escolher(escolha); d.close(); }');
  });

  it("com erro na tela, a lista não ganha folga dobrada (há avisos sr-only entre o #erro e a lista)", () => {
    expect(m).toContain(".cabecalho.cabecalho-pilula + #erro:not(:empty) ~ .timeline-wrap { padding-top: 12px; scroll-padding-top: 12px; }");
  });

  it("sem o + (folha vazia), o texto não encosta na borda; a caixa fica 8 px acima da área segura", () => {
    expect(m).toContain(".composer .box:not(.com-mais), .composer .box:has(> .mais-campo[hidden]) { padding-left: 14px; }");
    expect(m).toContain("calc(env(safe-area-inset-bottom) + 8px)");
  });
});

describe("NOD-381 (revisão 3)", () => {
  const m = css("mobile.css");
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  const gaveta = readFileSync(new URL("../../../web/lib/gaveta-bots.ts", import.meta.url), "utf8");

  it("toque duplo: o 2º toque no menu aberto pela folha não escolhe nada; o teclado sempre vale", () => {
    expect(toqueCedoDemais(120, 1)).toBe(true);
    expect(toqueCedoDemais(MS_TOQUE_DUPLO - 1, 2)).toBe(true);
    expect(toqueCedoDemais(MS_TOQUE_DUPLO, 1)).toBe(false);
    expect(toqueCedoDemais(10, 0)).toBe(false);
    // Os dois menus abertos pela folha ganham a trava (e só eles: o chip e o seletor do computador não passam por aqui).
    expect(main).toContain("modo: () => { abrirModoAprovacao(el); travarToqueDuplo(); },");
    expect(main).toContain("ia: () => { abrirSeletorIa(el); travarToqueDuplo(); },");
    expect(main).toContain("if (d) travarToqueDuploEm(d);");
  });

  it("com anexo, o resumo sai da linha do texto (o campo mantém os 60%)", () => {
    expect(m).toContain(".composer .box.com-mais .anexos-resumo { order: -1; flex-basis: 100%; padding: 4px 6px 0; }");
  });

  it("com o teclado aberto, a caixa fica 8 px acima dele", () => {
    expect(m).toContain("html.teclado-aberto .cabecalho-pilula ~ .composer-wrap, html.teclado-aberto .composer-wrap { padding-bottom: 8px; }");
    expect(gaveta).toContain('classList.toggle("teclado-aberto", tecladoAberto(area.altura, document.documentElement.clientHeight, document.activeElement))');
    // Revisão 4: mede contra a viewport de layout (que o teclado não encolhe) e só com um campo de texto em foco.
    expect(tecladoAberto(508, 844, { tagName: "TEXTAREA" })).toBe(true);
    expect(tecladoAberto(800, 844, { tagName: "TEXTAREA" })).toBe(false);
    expect(tecladoAberto(508, 844, { tagName: "BUTTON" })).toBe(false);
    expect(tecladoAberto(508, 844, null)).toBe(false);
    expect(tecladoAberto(508, 844, { tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(gaveta).toContain('classList.remove("teclado-aberto")');
  });
});

describe("NOD-381 (revisão 4)", () => {
  it("com anexo, o + e a ponta ficam embaixo quando o texto cresce (a .com-anexos do computador centraliza)", () => {
    expect(css("mobile.css")).toContain(".composer .box.com-anexos { padding-left: 1px; align-items: flex-end; }");
  });
});

describe("NOD-381 (revisão 5): o aviso do modo total vale para o colega também (ADR-059)", () => {
  const m = css("mobile.css");
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");

  it("o + avisa pelo modo do bot, não por quem é a dona; sem o +, o chip do total volta ao campo", () => {
    expect(main).toContain('const atencao = t.tipo === "conversa" && botGerido(t.agenteId)?.modoAprovacao === "total";');
    expect(rotuloDoMais(linhasDoBot({ temArquivo: true, dona: false, modo: "total", ia: null }), true)).toBe("Anexar · Ignorar todas as aprovações");
    expect(m).toContain('.composer .box.com-mais:has(> .mais-campo[hidden]) > .modo-chip[data-modo="total"] { display: inline-grid; width: 44px; height: 44px; }');
  });

  it("o padding do campo do celular vence o .com-modo do computador; ícones da folha no tamanho do protótipo", () => {
    expect(m).toContain(".composer .box.com-mais { padding-left: 1px; }");
    expect(m).toContain(".composer .box.com-mais textarea { padding-left: 4px; }");
    expect(m).toContain(".bot-menu.folha-mais .fm-ic { width: 20px; height: 20px; }");
  });
});

describe("NOD-381 (QA)", () => {
  const m = css("mobile.css");

  it("a trava de verdade: o 2º toque logo depois é engolido; depois de 500 ms ou pelo teclado, passa", () => {
    let relogio = 1000;
    let ouvinte: ((e: { detail: number; preventDefault(): void; stopImmediatePropagation(): void }) => void) | null = null;
    let captura = false;
    travarToqueDuploEm({ addEventListener: (_t, f, o) => { ouvinte = f; captura = o.capture; } }, () => relogio);
    expect(captura).toBe(true);
    const clique = (detail: number) => {
      const r = { parou: false };
      ouvinte!({ detail, preventDefault: () => undefined, stopImmediatePropagation: () => { r.parou = true; } });
      return r.parou;
    };
    relogio = 1120;
    expect(clique(2)).toBe(true);
    expect(clique(0)).toBe(false);
    relogio = 1000 + MS_TOQUE_DUPLO;
    expect(clique(1)).toBe(false);
  });

  it("Anexar não abre o arquivo se a conversa já trocou antes do toque", () => {
    const feito: string[] = [];
    const c = controleDaFolha({ setAttribute: () => undefined }, { anexar: () => feito.push("anexar"), modo: () => feito.push("modo"), ia: () => feito.push("ia"), valido: () => false });
    c.escolher("anexar");
    c.fechou();
    expect(feito).toEqual([]);
  });

  it("modo total: o + tem o ponto âmbar, não só a cor", () => {
    expect(m).toContain('.composer .mais-campo[data-atencao]::after { content: ""; position: absolute; top: 9px; right: 9px; width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }');
  });

  it("alvos de 44 no painel de frentes (Parar tinha 31 de largura; o chip, 42 de altura) e a pílula sem o ponto de presença", () => {
    expect(m).toContain(".pf-ver, .pf-parar { min-height: 44px; min-width: 44px; }");
    expect(m).toContain(".pf-botao { min-height: 44px; }");
    expect(m).toContain(".cabecalho.cabecalho-pilula .pilula-bot .presenca { display: none; }");
  });
});
