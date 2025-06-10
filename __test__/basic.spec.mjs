import test from 'ava'
import { 
  getCapsuleSizes, 
  calculateStorageOverhead,
  getConsensusVersion
} from '../index.js'

// Basic Constants and Utility Tests

test('getCapsuleSizes returns correct fixed sizes', (t) => {
  const sizes = getCapsuleSizes()
  const expectedSizes = [
    256 * 1024,   // 256 KB
    1024 * 1024,  // 1 MB
    10 * 1024 * 1024,   // 10 MB
    100 * 1024 * 1024,  // 100 MB
    1000 * 1024 * 1024  // 1000 MB
  ]
  
  t.deepEqual(sizes, expectedSizes, 'Should return standardized capsule sizes')
  t.is(sizes.length, 5, 'Should have exactly 5 capsule sizes')
  
  // Verify sizes are in ascending order
  for (let i = 1; i < sizes.length; i++) {
    t.true(sizes[i] > sizes[i-1], `Size ${i} should be larger than size ${i-1}`)
  }
})

test('getConsensusVersion returns valid version', (t) => {
  const version = getConsensusVersion()
  t.is(version, 'DIG_CAPSULE_V1', 'Should return correct consensus version')
  t.is(typeof version, 'string', 'Version should be a string')
  t.true(version.length > 0, 'Version should not be empty')
})

test('calculateStorageOverhead returns correct values for zero size', (t) => {
  const overhead = calculateStorageOverhead(0, 1)
  t.is(overhead, 0.0, 'Zero size should result in zero overhead')
})

test('calculateStorageOverhead returns correct values for small files', (t) => {
  // Test with small file requiring significant padding
  const smallOverhead = calculateStorageOverhead(100 * 1024, 1) // 100KB
  t.true(smallOverhead >= 5.0, 'Should have at least 5% minimum padding')
  t.true(smallOverhead <= 200.0, 'Overhead should be reasonable (less than 200%)')
  t.is(typeof smallOverhead, 'number', 'Should return a number')
})

test('calculateStorageOverhead returns correct values for different capsule counts', (t) => {
  const fileSize = 1024 * 1024 // 1MB
  
  const singleCapsule = calculateStorageOverhead(fileSize, 1)
  const multipleCapsules = calculateStorageOverhead(fileSize, 4)
  
  t.true(multipleCapsules > singleCapsule, 'More capsules should result in higher overhead')
  t.true(singleCapsule >= 0, 'Single capsule overhead should be non-negative')
  t.true(multipleCapsules >= 0, 'Multiple capsule overhead should be non-negative')
})

test('calculateStorageOverhead handles edge cases', (t) => {
  // Test with very large file
  const largeOverhead = calculateStorageOverhead(1000 * 1024 * 1024, 1) // 1GB
  t.true(largeOverhead >= 0, 'Large file overhead should be non-negative')
  t.true(largeOverhead < 10, 'Large file overhead should be small percentage')
  
  // Test with zero capsules (edge case)
  const zeroCapsules = calculateStorageOverhead(1024 * 1024, 0)
  t.is(zeroCapsules, 0, 'Zero capsules should result in zero overhead')
})

test('capsule sizes are powers of base units', (t) => {
  const sizes = getCapsuleSizes()
  const KB = 1024
  const MB = 1024 * KB
  
  t.is(sizes[0], 256 * KB, 'First size should be 256KB')
  t.is(sizes[1], 1 * MB, 'Second size should be 1MB') 
  t.is(sizes[2], 10 * MB, 'Third size should be 10MB')
  t.is(sizes[3], 100 * MB, 'Fourth size should be 100MB')
  t.is(sizes[4], 1000 * MB, 'Fifth size should be 1000MB')
})

test('capsule sizes have correct binary alignment', (t) => {
  const sizes = getCapsuleSizes()
  
  // All sizes should be multiples of 1024 (proper binary alignment)
  sizes.forEach((size, index) => {
    t.is(size % 1024, 0, `Size ${index} (${size}) should be aligned to 1024 bytes`)
  })
})

test('storage overhead calculation consistency', (t) => {
  const fileSize = 512 * 1024 // 512KB
  
  // Test that overhead calculation is consistent
  const overhead1 = calculateStorageOverhead(fileSize, 2)
  const overhead2 = calculateStorageOverhead(fileSize, 2)
  
  t.is(overhead1, overhead2, 'Multiple calls should return same result')
  
  // Test that overhead scales linearly with capsule count
  const overhead_1cap = calculateStorageOverhead(fileSize, 1)
  const overhead_2cap = calculateStorageOverhead(fileSize, 2)
  const overhead_4cap = calculateStorageOverhead(fileSize, 4)
  
  t.true(overhead_2cap >= overhead_1cap, '2 capsules should have >= overhead than 1')
  t.true(overhead_4cap >= overhead_2cap, '4 capsules should have >= overhead than 2')
}) 