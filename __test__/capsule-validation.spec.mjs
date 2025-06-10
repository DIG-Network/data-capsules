import test from 'ava'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { 
  createDataCapsuleFromFile,
  isValidCapsuleFile,
  getCapsuleFileInfo
} from '../index.js'
import { 
  createTempDir, 
  cleanupTempDir, 
  createTestFile,
  TEST_SIZES,
  TEST_KEYS
} from './helpers/test-utils.mjs'

// Capsule File Validation Tests

test('isValidCapsuleFile identifies valid capsule files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Check each capsule file
    for (let i = 0; i < capsuleSet.metadata.capsuleCount; i++) {
      const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_${i.toString().padStart(3, '0')}.capsule`)
      const isValid = await isValidCapsuleFile(capsuleFile)
      t.true(isValid, `Capsule file ${i} should be valid`)
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('isValidCapsuleFile rejects non-existent files', async (t) => {
  const tempDir = createTempDir()
  
  try {
    const nonExistentFile = join(tempDir, 'nonexistent.capsule')
    const isValid = await isValidCapsuleFile(nonExistentFile)
    t.false(isValid, 'Non-existent file should be invalid')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('isValidCapsuleFile rejects invalid file content', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Test with invalid file (not a capsule)
    const invalidFile = join(tempDir, 'invalid.capsule')
    writeFileSync(invalidFile, 'This is not a capsule file')
    const isValidInvalid = await isValidCapsuleFile(invalidFile)
    t.false(isValidInvalid, 'Invalid file should be invalid')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('isValidCapsuleFile rejects truncated files', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Test with truncated header
    const truncatedFile = join(tempDir, 'truncated.capsule')
    writeFileSync(truncatedFile, Buffer.from([1, 2, 3, 4])) // Too short
    const isValidTruncated = await isValidCapsuleFile(truncatedFile)
    t.false(isValidTruncated, 'Truncated file should be invalid')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('isValidCapsuleFile rejects files with wrong magic bytes', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Create file with wrong magic bytes but correct length
    const wrongMagicFile = join(tempDir, 'wrongmagic.capsule')
    const wrongHeader = Buffer.alloc(44) // Header size
    wrongHeader.write('WRONGMAG', 0) // Wrong magic
    writeFileSync(wrongMagicFile, wrongHeader)
    
    const isValid = await isValidCapsuleFile(wrongMagicFile)
    t.false(isValid, 'File with wrong magic bytes should be invalid')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('getCapsuleFileInfo extracts correct header information', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create capsules with specific parameters
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, true, TEST_KEYS.BASIC)
    
    // Get info from first capsule
    const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_000.capsule`)
    const info = await getCapsuleFileInfo(capsuleFile)
    
    t.truthy(info, 'Should return capsule info')
    t.is(info.version, 1, 'Version should be 1')
    t.is(info.capsuleIndex, 0, 'Index should be 0')
    t.is(info.capsuleSize, 256 * 1024, 'Size should be 256KB')
    t.true(info.isEncrypted, 'Should be encrypted')
    t.true(info.isCompressed, 'Should be compressed')
    t.is(typeof info.checksum, 'string', 'Should have checksum string')
    t.true(info.checksum.length > 0, 'Checksum should not be empty')
    
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

test('getCapsuleFileInfo works with unencrypted files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create unencrypted capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, null)
    
    const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_000.capsule`)
    const info = await getCapsuleFileInfo(capsuleFile)
    
    t.truthy(info, 'Should return capsule info for unencrypted file')
    t.false(info.isEncrypted, 'Should not be marked as encrypted')
    t.true(info.isCompressed, 'Should be marked as compressed')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('capsule headers maintain format consistency across multiple files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    // Create file that results in multiple capsules - use 300KB for 256KB capsules
    createTestFile(300 * 1024, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Verify all capsule files have consistent headers
    for (let i = 0; i < capsuleSet.metadata.capsuleCount; i++) {
      const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_${i.toString().padStart(3, '0')}.capsule`)
      const info = await getCapsuleFileInfo(capsuleFile)
      
      // Get expected size for this specific capsule from the capsule set
      const expectedCapsuleSize = capsuleSet.capsules[i].size
      
      t.truthy(info, `Capsule ${i} should have valid header`)
      t.is(info.version, 1, `Capsule ${i} should have correct version`)
      t.is(info.capsuleIndex, i, `Capsule ${i} should have correct index`)
      t.is(info.capsuleSize, expectedCapsuleSize, `Capsule ${i} should have correct size`)
      t.true(info.isEncrypted, `Capsule ${i} should be encrypted`)
      t.true(info.isCompressed, `Capsule ${i} should be compressed`)
      t.is(typeof info.checksum, 'string', `Capsule ${i} should have checksum`)
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('getCapsuleFileInfo handles different capsule sizes correctly', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    // Create larger file to get different capsule sizes
    createTestFile(2 * 1024 * 1024, inputFile) // 2MB should create 1MB capsules
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    if (capsuleSet.metadata.capsuleCount > 0) {
      const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_000.capsule`)
      const info = await getCapsuleFileInfo(capsuleFile)
      
      t.truthy(info, 'Should return info for larger capsule')
      t.true(info.capsuleSize >= 256 * 1024, 'Should have valid capsule size')
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('isValidCapsuleFile performance with large number of files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    // Create multiple capsules
    createTestFile(TEST_SIZES.LARGE, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    const startTime = Date.now()
    
    // Validate all capsule files
    const validationPromises = []
    for (let i = 0; i < capsuleSet.metadata.capsuleCount; i++) {
      const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_${i.toString().padStart(3, '0')}.capsule`)
      validationPromises.push(isValidCapsuleFile(capsuleFile))
    }
    
    const results = await Promise.all(validationPromises)
    const endTime = Date.now()
    
    // All should be valid
    results.forEach((isValid, index) => {
      t.true(isValid, `Capsule ${index} should be valid`)
    })
    
    // Should complete quickly
    const duration = endTime - startTime
    t.true(duration < 5000, `Validation should complete quickly (took ${duration}ms)`)
    
  } finally {
    cleanupTempDir(tempDir)
  }
}) 