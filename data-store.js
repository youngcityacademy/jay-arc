"use strict";

(function () {
  const DATABASE_NAME = "jayArcData";
  const DATABASE_VERSION = 1;
  const APP_STORE = "appData";
  const BACKUP_STORE = "backups";
  const META_STORE = "metadata";
  const ROOT_ID = "root";
  const LEGACY_KEY = "jayArcAppState";
  const RECOVERY_KEY = "jayArcAppRecovery";
  const MAX_BACKUPS = 30;
  const BACKUP_FORMAT_VERSION = 2;
  const SCHEMA_VERSION = 1;
  const ACCOUNT_BACKUP_PREFIX = "jayArcBackups-";

  function serialize(value) {
    return JSON.stringify(value);
  }

  function checksum(value) {
    const text = typeof value === "string" ? value : serialize(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) {
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }

      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(APP_STORE)) {
          database.createObjectStore(APP_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(BACKUP_STORE)) {
          const backups = database.createObjectStore(BACKUP_STORE, { keyPath: "id" });
          backups.createIndex("createdAt", "createdAt");
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another open JAY ARC tab."));
    });
  }

  function openAccountBackups(userId) {
    if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return Promise.reject(new Error("A valid account ID is required for private backups."));
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`${ACCOUNT_BACKUP_PREFIX}${userId}`, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BACKUP_STORE)) {
          const backups = database.createObjectStore(BACKUP_STORE, { keyPath: "id" });
          backups.createIndex("createdAt", "createdAt");
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open private backup storage."));
      request.onblocked = () => reject(new Error("Private backup storage is blocked by another open JAY ARC tab."));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  function readLegacyData() {
    let raw;
    try {
      raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Legacy saved data is not a valid object.");
      }
      if (data.days !== undefined &&
          (!data.days || typeof data.days !== "object" || Array.isArray(data.days))) {
        throw new Error("Legacy daily records are malformed; the source data was left untouched.");
      }
      return data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Legacy saved data is corrupted. It was preserved and was not overwritten.");
      }
      throw error;
    }
  }

  function validateStoredRecord(record) {
    if (!record || record.id !== ROOT_ID || !record.payload ||
        typeof record.payload !== "object" || Array.isArray(record.payload)) {
      throw new Error("The IndexedDB application record is malformed.");
    }
    if (record.checksum !== checksum(record.payload)) {
      throw new Error("The IndexedDB application record failed its integrity check.");
    }
    if (record.schemaVersion > SCHEMA_VERSION) {
      throw new Error("This JAY ARC data was created by a newer version and cannot be opened safely.");
    }
    return record;
  }

  async function getLegacySources() {
    const sources = [];
    const addSource = (source, payload, updatedAt = "") => {
      validatePayload(payload);
      sources.push({ source, payload, updatedAt });
    };

    const legacy = readLegacyData();
    if (legacy) addSource("Browser local storage", legacy);

    try {
      const raw = localStorage.getItem(RECOVERY_KEY);
      if (raw) {
        const recovery = JSON.parse(raw);
        if (!recovery?.payload || recovery.checksum !== checksum(recovery.payload)) {
          throw new Error("The emergency recovery copy failed its integrity check.");
        }
        addSource("Emergency recovery copy", recovery.payload, recovery.updatedAt || "");
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("The emergency recovery copy is corrupted; it was preserved and not imported.");
      }
      throw error;
    }

    const database = await openDatabase();
    try {
      if (!database.objectStoreNames.contains(APP_STORE)) return sources;
      const transaction = database.transaction(APP_STORE, "readonly");
      const record = await requestResult(transaction.objectStore(APP_STORE).get(ROOT_ID));
      await transactionDone(transaction);
      if (record) {
        const valid = validateStoredRecord(record);
        addSource("Previous JAY ARC database", valid.payload, valid.updatedAt || "");
      }
      return sources;
    } finally {
      database.close();
    }
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Saved application data is malformed.");
    }
    if (payload.days !== undefined &&
        (!payload.days || typeof payload.days !== "object" || Array.isArray(payload.days))) {
      throw new Error("Daily records are malformed; stored data was not changed.");
    }
    for (const [date, day] of Object.entries(payload.days || {})) {
      if (!day || typeof day !== "object" || Array.isArray(day) ||
          (day.footballSessions !== undefined && !Array.isArray(day.footballSessions))) {
        throw new Error(`Daily record ${date} is malformed; stored data was not changed.`);
      }
    }
    if (payload.savings !== undefined &&
        !Array.isArray(payload.savings) && typeof payload.savings !== "number") {
      throw new Error("Savings data is malformed; stored data was not changed.");
    }
    for (const key of ["learningGoals", "videoIdeas", "footballSchedule"]) {
      if (payload[key] !== undefined && !Array.isArray(payload[key])) {
        throw new Error(`${key} data is malformed; stored data was not changed.`);
      }
      if (payload.footballPersonalTrainingPeriods !== undefined &&
          !Array.isArray(payload.footballPersonalTrainingPeriods)) {
        throw new Error("Individual training history is malformed; stored data was not changed.");
      }
    }
    return payload;
  }

  function migratePayload(payload, schemaVersion) {
    let data = structuredClone(payload);
    let version = schemaVersion || 0;
    if (version < 1) {
      data.footballSchedule ??= [];
      data.footballPersonalTrainingEnabled ??= false;
      version = 1;
    }
    return { payload: data, schemaVersion: version };
  }

  function recoveryRecord() {
    try {
      const raw = localStorage.getItem(RECOVERY_KEY);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (!record || !record.payload || record.checksum !== checksum(record.payload)) {
        throw new Error("The emergency recovery copy failed its integrity check.");
      }
      return record;
    } catch (error) {
      console.error("JAY ARC recovery copy could not be read:", error);
      throw error;
    }
  }

  function createBackupRecord(payload, reason, timestamp = new Date().toISOString()) {
    const serialized = serialize(payload);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: timestamp,
      reason,
      schemaVersion: SCHEMA_VERSION,
      checksum: checksum(serialized),
      payload
    };
  }

  async function trimBackups(store) {
    const all = await requestResult(store.getAll());
    all.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    all.slice(MAX_BACKUPS).forEach(record => store.delete(record.id));
  }

  async function initialize() {
    const database = await openDatabase();
    try {
      const transaction = database.transaction([APP_STORE, BACKUP_STORE, META_STORE], "readwrite");
      const appStore = transaction.objectStore(APP_STORE);
      const backupStore = transaction.objectStore(BACKUP_STORE);
      const metaStore = transaction.objectStore(META_STORE);
      const existing = await requestResult(appStore.get(ROOT_ID));
      let emergency = null;
      let recoveryWarning = null;
      try {
        emergency = recoveryRecord();
      } catch (error) {
        recoveryWarning = error;
      }
      let payload;

      if (existing) {
        const record = validateStoredRecord(existing);
        const migrated = migratePayload(record.payload, record.schemaVersion);
        payload = validatePayload(migrated.payload);
        if (migrated.schemaVersion !== record.schemaVersion) {
          backupStore.put(createBackupRecord(record.payload, "before-schema-migration", record.updatedAt));
          appStore.put({
            ...record,
            schemaVersion: migrated.schemaVersion,
            updatedAt: new Date().toISOString(),
            checksum: checksum(payload),
            payload
          });
        }
        if (emergency && emergency.updatedAt > record.updatedAt) {
          validatePayload(emergency.payload);
          const currentBackup = createBackupRecord(record.payload, "before-emergency-recovery", record.updatedAt);
          backupStore.put(currentBackup);
          metaStore.put({ key: "lastSuccessfulBackupAt", value: new Date().toISOString() });
          payload = emergency.payload;
          appStore.put({
            id: ROOT_ID,
            schemaVersion: SCHEMA_VERSION,
            updatedAt: emergency.updatedAt,
            revision: (record.revision || 0) + 1,
            previousChecksum: record.checksum,
            checksum: checksum(payload),
            payload
          });
        }
      } else {
        const legacy = readLegacyData();
        if (recoveryWarning && legacy === null) throw recoveryWarning;
        if (emergency) {
          payload = validatePayload(emergency.payload);
          if (legacy && checksum(legacy) !== checksum(payload)) {
            backupStore.put(createBackupRecord(legacy, "legacy-before-emergency-recovery"));
          }
        } else {
          payload = legacy;
        }
        if (payload === null) payload = {};
        payload = validatePayload(migratePayload(payload, 0).payload);
        const now = new Date().toISOString();
        appStore.put({
          id: ROOT_ID,
          schemaVersion: SCHEMA_VERSION,
          updatedAt: now,
          checksum: checksum(payload),
          payload
        });
        metaStore.put({ key: "lastSuccessfulBackupAt", value: null });
        metaStore.put({
          key: "syncReadiness",
          value: {
            provider: "none",
            status: "local-only",
            accountId: null,
            deviceId: getDeviceId(),
            lastSyncAt: null,
            remoteRevision: null,
            conflictPolicy: "manual-review"
          }
        });
        if (Object.keys(payload).length > 0) {
          backupStore.put(createBackupRecord(payload, "legacy-migration", now));
        }
      }

      await transactionDone(transaction);
      if (!recoveryWarning) localStorage.removeItem(RECOVERY_KEY);
      return {
        database,
        payload,
        mode: "indexeddb",
        warning: recoveryWarning
      };
    } catch (error) {
      database.close();
      throw error;
    }
  }

  function getDeviceId() {
    const key = "jayArcDeviceId";
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        localStorage.setItem(key, id);
      }
      return id;
    } catch (error) {
      console.warn("JAY ARC could not persist its local device identifier:", error);
      return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  async function save(database, payload, reason = "automatic-save") {
    validatePayload(payload);
    const timestamp = new Date().toISOString();
    const transaction = database.transaction([APP_STORE, BACKUP_STORE, META_STORE], "readwrite");
    const appStore = transaction.objectStore(APP_STORE);
    const backupStore = transaction.objectStore(BACKUP_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const previous = await requestResult(appStore.get(ROOT_ID));
    const newChecksum = checksum(payload);

    if (previous) validateStoredRecord(previous);
    if (previous && previous.checksum !== newChecksum) {
      validateStoredRecord(previous);
      backupStore.put(createBackupRecord(previous.payload, `before-${reason}`, previous.updatedAt));
      metaStore.put({ key: "lastSuccessfulBackupAt", value: timestamp });
    }

    const record = {
      id: ROOT_ID,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: timestamp,
      revision: (previous?.revision || 0) + 1,
      previousChecksum: previous?.checksum || null,
      checksum: newChecksum,
      payload
    };
    appStore.put(record);

    const lastDaily = await requestResult(metaStore.get("lastDailySnapshotDate"));
    const today = timestamp.slice(0, 10);
    if (lastDaily?.value !== today) {
      backupStore.put(createBackupRecord(payload, "daily-recovery", timestamp));
      metaStore.put({ key: "lastDailySnapshotDate", value: today });
      metaStore.put({ key: "lastSuccessfulBackupAt", value: timestamp });
    } else if (reason === "manual-backup") {
      backupStore.put(createBackupRecord(payload, reason, timestamp));
      metaStore.put({ key: "lastSuccessfulBackupAt", value: timestamp });
    }

    await trimBackups(backupStore);
    metaStore.put({
      key: "syncReadiness",
      value: {
        provider: "none",
        status: "local-only",
        accountId: null,
        deviceId: getDeviceId(),
        lastSyncAt: null
      }
    });
    await transactionDone(transaction);
    localStorage.removeItem(RECOVERY_KEY);
    return record;
  }

  async function createSnapshot(database, payload, reason = "manual-backup") {
    validatePayload(payload);
    const transaction = database.transaction([BACKUP_STORE, META_STORE], "readwrite");
    const backups = transaction.objectStore(BACKUP_STORE);
    const metadata = transaction.objectStore(META_STORE);
    const timestamp = new Date().toISOString();
    backups.put(createBackupRecord(payload, reason, timestamp));
    metadata.put({ key: "lastSuccessfulBackupAt", value: timestamp });
    await trimBackups(backups);
    await transactionDone(transaction);
    return timestamp;
  }

  async function listBackups(database) {
    const transaction = database.transaction(BACKUP_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(BACKUP_STORE).getAll());
    await transactionDone(transaction);
    return records
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, MAX_BACKUPS);
  }

  async function restore(database, payload) {
    return save(database, payload, "restore");
  }

  async function getStats(database, payload) {
    const transaction = database.transaction([BACKUP_STORE, META_STORE], "readonly");
    const done = transactionDone(transaction);
    const backupStore = transaction.objectStore(BACKUP_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const backups = await requestResult(backupStore.getAll());
    const lastBackup = await requestResult(metaStore.get("lastSuccessfulBackupAt"));
    let storageEstimate = null;
    if (navigator.storage?.estimate) {
      storageEstimate = await navigator.storage.estimate();
    }
    await done;
    return {
      backupCount: backups.length,
      lastBackupAt: lastBackup?.value || backups
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0]?.createdAt || null,
      storageBytes: storageEstimate?.usage ?? null,
      storageQuotaBytes: storageEstimate?.quota ?? null,
      payloadBytes: new Blob([serialize(payload)]).size,
      mode: "indexeddb",
      maxBackups: MAX_BACKUPS
    };
  }

  function verifyBackup(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The file does not contain a backup object.");
    }
    if (parsed.app !== "JAY ARC" || !parsed.data ||
        typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      throw new Error("The backup format is not recognized. No data was changed.");
    }
    if (parsed.backupVersion !== undefined && parsed.backupVersion > BACKUP_FORMAT_VERSION) {
      throw new Error("This backup was created by a newer backup format.");
    }
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion > SCHEMA_VERSION) {
      throw new Error("This backup was created by a newer schema version.");
    }
    if (parsed.integrity !== undefined) {
      if (typeof parsed.integrity.checksum !== "string" ||
          parsed.integrity.checksum !== checksum(parsed.data)) {
        throw new Error("The backup checksum is missing or does not match. No data was changed.");
      }
    }
    const data = parsed.data;
    if (!data.days || typeof data.days !== "object" || Array.isArray(data.days)) {
      throw new Error("The backup is missing valid daily records.");
    }
    if (data.savings !== undefined &&
        !Array.isArray(data.savings) && typeof data.savings !== "number") {
      throw new Error("The savings records are invalid.");
    }
    for (const key of ["learningGoals", "videoIdeas"]) {
      if (data[key] !== undefined && !Array.isArray(data[key])) {
        throw new Error(`The ${key} records are invalid.`);
      }
    }
    if (data.footballSchedule !== undefined && !Array.isArray(data.footballSchedule)) {
      throw new Error("The football schedule records are invalid.");
    }
    for (const [date, day] of Object.entries(data.days)) {
      if (!day || typeof day !== "object" || Array.isArray(day)) {
        throw new Error(`Daily record ${date} is invalid.`);
      }
      if (day.footballSessions !== undefined && !Array.isArray(day.footballSessions)) {
        throw new Error(`Football records for ${date} are invalid.`);
      }
    }
    return validatePayload(data);
  }

  globalThis.JayArcDataStore = {
    initialize,
    initializeAccountBackups: openAccountBackups,
    getLegacySources,
    save,
    createSnapshot,
    listBackups,
    getStats,
    restore,
    verifyBackup,
    checksum,
    constants: { MAX_BACKUPS, SCHEMA_VERSION, DATABASE_NAME }
  };
})();
