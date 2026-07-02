use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

const NONCE_SIZE: usize = 12;

#[derive(Debug)]
pub struct CredentialVault {
    encryption_key: Option<Zeroizing<[u8; 32]>>,
}

impl CredentialVault {
    pub fn new() -> Self {
        Self {
            encryption_key: None,
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.encryption_key.is_some()
    }

    pub fn get_encryption_key(&self) -> Result<[u8; 32], VaultError> {
        self.encryption_key
            .as_ref()
            .map(|k| **k)
            .ok_or(VaultError::VaultLocked)
    }

    pub fn unlock(&mut self, master_password: &str, salt: &[u8]) -> Result<(), VaultError> {
        let key = derive_key(master_password, salt)?;
        self.encryption_key = Some(Zeroizing::new(key));
        Ok(())
    }

    pub fn lock(&mut self) {
        self.encryption_key = None;
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let key = self.get_encryption_key()?;
        encrypt_data(&key, plaintext)
    }

    pub fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let key = self.get_encryption_key()?;
        decrypt_data(&key, ciphertext)
    }
}

impl Default for CredentialVault {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("Vault is locked")]
    VaultLocked,
    #[error("Encryption error: {0}")]
    EncryptionError(String),
    #[error("Decryption error: {0}")]
    DecryptionError(String),
    #[error("Key derivation error: {0}")]
    KeyDerivationError(String),
    /// Surfaced by the master-password unlock/verify path. Kept in the API for
    /// the runtime-unverified master-password flow (Sprint 9) and future verify
    /// surfaces.
    #[allow(dead_code)]
    #[error("Invalid password")]
    InvalidPassword,
}

pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn hash_password(password: &str) -> Result<(String, [u8; 32]), VaultError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| VaultError::KeyDerivationError(e.to_string()))?
        .to_string();

    let mut salt_bytes = [0u8; 32];
    let salt_str = salt.as_str().as_bytes();
    let len = salt_str.len().min(32);
    salt_bytes[..len].copy_from_slice(&salt_str[..len]);

    Ok((hash, salt_bytes))
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, VaultError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| VaultError::KeyDerivationError(e.to_string()))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], VaultError> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| VaultError::KeyDerivationError(e.to_string()))?;
    Ok(key)
}

/// Re-encrypt every credential blob from `old_key` to `new_key`, verifying each
/// new blob round-trips before returning. Returns the list of (id, new_blob)
/// ready to be committed. If ANY decrypt/encrypt/verify fails, returns Err and
/// the caller must write nothing (no data loss).
pub fn rekey_blobs(
    old_key: &[u8; 32],
    new_key: &[u8; 32],
    blobs: &[(String, Vec<u8>)],
) -> Result<Vec<(String, Vec<u8>)>, VaultError> {
    let mut out = Vec::with_capacity(blobs.len());
    for (id, blob) in blobs {
        let plaintext = decrypt_data(old_key, blob)?;
        let new_blob = encrypt_data(new_key, &plaintext)?;
        // Verify the new blob decrypts back to the original plaintext.
        let verified = decrypt_data(new_key, &new_blob)?;
        if verified != plaintext {
            return Err(VaultError::EncryptionError(format!(
                "Re-key verification failed for credential {}",
                id
            )));
        }
        out.push((id.clone(), new_blob));
    }
    Ok(out)
}

pub fn encrypt_data(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| VaultError::EncryptionError(e.to_string()))?;

    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| VaultError::EncryptionError(e.to_string()))?;

    // Prepend nonce to ciphertext
    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

pub fn decrypt_data(key: &[u8; 32], ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
    if ciphertext.len() < NONCE_SIZE {
        return Err(VaultError::DecryptionError("Ciphertext too short".to_string()));
    }

    let (nonce_bytes, encrypted) = ciphertext.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| VaultError::DecryptionError(e.to_string()))?;

    cipher
        .decrypt(nonce, encrypted)
        .map_err(|e| VaultError::DecryptionError(e.to_string()))
}
