// Capsule tests

import test from 'ava'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes, createHash } from 'crypto'

import { 
  createDataCapsule, 
  extractDataCapsule, 
  createDataCapsuleFromFile,
  extractDataCapsuleToFile,
  loadCapsuleSet,
  reconstructFileFromCapsules,
  getCapsuleSizes, 
  calculateStorageOverhead,
  getConsensusVersion,
  validateConsensusParameters,
  isValidCapsuleFile,
  getCapsuleFileInfo
} from '../index.js'

// Helper functions
function createTestData(size) {
  return randomBytes(size)
}

function calculateSHA256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function createTempDir() {
  const tempDir = join(tmpdir(), 'capsule-test-' + Date.now())
  mkdirSync(tempDir, { recursive: true })
  return tempDir
}

function cleanupTempDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createTestFile(size, filePath) {
  const data = createTestData(size)
  writeFileSync(filePath, data)
  return data
}

// Basic functionality tests
test('getCapsuleSizes returns correct fixed sizes', (t) => {
  const sizes = getCapsuleSizes()
  const expectedSizes = [
    256 * 1024,   // 256 KB
    1024 * 1024,  // 1 MB
    10 * 1024 * 1024,   // 10 MB
    100 * 1024 * 1024,  // 100 MB
    1000 * 1024 * 1024  // 1000 MB
  ]
  
  t.deepEqual(sizes, expectedSizes)
})

test('getConsensusVersion returns valid version', (t) => {
  const version = getConsensusVersion()
  t.is(version, 'DIG_CAPSULE_V1')
})

test('calculateStorageOverhead returns correct values', (t) => {
  // Test with zero size
  t.is(calculateStorageOverhead(0, 1), 0.0)
  
  // Test with small file requiring padding
  const smallOverhead = calculateStorageOverhead(100 * 1024, 1) // 100KB
  t.true(smallOverhead >= 5.0) // At least 5% minimum padding
})

// STREAMING FUNCTIONALITY TESTS (Primary API)

test('createDataCapsuleFromFile handles small file with encryption', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    const originalData = createTestFile(150 * 1024, inputFile) // 150KB
    const encryptionKey = 'test-streaming-key'
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, encryptionKey)
    
    // Verify capsule set structure
    t.is(typeof capsuleSet.id, 'string')
    t.is(capsuleSet.id.length, 64) // SHA256 hex string
    t.is(capsuleSet.metadata.originalSize, 150 * 1024)
    t.is(capsuleSet.metadata.capsuleCount, 1)
    t.is(capsuleSet.metadata.consensusVersion, 'DIG_CAPSULE_V1')
    t.is(capsuleSet.metadata.chunkingAlgorithm, 'DIG_DETERMINISTIC_V1')
    
    // Verify encryption info
    t.truthy(capsuleSet.metadata.encryptionInfo)
    t.is(capsuleSet.metadata.encryptionInfo.algorithm, 'AES-256-GCM')
    t.is(capsuleSet.metadata.encryptionInfo.keyDerivation, 'PBKDF2-HMAC-SHA256')
    t.is(capsuleSet.metadata.encryptionInfo.iterations, 100000)
    
    // Verify compression info
    t.truthy(capsuleSet.metadata.compressionInfo)
    t.is(capsuleSet.metadata.compressionInfo.algorithm, 'gzip')
    t.is(capsuleSet.metadata.compressionInfo.level, 6)
    
    // Verify capsule files exist
    const metadataFile = join(outputDir, `${capsuleSet.id.substring(0, 16)}_metadata.json`)
    t.true(existsSync(metadataFile))
    
    const capsuleFile = join(outputDir, `${capsuleSet.id.substring(0, 16)}_000.capsule`)
    t.true(existsSync(capsuleFile))
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('extractDataCapsuleToFile handles streaming extraction', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(500 * 1024, inputFile) // 500KB
    const encryptionKey = 'streaming-extraction-test'
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, encryptionKey)
    
    // Extract using streaming
    await extractDataCapsuleToFile(outputDir, reconstructedFile, encryptionKey)
    
    // Verify reconstruction
    const reconstructedData = readFileSync(reconstructedFile)
    t.deepEqual(reconstructedData, originalData)
    
    // Verify checksums
    const originalChecksum = calculateSHA256(originalData)
    const reconstructedChecksum = calculateSHA256(reconstructedData)
    t.is(originalChecksum, reconstructedChecksum)
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('loadCapsuleSet loads metadata without loading capsule data', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(300 * 1024, inputFile) // 300KB
    const encryptionKey = 'load-test-key'
    
    // Create capsules
    const originalCapsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, true, encryptionKey)
    
    // Load capsule set
    const loadedCapsuleSet = await loadCapsuleSet(outputDir)
    
    // Verify metadata matches
    t.is(loadedCapsuleSet.id, originalCapsuleSet.id)
    t.is(loadedCapsuleSet.metadata.originalSize, originalCapsuleSet.metadata.originalSize)
    t.is(loadedCapsuleSet.metadata.capsuleCount, originalCapsuleSet.metadata.capsuleCount)
    t.is(loadedCapsuleSet.metadata.consensusVersion, originalCapsuleSet.metadata.consensusVersion)
    
    // Verify capsules metadata (but not data)
    t.is(loadedCapsuleSet.capsules.length, originalCapsuleSet.capsules.length)
    loadedCapsuleSet.capsules.forEach((capsule, index) => {
      t.is(capsule.index, originalCapsuleSet.capsules[index].index)
      t.is(capsule.size, originalCapsuleSet.capsules[index].size)
      t.is(capsule.hash, originalCapsuleSet.capsules[index].hash)
    })
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('reconstructFileFromCapsules works with loaded CapsuleSet', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(750 * 1024, inputFile) // 750KB
    const encryptionKey = 'reconstruct-test-key'
    
    // Create capsules
    await createDataCapsuleFromFile(inputFile, capsulesDir, true, encryptionKey)
    
    // Load capsule set metadata
    const capsuleSet = await loadCapsuleSet(capsulesDir)
    
    // Reconstruct using loaded metadata
    await reconstructFileFromCapsules(capsuleSet, capsulesDir, reconstructedFile, encryptionKey)
    
    // Verify reconstruction
    const reconstructedData = readFileSync(reconstructedFile)
    t.deepEqual(reconstructedData, originalData)
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('validateConsensusParameters validates correct capsule sets', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(256 * 1024, inputFile) // Exactly 256KB
    const encryptionKey = 'consensus-test-key'
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, encryptionKey)
    
    // Should validate successfully
    const isValid = await validateConsensusParameters(capsuleSet)
    t.true(isValid)
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('validateConsensusParameters rejects invalid consensus parameters', async (t) => {
  const invalidCapsuleSet = {
    id: 'test',
    capsules: [{
      index: 0,
      size: 300000, // Invalid size not in CAPSULE_SIZES
      hash: 'test',
      encrypted: false,
      compressed: true
    }],
    metadata: {
      originalSize: 300000,
      capsuleCount: 1,
      capsuleSizes: [300000],
      checksum: 'test',
      chunkingAlgorithm: 'DIG_DETERMINISTIC_V1',
      consensusVersion: 'DIG_CAPSULE_V1',
      compressionInfo: {
        algorithm: 'gzip',
        level: 6,
        originalSize: 300000
      }
    }
  }
  
  await t.throwsAsync(
    async () => await validateConsensusParameters(invalidCapsuleSet),
    { message: /Consensus violation.*Invalid capsule size/ }
  )
})

// CAPSULE FILE VALIDATION TESTS

test('isValidCapsuleFile identifies valid capsule files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(100 * 1024, inputFile) // 100KB
    const encryptionKey = 'validation-test-key'
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, encryptionKey)
    
    // Check capsule files
    for (let i = 0; i < capsuleSet.metadata.capsuleCount; i++) {
      const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_${i.toString().padStart(3, '0')}.capsule`)
      const isValid = await isValidCapsuleFile(capsuleFile)
      t.true(isValid, `Capsule file ${i} should be valid`)
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('isValidCapsuleFile rejects invalid files', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Test with non-existent file
    const nonExistentFile = join(tempDir, 'nonexistent.capsule')
    const isValidNonExistent = await isValidCapsuleFile(nonExistentFile)
    t.false(isValidNonExistent, 'Non-existent file should be invalid')
    
    // Test with invalid file (not a capsule)
    const invalidFile = join(tempDir, 'invalid.capsule')
    writeFileSync(invalidFile, 'This is not a capsule file')
    const isValidInvalid = await isValidCapsuleFile(invalidFile)
    t.false(isValidInvalid, 'Invalid file should be invalid')
    
    // Test with truncated header
    const truncatedFile = join(tempDir, 'truncated.capsule')
    writeFileSync(truncatedFile, Buffer.from([1, 2, 3, 4])) // Too short
    const isValidTruncated = await isValidCapsuleFile(truncatedFile)
    t.false(isValidTruncated, 'Truncated file should be invalid')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('getCapsuleFileInfo extracts correct header information', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(150 * 1024, inputFile) // 150KB
    const encryptionKey = 'header-info-test'
    
    // Create capsules with specific parameters
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, true, encryptionKey) // postProcessPadding = true
    
    // Get info from first capsule
    const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_000.capsule`)
    const info = await getCapsuleFileInfo(capsuleFile)
    
    t.truthy(info, 'Should return capsule info')
    t.is(info.magic, '4449474341503031', 'Magic should be DIGCAP01 in hex') // "DIGCAP01" 
    t.is(info.version, 1, 'Version should be 1')
    t.is(info.capsuleIndex, 0, 'Index should be 0')
    t.is(info.capsuleSize, 256 * 1024, 'Size should be 256KB')
    t.true(info.isEncrypted, 'Should be encrypted')
    t.true(info.isCompressed, 'Should be compressed')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('getCapsuleFileInfo returns null for invalid files', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Test with non-existent file
    const nonExistentFile = join(tempDir, 'nonexistent.capsule')
    const infoNonExistent = await getCapsuleFileInfo(nonExistentFile)
    t.is(infoNonExistent, null, 'Should return null for non-existent file')
    
    // Test with invalid file
    const invalidFile = join(tempDir, 'invalid.capsule')
    writeFileSync(invalidFile, 'This is not a capsule file')
    const infoInvalid = await getCapsuleFileInfo(invalidFile)
    t.is(infoInvalid, null, 'Should return null for invalid file')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('capsule headers maintain format consistency', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(300 * 1024, inputFile) // 300KB -> will use 256KB capsules
    const encryptionKey = 'header-consistency-test'
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, encryptionKey)
    
    // Verify all capsule files have consistent headers
    for (let i = 0; i < capsuleSet.metadata.capsuleCount; i++) {
      const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_${i.toString().padStart(3, '0')}.capsule`)
      const info = await getCapsuleFileInfo(capsuleFile)
      
      // Get the expected capsule size for this specific capsule
      const expectedCapsuleSize = capsuleSet.capsules[i].size
      
      t.truthy(info, `Capsule ${i} should have valid header`)
      t.is(info.magic, '4449474341503031', `Capsule ${i} should have correct magic`)
      t.is(info.version, 1, `Capsule ${i} should have correct version`)
      t.is(info.capsuleIndex, i, `Capsule ${i} should have correct index`)
      t.is(info.capsuleSize, expectedCapsuleSize, `Capsule ${i} should have correct size`)
      t.true(info.isEncrypted, `Capsule ${i} should be encrypted`)
      t.true(info.isCompressed, `Capsule ${i} should be compressed`)
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

// LARGE FILE STREAMING TESTS

test('handles large file (5MB) with streaming I/O', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(5 * 1024 * 1024, inputFile) // 5MB
    const encryptionKey = 'large-file-test'
    
    const startTime = Date.now()
    
    // Create capsules using streaming
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, encryptionKey)
    const createTime = Date.now() - startTime
    
    // Should complete efficiently
    t.true(createTime < 10000, `Creation took ${createTime}ms`)
    
    // Verify structure
    t.is(capsuleSet.metadata.originalSize, 5 * 1024 * 1024)
    t.is(capsuleSet.metadata.capsuleCount, 5) // 5 x 1MB capsules
    
    // Extract using streaming
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, encryptionKey)
    
    // Verify file size (without loading into memory)
    const reconstructedStats = readFileSync(reconstructedFile)
    t.is(reconstructedStats.length, originalData.length)
    
    // Verify checksums
    const originalChecksum = calculateSHA256(originalData)
    const reconstructedChecksum = calculateSHA256(reconstructedStats)
    t.is(originalChecksum, reconstructedChecksum)
    
  } finally {
    cleanupTempDir(tempDir)
  }
}, { timeout: 30000 })

// DETERMINISTIC CONSENSUS TESTS

test('deterministic processing produces identical results', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir1 = join(tempDir, 'output1')
  const outputDir2 = join(tempDir, 'output2')
  
  try {
    createTestFile(400 * 1024, inputFile) // 400KB
    const encryptionKey = 'deterministic-test-key'
    
    // Create capsules twice with same parameters
    const capsuleSet1 = await createDataCapsuleFromFile(inputFile, outputDir1, false, encryptionKey)
    const capsuleSet2 = await createDataCapsuleFromFile(inputFile, outputDir2, false, encryptionKey)
    
    // Results should be identical
    t.is(capsuleSet1.id, capsuleSet2.id)
    t.is(capsuleSet1.metadata.checksum, capsuleSet2.metadata.checksum)
    t.is(capsuleSet1.metadata.capsuleCount, capsuleSet2.metadata.capsuleCount)
    
    // Capsule hashes should match
    capsuleSet1.capsules.forEach((capsule1, index) => {
      const capsule2 = capsuleSet2.capsules[index]
      t.is(capsule1.hash, capsule2.hash)
      t.is(capsule1.size, capsule2.size)
    })
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('postProcessPadding modes produce different but valid results', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir1 = join(tempDir, 'output1')
  const outputDir2 = join(tempDir, 'output2')
  const reconstruct1 = join(tempDir, 'recon1.dat')
  const reconstruct2 = join(tempDir, 'recon2.dat')
  
  try {
    const originalData = createTestFile(200 * 1024, inputFile) // 200KB
    const encryptionKey = 'padding-mode-test'
    
    // Create with postProcessPadding = false
    const capsuleSet1 = await createDataCapsuleFromFile(inputFile, outputDir1, false, encryptionKey)
    
    // Create with postProcessPadding = true
    const capsuleSet2 = await createDataCapsuleFromFile(inputFile, outputDir2, true, encryptionKey)
    
    // Should have same processing and checksums (since padding mode is now consistent)
    t.is(capsuleSet1.metadata.checksum, capsuleSet2.metadata.checksum)
    
    // Since padding is now always post-process, capsule hashes should be identical
    t.is(capsuleSet1.capsules[0].hash, capsuleSet2.capsules[0].hash)
    
    // Both should reconstruct correctly
    await extractDataCapsuleToFile(outputDir1, reconstruct1, encryptionKey)
    await extractDataCapsuleToFile(outputDir2, reconstruct2, encryptionKey)
    
    const recon1Data = readFileSync(reconstruct1)
    const recon2Data = readFileSync(reconstruct2)
    
    t.deepEqual(recon1Data, originalData)
    t.deepEqual(recon2Data, originalData)
    t.deepEqual(recon1Data, recon2Data)
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

// LEGACY COMPATIBILITY TESTS (Buffer-based operations)

test('legacy createDataCapsule still works for small data', async (t) => {
  const tempDir = createTempDir()
  
  try {
    const testData = createTestData(100 * 1024) // 100KB
    const encryptionKey = 'legacy-test-key'
    const outputDir = join(tempDir, 'legacy_capsules')
    
    const capsuleSet = await createDataCapsule(testData, outputDir, false, encryptionKey)
    
    t.is(capsuleSet.metadata.originalSize, 100 * 1024)
    t.is(capsuleSet.metadata.capsuleCount, 1)
    t.true(capsuleSet.capsules[0].encrypted)
    t.true(capsuleSet.capsules[0].compressed)
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('legacy round-trip with small data', async (t) => {
  const tempDir = createTempDir()
  
  try {
    const originalData = createTestData(150 * 1024) // 150KB
    const encryptionKey = 'legacy-round-trip'
    
    // Create using buffer method with output directory
    const outputDir = join(tempDir, 'legacy')
    const capsuleSet = await createDataCapsule(originalData, outputDir, false, encryptionKey)
    
    // Extract using method that returns buffer
    const extractedData = await extractDataCapsule(outputDir, encryptionKey)
    
    // Verify
    t.deepEqual(Buffer.from(extractedData), Buffer.from(originalData))
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

// ERROR HANDLING TESTS

test('streaming extraction fails with wrong decryption key', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    createTestFile(100 * 1024, inputFile)
    const correctKey = 'correct-key'
    const wrongKey = 'wrong-key'
    
    await createDataCapsuleFromFile(inputFile, capsulesDir, false, correctKey)
    
    await t.throwsAsync(
      async () => await extractDataCapsuleToFile(capsulesDir, outputFile, wrongKey)
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('loadCapsuleSet fails with non-existent path', async (t) => {
  await t.throwsAsync(
    async () => await loadCapsuleSet('/non/existent/path')
  )
})

// EDGE CASES

test('handles file exactly at capsule boundary (256KB)', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(256 * 1024, inputFile) // Exactly 256KB
    const encryptionKey = 'boundary-test'
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, encryptionKey)
    
    t.is(capsuleSet.metadata.originalSize, 256 * 1024)
    t.is(capsuleSet.metadata.capsuleCount, 1)
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, encryptionKey)
    
    const reconstructedData = readFileSync(outputFile)
    t.deepEqual(reconstructedData, originalData)
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles file just over capsule boundary (256KB + 1 byte)', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(256 * 1024 + 1, inputFile) // 256KB + 1 byte
    const encryptionKey = 'over-boundary-test'
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, encryptionKey)
    
    t.is(capsuleSet.metadata.originalSize, 256 * 1024 + 1)
    t.is(capsuleSet.metadata.capsuleCount, 2) // Should create 2 x 256KB capsules
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, encryptionKey)
    
    const reconstructedData = readFileSync(outputFile)
    t.deepEqual(reconstructedData, originalData)
    
  } finally {
    cleanupTempDir(tempDir)
  }
})
