/** FE-01 L3 harness 的 run-local immutable identity/binary attestation。 */
import fs from 'node:fs';
import path from 'node:path';
import { scanEvidenceText, sha256File } from './lib.mjs';
import { hasPhysicalPath, relativeFrom } from './clean-evidence-index.mjs';

const ATTESTATION_KEYS = Object.freeze([
  'schemaVersion',
  'identityPath',
  'identitySha256',
  'binaryPath',
  'binarySha256',
  'binaryBytes',
]);
const IDENTITY_KEYS = Object.freeze([
  'kind',
  'identifier',
  'profile',
  'binary',
  'binarySha256',
  'provenance',
]);

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && sameJson(Object.keys(value).sort(), [...keys].sort());
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function isPhysicalRegularFile(root, filePath) {
  if (!hasPhysicalPath(root, filePath)) return false;
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function parseJsonWithUniqueKeys(raw) {
  let offset = 0;
  const whitespace = /\s/;
  const skipWhitespace = () => {
    while (whitespace.test(raw[offset] ?? '')) offset += 1;
  };
  const parseString = () => {
    const start = offset;
    if (raw[offset] !== '"') throw new Error('expected JSON string');
    offset += 1;
    while (offset < raw.length) {
      if (raw[offset] === '\\') offset += 2;
      else if (raw[offset] === '"') {
        offset += 1;
        return JSON.parse(raw.slice(start, offset));
      } else offset += 1;
    }
    throw new Error('unterminated JSON string');
  };
  const parseValue = () => {
    skipWhitespace();
    if (raw[offset] === '{') {
      offset += 1;
      skipWhitespace();
      const keys = new Set();
      if (raw[offset] === '}') {
        offset += 1;
        return;
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error('duplicate JSON object key');
        keys.add(key);
        skipWhitespace();
        if (raw[offset] !== ':') throw new Error('expected JSON object colon');
        offset += 1;
        parseValue();
        skipWhitespace();
        if (raw[offset] === '}') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new Error('expected JSON object separator');
        offset += 1;
      }
    }
    if (raw[offset] === '[') {
      offset += 1;
      skipWhitespace();
      if (raw[offset] === ']') {
        offset += 1;
        return;
      }
      while (true) {
        parseValue();
        skipWhitespace();
        if (raw[offset] === ']') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new Error('expected JSON array separator');
        offset += 1;
      }
    }
    if (raw[offset] === '"') {
      parseString();
      return;
    }
    const literal = raw.slice(offset).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (literal === null) throw new Error('invalid JSON literal');
    offset += literal[0].length;
  };
  parseValue();
  skipWhitespace();
  if (offset !== raw.length) throw new Error('unexpected trailing JSON bytes');
  return JSON.parse(raw);
}

/** Attested JSON must be physically rooted and raw-byte clean before it is parsed. */
export function readExactPhysicalJson(root, filePath) {
  if (!isPhysicalRegularFile(root, filePath)) return { value: null, reason: 'not-physical' };
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { value: null, reason: 'unreadable' };
  }
  if (!scanEvidenceText(raw).clean) return { value: null, reason: 'raw-contaminated' };
  try {
    return { value: parseJsonWithUniqueKeys(raw), reason: null };
  } catch {
    return { value: null, reason: 'raw-invalid-or-duplicate-key' };
  }
}

function validIdentity(value) {
  return (
    exactKeys(value, IDENTITY_KEYS) &&
    value.kind === 'test-harness' &&
    typeof value.identifier === 'string' &&
    value.identifier.length > 0 &&
    value.profile === 'debug' &&
    typeof value.binary === 'string' &&
    value.binary.length > 0 &&
    isSha256(value.binarySha256) &&
    typeof value.provenance === 'string' &&
    value.provenance.length > 0
  );
}

function exactAttestationShape(value) {
  return (
    exactKeys(value, ATTESTATION_KEYS) &&
    value.schemaVersion === 1 &&
    isSha256(value.identitySha256) &&
    isSha256(value.binarySha256) &&
    typeof value.identityPath === 'string' &&
    typeof value.binaryPath === 'string' &&
    Number.isSafeInteger(value.binaryBytes) &&
    value.binaryBytes >= 0 &&
    value.identityPath === `attestations/test-harness/${value.identitySha256}.identity.json` &&
    value.binaryPath === `attestations/test-harness/${value.binarySha256}.bin`
  );
}

function ensureCopied(repoRoot, sourcePath, destinationPath, expectedSha256) {
  if (fs.existsSync(destinationPath)) {
    if (!isPhysicalRegularFile(repoRoot, destinationPath) || sha256File(destinationPath) !== expectedSha256) {
      throw new Error('run-local attestation destination is not the expected physical content');
    }
    return;
  }
  fs.copyFileSync(sourcePath, destinationPath);
}

/**
 * Captures the mutable global identity and binary exactly once, after L3, into this run's evidence root.
 * Subsequent validation never follows the global identity or binary again.
 */
export function captureFe01RunLocalHarnessAttestation({ repoRoot, evidenceRoot, artifact }) {
  const identityPath = path.resolve(repoRoot, artifact?.identityPath ?? '');
  if (
    relativeFrom(repoRoot, identityPath) !== artifact?.identityPath ||
    !isPhysicalRegularFile(repoRoot, identityPath)
  ) {
    throw new Error('FE-01 global harness identity is not a physical regular file at capture');
  }
  const parsedIdentity = readExactPhysicalJson(repoRoot, identityPath);
  const identity = parsedIdentity.value;
  if (!validIdentity(identity)) throw new Error('FE-01 global harness identity schema is invalid at capture');
  const binaryPath = path.resolve(repoRoot, identity.binary);
  if (
    relativeFrom(repoRoot, binaryPath) !== identity.binary ||
    !isPhysicalRegularFile(repoRoot, binaryPath) ||
    sha256File(binaryPath) !== identity.binarySha256
  ) {
    throw new Error('FE-01 global harness binary is invalid at capture');
  }

  fs.mkdirSync(evidenceRoot, { recursive: true });
  if (!hasPhysicalPath(repoRoot, evidenceRoot)) {
    throw new Error('FE-01 run evidence root is not physical at capture');
  }
  const identitySha256 = sha256File(identityPath);
  const binarySha256 = sha256File(binaryPath);
  const attestation = {
    schemaVersion: 1,
    identityPath: `attestations/test-harness/${identitySha256}.identity.json`,
    identitySha256,
    binaryPath: `attestations/test-harness/${binarySha256}.bin`,
    binarySha256,
    binaryBytes: fs.statSync(binaryPath).size,
  };
  const localIdentityPath = path.join(evidenceRoot, attestation.identityPath);
  const localBinaryPath = path.join(evidenceRoot, attestation.binaryPath);
  fs.mkdirSync(path.dirname(localIdentityPath), { recursive: true });
  if (!hasPhysicalPath(repoRoot, path.dirname(localIdentityPath))) {
    throw new Error('FE-01 run-local attestation directory is not physical at capture');
  }
  ensureCopied(repoRoot, identityPath, localIdentityPath, identitySha256);
  ensureCopied(repoRoot, binaryPath, localBinaryPath, binarySha256);
  return attestation;
}

/** Revalidates only the run-local immutable identity/binary payload bound by the manifest. */
export function validateFe01RunLocalHarnessAttestation({
  root,
  evidenceRoot,
  artifactIdentity,
  attestation,
}) {
  if (!exactAttestationShape(attestation)) {
    return { valid: false, reason: 'run-local-harness-attestation-schema-invalid' };
  }
  const identityPath = path.resolve(evidenceRoot, attestation.identityPath);
  const binaryPath = path.resolve(evidenceRoot, attestation.binaryPath);
  if (
    relativeFrom(evidenceRoot, identityPath) !== attestation.identityPath ||
    relativeFrom(evidenceRoot, binaryPath) !== attestation.binaryPath ||
    !isPhysicalRegularFile(root, identityPath) ||
    !isPhysicalRegularFile(root, binaryPath)
  ) {
    return { valid: false, reason: 'run-local-harness-attestation-file-missing-or-symlink' };
  }
  if (sha256File(identityPath) !== attestation.identitySha256 || sha256File(binaryPath) !== attestation.binarySha256) {
    return { valid: false, reason: 'run-local-harness-attestation-hash-mismatch' };
  }
  let binaryStats;
  try {
    binaryStats = fs.lstatSync(binaryPath);
  } catch {
    return { valid: false, reason: 'run-local-harness-attestation-file-missing-or-symlink' };
  }
  if (binaryStats.size !== attestation.binaryBytes) {
    return { valid: false, reason: 'run-local-harness-attestation-byte-size-mismatch' };
  }
  const parsedIdentity = readExactPhysicalJson(root, identityPath);
  if (parsedIdentity.value === null) {
    return {
      valid: false,
      reason:
        parsedIdentity.reason === 'raw-contaminated'
          ? 'run-local-harness-attestation-identity-raw-contaminated'
          : 'run-local-harness-attestation-identity-invalid-or-duplicate-key',
    };
  }
  const identity = parsedIdentity.value;
  if (
    !validIdentity(identity) ||
    identity.binarySha256 !== attestation.binarySha256 ||
    !sameJson(artifactIdentity, { ...identity, production: artifactIdentity?.production })
  ) {
    return { valid: false, reason: 'run-local-harness-attestation-identity-does-not-match-manifest' };
  }
  return { valid: true, reason: 'run-local-harness-attestation-exact' };
}
