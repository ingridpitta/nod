import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { AnexoMeta } from "../../../src/contracts/anexo.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { hora } from "../../../web/lib/render.ts";
import { htmlCapturaAmpliada, renderMensagem } from "../../../web/telas/conversa.ts";

/** NOD-56: a tela do computador ao fim do turno, no transcript (protótipo do Gil, plano de engenharia da Ada). */

const C = "c1";
const CRIADO = Date.parse("2026-10-16T14:07:00Z");
const PNG: AnexoMeta = { id: "an1", nome: "tela-1407.png", mime: "image/png", tamanho: 1234 };
const ROTA = `/api/t/t/conversas/${C}/anexos/an1`;

const msg = (autor: "pessoa" | "agente", extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id: "m1", conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto: "Preenchi o formulário.", payload: null, confianca: "confiavel", parcial: false, criadoEm: CRIADO, ...extra,
} as Mensagem);

function estado(): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: CRIADO });
  return { ...base, agora: CRIADO, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never };
}

describe("NOD-56 · captura da tela do bot no transcript", () => {
  it("fala do bot com anexo png mostra a miniatura abaixo do balão com legenda hh:mm", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), estado());
    expect(html).toContain('<figure class="msg-captura">');
    expect(html).toContain(`Tela do computador ao fim do turno · ${hora(CRIADO)}`);
    expect(html).toContain('width="240" height="150"');
    expect(html).toContain('data-act="ampliar-captura"');
    expect(html).toContain('aria-label="Ampliar tela do computador ao fim do turno"');
    expect(html).toContain('alt="Tela do computador de Ada ao fim do turno"');
    expect(html).toContain(`data-legenda="Tela do computador de Ada ao fim do turno · ${hora(CRIADO)}"`);
    // abaixo do balão: a figura vem depois do fim do .bubble
    expect(html.indexOf('class="msg-captura"')).toBeGreaterThan(html.indexOf('class="bubble"'));
  });

  it("fala do bot sem anexo sai idêntica a hoje", () => {
    const e = estado();
    const sem = renderMensagem(msg("agente"), e);
    expect(sem).not.toContain("msg-captura");
    expect(sem).not.toContain("msg-anexos");
    expect(renderMensagem(msg("agente", { anexos: [] }), e)).toBe(sem);
  });

  it("mensagem da pessoa com imagem continua em msg-anexos acima do balão", () => {
    const html = renderMensagem(msg("pessoa", { anexos: [PNG] }), estado());
    expect(html).toContain('class="msg-anexos"');
    expect(html).not.toContain("msg-captura");
    expect(html.indexOf('class="msg-anexos"')).toBeLessThan(html.indexOf('class="bubble"'));
  });

  it("a miniatura aponta para a rota de anexos da conversa e não vira chip de arquivo", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), estado());
    expect(html).toContain(`data-src="${ROTA}"`);
    expect(html).toContain(`<img src="${ROTA}"`);
    expect(html).not.toContain("msg-anexos");
    expect(html).not.toContain("msg-anexo-img");
  });

  it("mais de uma imagem no bot: só a primeira vira miniatura", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG, { ...PNG, id: "an2" }] }), estado());
    expect(html.match(/class="msg-captura"/g)).toHaveLength(1);
    expect(html).not.toContain("anexos/an2");
  });

  it("anexo que não é imagem no bot vira card de arquivo com prévia (NOD-327)", () => {
    const html = renderMensagem(msg("agente", { anexos: [{ id: "d", nome: "r.pdf", mime: "application/pdf", tamanho: 10 }] }), estado());
    expect(html).toContain('class="msg-arquivo"');
    expect(html).toContain('data-act="previa-arquivo" data-id="d"');
    expect(html).toContain(`data-url="/api/t/t/conversas/${C}/anexos/d"`);
    expect(html).toContain('class="arq-ic arq-pdf"');
    expect(html).toContain('download="r.pdf"');
    expect(html).not.toContain("msg-captura");
  });

  // QA do PR #371 (Teodora, 2026-10-16): mutações que sobreviviam à suíte acima.
  it("o nome do bot sai escapado na legenda ampliada e no alt", () => {
    const e = estado();
    const comNomeHostil = { ...e, frota: { agentes: [{ id: "a", nome: 'Ada "<b>x</b>', conversaId: C, cor: "blue", forma: "square" }] } } as never;
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), comNomeHostil);
    expect(html).toContain(`data-legenda="Tela do computador de Ada &quot;&lt;b&gt;x&lt;/b&gt; ao fim do turno · ${hora(CRIADO)}"`);
    expect(html).toContain('alt="Tela do computador de Ada &quot;&lt;b&gt;x&lt;/b&gt; ao fim do turno"');
    expect(html).not.toContain("<b>x</b>");
  });

  it("bot sem nome conhecido: a captura diz 'do bot'", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), { ...estado(), frota: { agentes: [] } } as never);
    expect(html).toContain('alt="Tela do computador do bot ao fim do turno"');
  });

  it("sem sessão (tenant) não há rota: nenhuma miniatura", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), { ...estado(), sessao: null } as never);
    expect(html).not.toContain("msg-captura");
    expect(html).not.toContain("/anexos/");
  });

  it("a miniatura anuncia o dialog e carrega preguiçosa", () => {
    const html = renderMensagem(msg("agente", { anexos: [PNG] }), estado());
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('loading="lazy"');
  });

  it("a ampliação mostra a imagem e o 'Abrir em nova aba' pela mesma rota, com o texto escapado", () => {
    const html = htmlCapturaAmpliada(ROTA, "Tela <b>x</b>");
    expect(html).toContain(`<img src="${ROTA}" alt="Tela &lt;b&gt;x&lt;/b&gt;"`);
    expect(html).toContain(`<a href="${ROTA}" target="_blank" rel="noopener">Abrir em nova aba</a>`);
    expect(html).toContain('data-captura="fechar"');
    expect(html).not.toContain("<b>x</b>");
  });
});
