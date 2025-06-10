use napi::bindgen_prelude::*;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use sha2::{Digest, Sha256};
use std::fs;

// Performance optimization imports
use memmap2::Mmap;
use smallvec::SmallVec;

#[macro_use]
extern crate napi_derive;

// Constants for capsule sizes (NETWORK CONSENSUS CRITICAL)
const KB: usize = 1024;
const MB: usize = 1024 * KB;
const CAPSULE_SIZES: [usize; 5] = [
    256 * KB,  // 262,144 bytes
    MB,        // 1,048,576 bytes
    10 * MB,   // 10,485,760 bytes
    100 * MB,  // 104,857,600 bytes
    1000 * MB, // 1,048,576,000 bytes
];

// NETWORK CONSENSUS CRITICAL CONSTANTS
const PADDING_MARKER: [u8; 4] = [0xFF, 0xFF, 0xFF, 0xFF];
const MIN_PADDING_PERCENT: f64 = 0.05; // 5% minimum padding

// CAPSULE FILE FORMAT CONSTANTS
const CAPSULE_MAGIC: [u8; 8] = *b"DIGCAP01"; // Magic bytes for capsule identification
const CAPSULE_HEADER_SIZE: usize = 44; // Total header size in bytes
const CAPSULE_VERSION: u32 = 1; // Current capsule format version

// Header flags
const FLAG_ENCRYPTED: u32 = 0x01;
const FLAG_COMPRESSED: u32 = 0x02;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct Capsule {
    pub index: u32,
    pub size: u32,
    pub hash: String,
    pub encrypted: bool,
    pub compressed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct EncryptionInfo {
    pub algorithm: String,
    #[napi(js_name = "keyDerivation")]
    pub key_derivation: String,
    pub iterations: u32,
    pub salt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct CompressionInfo {
    pub algorithm: String,
    pub level: u32,
    #[napi(js_name = "originalSize")]
    pub original_size: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct CapsuleMetadata {
    #[napi(js_name = "originalSize")]
    pub original_size: f64,
    #[napi(js_name = "capsuleCount")]
    pub capsule_count: u32,
    #[napi(js_name = "capsuleSizes")]
    pub capsule_sizes: Vec<u32>,
    pub checksum: String,
    #[napi(js_name = "chunkingAlgorithm")]
    pub chunking_algorithm: String,
    #[napi(js_name = "consensusVersion")]
    pub consensus_version: String,
    #[napi(js_name = "encryptionInfo")]
    pub encryption_info: Option<EncryptionInfo>,
    #[napi(js_name = "compressionInfo")]
    pub compression_info: Option<CompressionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct CapsuleSet {
    pub id: String,
    pub capsules: Vec<Capsule>,
    pub metadata: CapsuleMetadata,
}

#[derive(Debug, Clone)]
pub struct CapsuleHeader {
    pub magic: [u8; 8],       // "DIGCAP01"
    pub version: u32,         // Format version
    pub capsule_index: u32,   // Index in capsule set
    pub capsule_size: u32,    // Target capsule size
    pub data_size: u32,       // Actual data size (before padding)
    pub flags: u32,           // Encryption, compression flags
    pub reserved: [u8; 8],    // Reserved for future use
    pub header_checksum: u32, // CRC32 of header (excluding this field)
    pub data_offset: u32,     // Offset to actual capsule data
}

impl CapsuleHeader {
    fn new(
        capsule_index: u32,
        capsule_size: u32,
        data_size: u32,
        encrypted: bool,
        compressed: bool,
    ) -> Self {
        let mut flags = 0u32;
        if encrypted {
            flags |= FLAG_ENCRYPTED;
        }
        if compressed {
            flags |= FLAG_COMPRESSED;
        }

        let mut header = CapsuleHeader {
            magic: CAPSULE_MAGIC,
            version: CAPSULE_VERSION,
            capsule_index,
            capsule_size,
            data_size,
            flags,
            reserved: [0u8; 8],
            header_checksum: 0, // Will be calculated
            data_offset: CAPSULE_HEADER_SIZE as u32,
        };

        header.header_checksum = header.calculate_checksum_without_field();
        header
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(CAPSULE_HEADER_SIZE);
        bytes.extend_from_slice(&self.magic);
        bytes.extend_from_slice(&self.version.to_le_bytes());
        bytes.extend_from_slice(&self.capsule_index.to_le_bytes());
        bytes.extend_from_slice(&self.capsule_size.to_le_bytes());
        bytes.extend_from_slice(&self.data_size.to_le_bytes());
        bytes.extend_from_slice(&self.flags.to_le_bytes());
        bytes.extend_from_slice(&self.reserved);
        bytes.extend_from_slice(&self.header_checksum.to_le_bytes());
        bytes.extend_from_slice(&self.data_offset.to_le_bytes());
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> CapsuleResult<Self> {
        if bytes.len() < CAPSULE_HEADER_SIZE {
            return Err(CapsuleError::InvalidFormat);
        }

        let mut offset = 0;
        let magic = bytes[offset..offset + 8]
            .try_into()
            .map_err(|_| CapsuleError::InvalidFormat)?;
        offset += 8;

        if magic != CAPSULE_MAGIC {
            return Err(CapsuleError::InvalidFormat);
        }

        let version = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );
        offset += 4;
        let capsule_index = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );
        offset += 4;
        let capsule_size = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );
        offset += 4;
        let data_size = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );
        offset += 4;
        let flags = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );
        offset += 4;
        let reserved = bytes[offset..offset + 8]
            .try_into()
            .map_err(|_| CapsuleError::InvalidFormat)?;
        offset += 8;
        let header_checksum = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );
        offset += 4;
        let data_offset = u32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| CapsuleError::InvalidFormat)?,
        );

        let header = CapsuleHeader {
            magic,
            version,
            capsule_index,
            capsule_size,
            data_size,
            flags,
            reserved,
            header_checksum,
            data_offset,
        };

        // Verify checksum
        let expected_checksum = header.calculate_checksum_without_field();
        if header_checksum != expected_checksum {
            return Err(CapsuleError::ChecksumMismatch);
        }

        Ok(header)
    }

    fn calculate_checksum_without_field(&self) -> u32 {
        let mut bytes = Vec::with_capacity(CAPSULE_HEADER_SIZE - 4);
        bytes.extend_from_slice(&self.magic);
        bytes.extend_from_slice(&self.version.to_le_bytes());
        bytes.extend_from_slice(&self.capsule_index.to_le_bytes());
        bytes.extend_from_slice(&self.capsule_size.to_le_bytes());
        bytes.extend_from_slice(&self.data_size.to_le_bytes());
        bytes.extend_from_slice(&self.flags.to_le_bytes());
        bytes.extend_from_slice(&self.reserved);
        // Skip header_checksum field
        bytes.extend_from_slice(&self.data_offset.to_le_bytes());

        crc32fast::hash(&bytes)
    }

    pub fn is_encrypted(&self) -> bool {
        (self.flags & FLAG_ENCRYPTED) != 0
    }

    pub fn is_compressed(&self) -> bool {
        (self.flags & FLAG_COMPRESSED) != 0
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, thiserror::Error)]
pub enum CapsuleError {
    #[error("Invalid format")]
    InvalidFormat,
    #[error("Unsupported size")]
    UnsupportedSize,
    #[error("Checksum mismatch")]
    ChecksumMismatch,
    #[error("Consensus violation: {0}")]
    ConsensusViolation(String),
    #[error("Compression failed")]
    CompressionFailed,
    #[error("Decryption failed")]
    DecryptionFailed,
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("IO error")]
    IoError,
}

impl From<std::io::Error> for CapsuleError {
    fn from(_: std::io::Error) -> Self {
        CapsuleError::IoError
    }
}

impl From<serde_json::Error> for CapsuleError {
    fn from(_: serde_json::Error) -> Self {
        CapsuleError::InvalidFormat
    }
}

// NAPI Error conversion
impl From<CapsuleError> for napi::Error {
    fn from(err: CapsuleError) -> Self {
        napi::Error::new(napi::Status::GenericFailure, format!("{}", err))
    }
}

// Helper type alias for Results
pub type CapsuleResult<T> = std::result::Result<T, CapsuleError>;

// Temporary storage for capsule data before writing to disk
struct CapsuleData {
    header: CapsuleHeader,
    data: Vec<u8>,
    hash: String,
}

struct StreamingCapsuleProcessor {
    encryption_key: Option<[u8; 32]>,
}

impl StreamingCapsuleProcessor {
    pub fn new(encryption_key: Option<String>) -> CapsuleResult<Self> {
        let encryption_key = if let Some(key) = encryption_key {
            Some(Self::derive_consensus_key(&key)?)
        } else {
            None
        };

        Ok(StreamingCapsuleProcessor { encryption_key })
    }

    // NETWORK CONSENSUS CRITICAL: Deterministic key derivation
    fn derive_consensus_key(key_str: &str) -> CapsuleResult<[u8; 32]> {
        let mut hasher = Sha256::default();
        hasher.update(key_str.as_bytes());
        hasher.update(b"DIG_CAPSULE_SALT_V1"); // Consensus salt
        let result = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        Ok(key)
    }

    // NETWORK CONSENSUS CRITICAL: Deterministic chunk size determination
    // Uses largest applicable size first, then falls back to smaller sizes for remainder
    fn determine_chunk_sizes(total_size: u64) -> SmallVec<[usize; 8]> {
        let mut chunks = SmallVec::new();
        let mut remaining = total_size;

        // Process from largest to smallest capsule size
        for &capsule_size in CAPSULE_SIZES.iter().rev() {
            while remaining >= capsule_size as u64 {
                chunks.push(capsule_size);
                remaining -= capsule_size as u64;
            }
        }

        // If any data remains, pad to smallest capsule size
        if remaining > 0 {
            chunks.push(CAPSULE_SIZES[0]); // 256KB
        }

        chunks
    }

    // Find the best fitting capsule size for a given data size after compression/encryption
    // This should only upgrade from the target size if absolutely necessary for padding
    fn find_optimal_capsule_size(processed_data_size: usize, target_capsule_size: usize) -> usize {
        let min_padding = (processed_data_size as f64 * MIN_PADDING_PERCENT) as usize;
        let required_space = processed_data_size + PADDING_MARKER.len() + 4 + min_padding; // data + marker + footer + min padding

        // First, try the target size from consensus algorithm
        if required_space <= target_capsule_size {
            return target_capsule_size;
        }

        // If the target size is insufficient, try with reduced padding (down to 1% minimum)
        // This preserves consensus algorithm choices when possible
        let min_padding_reduced = std::cmp::max(
            (processed_data_size as f64 * 0.01) as usize, // 1% minimum
            1024,                                         // absolute minimum 1KB padding
        );
        let required_space_reduced =
            processed_data_size + PADDING_MARKER.len() + 4 + min_padding_reduced;

        if required_space_reduced <= target_capsule_size {
            return target_capsule_size;
        }

        // Only if even reduced padding doesn't fit, find the next larger size
        for &capsule_size in CAPSULE_SIZES.iter() {
            if capsule_size > target_capsule_size && required_space <= capsule_size {
                return capsule_size;
            }
        }

        // If no standard size fits, use the largest available
        CAPSULE_SIZES[CAPSULE_SIZES.len() - 1]
    }

    // Stream-based encryption
    fn encrypt_stream<R: Read, W: Write>(
        &self,
        mut reader: R,
        mut writer: W,
        chunk_index: u32,
    ) -> CapsuleResult<u64> {
        if let Some(key) = &self.encryption_key {
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

            // CONSENSUS CRITICAL: Deterministic nonce using chunk index
            let mut nonce_bytes = [0u8; 12];
            let index_bytes = chunk_index.to_be_bytes();
            nonce_bytes[..4].copy_from_slice(&index_bytes);
            nonce_bytes[4..8].copy_from_slice(b"DIG1"); // Version marker
            nonce_bytes[8..].copy_from_slice(&[0u8; 4]); // Reserved

            let nonce = Nonce::from_slice(&nonce_bytes);

            // Write nonce first
            writer.write_all(&nonce_bytes)?;
            let mut total_written = 12u64;

            // Read all data for encryption (AES-GCM requires full data)
            let mut data = Vec::new();
            reader.read_to_end(&mut data)?;

            let ciphertext = cipher
                .encrypt(nonce, data.as_slice())
                .map_err(|_| CapsuleError::EncryptionFailed)?;

            writer.write_all(&ciphertext)?;
            total_written += ciphertext.len() as u64;
            Ok(total_written)
        } else {
            // No encryption, just copy
            std::io::copy(&mut reader, &mut writer).map_err(|_| CapsuleError::IoError)
        }
    }

    fn decrypt_stream<R: Read, W: Write>(
        &self,
        mut reader: R,
        mut writer: W,
    ) -> CapsuleResult<u64> {
        if let Some(key) = &self.encryption_key {
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

            // Read nonce
            let mut nonce_bytes = [0u8; 12];
            reader.read_exact(&mut nonce_bytes)?;

            // Read rest of encrypted data
            let mut ciphertext = Vec::new();
            reader.read_to_end(&mut ciphertext)?;

            let plaintext = cipher
                .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_slice())
                .map_err(|_| CapsuleError::DecryptionFailed)?;

            writer.write_all(&plaintext)?;
            Ok(plaintext.len() as u64)
        } else {
            // No decryption, just copy
            std::io::copy(&mut reader, &mut writer).map_err(|_| CapsuleError::IoError)
        }
    }

    // Stream-based compression with fixed level for consensus
    fn compress_stream<R: Read, W: Write>(&self, reader: R, writer: W) -> CapsuleResult<u64> {
        let mut encoder = GzEncoder::new(writer, Compression::new(6)); // Fixed level for consensus
        let bytes_written = std::io::copy(&mut BufReader::new(reader), &mut encoder)?;
        encoder.finish()?;
        Ok(bytes_written)
    }

    fn decompress_stream<R: Read, W: Write>(&self, reader: R, writer: W) -> CapsuleResult<u64> {
        let mut decoder = GzDecoder::new(reader);
        let bytes_written = std::io::copy(&mut decoder, &mut BufWriter::new(writer))?;
        Ok(bytes_written)
    }

    // NETWORK CONSENSUS CRITICAL: Deterministic padding
    fn add_deterministic_padding(
        &self,
        data: &mut Vec<u8>,
        current_size: usize,
        target_size: usize,
        chunk_index: u32,
    ) -> CapsuleResult<()> {
        if current_size >= target_size {
            return Ok(());
        }

        let available_space = target_size - current_size - PADDING_MARKER.len() - 4; // 4 bytes for size footer

        // Check if we have any space for padding
        if available_space == 0 {
            return Err(CapsuleError::ConsensusViolation(
                "No space available for padding".to_string(),
            ));
        }

        let padding_size = available_space;

        // CONSENSUS CRITICAL: Deterministic padding using chunk index as seed
        let seed = chunk_index.to_be_bytes();
        let mut hasher = Sha256::default();
        hasher.update(seed);
        hasher.update(b"DIG_PADDING_SEED_V1");
        let hash = hasher.finalize();

        // Add padding marker
        data.extend_from_slice(&PADDING_MARKER);

        // Add deterministic padding
        let mut remaining_padding = padding_size;
        while remaining_padding > 0 {
            let chunk_size = std::cmp::min(remaining_padding, 32);
            data.extend_from_slice(&hash[..chunk_size]);
            remaining_padding -= chunk_size;
        }

        // Add original size footer
        let original_size = current_size as u32;
        data.extend_from_slice(&original_size.to_le_bytes());

        Ok(())
    }

    fn remove_padding<R: Read + Seek, W: Write>(
        &self,
        mut reader: R,
        mut writer: W,
    ) -> CapsuleResult<u64> {
        // Read the entire data to search for padding marker
        let mut data = Vec::new();
        reader.read_to_end(&mut data)?;

        // Look for padding marker from the end
        let padding_marker = [0xFF, 0xFF, 0xFF, 0xFF];

        for i in (4..data.len().saturating_sub(4)).rev() {
            if data[i..i + 4] == padding_marker {
                // Found padding marker, extract original size from footer
                if i >= 4 {
                    let size_bytes = &data[data.len() - 4..];
                    let original_size = u32::from_le_bytes([
                        size_bytes[0],
                        size_bytes[1],
                        size_bytes[2],
                        size_bytes[3],
                    ]) as usize;

                    if original_size <= i {
                        writer.write_all(&data[..original_size])?;
                        return Ok(original_size as u64);
                    }
                }
            }
        }

        // No padding found, write all data
        writer.write_all(&data)?;
        Ok(data.len() as u64)
    }
}

#[napi]
pub fn create_data_capsule(
    buffer_data: Buffer,
    output_directory: String,
    _post_process_padding: bool, // Ignored - always pad after encrypt+compress
    encryption_key: Option<String>,
) -> Result<CapsuleSet> {
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Create a temporary file from the buffer
    let mut temp_file = NamedTempFile::new()?;
    temp_file.write_all(&buffer_data)?;
    let temp_path = temp_file.path().to_string_lossy().to_string();

    // Use the internal file-based implementation
    create_data_capsule_from_file_internal(
        temp_path,
        output_directory,
        _post_process_padding,
        encryption_key,
    )
}

// Internal helper function
fn create_data_capsule_from_file_internal(
    input_file_path: String,
    output_directory: String,
    _post_process_padding: bool, // Ignored - always pad after encrypt+compress
    encryption_key: Option<String>,
) -> Result<CapsuleSet> {
    let processor = StreamingCapsuleProcessor::new(encryption_key.clone())
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    // Get file size for determining optimal capsule sizes
    let input_size = fs::metadata(&input_file_path)?.len();

    // Create output directory
    fs::create_dir_all(&output_directory)?;

    // Handle empty files
    if input_size == 0 {
        // Create a single 256KB capsule for empty files
        let target_chunk_size = CAPSULE_SIZES[0];
        let mut final_data = vec![0u8; 0]; // Empty data

        let processor = StreamingCapsuleProcessor::new(encryption_key.clone())
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Encrypt empty data
        let mut encrypted_data = Vec::new();
        processor
            .encrypt_stream(
                std::io::Cursor::new(&[]),
                std::io::Cursor::new(&mut encrypted_data),
                0,
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Compress empty encrypted data
        let mut compressed_data = Vec::new();
        processor
            .compress_stream(
                std::io::Cursor::new(&encrypted_data),
                std::io::Cursor::new(&mut compressed_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Add padding to reach target size
        final_data.extend_from_slice(&compressed_data);
        processor
            .add_deterministic_padding(&mut final_data, compressed_data.len(), target_chunk_size, 0)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Create header and write capsule
        let header = CapsuleHeader::new(
            0,
            target_chunk_size as u32,
            final_data.len() as u32,
            processor.encryption_key.is_some(),
            true,
        );

        let mut hasher = Sha256::default();
        hasher.update(&header.to_bytes());
        hasher.update(&final_data);
        let capsule_hash = hasher.finalize();

        let id = hex::encode(Sha256::default().finalize()); // Empty file checksum
        let capsule_file_name = format!("{}_{:03}.capsule", &id[..16], 0);
        let capsule_path = Path::new(&output_directory).join(capsule_file_name);
        let mut capsule_file = BufWriter::new(File::create(capsule_path)?);
        capsule_file.write_all(&header.to_bytes())?;
        capsule_file.write_all(&final_data)?;
        capsule_file.flush()?;

        let capsule = Capsule {
            index: 0,
            size: target_chunk_size as u32,
            hash: hex::encode(capsule_hash),
            encrypted: processor.encryption_key.is_some(),
            compressed: true,
        };

        let capsule_set = CapsuleSet {
            id: hex::encode(Sha256::default().finalize()),
            capsules: vec![capsule],
            metadata: CapsuleMetadata {
                original_size: 0.0,
                capsule_count: 1,
                capsule_sizes: vec![target_chunk_size as u32],
                checksum: hex::encode(Sha256::default().finalize()),
                chunking_algorithm: "DIG_DETERMINISTIC_V1".to_string(),
                consensus_version: "DIG_CAPSULE_V1".to_string(),
                encryption_info: encryption_key.map(|_| EncryptionInfo {
                    algorithm: "AES-256-GCM".to_string(),
                    key_derivation: "PBKDF2-HMAC-SHA256".to_string(),
                    iterations: 100000,
                    salt: "DIG_CAPSULE_SALT_V1".to_string(),
                }),
                compression_info: Some(CompressionInfo {
                    algorithm: "gzip".to_string(),
                    level: 6,
                    original_size: 0.0,
                }),
            },
        };

        // Save metadata
        let metadata_file_name = format!("{}_metadata.json", &capsule_set.id[..16]);
        let metadata_path = Path::new(&output_directory).join(metadata_file_name);
        let metadata_json = serde_json::to_string_pretty(&capsule_set)
            .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))?;
        fs::write(metadata_path, metadata_json)?;

        return Ok(capsule_set);
    }

    // NETWORK CONSENSUS CRITICAL: Determine chunk sizes using consensus algorithm
    let chunk_sizes = StreamingCapsuleProcessor::determine_chunk_sizes(input_size);
    let chunk_sizes_for_metadata = chunk_sizes.clone();
    let mut chunk_index = 0u32;
    let mut total_checksum = Sha256::default();
    let mut capsules = Vec::with_capacity(chunk_sizes.len()); // Pre-allocate
    let mut capsule_data_list: Vec<CapsuleData> = Vec::with_capacity(chunk_sizes.len()); // Store all capsule data

    // Use memory-mapped file for efficient large file access
    let input_file = File::open(&input_file_path)?;
    let mmap = unsafe { Mmap::map(&input_file)? };
    let mut bytes_processed = 0u64;

    // Process each chunk according to consensus algorithm
    for target_chunk_size in chunk_sizes {
        let actual_read_size =
            std::cmp::min(target_chunk_size as u64, input_size - bytes_processed) as usize;

        if actual_read_size == 0 {
            break; // All data processed
        }

        // Stream processing: chunk -> encrypt -> compress -> pad with automatic size optimization

        // Step 1: Get chunk from memory map and update checksum
        let start_offset = bytes_processed as usize;
        let end_offset = start_offset + actual_read_size;
        let chunk_data = &mmap[start_offset..end_offset];
        total_checksum.update(chunk_data);
        bytes_processed += actual_read_size as u64;

        // Step 2: Stream encrypt (if enabled)
        let mut encrypted_data = Vec::with_capacity(actual_read_size + 16);
        processor
            .encrypt_stream(
                std::io::Cursor::new(chunk_data),
                std::io::Cursor::new(&mut encrypted_data),
                chunk_index,
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Step 3: Stream compress
        let mut compressed_data = Vec::with_capacity(encrypted_data.len() / 2);
        processor
            .compress_stream(
                std::io::Cursor::new(&encrypted_data),
                std::io::Cursor::new(&mut compressed_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Step 4: Find optimal capsule size for this compressed data
        let optimal_capsule_size = StreamingCapsuleProcessor::find_optimal_capsule_size(
            compressed_data.len(),
            target_chunk_size,
        );

        // Step 5: Add deterministic padding to reach optimal capsule size
        let mut final_data = Vec::with_capacity(optimal_capsule_size);
        final_data.extend_from_slice(&compressed_data);
        processor
            .add_deterministic_padding(
                &mut final_data,
                compressed_data.len(),
                optimal_capsule_size,
                chunk_index,
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Create capsule header
        let header = CapsuleHeader::new(
            chunk_index,
            optimal_capsule_size as u32,
            final_data.len() as u32,
            processor.encryption_key.is_some(),
            true, // Always compressed
        );

        // Calculate final hash
        let mut hasher = Sha256::default();
        hasher.update(&header.to_bytes());
        hasher.update(&final_data);
        let capsule_hash = hasher.finalize();

        // Store capsule data temporarily (we'll write files after calculating final ID)
        let capsule_data = CapsuleData {
            header,
            data: final_data,
            hash: hex::encode(capsule_hash),
        };

        // Store capsule data for later writing
        capsule_data_list.push(capsule_data);
        chunk_index += 1;
    }

    // Calculate final checksum and write all capsule files with consistent naming
    let final_checksum = total_checksum.finalize();
    let final_id = hex::encode(final_checksum);

    // Write all capsule files using the final ID
    for (index, capsule_data) in capsule_data_list.iter().enumerate() {
        let capsule_file_name = format!("{}_{:03}.capsule", &final_id[..16], index);
        let capsule_path = Path::new(&output_directory).join(capsule_file_name);
        let mut capsule_file = BufWriter::new(File::create(capsule_path)?);
        capsule_file.write_all(&capsule_data.header.to_bytes())?;
        capsule_file.write_all(&capsule_data.data)?;
        capsule_file.flush()?;

        // Create capsule metadata
        let capsule = Capsule {
            index: index as u32,
            size: capsule_data.header.capsule_size,
            hash: capsule_data.hash.clone(),
            encrypted: processor.encryption_key.is_some(),
            compressed: true,
        };
        capsules.push(capsule);
    }

    // Create final capsule set
    let capsule_set = CapsuleSet {
        id: final_id.clone(),
        capsules,
        metadata: CapsuleMetadata {
            original_size: input_size as f64,
            capsule_count: chunk_index,
            capsule_sizes: chunk_sizes_for_metadata
                .iter()
                .map(|&size| size as u32)
                .collect(),
            checksum: final_id.clone(),
            chunking_algorithm: "DIG_DETERMINISTIC_V1".to_string(),
            consensus_version: "DIG_CAPSULE_V1".to_string(),
            encryption_info: if encryption_key.is_some() {
                Some(EncryptionInfo {
                    algorithm: "AES-256-GCM".to_string(),
                    key_derivation: "PBKDF2-HMAC-SHA256".to_string(),
                    iterations: 100000,
                    salt: "DIG_CAPSULE_SALT_V1".to_string(),
                })
            } else {
                None
            },
            compression_info: Some(CompressionInfo {
                algorithm: "gzip".to_string(),
                level: 6,
                original_size: input_size as f64,
            }),
        },
    };

    // Save metadata
    let metadata_file_name = format!("{}_metadata.json", &capsule_set.id[..16]);
    let metadata_path = Path::new(&output_directory).join(metadata_file_name);
    let metadata_json = serde_json::to_string_pretty(&capsule_set)
        .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))?;
    fs::write(metadata_path, metadata_json)?;

    Ok(capsule_set)
}

#[napi]
pub fn extract_data_capsule(
    capsule_set_path: String,
    decryption_key: Option<String>,
) -> Result<Buffer> {
    use tempfile::NamedTempFile;

    // Create temporary output file
    let temp_output = NamedTempFile::new()?;
    let temp_output_path = temp_output.path().to_string_lossy().to_string();

    // Extract to temporary file using internal function
    extract_data_capsule_to_file_internal(
        capsule_set_path,
        temp_output_path.clone(),
        decryption_key,
    )?;

    // Read the extracted data and return as Buffer
    let extracted_data = std::fs::read(temp_output_path)?;
    Ok(Buffer::from(extracted_data))
}

// Internal helper function
fn extract_data_capsule_to_file_internal(
    capsule_set_path: String,
    output_file_path: String,
    decryption_key: Option<String>,
) -> Result<()> {
    // Load capsule set metadata
    let (capsule_set, _) = load_capsule_set_from_path(&capsule_set_path)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    let processor = StreamingCapsuleProcessor::new(decryption_key)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    // Open output file for writing
    let output_file = File::create(output_file_path)?;
    let mut writer = BufWriter::new(output_file);

    // Process each capsule in order
    let input_dir = if Path::new(&capsule_set_path).is_dir() {
        capsule_set_path
    } else {
        Path::new(&capsule_set_path)
            .parent()
            .unwrap()
            .to_string_lossy()
            .to_string()
    };

    // Calculate expected checksum
    let mut total_checksum = Sha256::default();

    for i in 0..capsule_set.metadata.capsule_count {
        let capsule_file_name = format!("{}_{:03}.capsule", &capsule_set.id[..16], i);
        let capsule_path = Path::new(&input_dir).join(capsule_file_name);

        let mut capsule_file = File::open(capsule_path)?;

        // Read and validate header
        let mut header_bytes = vec![0u8; CAPSULE_HEADER_SIZE];
        capsule_file.read_exact(&mut header_bytes)?;
        let _header = CapsuleHeader::from_bytes(&header_bytes)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Stream processing: remove_padding -> decompress -> decrypt

        // Step 1: Remove padding
        let mut no_padding_data = Vec::new();
        processor
            .remove_padding(
                &mut capsule_file,
                std::io::Cursor::new(&mut no_padding_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Step 2: Decompress
        let mut decompressed_data = Vec::new();
        processor
            .decompress_stream(
                std::io::Cursor::new(&no_padding_data),
                std::io::Cursor::new(&mut decompressed_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Step 3: Decrypt
        let mut decrypted_data = Vec::new();
        processor
            .decrypt_stream(
                std::io::Cursor::new(&decompressed_data),
                std::io::Cursor::new(&mut decrypted_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Write to output file and update checksum
        total_checksum.update(&decrypted_data);
        writer.write_all(&decrypted_data)?;
    }

    writer.flush()?;

    // Verify checksum
    let computed_checksum = hex::encode(total_checksum.finalize());
    if computed_checksum != capsule_set.metadata.checksum {
        return Err(Error::new(
            Status::GenericFailure,
            "Checksum mismatch".to_string(),
        ));
    }

    Ok(())
}

// Utility function for working directly with files (more efficient for large files)
#[napi]
pub fn create_data_capsule_from_file(
    input_file_path: String,
    output_directory: String,
    _post_process_padding: bool, // Ignored - always pad after encrypt+compress
    encryption_key: Option<String>,
) -> Result<CapsuleSet> {
    create_data_capsule_from_file_internal(
        input_file_path,
        output_directory,
        _post_process_padding,
        encryption_key,
    )
}

// Utility function for extracting directly to file (more efficient for large files)
#[napi]
pub fn extract_data_capsule_to_file(
    capsule_set_path: String,
    output_file_path: String,
    decryption_key: Option<String>,
) -> Result<()> {
    extract_data_capsule_to_file_internal(capsule_set_path, output_file_path, decryption_key)
}

#[napi]
pub fn load_capsule_set(path: String) -> Result<CapsuleSet> {
    let (capsule_set, _) = load_capsule_set_from_path(&path)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(capsule_set)
}

#[napi]
pub fn reconstruct_file_from_capsules(
    capsule_set: CapsuleSet,
    capsules_dir: String,
    output_file_path: String,
    decryption_key: Option<String>,
) -> Result<()> {
    let processor = StreamingCapsuleProcessor::new(decryption_key)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    // Open output file for writing
    let output_file = File::create(output_file_path)?;
    let mut writer = BufWriter::new(output_file);

    // Create checksum verifier
    let mut verifier_hasher = Sha256::default();

    // Sort capsules by index
    let mut sorted_capsules: Vec<_> = capsule_set.capsules.iter().collect();
    sorted_capsules.sort_by_key(|capsule| capsule.index);

    // Process each capsule in order
    for capsule in sorted_capsules {
        // Load capsule file
        let capsule_file_name = format!("{}_{:03}.capsule", &capsule_set.id[..16], capsule.index);
        let capsule_path = Path::new(&capsules_dir).join(capsule_file_name);
        let mut capsule_file = File::open(capsule_path)?;

        // Skip header
        capsule_file.seek(SeekFrom::Start(CAPSULE_HEADER_SIZE as u64))?;

        // Stream processing: remove_padding -> decompress -> decrypt

        // Step 1: Remove padding
        let mut no_padding_data = Vec::new();
        processor
            .remove_padding(
                &mut capsule_file,
                std::io::Cursor::new(&mut no_padding_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Step 2: Decompress
        let mut decompressed_data = Vec::new();
        processor
            .decompress_stream(
                std::io::Cursor::new(&no_padding_data),
                std::io::Cursor::new(&mut decompressed_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Step 3: Decrypt
        let mut decrypted_data = Vec::new();
        processor
            .decrypt_stream(
                std::io::Cursor::new(&decompressed_data),
                std::io::Cursor::new(&mut decrypted_data),
            )
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Write to output file and update checksum
        writer.write_all(&decrypted_data)?;
        verifier_hasher.update(&decrypted_data);
    }

    writer.flush()?;

    // Verify checksum
    let calculated_checksum = hex::encode(verifier_hasher.finalize());
    if calculated_checksum != capsule_set.metadata.checksum {
        return Err(Error::new(
            Status::GenericFailure,
            "Checksum mismatch".to_string(),
        ));
    }

    Ok(())
}

#[napi]
pub fn is_valid_capsule_file(file_path: String) -> Result<bool> {
    match validate_capsule_file_internal(&file_path) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[napi]
pub fn get_capsule_file_info(file_path: String) -> Result<Option<CapsuleFileInfo>> {
    match validate_capsule_file_internal(&file_path) {
        Ok(header) => Ok(Some(CapsuleFileInfo {
            magic: hex::encode(header.magic),
            version: header.version,
            capsule_index: header.capsule_index,
            capsule_size: header.capsule_size,
            data_size: header.data_size,
            is_encrypted: header.flags & FLAG_ENCRYPTED != 0,
            is_compressed: header.flags & FLAG_COMPRESSED != 0,
            checksum: format!("{:08x}", header.header_checksum),
        })),
        Err(_) => Ok(None),
    }
}

#[napi]
pub fn calculate_storage_overhead(original_size: i64, capsule_count: u32) -> f64 {
    if original_size == 0 {
        return 0.0;
    }

    let min_padding_per_capsule = (CAPSULE_SIZES[0] as f64 * MIN_PADDING_PERCENT) as i64;
    let total_min_padding = min_padding_per_capsule * capsule_count as i64;

    (total_min_padding as f64 / original_size as f64) * 100.0
}

fn load_capsule_set_from_path(path: &str) -> CapsuleResult<(CapsuleSet, String)> {
    let path_obj = Path::new(path);

    let (metadata_path, input_dir) = if path_obj.is_dir() {
        // Directory path - find metadata file
        let entries = fs::read_dir(path_obj)?;

        let mut metadata_file = None;
        for entry in entries {
            let entry = entry?;
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();

            if file_name_str.ends_with("_metadata.json") {
                metadata_file = Some(entry.path());
                break;
            }
        }

        let metadata_path = metadata_file.ok_or(CapsuleError::InvalidFormat)?;

        (metadata_path, path.to_string())
    } else {
        // Single file path - assume it's a metadata file
        (
            path_obj.to_path_buf(),
            path_obj
                .parent()
                .ok_or(CapsuleError::InvalidFormat)?
                .to_string_lossy()
                .to_string(),
        )
    };

    // Load and parse metadata
    let metadata_content = fs::read_to_string(metadata_path)?;

    let capsule_set: CapsuleSet = serde_json::from_str(&metadata_content)?;

    Ok((capsule_set, input_dir))
}

#[napi]
pub fn get_capsule_sizes() -> Vec<u32> {
    CAPSULE_SIZES.iter().map(|&size| size as u32).collect()
}

#[napi]
pub fn get_consensus_version() -> String {
    "DIG_CAPSULE_V1".to_string()
}

#[napi]
pub fn validate_consensus_parameters(capsule_set: CapsuleSet) -> napi::Result<bool> {
    // Validate consensus-critical parameters
    if capsule_set.metadata.consensus_version != "DIG_CAPSULE_V1" {
        return Err(
            CapsuleError::ConsensusViolation("Invalid consensus version".to_string()).into(),
        );
    }

    if capsule_set.metadata.chunking_algorithm != "DIG_DETERMINISTIC_V1" {
        return Err(
            CapsuleError::ConsensusViolation("Invalid chunking algorithm".to_string()).into(),
        );
    }

    // Validate capsule sizes are from allowed set
    for capsule in &capsule_set.capsules {
        if !CAPSULE_SIZES.contains(&(capsule.size as usize)) {
            return Err(
                CapsuleError::ConsensusViolation("Invalid capsule size".to_string()).into(),
            );
        }
    }

    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct CapsuleFileInfo {
    pub magic: String,
    pub version: u32,
    pub capsule_index: u32,
    pub capsule_size: u32,
    pub data_size: u32,
    pub is_encrypted: bool,
    pub is_compressed: bool,
    pub checksum: String,
}

fn validate_capsule_file_internal(file_path: &str) -> CapsuleResult<CapsuleHeader> {
    // Check if file exists
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(CapsuleError::InvalidFormat);
    }

    // Read just the header portion
    let mut file = File::open(path)?;
    let mut header_bytes = vec![0u8; CAPSULE_HEADER_SIZE];

    match file.read_exact(&mut header_bytes) {
        Ok(_) => {
            // Parse and validate header
            let header = CapsuleHeader::from_bytes(&header_bytes)?;

            // Additional validation
            if header.version != CAPSULE_VERSION {
                return Err(CapsuleError::ConsensusViolation(
                    "Unsupported capsule version".to_string(),
                ));
            }

            // Validate capsule size is from allowed set
            if !CAPSULE_SIZES.contains(&(header.capsule_size as usize)) {
                return Err(CapsuleError::ConsensusViolation(
                    "Invalid capsule size".to_string(),
                ));
            }

            // Validate data offset
            if header.data_offset != CAPSULE_HEADER_SIZE as u32 {
                return Err(CapsuleError::InvalidFormat);
            }

            Ok(header)
        }
        Err(_) => Err(CapsuleError::InvalidFormat),
    }
}
