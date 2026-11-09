import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import { criarRotasDecisoesDoBot } from "../../src/adapters/http/rotas/decisoes-do-bot.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { DecisoesDto } from "../../src/contracts/decisoes-do-bot.ts";
import { BOM } from "../../src/domain/decisoes.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { FILTRO_DECISAO } from "../../src/repositories/trilha.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { ANA, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const DIA = "2026-10-29";
/** Meia-noite de São Paulo = 03:00 UTC. */
const sp = (hhmm: string, dia = DIA) => Date.parse(`${dia}T${hhmm}:00-03:00`);

describeIntegracao("NOD-70: decisões do bot (GET agentes/:id/decisoes e .csv)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (s) => {
            await vincularEscopo(s, escopo);
            caixa.valor = await fn(s);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    servidor = await servidorDeTeste([...criarRotasAgentes(deps), ...criarRotasDecisoesDoBot(deps)]);
  });
  afterAll(() => servidor.close());

  async function cenario(trx: Tx) {
    trxAtual = trx;
    const marlon = await servidor.entrar("marlon");
    const ana = await servidor.entrar("ana");
    const { agente } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa", nome: "Júlio Ação" })).json()) as { agente: Agente };
    const repos = criarRepos(trx, MARLON);
    const linha = (em: number, p: { ferramenta?: string; conectorId?: string | null; kind?: string; motivo?: string | null; regra: string; regraVersao?: number }) =>
      repos.trilha.registrar({ agenteId: agente.id, ferramenta: p.ferramenta ?? "github__create_issue", conectorId: p.conectorId ?? null, kind: p.kind ?? "tool_call", motivo: p.motivo ?? null, regra: p.regra, regraVersao: p.regraVersao ?? 1, em });
    return { marlon, ana, agente, linha };
  }

  it("o dia no fuso, as mais novas primeiro, contagem do período, filtro, cursor sem pular linha do mesmo instante, e a linha do nod some", async () => {
    await withRollback(MARLON, async (trx) => {
      const { marlon, agente, linha } = await cenario(trx);
      // Fora do dia em São Paulo (02:59 UTC do dia 29 = 23:59 do 28 lá; 03:00 UTC do 30 = 00:00 do 30 lá).
      await linha(Date.parse(`${DIA}T02:59:00Z`), { regra: "regra:modo_automatico" });
      await linha(Date.parse("2026-10-30T03:00:00Z"), { regra: "regra:modo_automatico" });
      // A chamada de ferramenta do próprio nod (sem conector, regra legada) não é decisão; outro kind também não.
      await linha(sp("10:00"), { ferramenta: "nod__lembrar", regra: "regra:chamar_ferramenta" });
      await linha(sp("10:01"), { kind: "conector_recuperado", regra: "regra:conector" });
      // A negação por falta de plano não é decisão de acesso (a Atividade também não a conta).
      await linha(sp("10:02"), { kind: "negacao", motivo: "plano_ausente", regra: "regra:plano_do_turno", conectorId: randomUUID() });
      // Revisão 2: o "peça aprovação" do manual (vira o cartão) e a falha do app (vem depois da permitida) não são negadas.
      await linha(sp("10:03"), { kind: "negacao", motivo: "alcance_insuficiente", regra: "regra:modo_manual", conectorId: randomUUID() });
      for (const motivo of ["conector_indisponivel", "timeout_transporte", "falha_tecnica"]) await linha(sp("10:04"), { kind: "negacao", motivo, regra: "regra:chamar_ferramenta", conectorId: randomUUID() });
      // Seis decisões; duas no mesmo instante (o cursor não pode pular a segunda).
      await linha(sp("09:00"), { ferramenta: "nativa__Bash", regra: "regra:clique" });
      await linha(sp("11:00"), { kind: "cartao", motivo: "acao_arriscada", regra: "regra:cartao", ferramenta: "terminal__bash" });
      await linha(sp("12:00"), { kind: "negacao", motivo: "retirado_pela_pessoa", regra: "regra:clique", ferramenta: "terminal__bash" });
      await linha(sp("13:00"), { conectorId: randomUUID(), regra: "regra:aprovacao_permanente", regraVersao: 2 });
      await linha(sp("14:00"), { conectorId: randomUUID(), regra: "regra:chamar_ferramenta" });
      await linha(sp("14:00"), { conectorId: randomUUID(), regra: "regra:consulta_sem_decisao" });

      const rota = (q: string) => `agentes/${agente.id}/decisoes?de=${DIA}&fuso=America/Sao_Paulo&${q}`;
      const tudo = (await (await servidor.chamar(marlon, "GET", rota(""))).json()) as DecisoesDto;
      expect(tudo.linhas.map((l) => l.em.slice(11, 16))).toEqual(["17:00", "17:00", "16:00", "15:00", "14:00", "12:00"]);
      expect(tudo.contagem).toEqual({ permitida: 4, negada: 1, cartao: 1 });
      expect(tudo.proximo).toBeNull();
      // A das 23:59 do dia 28 (em São Paulo) está antes do dia: "Dia anterior" aparece.
      expect(tudo.haAntes).toBe(true);
      expect(tudo.linhas.find((l) => l.regra === "regra:chamar_ferramenta")).toMatchObject({ frase: "regra não registrada", desfecho: "permitida" });
      expect(tudo.linhas.find((l) => l.desfecho === "cartao")).toMatchObject({ app: "terminal", acao: "bash", motivo: "acao_arriscada", frase: "Ação arriscada" });
      expect(tudo.linhas.find((l) => l.desfecho === "negada")).toMatchObject({ frase: "Você recusou no cartão" });

      // Filtro: só as negadas; a contagem continua a do período.
      const negadas = (await (await servidor.chamar(marlon, "GET", rota("desfecho=negada"))).json()) as DecisoesDto;
      expect(negadas.linhas.map((l) => l.desfecho)).toEqual(["negada"]);
      expect(negadas.contagem).toEqual(tudo.contagem);

      // Páginas de 1: percorre as seis sem repetir nem pular (inclusive as duas das 14:00).
      const ids: string[] = [];
      let cursor = "";
      for (let i = 0; i < 10; i++) {
        const p = (await (await servidor.chamar(marlon, "GET", rota(`limite=1${cursor ? `&cursor=${cursor}` : ""}`))).json()) as DecisoesDto;
        ids.push(...p.linhas.map((l) => l.id));
        if (!p.proximo) break;
        cursor = p.proximo;
      }
      expect(ids).toEqual(tudo.linhas.map((l) => l.id));

      // Período de dois dias pega a das 23:59 do dia 28.
      const doisDias = (await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/decisoes?de=2026-10-28&ate=${DIA}&fuso=America/Sao_Paulo`)).json()) as DecisoesDto;
      expect(doisDias.linhas).toHaveLength(7);
      expect(doisDias.haAntes).toBe(false);
      trxAtual = null;
    });
  });

  it("250 decisões em páginas de 100: 100 + 100 + 50, sem repetir nem pular; a consulta usa o índice 0128", async () => {
    await withRollback(MARLON, async (trx) => {
      const { marlon, agente, linha } = await cenario(trx);
      const conectorId = randomUUID();
      for (let i = 0; i < 250; i++) await linha(sp("09:00") + Math.floor(i / 3) * 1000, { conectorId, regra: "regra:modo_automatico" });
      const rota = (q: string) => `agentes/${agente.id}/decisoes?de=${DIA}&fuso=America/Sao_Paulo&limite=100${q}`;
      const tamanhos: number[] = [];
      const ids = new Set<string>();
      let cursor = "";
      for (let i = 0; i < 5; i++) {
        const p = (await (await servidor.chamar(marlon, "GET", rota(cursor ? `&cursor=${cursor}` : ""))).json()) as DecisoesDto;
        tamanhos.push(p.linhas.length);
        for (const l of p.linhas) ids.add(l.id);
        if (!p.proximo) break;
        cursor = p.proximo;
      }
      expect(tamanhos).toEqual([100, 100, 50]);
      expect(ids.size).toBe(250);
      // Sem seq scan à mão, o planejador tem de conseguir usar o índice parcial: o FILTRO_DECISAO casa com o predicado dele.
      await trx`set local enable_seqscan = off`;
      // A mesma consulta de decisoesDoAgente (dono, bot, faixa do dia, kinds, cursor), só com EXPLAIN na frente.
      const plano = await trx.unsafe(
        `explain select id from trilha where tenant_id = $1 and owner_id = $2 and agente_id = $3 and em >= $4 and em < $5 and ${FILTRO_DECISAO} and kind = any($6::text[])
           and (em, id) < (select c.em, c.id from trilha c where c.tenant_id = $1 and c.owner_id = $2 and c.agente_id = $3 and c.id = $7::uuid)
         order by em desc, id desc limit 101`,
        [MARLON.tenantId, MARLON.pessoaId, agente.id, new Date(sp("00:00")), new Date(sp("00:00") + 86_400_000), ["tool_call", "negacao", "cartao"], cursor],
      );
      expect(plano.map((r) => String(Object.values(r)[0])).join("\n")).toContain("trilha_decisoes_por_agente");
      trxAtual = null;
    });
  });

  it("CSV: BOM, cabeçalho, hora no fuso, nome do arquivo, filtro; período acima de 31 dias é 400", async () => {
    await withRollback(MARLON, async (trx) => {
      const { marlon, agente, linha } = await cenario(trx);
      await linha(sp("09:15"), { conectorId: randomUUID(), regra: "regra:modo_automatico", regraVersao: 3 });
      await linha(sp("10:30"), { kind: "cartao", motivo: "toca_credencial", regra: "regra:cartao" });
      const r = await servidor.chamar(marlon, "GET", `agentes/${agente.id}/decisoes.csv?de=${DIA}&fuso=America/Sao_Paulo`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(r.headers.get("content-disposition")).toBe(`attachment; filename="decisoes-julio-acao-${DIA}.csv"`);
      expect(r.headers.get("x-nod-csv-linhas")).toBe("2");
      const bytes = new Uint8Array(await r.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const corpo = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      expect(corpo.startsWith(BOM)).toBe(true);
      expect(corpo.slice(1).split("\r\n")).toEqual([
        "data,hora,desfecho,app,acao,regra,regra_codigo,regra_versao,motivo",
        `${DIA},10:30:00,Cartão,github,create_issue,Toca uma credencial,regra:cartao,1,toca_credencial`,
        `${DIA},09:15:00,Permitida,github,create_issue,Modo Automático,regra:modo_automatico,3,`,
        "",
      ]);
      const so = await servidor.chamar(marlon, "GET", `agentes/${agente.id}/decisoes.csv?de=${DIA}&fuso=America/Sao_Paulo&desfecho=permitida`);
      expect((await so.text()).trim().split("\r\n")).toHaveLength(2);
      expect((await servidor.chamar(marlon, "GET", `agentes/${agente.id}/decisoes.csv?de=2026-09-28&ate=${DIA}`)).status).toBe(400);
      expect((await servidor.chamar(marlon, "GET", `agentes/${agente.id}/decisoes.csv?de=2026-09-29&ate=${DIA}`)).status).toBe(200);
      trxAtual = null;
    });
  });

  it("HTTP: período, filtro, cursor, limite e fuso inválidos são 400; bot de outra pessoa, 404, na lista e no CSV", async () => {
    await withRollback(MARLON, async (trx) => {
      const { marlon, ana, agente, linha } = await cenario(trx);
      const rota = (q: string, csv = false) => `agentes/${agente.id}/decisoes${csv ? ".csv" : ""}?${q}`;
      expect((await servidor.chamar(marlon, "GET", rota(`de=${DIA}`))).status).toBe(200);
      for (const q of ["", "de=29-10-2026", "de=2026-02-30", `de=${DIA}&ate=2026-10-28`, `de=${DIA}&desfecho=talvez`, `de=${DIA}&cursor=x'or'1`, `de=${DIA}&limite=0`, `de=${DIA}&limite=501`, `de=${DIA}&limite=abc`, `de=${DIA}&fuso=-03:00`, `de=${DIA}&fuso=Marte/Olimpo`]) {
        expect((await servidor.chamar(marlon, "GET", rota(q))).status, q).toBe(400);
      }
      expect((await servidor.chamar(ana, "GET", rota(`de=${DIA}`))).status).toBe(404);
      // RLS com duas pessoas: no escopo da Ana o banco não devolve nenhuma linha da trilha do bot do Marlon, nem pelo repo
      // nem por um select cru sem o filtro de dono (a policy é que barra).
      await linha(sp("09:00"), { conectorId: randomUUID(), regra: "regra:modo_automatico" });
      await trx.savepoint(async (s) => {
        await vincularEscopo(s, ANA);
        const [daAnaCru] = await s<{ n: number }[]>`select count(*)::int as n from trilha where agente_id = ${agente.id}`;
        expect(daAnaCru?.n).toBe(0);
        const daAna = criarRepos(s, ANA).trilha;
        expect(await daAna.decisoesDoAgente({ agenteId: agente.id, desde: sp("00:00"), ate: sp("00:00") + 86_400_000, kinds: ["tool_call", "negacao", "cartao"], limite: 10 })).toEqual([]);
      });
      await vincularEscopo(trx, MARLON);
      const [doMarlon] = await trx<{ n: number }[]>`select count(*)::int as n from trilha where agente_id = ${agente.id}`;
      expect(doMarlon?.n).toBe(1);
      expect((await servidor.chamar(ana, "GET", rota(`de=${DIA}`, true))).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `agentes/${randomUUID()}/decisoes?de=${DIA}`)).status).toBe(404);
      // Cursor de uma linha que não existe (ou de outro tenant): página vazia, sem erro.
      const vazio = (await (await servidor.chamar(marlon, "GET", rota(`de=${DIA}&cursor=${randomUUID()}`))).json()) as DecisoesDto;
      expect(vazio.linhas).toEqual([]);
      trxAtual = null;
    });
  });
});
