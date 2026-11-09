import { describe, expect, it } from "vitest";
import type { CheckpointDaFala } from "../../../src/contracts/checkpoint.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { hora } from "../../../web/lib/render.ts";
import { htmlMenuDaFala, itensDoMenu } from "../../../web/telas/acoes-da-fala.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { cartaoDoDesfazer, desfazerDaFala, itemDoDesfazer, nomeEPasta, podeAbrirCartao, resumoDoResultado } from "../../../web/telas/desfazer.ts";

/** NOD-54 (ADR-134; protótipo nod-54): o item no ⋯, o cartão de confirmação e a linha de progresso, resultado ou falha. */
const AGORA = Date.parse("2026-10-28T14:40:00Z");
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const ARQ = [
  { caminho: "~/nod/Teo/site/index.html", acao: "mudado" as const },
  { caminho: "~/nod/Teo/site/contato.html", acao: "criado" as const },
  { caminho: "~/nod/Teo/site/estilo.css", acao: "mudado" as const },
  { caminho: "~/nod/Teo/site/velho.html", acao: "apagado" as const },
];
const ck = (extra: Partial<CheckpointDaFala> = {}): CheckpointDaFala => ({ estado: "disponivel", arquivos: ARQ, total: 4, ...extra });

function msg(id: string, extra: Partial<Mensagem> = {}): Mensagem {
  return { tenantId: "t", id, conversaId: "c", turnoId: `t-${id}`, autoria, kind: "texto", texto: "Pronto, mudei o site.", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 8 * 60_000, ...extra };
}
const teo = { id: "a", tenantId: "t", ownerId: "p", nome: "Téo", titulo: "", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;

function cenario(mensagens: Mensagem[], p: { tela?: Estado["tela"]; aberto?: string } = {}): Estado {
  const conversa = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], reacoes: [], carregadaEm: 0 } as ConversaEstado;
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    tela: p.tela ?? { tipo: "conversa", conversaId: "c", agenteId: "a" },
    frota: { agentes: [teo], inventario: null, negacoes: [] } as never,
    conversas: { c: conversa }, modoDev: { ligado: false, raioX: {} }, desfazerAberto: p.aberto ?? null,
  };
}
const texto = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("o item do ⋯ (NOD-54)", () => {
  it("fala final com checkpoint: 'Desfazer 4 arquivos' por último, com divisor (dft-mi)", () => {
    const m = msg("m1", { checkpoint: ck() });
    const e = cenario([m]);
    expect(itensDoMenu(m, e).at(-1)).toMatchObject({ acao: "desfazer", texto: "Desfazer 4 arquivos", desabilitado: false });
    expect(htmlMenuDaFala(m, e)).toMatch(/data-fala="desfazer" class="dft-mi">/);
  });

  it("sem checkpoint, vencido, fala da pessoa, sala: nenhum item", () => {
    expect(itemDoDesfazer(msg("m1"), cenario([msg("m1")]))).toBeNull();
    const vencido = msg("m1", { checkpoint: ck({ estado: "vencido" }) });
    expect(itemDoDesfazer(vencido, cenario([vencido]))).toBeNull();
    const pessoa = msg("m1", { checkpoint: ck(), autoria: { ...autoria, autor_tipo: "pessoa", autor_id: "p" } });
    expect(itemDoDesfazer(pessoa, cenario([pessoa]))).toBeNull();
    const m = msg("m1", { checkpoint: ck() });
    expect(itemDoDesfazer(m, cenario([m], { tela: { tipo: "sala", salaId: "s" } as never }))).toBeNull();
  });

  it("desfazendo, desfeito e outro do bot desfazendo: apagado (aria-disabled), com o porquê", () => {
    const a = msg("m1", { checkpoint: ck({ estado: "desfazendo", feitos: 1 }) });
    expect(itemDoDesfazer(a, cenario([a]))).toEqual({ texto: "Desfazendo…", desabilitado: true });
    const b = msg("m1", { checkpoint: ck({ estado: "desfeito", desfeitoEm: AGORA }) });
    expect(itemDoDesfazer(b, cenario([b]))).toEqual({ texto: `Desfeito às ${hora(AGORA)}`, desabilitado: true });
    expect(htmlMenuDaFala(b, cenario([b]))).toContain('aria-disabled="true"');
    const outro = msg("m0", { checkpoint: ck({ estado: "desfazendo" }), criadoEm: AGORA - 60 * 60_000 });
    const c = msg("m1", { checkpoint: ck() });
    expect(itemDoDesfazer(c, cenario([outro, c]))).toEqual({ texto: `Esperando o desfazer das ${hora(outro.criadoEm)}`, desabilitado: true });
  });

  it("falhou: o item volta a valer (tentar pelo menu)", () => {
    const m = msg("m1", { checkpoint: ck({ estado: "falhou", falha: "erro" }) });
    expect(itemDoDesfazer(m, cenario([m]))?.desabilitado).toBe(false);
  });

  it("falhou: o item do menu abre o cartão de verdade (revisão M6), e o cartão toma o lugar da linha de falha", () => {
    const m = msg("m1", { checkpoint: ck({ estado: "falhou", falha: "erro" }) });
    expect(podeAbrirCartao(m, cenario([m]))).toBe(true);
    const html = desfazerDaFala(m, cenario([m], { aberto: "m1" }), "Téo");
    expect(html).toContain('data-desfazer-cartao="m1"');
    expect(html).not.toContain('role="alert"');
  });

  it("o cartão não abre desfazendo, desfeito, vencido ou com outra fala do bot desfazendo", () => {
    for (const estado of ["desfazendo", "desfeito", "vencido"] as const) {
      const m = msg("m1", { checkpoint: ck({ estado }) });
      expect(podeAbrirCartao(m, cenario([m]))).toBe(false);
    }
    const outro = msg("m0", { checkpoint: ck({ estado: "desfazendo" }) });
    const c = msg("m1", { checkpoint: ck() });
    expect(podeAbrirCartao(c, cenario([outro, c]))).toBe(false);
    expect(podeAbrirCartao(c, cenario([c]))).toBe(true);
  });
});

describe("o cartão (NOD-54)", () => {
  it("título com o bot e a hora, 5 arquivos e 'mais N', o que não volta, Cancelar e Desfazer", () => {
    const muitos = Array.from({ length: 8 }, (_, i) => ({ caminho: `~/nod/Teo/a${i}.md`, acao: "mudado" as const }));
    const m = msg("m1", { checkpoint: ck({ arquivos: muitos, total: 8 }) });
    const html = cartaoDoDesfazer(m, m.checkpoint!, "Téo");
    expect(html).toContain(`Desfazer o que Téo mudou às ${hora(m.criadoEm)}?`);
    expect(html).toMatch(/<h3 id="dft-t-m1" tabindex="-1">/);
    expect((html.match(/<b>a\d\.md<\/b>/g) ?? []).length).toBe(5);
    expect(texto(html)).toContain("e mais 3 arquivos");
    expect(texto(html)).toContain("Não volta: commit e push.");
    expect([...html.matchAll(/data-act="([^"]+)"/g)].map((x) => x[1])).toEqual(["desfazer-cancelar", "desfazer-confirmar"]);
    expect(texto(html)).toContain("Desfazer 8 arquivos");
  });

  it("nome em destaque e pasta em cinza; editou, criou, apagou", () => {
    expect(nomeEPasta("~/nod/Teo/site/index.html")).toEqual({ nome: "index.html", pasta: "~/nod/Teo/site" });
    const m = msg("m1", { checkpoint: ck() });
    const html = cartaoDoDesfazer(m, m.checkpoint!, "Téo");
    expect(texto(html)).toContain("index.html ~/nod/Teo/site editou");
    expect(texto(html)).toContain("contato.html ~/nod/Teo/site criou");
    expect(texto(html)).toContain("velho.html ~/nod/Teo/site apagou");
  });

  it("o caminho vem escapado (o nome do arquivo é dado da máquina)", () => {
    const m = msg("m1", { checkpoint: ck({ arquivos: [{ caminho: "~/nod/Teo/<img src=x onerror=alert(1)>.md", acao: "criado" }], total: 1 }) });
    expect(cartaoDoDesfazer(m, m.checkpoint!, "<b>")).not.toMatch(/<img|<b>mudou/);
  });

  it("abre só pelo estado e só com o checkpoint disponível; o reducer abre e fecha", () => {
    const m = msg("m1", { checkpoint: ck() });
    expect(desfazerDaFala(m, cenario([m]), "Téo")).toBe("");
    expect(desfazerDaFala(m, cenario([m], { aberto: "m1" }), "Téo")).toContain("dft-cartao");
    let e = reduzir(cenario([m]), { tipo: "desfazer-cartao", mensagemId: "m1" });
    expect(e.desfazerAberto).toBe("m1");
    e = reduzir(e, { tipo: "desfazer-cartao", mensagemId: null });
    expect(e.desfazerAberto).toBeNull();
  });

  it("a timeline desenha o cartão logo depois da fala", () => {
    const m = msg("m1", { checkpoint: ck() });
    const e = cenario([m], { aberto: "m1" });
    const html = renderTimeline(e.conversas.c ?? null, e);
    expect(html).toMatch(/data-mensagem="m1"[\s\S]*<\/article><section class="dft-cartao"/);
  });
});

describe("a linha embaixo da fala (NOD-54)", () => {
  it("desfazendo: role=status, 'Desfazendo… 2 de 4 arquivos'", () => {
    const m = msg("m1", { checkpoint: ck({ estado: "desfazendo", feitos: 2 }) });
    const html = desfazerDaFala(m, cenario([m], { aberto: "m1" }), "Téo");
    expect(html).toContain('role="status"');
    expect(texto(html)).toBe("Desfazendo… 2 de 4 arquivos");
    expect(html).not.toContain("dft-cartao");
  });

  it("desfeito: '↺ Desfeito às HH:MM · 4 arquivos voltaram · ver' e a lista", () => {
    const resultado = { arquivos: ARQ.map((a) => ({ caminho: a.caminho, desfecho: "voltou" as const })), contagem: { voltou: 4, mesclado: 0, conflito: 0, erro: 0 } };
    const m = msg("m1", { checkpoint: ck({ estado: "desfeito", desfeitoEm: AGORA, resultado }) });
    const html = desfazerDaFala(m, cenario([m]), "Téo");
    expect(html).toMatch(/^<details class="dft-linha dft-feito">/);
    expect(texto(html)).toContain(`Desfeito às ${hora(AGORA)} · 4 arquivos voltaram · ver`);
    expect(html).not.toContain("desfazer-forcar");
  });

  it("conflito: o arquivo destacado, a consequência e 'Voltar mesmo assim'", () => {
    const resultado = { arquivos: [{ caminho: "~/nod/Teo/site/estilo.css", desfecho: "conflito" as const }, { caminho: "~/nod/Teo/site/index.html", desfecho: "mesclado" as const }, { caminho: "~/nod/Teo/a", desfecho: "voltou" as const }], contagem: { voltou: 1, mesclado: 1, conflito: 1, erro: 0 } };
    const c = ck({ estado: "desfeito", desfeitoEm: AGORA, resultado });
    expect(resumoDoResultado(c)).toBe("2 arquivos voltaram, estilo.css ficou");
    const m = msg("m1", { checkpoint: c });
    const html = desfazerDaFala(m, cenario([m]), "Téo");
    expect(html).toContain('class="dft-conflito"');
    expect(texto(html)).toContain("ficou: mudou depois nas mesmas linhas");
    expect(texto(html)).toContain("voltou a parte deste turno");
    expect(html).toContain('data-act="desfazer-forcar"');
    expect(texto(html)).toContain("Voltar mesmo assim apaga também o que mudou depois");
  });

  it("resultado cortado: 'e mais N' pela contagem real", () => {
    const resultado = { arquivos: [{ caminho: "~/a", desfecho: "voltou" as const }], contagem: { voltou: 3, mesclado: 0, conflito: 0, erro: 0 } };
    const m = msg("m1", { checkpoint: ck({ estado: "desfeito", desfeitoEm: AGORA, resultado }) });
    expect(texto(desfazerDaFala(m, cenario([m]), "Téo"))).toContain("e mais 2 arquivos");
  });

  it("falhou: role=alert e 'Tentar de novo'", () => {
    const m = msg("m1", { checkpoint: ck({ estado: "falhou", falha: "erro" }) });
    const html = desfazerDaFala(m, cenario([m]), "Téo");
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-act="desfazer-tentar"');
  });

  it("a máquina já não tinha a cópia: a fala diz que não pode mais ser desfeito, sem botão (revisão 2, M3)", () => {
    const m = msg("m1", { checkpoint: ck({ estado: "vencido", falha: "sem_checkpoint" }) });
    const html = desfazerDaFala(m, cenario([m]), "Téo");
    expect(html).toContain("já não pode ser desfeito");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(itemDoDesfazer(m, cenario([m]))).toBeNull();
  });

  it("vencido ou fora da conversa própria: nada", () => {
    const m = msg("m1", { checkpoint: ck({ estado: "vencido" }) });
    expect(desfazerDaFala(m, cenario([m]), "Téo")).toBe("");
    const d = msg("m1", { checkpoint: ck({ estado: "desfazendo" }) });
    expect(desfazerDaFala(d, cenario([d], { tela: { tipo: "conversa", conversaId: "outra", agenteId: "a" } }), "Téo")).toBe("");
  });
});
