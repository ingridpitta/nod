import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { boot, type ServidorNod } from "../../src/adapters/http/boot.ts";
import { lerCookieSessao } from "../../src/adapters/http/sessao.ts";
import { PAGINA_ENTROU } from "../../src/adapters/http/sessao-google.ts";
import { admitirPorDominio, buscarPorEmail } from "../../src/repositories/pessoas.repo.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { CLIENT_ID, claimsBoas, respostaComIdToken } from "../helpers/google-falso.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { CHAVE_DE_TESTE } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Emenda de 2026-10-05 da ADR-030, com as duas conexões de verdade: o dono abre o domínio e COMMITA, e é o pool
 * nod_app (o das requisições) que admite. No modo integration isso não aparece: a linha do domínio vive numa
 * transação do dono que nod_app não enxerga. Limpeza própria por id e por domínio, como nod_dono.
 */
describeIntegracao("concorrência: admissão por domínio com nod_app de verdade", () => {
  const dominio = `admitido-${randomUUID().slice(0, 8)}.com.br`;
  const SEGREDO = "segredo-do-teste-de-admissao-com-40-chars";
  const criadas: string[] = [];

  beforeAll(async () => {
    await dbDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
    await dbDono`insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${TENANT_PADRAO})`;
  });

  afterEach(async () => {
    for (const pessoaId of criadas.splice(0)) await limparPessoaE2E(db, dbDono, { tenantId: TENANT_PADRAO, pessoaId }, { agentes: [], conversas: [] });
  });

  afterAll(async () => {
    await dbDono`delete from pessoas where email like ${`%@${dominio}`}`;
    await dbDono`delete from dominios_admitidos where dominio = ${dominio}`;
  });

  it("nod_app não escreve em pessoas nem toca em dominios_admitidos: o único caminho é a função", async () => {
    const recusa = async (fn: () => Promise<unknown>) => (await fn().then(() => null, (e: { code?: string }) => e.code)) ?? "passou";
    expect(await recusa(() => db`insert into pessoas (tenant_id, id, nome, iniciais, email) values (${TENANT_PADRAO}, ${randomUUID()}, 'Intrusa', 'IN', ${`intrusa@${dominio}`})`)).toBe("42501");
    expect(await recusa(() => db`update pessoas set email = ${`intrusa@${dominio}`} where false`)).toBe("42501");
    expect(await recusa(() => db`select dominio from dominios_admitidos`)).toBe("42501");
    expect(await recusa(() => db`insert into dominios_admitidos (dominio, tenant_id) values (${`outro-${dominio}`}, ${TENANT_PADRAO})`)).toBe("42501");
    expect(await recusa(() => db`delete from dominios_admitidos`)).toBe("42501");
    // E o domínio que o dono não abriu continua fechado para o mesmo pool.
    expect(await admitirPorDominio(db, { email: `ana@outro-${dominio}`, nome: "Ana", iniciais: "AN" })).toBeNull();
  });

  it("duas primeiras entradas ao mesmo tempo: uma cria, a outra recebe a mesma pessoa, e fica uma linha só", async () => {
    const email = `corrida-${randomUUID().slice(0, 8)}@${dominio}`;
    const resultados = await Promise.all(Array.from({ length: 4 }, () => admitirPorDominio(db, { email, nome: "Corrida", iniciais: "CO" })));
    const ids = new Set(resultados.map((r) => r?.id));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    if (id) criadas.push(id);
    expect(resultados.filter((r) => r?.criada)).toHaveLength(1);
    const [{ n } = { n: -1 }] = await dbDono<{ n: number }[]>`select count(*)::int as n from pessoas where email = ${email}`;
    expect(n).toBe(1);
    expect(await buscarPorEmail(db, email)).toMatchObject({ id, tenantId: TENANT_PADRAO });
  });

  it("servidor inteiro: o boot abre o domínio da variável e a conta nova entra pelo Google, logada e com o onboarding de pé", async () => {
    // O banco de teste precisa ter um tenant só para o boot escolher onde a pessoa nasce (fail-closed no resto).
    const [{ tenants } = { tenants: 0 }] = await dbDono<{ tenants: number }[]>`select count(*)::int as tenants from tenants`;
    expect(tenants).toBe(1);

    const email = `marcelo.silva@${dominio}`;
    const real = globalThis.fetch;
    // Só a troca do code com o Google é falsa; as chamadas do teste ao servidor passam.
    vi.stubGlobal("fetch", (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      String(entrada).startsWith("https://oauth2.googleapis.com/token") ? Promise.resolve(respostaComIdToken(claimsBoas(Date.now(), { hd: dominio, email }))) : real(entrada, init),
    );
    let servidor: ServidorNod | undefined;
    try {
      servidor = await boot({
        env: {
          ...process.env,
          NOD_EXECUTOR: "catcher",
          NOD_LOGIN: "google",
          NOD_GOOGLE_CLIENT_ID: CLIENT_ID,
          NOD_GOOGLE_CLIENT_SECRET: "segredo-do-cliente-oauth",
          NOD_GOOGLE_REDIRECT_URI: "http://127.0.0.1:5274/api/sessao/google/callback",
          NOD_GOOGLE_DOMINIO: undefined,
          NOD_ADMISSAO_DOMINIOS: ` @${dominio.toUpperCase()} `,
          NOD_SESSAO_SEGREDO: SEGREDO,
          NOD_CREDENTIAL_KEY: CHAVE_DE_TESTE,
          NOD_MACHINE_ID: randomUUID(),
          NOD_VOZ_STT: "falso",
          NOD_VOZ_TTS: "falso",
          // ADR-096: o servidor de teste nunca limpa o ~/nod de quem roda a suíte.
          NOD_LIMPEZA_TASKS: "desligada",
        },
        db,
        dbDono,
        porta: 0,
        intervalos: { orquestradorMs: 3_600_000, schedulerMs: 3_600_000, leaseMs: 3_600_000, expiracaoMs: 3_600_000, outboxMs: 3_600_000, ociosidadeMs: 3_600_000 },
        listarPessoas: async () => [],
        segredoSessao: SEGREDO,
      });
      // O boot igualou a tabela à variável (normalizada): só o domínio deste teste está aberto.
      expect((await dbDono<{ dominio: string }[]>`select dominio from dominios_admitidos`).map((l) => l.dominio)).toEqual([dominio]);

      const entrar = async () => {
        const a = await real(`${servidor?.url}/api/sessao/google`, { redirect: "manual" });
        const state = new URL(a.headers.get("location") ?? "").searchParams.get("state") ?? "";
        const cookie = (a.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        return real(`${servidor?.url}/api/sessao/google/callback?code=x&state=${encodeURIComponent(state)}`, { redirect: "manual", headers: { cookie } });
      };
      const r = await entrar();
      expect(await r.text()).toBe(PAGINA_ENTROU);
      const sessao = r.headers.getSetCookie().find((c) => c.startsWith("nod_sessao="))?.split(";")[0] ?? "";
      const escopo = lerCookieSessao(sessao.slice("nod_sessao=".length), SEGREDO);
      expect(escopo?.tenantId).toBe(TENANT_PADRAO);
      if (escopo) criadas.push(escopo.pessoaId);

      // A pessoa existe de verdade, com o nome tirado do endereço, e a segunda entrada é a MESMA pessoa.
      const [linha] = await dbDono<{ id: string; nome: string; iniciais: string }[]>`select id, nome, iniciais from pessoas where email = ${email}`;
      expect(linha).toEqual({ id: escopo?.pessoaId, nome: "Marcelo Silva", iniciais: "MS" });
      const r2 = await entrar();
      const sessao2 = r2.headers.getSetCookie().find((c) => c.startsWith("nod_sessao="))?.split(";")[0] ?? "";
      expect(lerCookieSessao(sessao2.slice("nod_sessao=".length), SEGREDO)).toEqual(escopo);

      // Com a sessão nova, as rotas escopadas respondem: quem acabou de ser admitida cai no onboarding, não num erro.
      const eu = await real(`${servidor.url}/api/sessao`, { headers: { cookie: sessao } });
      expect(await eu.json()).toEqual(escopo);
      const onboarding = await real(`${servidor.url}/api/t/${TENANT_PADRAO}/onboarding`, { headers: { cookie: sessao } });
      expect(onboarding.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      await servidor?.fechar();
      // O boot esvaziou a tabela do que não estava na variável; o domínio do teste volta para os casos seguintes.
      await dbDono`insert into dominios_admitidos (dominio, tenant_id) values (${dominio}, ${TENANT_PADRAO}) on conflict do nothing`;
    }
  });
});
