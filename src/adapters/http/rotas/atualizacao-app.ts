import { arquiteturaDoApp, decidirAtualizacaoDoApp, plataformaDoApp, type ConfigAtualizacaoApp } from "../../../domain/atualizacao-app.ts";
import { log } from "../../../obs/log.ts";
import type { AssinadorDeUrl } from "../../atualizacao-app/assinador-gcs.ts";
import type { Rota } from "../roteador.ts";

/**
 * NOD-132 (ADR-149): o feed do Squirrel.Mac no protocolo do servidor (`serverType: "default"`: 204 = em dia). `GET /api/maquina/atualizacao?arch=arm64|x64`, com a
 * chave da máquina (o roteador já recusou Origin e falta de Bearer). FORA da trava 426 de ponte.ts de propósito: é o
 * caminho do app que está abaixo da versão mínima voltar a trabalhar. Responde:
 * - 204: desligada, versão igual ou menor, ou versão do app inválida;
 * - 200 `{ url, name, notes, pub_date, sha256 }`: a URL assinada curta do ZIP da arquitetura pedida e o SHA-256 do ZIP
 *   (o Squirrel.Mac do Electron 43 ainda não o confere; a defesa é a assinatura de código);
 * - 503: a assinatura falhou (logada). Não é 204 de propósito: o app trata como erro e, na procura manual ou no 426,
 *   mostra o link do download em vez de "atualizado";
 * - 400: `arch` fora de arm64/x64 ou `plataforma` fora de mac/windows.
 * ADA-229 (ADR-152): `plataforma=windows` anuncia o instalador `.exe` (só x64, só com `win-x64=` no SHA-256); ausente = mac.
 * A URL assinada nunca vai para log.
 */
export function rotasAtualizacaoApp(o: { config: ConfigAtualizacaoApp; assinar: AssinadorDeUrl | null; versaoMinima: string; publicadaEm?: string }): Rota[] {
  return [{
    metodo: "GET",
    padrao: /^\/atualizacao$/,
    maquina: true,
    async handler(ctx) {
      ctx.res.setHeader("cache-control", "no-store");
      ctx.res.setHeader("x-nod-versao-minima", o.versaoMinima);
      const busca = new URL(ctx.req.url ?? "/", "http://x").searchParams;
      const arch = arquiteturaDoApp(busca.get("arch"));
      if (!arch) { ctx.json(400, { codigo: "entrada_invalida", mensagem: "arch deve ser arm64 ou x64" }); return; }
      const plataforma = plataformaDoApp(busca.get("plataforma"));
      if (!plataforma) { ctx.json(400, { codigo: "entrada_invalida", mensagem: "plataforma deve ser mac ou windows" }); return; }
      const atual = ctx.req.headers["x-nod-versao"];
      const decisao = decidirAtualizacaoDoApp({ atual, config: o.config, arch, plataforma });
      if (!decisao.anunciar || !o.assinar) { ctx.res.writeHead(204).end(); return; }
      let url: string;
      try {
        url = await o.assinar(decisao.objeto);
      } catch (e) {
        log("aviso", "atualizacao_app_assinatura_falhou", { arch, versao: decisao.versao, codigo: e instanceof Error ? e.message.slice(0, 60) : "desconhecido" });
        ctx.json(503, { codigo: "atualizacao_indisponivel", mensagem: "atualização indisponível agora" });
        return;
      }
      log("info", "atualizacao_app_anunciada", { arch, plataforma, versao: decisao.versao, de: typeof atual === "string" ? atual.slice(0, 32) : null });
      ctx.json(200, { url, name: decisao.versao, notes: "", pub_date: o.publicadaEm ?? "1970-01-01T00:00:00Z", sha256: decisao.sha256 });
    },
  }];
}
