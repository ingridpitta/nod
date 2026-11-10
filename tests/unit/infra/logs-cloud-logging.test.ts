import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOD-387 (definido em 2026-10-28): os logs do app NÃO somem no deploy. O compose manda tudo para o Cloud Logging
 * (driver `gcplogs`, bucket `_Default`, 30 dias); o que some é o `docker logs`, que só vê o contêiner atual. O
 * diagnóstico da NOD-362 errou porque a doc não mostrava a consulta. Este teste impede trocar o driver (ou desviar os
 * logs com `options`/`!reset`) sem decisão nova, e impede que a consulta saia das duas docs de operação, fique com
 * nomes de contêiner que o compose não gera (`/nod-<serviço>-1`), com aspas desbalanceadas, sem `--project`, com
 * `--freshness` junto de `--order=asc` (o gcloud ignora o freshness) ou com âncoras quebradas. A lista exata de
 * serviços e o `driver: gcplogs` sem aspas são freios de propósito: serviço novo passa por aqui e pela doc.
 */
const ler = (caminho: string) => readFileSync(new URL(`../../../${caminho}`, import.meta.url), "utf8");
const semComentarios = (texto: string) =>
  texto
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "").trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");

const compose = semComentarios(ler("infra/gcp/vm/compose.yml"));
const DOCS = ["docs/deploy-gcp.md", "docs/runbook-producao.md"] as const;
/** A doc sem comentários HTML: o que está em `<!-- -->` (ou depois de um `<!--` sem fecho) não aparece, não conta. */
const lerDoc = (caminho: string) => ler(caminho).replace(/<!--[\s\S]*?(?:-->|$(?![\s\S]))/g, "");

/** Cada `gcloud logging read` da doc como um comando só (junta as continuações `\`). */
function comandos(texto: string): string[] {
  return texto
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .filter((l) => l.includes('gcloud logging read "'))
    .map((l) => l.slice(l.indexOf("gcloud logging read")).replace(/`\.?\s*$/, ""));
}

/** Os trechos `AND …` entre crases que a doc manda somar à consulta. */
const fragmentos = (texto: string) => [...texto.matchAll(/`(AND [^`]+)`/g)].map((m) => m[1]!);
const FORMATO = "--format='value(timestamp,jsonPayload.container.name,jsonPayload.message)'";

/** Slug de título do GitHub: minúsculas, sem pontuação, espaço vira hífen (acentos ficam). */
const slug = (titulo: string) =>
  titulo
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
const ancoras = (caminho: string) =>
  new Set([...ler(caminho).replace(/^```[\s\S]*?^```/gm, "").matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]!)));

/** Blocos de cada serviço de `services:` (nome → linhas do bloco), pelo recuo de 2 espaços. */
function servicos(): Map<string, string> {
  const corpo = compose.split(/^services:$/m)[1]!.split(/^\S/m)[0]!;
  const blocos = new Map<string, string>();
  for (const parte of corpo.split(/^(?= {2}[a-z][\w-]*:$)/m)) {
    const nome = /^ {2}([a-z][\w-]*):$/m.exec(parte)?.[1];
    if (nome) blocos.set(nome, parte);
  }
  return blocos;
}

/** `logging:` seguido só de `driver: gcplogs`, sem `options` nem outra chave no mesmo bloco. */
const LOGGING_GCPLOGS = /^(\s+)logging:\n\1 {2}driver: gcplogs(?:\n(?!\1 {2,}\S)|$(?![\s\S]))/m;

describe("logs de produção no Cloud Logging (NOD-387)", () => {
  it("deploy-gcp.md: cita o contêiner que o compose gera para cada serviço", () => {
    const texto = lerDoc("docs/deploy-gcp.md");
    for (const nome of servicos().keys()) expect(texto, nome).toContain(`/nod-${nome}-1`);
    expect(texto).toMatch(/\/nod-nod-(azul|verde)-run-</);
  });

  it("as duas docs só citam contêineres /nod-… que o compose gera (ou o legado /nod-nod-1)", () => {
    const validos = [...servicos().keys()].map((n) => `/nod-${n}-`);
    validos.push("/nod-nod-1", "/nod-nod-run-");
    for (const doc of DOCS) {
      for (const [nome] of lerDoc(doc).matchAll(/\/nod-[a-z]+(?:-[a-z]+)*-(?:1\b|run-)/g)) {
        expect(validos.some((v) => nome.startsWith(v)), `${doc}: ${nome}`).toBe(true);
      }
    }
  });

  it("compose.yml: toda service usa gcplogs puro (pela âncora x-nod ou no próprio bloco)", () => {
    const ancora = compose.split(/^services:$/m)[0]!;
    expect(ancora).toMatch(/^x-nod: &nod$/m);
    expect(compose.match(/&nod\b/g), "âncora &nod redefinida").toHaveLength(1);
    expect(ancora).toMatch(LOGGING_GCPLOGS);
    expect(compose).not.toMatch(/!reset|!override/);
    expect(compose).not.toMatch(/^\s+logging:\n(?!\s+driver: gcplogs)/m);
    expect(compose).not.toMatch(/^\s+(options|labels|env|tag):/m);

    const blocos = servicos();
    expect([...blocos.keys()].sort()).toEqual(["caddy", "nod-azul", "nod-verde"]);
    for (const [nome, bloco] of blocos) {
      const herda = /^\s+<<: \*nod$/m.test(bloco);
      const proprio = /^\s+logging:/m.test(bloco);
      expect(herda || proprio, `${nome} sem logging`).toBe(true);
      if (proprio) expect(bloco, nome).toMatch(LOGGING_GCPLOGS);
    }
  });

  it("deploy-gcp.md: o filtro do console usa o mesmo logName", () => {
    expect(lerDoc("docs/deploy-gcp.md")).toMatch(/`logName="projects\/nod-exemplos\/logs\/gcplogs-docker-driver" AND jsonPayload\.message:"[a-z_]+"`/);
  });

  for (const doc of DOCS) {
    it(`${doc}: mostra a consulta gcloud logging read por janela, evento, cor e freshness`, () => {
      const texto = lerDoc(doc);
      expect(texto).toContain("L='logName=\"projects/nod-exemplos/logs/gcplogs-docker-driver\"'");
      expect(texto).toMatch(/gcloud logging read "\$L AND /);
      expect(texto).toMatch(/timestamp>=\\"20\d\d-\d\d-\d\dT[\d:]+Z\\"/);
      expect(texto).toMatch(/timestamp<=\\"20\d\d-\d\d-\d\dT[\d:]+Z\\"/);
      expect(texto).toMatch(/jsonPayload\.message:\\"[a-z_]+\\"/);
      expect(texto).toMatch(/--freshness=\d+[dh]/);
      // Por cor: o filtro por trecho com o nome do serviço do compose pega `/nod-<serviço>-1` e os `run --rm`.
      expect(texto).toMatch(/jsonPayload\.container\.name:\\"nod-(azul|verde)\\"/);
      for (const nome of servicos().keys()) expect(texto, nome).toContain(`\\"${nome}\\"`);
    });

    it(`${doc}: todo gcloud logging read tem aspas balanceadas, --project e não junta --freshness com --order=asc`, () => {
      const lista = comandos(lerDoc(doc));
      expect(lista.length).toBeGreaterThanOrEqual(2);
      expect(lista.some((c) => c.includes("$L AND timestamp>=")), "consulta por janela").toBe(true);
      const porCor = /jsonPayload\.container\.name:\\"nod-(azul|verde)\\"/;
      if (doc.includes("deploy-gcp")) expect(lista.some((c) => porCor.test(c)), "consulta por cor").toBe(true);
      else expect(fragmentos(lerDoc(doc)).some((f) => porCor.test(f)), "fragmento por cor").toBe(true);
      for (const cmd of lista) {
        expect(cmd, cmd).toMatch(/^gcloud logging read "\$L AND /);
        expect(cmd, cmd).toContain(FORMATO);
        expect(cmd, cmd).not.toMatch(/textPayload|--order=desc/);
        if (cmd.includes("timestamp>=")) {
          expect(cmd, `janela sem --order=asc: ${cmd}`).toContain("--order=asc");
          expect(cmd, `janela com --freshness: ${cmd}`).not.toContain("--freshness");
        }
        const semEscapes = cmd.replace(/\\\\/g, "").replace(/\\"/g, "");
        expect(semEscapes.split('"').length % 2, `aspas duplas: ${cmd}`).toBe(1);
        expect(semEscapes.split("'").length % 2, `aspas simples: ${cmd}`).toBe(1);
        expect(cmd, cmd).toContain("--project=nod-exemplos");
        expect(cmd.includes("--freshness") && cmd.includes("--order=asc"), `freshness + asc: ${cmd}`).toBe(false);
      }
    });

    it(`${doc}: os trechos \`AND …\` para somar à consulta usam jsonPayload e aspas escapadas`, () => {
      for (const f of fragmentos(lerDoc(doc))) {
        expect(f, f).toMatch(/^AND jsonPayload\.(message|container\.name):\\"/);
        expect(f.replace(/\\\\/g, "").replace(/\\"/g, ""), f).not.toContain('"');
      }
    });

    it(`${doc}: as âncoras para as docs de operação existem`, () => {
      const texto = lerDoc(doc);
      for (const [, alvo, ancora] of texto.matchAll(/\]\(((?:deploy-gcp|runbook-producao)\.md)?#([^)]+)\)/g)) {
        expect(ancoras(alvo ? `docs/${alvo}` : doc), `${alvo ?? doc}#${ancora}`).toContain(ancora);
      }
    });

    it(`${doc}: avisa que docker logs só vê o contêiner atual e aponta o journalctl do motor em UTC`, () => {
      const texto = lerDoc(doc);
      expect(texto.replace(/\s+/g, " ")).toMatch(/`docker logs`.{0,20}só vê o contêiner atual/);
      expect(texto).toMatch(/journalctl -u nod-motor --since "20\d\d-\d\d-\d\d [\d:]+ UTC"/);
    });
  }
});
