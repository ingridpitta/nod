import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { paraCadaPessoa, type OpcoesLaco } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import { computadoresRepo } from "../src/repositories/computadores.repo.ts";
import type { Db } from "../src/shared/types.ts";
import type { Docker } from "./computadores-orfaos.ts";

/**
 * definido em 2026-10-22 (NOD-96 PR 5, ADR-122): a passagem ao computador da pessoa no motor. Os computadores por bot
 * (docker) de cada pessoa são ARQUIVADOS (`arquivado_em`; os bots deixam de apontar para eles) e os containers deles
 * DESLIGADOS — os volumes ficam: guardam o login e os arquivos de alguém, e a pessoa pode querer algo de lá. A web mostra
 * uma vez o "Entre nos sites de novo uma vez" (`aviso_recriado`). Só com NOD_COMPUTADORES=motor.
 *
 *   npm run computador:legado                     # arquiva e desliga (idempotente)
 *   npm run computador:legado -- --apagar-volumes # além disso, apaga containers, rede e volumes arquivados há 30 dias ou mais
 */

export const PRAZO_VOLUMES_MS = 30 * 24 * 60 * 60 * 1000;

export type Legado = { id: string; arquivadoEm: number };
export type Plano = { desligar: string[]; apagar: string[]; aguardando: { id: string; dias: number }[] };

/** O que fazer com cada legado arquivado: todos desligam; com `--apagar-volumes`, só os de 30 dias ou mais apagam. */
export function planejar(legados: Legado[], agora: number, apagarVolumes: boolean): Plano {
  const plano: Plano = { desligar: legados.map((l) => l.id), apagar: [], aguardando: [] };
  if (!apagarVolumes) return plano;
  for (const l of legados) {
    const falta = l.arquivadoEm + PRAZO_VOLUMES_MS - agora;
    if (falta <= 0) plano.apagar.push(l.id);
    else plano.aguardando.push({ id: l.id, dias: Math.ceil(falta / (24 * 60 * 60 * 1000)) });
  }
  return plano;
}

const nomes = (id: string) => ({ maquina: `nod-computador-${id}`, proxy: `nod-egress-${id}`, rede: `nod-rede-${id}`, volumes: [`nod-computador-${id}-home`, `nod-computador-${id}-workspace`] });
/** O docker diz "No such ..." quando o objeto já não existe: aqui isso é o estado desejado, não falha. */
const jaNaoExiste = (e: unknown) => /no such|not found/i.test(e instanceof Error ? e.message : String(e));

/**
 * Desliga (`docker stop`) e, nos de `apagar`, remove containers, rede e volumes. Desligar NUNCA remove volume. Um item
 * que falha não para os outros.
 */
export function executar(plano: Plano, docker: Docker): { desligados: string[]; apagados: string[]; falhas: string[] } {
  const desligados: string[] = [];
  const apagados: string[] = [];
  const falhas: string[] = [];
  const tentar = (args: string[]): boolean => {
    try {
      docker(args);
      return true;
    } catch (e) {
      return jaNaoExiste(e);
    }
  };
  for (const id of plano.desligar) {
    const n = nomes(id);
    if (tentar(["stop", n.maquina]) && tentar(["stop", n.proxy])) desligados.push(id);
    else falhas.push(id);
  }
  for (const id of plano.apagar) {
    const n = nomes(id);
    const ok = [["rm", "--force", n.maquina], ["rm", "--force", n.proxy], ["network", "rm", n.rede], ...n.volumes.map((v) => ["volume", "rm", v])]
      .map(tentar)
      .every(Boolean);
    if (ok) apagados.push(id);
    else if (!falhas.includes(id)) falhas.push(id);
  }
  return { desligados, apagados, falhas };
}

/** Arquiva os por bot de cada pessoa (como nod_app, pessoa por pessoa: RLS) e devolve todos os arquivados. */
export async function arquivarTodos(db: Db, agora: number, listarPessoas?: OpcoesLaco["listarPessoas"]): Promise<Legado[]> {
  const legados: Legado[] = [];
  await paraCadaPessoa(
    db,
    (escopo, tx) => tx(async (trx) => {
      const repo = computadoresRepo(trx, escopo);
      await repo.arquivarLegado(agora);
      legados.push(...(await repo.legadosArquivados()));
    }),
    { ...(listarPessoas ? { listarPessoas } : {}), aoFalhar: (_escopo, erro) => { throw erro; } },
  );
  return legados;
}

const dockerReal: Docker = (args) => {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} falhou: ${(r.stderr || r.error?.message || "").split("\n")[0]}`);
  return r.stdout;
};

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  if (process.env.NOD_COMPUTADORES !== "motor") {
    escrever("Nada feito: a passagem ao computador da pessoa só roda com NOD_COMPUTADORES=motor.");
    process.exitCode = 1;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "legado_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const db = criarDb(url, { max: 1 });
  const agora = Date.now();
  let legados: Legado[];
  try {
    legados = await arquivarTodos(db, agora);
  } finally {
    await db.end({ timeout: 2 });
  }
  const plano = planejar(legados, agora, process.argv.includes("--apagar-volumes"));
  const r = executar(plano, dockerReal);
  escrever(`Computadores por bot arquivados: ${legados.length} · desligados: ${r.desligados.length}`);
  if (plano.apagar.length || plano.aguardando.length) escrever(`Apagados (30 dias ou mais): ${r.apagados.length}`);
  for (const a of plano.aguardando) escrever(`  ${a.id}: faltam ${a.dias} dia(s) para poder apagar os volumes`);
  if (r.falhas.length) {
    escrever(`Falharam: ${r.falhas.length} (rode de novo ou veja à mão).`);
    for (const id of r.falhas) escrever(`  ${id}`);
    process.exitCode = 1;
  }
  log("info", "computadores_legado", { arquivados: legados.length, desligados: r.desligados.length, apagados: r.apagados.length, falhas: r.falhas.length });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
