/**
 * Cache Layer - Caching implementations
 */

// Cache implementations for link fetching, token counting, etc.
export interface ICache<T> {
  get(key: string): T | null;
  set(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
  has(key: string): boolean;
}

export class InMemoryCache<T> implements ICache<T> {
  private cache = new Map<string, { value: T; expiry?: number }>();
  
  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }
  
  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiry: ttlMs ? Date.now() + ttlMs : undefined
    });
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;
    
    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }
}
