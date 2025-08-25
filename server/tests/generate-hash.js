// Script to generate a bcrypt hash for a password
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;
const PASSWORD = 'Password123';

async function generateHash() {
  try {
    console.log(`Generating hash for password: ${PASSWORD}`);
    const hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
    console.log(`Generated hash: ${hash}`);
    
    // Verify the hash
    const isValid = await bcrypt.compare(PASSWORD, hash);
    console.log(`Verification result: ${isValid}`);
    
    console.log('\nSQL to update users:');
    console.log(`UPDATE Users SET password = '${hash}';`);
  } catch (err) {
    console.error('Error generating hash:', err);
  }
}

// Run the function
generateHash();
