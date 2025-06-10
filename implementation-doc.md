# Data Capsule Implementation Requirements

## Overview

This document outlines the implementation requirements for the Data Capsule module, a privacy-enhanced data processing system that transforms arbitrary data streams into fixed-size, encrypted, and compressed chunks. The implementation follows the capsule specification defined in the technical documentation.

## Public Interface Requirements

The module must expose exactly two main functions in its public interface:

### 1. createDataCapsule Function

```typescript
createDataCapsule(
    bufferStream: ReadableStream | Buffer, 
    postProcessPadding: boolean, 
    encryptionKey?: string | Buffer
): Promise<CapsuleSet>
```

**Parameters:**
- `bufferStream`: Input data as a readable stream or buffer
- `postProcessPadding`: Boolean flag controlling padding encryption/compression behavior
  - `true`: Apply padding after encryption and compression
  - `false`: Include padding in the encrypted and compressed portion
- `encryptionKey`: Optional encryption key for data protection

**Return Value:**
- `CapsuleSet`: Object containing the processed capsules and metadata

### 2. extractDataCapsule Function

```typescript
extractDataCapsule(
    filePath: string, 
    decryptionKey?: string | Buffer
): Promise<Buffer>
```

**Parameters:**
- `filePath`: Path to the capsule file or directory containing capsule files
- `decryptionKey`: Optional decryption key (must match the encryption key used during creation)

**Return Value:**
- `Buffer`: Original data with padding automatically stripped

## Fixed Size Buckets

The implementation must support exactly five standardized capsule sizes:

```
256 KB   = 262,144 bytes
1 MB     = 1,048,576 bytes  
10 MB    = 10,485,760 bytes
100 MB   = 104,857,600 bytes
1000 MB  = 1,048,576,000 bytes
```

## Transformation Algorithm Requirements

### Size-Based Processing Logic

The implementation must apply the following transformation rules:

```
Input Size <= 256 KB     → Single 256 KB capsule (padded)
256 KB < Input <= 1 MB   → Multiple 256 KB capsules
1 MB < Input <= 10 MB    → Multiple 1 MB capsules
10 MB < Input <= 100 MB  → Multiple 10 MB capsules  
100 MB < Input <= 1000 MB → Multiple 100 MB capsules
Input > 1000 MB          → Multiple 1000 MB capsules
```

### Chunking Strategy

For inputs larger than the target capsule size:
1. Split data into chunks of the largest applicable size
2. Handle remainder by falling back to smaller size increments
3. Always pad the final chunk to the nearest valid capsule size

### Example Transformations Required

The implementation must handle these test cases correctly:

```
150 KB → 1 × 256 KB capsule (padded)
500 KB → 2 × 256 KB capsules
750 KB → 3 × 256 KB capsules  
5 MB → 5 × 1 MB capsules
25 MB → 2 × 10 MB + 5 × 1 MB capsules
350 MB → 3 × 100 MB + 5 × 10 MB capsules
2.5 GB → 2 × 1000 MB + 5 × 100 MB capsules
```

## Encryption and Compression Requirements

### Processing Order - postProcessPadding = false

When `postProcessPadding` is `false`:
1. Apply padding to original data (if needed)
2. Encrypt the padded data using the provided encryption key
3. Compress the encrypted data using gzip compression
4. Store as final capsule

### Processing Order - postProcessPadding = true  

When `postProcessPadding` is `true`:
1. Encrypt the original data using the provided encryption key
2. Compress the encrypted data using gzip compression
3. Apply padding to the compressed data (if needed)
4. Store as final capsule

### Encryption Specifications

- **Algorithm**: AES-256-GCM (required for authenticated encryption)
- **Key Derivation**: If encryption key is provided as string, derive using PBKDF2-HMAC-SHA256
- **IV/Nonce**: Generate cryptographically secure random IV for each capsule
- **Authentication**: Use GCM mode for built-in authentication and integrity checking

### Compression Specifications

- **Algorithm**: gzip (RFC 1952)
- **Compression Level**: Use default compression level (6) for balance of speed and size
- **Error Handling**: Must handle compression failures gracefully

## Padding Protocol Requirements

### Padding Structure

For capsules requiring padding, implement the following structure:

```
[Original/Processed Data][Padding Marker][Random Padding][Size Footer]
                              ↑                              ↑
                       0xFF 0xFF 0xFF 0xFF          4 bytes (original size)
```

### Padding Components

1. **Padding Marker**: Exactly 4 bytes `0xFFFFFFFF`
2. **Random Padding**: Cryptographically random bytes
   - Minimum 5% of total capsule size
   - Generated using `crypto.getRandomValues()` or equivalent
   - Use current block height as entropy seed when available
3. **Size Footer**: 4-byte little-endian representation of original data size

### Minimum Padding Requirements

- Must be at least 5% of the target capsule size
- Additional padding may be added to reach exact capsule size
- Padding generation must be cryptographically secure

## Automatic Padding Detection Requirements

The `extractDataCapsule` function must automatically detect padding location:

### Detection Algorithm

1. **Check for compressed data markers**: Detect gzip headers to determine if data is compressed
2. **Search for padding marker**: Look for `0xFFFFFFFF` sequence
3. **Validate size footer**: Verify the size footer makes sense for the data
4. **Determine processing order**: Infer whether padding was applied before or after encryption/compression

### Extraction Process

1. **Decrypt data** (if encryption key provided)
2. **Decompress data** (if gzip headers detected)
3. **Detect and remove padding** (if padding marker found)
4. **Return original data**

## CapsuleSet Data Structure Requirements

```typescript
interface CapsuleSet {
    id: string;              // SHA-256 hash of original buffer
    capsules: Capsule[];     // Array of processed capsules
    metadata: CapsuleMetadata;
}

interface Capsule {
    index: number;           // Position in set (0-based)
    size: number;            // Fixed capsule size
    hash: string;            // SHA-256 of final capsule content
    data: Buffer;            // Processed capsule data
    encrypted: boolean;      // Whether capsule is encrypted
    compressed: boolean;     // Whether capsule is compressed
    paddingPostProcess: boolean; // Padding applied after encryption/compression
}

interface CapsuleMetadata {
    originalSize: number;    // Original buffer size in bytes
    capsuleCount: number;    // Total number of capsules
    capsuleSizes: number[];  // Size of each capsule
    checksum: string;        // SHA-256 of concatenated original data
    encryptionInfo?: {       // Present if encryption was used
        algorithm: string;   // "AES-256-GCM"
        keyDerivation: string; // "PBKDF2-HMAC-SHA256" if string key used
    };
    compressionInfo?: {      // Present if compression was used
        algorithm: string;   // "gzip"
        originalSize: number; // Size before compression
    };
}
```

## File Storage Requirements

### Capsule File Format

Each capsule must be stored as a separate file with the following naming convention:
```
{capsuleSetId}_{index}.capsule
```

Where:
- `capsuleSetId`: SHA-256 hash of the original data (full 64-character hex string)
- `index`: Zero-padded capsule index (e.g., 000, 001, 002)

### Metadata File

Store CapsuleSet metadata in a separate JSON file:
```
{capsuleSetId}_metadata.json
```

Where `capsuleSetId` is the same SHA-256 hash used for the capsule files.

## Error Handling Requirements

### Input Validation

- Validate stream/buffer input is not empty
- Ensure encryption key format is correct if provided
- Verify file paths exist and are accessible

### Processing Errors

- Handle compression failures gracefully
- Detect and report encryption/decryption errors
- Provide meaningful error messages for padding detection failures
- Implement retry logic for stream processing errors

### Data Integrity

- Verify SHA-256 checksums during extraction
- Validate capsule sizes match expected values
- Ensure padding removal doesn't corrupt data

## Performance Requirements

### Memory Efficiency

- Process streams in chunks to avoid loading entire datasets into memory
- Implement backpressure handling for large streams
- Limit concurrent capsule processing to prevent memory exhaustion

### Processing Performance

- **Stream Processing**: O(n) where n is input size
- **Capsule Creation**: O(1) per capsule (constant time operations)
- **Extraction**: O(1) per capsule for padding detection
- **Encryption/Decryption**: O(n) where n is capsule size

### Storage Overhead Targets

| Original Size | Expected Overhead | Notes |
|--------------|------------------|-------|
| < 256 KB | 100%+ | Due to minimum capsule size |
| 256 KB - 1 MB | 5-28% | Padding + compression efficiency |
| > 1 MB | 5-15% | Primarily padding overhead |

## Testing Requirements

### Unit Test Coverage

- Test all size bucket transformations
- Verify encryption/decryption with various key formats
- Test compression/decompression cycles
- Validate padding detection for both postProcessPadding modes
- Test error conditions and edge cases

### Integration Tests

- End-to-end stream processing
- Large file handling (multi-GB)
- Concurrent capsule processing
- File system integration

### Performance Tests

- Benchmark processing speeds for various file sizes
- Memory usage profiling
- Stream processing throughput tests

## Security Requirements

### Cryptographic Standards

- Use only well-established cryptographic libraries
- Implement secure random number generation
- Ensure proper key derivation for string-based keys
- Implement constant-time operations where possible

### Data Protection

- Clear sensitive data from memory after use
- Implement secure key handling practices
- Ensure encrypted data cannot be distinguished from random data
- Maintain privacy properties through uniform capsule sizes

## Dependencies

### Required Libraries

- **Crypto**: Node.js built-in `crypto` module or equivalent
- **Stream Processing**: Native streaming APIs
- **Compression**: Node.js built-in `zlib` module for gzip
- **File System**: Native file system APIs

### Optional Dependencies

- **Buffer Utilities**: For efficient buffer manipulation
- **Progress Reporting**: For large file processing feedback
- **Logging**: For debugging and monitoring

This implementation must maintain the privacy properties outlined in the capsule specification while providing efficient, secure, and reliable data processing capabilities.
