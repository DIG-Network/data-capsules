import test from 'ava'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { 
  createDataCapsuleFromFile,
  extractDataCapsuleToFile
} from '../index.js'
import { 
  createTempDir, 
  cleanupTempDir, 
  createTestFile,
  assertBuffersEqual,
  calculateSHA256,
  TEST_SIZES,
  TEST_KEYS
} from './helpers/test-utils.mjs'

// Edge Cases Tests

test('handles empty files correctly', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    // Create empty file
    const originalData = createTestFile(0, inputFile)
    
    // Should handle empty files gracefully
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, null)
    
    // Even empty files should create a valid capsule set
    t.is(capsuleSet.metadata.originalSize, 0, 'Empty file should have original size 0')
    t.true(capsuleSet.metadata.capsuleCount >= 1, 'Should create at least one capsule even for empty files')
    
    // Extract and verify
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, null)
    const reconstructedData = readFileSync(reconstructedFile)
    
    t.is(reconstructedData.length, 0, 'Empty file should remain empty')
    assertBuffersEqual(t, reconstructedData, originalData, 'Empty files should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles file exactly at 256KB boundary', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.BOUNDARY_256KB, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    t.is(capsuleSet.metadata.originalSize, TEST_SIZES.BOUNDARY_256KB, 'Should preserve exact boundary size')
    t.is(capsuleSet.metadata.capsuleCount, 1, 'Should create single capsule at boundary')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
    
    const reconstructedData = readFileSync(outputFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Boundary files should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles file just over 256KB boundary', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.OVER_BOUNDARY, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    t.is(capsuleSet.metadata.originalSize, TEST_SIZES.OVER_BOUNDARY, 'Should preserve over-boundary size')
    t.is(capsuleSet.metadata.capsuleCount, 2, 'Should create 2 capsules for over-boundary file')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
    
    const reconstructedData = readFileSync(outputFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Over-boundary files should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles very small files (1 byte)', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(1, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    t.is(capsuleSet.metadata.originalSize, 1, 'Should preserve 1-byte size')
    t.true(capsuleSet.metadata.capsuleCount >= 1, 'Should create at least one capsule')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
    
    const reconstructedData = readFileSync(outputFile)
    t.is(reconstructedData.length, 1, 'Should preserve 1-byte length')
    assertBuffersEqual(t, reconstructedData, originalData, '1-byte files should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles files with highly compressible data', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    // Create highly compressible data (all zeros)
    const size = TEST_SIZES.MEDIUM
    const compressibleData = Buffer.alloc(size, 0)
    writeFileSync(inputFile, compressibleData)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Should still preserve original size
    t.is(capsuleSet.metadata.originalSize, size, 'Should preserve original size even with compression')
    
    // Verify compression info indicates high compression ratio
    t.truthy(capsuleSet.metadata.compressionInfo, 'Should have compression info')
    t.is(capsuleSet.metadata.compressionInfo.algorithm, 'gzip', 'Should use gzip compression')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
    
    const reconstructedData = readFileSync(outputFile)
    assertBuffersEqual(t, reconstructedData, compressibleData, 'Highly compressible data should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles files with incompressible data', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    // Create incompressible data (random bytes)
    const originalData = createTestFile(TEST_SIZES.MEDIUM, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Should still handle incompressible data
    t.is(capsuleSet.metadata.originalSize, TEST_SIZES.MEDIUM, 'Should preserve original size')
    t.truthy(capsuleSet.metadata.compressionInfo, 'Should have compression info')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
    
    const reconstructedData = readFileSync(outputFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Incompressible data should be handled correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles extremely long encryption keys', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Use extremely long encryption key
    const longKey = 'a'.repeat(1000)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, longKey)
    
    // Should handle long keys
    t.truthy(capsuleSet.metadata.encryptionInfo, 'Should have encryption info')
    t.is(capsuleSet.metadata.encryptionInfo.algorithm, 'AES-256-GCM', 'Should use correct algorithm')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, longKey)
    
    const reconstructedData = readFileSync(outputFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Long encryption keys should work')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles special characters in encryption keys', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Use key with special characters
    const specialKey = '🔐密钥🗝️!@#$%^&*()+=[]{}|;:,.<>?'
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, specialKey)
    
    // Should handle special characters in keys
    t.truthy(capsuleSet.metadata.encryptionInfo, 'Should have encryption info')
    
    await extractDataCapsuleToFile(capsulesDir, outputFile, specialKey)
    
    const reconstructedData = readFileSync(outputFile)
    assertBuffersEqual(t, reconstructedData, originalData, 'Special character keys should work')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles files at multiple MB boundaries', async (t) => {
  const tempDir = createTempDir()
  
  try {
    const testSizes = [
      1024 * 1024,      // Exactly 1MB
      1024 * 1024 + 1,  // Just over 1MB
      10 * 1024 * 1024, // Exactly 10MB
      10 * 1024 * 1024 + 1 // Just over 10MB
    ]
    
    for (let i = 0; i < testSizes.length; i++) {
      const size = testSizes[i]
      const inputFile = join(tempDir, `input${i}.dat`)
      const capsulesDir = join(tempDir, `capsules${i}`)
      const outputFile = join(tempDir, `output${i}.dat`)
      
      const originalData = createTestFile(size, inputFile)
      
      const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
      
      t.is(capsuleSet.metadata.originalSize, size, `Should preserve size ${size}`)
      
      await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
      
      const reconstructedData = readFileSync(outputFile)
      assertBuffersEqual(t, reconstructedData, originalData, `Size ${size} should be handled correctly`)
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles mixed padding modes in same test run', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir1 = join(tempDir, 'capsules1')
  const capsulesDir2 = join(tempDir, 'capsules2')
  const outputFile1 = join(tempDir, 'output1.dat')
  const outputFile2 = join(tempDir, 'output2.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create with different padding modes
    const capsuleSet1 = await createDataCapsuleFromFile(inputFile, capsulesDir1, false, TEST_KEYS.BASIC)
    const capsuleSet2 = await createDataCapsuleFromFile(inputFile, capsulesDir2, true, TEST_KEYS.BASIC)
    
    // Both should have same original checksum and processing (since padding mode is now always the same)
    t.is(capsuleSet1.metadata.checksum, capsuleSet2.metadata.checksum, 'Original checksums should match')
    
    // Since padding is now always post-process, capsule hashes should be identical
    t.is(capsuleSet1.capsules[0].hash, capsuleSet2.capsules[0].hash, 'Capsule hashes should be identical since padding mode is consistent')
    
    // Both should extract correctly
    await extractDataCapsuleToFile(capsulesDir1, outputFile1, TEST_KEYS.BASIC)
    await extractDataCapsuleToFile(capsulesDir2, outputFile2, TEST_KEYS.BASIC)
    
    const reconstructed1 = readFileSync(outputFile1)
    const reconstructed2 = readFileSync(outputFile2)
    
    assertBuffersEqual(t, reconstructed1, originalData, 'Pre-process padding should work')
    assertBuffersEqual(t, reconstructed2, originalData, 'Post-process padding should work')
    assertBuffersEqual(t, reconstructed1, reconstructed2, 'Both padding modes should produce same result')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('handles data integrity across multiple extractions', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    const originalData = createTestFile(TEST_SIZES.MEDIUM, inputFile)
    const originalChecksum = calculateSHA256(originalData)
    
    // Create capsules once
    await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Extract multiple times
    const extractionCount = 5
    for (let i = 0; i < extractionCount; i++) {
      const outputFile = join(tempDir, `output${i}.dat`)
      
      await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC)
      
      const reconstructedData = readFileSync(outputFile)
      const reconstructedChecksum = calculateSHA256(reconstructedData)
      
      t.is(reconstructedChecksum, originalChecksum, `Extraction ${i} should preserve integrity`)
      assertBuffersEqual(t, reconstructedData, originalData, `Extraction ${i} should be identical`)
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('placeholder', (t) => {
  t.pass()
}) 