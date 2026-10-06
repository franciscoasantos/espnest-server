// Auto-teste do canal branco: node src/services/ledService.test.js
//
// Cobre o bug do SK6812 em que o branco sumia: o servidor concluía que `w`
// era 0 e mandava o próximo comando apagando o canal branco.

const assert = require('assert');
const { resolveWhite } = require('./ledService');

// ACK do ESP manda a verdade e ganha de todo mundo.
assert.strictEqual(resolveWhite(120, 200, 40), 120, 'ACK tem prioridade');
assert.strictEqual(resolveWhite(0, 200, 40), 0, 'ACK com 0 é branco apagado de verdade');

// Sem ACK, vale o que o request pediu.
assert.strictEqual(resolveWhite(undefined, 200, 40), 200, 'sem ACK usa o request');
assert.strictEqual(resolveWhite(null, 0, 40), 0, 'request com 0 apaga o branco');

// Comando sem `w` não mexe no branco do firmware — mantém o anterior.
assert.strictEqual(resolveWhite(undefined, null, 40), 40, 'sem ACK e sem request mantém o anterior');
assert.strictEqual(resolveWhite(undefined, null, undefined), null, 'sem histórico não inventa branco');

// Lixo não vira branco.
assert.strictEqual(resolveWhite('120', null, undefined), null, 'string não é branco');
assert.strictEqual(resolveWhite(NaN, null, 40), 40, 'NaN cai para o anterior');

console.log('ledService: ok');
