import { afterAll, expect, it } from "vitest";
import { confirmarNoServidor, decidirHook } from "../../src/adapters/executor/hook-nativas.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { AtividadeDto } from "../../src/contracts/atividade.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { CAPACIDADES_HARNESS } from "../../src/contracts/harness.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * PR 6 dos modos de aprovação, ponta a ponta sobre o servidor completo (commita; limpeza própria): um Mac falso conectado
 * pela ponte HTTP, o bot em "Ignorar todas as aprovações", e o hook DE VERDADE (`decidirHook` + `confirmarNoServidor`, sem
 * o CLI) falando com a rota interna. `gh auth token | docker login` roda sem cartão (Y1), o Read de `~/.aws/config` também
 * (Y2), os dois aparecem na Atividade no filtro "Sem aprovação" (Y3) e na linha embaixo da fala; as cercas fixas — git fora
 * da pasta do bot e o laço com `sleep` — continuam negando no total.
 */
describeIntegracao("Ignorar todas as aprovações de verdade, ponta a ponta (PR 6)", () => {
  let srv: ServidorCompleto | null = null;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  afterAll(async () => {
    if (!srv) return;
    const s = srv;
    await s.fechar();
    await s.db.begin(async (tx) => { await vincularEscopo(tx, s.pessoa); await tx`delete from maquina_tokens where owner_id = ${s.pessoa.pessoaId}`; });
    await limparPessoaE2E(s.db, s.dbDono, s.pessoa, criados);
    await s.desligar();
  });

  it("total + gh auth token: roda, não abre cartão, aparece na Atividade e na linha da fala; as cercas fixas continuam", async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "50" } });
    const s = srv;
    const { chave, dados } = await s.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac" });
    const pedir = (nome: string, body: unknown = {}) => fetch(`${s.url}/api/maquina/${nome}`, {
      method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.4.0-rc.14" }, body: JSON.stringify(body),
    });
    const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
    expect((await pedir("conectar", { nome: "Mac", plataforma: "darwin", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto }, capacidades: { "claude-cli": CAPACIDADES_HARNESS["claude-cli"] } })).status).toBe(200);

    const { agente, conversa } = await s.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Ze" });
    criados.agentes.push(agente.id);
    criados.conversas.push(conversa.id);
    await s.json("POST", `agentes/${agente.id}/modo-aprovacao`, { modo: "total", confirmado: true });
    await s.json("POST", `conversas/${conversa.id}/mensagens`, { texto: "Publica a imagem 2.3 no registry do GitHub." });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(plano.nativas).toEqual(expect.arrayContaining(["Bash", "Read"]));

    const pastas = { pastaDoBot: "/Users/marlon/nod/Ze", home: "/Users/marlon" };
    const hook = (tool_name: string, tool_input: Record<string, unknown>) =>
      decidirHook({ tool_name, tool_input, cwd: pastas.pastaDoBot }, confirmarNoServidor({ url: s.url, token: plano.tokenDeTurno }, { dormir: async () => undefined }), pastas);

    // Y1 e Y2: rodam no total, sem cartão.
    expect((await hook("Bash", { command: "gh auth token | docker login ghcr.io -u marlon --password-stdin" })).hookSpecificOutput.permissionDecision).toBe("allow");
    expect((await hook("Read", { file_path: "/Users/marlon/.aws/config" })).hookSpecificOutput.permissionDecision).toBe("allow");
    // As cercas fixas: git fora da pasta do bot (no hook, antes do servidor) e o laço com sleep (no servidor, antes do modo).
    expect((await hook("Bash", { command: "git -C /Users/marlon/code/app checkout -b feat/x" })).hookSpecificOutput.permissionDecision).toBe("deny");
    const laco = await hook("Bash", { command: "until gh pr checks 505 | grep -qv pending; do sleep 30; done" });
    expect(laco.hookSpecificOutput.permissionDecision).toBe("deny");
    expect((await s.json<SuaVezDto>("GET", "sua-vez")).itens).toEqual([]);

    // O turno acaba com a fala do bot (a âncora da linha).
    const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
    const entrega: Entrega = {
      turnoId: plano.turnoId, machineId: dados.id, seqLocal: 1, fala: { tipo: "texto", texto: "Publicada: ghcr.io/gamefik/nod:2.3." },
      resultado: { desfecho: "sucesso", texto: "Publicada: ghcr.io/gamefik/nod:2.3.", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] },
    };
    expect((await pedir("entregar", entrega)).status).toBe(200);

    const lida = await s.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`);
    expect(lida.mensagens.some((m) => m.turnoId === plano.turnoId && m.texto.startsWith("Publicada:"))).toBe(true);
    expect(lida.acoesDoModo?.[plano.turnoId]?.map((a) => a.frase)).toEqual(["Usou o token do GitHub do seu Mac", "Leu as credenciais da AWS do seu Mac"]);

    const hoje = new Date().toISOString().slice(0, 10);
    const atividade = await s.json<AtividadeDto>("GET", `agentes/${agente.id}/atividade?dia=${hoje}&fuso=UTC`);
    const semAprovacao = atividade.itens.filter((i) => i.categoria === "sem_aprovacao");
    expect(semAprovacao.map((i) => [i.titulo, i.detalhe])).toEqual([
      ["Leu as credenciais da AWS", "~/.aws/config"],
      ["Usou o token do GitHub", "gh auth token | docker login ghcr.io -u marlon --password-stdin"],
    ]);
  }, 60_000);
});
