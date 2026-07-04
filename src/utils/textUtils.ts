// Matches any CJK Unified Ideograph (common + extension A/B blocks).
export const hasChinese = (text: string): boolean => /[一-鿿㐀-䶿]/.test(text);
