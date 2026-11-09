import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { PayloadRotinaRitmo } from "../../../src/contracts/rotina-ritmo.ts";
import { cartaoRitmoRotina } from "../../../web/telas/ritmo-rotina.ts";

/** definido em 2026-10-23 (NOD-313): o card de ritmo da rotina na conversa — aberto, resolvido e invalidado. */
const ROTINA = "aaaaaaaa-0000-4000-8000-000000000001";
const CONVERSA = "bbbbbbbb-0000-4000-8000-000000000001";
const MSG = "cccccccc-0000-4000-8000-000000000001";

const card = (p: Partial<PayloadRotinaRitmo> = {}, texto = "A rotina “PRs <b>” rodou 20 vezes seguidas sem novidade."): Mensagem => ({
  tenantId: "t",
  id: MSG,
  conversaId: CONVERSA,
  turnoId: null,
  autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:ritmo-rotina", regra_versao: 1 },
  kind: "sistema",
  texto,
  payload: {
    kind: "rotina_ritmo",
    rotinaId: ROTINA,
    nome: "PRs <b>",
    seguidas: 20,
    hoje: "a cada 30 min",
    cronAtual: "*/30 * * * *",
    espacar: { cron: "0 */2 * * *", rotulo: "a cada 2 h" },
    uteis: { cron: "*/30 8,9,10,11,12,13,14,15,16,17,18 * * 1-5", fusoIana: "America/Sao_Paulo" },
    decisao: null,
    ...p,
  },
  confianca: "confiavel",
  criadoEm: 0,
  parcial: false,
});

describe("card de ritmo da rotina (NOD-313)", () => {
  it("aberto: título, hoje, e as 4 pílulas vazadas na ordem do esboço, com os dados do clique", () => {
    const html = cartaoRitmoRotina(card())!;
    expect(html).toContain('class="ritmo-card"');
    expect(html).not.toContain("msg-linha");
    expect(html).toContain("A rotina <b>PRs &lt;b&gt;</b> rodou 20 vezes seguidas sem novidade");
    expect(html).toContain("Hoje: a cada 30 min. Quer ajustar?");
    const rotulos = [...html.matchAll(/class="ritmo-pilula"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(rotulos).toEqual(["Espaçar para cada 2 h", "Só dias úteis 8h–19h", "Pausar", "Deixar como está"]);
    expect(html).toContain(`data-act="ritmo-rotina" data-opcao="espacar" data-rotina="${ROTINA}" data-mensagem="${MSG}" data-conversa="${CONVERSA}"`);
    // Nada de fundo colorido nem botão cheio (o pedido de design): sem as classes de aviso nem .bt.pri.
    expect(html).not.toMatch(/tom-|bt pri|aviso-estado/);
  });

  it("sem opção que se aplique (já diária, já em dias úteis), só Pausar e Deixar", () => {
    const html = cartaoRitmoRotina(card({ espacar: null, uteis: null, hoje: "uma vez por dia" }))!;
    expect([...html.matchAll(/data-opcao="(\w+)"/g)].map((m) => m[1])).toEqual(["pausar", "deixar"]);
  });

  it("resolvido: vira uma linha com ✓ e desfazer (Deixar não tem desfazer)", () => {
    const espacada = cartaoRitmoRotina(card({ decisao: { opcao: "espacar", em: 1, desfazivel: true } }))!;
    expect(espacada).toContain("✓ “PRs &lt;b&gt;” espaçada para cada 2 h · <button");
    expect(espacada).toContain('data-opcao="desfazer"');
    expect(espacada).not.toContain("ritmo-pilula");
    const deixada = cartaoRitmoRotina(card({ decisao: { opcao: "deixar", em: 1, desfazivel: false } }))!;
    expect(deixada).toContain("segue como está · não pergunto de novo por 30 dias");
    expect(deixada).not.toContain("desfazer");
  });

  it("invalidado: mostra o texto do servidor, sem botões", () => {
    const html = cartaoRitmoRotina(card({ invalida: true }, "A rotina “X” mudou desde esta sugestão; nada foi alterado."))!;
    expect(html).toContain("mudou desde esta sugestão");
    expect(html).not.toContain("<button");
  });

  it("outra mensagem não é o card", () => {
    expect(cartaoRitmoRotina({ ...card(), payload: null })).toBeNull();
  });
});
