import { expect, it } from "vitest";
import { criarProxy } from "../../src/adapters/mcp-proxy/proxy.ts";
import type { ClienteNod } from "../../src/adapters/executor/cliente-nod.ts";
import { planoHarness } from "../helpers/plano-harness.ts";
it("proxy encaminha imagem e áudio nativos sem truncar base64 e delimita o texto da página",async()=>{
  const plano=planoHarness();plano.expiraEm=1000;
  plano.catalogo.ferramentas=[{nome:"computador_observar",nomeMcp:"mcp__nod__computador_observar",origem:"computador",conectorId:null,readOnlyHint:true,tocaDadoPessoal:true,schema:{type:"object"}}];
  const imagem="a".repeat(30000);const audio="b".repeat(30000);
  const cliente:ClienteNod={plano:async()=>({ok:true,plano}),ferramenta:async()=>({ok:true,conteudo:"Texto do site",confianca:"nao_confiavel",imagem:{mimeType:"image/png",data:imagem},audio:{mimeType:"audio/wav",data:audio}}),aguardar:async()=>({estado:"pendente"}),negacao:async()=>{},chamarFerramenta:async()=>({conteudo:"",isError:false})};
  const proxy=criarProxy({cliente,agora:()=>1});
  await proxy.tratarLinha(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize"}));
  const r=JSON.parse((await proxy.tratarLinha(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"computador_observar",arguments:{}}})))!);
  expect(r.result.content).toEqual([expect.objectContaining({type:"text",text:expect.stringContaining("Texto do site")}),{type:"image",mimeType:"image/png",data:imagem},{type:"audio",mimeType:"audio/wav",data:audio}]);
  expect(r.result.content[0].text).not.toBe("Texto do site");
});
