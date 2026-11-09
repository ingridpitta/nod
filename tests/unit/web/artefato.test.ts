import { describe, expect, it } from "vitest";
import { ESTADO_MAX_BYTES_ARTEFATO } from "../../../src/contracts/artefato.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ALTURA_MAX, ALTURA_MIN, CSP_ARTEFATO, documentoDoArtefato, ESTADO_MAX_BYTES, iframeDoArtefato, jsonParaScript, lerMensagemDoArtefato, nomeDoArquivo, SANDBOX_ARTEFATO } from "../../../web/lib/artefato.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * Artefato do nod na web (ADR-051): o HTML do bot é não confiável. Estes testes provam, sem DOM, as três
 * cercas: iframe só com allow-scripts (nunca allow-same-origin), CSP sem rede no topo do documento e o
 * filtro do postMessage pela janela do próprio iframe.
 */
const AGORA = Date.parse("2026-09-28T12:00:00Z");

function mensagem(id: string, versao: number, extra: Partial<Mensagem> = {}): Mensagem {
  return {
    tenantId: "t", id, conversaId: "c", turnoId: "tu", kind: "artefato", texto: `Artefato «Checklist» publicado (v${versao}) · artefato_id art-1`,
    payload: { kind: "artefato", artefatoId: "art-1", versao, titulo: "Checklist <do dia>" }, confianca: "confiavel", parcial: false, criadoEm: AGORA,
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 },
    ...extra,
  };
}
function estadoCom(mensagens: Mensagem[]): Estado {
  const c: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
  return { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, conversas: { c }, frota: { agentes: [{ id: "a", nome: "Ada", ownerId: "p", conversaId: "c" }] } as never };
}

describe("iframe do artefato", () => {
  it("sandbox é SÓ allow-scripts: nada de allow-same-origin, popups, forms ou top-navigation", () => {
    const html = iframeDoArtefato({ documento: documentoDoArtefato("<p>oi</p>", null), titulo: "T", chave: "m1", altura: 400 });
    expect(SANDBOX_ARTEFATO).toBe("allow-scripts");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toMatch(/allow-same-origin|allow-popups|allow-forms|allow-top-navigation|allow-modals/);
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('style="height:400px"');
    // O documento vai escapado no atributo: o HTML do bot não fecha o srcdoc nem vira marcação do nod.
    const hostil = iframeDoArtefato({ documento: documentoDoArtefato('"><script>alert(1)</script>', null), titulo: 'x" onload="y', chave: "m1" });
    expect(hostil).not.toContain('"><script>');
    expect(hostil).not.toContain('onload="y');
    expect(hostil.match(/<iframe /g)).toHaveLength(1);
  });

  it("o documento abre com a CSP sem rede e a ponte ANTES do HTML do bot", () => {
    const doc = documentoDoArtefato('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><p id="bot">oi</p></body></html>', { a: 1 });
    expect(CSP_ARTEFATO).toContain("default-src 'none'");
    expect(CSP_ARTEFATO).toContain("script-src 'unsafe-inline'");
    expect(CSP_ARTEFATO).toContain("img-src data:");
    expect(CSP_ARTEFATO).not.toMatch(/https?:|\*|connect-src/);
    const csp = doc.indexOf('http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;');
    expect(csp).toBeGreaterThan(-1);
    expect(doc.indexOf("<head>")).toBeLessThan(csp);
    expect(csp).toBeLessThan(doc.indexOf("window.parent"));
    expect(doc.indexOf("window.parent")).toBeLessThan(doc.indexOf('<p id="bot">'));
    expect(doc.indexOf("</head>")).toBeLessThan(doc.indexOf('<p id="bot">'));
    expect(doc).toContain('x-dns-prefetch-control" content="off"');
    expect(doc).toContain('var atual={"a":1}');
    // Link que sairia da página é inerte (a navegação por script é fechada pelo pai no 2º load).
    expect(doc).toContain('closest("a[href]")');
  });

  it("o estado entra no <script> sem poder fechá-lo", () => {
    expect(jsonParaScript({ t: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(JSON.parse(jsonParaScript({ t: "</script>" }))).toEqual({ t: "</script>" });
    expect(jsonParaScript(undefined)).toBe("null");
  });

  it("os números batem com o contrato (a web só importa tipos de src)", () => {
    expect(ESTADO_MAX_BYTES).toBe(ESTADO_MAX_BYTES_ARTEFATO);
  });
});

describe("filtro do postMessage", () => {
  const janela = { nome: "a janela deste iframe" };
  const ev = (data: unknown, source: unknown = janela, origin = "null") => ({ data, source, origin });

  it("aceita estado e altura SÓ da janela do próprio iframe e da origem opaca do sandbox", () => {
    expect(lerMensagemDoArtefato(ev({ nod: "estado", dados: { a: true } }), janela)).toEqual({ tipo: "estado", dados: { a: true }, json: '{"a":true}' });
    expect(lerMensagemDoArtefato(ev({ nod: "estado", dados: { a: true } }, { outra: true }), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "estado", dados: { a: true } }, null), null)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "estado", dados: { a: true } }, janela, "https://evil.example"), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "estado", dados: { a: true } }, janela, "http://127.0.0.1:5274"), janela)).toBeNull();
  });

  it("recusa forma errada e estado acima de 64 KB; a altura é presa entre o mínimo e o máximo", () => {
    expect(lerMensagemDoArtefato(ev("texto"), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev([1]), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "outra" }), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "estado" }), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "estado", dados: "é".repeat(40_000) }), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "altura", px: "300" }), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "altura", px: Number.NaN }), janela)).toBeNull();
    expect(lerMensagemDoArtefato(ev({ nod: "altura", px: 5 }), janela)).toEqual({ tipo: "altura", px: ALTURA_MIN });
    expect(lerMensagemDoArtefato(ev({ nod: "altura", px: 99_999 }), janela)).toEqual({ tipo: "altura", px: ALTURA_MAX });
    expect(lerMensagemDoArtefato(ev({ nod: "altura", px: 640.4 }), janela)).toEqual({ tipo: "altura", px: 640 });
  });
});

describe("card do artefato na conversa", () => {
  it("cabeçalho ▣ título · vN · hora, Tela cheia, Baixar .html e um slot vazio (o iframe entra depois do render)", () => {
    const html = renderTimeline(estadoCom([mensagem("m1", 1)]).conversas.c ?? null, estadoCom([mensagem("m1", 1)]));
    expect(html).toContain('data-artefato="art-1"');
    expect(html).toContain("▣");
    expect(html).toContain("Checklist &lt;do dia&gt;");
    expect(html).toContain('<span class="artefato-meta">v1</span>');
    expect(html).toContain('data-act="artefato-tela-cheia"');
    expect(html).toContain('data-act="artefato-baixar"');
    expect(html).toContain('<div class="artefato-corpo" data-artefato-slot="m1"></div>');
    // O HTML do bot nunca entra na timeline: só por GET e dentro do iframe.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("artefato_id art-1");
  });

  it("a versão anterior fica recolhida quando a nova chega; não confiável leva a marca", () => {
    const e = estadoCom([mensagem("m1", 1), mensagem("m2", 2, { confianca: "nao_confiavel" })]);
    const html = renderTimeline(e.conversas.c ?? null, e);
    expect(html).toContain('data-disclosure="artefato-m1"');
    expect(html).toContain("Versão anterior · a atual é a v2");
    expect(html).not.toContain('data-disclosure="artefato-m2"');
    expect(html.split("não confiável").length - 1).toBe(1);
  });

  it("baixar dá um nome de arquivo aceito pelo sistema", () => {
    expect(nomeDoArquivo('Checklist: dia 28/09 "urgente"')).toBe("Checklist- dia 28-09 -urgente-.html");
    expect(nomeDoArquivo("   ")).toBe("artefato.html");
  });
});
