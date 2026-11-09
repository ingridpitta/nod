import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { TrabalhosDto } from "../../src/contracts/trabalho.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { linhaDaEsperaDaMaquina } from "../../web/telas/trabalhos.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA do NOD-314 (achado do re-QA no topo da task): o "Rodar em <outra> desta vez" da task segue a IA em que o turno
 * pendente está fixado, como a linha do turno preso na conversa. Mac A (a do bot, Claude) sem contato; a VM conectada só
 * com o Codex: o topo não oferece a VM e a rota recusa com `conta_fora_da_maquina` — antes a VM pegava um turno de Claude
 * que não tinha como rodar. Com uma conta de Claude pronta na VM, o botão volta e o clique leva o turno.
 */
describeIntegracao("QA NOD-314: rodar desta vez da task respeita a IA fixada (HTTP real)", () => {
  let srv: ServidorCompleto;
  let chaveVm = "", vmId = "", macId = "", agenteId = "", conversaId = "", trabalhoId = "";
  const pronto = { estado: "pronto", versao: "x", em: 0 };
  const semLogin = { estado: "nao_autenticado", motivo: "Entre na conta", em: 0 };
  const conta = (impressao: string, ia: string) => ({ impressao, ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: Date.now() - 1_000 });
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chaveVm}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const conectarVm = (contas: unknown[], harnesses: Record<string, unknown>) => pedir("conectar", { nome: "vm", plataforma: "linux", versaoContrato: 1, inventario: pronto, harnesses, contas });
  const topo = async () => {
    const [lista, maquinas, contasIa] = await Promise.all([
      srv.json<TrabalhosDto>("GET", `trabalhos?agenteId=${agenteId}`), srv.json<MaquinasDto>("GET", "maquinas"), srv.json<ContasIaDto>("GET", "contas-ia"),
    ]);
    const t = lista.trabalhos.find((x) => x.id === trabalhoId)!;
    return { t, html: linhaDaEsperaDaMaquina(t, { maquinas, contasIa, agora: Date.now() }) };
  };

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const mac = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac A" });
    macId = mac.dados.id;
    const vm = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm" });
    chaveVm = vm.chave; vmId = vm.dados.id;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot no Mac", descricao: "Roda no Mac A" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
    expect((await srv.chamar("PUT", `agentes/${agenteId}/maquina`, { maquinaId: macId })).status).toBe(200);
    // O Mac A falou há 10 min e sumiu.
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`update maquina_tokens set ultimo_uso_em = now() - interval '10 minutes' where id = ${macId}`; });
    trabalhoId = await srv.app.dentro(srv.pessoa, async (d) => {
      const { trabalho, events } = await criarTrabalho(d, { agenteId, conversaId, titulo: "Task no Claude", origem: "pessoa" });
      await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", trabalhoId: trabalho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "auto", harness: "claude-cli" });
      await d.repos.events.gravarComOutbox(events);
      return trabalho.id;
    });
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`delete from contas_ia where owner_id = ${srv.pessoa.pessoaId}`;
      await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`;
    });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("VM só com Codex: o topo não oferece a VM, a rota recusa e o turno de Claude fica no Mac A", async () => {
    expect((await conectarVm([conta("c".repeat(64), "codex-cli")], { "claude-cli": semLogin, "codex-cli": pronto })).status).toBe(200);
    const { t, html } = await topo();
    expect(t).toMatchObject({ estado: "na_fila", maquina: { id: macId } });
    expect(t.maquina?.semContatoDesde).toEqual(expect.any(Number));
    expect(html).toBe("");
    const r = await srv.chamar("POST", `trabalhos/${trabalhoId}/rodar-desta-vez`, { maquinaId: vmId });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: "conta_fora_da_maquina" });
    // A VM não leva o turno de Claude.
    const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno | null };
    expect(plano).toBeNull();
  });

  it("com uma conta de Claude pronta na VM: o botão volta e o clique leva o turno para ela", async () => {
    expect((await conectarVm([conta("c".repeat(64), "codex-cli"), conta("d".repeat(64), "claude-cli")], { "claude-cli": pronto, "codex-cli": pronto })).status).toBe(200);
    const { html } = await topo();
    expect(html).toContain(`data-maquina="${vmId}"`);
    expect(html).toContain("Rodar em vm desta vez");
    const r = await srv.chamar("POST", `trabalhos/${trabalhoId}/rodar-desta-vez`, { maquinaId: vmId });
    expect(r.status).toBe(200);
    const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno | null };
    expect(plano).toMatchObject({ machineId: vmId, harness: "claude-cli" });
    // "Desta vez": a máquina do bot segue a do Mac A.
    const [ag] = await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); return tx<{ maquina_id: string | null }[]>`select maquina_id::text from agentes where id = ${agenteId}`; });
    expect(ag?.maquina_id).toBe(macId);
  });
});
