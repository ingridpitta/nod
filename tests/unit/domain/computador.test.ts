import { expect, it } from "vitest";
import { alteraComputador, validarAcaoComputador } from "../../../src/domain/computador.ts";
const quadro = "a".repeat(64);
it("valida controle nativo, atalhos, áudio e operações de arquivo", () => {
  expect(validarAcaoComputador({tipo:"arrastar",x:1,y:2,destinoX:100,destinoY:200,quadro})).toMatchObject({tipo:"arrastar",destinoX:100});
  expect(validarAcaoComputador({tipo:"tecla",tecla:"Control+Shift+F12",quadro})).toMatchObject({tecla:"Control+Shift+F12"});
  expect(validarAcaoComputador({tipo:"ler_arquivo",caminho:"/workspace/a.txt"})).toEqual({tipo:"ler_arquivo",caminho:"a.txt"});
  expect(alteraComputador({tipo:"tecla",tecla:"Enter",quadro})).toBe(true);
  expect(alteraComputador({tipo:"audio",segundos:5})).toBe(false);
  expect(validarAcaoComputador({tipo:"ler_texto",caminho:"/workspace/a.txt"})).toEqual({tipo:"ler_texto",caminho:"a.txt",inicio:0});
  expect(alteraComputador({tipo:"ler_texto",caminho:"a.txt",inicio:0})).toBe(false);
  expect(alteraComputador({tipo:"gravar_texto",caminho:"a.txt",texto:"Olá",revisao:"novo"})).toBe(true);
});
it.each(["/etc/passwd","../outro","/workspacex/segredo","a/../../b","a\\b","a\0b"])("recusa caminho fora do workspace: %s", caminho => {
  expect(()=>validarAcaoComputador({tipo:"ler_arquivo",caminho})).toThrow("entrada_invalida");
});
it.each([
  {tipo:"clicar",x:-1,y:0,quadro}, {tipo:"clicar",x:1280,y:0,quadro}, {tipo:"clicar",x:1,y:2,quadro:"antigo"},
  {tipo:"audio",segundos:11}, {tipo:"navegar",url:"file:///etc/passwd"}, {tipo:"tecla",tecla:"Return;curl",quadro},
  {tipo:"ler_texto",caminho:"a.txt",inicio:1}, {tipo:"ler_texto",caminho:"a.txt",inicio:0.5},
  {tipo:"gravar_texto",caminho:"a.txt",texto:"novo",revisao:"inventada"},
])("falha fechado para comando malformado %j", valor => { expect(()=>validarAcaoComputador(valor)).toThrow("entrada_invalida"); });
