// Local copy: engine payload is resolved relative to this worker (see ENGINE_BASE).
const ENGINE_BASE = new URL('./', self.location.href).href;

// Import DB utils and engine script
try {
  importScripts('db-classic.js');
  importScripts('pikafish.js');
} catch (e) {
  // This catches synchronous errors in the imports!
  console.error('Failed to import scripts:', e);
  // We can try to notify main thread, but postMessage might not be ready if completely broken
  self.postMessage({ type: 'error', payload: `Import failed: ${e.message}` });
}

// Keep in sync with constants
const ENGINE_MESSAGE_EVENTS = {
  INITIALIZE: 'init',
  COMMAND: 'cmd',
  READY: 'ready',
  OUTPUT: 'output',
  ERROR: 'error',
};

let engine = null;
let isFileRequested = false;

const STORE_NAME = 'pikafish-cache';
const DATA_FILE_KEY = 'pikafish.data';
const WASM_FILE_KEY = 'pikafish.wasm';

const onEngineResponseEvent = (line) => {
  postMessage({ type: ENGINE_MESSAGE_EVENTS.OUTPUT, payload: line });
};

const cacheFile = async (key, buffer) => {
  try {
    await saveToDB(STORE_NAME, key, buffer);
  } catch (err) {
    console.warn(`Failed to save ${key} to IndexedDB:`, err);
    throw err;
  }
};

const fetchFileFromNetwork = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    return await response.arrayBuffer();
  } catch (err) {
    console.error(`Failed to fetch file from ${url}:`, err);
    throw err;
  }
};

const getOrCacheFile = async (key, networkUrl, mime) => {
  try {
    const cached = await getFromDB(STORE_NAME, key);
    if (cached) return URL.createObjectURL(new Blob([cached], { type: mime }));

    // Fetch from network and cache
    const buffer = await fetchFileFromNetwork(networkUrl);

    // Cache in background (don't block on this)
    cacheFile(key, buffer).catch((err) => {
      console.warn(`Background caching of ${key} failed:`, err);
    });

    return URL.createObjectURL(new Blob([buffer], { type: mime }));
  } catch (err) {
    console.error(`Failed to get or cache file ${key}:`, err);
    throw err;
  }
};

const initializePikafishEngine = async () => {
  try {
    const dataUrl = await getOrCacheFile(
      DATA_FILE_KEY,
      `${ENGINE_BASE}${DATA_FILE_KEY}`,
      'application/octet-stream',
    );

    const wasmUrl = await getOrCacheFile(
      WASM_FILE_KEY,
      `${ENGINE_BASE}${WASM_FILE_KEY}`,
      'application/wasm',
    );

    const pikafishEngine = await Pikafish({
      onReceiveStdout: onEngineResponseEvent,
      locateFile: (fileName) => {
        if (fileName.endsWith('.data')) return dataUrl;
        if (fileName.endsWith('.wasm')) return wasmUrl;

        return `${ENGINE_BASE}${fileName}`;
      },
    });

    engine = pikafishEngine;
    engine.onReceiveOutput = onEngineResponseEvent;

    postMessage({ type: ENGINE_MESSAGE_EVENTS.READY });
  } catch (err) {
    console.error('Engine initialization failed:', err);
    postMessage({
      type: ENGINE_MESSAGE_EVENTS.ERROR,
      payload: err.message || 'Unknown initialization error',
    });
    throw err;
  }
};

const waitForPikafishAvailable = () =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Pikafish initialization timeout'));
    }, 60000); // 60 second timeout

    const interval = setInterval(() => {
      try {
        if (typeof Pikafish !== 'undefined' && !isFileRequested) {
          clearInterval(interval);
          clearTimeout(timeout);
          isFileRequested = true;
          resolve();
        }
      } catch (err) {
        clearInterval(interval);
        clearTimeout(timeout);
        reject(err);
        isFileRequested = false;
      }
    }, 200);
  });

const handleInitializeMessage = async () => {
  try {
    await waitForPikafishAvailable();
    await initializePikafishEngine();
  } catch (err) {
    console.error('Pikafish initialization process failed:', err);
    isFileRequested = false;
    postMessage({
      type: ENGINE_MESSAGE_EVENTS.ERROR,
      payload: err.message || 'Initialization failed',
    });
  }
};

const handleCommandMessage = (payload) => {
  if (!engine) {
    console.warn('Engine not initialized, ignoring command:', payload);
    postMessage({
      type: ENGINE_MESSAGE_EVENTS.ERROR,
      payload: 'Engine not ready for commands',
    });

    return;
  }

  try {
    engine.sendCommand(payload);
  } catch (err) {
    console.error('Failed to send command to engine:', err);
    postMessage({
      type: ENGINE_MESSAGE_EVENTS.ERROR,
      payload: `Command failed: ${err.message}`,
    });
  }
};

// Worker message handler
globalThis.onmessage = (e) => {
  try {
    const { type, payload } = e.data;

    switch (type) {
      case ENGINE_MESSAGE_EVENTS.INITIALIZE:
        handleInitializeMessage();
        break;

      case ENGINE_MESSAGE_EVENTS.COMMAND:
        handleCommandMessage(payload);
        break;

      default:
        console.warn('Unknown message type:', type);
        postMessage({
          type: ENGINE_MESSAGE_EVENTS.ERROR,
          payload: `Unknown message type: ${type}`,
        });
    }
  } catch (err) {
    console.error('Error handling worker message:', err);
    postMessage({
      type: ENGINE_MESSAGE_EVENTS.ERROR,
      payload: `Message handling error: ${err.message}`,
    });
  }
};
