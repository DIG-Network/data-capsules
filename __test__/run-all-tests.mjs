#!/usr/bin/env node

import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Define test suites in order of execution
const testSuites = [
  {
    name: 'Basic Functionality',
    file: 'basic.spec.mjs',
    description: 'Core constants and utility functions'
  },
  {
    name: 'File Operations',
    file: 'file-operations.spec.mjs',
    description: 'File-based capsule creation and extraction'
  },
  {
    name: 'Consensus Validation',
    file: 'consensus.spec.mjs',
    description: 'Consensus rules and deterministic processing'
  },
  {
    name: 'Capsule Validation',
    file: 'capsule-validation.spec.mjs',
    description: 'Capsule file format validation'
  },
  {
    name: 'Error Handling',
    file: 'error-handling.spec.mjs',
    description: 'Error conditions and recovery'
  },
  {
    name: 'Edge Cases',
    file: 'edge-cases.spec.mjs',
    description: 'Boundary conditions and special scenarios'
  },
  {
    name: 'Performance',
    file: 'performance.spec.mjs',
    description: 'Large files and streaming performance'
  }
]

async function runTestSuite(testSuite) {
  const testFile = join(__dirname, testSuite.file)
  
  if (!existsSync(testFile)) {
    console.log(`⚠️  Test suite ${testSuite.name} not found: ${testSuite.file}`)
    return { name: testSuite.name, status: 'skipped', reason: 'file not found' }
  }

  return new Promise((resolve) => {
    console.log(`\n🧪 Running ${testSuite.name}`)
    console.log(`   ${testSuite.description}`)
    console.log(`   File: ${testSuite.file}`)
    
    const startTime = Date.now()
    
    const child = spawn('npx', ['ava', testFile, '--verbose'], {
      stdio: 'inherit',
      cwd: join(__dirname, '..')
    })
    
    child.on('close', (code) => {
      const duration = Date.now() - startTime
      
      if (code === 0) {
        console.log(`✅ ${testSuite.name} passed (${duration}ms)`)
        resolve({ name: testSuite.name, status: 'passed', duration })
      } else {
        console.log(`❌ ${testSuite.name} failed (${duration}ms)`)
        resolve({ name: testSuite.name, status: 'failed', duration, exitCode: code })
      }
    })
    
    child.on('error', (error) => {
      console.log(`💥 ${testSuite.name} errored: ${error.message}`)
      resolve({ name: testSuite.name, status: 'error', error: error.message })
    })
  })
}

async function runAllTests() {
  console.log('🚀 Data Capsules Test Suite')
  console.log('===========================')
  console.log(`Running ${testSuites.length} test suites...`)
  
  const results = []
  const startTime = Date.now()
  
  // Run test suites sequentially to avoid resource conflicts
  for (const testSuite of testSuites) {
    const result = await runTestSuite(testSuite)
    results.push(result)
    
    // Short delay between test suites
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  const totalTime = Date.now() - startTime
  
  // Print summary
  console.log('\n📊 Test Summary')
  console.log('================')
  
  const passed = results.filter(r => r.status === 'passed').length
  const failed = results.filter(r => r.status === 'failed').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const errored = results.filter(r => r.status === 'error').length
  
  console.log(`Total test suites: ${results.length}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`⚠️  Skipped: ${skipped}`)
  console.log(`💥 Errored: ${errored}`)
  console.log(`⏱️  Total time: ${totalTime}ms`)
  
  // Detailed results
  console.log('\n📋 Detailed Results')
  console.log('===================')
  
  results.forEach(result => {
    const statusIcon = {
      'passed': '✅',
      'failed': '❌',
      'skipped': '⚠️',
      'error': '💥'
    }[result.status]
    
    let details = ''
    if (result.duration) {
      details += ` (${result.duration}ms)`
    }
    if (result.reason) {
      details += ` - ${result.reason}`
    }
    if (result.error) {
      details += ` - ${result.error}`
    }
    if (result.exitCode) {
      details += ` - exit code ${result.exitCode}`
    }
    
    console.log(`${statusIcon} ${result.name}${details}`)
  })
  
  // Exit with appropriate code
  const hasFailures = failed > 0 || errored > 0
  if (hasFailures) {
    console.log('\n❌ Some test suites failed')
    process.exit(1)
  } else {
    console.log('\n🎉 All test suites passed!')
    process.exit(0)
  }
}

// Check if we're being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('💥 Test runner failed:', error)
    process.exit(1)
  })
} 