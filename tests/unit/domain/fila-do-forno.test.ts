import { describe, expect, it } from "vitest";
import {
  aspasDeShell, avisoDeEspera, cabe, chaveDoComando, comandoNaFila, comPico, DESCONHECIDO_MB, ehLeve, estimativaMb, faltouMemoria, lerArvoreDoPs, livreDoMeminfo,
  livreDoVmStat, MARCA_DA_FILA, memoriaDaArvoreMb, PICOS_GUARDADOS, podarHistorico, precisaDaVez, repositorioDaOrigem, semPeso,
} from "../../../src/domain/fila-do-forno.ts";

describe("fila do forno: o que é pesado (ADR-097)", () => {
  it("a chave é o repositório e o texto com os espaços juntados; fora de repositório, só o texto", () => {
    expect(chaveDoComando("  npm   run check ", "gamefik/gamefik")).toBe("gamefik/gamefik\nnpm run check");
    expect(chaveDoComando("npm test", null)).toBe("\nnpm test");
    expect(chaveDoComando("npm test", "gamefik/nod")).not.toBe(chaveDoComando("npm test", "gamefik/gamefik"));
  });

  it("o repositório pela origem do git, igual em SSH e HTTPS, com e sem .git", () => {
    for (const url of ["git@github.com:gamefik/nod.git", "https://github.com/gamefik/nod.git", "https://github.com/gamefik/nod", "ssh://git@github.com/gamefik/nod.git\n", "https://x-access-token@github.com/gamefik/nod/"]) expect(repositorioDaOrigem(url), url).toBe("gamefik/nod");
    expect(repositorioDaOrigem("")).toBeNull();
    expect(repositorioDaOrigem(null)).toBeNull();
    expect(repositorioDaOrigem("nada")).toBeNull();
  });

  it("a reserva é o maior dos últimos picos mais 15%; depois de faltar memória, mais 50%", () => {
    expect(estimativaMb(undefined)).toBeNull();
    expect(estimativaMb({ picos: [], em: 0 })).toBeNull();
    expect(estimativaMb({ picos: [800, 1000, 900], em: 0 })).toBe(1150);
    expect(estimativaMb({ picos: [1000], faltou: true, em: 0 })).toBe(1500);
  });

  it("leve = medido, sempre abaixo de 256 MB e sem ter faltado memória", () => {
    expect(ehLeve(undefined)).toBe(false);
    expect(ehLeve({ picos: [40, 120], em: 0 })).toBe(true);
    expect(ehLeve({ picos: [40, 300], em: 0 })).toBe(false);
    expect(ehLeve({ picos: [40], faltou: true, em: 0 })).toBe(false);
  });

  it("o que não pesa e o que já se mostrou leve rodam direto; o resto pede a vez", () => {
    expect(precisaDaVez({ comando: "git status && ls -la | grep x", historico: undefined })).toBe(false);
    expect(precisaDaVez({ comando: "npm run lint", historico: { picos: [50], em: 0 } })).toBe(false);
    expect(precisaDaVez({ comando: "npm run lint", historico: undefined })).toBe(true);
    expect(precisaDaVez({ comando: "npx vitest run", historico: { picos: [2000], em: 0 } })).toBe(true);
  });

  it("sem peso: arquivo, texto, git sem hook e espera; teste, lint, tipos, código e o git que roda hook pesam", () => {
    for (const c of ["ls", "cd sub && git log --oneline -5", "FOO=1 git diff | head -20", "sed -i s/a/b/ x.ts; cat x.ts > /dev/null", "sleep 30", "rm -rf dist && mkdir dist", "git -C x status"]) expect(semPeso(c), c).toBe(true);
    for (const c of ["npm test", "npm run typecheck", "npx tsc --noEmit", "node script.js", "python3 a.py", "ls $(npm bin)", "git commit -m x", "git -C x push", "cd a && make", "xargs npm test", "env A=1 npm test", "ffmpeg -i a.mp4 b.webm"]) expect(semPeso(c), c).toBe(false);
  });

  it("o histórico guarda os últimos 5 picos, marca a falta de memória (saída 137) e a esquece quando passa", () => {
    let h = comPico(undefined, 100.4, false, 1);
    for (let i = 0; i < 6; i++) h = comPico(h, 200 + i, false, 2 + i);
    expect(h.picos).toHaveLength(PICOS_GUARDADOS);
    expect(h.picos[0]).toBe(201);
    expect(comPico(h, 900, true, 9)).toMatchObject({ faltou: true });
    expect(comPico(comPico(h, 900, true, 9), 950, false, 10).faltou).toBeUndefined();
    expect(faltouMemoria(137)).toBe(true);
    expect(faltouMemoria(1)).toBe(false);
    expect(faltouMemoria(null)).toBe(false);
  });

  it("o histórico fica com os comandos usados mais recentemente", () => {
    const h = { a: { picos: [1], em: 1 }, b: { picos: [1], em: 3 }, c: { picos: [1], em: 2 } };
    expect(Object.keys(podarHistorico(h, 2)).sort()).toEqual(["b", "c"]);
    expect(podarHistorico(h, 5)).toBe(h);
  });
});

describe("fila do forno: cabe? (ADR-097)", () => {
  it("sem ninguém com a vez, cabe sempre — nada espera para sempre", () => {
    expect(cabe({ estimativaMb: 20_000, livreMb: 100, reservaMb: 1024, comAVez: [] })).toBe(true);
  });

  it("a memória livre menos a reserva e o que os outros ainda vão usar tem de comportar a reserva dele", () => {
    // 8 GB livres, 1 GB de reserva; um vitest de 3 GB que já usa 1 GB ainda vai usar 2 GB: sobram 5 GB.
    const comAVez = [{ estimativaMb: 3072, usadoMb: 1024 }];
    expect(cabe({ estimativaMb: 5000, livreMb: 8192, reservaMb: 1024, comAVez })).toBe(true);
    expect(cabe({ estimativaMb: 5200, livreMb: 8192, reservaMb: 1024, comAVez })).toBe(false);
  });

  it("quem já usa mais que a reserva não conta negativo; o comando nunca medido reserva 512 MB", () => {
    expect(cabe({ estimativaMb: null, livreMb: 1024 + DESCONHECIDO_MB, reservaMb: 1024, comAVez: [{ estimativaMb: 100, usadoMb: 900 }] })).toBe(true);
    expect(cabe({ estimativaMb: 100, livreMb: 1500, reservaMb: 1024, comAVez: [{ estimativaMb: null, usadoMb: 0 }] })).toBe(false);
  });
});

describe("fila do forno: o comando reescrito (ADR-097)", () => {
  it("no mesmo shell, com a quebra de linha antes do fecho e o status do comando no fim", () => {
    const c = comandoNaFila("cd pasta && npm test # tudo", { invocar: "'node' '/x/hook.mjs'", chave64: "Zm9v", dir: aspasDeShell("/home/nod/.nod/vaga") });
    expect(c.startsWith(MARCA_DA_FILA)).toBe(true);
    expect(c).toBe("__nod_vaga=$('node' '/x/hook.mjs' vaga pegar Zm9v $$ '/home/nod/.nod/vaga'); { cd pasta && npm test # tudo\n}; __nod_s=$?; 'node' '/x/hook.mjs' vaga soltar \"$__nod_vaga\" \"$__nod_s\" '/home/nod/.nod/vaga'; (exit $__nod_s)");
  });

  it("aspas de shell com aspas simples no caminho", () => {
    expect(aspasDeShell("/Users/a b/it's")).toBe("'/Users/a b/it'\\''s'");
  });
});

describe("fila do forno: memória da máquina e da árvore (ADR-097)", () => {
  it("Linux: MemAvailable; sem o campo, null", () => {
    expect(livreDoMeminfo("MemTotal:       32876544 kB\nMemAvailable:   25286656 kB\n")).toBe(24694);
    expect(livreDoMeminfo("MemTotal: 1 kB")).toBeNull();
  });

  it("Mac: livres, inativas e especulativas do vm_stat", () => {
    const vm = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               10000.\nPages active:  999999.\nPages inactive:                           20000.\nPages speculative:                         2000.\n";
    expect(livreDoVmStat(vm)).toBe(Math.floor((32000 * 16384) / 1048576));
    expect(livreDoVmStat("nada")).toBeNull();
  });

  it("a árvore: os descendentes do shell, sem ele e sem o próprio nod-vaga", () => {
    const ps = lerArvoreDoPs("  10     1  5000\n  11    10 102400\n  12    11 204800\n  13    10  1024\n  14     1 999999\nlixo\n");
    expect(memoriaDaArvoreMb(ps, 10)).toBe(301);
    expect(memoriaDaArvoreMb(ps, 10, new Set([13]))).toBe(300);
    expect(memoriaDaArvoreMb(ps, 99)).toBe(0);
  });

  it("o aviso de espera em linguagem simples", () => {
    expect(avisoDeEspera({ comAVez: 2, livreMb: 1300, estimativaMb: 3000, naFrente: 1 })).toBe(
      "nod: este comando espera a vez de rodar: 2 comandos pesados rodam nesta máquina e há 1,3 GB livres. Ele costuma usar 2,9 GB. Há 1 comando na frente. Ele começa sozinho quando couber; não precisa repetir.",
    );
    expect(avisoDeEspera({ comAVez: 1, livreMb: 800, estimativaMb: null, naFrente: 0 })).toBe("nod: este comando espera a vez de rodar: 1 comando pesado roda nesta máquina e há 800 MB livres. Ele começa sozinho quando couber; não precisa repetir.");
  });
});
