import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { paraCadaPessoa, type OpcoesLaco } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import type { Db } from "../src/shared/types.ts";

/**
 * definido em 2026-10-05 (NOD-170): o que o nod deixou no Docker deste host sem dono no banco — containers e
 * redes com o rótulo nod.computador=true e volumes nod-computador-<id>-home|workspace cujo <id> não está em
 * `computadores`. Só lê. `--limpar` remove containers e redes e NUNCA volumes: o volume guarda o login e os
 * arquivos de alguém; apagá-lo é decisão da pessoa, à mão (docs/computadores.md).
 *
 *   npm run computador:orfaos            # lista
 *   npm run computador:orfaos -- --limpar
 */

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const CONTAINER = new RegExp(`^nod-(?:computador|egress)-(${UUID})$`);
const REDE = new RegExp(`^nod-rede-(${UUID})$`);
const VOLUME = new RegExp(`^nod-computador-(${UUID})-(?:home|workspace)$`);

export type NoDocker = { containers: string[]; redes: string[]; volumes: string[] };
export type Docker = (args: string[]) => string;

/** O que está no Docker (rótulo nod.computador=true; volumes pelo nome, que o driver não rotula). */
export function lerDocker(docker: Docker): NoDocker {
  const linhas = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    containers: linhas(docker(["ps", "-a", "--filter", "label=nod.computador=true", "--format", "{{.Names}}"])),
    redes: linhas(docker(["network", "ls", "--filter", "label=nod.computador=true", "--format", "{{.Name}}"])),
    volumes: linhas(docker(["volume", "ls", "--format", "{{.Name}}"])),
  };
}

/** Órfão: o nome segue o padrão do driver e o id não está em `computadores`. Nome fora do padrão não é do nod. */
export function acharOrfaos(d: NoDocker, conhecidos: ReadonlySet<string>): NoDocker {
  const orfao = (re: RegExp) => (nome: string) => {
    const m = re.exec(nome);
    return Boolean(m && !conhecidos.has(m[1]!));
  };
  return { containers: d.containers.filter(orfao(CONTAINER)), redes: d.redes.filter(orfao(REDE)), volumes: d.volumes.filter(orfao(VOLUME)) };
}

/**
 * Os ids de `computadores` de TODAS as pessoas. Precisa ser nod_app, pessoa por pessoa: a tabela tem FORCE ROW
 * LEVEL SECURITY com policy só para nod_app (0001), então um `select` como nod_dono, ou sem escopo, devolve ZERO
 * linhas sem erro — e aí todo container do host pareceria órfão. Pessoa que falha ABORTA (não é o laço de fundo
 * que segue em frente): um id faltando aqui vira um container ligado removido.
 */
export async function lerConhecidos(db: Db, listarPessoas?: OpcoesLaco["listarPessoas"]): Promise<Set<string>> {
  const ids = new Set<string>();
  await paraCadaPessoa(
    db,
    (_escopo, tx) => tx(async (trx) => {
      for (const l of await trx<{ id: string }[]>`select id from computadores`) ids.add(l.id);
    }),
    {
      ...(listarPessoas ? { listarPessoas } : {}),
      aoFalhar: (_escopo, erro) => { throw erro; },
    },
  );
  return ids;
}

/**
 * Banco sem nenhum computador e Docker com containers do nod: quase sempre é o banco ERRADO (o .env do clone
 * aponta para o banco de desenvolvimento, e o host roda computadores de outro banco). Limpar ali derrubaria
 * todos. Recusa; quem tem certeza remove à mão.
 */
export function podeLimpar(conhecidos: ReadonlySet<string>, orfaos: NoDocker): boolean {
  return conhecidos.size > 0 || orfaos.containers.length + orfaos.redes.length === 0;
}

/**
 * Remove containers (forçado: pode estar ligado) e depois as redes. Volumes ficam — de propósito. Um item que
 * falha não impede os outros: vai para `falhas` e o resto segue. Devolve o removido.
 */
export function limpar(o: NoDocker, docker: Docker): Pick<NoDocker, "containers" | "redes"> & { falhas: string[] } {
  const containers: string[] = [];
  const redes: string[] = [];
  const falhas: string[] = [];
  const tentar = (nome: string, args: string[], feitos: string[]) => {
    try {
      docker(args);
      feitos.push(nome);
    } catch {
      falhas.push(nome);
    }
  };
  for (const c of o.containers) tentar(c, ["rm", "--force", c], containers);
  for (const r of o.redes) tentar(r, ["network", "rm", r], redes);
  return { containers, redes, falhas };
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
  // nod_app, não nod_dono: o dono não tem policy em `computadores` e leria zero linhas (lerConhecidos).
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "orfaos_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const db = criarDb(url, { max: 1 });
  let conhecidos: Set<string>;
  try {
    conhecidos = await lerConhecidos(db);
  } finally {
    await db.end({ timeout: 2 });
  }
  const orfaos = acharOrfaos(lerDocker(dockerReal), conhecidos);
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  const banco = new URL(url);
  escrever(`Banco: ${banco.host}${banco.pathname} · computadores no banco: ${conhecidos.size}`);
  for (const [rotulo, nomes] of [["Containers órfãos", orfaos.containers], ["Redes órfãs", orfaos.redes], ["Volumes órfãos", orfaos.volumes]] as const) {
    escrever(`${rotulo}: ${nomes.length}`);
    for (const n of nomes) escrever(`  ${n}`);
  }
  if (!process.argv.includes("--limpar")) {
    if (orfaos.containers.length || orfaos.redes.length) escrever("Para remover containers e redes: npm run computador:orfaos -- --limpar");
    if (orfaos.volumes.length) escrever("Volumes nunca são removidos por este script; veja docs/computadores.md.");
    return;
  }
  if (!podeLimpar(conhecidos, orfaos)) {
    escrever("Nada removido: o banco não tem nenhum computador, e o Docker tem. Confira se DATABASE_URL é o banco deste host.");
    process.exitCode = 1;
    return;
  }
  const removido = limpar(orfaos, dockerReal);
  escrever(`Removidos: ${removido.containers.length} containers e ${removido.redes.length} redes.`);
  for (const n of [...removido.containers, ...removido.redes]) escrever(`  ${n}`);
  if (removido.falhas.length) {
    escrever(`Falharam: ${removido.falhas.length} (rode de novo ou remova à mão).`);
    for (const n of removido.falhas) escrever(`  ${n}`);
    process.exitCode = 1;
  }
  log("info", "computadores_orfaos_limpos", { containers: removido.containers.length, redes: removido.redes.length, falhas: removido.falhas.length, volumes_mantidos: orfaos.volumes.length });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
