// PaulVPN — главный процесс Electron.
//
// Логика разворачивания сервера целиком здесь: рендерер только собирает форму и
// показывает журнал. Приватный ключ устройства генерируется локально, на сервер
// уходит исключительно публичный.

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const { SshSession, shellQuote } = require('./src/ssh');
const { generateKeyPair, publicKeyFrom, isValidKey } = require('./src/keys');
const { buildClientConf, parseServerJson } = require('./src/config');
const tunnel = require('./src/tunnel');
const { Store } = require('./src/store');

let mainWindow = null;
let store = null;

const REMOTE_DIR = '/root/.paulvpn';

function serverScriptsDir() {
  // В собранном приложении скрипты кладутся в resources/server (extraResources),
  // при запуске из репозитория — берутся из соседнего каталога.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', 'server');
}

function log(line) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log', line);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: 'PaulVPN',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// --------------------------------------------------------------------- SSH

function sshOptionsFrom(options) {
  return {
    host: options.host,
    port: Number(options.sshPort) || 22,
    username: options.username || 'root',
    password: options.password || undefined,
    privateKeyPath: options.privateKeyPath || undefined,
    passphrase: options.passphrase || undefined,
    onLog: log,
  };
}

async function withSsh(options, work) {
  const session = new SshSession(sshOptionsFrom(options));
  await session.connect();
  try {
    return await work(session);
  } finally {
    session.close();
  }
}

/** Проверяет, что на той стороне действительно Debian/Ubuntu и есть root. */
async function assertServerUsable(session) {
  const whoami = await session.exec('id -u');
  if (whoami.stdout.trim() !== '0') {
    throw new Error(
      'Подключение выполнено не под root. Укажите пользователя root или настройте вход по ключу для root.'
    );
  }
  const osInfo = await session.exec('. /etc/os-release && echo "$ID $VERSION_ID"', {
    allowFailure: true,
  });
  const id = osInfo.stdout.trim().split(' ')[0];
  if (!['debian', 'ubuntu'].includes(id)) {
    throw new Error(
      `На сервере ${id || 'неизвестная ОС'}. Установщик рассчитан на Debian и Ubuntu.`
    );
  }
  log(`Операционная система сервера: ${osInfo.stdout.trim()}`);
}

async function uploadScripts(session) {
  const dir = serverScriptsDir();
  const installer = fs.readFileSync(path.join(dir, 'install-server.sh'), 'utf8');
  const cli = fs.readFileSync(path.join(dir, 'paulvpn'), 'utf8');

  await session.exec(`mkdir -p ${REMOTE_DIR} && chmod 700 ${REMOTE_DIR}`);
  await session.upload(installer, `${REMOTE_DIR}/install-server.sh`, 0o700);
  await session.upload(cli, `${REMOTE_DIR}/paulvpn`, 0o700);
  log('Скрипты установки загружены на сервер.');
}

// ------------------------------------------------------------ IPC-обработчики

ipcMain.handle('profile:get', async () => {
  const profile = store.read();
  const hasConf = Boolean(store.readConf());
  const env = await tunnel.detect(profile.mode || 'awg');
  return { profile, hasConf, confPath: store.confPath, tunnelEnv: env };
});

ipcMain.handle('deploy:run', async (_event, options) => {
  const mode = options.mode === 'wg' ? 'wg' : 'awg';
  const deviceName = (options.deviceName || 'desktop').trim();
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(deviceName)) {
    throw new Error('Имя устройства: латиница, цифры, точка, дефис, подчёркивание (до 32 символов).');
  }

  // Ключ устройства создаётся здесь и здесь же остаётся.
  const saved = store.read();
  let privateKey = saved.privateKey;
  if (!privateKey || !isValidKey(privateKey)) {
    ({ privateKey } = generateKeyPair());
    log('Сгенерирована новая пара ключей устройства.');
  } else {
    log('Использую ранее созданный ключ устройства.');
  }
  const publicKey = publicKeyFrom(privateKey);

  const result = await withSsh(options, async (session) => {
    await assertServerUsable(session);
    await uploadScripts(session);

    const installArgs = [
      `--mode ${mode}`,
      options.vpnPort ? `--port ${Number(options.vpnPort)}` : '',
      options.subnet ? `--subnet ${shellQuote(options.subnet)}` : '',
      options.dns ? `--dns ${shellQuote(options.dns)}` : '',
      options.endpoint ? `--endpoint ${shellQuote(options.endpoint)}` : '',
      '--json',
    ]
      .filter(Boolean)
      .join(' ');

    log('Запускаю установку на сервере. Сборка модуля ядра занимает 1-3 минуты.');
    const install = await session.exec(`bash ${REMOTE_DIR}/install-server.sh ${installArgs} 2>&1`, {
      stream: true,
    });
    const info = parseServerJson(install.stdout);
    log(`Сервер настроен: ${info.mode}, ${info.endpoint}:${info.port}`);

    // Если устройство с таким именем уже есть, пересоздаём его под текущий ключ.
    await session.exec(`${REMOTE_DIR}/paulvpn remove ${shellQuote(deviceName)}`, {
      allowFailure: true,
    });
    const add = await session.exec(
      `${REMOTE_DIR}/paulvpn add ${shellQuote(deviceName)} --pubkey ${shellQuote(publicKey)}`
    );
    const peer = JSON.parse(add.stdout.trim());
    log(`Устройство «${peer.name}» добавлено, адрес в туннеле ${peer.address}.`);

    return { info, peer };
  });

  const conf = buildClientConf({
    privateKey,
    address: result.peer.address,
    dns: result.info.dns,
    serverPublicKey: result.info.serverPublicKey,
    presharedKey: result.peer.presharedKey,
    endpoint: result.info.endpoint,
    port: result.info.port,
    awg: result.info.awg,
  });

  const confPath = store.saveConf(conf);
  store.write({
    host: options.host,
    sshPort: Number(options.sshPort) || 22,
    username: options.username || 'root',
    privateKeyPath: options.privateKeyPath || '',
    mode,
    deviceName,
    privateKey,
    endpoint: result.info.endpoint,
    vpnPort: result.info.port,
    serverPublicKey: result.info.serverPublicKey,
  });

  log(`Конфигурация сохранена: ${confPath}`);
  return { confPath, conf, info: result.info, peer: result.peer };
});

ipcMain.handle('peers:list', async (_event, options) =>
  withSsh(options, async (session) => {
    const result = await session.exec(`${REMOTE_DIR}/paulvpn list`);
    return JSON.parse(result.stdout.trim());
  })
);

ipcMain.handle('peers:add', async (_event, options) =>
  withSsh(options, async (session) => {
    const name = shellQuote(options.name);
    // Без --pubkey ключ делает сервер: так удобнее заводить телефон по QR-коду.
    await session.exec(`${REMOTE_DIR}/paulvpn add ${name}`);
    const conf = await session.exec(`${REMOTE_DIR}/paulvpn conf ${name}`);
    return { name: options.name, conf: conf.stdout };
  })
);

ipcMain.handle('peers:remove', async (_event, options) =>
  withSsh(options, async (session) => {
    await session.exec(`${REMOTE_DIR}/paulvpn remove ${shellQuote(options.name)}`);
    return { removed: options.name };
  })
);

ipcMain.handle('tunnel:up', async () => {
  const profile = store.read();
  if (!store.readConf()) throw new Error('Сначала настройте сервер — конфигурации ещё нет.');
  return tunnel.up(store.confPath, profile.mode || 'awg');
});

ipcMain.handle('tunnel:down', async () => {
  const profile = store.read();
  return tunnel.down(store.confPath, profile.mode || 'awg');
});

ipcMain.handle('tunnel:status', async () => {
  const profile = store.read();
  return tunnel.status(store.confPath, profile.mode || 'awg');
});

ipcMain.handle('conf:export', async (_event, text) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить конфигурацию',
    defaultPath: 'paulvpn.conf',
    filters: [{ name: 'Конфигурация WireGuard', extensions: ['conf'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, text ?? store.readConf() ?? '', { mode: 0o600 });
  return { saved: true, filePath };
});

// ------------------------------------------------------------------- запуск

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
