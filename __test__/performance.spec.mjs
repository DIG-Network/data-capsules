import test from 'ava'
import { readFileSync } from 'fs'
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

// Performance Tests

test('handles large file (5MB) with streaming I/O', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const reconstructedFile = join(tempDir, 'output.dat')
  
  try {
    const originalData = createTestFile(TEST_SIZES.MULTI_MB, inputFile)
    
    const startTime = Date.now()
    
    // Create capsules using streaming
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    const createTime = Date.now() - startTime
    
    // Should complete efficiently
    t.true(createTime < 10000, `Creation took ${createTime}ms - should be under 10 seconds`)
    
    // Verify structure
    t.is(capsuleSet.metadata.originalSize, TEST_SIZES.MULTI_MB, 'Should preserve original size')
    t.true(capsuleSet.metadata.capsuleCount > 1, 'Should create multiple capsules')
    
    // Extract using streaming
    const extractStartTime = Date.now()
    await extractDataCapsuleToFile(capsulesDir, reconstructedFile, TEST_KEYS.BASIC)
    const extractTime = Date.now() - extractStartTime
    
    t.true(extractTime < 10000, `Extraction took ${extractTime}ms - should be under 10 seconds`)
    
    // Verify file size
    const reconstructedStats = readFileSync(reconstructedFile)
    t.is(reconstructedStats.length, originalData.length, 'File sizes should match')
    
    // Verify checksums for integrity
    const originalChecksum = calculateSHA256(originalData)
    const reconstructedChecksum = calculateSHA256(reconstructedStats)
    t.is(originalChecksum, reconstructedChecksum, 'Checksums should match')
    
  } finally {
    cleanupTempDir(tempDir)
  }
}, { timeout: 30000 })

test('memory efficiency with large files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    // Create large file
    createTestFile(TEST_SIZES.MULTI_MB, inputFile)
    
    // Monitor memory usage (simplified check)
    const beforeMemory = process.memoryUsage()
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    const afterMemory = process.memoryUsage()
    
    // Memory increase should be reasonable (not loading entire file)
    const memoryIncrease = afterMemory.heapUsed - beforeMemory.heapUsed
    const fileSize = TEST_SIZES.MULTI_MB
    
    t.true(memoryIncrease < fileSize * 2, 'Memory usage should be reasonable compared to file size')
    t.is(capsuleSet.metadata.originalSize, fileSize, 'Should handle large file correctly')
    
  } finally {
    cleanupTempDir(tempDir)
  }
}, { timeout: 30000 }) 