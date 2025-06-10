import test from 'ava'
import { join } from 'path'
import { 
  createDataCapsuleFromFile,
  validateConsensusParameters
} from '../index.js'
import { 
  createTempDir, 
  cleanupTempDir, 
  createTestFile,
  assertValidCapsuleSet,
  createInvalidCapsuleSet,
  TEST_SIZES,
  TEST_KEYS
} from './helpers/test-utils.mjs'

// Consensus Validation Tests

test('validateConsensusParameters validates correct capsule sets', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(TEST_SIZES.MEDIUM, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.CONSENSUS)
    
    // Should validate successfully
    const isValid = await validateConsensusParameters(capsuleSet)
    t.true(isValid, 'Valid capsule set should pass consensus validation')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('validateConsensusParameters rejects invalid capsule sizes', async (t) => {
  const invalidCapsuleSet = createInvalidCapsuleSet('invalid-size')
  
  await t.throwsAsync(
    async () => await validateConsensusParameters(invalidCapsuleSet),
    { message: /Consensus violation.*Invalid capsule size/ },
    'Should reject invalid capsule sizes'
  )
})

test('validateConsensusParameters rejects invalid consensus version', async (t) => {
  const invalidCapsuleSet = createInvalidCapsuleSet('invalid-consensus-version')
  
  await t.throwsAsync(
    async () => await validateConsensusParameters(invalidCapsuleSet),
    { message: /Consensus violation.*Invalid consensus version/ },
    'Should reject invalid consensus version'
  )
})

test('validateConsensusParameters rejects invalid chunking algorithm', async (t) => {
  const invalidCapsuleSet = createInvalidCapsuleSet('invalid-chunking-algorithm')
  
  await t.throwsAsync(
    async () => await validateConsensusParameters(invalidCapsuleSet),
    { message: /Consensus violation.*Invalid chunking algorithm/ },
    'Should reject invalid chunking algorithm'
  )
})

test('deterministic processing produces identical results', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir1 = join(tempDir, 'output1')
  const outputDir2 = join(tempDir, 'output2')
  
  try {
    createTestFile(TEST_SIZES.LARGE, inputFile)
    
    // Create capsules twice with same parameters
    const capsuleSet1 = await createDataCapsuleFromFile(inputFile, outputDir1, false, TEST_KEYS.CONSENSUS)
    const capsuleSet2 = await createDataCapsuleFromFile(inputFile, outputDir2, false, TEST_KEYS.CONSENSUS)
    
    // Results should be identical
    t.is(capsuleSet1.id, capsuleSet2.id, 'IDs should be identical')
    t.is(capsuleSet1.metadata.checksum, capsuleSet2.metadata.checksum, 'Checksums should be identical')
    t.is(capsuleSet1.metadata.capsuleCount, capsuleSet2.metadata.capsuleCount, 'Capsule counts should be identical')
    
    // Capsule hashes should match
    capsuleSet1.capsules.forEach((capsule1, index) => {
      const capsule2 = capsuleSet2.capsules[index]
      t.is(capsule1.hash, capsule2.hash, `Capsule ${index} hash should be identical`)
      t.is(capsule1.size, capsule2.size, `Capsule ${index} size should be identical`)
      t.is(capsule1.index, capsule2.index, `Capsule ${index} index should be identical`)
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
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create with postProcessPadding = false
    const capsuleSet1 = await createDataCapsuleFromFile(inputFile, outputDir1, false, TEST_KEYS.CONSENSUS)
    
    // Create with postProcessPadding = true
    const capsuleSet2 = await createDataCapsuleFromFile(inputFile, outputDir2, true, TEST_KEYS.CONSENSUS)
    
    // Should have same original checksum (since padding mode is now always the same)
    t.is(capsuleSet1.metadata.checksum, capsuleSet2.metadata.checksum, 'Original checksums should match')
    
    // Since padding is now always post-process, capsule hashes should be identical
    t.is(capsuleSet1.capsules[0].hash, capsuleSet2.capsules[0].hash, 'Capsule hashes should be identical since padding mode is consistent')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('consensus validation checks all capsule sizes', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  
  try {
    // Create file that will result in multiple capsules
    createTestFile(TEST_SIZES.LARGE, inputFile)
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.CONSENSUS)
    
    // All capsules should pass consensus validation
    const isValid = await validateConsensusParameters(capsuleSet)
    t.true(isValid, 'Multi-capsule set should pass consensus validation')
    
    // Verify each capsule has valid size
    const validSizes = [262144, 1048576, 10485760, 104857600, 1048576000] // Standard capsule sizes
    capsuleSet.capsules.forEach((capsule, index) => {
      t.true(validSizes.includes(capsule.size), `Capsule ${index} should have valid size`)
    })
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('consensus validation is consistent across different file sizes', async (t) => {
  const tempDir = createTempDir()
  
  try {
    const testSizes = [TEST_SIZES.TINY, TEST_SIZES.SMALL, TEST_SIZES.MEDIUM, TEST_SIZES.LARGE]
    
    for (let i = 0; i < testSizes.length; i++) {
      const inputFile = join(tempDir, `input${i}.dat`)
      const outputDir = join(tempDir, `output${i}`)
      
      createTestFile(testSizes[i], inputFile)
      const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.CONSENSUS)
      
      const isValid = await validateConsensusParameters(capsuleSet)
      t.true(isValid, `Capsule set for size ${testSizes[i]} should be valid`)
      
      // Verify consensus-critical fields
      t.is(capsuleSet.metadata.consensusVersion, 'DIG_CAPSULE_V1', 'Should have correct consensus version')
      t.is(capsuleSet.metadata.chunkingAlgorithm, 'DIG_DETERMINISTIC_V1', 'Should have correct chunking algorithm')
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('deterministic chunking follows consensus algorithm', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'capsules')
  
  try {
    // Test specific size that should create multiple capsules of different sizes
    createTestFile(25 * 1024 * 1024, inputFile) // 25MB should create 2×10MB + 5×1MB according to spec
    
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.CONSENSUS)
    
    // Verify chunking follows consensus algorithm
    assertValidCapsuleSet(t, capsuleSet, 25 * 1024 * 1024)
    t.true(capsuleSet.metadata.capsuleCount > 1, 'Should create multiple capsules')
    
    // Verify consensus validation passes
    const isValid = await validateConsensusParameters(capsuleSet)
    t.true(isValid, 'Chunked capsule set should pass consensus validation')
    
  } finally {
    cleanupTempDir(tempDir)
  }
}) 