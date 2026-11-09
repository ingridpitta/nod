import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { encerrarLigacoesOrfas } from "../../src/adapters/fundo/ligacoes-orfas.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { VERSAO_CONSENTIMENTO_VOZ, type Ligacao } from "../../src/contracts/ligacao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-218 (deploy azul/verde, emenda da ADR-017): dois `boot()` vivos sobre o mesmo banco e a mesma pessoa, como na
 * sobreposição do deploy. Quem decide quem liga os laços é o marcador `cor-ativa` (aqui um arquivo temporário, relido a
 * cada 50 ms), nunca a ordem de subida.
 *  1. Azul ativa + verde passiva: a verde atende HTTP, mas não despacha turno nem consome o outbox.
 *  2. O marcador vira verde: as duas ficam com os laços ligados (a azul só para na drenagem). N turnos e M rotinas
 *     vencidas: cada um roda uma vez (SKIP LOCKED e janela UNIQUE, ADR-011).
 *  3. A ligação aberta pela azul não é encerrada pelo boot da verde; o script de órfãs da azul a fecha.
 */
const N_TURNOS = 6;
const M_ROTINAS = 3;

describeIntegracao("NOD-218: dois processos (azul e verde) no mesmo banco", () => {
  let dir = "";
  let azul: ServidorCompleto | null = null;
  let verde: ServidorCompleto | null = null;
  const criados = { agentes: [] as string[], conversas: [] as string[] };

  afterAll(async () => {
    await verde?.fechar();
    await azul?.fechar();
    if (azul) await limparPessoaE2E(azul.db, azul.dbDono, azul.pessoa, criados);
    await verde?.desligar();
    await azul?.desligar();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("passiva não despacha; com as duas ativas cada turno e cada rotina rodam uma vez; a ligação da azul sobrevive ao boot da verde", async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-cor-"));
    const arquivo = join(dir, "cor-ativa");
    // Como o deploy.sh: tmp + mv (atômico); o processo nunca lê meio arquivo.
    const marcar = async (cor: string) => {
      await writeFile(`${arquivo}.tmp`, `${cor}\n`);
      await rename(`${arquivo}.tmp`, arquivo);
    };
    await marcar("azul");
    const corAtiva = { arquivo, intervaloMs: 50 };
    const env = { NOD_LIGACAO: "todas" };

    azul = await servidorCompleto({ env: { ...env, NOD_COR: "azul" }, corAtiva });
    const a = azul;
    expect(a.estado()).toMatchObject({ ativa: true, cor: "azul", lacosLigados: true });

    const escopado = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> =>
      a.db.begin(async (trx) => {
        await vincularEscopo(trx, a.pessoa);
        return fn(trx);
      }) as Promise<T>;

    // A ligação nasce na azul com instancia = azul (sem WebSocket: fica 'chamando', viva para o repo).
    const { agente: nina } = await a.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    criados.agentes.push(nina.id);
    await a.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await a.json<{ ligacao: Ligacao }>("POST", "ligacoes", { agenteId: nina.id });
    const linhaLigacao = async () => (await escopado((trx) => trx<{ estado: string; instancia: string | null }[]>`select estado, instancia from ligacoes where id = ${ligacao.id}`))[0];
    expect(await linhaLigacao()).toEqual({ estado: "chamando", instancia: "azul" });

    // A verde sobe depois, passiva. O boot dela (passo 5) só olha as ligações da verde.
    verde = await servidorCompleto({ env: { ...env, NOD_COR: "verde" }, pessoaId: a.pessoa.pessoaId, corAtiva });
    const v = verde;
    expect(v.estado()).toMatchObject({ pronto: true, ativa: false, cor: "verde", lacosLigados: false });
    expect(await linhaLigacao()).toEqual({ estado: "chamando", instancia: "azul" });

    const lb = async (s: ServidorCompleto) => {
      const r = await fetch(`${s.url}/api/saude/lb`);
      return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
    };
    expect(await lb(a)).toEqual({ status: 200, corpo: { ok: true, cor: "azul" } });
    expect(await lb(v)).toEqual({ status: 503, corpo: { ok: false, cor: "verde", motivo: "inativa" } });
    // /api/saude não olha a cor: a passiva está saudável para o Docker.
    expect((await fetch(`${v.url}/api/saude`)).status).toBe(200);

    const conversaCom = async (s: ServidorCompleto, nome: string, texto: string) => {
      const r = await s.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
      criados.agentes.push(r.agente.id);
      criados.conversas.push(r.conversa.id);
      await s.json("POST", `conversas/${r.conversa.id}/mensagens`, { texto });
      return r.conversa.id;
    };
    const respostas = (conversaId: string, texto: string) =>
      escopado(async (trx) => (await criarRepos(trx, a.pessoa).mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "texto" && m.texto === texto).length);
    const turnosDa = (conversaId: string) =>
      escopado((trx) => trx<{ estado: string; machine_id: string | null }[]>`select estado, machine_id from turnos where conversa_id = ${conversaId}`);

    // 1. Mensagem pela HTTP da verde (passiva): quem despacha é a azul; o outbox também é dela.
    const c0 = await conversaCom(v, "Pela verde", "[[texto: resposta 0]]");
    await a.esperar(async () => (await turnosDa(c0)).every((t) => t.estado === "concluido"), { nome: "turno da passiva concluído" });
    expect((await turnosDa(c0)).map((t) => t.machine_id)).toEqual([a.machineId]);
    expect(v.estado().lacosLigados).toBe(false);

    // 2. O marcador vira verde: a verde liga os laços; a azul segue com os dela até drenar (aqui as duas despacham).
    await marcar("verde");
    await v.esperar(async () => v.estado().lacosLigados, { nome: "verde ligou os laços" });
    await a.esperar(async () => !a.estado().ativa, { nome: "azul inativa" });
    expect(a.estado().lacosLigados).toBe(true);
    expect(await lb(v)).toEqual({ status: 200, corpo: { ok: true, cor: "verde" } });
    expect(await lb(a)).toEqual({ status: 503, corpo: { ok: false, cor: "azul", motivo: "inativa" } });

    const conversas = await Promise.all(Array.from({ length: N_TURNOS }, (_, i) => conversaCom(i % 2 ? a : v, `Bot ${i + 1}`, `[[texto: resposta ${i + 1}]]`)));
    // Rotinas vencidas, gravadas direto no banco: os dois schedulers as veem no mesmo tick.
    const rotinas: { id: string; conversaId: string }[] = [];
    await escopado(async (trx) => {
      const repos = criarRepos(trx, a.pessoa);
      for (let i = 0; i < M_ROTINAS; i++) {
        const agenteId = randomUUID();
        const conversaId = randomUUID();
        const id = randomUUID();
        await repos.agentes.criar({ id: agenteId, nome: `Agendada ${i + 1}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
        await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
        await repos.rotinas.criar({ id, agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "[[texto: feito]]", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() - 60_000 });
        criados.agentes.push(agenteId);
        criados.conversas.push(conversaId);
        rotinas.push({ id, conversaId });
      }
    });

    await a.esperar(
      async () => (await Promise.all(conversas.map(turnosDa))).every((ts) => ts.length === 1 && ts[0]!.estado === "concluido"),
      { nome: "N turnos concluídos", timeoutMs: 20_000 },
    );
    for (const [i, c] of conversas.entries()) expect(await respostas(c, `resposta ${i + 1}`)).toBe(1);
    // Cada rotina: uma janela e um turno, mesmo com os dois schedulers ligados.
    await a.esperar(async () => (await Promise.all(rotinas.map((r) => turnosDa(r.conversaId)))).every((ts) => ts.length >= 1), { nome: "M rotinas disparadas", timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 600)); // 3 ticks do scheduler de teste: dá chance a um disparo em dobro aparecer
    for (const r of rotinas) {
      expect(await turnosDa(r.conversaId)).toHaveLength(1);
      expect(await escopado(async (trx) => (await criarRepos(trx, a.pessoa).rotinaJanelas.listar(r.id)).length)).toBe(1);
    }

    // 3. A ligação da azul seguiu viva o tempo todo; o script de órfãs da verde não a toca, o da azul a fecha.
    expect(await linhaLigacao()).toEqual({ estado: "chamando", instancia: "azul" });
    const listarPessoas = async () => [{ tenantId: a.pessoa.tenantId, id: a.pessoa.pessoaId }];
    expect((await encerrarLigacoesOrfas(a.db, { instancia: "verde", listarPessoas })).encerradas).toEqual([]);
    expect((await encerrarLigacoesOrfas(a.db, { instancia: "azul", listarPessoas })).encerradas).toEqual([ligacao.id]);
    expect((await linhaLigacao())?.estado).not.toBe("chamando");
  }, 60_000);
});

/**
 * NOD-331 (item 6): no modo compartilhado (o da VM), com o marcador já na verde, a azul drena com um tick preso (o
 * varredor de expiração pendurado em `listarPessoas`). Passada a etapa dos laços (com prazo), a azul não faz mais
 * nenhuma passada: os laços em dobro acabam ali, enquanto a verde segue sozinha e cada rotina vencida roda uma vez.
 */
describeIntegracao("NOD-331: a azul drenando com um tick preso para os laços; a verde segue", () => {
  type Pessoas = { tenantId: string; id: string }[];
  let dir = "";
  let azul: ServidorCompleto | null = null;
  let verde: ServidorCompleto | null = null;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  let travado = false;
  const presos: (() => void)[] = [];
  const soltar = () => {
    travado = false;
    for (const p of presos.splice(0)) p();
  };
  let ticksAzul = 0;
  let ticksVerde = 0;

  afterAll(async () => {
    soltar();
    await verde?.fechar();
    await azul?.fechar();
    if (azul) await limparPessoaE2E(azul.db, azul.dbDono, azul.pessoa, criados);
    await verde?.desligar();
    await azul?.desligar();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("depois da etapa dos laços a azul não passa mais; a verde segue e cada rotina vencida roda uma vez", async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-cor-"));
    const arquivo = join(dir, "cor-ativa");
    const marcar = async (cor: string) => {
      await writeFile(`${arquivo}.tmp`, `${cor}\n`);
      await rename(`${arquivo}.tmp`, arquivo);
    };
    await marcar("azul");
    const corAtiva = { arquivo, intervaloMs: 50 };

    // Sem orquestrador no compartilhado: cada chamada de `listarPessoas` é uma passada de um dos laços.
    azul = await servidorCompleto({
      env: { NOD_MODO: "compartilhado", NOD_COR: "azul" },
      corAtiva,
      envolverListarPessoas: (listar) => (): Promise<Pessoas> => {
        ticksAzul += 1;
        if (travado && (new Error().stack ?? "").includes("varredor-expiracao")) return new Promise<Pessoas>((r) => { presos.push(() => void listar().then(r)); });
        return listar();
      },
    });
    const a = azul;
    verde = await servidorCompleto({
      env: { NOD_MODO: "compartilhado", NOD_COR: "verde" },
      pessoaId: a.pessoa.pessoaId,
      corAtiva,
      envolverListarPessoas: (listar) => () => {
        ticksVerde += 1;
        return listar();
      },
    });
    const v = verde;

    await marcar("verde");
    await v.esperar(async () => v.estado().lacosLigados, { nome: "verde ligou os laços" });
    await a.esperar(async () => !a.estado().ativa, { nome: "azul inativa" });
    expect(a.estado().lacosLigados).toBe(true);

    travado = true;
    await a.esperar(async () => presos.length > 0, { nome: "varredor da azul preso" });
    const drenagem = await a.drenar({ prazoMs: 5_000, intervaloMs: 50, prazoLacosMs: 500 });
    expect(drenagem.lacos_prazo_vencido).toBe(true);
    // `lacosLigados` só cai quando o tick preso termina; o que prova a parada é o contador de passadas abaixo.
    const azulDepois = ticksAzul;
    const verdeDepois = ticksVerde;

    const escopado = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> =>
      v.db.begin(async (trx) => {
        await vincularEscopo(trx, v.pessoa);
        return fn(trx);
      }) as Promise<T>;
    const turnosDa = (conversaId: string) => escopado((trx) => trx<{ id: string }[]>`select id from turnos where conversa_id = ${conversaId}`);
    const rotinas: { id: string; conversaId: string }[] = [];
    await escopado(async (trx) => {
      const repos = criarRepos(trx, v.pessoa);
      for (let i = 0; i < M_ROTINAS; i++) {
        const agenteId = randomUUID();
        const conversaId = randomUUID();
        const id = randomUUID();
        await repos.agentes.criar({ id: agenteId, nome: `Depois ${i + 1}`, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
        await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
        await repos.rotinas.criar({ id, agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "[[texto: feito]]", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() - 60_000 });
        criados.agentes.push(agenteId);
        criados.conversas.push(conversaId);
        rotinas.push({ id, conversaId });
      }
    });
    await v.esperar(async () => (await Promise.all(rotinas.map((r) => turnosDa(r.conversaId)))).every((ts) => ts.length >= 1), { nome: "rotinas disparadas pela verde", timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 600)); // 3 ticks do scheduler de teste
    for (const r of rotinas) {
      expect(await turnosDa(r.conversaId)).toHaveLength(1);
      expect(await escopado(async (trx) => (await criarRepos(trx, v.pessoa).rotinaJanelas.listar(r.id)).length)).toBe(1);
    }
    // A azul não passou mais (o tick preso já estava contado); a verde seguiu passando.
    expect(ticksAzul).toBe(azulDepois);
    expect(ticksVerde).toBeGreaterThan(verdeDepois);
  }, 60_000);
});
