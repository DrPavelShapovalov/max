// Проверки, которые не требуют ни Electron, ни сервера: node test/run.js

const assert = require('assert');
const { generateKeyPair, publicKeyFrom, generatePresharedKey, isValidKey } = require('../src/keys');
const { buildClientConf, parseServerJson } = require('../src/config');

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log('Ключи');

test('пара ключей имеет корректную длину и кодировку', () => {
  const { privateKey, publicKey } = generateKeyPair();
  assert.strictEqual(Buffer.from(privateKey, 'base64').length, 32);
  assert.strictEqual(Buffer.from(publicKey, 'base64').length, 32);
  assert.ok(isValidKey(privateKey) && isValidKey(publicKey));
});

test('публичный ключ выводится из приватного', () => {
  const { privateKey, publicKey } = generateKeyPair();
  assert.strictEqual(publicKeyFrom(privateKey), publicKey);
});

test('деривация совпадает с тестовым вектором RFC 7748, раздел 6.1', () => {
  // Приватный и публичный ключ Алисы из RFC 7748 (X25519).
  // https://www.rfc-editor.org/rfc/rfc7748#section-6.1
  const privHex = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
  const pubHex = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
  const derived = publicKeyFrom(Buffer.from(privHex, 'hex').toString('base64'));
  assert.strictEqual(Buffer.from(derived, 'base64').toString('hex'), pubHex);
});

test('короткий ключ отвергается', () => {
  assert.throws(() => publicKeyFrom(Buffer.alloc(16).toString('base64')), /32 байта/);
});

test('предварительно разделённый ключ — 32 случайных байта', () => {
  const a = generatePresharedKey();
  const b = generatePresharedKey();
  assert.strictEqual(Buffer.from(a, 'base64').length, 32);
  assert.notStrictEqual(a, b);
});

console.log('Конфигурация');

const base = {
  privateKey: 'aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8xMg=',
  address: '10.28.0.2',
  dns: '1.1.1.1,1.0.0.1',
  serverPublicKey: 'c2VydmVyIHB1YmxpYyBrZXkgc2VydmVyIHB1YmxpYw=',
  presharedKey: 'cHJlc2hhcmVkIGtleSBwcmVzaGFyZWQga2V5IHByZQ=',
  endpoint: '203.0.113.10',
  port: 51820,
};

test('конфиг WireGuard содержит все обязательные поля', () => {
  const conf = buildClientConf(base);
  assert.match(conf, /^\[Interface\]/);
  assert.match(conf, /Address = 10\.28\.0\.2\/32/);
  assert.match(conf, /DNS = 1\.1\.1\.1, 1\.0\.0\.1/);
  assert.match(conf, /Endpoint = 203\.0\.113\.10:51820/);
  assert.match(conf, /AllowedIPs = 0\.0\.0\.0\/0, ::\/0/);
  assert.ok(!conf.includes('Jc ='), 'без awg-параметров обфускации быть не должно');
});

test('параметры обфускации попадают в секцию [Interface]', () => {
  const awg = { Jc: 7, Jmin: 8, Jmax: 80, S1: 60, S2: 90, H1: 11, H2: 22, H3: 33, H4: 44 };
  const conf = buildClientConf({ ...base, awg });
  const interfaceSection = conf.split('[Peer]')[0];
  for (const [key, value] of Object.entries(awg)) {
    assert.ok(interfaceSection.includes(`${key} = ${value}`), `нет параметра ${key}`);
  }
});

test('неполный набор параметров обфускации — ошибка', () => {
  assert.throws(() => buildClientConf({ ...base, awg: { Jc: 7 } }), /Jmin/);
});

test('JSON сервера извлекается из смешанного вывода', () => {
  const output = [
    '[paulvpn] ставлю пакеты',
    '---PAULVPN-JSON---',
    '{"mode":"awg","port":51820}',
    '---PAULVPN-JSON-END---',
    '[paulvpn] готово',
  ].join('\n');
  assert.deepStrictEqual(parseServerJson(output), { mode: 'awg', port: 51820 });
});

test('вывод без JSON даёт понятную ошибку', () => {
  assert.throws(() => parseServerJson('что-то пошло не так'), /не вернул параметры/);
});

console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены.');
process.exit(failures ? 1 : 0);
