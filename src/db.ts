export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('AniyomiDB', 1);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveDirHandle = async (handle: any): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put(handle, 'dirHandle');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getDirHandle = async (): Promise<any> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const request = store.get('dirHandle');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const verifyPermission = async (fileHandle: any, readWrite: boolean): Promise<boolean> => {
    const options = {
        mode: readWrite ? 'readwrite' : 'read'
    };
    
    if ((await fileHandle.queryPermission(options)) === 'granted') {
        return true;
    }
    
    if ((await fileHandle.requestPermission(options)) === 'granted') {
        return true;
    }
    
    return false;
};
