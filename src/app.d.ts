import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Locals {
			user: { id: number; email: string; name: string; is_admin: number } | null;
		}
	}
	interface Env {
		DB: D1Database;
		PHOTOS: R2Bucket;
		ADMIN_EMAIL?: string;
		TIME_ZONE?: string;
		MAIL_FROM?: string;
		RESEND_API_KEY?: string;
	}
}

export {};
