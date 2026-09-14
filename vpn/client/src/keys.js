// Генерация ключей WireGuard/AmneziaWG средствами встроенного в Node crypto.
//
// Ключи WireGuard — это X25519 (Curve25519) в виде 32 сырых байт, закодированных
// в base64. Node отдаёт ключи только в обёртках DER (PKCS#8 для приватного,
// SPKI для публичного), поэтому здесь мы снимаем и надеваем эти обёртки вручную.
// Префиксы фиксированы и определены в RFC 8410 (OID 1.3.101.110 — X25519).

const crypto = require('crypto');

const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function rawFromDer(der, prefixLength) {
  return der.subarray(prefixLength);
}

/** Новая пара ключей. Возвращает base64-строки, как их ждёт конфиг WireGuard. */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey: rawFromDer(privDer, PKCS8_X25519_PREFIX.length).toString('base64'),
    publicKey: rawFromDer(pubDer, SPKI_X25519_PREFIX.length).toString('base64'),
  };
}

/** Публичный ключ из приватного — нужен, чтобы не хранить публичный отдельно. */
function publicKeyFrom(privateKeyBase64) {
  const raw = Buffer.from(privateKeyBase64, 'base64');
  if (raw.length !== 32) throw new Error('приватный ключ должен быть 32 байта в base64');
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_X25519_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
  const pubDer = crypto.createPublicKey(keyObject).export({ type: 'spki', format: 'der' });
  return rawFromDer(pubDer, SPKI_X25519_PREFIX.length).toString('base64');
}

/** Предварительно разделённый ключ: дополнительный симметричный слой поверх X25519. */
function generatePresharedKey() {
  return crypto.randomBytes(32).toString('base64');
}

function isValidKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{42}[A-Za-z0-9+/=]=$/.test(value)) return false;
  return Buffer.from(value, 'base64').length === 32;
}

module.exports = { generateKeyPair, publicKeyFrom, generatePresharedKey, isValidKey };
