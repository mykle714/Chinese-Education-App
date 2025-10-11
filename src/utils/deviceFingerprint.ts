/**
 * Device fingerprinting utilities for work points sync
 * Creates a privacy-friendly device identifier using browser characteristics
 */

let cachedDeviceFingerprint: string | null = null;

/**
 * Generate a device fingerprint based on stable browser characteristics
 */
function generateDeviceFingerprint(): string {
  try {
    const components = [
      navigator.userAgent.substring(0, 100), // Truncated for privacy
      navigator.language,
      `${screen.width}x${screen.height}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.platform || 'unknown'
    ];
    
    // Create a base64 encoded fingerprint
    const fingerprint = btoa(components.join('|'))
      .replace(/[^a-zA-Z0-9]/g, '') // Remove special characters
      .substring(0, 16); // Truncate to reasonable length
    
    return `wp_${fingerprint}`;
  } catch (error) {
    console.warn('Error generating device fingerprint:', error);
    // Fallback to timestamp-based ID
    return `wp_fallback_${Date.now().toString(36)}`;
  }
}

/**
 * Get or create a persistent device fingerprint
 * Uses localStorage for persistence, falls back to fingerprinting if cleared
 */
export function getWorkPointsDeviceFingerprint(): string {
  // Return cached version if available
  if (cachedDeviceFingerprint) {
    return cachedDeviceFingerprint;
  }
  
  try {
    // Try to get from localStorage first
    let deviceId = localStorage.getItem('workPointsDeviceId');
    
    if (!deviceId) {
      // Generate new fingerprint
      deviceId = generateDeviceFingerprint();
      
      try {
        localStorage.setItem('workPointsDeviceId', deviceId);
      } catch (storageError) {
        console.warn('Could not save device fingerprint to localStorage:', storageError);
        // Continue without saving - will regenerate next time
      }
    }
    
    // Cache for this session
    cachedDeviceFingerprint = deviceId;
    return deviceId;
  } catch (error) {
    console.error('Error getting device fingerprint:', error);
    
    // Final fallback
    const fallback = `wp_emergency_${Math.random().toString(36).substring(2, 10)}`;
    cachedDeviceFingerprint = fallback;
    return fallback;
  }
}

/**
 * Clear cached device fingerprint (for testing or reset purposes)
 */
export function clearCachedDeviceFingerprint(): void {
  cachedDeviceFingerprint = null;
  try {
    localStorage.removeItem('workPointsDeviceId');
  } catch (error) {
    console.warn('Could not clear device fingerprint from localStorage:', error);
  }
}

/**
 * Get device info for debugging purposes
 */
export function getDeviceInfo(): {
  fingerprint: string;
  userAgent: string;
  language: string;
  screen: string;
  timezone: string;
  platform: string;
} {
  return {
    fingerprint: getWorkPointsDeviceFingerprint(),
    userAgent: navigator.userAgent.substring(0, 50) + '...',
    language: navigator.language,
    screen: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform || 'unknown'
  };
}
