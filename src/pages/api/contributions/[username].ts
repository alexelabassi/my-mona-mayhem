import type { APIRoute } from 'astro';
import axios from 'axios';
import { contributionsCache } from '../../../utils/cache';

export const prerender = false;

// Constants for validation and requests
const USERNAME_PATTERN = /^[a-zA-Z0-9-]+$/;
const USERNAME_MAX_LENGTH = 39;
const USERNAME_MIN_LENGTH = 1;
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds

interface ErrorResponse {
	success: false;
	error: {
		type: string;
		message: string;
		retryAfter?: number;
	};
}

interface SuccessResponse {
	success: true;
	data: unknown;
}

type ApiResponse = SuccessResponse | ErrorResponse;

/**
 * Validate GitHub username format
 */
function validateUsername(username: string): { valid: boolean; error?: string } {
	if (!username) {
		return { valid: false, error: 'Username is required' };
	}

	if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
		return {
			valid: false,
			error: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`,
		};
	}

	if (!USERNAME_PATTERN.test(username)) {
		return {
			valid: false,
			error: 'Username can only contain alphanumeric characters and hyphens',
		};
	}

	return { valid: true };
}

/**
 * Create error response
 */
function createErrorResponse(
	type: string,
	message: string,
	statusCode: number,
	retryAfter?: number
): Response {
	const errorResponse: ErrorResponse = {
		success: false,
		error: {
			type,
			message,
			...(retryAfter && { retryAfter }),
		},
	};

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	if (retryAfter) {
		headers['Retry-After'] = String(retryAfter);
	}

	return new Response(JSON.stringify(errorResponse), {
		status: statusCode,
		headers,
	});
}

/**
 * Create success response
 */
function createSuccessResponse(data: unknown): Response {
	const response: SuccessResponse = {
		success: true,
		data,
	};

	return new Response(JSON.stringify(response), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ params }) => {
	try {
		const username = params.username as string;

		// Validate username format
		const validation = validateUsername(username);
		if (!validation.valid) {
			return createErrorResponse('validation_error', validation.error || 'Invalid username', 400);
		}

		// Create cache key (normalize to lowercase for consistency)
		const cacheKey = `github_contrib_${username.toLowerCase()}`;

		// Check cache first
		const cachedData = contributionsCache.get(cacheKey);
		if (cachedData) {
			return createSuccessResponse(cachedData);
		}

		// Fetch from GitHub endpoint
		const githubUrl = `https://github.com/${username}.contribs`;

		try {
			const response = await axios.get(githubUrl, {
				timeout: REQUEST_TIMEOUT_MS,
				headers: {
					// Add a user agent to avoid being blocked
					'User-Agent': 'GitHub-Contributions-Proxy/1.0',
				},
			});

			// Validate that response is JSON
			if (!response.data || typeof response.data !== 'object') {
				return createErrorResponse(
					'invalid_response',
					'GitHub returned invalid data format',
					502
				);
			}

			// Cache the successful response
			contributionsCache.set(cacheKey, response.data);

			return createSuccessResponse(response.data);
		} catch (error) {
			if (axios.isAxiosError(error)) {
				// Handle specific HTTP status codes
				if (error.response?.status === 404) {
					return createErrorResponse(
						'notfound',
						`GitHub user '${username}' not found`,
						404
					);
				}

				if (error.response?.status === 429) {
					// Rate limited
					const retryAfter = error.response.headers['retry-after'];
					const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

					return createErrorResponse(
						'ratelimit',
						'GitHub API rate limit exceeded. Please try again later.',
						429,
						retryAfterSeconds
					);
				}

				// Check for timeout
				if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
					return createErrorResponse(
						'timeout',
						'Request to GitHub timed out after 10 seconds',
						504
					);
				}

				// Check for network errors
				if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
					return createErrorResponse(
						'network_error',
						'Unable to reach GitHub service',
						504
					);
				}

				// Other axios errors
				return createErrorResponse(
					'fetch_error',
					error.message || 'Failed to fetch GitHub contribution data',
					502
				);
			}

			// Non-axios errors
			console.error('Unexpected error fetching contributions:', error);
			return createErrorResponse(
				'internal_error',
				'An unexpected error occurred while fetching contributions',
				500
			);
		}
	} catch (error) {
		// Catch-all for any unexpected errors
		console.error('Unexpected error in contributions handler:', error);
		return createErrorResponse(
			'internal_error',
			'An unexpected error occurred',
			500
		);
	}
};
