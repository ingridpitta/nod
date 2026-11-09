import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-442, revisão do PR #612: o quadro sob corrida, no servidor completo e no Postgres de verdade. Dois aparelhos (ou
 * dois bots) mexendo ao mesmo tempo: a criação do mesmo quadro, lotes paralelos no mesmo quadro e dois Desfazer do
 * mesmo lote. A trava do quadro serializa; nada se perde, nada se duplica (nem o código da tarefa, NOD-416) e o Desfazer
 * vale uma vez só.
 */

const NOME_PESSOA = `E2E Quadro corrida ${randomUUID().slice(0, 8)}`;

type Resp = { status: number; corpo: { ok?: boolean; quadro?: QuadroDto | null; lote?: { id: string } | null; erro?: string } & Record<string, unknown> };

describeIntegracao("quadro sob corrida (NOD-442)", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };

  /** Sem lançar no 4xx: a corrida precisa ver a resposta de quem perdeu. */
  const chamar = async (metodo: string, caminho: string, corpo?: unknown): Promise<Resp> => {
    const res = await srv.chamar(metodo, caminho, corpo);
    const texto = await res.text();
    const j = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    return { status: res.status, corpo: ((j.data as Record<string, unknown> | undefined) ?? j) as Resp["corpo"] };
  };
  const quadro = (agenteId: string) => srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agenteId}/quadro`).then((r) => r.quadro);

  beforeAll(async () => {
    srv = await servidorCompleto({ nomePessoa: NOME_PESSOA, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 5 })] });
    await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
  }, 30_000);

  afterAll(async () => {
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    }
  }, 30_000);

  it("criação paralela do mesmo quadro, lotes paralelos e dois Desfazer do mesmo lote", { timeout: 60_000 }, async () => {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: `Ana ${randomUUID().slice(0, 4)}` });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    const ana = r.agente.id;

    // Dois aparelhos criam o quadro ao mesmo tempo: um quadro só, com uma das metas.
    const criar = await Promise.all(["Meta A", "Meta B"].map((meta) => chamar("POST", `agentes/${ana}/quadro`, { meta })));
    expect(criar.map((c) => c.status).every((s) => s < 500)).toBe(true);
    const q0 = await quadro(ana);
    expect(q0).not.toBeNull();
    expect(["Meta A", "Meta B"]).toContain(q0!.meta);
    const ids = new Set(criar.map((c) => c.corpo.quadro?.id).filter(Boolean));
    expect(ids.size).toBeLessThanOrEqual(1);

    // Seis tarefas criadas em paralelo: as seis ficam, cada uma com a sua ordem.
    const N = 6;
    const lotes = await Promise.all(Array.from({ length: N }, (_, i) => chamar("POST", `agentes/${ana}/quadro/tarefas`, { titulo: `T${i}` })));
    expect(lotes.map((l) => [l.status, l.corpo.ok])).toEqual(Array.from({ length: N }, () => [201, true]));
    const q1 = (await quadro(ana))!;
    expect(q1.tarefas.map((t) => t.titulo).sort()).toEqual(Array.from({ length: N }, (_, i) => `T${i}`).sort());
    // NOD-416: sem status, todas caem no Backlog (ninguém começa).
    const ordens = q1.tarefas.filter((t) => t.status === "backlog").map((t) => t.ordem);
    expect(ordens).toHaveLength(N);
    expect(new Set(ordens).size).toBe(ordens.length);
    // NOD-416 (ADR-144): a numeração sob corrida não repete nem pula: PREFIXO-1..N, um por tarefa.
    const prefixo = q1.prefixo!;
    expect(prefixo).toBeTruthy();
    expect(q1.tarefas.map((t) => t.codigo).sort()).toEqual(Array.from({ length: N }, (_, i) => `${prefixo}-${i + 1}`).sort());
    expect(q1.tarefas.every((t) => t.turnoId === null)).toBe(true);

    // Dois Desfazer do mesmo lote ao mesmo tempo: vale um só; o outro é recusado e não apaga nada a mais.
    // O alvo é o último lote de verdade (a ordem das respostas paralelas não diz qual a trava aplicou por último).
    const ultimo = q1.ultimoLote;
    expect(ultimo).not.toBeNull();
    const alvo = ultimo!.id;
    const doLote = lotes.find((l) => l.corpo.lote?.id === alvo);
    expect(doLote).toBeDefined();
    const desf = await Promise.all([0, 1].map(() => chamar("POST", `agentes/${ana}/quadro/lotes/${alvo}/desfazer`)));
    expect(desf.filter((d) => d.status < 300 && d.corpo.ok === true)).toHaveLength(1);
    expect(desf.map((d) => d.status).every((s) => s < 500)).toBe(true);
    const q2 = (await quadro(ana))!;
    expect(q2.tarefas).toHaveLength(N - 1);
    // Sumiu exatamente a tarefa que só existia depois do lote desfeito.
    const sumiu = q1.tarefas.filter((t) => !q2.tarefas.some((x) => x.id === t.id));
    expect(sumiu).toHaveLength(1);
    expect(doLote!.corpo.quadro?.tarefas.some((t) => t.id === sumiu[0]!.id)).toBe(true);
  });

  it("QA do PR #623: seis bots chamados Ana criam o quadro ao mesmo tempo; a trava de prefixo dá um prefixo a cada um", { timeout: 60_000 }, async () => {
    // Sem a trava (`travarPrefixos`), as seis transações leem os mesmos prefixos usados, escolhem o mesmo e cinco batem
    // no índice único `quadros_prefixo` (500). Com ela, a escolha é em fila: ANA, ANA2… (ou a continuação, se já houver).
    const N = 6;
    const anas: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Ana" });
      criados.agentes.push(r.agente.id);
      criados.conversas.push(r.conversa.id);
      anas.push(r.agente.id);
    }
    const r = await Promise.all(anas.map((id) => chamar("POST", `agentes/${id}/quadro`, { meta: null })));
    expect(r.map((x) => [x.status, x.corpo.erro ?? null])).toEqual(anas.map(() => [201, null]));
    const prefixos = await Promise.all(anas.map(async (id) => (await quadro(id))!.prefixo));
    expect(prefixos.every((p) => p !== null && /^ANA[0-9]*$/.test(p))).toBe(true);
    expect(new Set(prefixos).size).toBe(N);
  });

  it("revisão do PR #623: movers cruzados (A→B e B→A) e mover contra lote e criação no destino, sem deadlock nem código repetido", { timeout: 90_000 }, async () => {
    const bot = async (nome: string) => {
      const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: `${nome} ${randomUUID().slice(0, 4)}` });
      criados.agentes.push(r.agente.id);
      criados.conversas.push(r.conversa.id);
      return r.agente.id;
    };
    const [a, b] = [await bot("Xavi"), await bot("Yara")];
    for (const id of [a, b]) {
      expect((await chamar("POST", `agentes/${id}/quadro`, { meta: null })).status).toBeLessThan(300);
      for (let i = 0; i < 4; i++) expect((await chamar("POST", `agentes/${id}/quadro/tarefas`, { titulo: `${id.slice(0, 4)}-${i}` })).status).toBe(201);
    }
    const total = 8;
    for (let rodada = 0; rodada < 3; rodada++) {
      // Quadros de antes da 0137 (sem prefixo): o lote e o mover vão pegar o advisory dos prefixos. Com a ordem invertida
      // (FOR UPDATE do quadro e depois o advisory), um mover segurando o quadro e um lote segurando o advisory se travam.
      await srv.dbDono`update quadros set prefixo = null where agente_id in (${a}, ${b})`;
      const qa = (await quadro(a))!;
      const qb = (await quadro(b))!;
      const ta = qa.tarefas[0]!.id;
      const tb = qb.tarefas[0]!.id;
      const c = await bot("Zeca");
      const r = await Promise.all([
        chamar("POST", `agentes/${a}/quadro/tarefas/${ta}/mover`, { quadro: b }),
        chamar("POST", `agentes/${b}/quadro/tarefas/${tb}/mover`, { quadro: a }),
        chamar("POST", `agentes/${b}/quadro/tarefas`, { titulo: `novo-b-${rodada}` }),
        chamar("POST", `agentes/${a}/quadro/tarefas`, { titulo: `novo-a-${rodada}` }),
        chamar("PATCH", `agentes/${a}/quadro/tarefas/${qa.tarefas[1]!.id}`, { status: "afazer" }),
        chamar("POST", `agentes/${c}/quadro`, { meta: null }),
      ]);
      expect(r.map((x) => [x.status < 300, x.corpo.ok ?? null, x.corpo.erro ?? null])).toEqual(r.map(() => [true, true, null]));
      const fim = [(await quadro(a))!, (await quadro(b))!];
      expect(fim.every((q) => q.prefixo)).toBe(true);
      expect(fim.flatMap((q) => q.tarefas)).toHaveLength(total + 2 * (rodada + 1));
      // Nenhum código repetido, nem dentro do quadro nem entre os dois; todo código é do prefixo do seu quadro.
      const codigos = fim.flatMap((q) => q.tarefas.map((t) => t.codigo));
      expect(new Set(codigos).size).toBe(codigos.length);
      for (const q of fim) expect(q.tarefas.every((t) => t.codigo?.startsWith(`${q.prefixo}-`))).toBe(true);
      expect(fim[1]!.tarefas.some((t) => t.id === ta)).toBe(true);
      expect(fim[0]!.tarefas.some((t) => t.id === tb)).toBe(true);
    }
  });
});
