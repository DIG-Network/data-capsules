import test from 'ava'
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
  TEST_SIZES,
  TEST_KEYS
} from './helpers/test-utils.mjs'

// Error Handling Tests

test('createDataCapsuleFromFile fails with non-existent input file', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'nonexistent.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    await t.throwsAsync(
      async () => await createDataCapsuleFromFile(inputFile, outputDir, false, null),
      undefined,
      'Should fail with non-existent input file'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('createDataCapsuleFromFile fails with invalid output directory permissions', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  // Use a Windows-invalid path with forbidden characters
  const outputDir = process.platform === 'win32' 
    ? 'CON:\\invalid<>path"with|forbidden*chars' 
    : '/root/invalid-permissions'
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // This should fail due to permissions or invalid path characters
    await t.throwsAsync(
      async () => await createDataCapsuleFromFile(inputFile, outputDir, false, null),
      undefined,
      'Should fail with invalid output directory'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('extractDataCapsuleToFile fails with wrong decryption key', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    const correctKey = TEST_KEYS.BASIC
    const wrongKey = TEST_KEYS.STRONG
    
    // Create encrypted capsules
    await createDataCapsuleFromFile(inputFile, capsulesDir, false, correctKey)
    
    // Try to extract with wrong key
    await t.throwsAsync(
      async () => await extractDataCapsuleToFile(capsulesDir, outputFile, wrongKey),
      undefined,
      'Should fail with wrong decryption key'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('extractDataCapsuleToFile fails when no key provided for encrypted capsules', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create encrypted capsules
    await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Try to extract without providing decryption key
    await t.throwsAsync(
      async () => await extractDataCapsuleToFile(capsulesDir, outputFile, null),
      undefined,
      'Should fail when no decryption key provided for encrypted capsules'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('extractDataCapsuleToFile fails with missing capsule files', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    createTestFile(TEST_SIZES.LARGE, inputFile) // Creates multiple capsules
    
    // Create capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Remove one of the capsule files to simulate corruption/missing file
    if (capsuleSet.metadata.capsuleCount > 1) {
      const fs = await import('fs')
      const capsuleToRemove = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_001.capsule`)
      fs.unlinkSync(capsuleToRemove)
      
      // Try to extract - should fail due to missing capsule
      await t.throwsAsync(
        async () => await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC),
        undefined,
        'Should fail with missing capsule file'
      )
    } else {
      t.pass('Test requires multiple capsules, skipping for this file size')
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('loadCapsuleSet fails with non-existent path', async (t) => {
  await t.throwsAsync(
    async () => await loadCapsuleSet('/non/existent/path'),
    undefined,
    'Should fail with non-existent path'
  )
})

test('loadCapsuleSet fails with directory containing no metadata file', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Empty directory with no metadata file
    await t.throwsAsync(
      async () => await loadCapsuleSet(tempDir),
      undefined,
      'Should fail with directory containing no metadata file'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('loadCapsuleSet fails with corrupted metadata file', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create valid capsules first
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Corrupt the metadata file
    const fs = await import('fs')
    const metadataFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_metadata.json`)
    fs.writeFileSync(metadataFile, 'invalid json content')
    
    // Try to load - should fail due to corrupted metadata
    await t.throwsAsync(
      async () => await loadCapsuleSet(capsulesDir),
      undefined,
      'Should fail with corrupted metadata file'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('reconstructFileFromCapsules fails with invalid capsule set', async (t) => {
  const tempDir = createTempDir()
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    const invalidCapsuleSet = {
      id: 'invalid',
      capsules: [],
      metadata: {
        originalSize: 0,
        capsuleCount: 0,
        capsuleSizes: [],
        checksum: 'invalid',
        chunkingAlgorithm: 'DIG_DETERMINISTIC_V1',
        consensusVersion: 'DIG_CAPSULE_V1'
      }
    }
    
    // Should handle invalid capsule set gracefully
    await t.throwsAsync(
      async () => await reconstructFileFromCapsules(invalidCapsuleSet, tempDir, outputFile, null),
      undefined,
      'Should fail with invalid capsule set'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('extractDataCapsuleToFile handles corrupted capsule data gracefully', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const capsulesDir = join(tempDir, 'capsules')
  const outputFile = join(tempDir, 'output.dat')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Create valid capsules
    const capsuleSet = await createDataCapsuleFromFile(inputFile, capsulesDir, false, TEST_KEYS.BASIC)
    
    // Corrupt a capsule file by overwriting it with random data
    const fs = await import('fs')
    const capsuleFile = join(capsulesDir, `${capsuleSet.id.substring(0, 16)}_000.capsule`)
    fs.writeFileSync(capsuleFile, Buffer.from('corrupted data'))
    
    // Try to extract - should fail gracefully
    await t.throwsAsync(
      async () => await extractDataCapsuleToFile(capsulesDir, outputFile, TEST_KEYS.BASIC),
      undefined,
      'Should fail gracefully with corrupted capsule data'
    )
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('createDataCapsuleFromFile handles invalid encryption key gracefully', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Test with empty string as encryption key (should be handled)
    const capsuleSet = await createDataCapsuleFromFile(inputFile, outputDir, false, '')
    
    // Should create valid capsule set even with empty key
    t.truthy(capsuleSet, 'Should handle empty encryption key')
    t.truthy(capsuleSet.metadata.encryptionInfo, 'Should still have encryption info')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('error handling preserves system stability', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Run multiple failing operations in sequence to ensure stability
    const operations = [
      () => createDataCapsuleFromFile('/nonexistent/file.dat', tempDir, false, null),
      () => extractDataCapsuleToFile('/nonexistent/path', '/tmp/output.dat', null),
      () => loadCapsuleSet('/nonexistent/path'),
      () => reconstructFileFromCapsules({}, tempDir, '/tmp/output.dat', null)
    ]
    
    for (const operation of operations) {
      try {
        await operation()
        t.fail('Operation should have failed')
      } catch (error) {
        // Expected to fail, just ensure we get here without crashing
        t.true(error instanceof Error, 'Should throw proper Error objects')
      }
    }
    
    t.pass('All error conditions handled without system instability')
    
  } finally {
    cleanupTempDir(tempDir)
  }
})

test('concurrent operations handle errors independently', async (t) => {
  const tempDir = createTempDir()
  const inputFile = join(tempDir, 'input.dat')
  const outputDir = join(tempDir, 'output')
  
  try {
    createTestFile(TEST_SIZES.SMALL, inputFile)
    
    // Ensure output directory exists for the valid operation
    const fs = await import('fs')
    fs.mkdirSync(outputDir, { recursive: true })
    
    // Start multiple operations concurrently
    const operations = [
      createDataCapsuleFromFile(inputFile, outputDir, false, TEST_KEYS.BASIC), // Valid operation
    ]
    
    // Add invalid operations using Promise.allSettled to handle rejections
    const allOperations = [
      ...operations,
      // Invalid file operation - wrapped in a promise that handles the rejection
      Promise.resolve().then(() => createDataCapsuleFromFile(join(tempDir, 'nonexistent.dat'), outputDir, false, null))
        .catch(err => Promise.reject(err))
    ]
    
    const results = await Promise.allSettled(allOperations)
    
    // First should succeed, second should fail
    t.is(results[0].status, 'fulfilled', 'Valid operation should succeed')
    t.is(results[1].status, 'rejected', 'Invalid file operation should fail')
    
    // The successful operation should produce valid results
    if (results[0].status === 'fulfilled') {
      const capsuleSet = results[0].value
      t.truthy(capsuleSet, 'Successful operation should return valid capsule set')
      t.is(typeof capsuleSet.id, 'string', 'Should have valid ID')
    }
    
  } finally {
    cleanupTempDir(tempDir)
  }
}) 