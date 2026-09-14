// Управление туннелем на стороне клиента.
//
// Собственного драйвера туннеля здесь нет: приложение вызывает штатные утилиты
// WireGuard/AmneziaWG, установленные в системе. Это осознанный выбор — драйвер
// уровня ядра (WinTun, wireguard-go) требует подписи и прав администратора, и
// дублировать его в v1 смысла нет.
//
// Windows: wireguard.exe /installtunnelservice и /uninstalltunnelservice создают
//   и удаляют службу WireGuardTunnel$<имя>, описаны в
//   https://github.com/WireGuard/wireguard-windows/blob/master/docs/enterprise.md
// Linux/macOS: wg-quick up|down, для AmneziaWG — awg-quick.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\WireGuard\\wireguard.exe',
  'C:\\Program Files (x86)\\WireGuard\\wireguard.exe',
];

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 60000, ...opts }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? (error.code ?? 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || (error ? error.message : '')),
      });
    });
  });
}

async function which(binary) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = await run(finder, [binary]);
  return result.ok ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

/**
 * Что доступно в системе для поднятия туннеля.
 * @param {'wg'|'awg'} mode
 */
async function detect(mode) {
  const platform = process.platform;

  if (platform === 'win32') {
    const exe = WINDOWS_CANDIDATES.find((p) => fs.existsSync(p)) || (await which('wireguard.exe'));
    if (mode === 'awg') {
      return {
        supported: false,
        platform,
        reason:
          'Для AmneziaWG в Windows нужен клиент AmneziaVPN или AmneziaWG: сохраните ' +
          'конфиг кнопкой «Экспортировать .conf» и импортируйте его в этот клиент. ' +
          'Формат конфига уже правильный — обфускация записана в секцию [Interface].',
      };
    }
    if (!exe) {
      return {
        supported: false,
        platform,
        reason: 'Не найден wireguard.exe. Установите WireGuard для Windows с https://www.wireguard.com/install/',
      };
    }
    return { supported: true, platform, binary: exe, needsAdmin: true };
  }

  const quick = mode === 'awg' ? 'awg-quick' : 'wg-quick';
  const quickPath = await which(quick);
  if (!quickPath) {
    const hint =
      mode === 'awg'
        ? 'Установите amneziawg-tools (в Ubuntu: sudo add-apt-repository ppa:amnezia/ppa && sudo apt install amneziawg).'
        : platform === 'darwin'
          ? 'Установите wireguard-tools: brew install wireguard-tools'
          : 'Установите wireguard-tools: sudo apt install wireguard-tools';
    return { supported: false, platform, reason: `Не найдена утилита ${quick}. ${hint}` };
  }

  // Поднятие интерфейса требует root. pkexec покажет графический запрос пароля,
  // sudo без пароля сработает молча; иначе честно скажем, что нужно вручную.
  const elevator = (await which('pkexec')) ? 'pkexec' : null;
  return { supported: true, platform, binary: quickPath, tool: quick, elevator, needsAdmin: true };
}

function tunnelNameFromConf(confPath) {
  return path.basename(confPath, '.conf');
}

async function up(confPath, mode) {
  const env = await detect(mode);
  if (!env.supported) return { ok: false, error: env.reason };

  if (env.platform === 'win32') {
    // wireguard.exe берёт имя туннеля из имени файла, поэтому путь должен быть
    // постоянным — конфиг лежит в каталоге данных приложения.
    const result = await run(env.binary, ['/installtunnelservice', confPath]);
    if (!result.ok) {
      return {
        ok: false,
        error:
          'Не удалось создать службу туннеля. Запустите приложение от имени администратора.\n' +
          (result.stderr || result.stdout),
      };
    }
    return { ok: true, name: tunnelNameFromConf(confPath) };
  }

  const args = [env.tool, 'up', confPath];
  const result = env.elevator
    ? await run(env.elevator, args)
    : await run('sudo', ['-n', ...args]);

  if (!result.ok) {
    return {
      ok: false,
      error:
        `Не удалось поднять туннель (${env.tool}). Нужны права root.\n` +
        `Проверьте вручную:  sudo ${env.tool} up ${confPath}\n` +
        (result.stderr || result.stdout),
    };
  }
  return { ok: true, name: tunnelNameFromConf(confPath) };
}

async function down(confPath, mode) {
  const env = await detect(mode);
  if (!env.supported) return { ok: false, error: env.reason };

  if (env.platform === 'win32') {
    const result = await run(env.binary, ['/uninstalltunnelservice', tunnelNameFromConf(confPath)]);
    return result.ok
      ? { ok: true }
      : { ok: false, error: result.stderr || result.stdout || 'служба туннеля не остановлена' };
  }

  const args = [env.tool, 'down', confPath];
  const result = env.elevator
    ? await run(env.elevator, args)
    : await run('sudo', ['-n', ...args]);
  return result.ok
    ? { ok: true }
    : { ok: false, error: result.stderr || result.stdout || 'туннель не остановлен' };
}

/** Поднят ли туннель прямо сейчас. */
async function status(confPath, mode) {
  const name = tunnelNameFromConf(confPath);

  if (process.platform === 'win32') {
    const result = await run('sc', ['query', `WireGuardTunnel$${name}`]);
    return { up: result.ok && /RUNNING/.test(result.stdout), name };
  }

  const result = await run('ip', ['link', 'show', name]);
  return { up: result.ok, name };
}

module.exports = { detect, up, down, status, tunnelNameFromConf, osPlatform: os.platform() };
