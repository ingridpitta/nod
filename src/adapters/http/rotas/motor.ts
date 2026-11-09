import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Rota } from "../roteador.ts";
import { ARQUIVOS_DO_COMPUTADOR } from "../computador-instalacao.ts";
import { ARQUIVOS_DO_MOTOR, papelDoScript, scriptDeInstalacao, servidorParaScript } from "../motor-instalacao.ts";
import { scriptDeInstalacaoWindows, servidorDoWindowsValido } from "../motor-instalacao-windows.ts";

/**
 * ADR-090: o servidor distribui o motor da própria versão. `GET /api/motor/instalar` (e `/motor`, que redireciona para
 * cá) devolve o script com o endereço deste servidor; `GET /api/motor/arquivos/<nome>` devolve os três arquivos de
 * dist/motor. Públicas e sem segredo: o motor só vale depois do pareamento, que exige a pessoa logada aprovando o código.
 * `computador` (NOD-96, ADR-122, NOD_COMPUTADORES=motor): o script instala também o computador da pessoa e as rotas
 * servem os arquivos dele; sem a flag, nada muda.
 */
export function rotasMotor(o: { pasta: string; versao: string; urlPublica?: string; computador?: boolean }): Rota[] {
  const servidos: readonly string[] = o.computador ? [...ARQUIVOS_DO_MOTOR, ...ARQUIVOS_DO_COMPUTADOR] : ARQUIVOS_DO_MOTOR;
  return [
    {
      metodo: "GET",
      padrao: /^\/motor\/instalar$/,
      publica: true,
      async handler(ctx) {
        const h = ctx.req.headers;
        const proto = String(h["x-forwarded-proto"] ?? ("encrypted" in ctx.req.socket && ctx.req.socket.encrypted ? "https" : "http"));
        const servidor = o.urlPublica ?? servidorParaScript(proto, String(h["x-forwarded-host"] ?? h.host ?? ""));
        if (!servidor) { ctx.json(400, { codigo: "entrada_invalida", mensagem: "Abra este endereço pelo HTTPS do seu Nod." }); return; }
        ctx.res.writeHead(200, { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" });
        // ADR-102: o convite de uso único do comando que a tela mostra (inválido = o script de sempre, com o código).
        // NOD-94: `papel=computador` instala a máquina só computador (sem IAs, com as linhas NOD-ETAPA/NOD-ERRO).
        const busca = new URL(ctx.req.url ?? "/", "http://x").searchParams;
        ctx.res.end(scriptDeInstalacao({ servidor, versao: o.versao, convite: busca.get("convite"), papel: papelDoScript(busca.get("papel")), ...(o.computador ? { computador: true } : {}) }));
      },
    },
    {
      // ADR-151 (ADA-32): `irm https://<nod>/windows | iex`. O mesmo contrato do script do Linux, em PowerShell; só HTTPS
      // (HTTP só em loopback, para o servidor de teste da CI).
      metodo: "GET",
      padrao: /^\/motor\/instalar-windows$/,
      publica: true,
      async handler(ctx) {
        const h = ctx.req.headers;
        const proto = String(h["x-forwarded-proto"] ?? ("encrypted" in ctx.req.socket && ctx.req.socket.encrypted ? "https" : "http"));
        const servidor = o.urlPublica ?? servidorParaScript(proto, String(h["x-forwarded-host"] ?? h.host ?? ""));
        if (!servidorDoWindowsValido(servidor)) { ctx.json(400, { codigo: "entrada_invalida", mensagem: "Abra este endereço pelo HTTPS do seu Nod." }); return; }
        const convite = new URL(ctx.req.url ?? "/", "http://x").searchParams.get("convite");
        let script: string;
        try { script = scriptDeInstalacaoWindows({ servidor, versao: o.versao, convite }); }
        catch { ctx.json(400, { codigo: "entrada_invalida", mensagem: "A versão deste servidor não cabe no script do Windows." }); return; }
        ctx.res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        ctx.res.end(script);
      },
    },
    {
      // ADR-100: o que o motor compara para saber se está igual ao servidor, e o que o atualizador confere depois de
      // baixar. O sha256 de cada arquivo, não a versão: vários merges saem com o mesmo número.
      metodo: "GET",
      padrao: /^\/motor\/manifesto$/,
      publica: true,
      async handler(ctx) {
        const arquivos: Record<string, string> = {};
        try {
          for (const nome of ARQUIVOS_DO_MOTOR) arquivos[nome] = createHash("sha256").update(await readFile(join(o.pasta, nome))).digest("hex");
        } catch {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "Este servidor não tem o motor empacotado (npm run motor:build)." });
          return;
        }
        ctx.res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        ctx.res.end(JSON.stringify({ versao: o.versao, arquivos }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/motor\/arquivos\/(?<nome>[^/]+)$/,
      publica: true,
      async handler(ctx) {
        const nome = servidos.find((a) => a === ctx.params.nome);
        if (!nome) { ctx.json(404, { codigo: "nao_encontrado" }); return; }
        let corpo: Buffer;
        try { corpo = await readFile(join(o.pasta, nome)); }
        catch { ctx.json(404, { codigo: "nao_encontrado", mensagem: "Este servidor não tem o motor empacotado (npm run motor:build)." }); return; }
        ctx.res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        ctx.res.end(corpo);
      },
    },
  ];
}
