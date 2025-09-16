// Fix test user password script
// Run with: node server/tests/fix-test-user-password.js

import bcrypt from 'bcrypt';
import { userDAL } from '../dist/dal/setup.js';

async function fixTestUserPassword() {
  console.log('🔧 Fixing test user password...\n');

  try {
    const testEmail = 'test@example.com';
    const testPassword = 'testpassword123';
    
    // Find the user
    console.log('1. Finding test user...');
    const user = await userDAL.findByEmail(testEmail);
    
    if (!user) {
      console.log('❌ Test user not found');
      return;
    }
    
    console.log(`✅ Found user: ${user.email}`);
    
    // Hash the test password
    console.log('2. Hashing new password...');
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    console.log('✅ Password hashed');
    
    // Update the user's password
    console.log('3. Updating password in database...');
    const updatedUser = await userDAL.updatePassword(user.id, hashedPassword);
    
    if (updatedUser) {
      console.log('✅ Password updated successfully!');
      console.log(`   User: ${updatedUser.email}`);
      console.log(`   Test password: ${testPassword}`);
    } else {
      console.log('❌ Failed to update password');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the fix
fixTestUserPassword().then(() => {
  console.log('\n🎉 Password fix completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Password fix failed:', error);
  process.exit(1);
});
