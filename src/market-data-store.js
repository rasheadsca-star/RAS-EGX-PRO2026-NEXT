import { DatabaseSync } from 'node:sqlite';
import { sha256, canonicalize } from './hash.js';
import { validateSessionManifest } from './session-manifest.js';
import { validateRecommendationContract } from './recommendation-contract.js';
import { reconcileCertifiedObservations } from './reconciliation.js';
import { EVIDENCE } from './contracts.js';

const INGESTION_MODES=new Set(['RESEARCH','CERTIFIED_PRODUCTION']);
const HEX64=/^[0-9a-f]{64}$/i;
function validCertifiedSourceManifest(payload){
  if(!payload||payload.mode!=='CERTIFIED_PRODUCTION'||!HEX64.test(String(payload.manifestHash??'')))return false;
  const body={...payload};delete body.manifestHash;
  return sha256(body)===payload.manifestHash;
}

export class EgxMarketDataStore {
  constructor(path=':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.#init();
  }

  #ensureColumn(table,column,definition) {
    const columns=this.db.prepare(`PRAGMA table_info(${table})`).all();
    if(!columns.some(x=>x.name===column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  #init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS acquisition_runs (
        acquisition_id TEXT PRIMARY KEY,
        expected_session TEXT NOT NULL,
        started_at TEXT NOT NULL,
        content_hash TEXT UNIQUE,
        finalized_at TEXT
      );
      CREATE TABLE IF NOT EXISTS raw_bars (
        raw_hash TEXT PRIMARY KEY,
        acquisition_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        session TEXT NOT NULL,
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(acquisition_id) REFERENCES acquisition_runs(acquisition_id)
      );
      CREATE INDEX IF NOT EXISTS raw_bars_acquisition_ticker_session
        ON raw_bars(acquisition_id,ticker,session);
      CREATE TABLE IF NOT EXISTS source_manifests (
        source_manifest_hash TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS data_snapshots (
        data_snapshot_id TEXT PRIMARY KEY,
        market_session TEXT NOT NULL,
        source_manifest_hash TEXT NOT NULL,
        ingestion_mode TEXT NOT NULL DEFAULT 'RESEARCH',
        created_at TEXT NOT NULL,
        content_hash TEXT UNIQUE,
        finalized_at TEXT,
        FOREIGN KEY(source_manifest_hash) REFERENCES source_manifests(source_manifest_hash)
      );
      CREATE TABLE IF NOT EXISTS certified_reconciliations (
        reconciliation_manifest_hash TEXT PRIMARY KEY,
        source_manifest_hash TEXT NOT NULL,
        ticker TEXT NOT NULL,
        session TEXT NOT NULL,
        primary_source_id TEXT NOT NULL,
        primary_observation_certificate_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(source_manifest_hash) REFERENCES source_manifests(source_manifest_hash)
      );
      CREATE TABLE IF NOT EXISTS normalized_bars (
        data_snapshot_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        session TEXT NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL,
        source_manifest_hash TEXT NOT NULL,
        certified_reconciliation_manifest_hash TEXT,
        primary_observation_certificate_hash TEXT,
        row_hash TEXT NOT NULL,
        PRIMARY KEY(data_snapshot_id,ticker,session),
        FOREIGN KEY(data_snapshot_id) REFERENCES data_snapshots(data_snapshot_id),
        FOREIGN KEY(source_manifest_hash) REFERENCES source_manifests(source_manifest_hash),
        FOREIGN KEY(certified_reconciliation_manifest_hash) REFERENCES certified_reconciliations(reconciliation_manifest_hash)
      );
      CREATE TABLE IF NOT EXISTS session_manifests (
        snapshot_hash TEXT PRIMARY KEY,
        market_session TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        config_version TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS universe_registry (
        universe_version TEXT NOT NULL,
        ticker TEXT NOT NULL,
        company_name TEXT,
        readiness TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        last_session TEXT,
        history_count INTEGER NOT NULL,
        source_status TEXT NOT NULL,
        PRIMARY KEY(universe_version,ticker)
      );
      CREATE TABLE IF NOT EXISTS recommendation_ledger (
        recommendation_id TEXT PRIMARY KEY,
        snapshot_hash TEXT NOT NULL,
        signal_session TEXT NOT NULL,
        ticker TEXT NOT NULL,
        decision TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(snapshot_hash) REFERENCES session_manifests(snapshot_hash)
      );
      CREATE TABLE IF NOT EXISTS evidence_store (
        evidence_id TEXT PRIMARY KEY,
        evidence_type TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS corporate_actions (
        action_id TEXT PRIMARY KEY,
        ticker TEXT NOT NULL,
        effective_session TEXT NOT NULL,
        action_type TEXT NOT NULL,
        source TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fundamentals (
        fundamental_id TEXT PRIMARY KEY,
        ticker TEXT NOT NULL,
        report_period TEXT NOT NULL,
        publication_date TEXT NOT NULL,
        available_from TEXT NOT NULL,
        source TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fundamentals_asof_idx ON fundamentals(ticker,available_from);
      CREATE TRIGGER IF NOT EXISTS acquisition_frozen_update
      BEFORE UPDATE ON acquisition_runs WHEN OLD.content_hash IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_FINALIZED_ACQUISITION');
      END;
      CREATE TRIGGER IF NOT EXISTS acquisition_no_delete
      BEFORE DELETE ON acquisition_runs BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_ACQUISITION');
      END;
      CREATE TRIGGER IF NOT EXISTS data_snapshot_frozen_update
      BEFORE UPDATE ON data_snapshots WHEN OLD.content_hash IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_FINALIZED_DATA_SNAPSHOT');
      END;
      CREATE TRIGGER IF NOT EXISTS data_snapshot_no_delete
      BEFORE DELETE ON data_snapshots BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_DATA_SNAPSHOT');
      END;
      CREATE TRIGGER IF NOT EXISTS recommendation_no_update
      BEFORE UPDATE ON recommendation_ledger BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_RECOMMENDATION_LEDGER');
      END;
      CREATE TRIGGER IF NOT EXISTS recommendation_no_delete
      BEFORE DELETE ON recommendation_ledger BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_RECOMMENDATION_LEDGER');
      END;
      CREATE TRIGGER IF NOT EXISTS evidence_no_update
      BEFORE UPDATE ON evidence_store BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_EVIDENCE_STORE');
      END;
      CREATE TRIGGER IF NOT EXISTS evidence_no_delete
      BEFORE DELETE ON evidence_store BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_EVIDENCE_STORE');
      END;
      CREATE TRIGGER IF NOT EXISTS source_manifest_no_update
      BEFORE UPDATE ON source_manifests BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_SOURCE_MANIFEST');
      END;
      CREATE TRIGGER IF NOT EXISTS source_manifest_no_delete
      BEFORE DELETE ON source_manifests BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_SOURCE_MANIFEST');
      END;
      CREATE TRIGGER IF NOT EXISTS certified_reconciliation_no_update
      BEFORE UPDATE ON certified_reconciliations BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFIED_RECONCILIATION');
      END;
      CREATE TRIGGER IF NOT EXISTS certified_reconciliation_no_delete
      BEFORE DELETE ON certified_reconciliations BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFIED_RECONCILIATION');
      END;
    `);
    this.#ensureColumn('data_snapshots','ingestion_mode',"TEXT NOT NULL DEFAULT 'RESEARCH'");
    this.#ensureColumn('normalized_bars','certified_reconciliation_manifest_hash','TEXT');
    this.#ensureColumn('normalized_bars','primary_observation_certificate_hash','TEXT');
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS raw_bar_frozen_update
      BEFORE UPDATE ON raw_bars WHEN (SELECT content_hash FROM acquisition_runs WHERE acquisition_id=OLD.acquisition_id) IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_FINALIZED_RAW_BAR');
      END;
      CREATE TRIGGER IF NOT EXISTS raw_bar_frozen_delete
      BEFORE DELETE ON raw_bars WHEN (SELECT content_hash FROM acquisition_runs WHERE acquisition_id=OLD.acquisition_id) IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_FINALIZED_RAW_BAR');
      END;
      CREATE TRIGGER IF NOT EXISTS normalized_bar_frozen_update
      BEFORE UPDATE ON normalized_bars WHEN (SELECT content_hash FROM data_snapshots WHERE data_snapshot_id=OLD.data_snapshot_id) IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_FINALIZED_NORMALIZED_BAR');
      END;
      CREATE TRIGGER IF NOT EXISTS normalized_bar_frozen_delete
      BEFORE DELETE ON normalized_bars WHEN (SELECT content_hash FROM data_snapshots WHERE data_snapshot_id=OLD.data_snapshot_id) IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_FINALIZED_NORMALIZED_BAR');
      END;
      CREATE TRIGGER IF NOT EXISTS normalized_current_production_guard
      BEFORE INSERT ON normalized_bars
      WHEN (SELECT ingestion_mode FROM data_snapshots WHERE data_snapshot_id=NEW.data_snapshot_id)='CERTIFIED_PRODUCTION'
       AND NEW.session=(SELECT market_session FROM data_snapshots WHERE data_snapshot_id=NEW.data_snapshot_id)
       AND (NEW.certified_reconciliation_manifest_hash IS NULL OR NEW.primary_observation_certificate_hash IS NULL)
      BEGIN
        SELECT RAISE(ABORT, 'CERTIFIED_PRODUCTION_CURRENT_BAR_REQUIRES_CERTIFIED_LINEAGE');
      END;
    `);
  }

  close() { this.db.close(); }

  startAcquisition({acquisitionId,expectedSession,startedAt}) {
    if (!acquisitionId || !expectedSession || !startedAt) throw new Error('INVALID_ACQUISITION_RUN');
    this.db.prepare(`INSERT INTO acquisition_runs(acquisition_id,expected_session,started_at) VALUES (?,?,?)`)
      .run(acquisitionId,expectedSession,startedAt);
    return acquisitionId;
  }

  putRawBar({acquisitionId,ticker,session,sourceId,payload}) {
    const acq=this.db.prepare('SELECT content_hash FROM acquisition_runs WHERE acquisition_id=?').get(acquisitionId);
    if (!acq) throw new Error('UNKNOWN_ACQUISITION');
    if (acq.content_hash) throw new Error('ACQUISITION_ALREADY_FINALIZED');
    const rawHash = sha256({acquisitionId,ticker,session,sourceId,payload});
    this.db.prepare(`INSERT OR IGNORE INTO raw_bars
      (raw_hash,acquisition_id,ticker,session,source_id,payload_json) VALUES (?,?,?,?,?,?)`)
      .run(rawHash,acquisitionId,ticker,session,sourceId,canonicalize(payload));
    return rawHash;
  }

  finalizeAcquisition(acquisitionId, finalizedAt=new Date().toISOString()) {
    const acq=this.db.prepare('SELECT * FROM acquisition_runs WHERE acquisition_id=?').get(acquisitionId);
    if (!acq) throw new Error('UNKNOWN_ACQUISITION');
    if (acq.content_hash) return acq.content_hash;
    const rows=this.db.prepare('SELECT raw_hash,ticker,session,source_id,payload_json FROM raw_bars WHERE acquisition_id=? ORDER BY ticker,session,source_id,raw_hash').all(acquisitionId);
    if (!rows.length) throw new Error('EMPTY_ACQUISITION');
    const contentHash=sha256({acquisitionId,expectedSession:acq.expected_session,rows});
    this.db.prepare('UPDATE acquisition_runs SET content_hash=?,finalized_at=? WHERE acquisition_id=?').run(contentHash,finalizedAt,acquisitionId);
    return contentHash;
  }

  putSourceManifest(payload, createdAt=new Date().toISOString()) {
    if(payload?.mode==='CERTIFIED_PRODUCTION'&&!validCertifiedSourceManifest(payload)) throw new Error('INVALID_CERTIFIED_PRODUCTION_SOURCE_MANIFEST');
    const hash = sha256(payload);
    this.db.prepare(`INSERT OR IGNORE INTO source_manifests
      (source_manifest_hash,payload_json,created_at) VALUES (?,?,?)`)
      .run(hash, canonicalize(payload), createdAt);
    return hash;
  }

  startDataSnapshot({dataSnapshotId,marketSession,sourceManifestHash,createdAt,ingestionMode='RESEARCH'}) {
    const mode=String(ingestionMode??'RESEARCH').toUpperCase();
    if (!dataSnapshotId || !marketSession || !sourceManifestHash || !createdAt || !INGESTION_MODES.has(mode)) throw new Error('INVALID_DATA_SNAPSHOT');
    const sm=this.db.prepare('SELECT payload_json FROM source_manifests WHERE source_manifest_hash=?').get(sourceManifestHash);
    if (!sm) throw new Error('UNKNOWN_SOURCE_MANIFEST');
    if(mode==='CERTIFIED_PRODUCTION'){
      const payload=JSON.parse(sm.payload_json);
      if(!validCertifiedSourceManifest(payload)) throw new Error('PRODUCTION_SNAPSHOT_REQUIRES_CERTIFIED_SOURCE_MANIFEST');
      if(payload.session!==marketSession) throw new Error('PRODUCTION_SOURCE_MANIFEST_SESSION_MISMATCH');
    }
    this.db.prepare(`INSERT INTO data_snapshots(data_snapshot_id,market_session,source_manifest_hash,ingestion_mode,created_at) VALUES (?,?,?,?,?)`)
      .run(dataSnapshotId,marketSession,sourceManifestHash,mode,createdAt);
    return dataSnapshotId;
  }

  #insertNormalizedBar({dataSnapshotId,ticker,session,open,high,low,close,volume=null,sourceManifestHash,certifiedReconciliationManifestHash=null,primaryObservationCertificateHash=null}) {
    if (![open,high,low,close].every(v=>Number.isFinite(v)&&v>0)) throw new Error('INVALID_NORMALIZED_PRICE');
    if (high < open || high < close || high < low || low > open || low > close) throw new Error('INVALID_NORMALIZED_OHLC');
    if (volume !== null && (!Number.isFinite(volume) || volume < 0)) throw new Error('INVALID_NORMALIZED_VOLUME');
    const row = {dataSnapshotId,ticker,session,open,high,low,close,volume,sourceManifestHash,certifiedReconciliationManifestHash,primaryObservationCertificateHash};
    const rowHash=sha256(row);
    this.db.prepare(`INSERT INTO normalized_bars
      (data_snapshot_id,ticker,session,open,high,low,close,volume,source_manifest_hash,certified_reconciliation_manifest_hash,primary_observation_certificate_hash,row_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(dataSnapshotId,ticker,session,open,high,low,close,volume,sourceManifestHash,certifiedReconciliationManifestHash,primaryObservationCertificateHash,rowHash);
    return rowHash;
  }

  putNormalizedBar({dataSnapshotId,ticker,session,open,high,low,close,volume=null,sourceManifestHash}) {
    const snap=this.db.prepare('SELECT market_session,source_manifest_hash,ingestion_mode,content_hash FROM data_snapshots WHERE data_snapshot_id=?').get(dataSnapshotId);
    if (!snap) throw new Error('UNKNOWN_DATA_SNAPSHOT');
    if (snap.content_hash) throw new Error('DATA_SNAPSHOT_ALREADY_FINALIZED');
    if (snap.source_manifest_hash!==sourceManifestHash) throw new Error('NORMALIZED_SOURCE_MANIFEST_MISMATCH');
    if (snap.ingestion_mode==='CERTIFIED_PRODUCTION'&&session===snap.market_session) throw new Error('CERTIFIED_PRODUCTION_CURRENT_BAR_REQUIRES_RECONCILIATION');
    return this.#insertNormalizedBar({dataSnapshotId,ticker,session,open,high,low,close,volume,sourceManifestHash});
  }

  putCertifiedNormalizedBar({dataSnapshotId,entries,acquisitionPlan,maxCloseConflictPct=1}) {
    const snap=this.db.prepare('SELECT market_session,source_manifest_hash,ingestion_mode,created_at,content_hash FROM data_snapshots WHERE data_snapshot_id=?').get(dataSnapshotId);
    if (!snap) throw new Error('UNKNOWN_DATA_SNAPSHOT');
    if (snap.content_hash) throw new Error('DATA_SNAPSHOT_ALREADY_FINALIZED');
    if (snap.ingestion_mode!=='CERTIFIED_PRODUCTION') throw new Error('CERTIFIED_BAR_REQUIRES_PRODUCTION_SNAPSHOT');
    const reconciliation=reconcileCertifiedObservations(entries,{acquisitionPlan,maxCloseConflictPct});
    if(reconciliation.status!=='READY'||!reconciliation.authoritative||!reconciliation.sourceManifest) throw new Error(`CERTIFIED_RECONCILIATION_NOT_READY:${reconciliation.reasons?.join('|')??reconciliation.status}`);
    if(reconciliation.authoritative.session!==snap.market_session) throw new Error('CERTIFIED_BAR_SESSION_MISMATCH');
    if(reconciliation.authoritative.sourceId!==acquisitionPlan.primary) throw new Error('CERTIFIED_BAR_PRIMARY_SOURCE_MISMATCH');
    if(!validCertifiedSourceManifest(reconciliation.sourceManifest)) throw new Error('INVALID_CERTIFIED_RECONCILIATION_MANIFEST');
    const stored=this.db.prepare('SELECT payload_json FROM source_manifests WHERE source_manifest_hash=?').get(snap.source_manifest_hash);
    if(!stored||stored.payload_json!==canonicalize(reconciliation.sourceManifest)) throw new Error('CERTIFIED_RECONCILIATION_SOURCE_MANIFEST_MISMATCH');
    const primaryEntry=(entries??[]).find(x=>x?.observation?.sourceId===acquisitionPlan.primary);
    const primaryCertificateHash=primaryEntry?.runtimeReceipt?.observationCertificateHash??null;
    if(!HEX64.test(String(primaryCertificateHash??''))||primaryCertificateHash!==reconciliation.sourceManifest.primaryObservationCertificateHash) throw new Error('PRIMARY_OBSERVATION_CERTIFICATE_MISMATCH');
    const reconciliationManifestHash=reconciliation.sourceManifest.manifestHash;
    this.db.prepare(`INSERT OR IGNORE INTO certified_reconciliations
      (reconciliation_manifest_hash,source_manifest_hash,ticker,session,primary_source_id,primary_observation_certificate_hash,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(reconciliationManifestHash,snap.source_manifest_hash,reconciliation.authoritative.ticker,reconciliation.authoritative.session,reconciliation.authoritative.sourceId,primaryCertificateHash,canonicalize(reconciliation.sourceManifest),snap.created_at);
    const a=reconciliation.authoritative;
    return this.#insertNormalizedBar({dataSnapshotId,ticker:a.ticker,session:a.session,open:a.open,high:a.high,low:a.low,close:a.close,volume:a.volume??null,sourceManifestHash:snap.source_manifest_hash,certifiedReconciliationManifestHash:reconciliationManifestHash,primaryObservationCertificateHash:primaryCertificateHash});
  }

  finalizeDataSnapshot(dataSnapshotId, finalizedAt=new Date().toISOString()) {
    const snap=this.db.prepare('SELECT * FROM data_snapshots WHERE data_snapshot_id=?').get(dataSnapshotId);
    if (!snap) throw new Error('UNKNOWN_DATA_SNAPSHOT');
    if (snap.content_hash) return snap.content_hash;
    const rows=this.db.prepare('SELECT ticker,session,open,high,low,close,volume,source_manifest_hash,certified_reconciliation_manifest_hash,primary_observation_certificate_hash,row_hash FROM normalized_bars WHERE data_snapshot_id=? ORDER BY ticker,session').all(dataSnapshotId);
    if (!rows.length) throw new Error('EMPTY_DATA_SNAPSHOT');
    if(snap.ingestion_mode==='CERTIFIED_PRODUCTION'&&rows.some(r=>r.session===snap.market_session&&(!r.certified_reconciliation_manifest_hash||!r.primary_observation_certificate_hash))) throw new Error('UNCERTIFIED_CURRENT_BAR_IN_PRODUCTION_SNAPSHOT');
    const contentHash=sha256({dataSnapshotId,marketSession:snap.market_session,sourceManifestHash:snap.source_manifest_hash,ingestionMode:snap.ingestion_mode,rows});
    this.db.prepare('UPDATE data_snapshots SET content_hash=?,finalized_at=? WHERE data_snapshot_id=?').run(contentHash,finalizedAt,dataSnapshotId);
    return contentHash;
  }

  putSessionManifest(manifest) {
    const validation = validateSessionManifest(manifest);
    if (!validation.valid) throw new Error(`INVALID_SESSION_MANIFEST:${validation.errors.join(',')}`);
    if (typeof manifest.sourceManifest !== 'string') throw new Error('SESSION_MANIFEST_SOURCE_MUST_BE_HASH');
    const sm=this.db.prepare('SELECT 1 AS ok FROM source_manifests WHERE source_manifest_hash=?').get(manifest.sourceManifest);
    if (!sm) throw new Error('SESSION_MANIFEST_SOURCE_NOT_FOUND');
    const raw=this.db.prepare('SELECT 1 AS ok FROM acquisition_runs WHERE content_hash=? AND finalized_at IS NOT NULL').get(manifest.rawDataVersion);
    if (!raw) throw new Error('SESSION_MANIFEST_RAW_VERSION_NOT_FOUND');
    const norm=this.db.prepare('SELECT market_session FROM data_snapshots WHERE content_hash=? AND finalized_at IS NOT NULL').get(manifest.normalizedDataVersion);
    if (!norm) throw new Error('SESSION_MANIFEST_NORMALIZED_VERSION_NOT_FOUND');
    if (norm.market_session !== manifest.marketSession) throw new Error('SESSION_MANIFEST_MARKET_SESSION_MISMATCH');
    this.db.prepare(`INSERT OR IGNORE INTO session_manifests
      (snapshot_hash,market_session,engine_version,config_version,commit_hash,generated_at,payload_json)
      VALUES (?,?,?,?,?,?,?)`)
      .run(manifest.snapshotHash,manifest.marketSession,manifest.engineVersion,manifest.configVersion,
        manifest.commitHash,manifest.generatedAt,canonicalize(manifest));
    return manifest.snapshotHash;
  }

  putUniverseRegistry(registry) {
    const insert=this.db.prepare(`INSERT INTO universe_registry
      (universe_version,ticker,company_name,readiness,reasons_json,last_session,history_count,source_status)
      VALUES (?,?,?,?,?,?,?,?)`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of registry.rows) insert.run(registry.version,row.ticker,row.companyName,row.readiness,
        canonicalize(row.reasons),row.lastSession,row.historyCount,row.sourceStatus);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return registry.version;
  }

  appendRecommendation(record) {
    validateRecommendationContract(record);
    const manifest=this.db.prepare('SELECT market_session FROM session_manifests WHERE snapshot_hash=?').get(record.snapshotHash);
    if (!manifest) throw new Error('RECOMMENDATION_SNAPSHOT_NOT_FOUND');
    if (manifest.market_session !== record.signalSession) throw new Error('RECOMMENDATION_SESSION_MISMATCH');
    this.db.prepare(`INSERT INTO recommendation_ledger
      (recommendation_id,snapshot_hash,signal_session,ticker,decision,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?)`)
      .run(record.recommendationId,record.snapshotHash,record.signalSession,record.ticker,record.decision,
        canonicalize(record),record.createdAt);
    return record.recommendationId;
  }

  appendEvidence(record) {
    for (const k of ['evidenceId','evidenceType','engineVersion','configHash','createdAt'])
      if (!record[k]) throw new Error(`EVIDENCE_MISSING:${k}`);
    if (!Object.values(EVIDENCE).includes(record.evidenceType)) throw new Error(`INVALID_EVIDENCE_TYPE:${record.evidenceType}`);
    const artifactHash=sha256(record.payload);
    this.db.prepare(`INSERT INTO evidence_store
      (evidence_id,evidence_type,engine_version,config_hash,payload_json,artifact_hash,created_at)
      VALUES (?,?,?,?,?,?,?)`)
      .run(record.evidenceId,record.evidenceType,record.engineVersion,record.configHash,
        canonicalize(record.payload),artifactHash,record.createdAt);
    return artifactHash;
  }

  appendCorporateAction(record) {
    for (const k of ['actionId','ticker','effectiveSession','actionType','source','verifiedAt'])
      if (!record[k]) throw new Error(`CORPORATE_ACTION_MISSING:${k}`);
    this.db.prepare(`INSERT INTO corporate_actions
      (action_id,ticker,effective_session,action_type,source,verified_at,payload_json) VALUES (?,?,?,?,?,?,?)`)
      .run(record.actionId,record.ticker,record.effectiveSession,record.actionType,record.source,record.verifiedAt,canonicalize(record));
    return record.actionId;
  }

  appendFundamental(record) {
    for (const k of ['fundamentalId','ticker','reportPeriod','publicationDate','availableFrom','source','verifiedAt'])
      if (!record[k]) throw new Error(`FUNDAMENTAL_MISSING:${k}`);
    const publication=Date.parse(record.publicationDate),available=Date.parse(record.availableFrom);
    if (!Number.isFinite(publication) || !Number.isFinite(available)) throw new Error('INVALID_FUNDAMENTAL_TIMESTAMPS');
    if (available < publication) throw new Error('FUNDAMENTAL_AVAILABLE_BEFORE_PUBLICATION');
    this.db.prepare(`INSERT INTO fundamentals
      (fundamental_id,ticker,report_period,publication_date,available_from,source,verified_at,payload_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(record.fundamentalId,record.ticker,record.reportPeriod,record.publicationDate,record.availableFrom,record.source,record.verifiedAt,canonicalize(record));
    return record.fundamentalId;
  }

  fundamentalsAsOf(ticker, asOf) {
    return this.db.prepare(`SELECT * FROM fundamentals WHERE ticker=? AND available_from<=? ORDER BY available_from DESC`).all(ticker,asOf);
  }

  dataSnapshotBars(dataSnapshotId,ticker=null) {
    if (ticker) return this.db.prepare(`SELECT * FROM normalized_bars WHERE data_snapshot_id=? AND ticker=? ORDER BY session`).all(dataSnapshotId,ticker);
    return this.db.prepare(`SELECT * FROM normalized_bars WHERE data_snapshot_id=? ORDER BY ticker,session`).all(dataSnapshotId);
  }
}
