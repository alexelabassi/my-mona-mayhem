/**
 * Simple in-memory cache with TTL support
 * Useful for caching external API responses in server-side rendering
 */

interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

class Cache<T> {
	private store = new Map<string, CacheEntry<T>>();
	private ttlSeconds: number;

	constructor(ttlSeconds: number = 3600) {
		this.ttlSeconds = ttlSeconds;
	}

	/**
	 * Check if a cache entry has expired based on its TTL
	 */
	private isExpired(timestamp: number): boolean {
		const ageSeconds = (Date.now() - timestamp) / 1000;
		return ageSeconds > this.ttlSeconds;
	}

	/**
	 * Get a value from cache if it exists and hasn't expired
	 */
	get(key: string): T | null {
		const entry = this.store.get(key);
		if (!entry) {
			return null;
		}

		if (this.isExpired(entry.timestamp)) {
			this.store.delete(key);
			return null;
		}

		return entry.data;
	}

	/**
	 * Store a value in cache with current timestamp
	 */
	set(key: string, value: T): void {
		this.store.set(key, {
			data: value,
			timestamp: Date.now(),
		});
	}

	/**
	 * Remove a specific entry from cache
	 */
	clear(key: string): void {
		this.store.delete(key);
	}

	/**
	 * Clear all cache entries
	 */
	clearAll(): void {
		this.store.clear();
	}

	/**
	 * Get cache statistics (for debugging)
	 */
	getStats(): { size: number; ttlSeconds: number } {
		return {
			size: this.store.size,
			ttlSeconds: this.ttlSeconds,
		};
	}
}

// Create a singleton cache instance for GitHub contributions (1 hour TTL)
export const contributionsCache = new Cache<unknown>(3600);
