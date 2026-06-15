const CHANNEL_NAME = 'soccer-pucks';
const ROOM_PREFIX = 'soccer-pucks-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_LENGTH = 6;
const HOST_CREATE_ATTEMPTS = 5;
export const MAX_GUESTS = 3;

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
    this.connections = new Map();
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
        if (!this.hasOpenConnections()) this.handlers.onStatus?.('Signaling disconnected');
      });
    });
  }

  listenForGuest() {
    this.peer.on('connection', (connection) => {
      if (connection.label !== CHANNEL_NAME) {
        connection.close();
        return;
      }

      const shouldAccept = this.handlers.shouldAcceptConnection?.(this, connection) !== false;
      if (!shouldAccept || this.connections.size >= MAX_GUESTS) {
        connection.on('open', () => {
          connection.send({ type: 'roomFull' });
          setTimeout(() => connection.close(), 0);
        });
        return;
      }

      this.attachConnection(connection);
    });
  }

  connectToHost() {
    const connection = this.peer.connect(roomPeerId(this.roomCode), {
      label: CHANNEL_NAME,
      metadata: { role: 'guest' },
      serialization: 'json',
    });
    this.attachConnection(connection);
  }

  attachConnection(connection) {
    const connectionId = connectionIdFor(connection);
    connection.on('open', () => {
      if (this.role === 'host') this.connections.set(connectionId, connection);
      else this.connection = connection;
      this.handlers.onStatus?.('Connected');
      this.handlers.onOpen?.(this, connection, connectionId);
    });
    connection.on('data', (message) => {
      this.handlers.onMessage?.(message, this, connection, connectionId);
    });
    connection.on('close', () => this.handleConnectionClose(connection, connectionId));
    connection.on('error', (err) => {
      this.handlers.onStatus?.(messageForError(err));
      this.handleConnectionClose(connection, connectionId);
    });
  }

  send(message) {
    if (this.role === 'host') {
      let sent = false;
      for (const connection of this.connections.values()) {
        if (!connection.open) continue;
        connection.send(message);
        sent = true;
      }
      return sent;
    }

    return this.sendTo(this.connection, message);
  }

  sendTo(connectionOrId, message) {
    const connection =
      typeof connectionOrId === 'string' ? this.connections.get(connectionOrId) : connectionOrId;
    if (!connection?.open) return false;
    connection.send(message);
    return true;
  }

  close() {
    this.closed = true;
    this.connection?.close();
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.peer?.destroy();
    this.handlers.onStatus?.('Disconnected');
  }

  handleConnectionClose(connection, connectionId) {
    if (this.closed) return;

    if (this.role === 'host') {
      this.connections.delete(connectionId);
      this.handlers.onConnectionClose?.(this, connection, connectionId);
      return;
    }

    this.finishClose();
  }

  finishClose() {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose?.(this);
  }

  hasOpenConnections() {
    if (this.role !== 'host') return Boolean(this.connection?.open);
    for (const connection of this.connections.values()) {
      if (connection.open) return true;
    }
    return false;
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

function connectionIdFor(connection) {
  if (!connection.__soccerPucksConnectionId) {
    connection.__soccerPucksConnectionId =
      connection.peer || crypto.randomUUID?.() || generateRoomCode();
  }
  return connection.__soccerPucksConnectionId;
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
