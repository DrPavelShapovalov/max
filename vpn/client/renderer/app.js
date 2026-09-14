// Рендерер: собирает форму, дёргает главный процесс через мост window.maxvpn.

const $ = (id) => document.getElementById(id);

const logBox = $('log');
const statusDot = $('statusDot');
const statusText = $('statusText');

function appendLog(line) {
  const time = new Date().toLocaleTimeString('ru-RU');
  logBox.textContent += `[${time}] ${line}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(text, state) {
  statusText.textContent = text;
  statusDot.className = `dot${state ? ' ' + state : ''}`;
}

function busy(isBusy) {
  ['deployBtn', 'connectBtn', 'disconnectBtn', 'addPeerBtn', 'refreshPeersBtn'].forEach((id) => {
    $(id).disabled = isBusy;
  });
}

function sshOptions() {
  const usesKey = $('authMethod').value === 'key';
  return {
    host: $('host').value.trim(),
    sshPort: $('sshPort').value,
    username: $('username').value.trim() || 'root',
    password: usesKey ? '' : $('password').value,
    privateKeyPath: usesKey ? $('privateKeyPath').value.trim() : '',
  };
}

function validateSsh(options) {
  if (!options.host) throw new Error('Укажите адрес сервера.');
  if (!options.password && !options.privateKeyPath) {
    throw new Error('Укажите пароль или путь к приватному ключу SSH.');
  }
}

async function guard(action) {
  busy(true);
  try {
    await action();
  } catch (error) {
    appendLog(`Ошибка: ${error.message}`);
    setStatus('Ошибка — смотрите журнал', 'err');
  } finally {
    busy(false);
  }
}

// ------------------------------------------------------------------ действия

$('authMethod').addEventListener('change', (event) => {
  const usesKey = event.target.value === 'key';
  $('passwordField').classList.toggle('hidden', usesKey);
  $('keyField').classList.toggle('hidden', !usesKey);
});

$('mode').addEventListener('change', updateModeHint);

function updateModeHint() {
  $('modeHint').textContent =
    $('mode').value === 'awg'
      ? 'AmneziaWG маскирует трафик, чтобы он не опознавался как WireGuard. Требует сборки модуля ядра на сервере; на OpenVZ и LXC работать не будет.'
      : 'Обычный WireGuard: быстрее ставится и совместим с любым штатным клиентом, но легко распознаётся системами анализа трафика.';
}

$('deployBtn').addEventListener('click', () =>
  guard(async () => {
    const options = sshOptions();
    validateSsh(options);
    setStatus('Настраиваю сервер…');
    appendLog('Начинаю установку.');

    const result = await window.maxvpn.deploy({
      ...options,
      mode: $('mode').value,
      vpnPort: $('vpnPort').value,
      deviceName: $('deviceName').value.trim(),
      dns: $('dns').value.trim(),
    });

    appendLog(`Готово. Конфигурация: ${result.confPath}`);
    setStatus('Сервер настроен, можно подключаться', 'on');
    await refreshTunnelStatus();
  })
);

$('connectBtn').addEventListener('click', () =>
  guard(async () => {
    setStatus('Поднимаю туннель…');
    const result = await window.maxvpn.tunnelUp();
    if (!result.ok) throw new Error(result.error);
    appendLog(`Туннель «${result.name}» поднят.`);
    await refreshTunnelStatus();
  })
);

$('disconnectBtn').addEventListener('click', () =>
  guard(async () => {
    const result = await window.maxvpn.tunnelDown();
    if (!result.ok) throw new Error(result.error);
    appendLog('Туннель остановлен.');
    await refreshTunnelStatus();
  })
);

$('exportBtn').addEventListener('click', () =>
  guard(async () => {
    const result = await window.maxvpn.exportConf(null);
    appendLog(result.saved ? `Конфигурация сохранена: ${result.filePath}` : 'Сохранение отменено.');
  })
);

$('refreshPeersBtn').addEventListener('click', () =>
  guard(async () => {
    const options = sshOptions();
    validateSsh(options);
    renderPeers(await window.maxvpn.listPeers(options));
  })
);

$('addPeerBtn').addEventListener('click', () =>
  guard(async () => {
    const options = sshOptions();
    validateSsh(options);
    const name = $('peerName').value.trim();
    if (!name) throw new Error('Введите имя нового устройства.');

    const result = await window.maxvpn.addPeer({ ...options, name });
    appendLog(`Устройство «${result.name}» добавлено. Конфигурация ниже — перенесите её на устройство.`);
    appendLog(result.conf);
    $('peerName').value = '';
    renderPeers(await window.maxvpn.listPeers(options));
  })
);

function renderPeers(peers) {
  const tbody = document.querySelector('#peersTable tbody');
  tbody.textContent = '';

  if (!peers.length) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = 'Устройств пока нет';
    return;
  }

  for (const peer of peers) {
    const row = tbody.insertRow();
    row.insertCell().textContent = peer.name;
    row.insertCell().textContent = peer.address;
    row.insertCell().textContent = peer.latestHandshake
      ? new Date(peer.latestHandshake * 1000).toLocaleString('ru-RU')
      : 'не подключалось';

    const actions = row.insertCell();
    const remove = document.createElement('button');
    remove.textContent = 'Удалить';
    remove.addEventListener('click', () =>
      guard(async () => {
        const options = sshOptions();
        validateSsh(options);
        await window.maxvpn.removePeer({ ...options, name: peer.name });
        appendLog(`Устройство «${peer.name}» удалено.`);
        renderPeers(await window.maxvpn.listPeers(options));
      })
    );
    actions.appendChild(remove);
  }
}

async function refreshTunnelStatus() {
  const state = await window.maxvpn.tunnelStatus();
  setStatus(state.up ? 'Подключено' : 'Отключено', state.up ? 'on' : null);
}

// --------------------------------------------------------------- инициализация

window.maxvpn.onLog(appendLog);

(async function init() {
  updateModeHint();
  const { profile, hasConf, tunnelEnv } = await window.maxvpn.getProfile();

  if (profile.host) $('host').value = profile.host;
  if (profile.sshPort) $('sshPort').value = profile.sshPort;
  if (profile.username) $('username').value = profile.username;
  if (profile.mode) $('mode').value = profile.mode;
  if (profile.deviceName) $('deviceName').value = profile.deviceName;
  if (profile.vpnPort) $('vpnPort').value = profile.vpnPort;
  if (profile.privateKeyPath) {
    $('authMethod').value = 'key';
    $('privateKeyPath').value = profile.privateKeyPath;
    $('authMethod').dispatchEvent(new Event('change'));
  }
  updateModeHint();

  if (!tunnelEnv.supported) appendLog(tunnelEnv.reason);
  if (hasConf) {
    await refreshTunnelStatus();
  } else {
    setStatus('Сервер ещё не настроен');
  }
})();
