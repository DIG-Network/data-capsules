import { randomBytes, createHash } from 'crypto'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Create test data of specified size
 */
export function createTestData(size) {
  return randomBytes(size)
}

/**
 * Calculate SHA256 hash of data
 */
export function calculateSHA256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Create a temporary directory for testing
 */
export function createTempDir() {
  const tempDir = join(tmpdir(), 'capsule-test-' + Date.now() + '-' + Math.random().toString(36).substring(7))
  mkdirSync(tempDir, { recursive: true })
  return tempDir
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Create a test file with specified size
 */
export function createTestFile(size, filePath) {
  const data = createTestData(size)
  writeFileSync(filePath, data)
  return data
}

/**
 * Standard file sizes for testing
 */
export const TEST_SIZES = {
  TINY: 1024,              // 1KB
  SMALL: 100 * 1024,       // 100KB  
  MEDIUM: 256 * 1024,      // 256KB
  LARGE: 500 * 1024,       // 500KB
  XLARGE: 1024 * 1024,     // 1MB
  BOUNDARY_256KB: 256 * 1024,
  OVER_BOUNDARY: 256 * 1024 + 1,
  MULTI_MB: 5 * 1024 * 1024,  // 5MB
}

/**
 * Standard encryption keys for testing
 */
export const TEST_KEYS = {
  BASIC: 'test-basic-key',
  STRONG: 'super-strong-encryption-key-for-testing-purposes',
  SIMPLE: 'simple',
  CONSENSUS: 'consensus-test-key',
}

/**
 * Assert that two buffers are equal
 */
export function assertBuffersEqual(t, actual, expected, message = 'Buffers should be equal') {
  t.deepEqual(Buffer.from(actual), Buffer.from(expected), message)
}

/**
 * Assert capsule set has valid structure
 */
export function assertValidCapsuleSet(t, capsuleSet, expectedSize = null) {
  t.is(typeof capsuleSet.id, 'string', 'ID should be string')
  t.is(capsuleSet.id.length, 64, 'ID should be 64-char SHA256 hex string')
  t.true(Array.isArray(capsuleSet.capsules), 'Capsules should be array')
  t.truthy(capsuleSet.metadata, 'Metadata should exist')
  t.is(capsuleSet.metadata.consensusVersion, 'DIG_CAPSULE_V1', 'Should have correct consensus version')
  t.is(capsuleSet.metadata.chunkingAlgorithm, 'DIG_DETERMINISTIC_V1', 'Should have correct chunking algorithm')
  
  if (expectedSize !== null) {
    t.is(capsuleSet.metadata.originalSize, expectedSize, `Original size should be ${expectedSize}`)
  }
}

/**
 * Assert capsule has valid structure
 */
export function assertValidCapsule(t, capsule, expectedIndex = null, expectedSize = null) {
  t.is(typeof capsule.index, 'number', 'Index should be number')
  t.is(typeof capsule.size, 'number', 'Size should be number')
  t.is(typeof capsule.hash, 'string', 'Hash should be string')
  t.is(capsule.hash.length, 64, 'Hash should be 64-char SHA256 hex string')
  t.is(typeof capsule.encrypted, 'boolean', 'Encrypted should be boolean')
  t.is(typeof capsule.compressed, 'boolean', 'Compressed should be boolean')

  
  if (expectedIndex !== null) {
    t.is(capsule.index, expectedIndex, `Index should be ${expectedIndex}`)
  }
  
  if (expectedSize !== null) {
    t.is(capsule.size, expectedSize, `Size should be ${expectedSize}`)
  }
}

/**
 * Get expected capsule count for a given file size
 */
export function getExpectedCapsuleCount(fileSize) {
  const CAPSULE_SIZES = [
    256 * 1024,   // 256 KB
    1024 * 1024,  // 1 MB
    10 * 1024 * 1024,   // 10 MB
    100 * 1024 * 1024,  // 100 MB
    1000 * 1024 * 1024  // 1000 MB
  ];
  
  if (fileSize <= CAPSULE_SIZES[0]) return 1;
  if (fileSize <= CAPSULE_SIZES[1]) return Math.ceil(fileSize / CAPSULE_SIZES[0]);
  if (fileSize <= CAPSULE_SIZES[2]) return Math.ceil(fileSize / CAPSULE_SIZES[1]);
  if (fileSize <= CAPSULE_SIZES[3]) return Math.ceil(fileSize / CAPSULE_SIZES[2]);
  if (fileSize <= CAPSULE_SIZES[4]) return Math.ceil(fileSize / CAPSULE_SIZES[3]);
  return Math.ceil(fileSize / CAPSULE_SIZES[4]);
}

/**
 * Create invalid capsule set for testing validation
 */
export function createInvalidCapsuleSet(type = 'invalid-size') {
  const base = {
    id: 'test-invalid-id',
    metadata: {
      originalSize: 300000,
      capsuleCount: 1,
      capsuleSizes: [300000],
      checksum: 'test-checksum',
      chunkingAlgorithm: 'DIG_DETERMINISTIC_V1',
      consensusVersion: 'DIG_CAPSULE_V1',
      compressionInfo: {
        algorithm: 'gzip',
        level: 6,
        originalSize: 300000
      }
    }
  };

  switch (type) {
    case 'invalid-size':
      return {
        ...base,
        capsules: [{
          index: 0,
          size: 300000, // Invalid size not in CAPSULE_SIZES
          hash: 'test-hash',
          encrypted: false,
          compressed: true
        }]
      };
      
    case 'invalid-consensus-version':
      return {
        ...base,
        capsules: [{
          index: 0,
          size: 262144, // Valid size
          hash: 'test-hash',
          encrypted: false,
          compressed: true
        }],
        metadata: {
          ...base.metadata,
          consensusVersion: 'INVALID_VERSION'
        }
      };
      
    case 'invalid-chunking-algorithm':
      return {
        ...base,
        capsules: [{
          index: 0,
          size: 262144, // Valid size
          hash: 'test-hash',
          encrypted: false,
          compressed: true
        }],
        metadata: {
          ...base.metadata,
          chunkingAlgorithm: 'INVALID_ALGORITHM'
        }
      };
      
    default:
      throw new Error(`Unknown invalid capsule set type: ${type}`);
  }
} 