import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CatalogoDeComandos } from "../../contracts/comandos.ts";
import type { EventoStream } from "../../contracts/turno.ts";
import { lerFrontmatter, montarCatalogo, type ArquivoDeComando } from "../../domain/comandos.ts";

/** Basta o começo do arquivo: o frontmatter vem no topo. */
const BYTES_DO_CABECALHO = 4096;

async function lerComeco(caminho: string): Promise<string | null> {
  let arquivo;
  try {
    arquivo = await open(caminho, "r");
    const { buffer, bytesRead } = await arquivo.read({ buffer: Buffer.alloc(BYTES_DO_CABECALHO), position: 0 });
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await arquivo?.close().catch(() => undefined);
  }
}

/**
 * O catálogo do "/" lido no Mac da pessoa (definido em 2026-09-28): os nomes vêm do `init` do turno (o que o CLI
 * carregou de fato) e a descrição, do frontmatter de cada arquivo. Onde procurar, na ordem do CLI:
 *  - `plugin:skill` → `<caminho do plugin>/skills/<skill>/SKILL.md` ou `<caminho>/commands/<skill>.md`;
 *  - o resto → `~/.claude/skills/<nome>/SKILL.md`, `~/.claude/commands/<nome>.md`, e o mesmo em cada pasta de
 *    projeto do turno (origem = o nome da pasta).
 * Arquivo que não abre é embutido do Claude Code (montarCatalogo decide). Nada aqui lança: o catálogo é extra.
 */
export async function lerCatalogoDoMac(init: Extract<EventoStream, { tipo: "init" }>, o: { home: string; pastasDeProjeto: readonly string[] }): Promise<CatalogoDeComandos> {
  const plugins = new Map((init.plugins ?? []).map((p) => [p.nome, p.caminho]));
  const nomes = [...new Set([...(init.skills ?? []), ...(init.comandos ?? [])])];
  const arquivos: Record<string, ArquivoDeComando> = {};
  await Promise.all(nomes.map(async (nome) => {
    const candidatos: { caminho: string; origem: string }[] = [];
    const [plugin, sub] = nome.includes(":") ? nome.split(":", 2) as [string, string] : [null, null];
    if (plugin && sub) {
      const raiz = plugins.get(plugin);
      if (raiz && raiz !== "builtin") candidatos.push({ caminho: join(raiz, "skills", sub, "SKILL.md"), origem: plugin }, { caminho: join(raiz, "commands", `${sub}.md`), origem: plugin });
    } else {
      candidatos.push({ caminho: join(o.home, ".claude", "skills", nome, "SKILL.md"), origem: "suas" }, { caminho: join(o.home, ".claude", "commands", `${nome}.md`), origem: "suas" });
      for (const pasta of o.pastasDeProjeto) {
        candidatos.push({ caminho: join(pasta, ".claude", "skills", nome, "SKILL.md"), origem: basename(pasta) }, { caminho: join(pasta, ".claude", "commands", `${nome}.md`), origem: basename(pasta) });
      }
    }
    for (const c of candidatos) {
      const texto = await lerComeco(c.caminho);
      if (texto !== null) {
        arquivos[nome] = { origem: c.origem, frontmatter: lerFrontmatter(texto) };
        return;
      }
    }
  }));
  return montarCatalogo({ skills: init.skills ?? [], comandos: init.comandos ?? [], soDoTerminal: init.comandosSoDoTerminal ?? [], arquivos, versaoCli: init.versaoCli || null });
}
