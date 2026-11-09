import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AcessoPedido } from "../../../src/contracts/acesso.ts";
import type { Rotina } from "../../../src/contracts/rotina.ts";
import { formaDaRevisao, revisaoDaRotina } from "../../../src/domain/revisao-rotina.ts";

/** NOD-159, critério 1: a revisão é determinística, só muda com os campos editáveis. */
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const GMAIL: AcessoPedido = { conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [] };
const SLACK: AcessoPedido = { conector: "slack", capacidades: ["SLACK_SEND_MESSAGE"], nivel: "escrita", naoPedido: ["SLACK_DELETE"] };

const ROTINA: Rotina = {
  tenantId: "t",
  id: "r",
  agenteId: "a",
  conversaId: "c",
  ownerId: "o",
  cron: "0 8 * * 1-5",
  fusoIana: "America/Sao_Paulo",
  instrucao: "poste aqui um resumo dos PRs abertos",
  fonte: "PRs abertos do time nod",
  entregavel: "mensagem na conversa",
  limitesAprovacao: "nada sai sem aprovação",
  politicaSemDado: "avise que não há PR",
  exigeAprovacao: true,
  estado: "ativa",
  proximaExecucao: 1_000,
  criadoEm: 500,
  excluidoEm: null,
  acessos: [GMAIL, SLACK],
  gatilho: "horario",
  provedor: null,
  eventos: null,
};
const rev = (r: Rotina) => revisaoDaRotina(r, sha256);

describe("revisaoDaRotina", () => {
  it("é determinística: mesma rotina, mesmo hash (sha256 em hex)", () => {
    expect(rev(ROTINA)).toBe(rev({ ...ROTINA }));
    expect(rev(ROTINA)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("acessos em outra ordem (lista e capacidades) dão o mesmo hash", () => {
    const invertido: Rotina = { ...ROTINA, acessos: [SLACK, { ...GMAIL, capacidades: [...GMAIL.capacidades].reverse() }] };
    expect(rev(invertido)).toBe(rev(ROTINA));
  });

  it("a ordem das chaves do objeto não muda o texto canônico", () => {
    const { cron, ...resto } = ROTINA;
    expect(formaDaRevisao({ ...resto, cron })).toBe(formaDaRevisao(ROTINA));
  });

  it.each([
    ["cron", { cron: "0 9 * * 1-5" }],
    ["fusoIana", { fusoIana: "Europe/Lisbon" }],
    ["instrucao", { instrucao: "resumir só os PRs meus" }],
    ["fonte", { fonte: "PRs do Marlon" }],
    ["entregavel", { entregavel: "e-mail" }],
    ["limitesAprovacao", { limitesAprovacao: "pode postar sem aprovação" }],
    ["politicaSemDado", { politicaSemDado: "fique em silêncio" }],
    ["acessos (sai um app)", { acessos: [GMAIL] }],
    ["acessos (nulo, rotina sem declaração)", { acessos: null }],
    ["acessos (nível)", { acessos: [{ ...GMAIL, nivel: "escrita" as const }, SLACK] }],
  ] satisfies [string, Partial<Rotina>][])("muda quando muda %s", (_campo, mudanca) => {
    expect(rev({ ...ROTINA, ...mudanca })).not.toBe(rev(ROTINA));
  });

  it("NÃO muda com estado, proximaExecucao, criadoEm, excluidoEm nem ids: pausar ou o tick não invalidam o card", () => {
    expect(rev({ ...ROTINA, estado: "pausada", proximaExecucao: 9_999, criadoEm: 1, excluidoEm: 7, exigeAprovacao: false, id: "x", tenantId: "y" })).toBe(rev(ROTINA));
  });
});
