import { afterAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { CAPACIDADES_HARNESS } from "../../src/contracts/harness.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-288: o bot no Codex com terminal não perde o Bash e o apply_patch quando o servidor reinicia no meio do turno. Antes,
 * o hook que chegava ao processo novo antes de a máquina reconectar recompunha o plano com as capacidades `{}` (terminal
 * desligado), ouvia 403 e o plano ficava em cache até o fim do turno.
 */
describeIntegracao("NOD-288: o Codex com terminal atravessa o reinício do servidor", () => {
  let velho: ServidorCompleto | null = null;
  let novo: ServidorCompleto | null = null;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  afterAll(async () => {
    await novo?.fechar();
    await velho?.fechar();
    if (velho) {
      const v = velho;
      await v.db.begin(async (tx) => { await vincularEscopo(tx, v.pessoa); await tx`delete from maquina_tokens where owner_id = ${v.pessoa.pessoaId}`; });
      await limparPessoaE2E(v.db, v.dbDono, v.pessoa, criados);
    }
    await novo?.desligar();
    await velho?.desligar();
  });

  it("entre o reinício e a reconexão o hook ouve 200 no Bash; o plano provisório não fica em cache e, reconectada, a máquina volta a mandar", async () => {
    const env = { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" };
    velho = await servidorCompleto({ env });
    const v = velho;
    const { chave } = await v.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "VM" });
    const pedirEm = (srv: ServidorCompleto) => (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
      method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
    });
    const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
    const conectar = (codex: typeof CAPACIDADES_HARNESS["codex-cli"]) => ({
      nome: "VM", plataforma: "linux", versaoContrato: 1, inventario: pronto, harnesses: { "codex-cli": pronto }, capacidades: { "codex-cli": codex }, sobreviveReinicio: true,
    });
    const nativa = (srv: ServidorCompleto, token: string, corpo: unknown) => fetch(`${srv.url}/api/interno/nativas`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(corpo),
    });

    expect((await pedirEm(v)("conectar", conectar(CAPACIDADES_HARNESS["codex-cli"]))).status).toBe(200);
    const r = await v.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Dev Codex" });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    await v.json("POST", `conversas/${r.conversa.id}/mensagens`, { texto: "Roda os testes" });
    const { plano } = (await (await pedirEm(v)("puxar")).json()) as { plano: PlanoTurno };
    expect(plano.harness).toBe("codex-cli");
    expect(plano.nativas).toEqual(expect.arrayContaining(["Bash", "apply_patch"]));
    expect((await nativa(v, plano.tokenDeTurno, { ferramenta: "Bash", comando: "ls" })).status).toBe(200);

    // O deploy: o processo velho drena (a máquina sobrevive ao reinício) e fecha; o novo sobe sem a máquina conectada.
    expect(await v.drenar({ prazoMs: 600_000, intervaloMs: 50 })).toMatchObject({ turnos: 0, prazo_vencido: false });
    await v.fechar();
    novo = await servidorCompleto({ env, pessoaId: v.pessoa.pessoaId });
    const n = novo;

    // Antes: 403 "fora do plano" aqui e em todo comando seguinte do turno.
    expect((await nativa(n, plano.tokenDeTurno, { ferramenta: "Bash", comando: "ls" })).status).toBe(200);
    expect((await nativa(n, plano.tokenDeTurno, { ferramenta: "apply_patch", arquivo: "notas.md" })).status).toBe(200);
    // Provisório: o plano não ficou em cache (a próxima chamada recompõe com a máquina de volta).
    expect(n.app.tokens.planoDe(plano.turnoId)).toBeNull();

    // A máquina reconecta anunciando o Codex SEM terminal: o plano recomposto agora é definitivo e manda.
    expect((await pedirEm(n)("conectar", conectar({ ...CAPACIDADES_HARNESS["codex-cli"], terminal: false }))).status).toBe(200);
    expect((await nativa(n, plano.tokenDeTurno, { ferramenta: "Bash", comando: "ls" })).status).toBe(403);
    expect(n.app.tokens.planoDe(plano.turnoId)?.nativas ?? []).not.toContain("Bash");
  }, 30_000);
});
