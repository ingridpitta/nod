import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarRevisao } from "../../src/use-cases/revisar-acao.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { MODELO_DE_TESTE, revisorDeTeste, texto } from "../helpers/revisor-de-teste.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * ADR-115 (PR 3a dos modos de aprovação) pela rota interna REAL `/nativas`: com a chave ligada, o arriscado do Automático
 * vira `{ aguardar }` com a decisão `em_revisao`; o pedido só entra no executor do revisor DEPOIS do commit; o hook espera
 * pelo `aguardar` de sempre; liberada, a segunda consulta roda o comando e a trilha leva `regra:revisor`. Desligada, nada disso.
 */
describe("rota /interno/nativas com o revisor (ADR-115)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const memorias: { ligada?: ReturnType<typeof dentroEmMemoria> } = {};
  // O executor do revisor de verdade, com a API falsa respondida pelo teste; a fase 3 numa "transação" nova da memória.
  const revisores = {
    ligada: revisorDeTeste({ assentar: async (p) => void (await memorias.ligada!.dentro(p.escopo, (d) => assentarRevisao(d, { decisaoId: p.decisaoId, resultado: p.resultado }))) }),
    desligada: revisorDeTeste({ config: { ligado: false }, assentar: async () => undefined }),
  };
  const ligada = dentroEmMemoria({ services: { ...servicosDeTeste({ agora, tokens }), revisor: revisores.ligada.executor }, agora });
  memorias.ligada = ligada;
  const desligada = dentroEmMemoria({ services: { ...servicosDeTeste({ agora, tokens }), revisor: revisores.desligada.executor }, agora });
  const srv: { ligada?: ServidorDeTeste; desligada?: ServidorDeTeste } = {};
  let enfileirados = 0;

  beforeAll(async () => {
    const espiao = { enfileirar: (p: Parameters<typeof revisores.ligada.executor.enfileirar>[0]) => { enfileirados += 1; revisores.ligada.executor.enfileirar(p); } };
    srv.ligada = await servidorDeTeste(rotasInternas({ dentro: ligada.dentro, tokens, agora, revisor: espiao, intervaloMs: 10, longpollMs: 50 }), { autorizarTokenTurno: tokens.autorizar });
    srv.desligada = await servidorDeTeste(rotasInternas({ dentro: desligada.dentro, tokens, agora, revisor: revisores.desligada.executor, intervaloMs: 10, longpollMs: 50 }), { autorizarTokenTurno: tokens.autorizar });
  });
  afterAll(() => {
    srv.ligada?.close();
    srv.desligada?.close();
  });
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  async function turno(qual: "ligada" | "desligada") {
    const memoria = qual === "ligada" ? ligada : desligada;
    const repos = memoria.repos(MARLON);
    const agente = await repos.agentes.criar({ nome: "Ada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const agenteId = agente?.id ?? "";
    await repos.agentes.definirModoAprovacao(agenteId, "automatico");
    const conversaId = (await repos.conversas.criar({ tipo: "propria", agenteId }))?.id ?? "";
    const turnoId = randomUUID();
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "força o push", entradaConfianca: "confiavel", modelo: "m" });
    const t = memoria.banco.turnos.find((x) => x.id === turnoId);
    if (t) t.estado = "despachando";
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    tokens.guardarPlano(planoDeTeste({ turnoId, agenteId, conversaId, expiraEm: agora() + 60_000, tokenDeTurno: token, nativas: NATIVAS_DO_TERMINAL, modoTurno: "conversa" }));
    const revisor = revisores[qual];
    const url = srv[qual]!.url;
    const interno = async (metodo: string, caminho: string, corpo?: unknown) =>
      (await fetch(`${url}/api/interno/${caminho}`, { method: metodo, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) })).json() as Promise<Record<string, unknown>>;
    return { repos, turnoId, revisor, interno, memoria };
  }

  it("ligada: aguardar com em_revisao; o pedido entra no executor depois do commit; liberado, o hook acha a decisão e a segunda consulta roda com regra:revisor na trilha", async () => {
    const t = await turno("ligada");
    const antes = enfileirados;
    const r = await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git push --force origin feat/login" });
    expect(typeof r.aguardar).toBe("string");
    const decisaoId = String(r.aguardar);
    expect(enfileirados).toBe(antes + 1);
    expect((await t.repos.decisoes.buscar(decisaoId))?.estado).toBe("em_revisao");
    // A espera do hook: em revisão conta como pendente (o hook não muda).
    expect(await t.interno("GET", `decisoes/${decisaoId}/aguardar`)).toEqual({ estado: "pendente" });
    // A API falsa responde a chamada do executor; a fase 3 roda numa "tx" nova.
    const chamadas = await t.revisor.revisar(() => texto('{"decisao":"libera","motivo":"você pediu"}'));
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.modelo).toBe(MODELO_DE_TESTE);
    expect(chamadas[0]?.entrada).toContain("git push --force origin feat/login");
    expect(await t.interno("GET", `decisoes/${decisaoId}/aguardar`)).toMatchObject({ estado: "decidida", itens: [{ idx: 0, desfecho: "executado" }] });
    expect(await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git push --force origin feat/login" })).toEqual({ ok: true });
    const trilha = await t.repos.trilha.doTurno(t.turnoId);
    expect(trilha.map((l) => [l.ferramenta, l.regra, l.regraVersao])).toEqual([["nativa__Bash", "regra:revisor", 1]]);
    // O comum do Automático com o revisor ligado leva a regra na versão 3.
    expect(await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git commit -am x" })).toEqual({ ok: true });
    expect((await t.repos.trilha.doTurno(t.turnoId)).at(-1)).toMatchObject({ regra: "regra:modo_automatico", regraVersao: 3 });
  });

  it("desligada: o arriscado é o card de sempre (pendente, acao_arriscada) e nada vai ao executor; o comum segue na versão 2", async () => {
    const t = await turno("desligada");
    const r = await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git push --force origin feat/login" });
    const decisaoId = String(r.aguardar);
    expect((await t.repos.decisoes.buscar(decisaoId))?.estado).toBe("pendente");
    expect(await t.repos.itensAprovacao.listar(decisaoId)).toMatchObject([{ motivoManual: "acao_arriscada" }]);
    expect(t.revisor.executor.emMemoria()).toMatchObject({ esperando: 0, emVoo: 0 });
    expect(t.revisor.chamadas).toHaveLength(0);
    expect(await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git commit -am x" })).toEqual({ ok: true });
    expect((await t.repos.trilha.doTurno(t.turnoId)).at(-1)).toMatchObject({ regra: "regra:modo_automatico", regraVersao: 2 });
  });
});
