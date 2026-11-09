import { randomUUID } from "node:crypto";
import { boot, type OpcoesBoot, type ServidorNod } from "../../src/adapters/http/boot.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { criarDb } from "../../src/db/client.ts";
import type { Db, Escopo } from "../../src/shared/types.ts";
import { urlDonoDeTeste } from "./db-dono.ts";
import { TENANT_PADRAO } from "./ids.ts";

/** definido em 2026-09-16: segredo e chave FIXOS do servidor de teste — nunca os do .env (a suíte não lê credencial). */
export const SEGREDO_DE_TESTE = "segredo-de-teste";
export const CHAVE_DE_TESTE = "0000000000000000000000000000000000000000000000000000000000000002";

export type SessaoDeTeste = { cookie: string; tenantId: string; pessoaId: string };

export type ServidorCompleto = ServidorNod & {
  db: Db;
  dbDono: Db;
  /** A pessoa PRÓPRIA deste servidor (linha real em `pessoas`, criada como nod_dono): a fila e os laços são dela. */
  pessoa: SessaoDeTeste;
  /** Cookie assinado para qualquer pessoa (só quem existe em `pessoas` é vista pelos laços). */
  sessaoDe(escopo: Escopo): SessaoDeTeste;
  chamar(metodo: string, caminho: string, corpo?: unknown, sessao?: SessaoDeTeste): Promise<Response>;
  /** GET/POST já em JSON tipado pelo chamador; lança em status fora de 2xx com o corpo seguro. */
  json<T>(metodo: string, caminho: string, corpo?: unknown, sessao?: SessaoDeTeste): Promise<T>;
  /** Espera até `fn` devolver algo não-null (frames, laços de fundo). */
  esperar<T>(fn: () => Promise<T | null | undefined | false>, opcoes?: { timeoutMs?: number; intervaloMs?: number; nome?: string }): Promise<T>;
  /** Depois de `fechar()` e da limpeza do chamador: encerra os pools. */
  desligar(): Promise<void>;
};

export type OpcoesServidorCompleto = {
  computador?: OpcoesBoot["computador"];
  env?: Record<string, string | undefined>;
  intervalos?: OpcoesBoot["intervalos"];
  /**
   * NOD-214: reusa a pessoa de um servidor anterior sobre o mesmo banco (o "processo novo" do deploy). Ausente = uma
   * pessoa nova. Quem passa limpa uma vez só, pelo servidor que a criou.
   */
  pessoaId?: string;
  /** Nome da pessoa própria (default 'Pessoa E2E'). */
  nomePessoa?: string;
  /** Pessoas ADICIONAIS que os laços devem enxergar (default: só a própria). */
  pessoasExtras?: Escopo[];
  drivers?: OpcoesBoot["drivers"];
  /** Provedores de voz prontos (NOD-180), para observar o TTS falso. */
  voz?: OpcoesBoot["voz"];
  /** O prazo da rede de 2 min (ADR-083 §2) para o e2e da #193 não esperar 120 s; ausente = REDE_MS. */
  redeMs?: number;
  /** NOD-267: envolve a fonte das pessoas dos laços (o teste do tick travado a pendura depois do boot). */
  envolverListarPessoas?: (listar: () => Promise<{ tenantId: string; id: string }[]>) => () => Promise<{ tenantId: string; id: string }[]>;
  /** NOD-267: o watchdog do compartilhado com intervalo, carência e saída de teste. */
  watchdog?: OpcoesBoot["watchdog"];
  /** NOD-218: o marcador da cor ativa (arquivo temporário do teste) e o intervalo de releitura. Vale com `env.NOD_COR`. */
  corAtiva?: OpcoesBoot["corAtiva"];
  /** NOD-398: o capturador de tela (vale com `env.NOD_CAPTURA_TELA: "1"`); ausente = o Chrome de verdade. */
  capturador?: OpcoesBoot["capturador"];
  /** NOD-132: o assinador da URL do ZIP (vale com `env.NOD_APP_VERSAO_PUBLICADA`); ausente = o signBlob de verdade. */
  assinadorAtualizacaoApp?: OpcoesBoot["assinadorAtualizacaoApp"];
};

/**
 * Servidor COMPLETO (compor.ts + boot.ts) em porta 0 sobre o banco de teste, com NOD_EXECUTOR=catcher
 * (custo zero) e laços de fundo em intervalos curtos. Não é o servidor-de-teste da L3 (EMENDA 7: aquele
 * recebe rotas e deps de uma lane; este sobe o app inteiro). As linhas COMMITAM: a pessoa própria nasce
 * em `pessoas` como nod_dono e quem chama limpa por id ao fim (modo concurrency, ADR-011 refinado).
 */
export async function servidorCompleto(o: OpcoesServidorCompleto = {}): Promise<ServidorCompleto> {
  const urlTeste = process.env.DATABASE_URL_TEST;
  if (!urlTeste) throw new Error("servidorCompleto exige DATABASE_URL_TEST");
  // definido em 2026-09-16: 6 conexões — rota (1) + conector carregado (1) + ponte/laços (≤3) sem enfileirar sob carga.
  const db = criarDb(urlTeste, { max: 6 });
  const dbDono = criarDb(urlDonoDeTeste(), { max: 1 });
  const pessoaId = o.pessoaId ?? randomUUID();
  const escopo: Escopo = { tenantId: TENANT_PADRAO, pessoaId };
  // O CI nunca roda seed (Práticas §6): o tenant de identidade nasce aqui como nod_dono (idempotente) e fica — é catálogo, não dado.
  await dbDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
  await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${TENANT_PADRAO}, ${pessoaId}, ${o.nomePessoa ?? "Pessoa E2E"}, 'PE') on conflict do nothing`;
  const visiveis = [escopo, ...(o.pessoasExtras ?? [])];

  const env = {
    ...process.env,
    NOD_EXECUTOR: "catcher",
    // O e2e cunha o cookie direto (sessaoDe); o modo só precisa ser explícito para o boot subir (ADR-030).
    NOD_LOGIN: "stub",
    NOD_SESSAO_SEGREDO: SEGREDO_DE_TESTE,
    NOD_CREDENTIAL_KEY: CHAVE_DE_TESTE,
    NOD_HOME: process.env.NOD_HOME ?? "~/.nod",
    NOD_MACHINE_ID: randomUUID(),
    // ADR-071: voz falsa (sem whisper nem say) — custo zero e determinística.
    NOD_VOZ_STT: "falso",
    NOD_VOZ_TTS: "falso",
    // ADR-096: a limpeza das tasks liga por padrão e lê o disco a cada 5 min. O servidor de teste roda no modo local, com o
    // HOME de quem roda a suíte: ligada, ela mexeria no ~/nod e nos caches dessa pessoa. O teste que precisa dela liga.
    NOD_LIMPEZA_TASKS: "desligada",
    // NOD-398 (revisão 12): o servidor de teste escuta e é chamado em 127.0.0.1; um NOD_HOST herdado do shell não vale.
    NOD_HOST: "127.0.0.1",
    ...(o.env ?? {}),
  };
  const servidor = await boot({
    env,
    db,
    dbDono,
    porta: 0,
    intervalos: { orquestradorMs: 50, schedulerMs: 200, leaseMs: 200, expiracaoMs: 200, outboxMs: 40, ociosidadeMs: 3_600_000, ...(o.intervalos ?? {}) },
    listarPessoas: (o.envolverListarPessoas ?? ((l) => l))(async () => visiveis.map((p) => ({ tenantId: p.tenantId, id: p.pessoaId }))),
    segredoSessao: SEGREDO_DE_TESTE,
    drivers: o.drivers,
    computador: o.computador,
    voz: o.voz,
    redeMs: o.redeMs,
    // NOD-267: o `process.exit` do watchdog derrubaria o worker do vitest numa suíte lenta; o teste que quer ver a saída injeta.
    watchdog: { sair: () => undefined, ...o.watchdog },
    corAtiva: o.corAtiva,
    capturador: o.capturador,
    assinadorAtualizacaoApp: o.assinadorAtualizacaoApp,
  });

  const sessaoDe = (e: Escopo): SessaoDeTeste => ({ cookie: `nod_sessao=${cunharCookie(e, SEGREDO_DE_TESTE)}`, tenantId: e.tenantId, pessoaId: e.pessoaId });
  const pessoa = sessaoDe(escopo);
  const chamar = (metodo: string, caminho: string, corpo?: unknown, sessao: SessaoDeTeste = pessoa) =>
    fetch(`${servidor.url}/api/t/${sessao.tenantId}/${caminho.replace(/^\//, "")}`, {
      method: metodo,
      headers: { cookie: sessao.cookie, "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });

  return {
    ...servidor,
    db,
    dbDono,
    pessoa,
    sessaoDe,
    chamar,
    async json<T>(metodo: string, caminho: string, corpo?: unknown, sessao?: SessaoDeTeste): Promise<T> {
      const r = await chamar(metodo, caminho, corpo, sessao);
      const texto = await r.text();
      if (r.status < 200 || r.status >= 300) throw new Error(`${metodo} ${caminho} → ${r.status} ${texto}`);
      return JSON.parse(texto) as T;
    },
    async esperar<T>(fn: () => Promise<T | null | undefined | false>, opcoes: { timeoutMs?: number; intervaloMs?: number; nome?: string } = {}): Promise<T> {
      const limite = Date.now() + (opcoes.timeoutMs ?? 10_000);
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > limite) throw new Error(`esperar(${opcoes.nome ?? "condição"}) estourou ${opcoes.timeoutMs ?? 10_000} ms`);
        await new Promise((r) => setTimeout(r, opcoes.intervaloMs ?? 50));
      }
    },
    async fechar() {
      await servidor.fechar();
    },
    async desligar() {
      await db.end({ timeout: 2 });
      await dbDono.end({ timeout: 2 });
    },
  };
}
