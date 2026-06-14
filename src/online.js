const CHANNEL_NAME = 'soccer-pucks';
const ROOM_PREFIX = 'soccer-pucks-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_LENGTH = 6;
const HOST_CREATE_ATTEMPTS = 5;

const PEERJS_URLS = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
];

const PEER_OPTIONS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

let peerJsPromise = null;

export async function createHostSession(handlers = {}, requestedRoomCode = '') {
  await loadPeerJs();

  const fixedRoomCode = normalizeRoomCode(requestedRoomCode);
  let lastError = null;
  const attempts = fixedRoomCode ? 1 : HOST_CREATE_ATTEMPTS;

  for (let i = 0; i < attempts; i++) {
    const roomCode = fixedRoomCode || generateRoomCode();
    const session = new LobbySession('host', roomCode, handlers);

    try {
      await session.open(roomPeerId(roomCode));
      session.listenForGuest();
      session.handlers.onRoomCode?.(roomCode);
      session.handlers.onStatus?.('Waiting for player');
      return session;
    } catch (err) {
      lastError = err;
      session.close();
      if (err?.type !== 'unavailable-id' || fixedRoomCode) break;
    }
  }

  throw lastError || new Error('Could not create room.');
}

export async function createGuestSession(roomCode, handlers = {}) {
  await loadPeerJs();

  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) throw new Error('Enter a room code.');

  const session = new LobbySession('guest', normalizedRoomCode, handlers);
  await session.open();
  session.connectToHost();
  session.handlers.onStatus?.('Joining room...');
  return session;
}

export function normalizeRoomCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .slice(0, ROOM_LENGTH);
}

class LobbySession {
  constructor(role, roomCode, handlers) {
    this.role = role;
    this.roomCode = roomCode;
    this.handlers = handlers;
    this.peer = null;
    this.connection = null;
    this.closed = false;
  }

  open(peerId) {
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(peerId, PEER_OPTIONS);

      const onOpen = () => {
        detachStartupListeners();
        resolve(this);
      };
      const onError = (err) => {
        detachStartupListeners();
        reject(err);
      };
      const detachStartupListeners = () => {
        this.peer.off?.('open', onOpen);
        this.peer.off?.('error', onError);
      };

      this.peer.on('open', onOpen);
      this.peer.on('error', onError);
      this.peer.on('error', (err) => this.handlePeerError(err));
      this.peer.on('close', () => this.finishClose());
      this.peer.on('disconnected', () => {
        if (!this.connection?.open) this.handlers.onStatus?.('Signaling disconnected');
      });
    });
  }

  listenForGuest() {
    this.peer.on('connection', (connection) => {
      if (connection.label !== CHANNEL_NAME) {
        connection.close();
        return;
      }

      if (this.connection?.open) {
        connection.on('open', () => connection.send({ type: 'roomFull' }));
        connection.close();
        return;
      }

      this.attachConnection(connection);
    });
  }

  connectToHost() {
    const connection = this.peer.connect(roomPeerId(this.roomCode), {
      label: CHANNEL_NAME,
      metadata: { role: 'guest' },
      reliable: false,
      serialization: 'json',
    });
    this.attachConnection(connection);
  }

  attachConnection(connection) {
    this.connection = connection;
    connection.on('open', () => {
      this.handlers.onStatus?.('Connected');
      this.handlers.onOpen?.(this);
    });
    connection.on('data', (message) => {
      this.handlers.onMessage?.(message, this);
    });
    connection.on('close', () => this.finishClose());
    connection.on('error', (err) => {
      this.handlers.onStatus?.(messageForError(err));
      this.finishClose();
    });
  }

  send(message) {
    if (!this.connection?.open) return false;
    this.connection.send(message);
    return true;
  }

  close() {
    this.closed = true;
    this.connection?.close();
    this.peer?.destroy();
    this.handlers.onStatus?.('Disconnected');
  }

  finishClose() {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose?.(this);
  }

  handlePeerError(err) {
    if (this.closed) return;
    this.handlers.onStatus?.(messageForError(err));
    if (err?.type === 'peer-unavailable' || err?.type === 'network' || err?.type === 'server-error') {
      this.finishClose();
    }
  }
}

function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerJsPromise) return peerJsPromise;

  peerJsPromise = loadScriptSequence(PEERJS_URLS).then(() => {
    if (!window.Peer) throw new Error('PeerJS failed to load.');
    return window.Peer;
  });
  return peerJsPromise;
}

function loadScriptSequence(urls) {
  return urls.reduce(
    (promise, url) => promise.catch(() => loadScript(url)),
    Promise.reject(new Error('No PeerJS CDN attempted.'))
  );
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${url}`));
    document.head.appendChild(script);
  });
}

function generateRoomCode() {
  const bytes = new Uint8Array(ROOM_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

function roomPeerId(roomCode) {
  return `${ROOM_PREFIX}${roomCode.toLowerCase()}`;
}

function messageForError(err) {
  if (err?.type === 'peer-unavailable') return 'Room not found';
  if (err?.type === 'unavailable-id') return 'Room code already in use';
  if (err?.type === 'network' || err?.type === 'server-error') return 'Lobby server unavailable';
  if (err?.type === 'browser-incompatible') return 'WebRTC is unavailable';
  return err?.message || 'Connection failed';
}
