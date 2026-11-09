import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarNoServidor, decidirHook } from "../../src/adapters/executor/hook-nativas.ts";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { FRASE_ARQUIVO_DE_CREDENCIAL, NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { depsSobre, dentroEmMemoria, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AWS = "/Users/m/.aws/config";

/**
 * PR 6 dos modos de aprovação pela rota interna REAL `/nativas` e pelo hook de verdade (`decidirHook` +
 * `confirmarNoServidor`, sem o CLI): o arquivo de credencial vai ao servidor, que decide pelo modo e, quando libera, diz
 * isso explicitamente (`credencial: "permitida"`) — o hook não aceita o `{ ok: true }` cru. A trilha do que o total rodou
 * leva `regra:modo_total` na versão 2.
 */
describe("rota /interno/nativas com a credencial (PR 6)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const services = servicosDeTeste({ agora, tokens });
  const memoria = dentroEmMemoria({ services, agora });
  let srv: ServidorDeTeste | undefined;

  beforeAll(async () => {
    srv = await servidorDeTeste(rotasInternas({ dentro: memoria.dentro, tokens, agora, intervaloMs: 10, longpollMs: 50 }), { autorizarTokenTurno: tokens.autorizar });
  });
  afterAll(() => srv?.close());
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  async function turno(modo: ModoAprovacao) {
    const repos = memoria.repos(MARLON);
    const agente = await repos.agentes.criar({ nome: "Ze", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const agenteId = agente?.id ?? "";
    // NOD-316: o bot nasce em Automático; o manual também é definido.
    await repos.agentes.definirModoAprovacao(agenteId, modo);
    const conversaId = (await repos.conversas.criar({ tipo: "propria", agenteId }))?.id ?? "";
    const turnoId = randomUUID();
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "sobe no staging", entradaConfianca: "confiavel", modelo: "m" });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    tokens.guardarPlano(planoDeTeste({ turnoId, agenteId, conversaId, expiraEm: agora() + 60_000, tokenDeTurno: token, nativas: NATIVAS_DO_TERMINAL, modoTurno: "conversa" }));
    const url = srv!.url;
    const nativas = async (corpo: unknown, extra: Record<string, string> = {}) => {
      const r = await fetch(`${url}/api/interno/nativas`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra }, body: JSON.stringify(corpo) });
      return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
    };
    const hook = (tool_name: string, tool_input: Record<string, unknown>) => decidirHook({ tool_name, tool_input, cwd: "/Users/m/nod/Ze" }, confirmarNoServidor({ url, token }, { dormir: async () => undefined }));
    return { repos, turnoId, nativas, hook, deps: depsSobre(repos, MARLON, { services, agora }) };
  }

  it("total: libera com a confirmação explícita, registra a ação e a trilha leva regra:modo_total v2", async () => {
    const t = await turno("total");
    expect(await t.nativas({ ferramenta: "Read", contamina: false, credencial: AWS })).toEqual({ status: 200, corpo: { ok: true, credencial: "permitida" } });
    expect((await t.repos.trilha.doTurno(t.turnoId)).map((l) => [l.ferramenta, l.regra, l.regraVersao])).toEqual([["nativa__Read", "regra:modo_total", 2]]);
    expect(await t.repos.acoesPeloModo.doTurno(t.turnoId)).toMatchObject([{ tipo: "leitura_credencial", gatilho: "credencial", resumo: `Ler ${AWS}` }]);
    // O hook de verdade, ponta a ponta: o Read da credencial passa.
    expect((await t.hook("Read", { file_path: AWS })).hookSpecificOutput.permissionDecision).toBe("allow");
    // E o comando com credencial também roda, sem cartão (Y1).
    expect((await t.hook("Bash", { command: "gh auth token | docker login ghcr.io -u marlon --password-stdin" })).hookSpecificOutput.permissionDecision).toBe("allow");
    expect((await t.repos.trilha.doTurno(t.turnoId)).at(-1)).toMatchObject({ ferramenta: "nativa__Bash", regra: "regra:modo_total", regraVersao: 2 });
  });

  it("total, reenvio com a mesma chave (NOD-293): devolve a mesma confirmação explícita, sem registrar de novo", async () => {
    const t = await turno("total");
    const chave = { "x-nod-idempotency-key": randomUUID() };
    const corpo = { ferramenta: "Read", contamina: false, credencial: AWS };
    expect(await t.nativas(corpo, chave)).toEqual({ status: 200, corpo: { ok: true, credencial: "permitida" } });
    expect(await t.nativas(corpo, chave)).toEqual({ status: 200, corpo: { ok: true, credencial: "permitida" } });
    expect(await t.repos.trilha.doTurno(t.turnoId)).toHaveLength(1);
    expect(await t.repos.acoesPeloModo.doTurno(t.turnoId)).toHaveLength(1);
  });

  it("manual: 403 com a frase de sempre, que o hook passa ao modelo; NOD-70: a negação vira uma linha `negacao` na trilha", async () => {
    const t = await turno("manual");
    expect(await t.nativas({ ferramenta: "Read", contamina: false, credencial: AWS })).toEqual({ status: 403, corpo: { codigo: "nao_permitido", mensagem: FRASE_ARQUIVO_DE_CREDENCIAL } });
    expect((await t.hook("Read", { file_path: AWS })).hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: `nod: ${FRASE_ARQUIVO_DE_CREDENCIAL}` });
    // O hook consulta o servidor duas vezes acima (a rota e o hook de verdade): duas negações, que a tela agrupa.
    const trilha = await t.repos.trilha.doTurno(t.turnoId);
    expect(trilha.map((l) => [l.ferramenta, l.kind, l.motivo, l.regra])).toEqual(Array(trilha.length).fill(["nativa__Read", "negacao", "credencial_no_manual", "regra:parada_alcada"]));
    expect(trilha.length).toBeGreaterThan(0);
  });

  it("automático: aguardar; aprovado o cartão, a segunda consulta volta com a confirmação explícita", async () => {
    const t = await turno("automatico");
    const r = await t.nativas({ ferramenta: "Write", contamina: false, credencial: "/Users/m/.ssh/config" });
    expect(typeof r.corpo.aguardar).toBe("string");
    await decidir(t.deps, { decisaoId: String(r.corpo.aguardar) });
    expect(await t.nativas({ ferramenta: "Write", contamina: false, credencial: "/Users/m/.ssh/config" })).toEqual({ status: 200, corpo: { ok: true, credencial: "permitida" } });
    expect((await t.repos.trilha.doTurno(t.turnoId)).at(-1)).toMatchObject({ ferramenta: "nativa__Write", kind: "tool_call", regra: "regra:clique", regraVersao: 1 });
    // NOD-70: o cartão também ficou na trilha, com o motivo dele.
    expect((await t.repos.trilha.doTurno(t.turnoId)).filter((l) => l.kind === "cartao")).toHaveLength(1);
  });

  it("a `credencial` só vale nas nativas em que o hook a manda: no Bash ela é ignorada e o comando segue a decisão de sempre", async () => {
    const t = await turno("manual");
    const r = await t.nativas({ ferramenta: "Bash", contamina: false, comando: "git push origin main", credencial: AWS });
    expect(r.status).toBe(200);
    expect(typeof r.corpo.aguardar).toBe("string");
    expect(r.corpo.credencial).toBeUndefined();
  });

  it("o hook ANTIGO não manda a credencial (nega sozinho): o Read comum do servidor novo segue o `{ ok: true }` de sempre", async () => {
    const t = await turno("total");
    expect(await t.nativas({ ferramenta: "Read", contamina: false })).toEqual({ status: 200, corpo: { ok: true } });
  });
});
