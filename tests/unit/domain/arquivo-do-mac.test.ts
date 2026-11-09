import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../../../src/contracts/json-schema.ts";
import { arquivosDoMac, caminhoRecusado, comArquivoDoMac, DICA_ARQUIVO_DO_MAC, ehCaminhoDoMac, mimetypeDoArquivo, nomeDoArquivo, trocarArquivos } from "../../../src/domain/arquivo-do-mac.ts";

/**
 * ADR-068: o bot põe o caminho do Mac no `s3key` de qualquer ferramenta que recebe arquivo; o servidor sobe e troca.
 * Os formatos abaixo são os do catálogo real do nod em 01/10 (ClickUp `attachment`, Slack `file` único ou lista).
 */
describe("arquivo do Mac nos argumentos (ADR-068)", () => {
  it("caminho do Mac começa com / ou ~/; chave do Composio não", () => {
    expect(ehCaminhoDoMac("/Users/m/nod/Dev 4/videos/filtros.webm")).toBe(true);
    expect(ehCaminhoDoMac("~/nod/Dev 2/qa-videos/x.mp4")).toBe(true);
    expect(ehCaminhoDoMac("47563/gmail/GET_ATTACHMENT/response/12345")).toBe(false);
    expect(ehCaminhoDoMac(42)).toBe(false);
  });

  it("acha o arquivo no anexo do ClickUp, no file do Slack (único ou lista) e ignora o que já é chave", () => {
    const clickup = { task_id: "86akr9u9u", attachment: { name: "filtros.webm", mimetype: "video/webm", s3key: "~/nod/Dev 4/videos/filtros.webm" } };
    expect(arquivosDoMac(clickup)).toEqual([{ caminho: "~/nod/Dev 4/videos/filtros.webm", nome: "filtros.webm", mimetype: "video/webm" }]);
    const slack = { channels: "C1", file: [{ name: "", mimetype: "", s3key: "/tmp/a.png" }, { name: "b.pdf", mimetype: "application/pdf", s3key: "1/slack/x" }] };
    expect(arquivosDoMac(slack)).toEqual([{ caminho: "/tmp/a.png", nome: null, mimetype: null }]);
    expect(arquivosDoMac({ texto: "/tmp/a.png", s3key: 3 })).toEqual([]);
  });

  it("troca só os caminhos subidos, completando nome e mimetype; o resto fica intacto", () => {
    const args = { channels: "C1", initial_comment: "vídeo do QA", file: [{ name: "", mimetype: "", s3key: "/tmp/a.png" }, { name: "b.pdf", mimetype: "application/pdf", s3key: "1/slack/x" }] };
    const r = trocarArquivos(args, new Map([["/tmp/a.png", { s3key: "999/slack/upload/a", nome: "a.png", mimetype: "image/png" }]]));
    expect(r).toEqual({ channels: "C1", initial_comment: "vídeo do QA", file: [{ name: "a.png", mimetype: "image/png", s3key: "999/slack/upload/a" }, { name: "b.pdf", mimetype: "application/pdf", s3key: "1/slack/x" }] });
    expect(args.file[0]!.s3key).toBe("/tmp/a.png");
  });

  it("nome e mimetype: o que o bot deu, senão o do arquivo; credencial nunca sai", () => {
    expect(nomeDoArquivo({ caminho: "~/nod/Dev 4/videos/filtros-desktop.webm", nome: null, mimetype: null })).toBe("filtros-desktop.webm");
    expect(mimetypeDoArquivo({ caminho: "/x/QA.MP4", nome: null, mimetype: null })).toBe("video/mp4");
    expect(mimetypeDoArquivo({ caminho: "/x/sem-extensao", nome: null, mimetype: null })).toBe("application/octet-stream");
    expect(mimetypeDoArquivo({ caminho: "/x/a.webm", nome: null, mimetype: "video/x-custom" })).toBe("video/x-custom");
    expect(caminhoRecusado("/Users/m/.ssh/id_ed25519")).not.toBeNull();
    expect(caminhoRecusado("~/nod/Dev 4/videos/filtros.webm")).toBeNull();
  });

  it("o schema do plano diz ao bot que o s3key aceita o caminho do Mac — no objeto e na lista; a validação não muda", () => {
    const arquivo = { type: "object", required: ["name", "s3key", "mimetype"], properties: { name: { type: "string" }, s3key: { type: "string", description: "The S3 key of a publicly accessible file" }, mimetype: { type: "string" } } };
    const schema = { type: "object", properties: { channels: { type: "string" }, file: { anyOf: [arquivo, { type: "array", items: arquivo }] } } } as unknown as JsonSchema;
    const r = comArquivoDoMac(schema) as unknown as { properties: { file: { anyOf: [typeof arquivo, { items: typeof arquivo }] }; channels: unknown } };
    expect(r.properties.file.anyOf[0].properties.s3key).toEqual({ type: "string", description: DICA_ARQUIVO_DO_MAC });
    expect(r.properties.file.anyOf[1].items.properties.s3key.description).toBe(DICA_ARQUIVO_DO_MAC);
    expect(r.properties.file.anyOf[0].required).toEqual(["name", "s3key", "mimetype"]);
    expect(r.properties.channels).toEqual({ type: "string" });
    // Ferramenta sem arquivo: igual.
    const semArquivo = { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } as unknown as JsonSchema;
    expect(comArquivoDoMac(semArquivo)).toEqual(semArquivo);
  });
});
