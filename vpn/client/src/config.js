// Сборка клиентского конфига WireGuard/AmneziaWG.
//
// Формат совпадает с тем, что читают wg-quick и awg-quick: параметры обфускации
// AmneziaWG (Jc, Jmin, Jmax, S1, S2, H1..H4) пишутся в секцию [Interface] рядом
// с обычными полями WireGuard.
// Источник: https://github.com/amnezia-vpn/amneziawg-linux-kernel-module

const AWG_KEYS = ['Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'H1', 'H2', 'H3', 'H4'];

/**
 * @param {object} p
 * @param {string} p.privateKey       приватный ключ этого устройства (base64)
 * @param {string} p.address          выданный сервером адрес, например 10.28.0.2
 * @param {string} p.dns              DNS через запятую
 * @param {string} p.serverPublicKey  публичный ключ сервера (base64)
 * @param {string} [p.presharedKey]   общий предварительный ключ (base64)
 * @param {string} p.endpoint         адрес сервера
 * @param {number} p.port             UDP-порт сервера
 * @param {object} [p.awg]            параметры обфускации, если режим awg
 * @param {string} [p.allowedIPs]     какой трафик заворачивать в туннель
 */
function buildClientConf(p) {
  const lines = ['[Interface]'];
  lines.push(`PrivateKey = ${p.privateKey}`);
  lines.push(`Address = ${p.address}/32`);
  if (p.dns) lines.push(`DNS = ${p.dns.split(',').map((s) => s.trim()).join(', ')}`);

  if (p.awg) {
    for (const key of AWG_KEYS) {
      if (p.awg[key] === undefined) throw new Error(`в параметрах AmneziaWG нет поля ${key}`);
      lines.push(`${key} = ${p.awg[key]}`);
    }
  }

  lines.push('');
  lines.push('[Peer]');
  lines.push(`PublicKey = ${p.serverPublicKey}`);
  if (p.presharedKey) lines.push(`PresharedKey = ${p.presharedKey}`);
  lines.push(`AllowedIPs = ${p.allowedIPs || '0.0.0.0/0, ::/0'}`);
  lines.push(`Endpoint = ${p.endpoint}:${p.port}`);
  // Держит NAT на стороне провайдера открытым, чтобы сервер мог достучаться первым.
  lines.push('PersistentKeepalive = 25');

  return lines.join('\n') + '\n';
}

/**
 * Достаёт JSON сервера из вывода install-server.sh --json.
 * Скрипт печатает логи в stderr, а JSON — между маркерами, поэтому разбирать
 * весь вывод целиком не нужно.
 */
function parseServerJson(output) {
  const match = output.match(/---PAULVPN-JSON---\s*([\s\S]*?)\s*---PAULVPN-JSON-END---/);
  if (!match) {
    throw new Error('сервер не вернул параметры установки — смотрите журнал выполнения');
  }
  return JSON.parse(match[1]);
}

module.exports = { buildClientConf, parseServerJson, AWG_KEYS };
