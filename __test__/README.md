# Data Capsules Test Suite

This directory contains comprehensive tests for the Data Capsules module, organized into focused test files for better maintainability and clarity.

## Test Structure

### Test Files

#### 📁 `helpers/test-utils.mjs`
Common utilities and helper functions used across all test suites:
- Test data generation
- Temporary directory management
- Assertion helpers
- Standard test constants

#### 🧪 `basic.spec.mjs`
**Basic Functionality Tests**
- Core constants and utility functions
- `getCapsuleSizes()` validation
- `getConsensusVersion()` checks
- `calculateStorageOverhead()` calculations

#### 📄 `file-operations.spec.mjs`
**File-Based Operations Tests**
- `createDataCapsuleFromFile()` functionality
- `extractDataCapsuleToFile()` streaming extraction
- `loadCapsuleSet()` metadata loading
- `reconstructFileFromCapsules()` operations
- Encryption and compression handling

#### ⚖️ `consensus.spec.mjs`
**Consensus Validation Tests**
- `validateConsensusParameters()` validation
- Deterministic processing verification
- Padding mode consistency
- Chunking algorithm compliance

#### 🔍 `capsule-validation.spec.mjs`
**Capsule File Validation Tests**
- `isValidCapsuleFile()` validation
- `getCapsuleFileInfo()` header extraction
- File format compliance
- Header consistency checks

#### ⚠️ `error-handling.spec.mjs`
**Error Condition Tests**
- Non-existent file handling
- Wrong decryption keys
- Corrupted data recovery
- Missing capsule files
- System stability under errors

#### 🎯 `edge-cases.spec.mjs`
**Edge Case and Boundary Tests**
- Empty files
- Boundary sizes (256KB, 1MB, etc.)
- Very small files (1 byte)
- Highly compressible data
- Incompressible data
- Special encryption keys

#### ⚡ `performance.spec.mjs`
**Performance and Large File Tests**
- Large file handling (5MB+)
- Memory efficiency
- Streaming I/O performance
- Concurrent operations
- Performance scaling

### Test Runner

#### 🚀 `run-all-tests.mjs`
Comprehensive test runner that:
- Executes all test suites in order
- Provides detailed progress reporting
- Generates summary statistics
- Handles test suite dependencies
- Exits with appropriate status codes

## Running Tests

### Run All Tests
```bash
# Run the complete test suite
node __test__/run-all-tests.mjs

# Or use npm script (if defined in package.json)
npm test
```

### Run Individual Test Suites
```bash
# Run specific test file
npx ava __test__/basic.spec.mjs --verbose

# Run with watch mode
npx ava __test__/file-operations.spec.mjs --watch --verbose

# Run tests matching pattern
npx ava __test__/consensus.spec.mjs --match="*deterministic*"
```

### Run Tests by Category
```bash
# Quick tests (basic + validation)
npx ava __test__/basic.spec.mjs __test__/capsule-validation.spec.mjs

# Core functionality
npx ava __test__/file-operations.spec.mjs __test__/consensus.spec.mjs

# Stress tests
npx ava __test__/performance.spec.mjs __test__/edge-cases.spec.mjs
```

## Test Configuration

Tests use [AVA](https://github.com/avajs/ava) test runner with the following features:
- ES modules support
- Async/await testing
- Parallel test execution
- Comprehensive assertions
- Custom timeouts for long-running tests

### Environment Requirements
- Node.js 16+ (ES modules support)
- Sufficient disk space for temporary test files
- Memory for large file operations (performance tests)

## Test Data

Tests use deterministic random data generation to ensure:
- Reproducible test results
- Consistent performance measurements
- Reliable edge case coverage
- Proper encryption/compression testing

### Temporary Files
- All tests use isolated temporary directories
- Automatic cleanup after test completion
- No interference between test runs
- Safe concurrent execution

## Coverage Areas

### ✅ Functional Coverage
- All public API functions
- File format compliance
- Encryption/decryption cycles
- Compression/decompression
- Metadata handling
- Error conditions

### ✅ Edge Case Coverage
- Boundary file sizes
- Empty files
- Very large files
- Corrupted data
- Invalid inputs
- Resource constraints

### ✅ Performance Coverage
- Large file streaming
- Memory efficiency
- Concurrent operations
- Repeated operations
- Validation performance

### ✅ Security Coverage
- Encryption key handling
- Data integrity verification
- Consensus parameter validation
- File format security

## Adding New Tests

### Creating Test Files
1. Follow naming convention: `feature-name.spec.mjs`
2. Import test utilities from `helpers/test-utils.mjs`
3. Use descriptive test names and clear assertions
4. Include proper cleanup in try/finally blocks
5. Add appropriate timeouts for long operations

### Test Organization
```javascript
import test from 'ava'
import { 
  createTempDir, 
  cleanupTempDir, 
  createTestFile,
  TEST_SIZES,
  TEST_KEYS
} from './helpers/test-utils.mjs'

test('descriptive test name', async (t) => {
  const tempDir = createTempDir()
  
  try {
    // Test implementation
    // Use assertions: t.is(), t.true(), t.deepEqual(), etc.
    
  } finally {
    cleanupTempDir(tempDir)
  }
})
```

### Best Practices
1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up temporary resources
3. **Assertions**: Use specific, meaningful assertions
4. **Performance**: Set appropriate timeouts for slow tests
5. **Documentation**: Add comments for complex test logic

## Continuous Integration

Tests are designed to run reliably in CI environments:
- No external dependencies
- Deterministic results
- Appropriate timeouts
- Clean resource usage
- Clear failure reporting

### CI Configuration Example
```yaml
- name: Run Tests
  run: |
    npm ci
    npm run build
    node __test__/run-all-tests.mjs
```

## Troubleshooting

### Common Issues

#### Test Timeouts
- Increase timeout for performance tests: `.timeout('60s')`
- Check available system resources
- Verify no resource leaks in long tests

#### File System Issues
- Ensure write permissions in temp directories
- Check available disk space
- Verify proper cleanup of temp files

#### Memory Issues
- Monitor memory usage in large file tests
- Use streaming operations for big files
- Check for memory leaks in repeated operations

#### Flaky Tests
- Review test isolation
- Check for race conditions
- Ensure deterministic test data

### Debug Mode
```bash
# Run with debug output
DEBUG=ava npx ava __test__/basic.spec.mjs --verbose

# Run single test with detailed output
npx ava __test__/file-operations.spec.mjs --match="*encryption*" --verbose
```

## Contributing

When adding new tests:
1. Follow existing patterns and structure
2. Add tests to appropriate category file
3. Update this README if adding new test files
4. Ensure all tests pass before submitting
5. Include performance considerations for new features

The test suite is designed to be comprehensive, maintainable, and reliable. Each test file focuses on a specific aspect of the system, making it easy to locate and fix issues when they arise. 