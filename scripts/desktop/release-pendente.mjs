// Aviso de release pendente do app desktop (.github/workflows/release-pendente.yml). A versão sobe por PR, mas a release
// sai de uma tag (desktop-release.yml), e o passo depois do merge se perdia: rc.5, rc.8 e rc.9 ficaram mergeadas sem
// release. Este script abre uma issue quando a versão do package.json da main não tem release publicada e a fecha
// quando ela sai. A decisão é a função pura `decidirAviso`; o `main` só lê e escreve na API do GitHub.
// Só módulos do Node: roda no runner sem `npm ci`.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PREFIXO_TITULO = "Release do app do Mac pendente:";

/** A tag de pré-release local (`desktop-v`) e a da release assinada pelo CI (`v`) valem as duas. */
export const tagsDaVersao = (versao) => [`desktop-v${versao}`, `v${versao}`];

/**
 * @param {{
 *   versao: string,
 *   repo: string,
 *   releases: { tag: string, rascunho: boolean, url: string, publicadaEm: string | null }[],
 *   issuesAbertas: { numero: number, titulo: string }[],
 * }} entrada
 * @returns {{ abrir: { titulo: string, corpo: string } | null, fechar: { numero: number, comentario: string }[] }}
 */
export function decidirAviso({ versao, repo, releases, issuesAbertas }) {
  const titulo = `${PREFIXO_TITULO} ${versao}`;
  const doAviso = issuesAbertas.filter((i) => i.titulo.startsWith(PREFIXO_TITULO));
  const tags = tagsDaVersao(versao);
  const publicada = releases.find((r) => tags.includes(r.tag) && !r.rascunho);

  if (publicada) {
    return {
      abrir: null,
      fechar: doAviso.map((i) => ({
        numero: i.numero,
        comentario: i.titulo === titulo ? `Publicada: ${publicada.url}` : `Substituída: a main já está na ${versao}, publicada em ${publicada.url}`,
      })),
    };
  }

  const fechar = doAviso
    .filter((i) => i.titulo !== titulo)
    .map((i) => ({ numero: i.numero, comentario: `Substituída pela ${versao}: a versão subiu antes desta release sair.` }));
  if (doAviso.some((i) => i.titulo === titulo)) return { abrir: null, fechar };

  const ultima = releases
    .filter((r) => !r.rascunho && r.publicadaEm && /^(desktop-)?v/.test(r.tag))
    .sort((a, b) => b.publicadaEm.localeCompare(a.publicadaEm))[0];
  const rascunho = releases.find((r) => tags.includes(r.tag) && r.rascunho);
  const corpo = [
    `A versão **${versao}** está no \`package.json\` da main, mas o app do Mac dessa versão ainda não foi publicado.`,
    "",
    "**Para publicar**, com o `ci` verde no commit da main que leva essa versão:",
    "",
    "```",
    `git tag v${versao} <sha-da-main> && git push origin v${versao}`,
    "```",
    "",
    "O `desktop-release` monta, assina e notariza os apps do Mac e do Windows e cria a release em rascunho. Depois do aceite nos dois Macs, publique o rascunho.",
    `Workflow: https://github.com/${repo}/blob/main/.github/workflows/desktop-release.yml`,
    ...(ultima ? ["", `O que entra desde a última publicada (\`${ultima.tag}\`): https://github.com/${repo}/compare/${ultima.tag}...main`] : []),
    ...(rascunho ? ["", `Já existe um rascunho dessa versão: ${rascunho.url}. Confira os hashes e publique, ou apague e rode o workflow de novo.`] : []),
    "",
    "Esta issue fecha sozinha quando a release sai.",
  ].join("\n");
  return { abrir: { titulo, corpo }, fechar };
}

async function api(caminho, { metodo = "GET", corpo } = {}) {
  const resposta = await globalThis.fetch(`https://api.github.com${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!resposta.ok) throw new Error(`${metodo} ${caminho}: ${resposta.status} ${await resposta.text()}`);
  return resposta.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const responsavel = process.env.RESPONSAVEL;
  if (!repo || !process.env.GH_TOKEN) throw new Error("faltam GITHUB_REPOSITORY e GH_TOKEN");
  const { version: versao } = JSON.parse(await readFile("package.json", "utf8"));

  const releases = (await api(`/repos/${repo}/releases?per_page=100`)).map((r) => ({
    tag: r.tag_name,
    rascunho: r.draft,
    url: r.html_url,
    publicadaEm: r.published_at,
  }));
  const issuesAbertas = (await api(`/repos/${repo}/issues?state=open&per_page=100`))
    .filter((i) => !i.pull_request)
    .map((i) => ({ numero: i.number, titulo: i.title }));

  const { abrir, fechar } = decidirAviso({ versao, repo, releases, issuesAbertas });
  for (const { numero, comentario } of fechar) {
    await api(`/repos/${repo}/issues/${numero}/comments`, { metodo: "POST", corpo: { body: comentario } });
    await api(`/repos/${repo}/issues/${numero}`, { metodo: "PATCH", corpo: { state: "closed", state_reason: "completed" } });
    process.stdout.write(`Fechada a issue #${numero}: ${comentario}\n`);
  }
  if (abrir) {
    const criada = await api(`/repos/${repo}/issues`, {
      metodo: "POST",
      corpo: { title: abrir.titulo, body: abrir.corpo, ...(responsavel ? { assignees: [responsavel] } : {}) },
    });
    process.stdout.write(`Aberta a issue #${criada.number}: ${abrir.titulo}\n`);
  }
  if (!abrir && fechar.length === 0) process.stdout.write(`Nada a fazer para a ${versao}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
