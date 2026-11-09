import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";

/**
 * definido em 2026-09-18: o produto descobre a pasta do projeto em vez de mandar a pessoa procurar
 * no Finder — o agente chutava "~/Projetos/nod" para um repositório que mora em "~/code/nod".
 * A varredura lê SÓ nomes de diretório, nunca conteúdo de arquivo, e nunca sai da pasta pessoal.
 *
 * definido em 2026-09-25 (card de pasta simplificado): `onde` é a pasta-mãe relativa à base ("" quando
 * mora direto nela), para o card mostrar "code › acme" e não o caminho absoluto; `modificadoEm` é o uso
 * mais recente que um stat enxerga, para ordenar homônimas e dizer "mudou hoje". Só metadado: nenhum
 * conteúdo de arquivo é lido.
 */
export type Candidata = { caminho: string; nome: string; git: boolean; onde: string; modificadoEm: number | null; nivel: number; pontuacao: number };
export type Busca = { candidatas: Candidata[]; truncado: boolean };

/** Pastas onde projetos costumam morar; ordena a fila, não restringe o alcance. */
export const BASES_PROVAVEIS = ["code", "dev", "Projetos", "projects", "src", "repos", "work", "Documents", "Desktop"] as const;
/** Nunca descer aqui: volume alto, irrelevante para projetos, ou privado do sistema. */
export const IGNORADAS = new Set(["node_modules", "Library", "Applications", "venv", "target", "dist", "build", "vendor", "Pictures", "Music", "Movies", "Downloads"]);
/** Marcas de raiz de projeto: elevam a candidata acima de uma pasta homônima qualquer. */
export const MARCAS_PROJETO = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "Gemfile"] as const;
export const PROFUNDIDADE_MAX = 4;
export const ENTRADAS_MAX = 20_000;
export const MS_MAX = 2_500;
export const RESULTADOS_MAX = 8;
/** Quantas candidatas empatadas no corte têm o último uso lido: um termo curto ("app") casa milhares. */
export const USO_LIDOS_MAX = 64;
const DIA_MS = 86_400_000;

/** Sem acento e sem caixa: "Relatório" e "relatorio" devem casar. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Busca em largura a partir da pasta pessoal, com orçamento de entradas e de tempo.
 * `podeAutorizar` é a MESMA regra usada para conceder: candidata não autorizável não é oferecida,
 * para o card nunca propor uma pasta que a concessão vai recusar depois.
 */
export async function buscarPastas(termo: string, opcoes: { podeAutorizar: (caminho: string) => Promise<boolean> | boolean; base?: string; agora?: () => number }): Promise<Busca> {
  const alvo = normalizar(termo.trim());
  if (alvo === "") return { candidatas: [], truncado: false };
  const agora = opcoes.agora ?? Date.now;
  const limite = agora() + MS_MAX;
  const raiz = await realpath(opcoes.base ?? homedir());
  const achadas = new Map<string, Candidata>();
  let entradas = 0;
  let truncado = false;
  let fila: string[] = [raiz];

  // nivel é a distância da base até os FILHOS examinados, então o corte é < PROFUNDIDADE_MAX:
  // com PROFUNDIDADE_MAX=4, a candidata mais funda aceita é ~/a/b/c/alvo.
  for (let nivel = 0; nivel < PROFUNDIDADE_MAX && fila.length > 0; nivel++) {
    const proxima: string[] = [];
    for (const dir of fila) {
      if (entradas >= ENTRADAS_MAX || agora() >= limite) { truncado = true; break; }
      let itens;
      try { itens = await readdir(dir, { withFileTypes: true }); }
      catch { continue; } // pasta sem permissão ou removida no meio da varredura não derruba a busca
      for (const item of itens) {
        entradas++;
        // Link não é seguido: evita ciclo e evita escapar da pasta pessoal por um atalho.
        if (!item.isDirectory() || item.isSymbolicLink()) continue;
        if (item.name.startsWith(".") || IGNORADAS.has(item.name)) continue;
        const caminho = join(dir, item.name);
        proxima.push(caminho);
        const nome = normalizar(item.name);
        const pontuacaoNome = nome === alvo ? 100 : nome.startsWith(alvo) ? 60 : nome.includes(alvo) ? 30 : 0;
        if (pontuacaoNome === 0 || achadas.has(caminho)) continue;
        if (!await opcoes.podeAutorizar(caminho)) continue;
        const git = await existe(join(caminho, ".git"));
        const marca = git || (await Promise.all(MARCAS_PROJETO.map(m => existe(join(caminho, m))))).some(Boolean);
        const onde = relative(raiz, dir).split(sep).join("/");
        achadas.set(caminho, { caminho, nome: item.name, git, onde, modificadoEm: null, nivel, pontuacao: pontuacaoNome + (git ? 25 : 0) + (marca ? 10 : 0) });
      }
    }
    if (truncado) break;
    // Locais prováveis primeiro: acha ~/code/nod antes de gastar orçamento no resto da home.
    fila = nivel === 0 ? ordenarPorProbabilidade(proxima) : proxima;
  }

  // definido em 2026-09-25: entre candidatas de mesma relevância, a usada por último vem antes — a cópia em
  // que a pessoa trabalha, não o clone esquecido. O uso conta por DIA: no mesmo dia, a mais rasa vence
  // (~/code/nod antes de ~/code/velho/backup/nod); comparado ao milissegundo, a profundidade nunca decidia.
  // O último uso é lido DEPOIS da varredura, só para quem ainda disputa as RESULTADOS_MAX vagas e com teto
  // de USO_LIDOS_MAX: dentro do laço, cada homônima gastava o orçamento de tempo.
  const porRelevancia = [...achadas.values()].sort((a, b) => b.pontuacao - a.pontuacao || a.nivel - b.nivel);
  const corte = porRelevancia[RESULTADOS_MAX - 1]?.pontuacao ?? 0;
  const fim = agora();
  await Promise.all(porRelevancia.filter(c => c.pontuacao >= corte).slice(0, USO_LIDOS_MAX).map(async (c) => {
    const t = await ultimaMudanca(c.caminho, c.git);
    // Relógio adiantado ou arquivo extraído com data futura não ganha a disputa: conta como agora.
    c.modificadoEm = t === null ? null : Math.min(t, fim);
  }));
  // Dia civil no fuso do processo — o servidor da busca roda no Mac da pessoa, e é esse o dia do "mudou hoje".
  const dia = (c: Candidata) => c.modificadoEm === null ? -1 : Math.floor((c.modificadoEm - new Date(c.modificadoEm).getTimezoneOffset() * 60_000) / DIA_MS);
  const candidatas = porRelevancia.sort((a, b) =>
    b.pontuacao - a.pontuacao || dia(b) - dia(a) || a.nivel - b.nivel || a.caminho.length - b.caminho.length);
  return { candidatas: candidatas.slice(0, RESULTADOS_MAX), truncado: truncado || candidatas.length > RESULTADOS_MAX };
}

function ordenarPorProbabilidade(caminhos: string[]): string[] {
  const peso = (c: string) => {
    const i = BASES_PROVAVEIS.indexOf(basename(c) as typeof BASES_PROVAVEIS[number]);
    return i === -1 ? BASES_PROVAVEIS.length : i;
  };
  return [...caminhos].sort((a, b) => peso(a) - peso(b));
}

/**
 * No repositório, o índice e o HEAD do Git: mudam quando alguém trabalha nele. A data da própria pasta é
 * só o plano B (pasta comum, worktree com `.git` em arquivo): o Finder a muda ao gravar um .DS_Store.
 */
async function ultimaMudanca(caminho: string, git: boolean): Promise<number | null> {
  const mtime = async (a: string) => { try { return (await stat(a)).mtimeMs; } catch { return null; } };
  const doGit = git ? (await Promise.all([mtime(join(caminho, ".git", "index")), mtime(join(caminho, ".git", "HEAD"))])).filter((t): t is number => t !== null) : [];
  const t = doGit.length > 0 ? Math.max(...doGit) : await mtime(caminho);
  return t === null ? null : Math.round(t);
}

async function existe(caminho: string): Promise<boolean> {
  try { await stat(caminho); return true; } catch { return false; }
}

/** Reexportado para quem monta o card: mesma noção de "dentro" usada na concessão. */
export function dentroDe(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && dirname(r) !== "..");
}
