import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import type { ServicoRevisor } from "../../src/contracts/revisao.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import type { PedidoNaFila } from "../../src/use-cases/revisar-acao.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, planoDeTeste, servicosDeTeste, type ChamadaConector } from "../helpers/l5.ts";
import { configDeTeste } from "../helpers/revisor-de-teste.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * ADR-115 (PR 5 dos modos de aprovação) pela rota interna de verdade (`POST /api/interno/ferramentas/:nome`), com `dentro`
 * em memória que conta as transações abertas: a chamada direta e o `pedir_aprovacao` que vão ao revisor respondem ao proxy o
 * `{ aguardar }` de sempre, e o pedido só entra no executor do revisor DEPOIS que a transação da fase 1 fechou.
 */
describe("rota interna: a ação de app que vai ao revisor responde aguardar e enfileira depois do commit (PR 5)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const tx = { abertas: 0 };
  const chamadas: ChamadaConector[] = [];
  const revisor: ServicoRevisor = {
    config: configDeTeste(),
    indisponivel: () => null,
  };
  const services: Services = { ...servicosDeTeste({ agora, tokens, chamadas }), revisor };
  const memoria = dentroEmMemoria({ services, agora });
  const dentro: DentroDeTx = async (escopo, fn) => {
    tx.abertas++;
    try {
      return await memoria.dentro(escopo, fn);
    } finally {
      tx.abertas--;
    }
  };
  const enfileirados: { pedido: PedidoNaFila; txAbertas: number }[] = [];
  let srv: ServidorDeTeste;
  let agenteId: string;
  let conversaId: string;
  let conectorId: string;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    srv = await servidorDeTeste([...rotasInternas({ dentro, tokens, agora, longpollMs: 300, intervaloMs: 40, revisor: { enfileirar: (pedido) => void enfileirados.push({ pedido, txAbertas: tx.abertas }) } })], { autorizarTokenTurno: tokens.autorizar });
    const repos = memoria.repos(MARLON);
    memoria.banco.pessoas.push({ tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
    agenteId = (await repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" }))?.id ?? "";
    await repos.agentes.definirModoAprovacao(agenteId, "automatico");
    conversaId = (await repos.conversas.criar({ tipo: "propria", agenteId }))?.id ?? "";
    const conector = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    conectorId = conector?.id ?? "";
    await repos.conectores.registrarSonda(conectorId, { ok: true, catalogo: [{ nome: "apagar", descricao: "apaga", schema: { type: "object" }, readOnlyHint: false }], agora: agora() });
    await repos.conectores.habilitar(conectorId, true);
    await repos.concessoes.conceder({ agenteId, conectorId, capacidade: "apagar", mensagemId: "m" });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    return srv.close();
  });

  async function turno() {
    const turnoId = randomUUID();
    await memoria.repos(MARLON).turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    tokens.guardarPlano(planoDeTeste({
      turnoId, agenteId, conversaId, expiraEm: agora() + 60_000, tokenDeTurno: token, modoTurno: "conversa",
      catalogo: {
        ferramentas: [
          { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.pedir_aprovacao },
          { nome: "email__apagar", nomeMcp: "mcp__nod__email__apagar", origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } },
        ],
        servidores: [{ conectorId, nome: "email", trust: "untrusted", transporte: "stdio" }],
      },
    }));
    return async (nome: string, argumentos: unknown) => {
      const r = await fetch(`${srv.url}/api/interno/ferramentas/${nome}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos }) });
      return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
    };
  }

  it("chamada direta: 200 { aguardar } (o mesmo corpo do pendente), a decisão em_revisao e o pedido no executor com zero tx aberta; o app não roda", async () => {
    const chamar = await turno();
    const antes = enfileirados.length;
    const r = await chamar("email__apagar", { id: "e1" });
    expect(r.status).toBe(200);
    expect(Object.keys(r.corpo)).toEqual(["aguardar"]);
    expect(enfileirados.slice(antes)).toHaveLength(1);
    expect(enfileirados[antes]).toMatchObject({ txAbertas: 0, pedido: { escopo: MARLON, pedido: { decisaoId: r.corpo.aguardar } } });
    expect(memoria.banco.decisoes.find((d) => d.id === r.corpo.aguardar)?.estado).toBe("em_revisao");
    expect(chamadas).toHaveLength(0);
  });

  it("pedir_aprovacao: o lote em revisão responde { aguardar } e enfileira do mesmo jeito", async () => {
    const chamar = await turno();
    const antes = enfileirados.length;
    const r = await chamar("pedir_aprovacao", { resumo: "limpar", itens: [{ texto: "apagar o e-mail velho", destino: { conector: "email", ferramenta: "apagar", argumentos: { id: "e2" } } }] });
    expect(r).toMatchObject({ status: 200, corpo: { aguardar: expect.any(String) } });
    expect(Object.keys(r.corpo)).toEqual(["aguardar"]);
    expect(enfileirados.slice(antes)).toMatchObject([{ txAbertas: 0, pedido: { pedido: { decisaoId: r.corpo.aguardar } } }]);
    expect(chamadas).toHaveLength(0);
  });
});
