const DB_NAME = 'pikafish-engine-db';
const DB_VERSION = 1;

// Opens the IndexedDB database and creates an object store if needed
function openDB(storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Save data to IndexedDB
async function saveToDB(storeName, key, value) {
  const db = await openDB(storeName);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);

    request.onsuccess = () => resolve(true);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Retrieve data from IndexedDB
async function getFromDB(storeName, key) {
  const db = await openDB(storeName);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Delete a key from IndexedDB
async function deleteFromDB(storeName, key) {
  const db = await openDB(storeName);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve(true);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Clear the whole store
async function clearStore(storeName) {
  const db = await openDB(storeName);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve(true);
    request.onerror = (event) => reject(event.target.error);
  });
}

// ✅ Attach functions to worker global scope
globalThis.saveToDB = saveToDB;
globalThis.getFromDB = getFromDB;
globalThis.deleteFromDB = deleteFromDB;
globalThis.clearStore = clearStore;
