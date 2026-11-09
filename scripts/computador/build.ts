import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * definido em 2026-10-22 (NOD-93, PR 1): a imagem do computador sai em arm64 E amd64, pelo buildx, do mesmo
 * Dockerfile. O Linux (motor, servidor) usa a da própria arquitetura; o Mac leva a dele dentro do disco da VM local
 * (infra/vm-local/), arm64 nos Apple Silicon e amd64 nos Intel.
 *
 *   npm run computador:build                                   # as duas arquiteturas; carrega a nativa como nod-computador:1
 *   npm run computador:build -- --saida dist/vm-local          # também grava nod-computador-<arch>.tar (docker load)
 *   npm run computador:build -- --plataformas linux/amd64      # só uma (ou NOD_COMPUTADOR_PLATAFORMAS)
 *
 * A arquitetura que não é a do host roda emulada (QEMU/binfmt). O Docker Desktop já traz; num Linux sem o binfmt o
 * build estrangeiro falha e o script diz como instalar. Sem `--saida`, a estrangeira só fica no cache do buildx: o
 * build serve de prova de que ela compila, e o `--load` de várias plataformas não existe no store clássico do Docker.
 *
 * O servidor e o motor Linux não mudam: sem escolha explícita de plataformas (nem `--plataformas`, nem
 * NOD_COMPUTADOR_PLATAFORMAS, nem `--saida`), a nativa sai primeiro como `nod-computador:1`, e a estrangeira que
 * falhar (sem binfmt) vira aviso, não erro. Sem o plugin buildx (docker.io do Debian), cai no `docker build` de antes.
 * Com escolha explícita (o release), qualquer falha é erro.
 */

export const PLATAFORMAS = ["linux/arm64", "linux/amd64"] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];
export const TAG_PADRAO = "nod-computador:1";
/** O rótulo que o disco da VM compara para saber se a imagem carregada é a da versão (infra/vm-local/arquivos). */
export const ROTULO_VERSAO = "app.nod.computador.versao";

export type OpcoesBuild = {
  plataformas: readonly string[];
  /** A plataforma do host: é a única que vai para o store local (`--load`). */
  nativa: Plataforma;
  versao: string;
  contexto: string;
  tag?: string;
  /** Pasta onde grava um `docker save` por arquitetura. */
  saida?: string | undefined;
};

export type PassoBuild = { plataforma: Plataforma; args: string[] };

export function arquitetura(p: Plataforma): "arm64" | "amd64" {
  return p === "linux/arm64" ? "arm64" : "amd64";
}

export function plataformaDoHost(arch: string): Plataforma {
  if (arch === "arm64") return "linux/arm64";
  if (arch === "x64") return "linux/amd64";
  throw new Error(`arquitetura sem imagem do computador: ${arch}`);
}

/** Lê `a,b` (vírgula ou espaço). Plataforma fora da lista ou repetida é erro: nunca vira um build silencioso de outra coisa. */
export function lerPlataformas(texto: string | undefined): Plataforma[] {
  if (!texto || !texto.trim()) return [...PLATAFORMAS];
  const lidas = texto.split(/[\s,]+/).filter(Boolean);
  const saida: Plataforma[] = [];
  for (const p of lidas) {
    if (!(PLATAFORMAS as readonly string[]).includes(p)) throw new Error(`plataforma desconhecida: ${p} (use ${PLATAFORMAS.join(" ou ")})`);
    if (saida.includes(p as Plataforma)) throw new Error(`plataforma repetida: ${p}`);
    saida.push(p as Plataforma);
  }
  return saida;
}

/**
 * Os comandos `docker buildx build`, um por plataforma, a nativa primeiro: é a que o servidor e o motor usam
 * (`nod-computador:1` no store local), e ela fica pronta mesmo se a estrangeira falhar depois. Cada um leva o rótulo
 * da versão.
 */
export function planoDoBuild(o: OpcoesBuild): PassoBuild[] {
  const plataformas = lerPlataformas(o.plataformas.join(","));
  const tag = o.tag ?? TAG_PADRAO;
  const ordem = [...plataformas.filter((p) => p === o.nativa), ...plataformas.filter((p) => p !== o.nativa)];
  // Uma saída por comando: várias `--output` no mesmo build pedem buildx/BuildKit >= 0.13, e o segundo comando da
  // mesma plataforma sai inteiro do cache.
  const passos: PassoBuild[] = [];
  for (const plataforma of ordem) {
    const base = ["buildx", "build", "--platform", plataforma, "--label", `${ROTULO_VERSAO}=${o.versao}`, "-t", tag];
    const com = (...saida: string[]) => passos.push({ plataforma, args: [...base, ...saida, o.contexto] });
    if (o.saida) com("--output", `type=docker,dest=${join(o.saida, `nod-computador-${arquitetura(plataforma)}.tar`)}`);
    if (plataforma === o.nativa) com("--load");
    else if (!o.saida) com("--output", "type=cacheonly");
  }
  return passos;
}

/** A dica para quem não tem emulação: só aparece quando falhou a plataforma que não é a do host. */
export function dicaDeFalha(passo: PassoBuild, nativa: Plataforma): string | null {
  if (passo.plataforma === nativa) return null;
  return `o build ${passo.plataforma} roda emulado neste host (${nativa}). Sem o binfmt do QEMU ele falha; instale com\n` +
    "  docker run --privileged --rm tonistiigi/binfmt --install arm64,amd64\n" +
    `ou rode só a nativa: NOD_COMPUTADOR_PLATAFORMAS=${nativa} npm run computador:build`;
}

/**
 * Escolha explícita = o release ou quem pediu plataformas/saída. Sem ela é o uso de sempre do servidor e do motor
 * (`npm run computador:build`), que não pode passar a falhar por causa da arquitetura que ele nem usa.
 */
export function escolhaExplicita(plataformasPedidas: string | undefined, saida: string | undefined): boolean {
  return Boolean(plataformasPedidas?.trim()) || Boolean(saida);
}

/** Sem o plugin buildx: o `docker build` de antes do NOD-93, só a nativa, agora com o rótulo da versão. */
export function planoSemBuildx(o: Pick<OpcoesBuild, "nativa" | "versao" | "contexto" | "tag">): PassoBuild {
  return { plataforma: o.nativa, args: ["build", "--label", `${ROTULO_VERSAO}=${o.versao}`, "-t", o.tag ?? TAG_PADRAO, o.contexto] };
}

/** O que fazer quando um passo falha: a nativa sempre para; a estrangeira só para com escolha explícita. */
export function falhaPara(passo: PassoBuild, nativa: Plataforma, explicita: boolean): boolean {
  return explicita || passo.plataforma === nativa;
}

function argumento(args: readonly string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

function rodarDocker(args: string[]) {
  process.stdout.write(`\n> docker ${args.join(" ")}\n`);
  return spawnSync("docker", args, { stdio: "inherit" });
}

function main(): number {
  const raiz = join(import.meta.dirname, "../..");
  const args = process.argv.slice(2);
  const versao = argumento(args, "--versao") ?? (JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as { version: string }).version;
  const saida = argumento(args, "--saida");
  const nativa = plataformaDoHost(process.arch);
  const pedidas = argumento(args, "--plataformas") ?? process.env.NOD_COMPUTADOR_PLATAFORMAS;
  const explicita = escolhaExplicita(pedidas, saida);
  const plataformas = lerPlataformas(pedidas);
  const contexto = join(raiz, "infra/computador");
  if (spawnSync("docker", ["buildx", "version"], { stdio: "ignore" }).status !== 0) {
    if (explicita) {
      process.stderr.write("\no docker buildx não está instalado; ele é obrigatório com --plataformas, NOD_COMPUTADOR_PLATAFORMAS ou --saida\n");
      return 1;
    }
    process.stderr.write(`\naviso: sem o docker buildx, só a ${nativa} (docker build)\n`);
    return rodarDocker(planoSemBuildx({ nativa, versao, contexto }).args).status ?? 1;
  }
  if (saida) mkdirSync(saida, { recursive: true });
  const puladas: Plataforma[] = [];
  for (const passo of planoDoBuild({ plataformas, nativa, versao, contexto, saida })) {
    const r = rodarDocker(passo.args);
    if (r.status === 0) continue;
    const dica = dicaDeFalha(passo, nativa);
    process.stderr.write(`\nfalhou o build ${passo.plataforma}${r.error ? ` (${r.error.message})` : ""}\n${dica ? `${dica}\n` : ""}`);
    if (falhaPara(passo, nativa, explicita)) return r.status ?? 1;
    puladas.push(passo.plataforma);
  }
  if (puladas.length) process.stderr.write(`\naviso: ${TAG_PADRAO} (${nativa}) pronta; ficou sem build: ${puladas.join(", ")}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
