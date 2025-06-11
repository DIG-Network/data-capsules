const fs = require('fs')
const path = require('path')
const { 
  createDataCapsule,
  extractDataCapsule,
  createDataCapsuleFromFile,
  extractDataCapsuleToFile,
  loadCapsuleSet,
  getCapsuleSizes,
  getConsensusVersion,
  validateConsensusParameters,
  isValidCapsuleFile,
  getCapsuleFileInfo,
  calculateStorageOverhead
} = require('./index.js')

console.log('🚀 Data Capsules Example - Comprehensive Demonstration\n')

// Helper function to create test data
function createTestData(size, pattern = 'Test data: ') {
  const buffer = Buffer.alloc(size)
  const patternBuffer = Buffer.from(pattern)
  
  for (let i = 0; i < size; i++) {
    buffer[i] = patternBuffer[i % patternBuffer.length]
  }
  
  return buffer
}

// Helper function to clean up directories
function cleanupDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function demonstrateBasicFunctionality() {
  console.log('📋 1. Basic Information')
  console.log('   Supported capsule sizes:', getCapsuleSizes())
  console.log('   Consensus version:', getConsensusVersion())
  console.log()
}

async function demonstrateBufferOperations() {
  console.log('💾 2. Buffer-based Operations')
  
  const outputDir = './example_output/buffer_capsules'
  cleanupDir('./example_output')
  fs.mkdirSync(outputDir, { recursive: true })
  
  try {
    // Create test data
    const originalData = createTestData(150 * 1024, 'Hello from data capsules! ') // 150KB
    console.log(`   Created ${originalData.length} bytes of test data`)
    
    // Create capsules with encryption
    const encryptionKey = 'example-encryption-key-2024'
    console.log('   Creating encrypted capsules from buffer...')
    const capsuleSet = createDataCapsule(originalData, outputDir, false, encryptionKey)
    
    console.log(`   ✅ Created capsule set with ID: ${capsuleSet.id.substring(0, 16)}...`)
    console.log(`   📦 Number of capsules: ${capsuleSet.metadata.capsuleCount}`)
    console.log(`   📏 Original size: ${capsuleSet.metadata.originalSize} bytes`)
    console.log(`   🔐 Encrypted: ${capsuleSet.capsules[0].encrypted}`)
    console.log(`   🗜️  Compressed: ${capsuleSet.capsules[0].compressed}`)
    
    // Calculate and display storage overhead
    const overhead = calculateStorageOverhead(capsuleSet.metadata.originalSize, capsuleSet.metadata.capsuleCount)
    console.log(`   📈 Storage overhead: ${overhead.toFixed(2)}%`)
    
    // Extract data back
    console.log('   Extracting data from capsules...')
    const extractedData = extractDataCapsule(outputDir, encryptionKey)
    
    // Verify integrity
    const isIdentical = Buffer.compare(originalData, extractedData) === 0
    console.log(`   ✅ Data integrity verified: ${isIdentical}`)
    console.log(`   📤 Extracted ${extractedData.length} bytes`)
    
    if (!isIdentical) {
      throw new Error('Data integrity check failed!')
    }
    
  } catch (error) {
    console.error('   ❌ Error in buffer operations:', error.message)
  }
  
  console.log()
}

async function demonstrateFileOperations() {
  console.log('📁 3. File-based Operations')
  
  const inputFile = './example_output/test_input.dat'
  const outputDir = './example_output/file_capsules'
  const reconstructedFile = './example_output/reconstructed.dat'
  
  fs.mkdirSync('./example_output', { recursive: true })
  
  try {
    // Create a test file
    const testData = createTestData(750 * 1024, 'File-based capsule test data! ') // 750KB
    fs.writeFileSync(inputFile, testData)
    console.log(`   Created test file: ${testData.length} bytes`)
    
    // Create capsules from file (unencrypted)
    console.log('   Creating unencrypted capsules from file...')
    const capsuleSet = createDataCapsuleFromFile(inputFile, outputDir, false, null)
    
    console.log(`   ✅ Created capsule set with ID: ${capsuleSet.id.substring(0, 16)}...`)
    console.log(`   📦 Number of capsules: ${capsuleSet.metadata.capsuleCount}`)
    
    // List the capsule sizes
    console.log('   📏 Capsule sizes:')
    capsuleSet.capsules.forEach((capsule, index) => {
      console.log(`      Capsule ${index}: ${(capsule.size / 1024).toFixed(0)}KB`)
    })
    
    // Validate consensus parameters
    const isValidConsensus = validateConsensusParameters(capsuleSet)
    console.log(`   ✅ Consensus validation: ${isValidConsensus}`)
    
    // Extract to file
    console.log('   Extracting data to file...')
    extractDataCapsuleToFile(outputDir, reconstructedFile, null)
    
    // Verify file integrity
    const originalFileData = fs.readFileSync(inputFile)
    const reconstructedFileData = fs.readFileSync(reconstructedFile)
    const isIdentical = Buffer.compare(originalFileData, reconstructedFileData) === 0
    console.log(`   ✅ File integrity verified: ${isIdentical}`)
    
    if (!isIdentical) {
      throw new Error('File integrity check failed!')
    }
    
  } catch (error) {
    console.error('   ❌ Error in file operations:', error.message)
  }
  
  console.log()
}

async function demonstrateCapsuleInspection() {
  console.log('🔍 4. Capsule Inspection and Validation')
  
  const outputDir = './example_output/inspection_capsules'
  fs.mkdirSync(outputDir, { recursive: true })
  
  try {
    // Create a small capsule set for inspection
    const testData = createTestData(100 * 1024, 'Inspection test data ')
    const encryptionKey = 'inspection-key'
    const capsuleSet = createDataCapsule(testData, outputDir, false, encryptionKey)
    
    console.log('   Inspecting capsule files...')
    
    // Inspect each capsule file
    for (let i = 0; i < capsuleSet.metadata.capsuleCount; i++) {
      const capsuleFileName = `${capsuleSet.id.substring(0, 16)}_${i.toString().padStart(3, '0')}.capsule`
      const capsuleFilePath = path.join(outputDir, capsuleFileName)
      
      // Validate the capsule file
      const isValid = isValidCapsuleFile(capsuleFilePath)
      console.log(`   📄 ${capsuleFileName}: Valid = ${isValid}`)
      
      if (isValid) {
        // Get detailed file info
        const fileInfo = getCapsuleFileInfo(capsuleFilePath)
        if (fileInfo) {
          console.log(`      📋 Version: ${fileInfo.version}`)
          console.log(`      📍 Index: ${fileInfo.capsuleIndex}`)
          console.log(`      📏 Size: ${(fileInfo.capsuleSize / 1024).toFixed(0)}KB`)
          console.log(`      🔐 Encrypted: ${fileInfo.isEncrypted}`)
          console.log(`      🗜️  Compressed: ${fileInfo.isCompressed}`)
          console.log(`      🔍 Checksum: ${fileInfo.checksum.substring(0, 16)}...`)
        }
      }
    }
    
    // Load and inspect metadata
    console.log('   Loading capsule set metadata...')
    const loadedCapsuleSet = loadCapsuleSet(outputDir)
    console.log(`   📊 Loaded metadata for capsule set: ${loadedCapsuleSet.id.substring(0, 16)}...`)
    console.log(`   🏷️  Chunking algorithm: ${loadedCapsuleSet.metadata.chunkingAlgorithm}`)
    console.log(`   🔖 Consensus version: ${loadedCapsuleSet.metadata.consensusVersion}`)
    
    if (loadedCapsuleSet.metadata.encryptionInfo) {
      console.log(`   🔐 Encryption: ${loadedCapsuleSet.metadata.encryptionInfo.algorithm}`)
    }
    
    if (loadedCapsuleSet.metadata.compressionInfo) {
      console.log(`   🗜️  Compression: ${loadedCapsuleSet.metadata.compressionInfo.algorithm} (level ${loadedCapsuleSet.metadata.compressionInfo.level})`)
    }
    
  } catch (error) {
    console.error('   ❌ Error in capsule inspection:', error.message)
  }
  
  console.log()
}

async function demonstrateErrorHandling() {
  console.log('⚠️  5. Error Handling Demonstration')
  
  try {
    // Try to extract with wrong key
    console.log('   Testing wrong decryption key...')
    try {
      const encryptedDir = './example_output/buffer_capsules'
      if (fs.existsSync(encryptedDir)) {
        extractDataCapsule(encryptedDir, 'wrong-key')
        console.log('   ❌ Should have failed with wrong key!')
      } else {
        console.log('   ⏭️  Skipped - no encrypted capsules found')
      }
    } catch (error) {
      console.log(`   ✅ Correctly caught error: ${error.message.substring(0, 50)}...`)
    }
    
    // Try to validate non-existent file
    console.log('   Testing validation of non-existent file...')
    const isValid = isValidCapsuleFile('./nonexistent.capsule')
    console.log(`   ✅ Non-existent file validation: ${isValid} (should be false)`)
    
    // Try to get info from invalid file
    console.log('   Testing info extraction from invalid file...')
    fs.writeFileSync('./example_output/invalid.capsule', 'not a real capsule')
    const info = getCapsuleFileInfo('./example_output/invalid.capsule')
    console.log(`   ✅ Invalid file info: ${info} (should be null)`)
    
  } catch (error) {
    console.error('   ❌ Unexpected error in error handling demo:', error.message)
  }
  
  console.log()
}

async function demonstratePerformanceScenarios() {
  console.log('🚀 6. Performance Scenarios')
  
  const scenarios = [
    { name: 'Small file (10KB)', size: 10 * 1024 },
    { name: 'Medium file (500KB)', size: 500 * 1024 },
    { name: 'Large file (2MB)', size: 2 * 1024 * 1024 }
  ]
  
  for (const scenario of scenarios) {
    try {
      console.log(`   Testing ${scenario.name}...`)
      const outputDir = `./example_output/perf_${scenario.size}`
      fs.mkdirSync(outputDir, { recursive: true })
      
      const testData = createTestData(scenario.size)
      const startTime = Date.now()
      
      // Create and extract
      const capsuleSet = createDataCapsule(testData, outputDir, false, 'perf-test-key')
      const extractedData = extractDataCapsule(outputDir, 'perf-test-key')
      
      const endTime = Date.now()
      const isValid = Buffer.compare(testData, extractedData) === 0
      
      console.log(`      ⏱️  Time: ${endTime - startTime}ms`)
      console.log(`      📦 Capsules: ${capsuleSet.metadata.capsuleCount}`)
      console.log(`      ✅ Valid: ${isValid}`)
      
    } catch (error) {
      console.error(`   ❌ Error in ${scenario.name}:`, error.message)
    }
  }
  
  console.log()
}

async function main() {
  console.log('=' .repeat(60))
  console.log('🔐 DATA CAPSULES - COMPREHENSIVE EXAMPLE')
  console.log('=' .repeat(60))
  console.log()
  
  try {
    await demonstrateBasicFunctionality()
    await demonstrateBufferOperations()
    await demonstrateFileOperations()
    await demonstrateCapsuleInspection()
    await demonstrateErrorHandling()
    await demonstratePerformanceScenarios()
    
    console.log('🎉 All demonstrations completed successfully!')
    console.log()
    console.log('📁 Generated files in ./example_output/ directory:')
    console.log('   - buffer_capsules/     : Encrypted capsules from buffer')
    console.log('   - file_capsules/       : Unencrypted capsules from file')
    console.log('   - inspection_capsules/ : Capsules for inspection demo')
    console.log('   - test_input.dat       : Original test file')
    console.log('   - reconstructed.dat    : Reconstructed file')
    console.log()
    console.log('💡 Try exploring the generated capsule files and metadata!')
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  }
}

// Run the demonstration
main().catch(console.error) 