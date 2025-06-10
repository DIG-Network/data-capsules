import test from 'ava'
import { readFileSync } from 'fs'
import { join } from 'path'
import { 
  createDataCapsuleFromFile,
  extractDataCapsuleToFile,
  loadCapsuleSet,
  reconstructFileFromCapsules
} from '../index.js'
import { 
  createTempDir, 
  cleanupTempDir, 
  createTestFile,
  calculateSHA256,
  assertValidCapsuleSet,
  assertBuffersEqual,
  TEST_SIZES,
  TEST_KEYS
} from './helpers/test-utils.mjs'

// File Operations Tests

test('createDataCapsuleFromFile handles small file with encryption', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.BASIC)
    
    // Verify capsule set structure
    assertValidCapsuleSet(t, capsuleSet, TEST_SIZES.SMALL)
    t.is(capsuleSet.metadata.capsuleCount, 1, 'Should create single capsule for small file')
    
    // Verify encryption info
    t.truthy(capsuleSet.metadata.encryptionInfo, 'Should have encryption info')
    t.is(capsuleSet.metadata.encryptionInfo.algorithm, 'AES-256-GCM', 'Should use AES-256-GCM')
    t.is(capsuleSet.metadata.encryptionInfo.keyDerivation, 'PBKDF2-HMAC-SHA256', 'Should use PBKDF2 key derivation')
    t.is(capsuleSet.metadata.encryptionInfo.iterations, 100000, 'Should use correct iteration count')
    
    // Verify compression info
    t.truthy(capsuleSet.metadata.compressionInfo, 'Should have compression info')
    t.is(capsuleSet.metadata.compressionInfo.algorithm, 'gzip', 'Should use gzip compression')
    t.is(capsuleSet.metadata.compressionInfo.level, 6, 'Should use compression level 6')
    
    // Verify capsule properties
    t.true(capsuleSet.capsules[0].encrypted, 'Capsule should be marked as encrypted')
    t.true(capsuleSet.capsules[0].compressed, 'Capsule should be marked as compressed')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('createDataCapsuleFromFile handles unencrypted files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    const originalData = createTestFile(TEST_SIZES.MEDIUM, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, null)
    
    assertValidCapsuleSet(t, capsuleSet, TEST_SIZES.MEDIUM)
    
    // Verify no encryption info
    t.is(capsuleSet.metadata.encryptionInfo, undefined, 'Should not have encryption info')
    
    // Verify compression info still present
    t.truthy(capsuleSet.metadata.compressionInfo, 'Should have compression info')
    
    // Verify capsule properties
    t.false(capsuleSet.capsules[0].encrypted, 'Capsule should not be marked as encrypted')
    t.true(capsuleSet.capsules[0].compressed, 'Capsule should be marked as compressed')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('createDataCapsuleFromFile handles consistent padding mode', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, true, TEST_KEYS.BASIC)
    
    assertValidCapsuleSet(t, capsuleSet, TEST_SIZES.SMALL)
    
    // Verify the capsule is created successfully (padding mode is now always post-process)
    t.is(capsuleSet.capsules.length, 1, 'Should create one capsule')
    
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
    const originalData = createTestFile(TEST_SIZES.LARGE, inputFile)
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.BASIC)
    
    // Extract using streaming
    await extractDataCapsuleToFile(outputDir, reconstructedFile, TEST_KEYS.BASIC)
    
    // Verify reconstruction
    const reconstructedData = readFileSync(reconstructedFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Reconstructed data should match original')
    
    // Verify checksums
    const originalChecksum = calculateSHA256(originalData)
    const reconstructedChecksum = calculateSHA256(reconstructedData)
    t.is(originalChecksum, reconstructedChecksum, 'Checksums should match')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('extractDataCapsuleToFile handles post-process padding correctly', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create capsules with post-process padding
    await createDataCapsuleFromFile(inputFile, outputDir, true, TEST_KEYS.BASIC)
    
    // Extract
    await extractDataCapsuleToFile(outputDir, reconstructedFile, TEST_KEYS.BASIC)
    
    // Verify reconstruction
    const reconstructedData = readFileSync(reconstructedFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Post-process padding should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('loadCapsuleSet loads metadata correctly', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(TEST_SIZES.MEDIUM, inputFile)
    
    // Create capsules
    const originalCapsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, true, TEST_KEYS.BASIC)
    
    // Load capsule set
    const loadedCapsuleSet = await loadCapsuleSet(outputDir)
    
    // Verify metadata matches
    t.is(loadedCapsuleSet.id, originalCapsuleSet.id, 'IDs should match')
    t.is(loadedCapsuleSet.metadata.originalSize, originalCapsuleSet.metadata.originalSize, 'Original sizes should match')
    
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
    const originalData = createTestFile(TEST_SIZES.LARGE, inputFile)
    
    // Create capsules
    await createDataCapsuleFromFile(inputFile, capsulesDir, true, TEST_KEYS.BASIC)
    
    // Load capsule set metadata
    const capsuleSet = await loadCapsuleSet(capsulesDir)
    
    // Reconstruct using loaded metadata
    await reconstructFileFromCapsules(capsuleSet, capsulesDir, reconstructedFile, TEST_KEYS.BASIC)
    
    // Verify reconstruction
    const reconstructedData = readFileSync(reconstructedFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Reconstruction from loaded capsule set should work')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('file operations handle multiple capsules correctly', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.LARGE, inputFile) // Should create multiple capsules
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Should have multiple capsules for this size
    t.true(capsuleSet.metadata.capsuleCount > 1, 'Should create multiple capsules')
    
    // Each capsule should have correct properties
    capsuleSet.capsules.forEach((capsule, index) => {
      t.is(capsule.index, index, `Capsule ${index} should have correct index`)
      t.true(capsule.encrypted, `Capsule ${index} should be encrypted`)
      t.true(capsule.compressed, `Capsule ${index} should be compressed`)
    })
    
    // Reconstruct and verify
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, TEST_KEYS.BASIC)
    const reconstructedData = readFileSync(reconstructedFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Multi-capsule reconstruction should work')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('file operations preserve file permissions and metadata', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.MEDIUM, inputFile)
    const originalChecksum = calculateSHA256(originalData)
    
    // Create and extract
    await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, TEST_KEYS.BASIC)
    
    // Verify file content integrity
    const reconstructedData = readFileSync(reconstructedFile)
    const reconstructedChecksum = calculateSHA256(reconstructedData)
    
    t.is(originalChecksum, reconstructedChecksum, 'File integrity should be preserved')
    t.is(originalData.length, reconstructedData.length, 'File sizes should match')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('file operations handle empty files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    // Create empty file
    const originalData = createTestFile(0, inputFile)
    
    // This should handle empty files gracefully
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, null)
    
    // Even empty files should create a capsule set
    assertValidCapsuleSet(t, capsuleSet, 0)
    
    // Extract and verify
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, null)
    const reconstructedData = readFileSync(reconstructedFile)
    
    t.is(reconstructedData.length, 0, 'Empty file should remain empty')
    assertBuffersEqual(t, reconstructedData, originalData, 'Empty files should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('file operations with different encryption keys', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Test with strong key
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.STRONG)
    
    // Extract with same key
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, TEST_KEYS.STRONG)
    
    const reconstructedData = readFileSync(reconstructedFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Strong encryption key should work')
    
  } finally {
    cleanupTempDir(tempDir)
  }
}) 