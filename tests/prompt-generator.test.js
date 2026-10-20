const {test} = require('node:test');
const assert = require('node:assert/strict');
const generator = require('../prompt-generator');

const check = (title, description = '', completed = false) => ({title, description, completed});
const card = (id, extra = {}) => ({id, title:`Implementar ${id}`, type:'Tarefa', status:'Planejado', description:'Contexto de produto', checklist:[], tags:[], ...extra});
const main = card('principal', {type:'Funcionalidade', checklist:[check('Validar acesso', 'Rejeitar credencial inválida'), check('CONCLUÍDO SECRETO', 'INSTRUÇÃO CONCLUÍDA', true), check('Rever sessão', 'Expirar após inatividade')], notes:'Observação útil', tags:['segurança']});
const child = card('filho', {relatedId:main.id, status:'Bloqueado', blockReason:'Aguardar decisão de segurança'});
const done = card('CARD CONCLUÍDO', {relatedId:main.id, status:'Concluído', checklist:[check('NÃO INCLUIR', 'NÃO INCLUIR INSTRUÇÃO')]});
const grandchild = card('neto', {relatedId:child.id});
const all = [main, child, done, grandchild];
const generate = (prefs = {}, seeds = [main], cards = all) => generator.generate(cards, seeds, 'Produto', prefs);

test('defaults e preferências inválidas são normalizados', () => {
  assert.deepEqual(generator.normalize(null), generator.defaults);
  assert.equal(generator.normalize({mode:'inválido'}).mode, 'auto');
  assert.equal(generator.normalize({mode:'toString'}).mode, 'auto');
  assert.equal(generator.normalize({includeRelated:false}).includeRelated, false);
});
test('card simples usa título, descrição e não cria seções vazias', () => {
  const simple = card('simples', {description:'Comportamento esperado'});
  const result = generate({}, [simple], [simple]);
  assert.match(result.text, /Comportamento esperado/);
  assert.doesNotMatch(result.text, /## CRITÉRIOS DE CONCLUSÃO|## DEPENDÊNCIAS E BLOQUEIOS|Instruções:/);
  assert.equal(result.outputs.length, 1);
});
test('padrão Engenheiro contém formato, instruções, bloqueios e critérios', () => {
  const text = generate().text;
  for (const section of ['# SOLICITAÇÃO AO ENGENHEIRO DE CODEX', 'TIPO DE SOLICITAÇÃO', 'OBJETIVO DE PRODUTO', 'CONTEXTO FORNECIDO', 'TRABALHO AINDA ABERTO', 'DEPENDÊNCIAS E BLOQUEIOS', 'CRITÉRIOS DE CONCLUSÃO', 'ORIENTAÇÃO AO ENGENHEIRO DE CODEX', 'ENTREGA ESPERADA']) assert.ok(text.includes(section), section);
  assert.match(text, /Rejeitar credencial inválida/);
  assert.match(text, /Aguardar decisão de segurança/);
  assert.match(text, /CODEX ACTION PACKET/);
  assert.match(text, /vários trabalhos independentes/);
});
test('cards e checklists concluídos nunca entram em texto ou avisos', () => {
  for (const division of Object.keys(generator.fields.division[1])) {
    const result = generate({division});
    assert.doesNotMatch(result.text + result.warnings.join(''), /CONCLUÍDO|CONCLUÍDA|NÃO INCLUIR/);
  }
  assert.equal(generate({}, [done]).text, '');
});
test('escopos item, relacionados, feature e selecionados', () => {
  assert.deepEqual(generate({scope:'item'}).items.map(i=>i.id), [main.id]);
  assert.deepEqual(generate().items.map(i=>i.id), [main.id,child.id]);
  assert.deepEqual(generate({scope:'feature'}, [child]).items.map(i=>i.id), [main.id,child.id,grandchild.id]);
  assert.deepEqual(generate({scope:'selected'}, [child,grandchild]).items.map(i=>i.id), [child.id,grandchild.id]);
  assert.deepEqual(generate({includeRelated:false}).items.map(i=>i.id), [main.id]);
});
test('feature atravessa ancestrais concluídos sem incluí-los e tolera ciclos', () => {
  const root = card('raiz', {status:'Concluído'}), a = card('a',{relatedId:'raiz'}), b = card('b',{relatedId:'raiz'});
  assert.deepEqual(generate({scope:'feature'}, [a], [root,a,b]).items.map(i=>i.id), ['a','b']);
  const x=card('x',{relatedId:'y'}), y=card('y',{relatedId:'x'});
  assert.equal(generate({scope:'feature'}, [x], [x,y]).items.length, 2);
});
for (const destination of ['engineer','direct']) for (const mode of Object.keys(generator.fields.mode[1])) {
  test(`${destination}: modo ${mode}`, () => {
    const text = generate({destination,mode}).text;
    if (mode === 'plan' || mode === 'investigate' || mode === 'decompose') assert.match(text, /não altere código|Não altere código/);
    if (mode === 'auto') assert.match(text, /recomende INVESTIGAR, PLANEJAR ou EXECUTAR/);
    if (mode === 'execute') assert.match(text, /EXECUTAR: implemente/);
    if (destination === 'direct') {
      for (const heading of ['OBJETIVO','CONTEXTO ESSENCIAL','ESCOPO','RESTRIÇÕES','EXECUÇÃO','VALIDAÇÃO','ENTREGA']) assert.ok(text.includes(`## ${heading}\n`));
      assert.match(text, /AGENTS.md/); assert.match(text, /git diff e git status/);
    }
  });
}
test('níveis de contexto preservam instruções essenciais e limitam detalhes', () => {
  const minimal = generate({context:'minimal'}).text, balanced = generate().text, full = generate({context:'full'}).text;
  assert.match(minimal, /Contexto de produto/); assert.match(minimal, /Rejeitar credencial inválida/);
  assert.doesNotMatch(minimal, /CONTEXTO FORNECIDO|Observação útil|Tags:/);
  assert.doesNotMatch(balanced, /Observação útil|Tags:/);
  assert.match(full, /Observação útil/); assert.match(full, /Tags: segurança/);
});
test('divisão gera uma saída por checklist aberto sem misturar outras instruções', () => {
  const result = generate({division:'checklist',scope:'item'});
  assert.equal(result.outputs.length, 2);
  assert.match(result.outputs[0], /Rejeitar credencial inválida/);
  assert.doesNotMatch(result.outputs[0], /Expirar após inatividade/);
  assert.match(result.outputs[1], /Expirar após inatividade/);
  assert.doesNotMatch(result.outputs[1], /Rejeitar credencial inválida/);
  assert.equal(generate({division:'checklist'}).outputs.length, 3); // Card relacionado sem checklist mantém saída própria.
});
test('avisos determinísticos não bloqueiam a geração', () => {
  const i=card('genérico',{title:'tarefa',checklist:[check('fazer'),check('Instrução longa','x'.repeat(701)),check('Ignorar aviso','',true)]});
  const result=generate({},[i],[i]);
  assert.equal(result.warnings.length, 4);
  assert.ok(result.text);
  assert.doesNotMatch(result.warnings.join(''), /Ignorar aviso/);
});
test('opções desativam seções e instruções correspondentes', () => {
  const text=generate({includeBlockers:false,includeCriteria:false,actionPacket:false,investigateFirst:false,includeRelated:false}).text;
  assert.doesNotMatch(text, /DEPENDÊNCIAS E BLOQUEIOS|CRITÉRIOS DE CONCLUSÃO|CODEX ACTION PACKET|Se uma informação técnica/);
});
test('validação usa políticas e não inventa comandos', () => {
  for (const validation of Object.keys(generator.fields.validation[1])) {
    const text=generate({validation}).text;
    assert.match(text, /não invente comandos/);
    assert.doesNotMatch(text, /npm |pnpm |yarn /);
  }
});
test('não renderiza campos vazios nem marcadores undefined/null em qualquer combinação', () => {
  for (const destination of ['engineer','direct']) for (const context of ['minimal','balanced','full']) for (const division of ['auto','single','checklist']) {
    const text=generate({destination,context,division}).text;
    assert.doesNotMatch(text, /undefined|null|Instruções:\s*\n\s*#/);
    for (const match of text.matchAll(/^## [^\n]+\n\n([\s\S]*?)(?=\n\n## |$)/gm)) assert.ok(match[1].trim());
  }
});
