import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { TAG } from "../../src/adapters/mcp-proxy/moldura.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../src/shared/constantes.ts";
import { criarConectoresVivos } from "../../src/services/conectores-vivos.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, inicializarProxy, planoDeTeste, servicosDeTeste, spawnProxy, type ProxyReal } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type ConteudoTexto = { content: { type: string; text: string }[]; isError?: boolean };

/**
 * ADR-051 pelo proxy REAL: publicar_artefato volta confiável; ler_artefato volta embrulhado como NÃO
 * confiável, com o orçamento do turno (75 000 desde 2026-09-28) — o HTML que a ferramenta promete cabe.
 * readOnlyHint chega ao CLI em tools/list.
 */
describe("proxy com o artefato do nod (ADR-051)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const conectores = criarConectoresVivos({ carregar: async () => null, agora, timeoutChamadaMs: 5_000 });
  const services = servicosDeTeste({ agora, tokens, conectores });
  const memoria = dentroEmMemoria({ services, agora });
  const turnoId = randomUUID();
  const agenteId = randomUUID();
  let srv: ServidorDeTeste;
  let proxy: ProxyReal;

  beforeAll(async () => {
    const repos = memoria.repos(MARLON);
    await repos.agentes.criar({ id: agenteId, nome: "Ada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const conversa = await repos.conversas.criar({ tipo: "propria", agenteId });
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId: conversa?.id ?? "", agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "checklist", entradaConfianca: "confiavel", modelo: "m" });
    await repos.turnos.reivindicar({ machineId: "m1", agora: agora() });

    srv = await servidorDeTeste(rotasInternas({ dentro: memoria.dentro, tokens, agora }), { autorizarTokenTurno: tokens.autorizar });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    const nod = (nome: "publicar_artefato" | "ler_artefato") => ({ nome, nomeMcp: `mcp__nod__${nome}` as const, origem: "nod" as const, conectorId: null, readOnlyHint: nome === "ler_artefato", tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] });
    tokens.guardarPlano(planoDeTeste({
      turnoId, agenteId, conversaId: conversa?.id ?? "", expiraEm: agora() + 600_000, tokenDeTurno: token,
      // O orçamento que montarPlano dá a todo turno real (o planoDeTeste fixa 8 000, de antes de 2026-09-28).
      politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: ORCAMENTO_RESULTADO_CHARS },
      catalogo: { ferramentas: [nod("publicar_artefato"), nod("ler_artefato")], servidores: [] },
    }));
    proxy = spawnProxy({ NOD_URL: srv.url, NOD_TOKEN_TURNO: token });
    await inicializarProxy(proxy);
  });

  afterAll(async () => {
    await proxy.fechar();
    await srv.close();
    await conectores.fechar();
  });

  it("tools/list: ler_artefato é leitura, publicar_artefato não", async () => {
    const r = (await proxy.pedir("tools/list")).result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    expect(r.tools.map((t) => [t.name, t.annotations.readOnlyHint])).toEqual([["publicar_artefato", false], ["ler_artefato", true]]);
  });

  it("publica e lê de volta 20 000 caracteres de HTML inteiros, embrulhados como não confiáveis", async () => {
    const html = `<ol>${"<li><input type=checkbox> tarefa</li>".repeat(560)}</ol>`;
    expect(html.length).toBeGreaterThan(20_000);
    const pub = (await proxy.pedir("tools/call", { name: "publicar_artefato", arguments: { titulo: "Checklist do dia", html } })).result as ConteudoTexto;
    expect(pub.isError).toBeUndefined();
    const { artefato_id, versao } = JSON.parse(pub.content[0]?.text ?? "{}") as { artefato_id: string; versao: number };
    expect(versao).toBe(1);
    expect(pub.content[0]?.text).not.toContain(TAG);

    const lido = (await proxy.pedir("tools/call", { name: "ler_artefato", arguments: { artefato_id } })).result as ConteudoTexto;
    const texto = lido.content[0]?.text ?? "";
    expect(texto).toContain(`<${TAG} origem="ler_artefato">`);
    expect(texto).not.toContain("[cortado pelo nod");
    expect(texto).toContain(JSON.stringify(html).slice(1, -1).slice(-200));
    expect(memoria.banco.mensagens.filter((m) => m.kind === "artefato")).toHaveLength(1);
  });
});
