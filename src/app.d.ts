declare global {
	namespace App {
		interface Locals {
			user: { id: number; email: string; name: string; is_admin: number; is_owner: number } | null;
		}
	}
}

export {};
